// ============================================
// B15-3: Saga Engine — Orchestrates provisioning steps
// with execute/rollback/idempotent retry
// ============================================

import { createAdminClient } from '@/lib/supabase/server';
import {
  createProvisioningStep,
  updateProvisioningStep,
  getProvisioningSteps,
} from '@/lib/supabase/queries';
import type { StepType, StepStatus, ProvisioningContext } from './types';

// ============================================
// Types
// ============================================

export interface SagaStep {
  name: string;
  type: StepType;
  estimatedDurationMs: number;
  execute(context: ProvisioningContext): Promise<StepResult>;
  compensate(context: ProvisioningContext): Promise<void>;
}

export interface StepResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  manualRequired?: boolean;
}

export type ProgressCallback = (
  pct: number,
  step: string,
  output: string
) => void;

// ============================================
// SagaEngine Class
// ============================================

export class SagaEngine {
  private jobId: string;
  private steps: SagaStep[];
  private onProgress?: ProgressCallback;

  constructor(
    jobId: string,
    steps: SagaStep[],
    onProgress?: ProgressCallback
  ) {
    this.jobId = jobId;
    this.steps = steps;
    this.onProgress = onProgress;
  }

  /**
   * Execute all saga steps in order.
   * Supports idempotent retry — skips already-completed steps.
   * On failure, triggers rollback of all completed steps.
   */
  async execute(
    context: ProvisioningContext
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = await createAdminClient();

    // --- Hard lesson #11/#12 (2026-04-10): Terminal-state guard ---
    // Previously, two execution paths (Vercel execute-step + worker
    // pollProvisioningJobs) could both drive the same saga for the same job
    // and corrupt each other's step rows. Refuse re-entry on any non-pending
    // state so only one path claims the job.
    const { data: currentJob } = await supabase
      .from('provisioning_jobs')
      .select('status')
      .eq('id', this.jobId)
      .single();

    if (currentJob) {
      const status = currentJob.status as string;
      if (['completed', 'failed', 'rolled_back', 'cancelled'].includes(status)) {
        context.log(
          `[saga] Job ${this.jobId} already terminal (${status}), skipping execute()`
        );
        return { success: status === 'completed' };
      }
      if (status === 'in_progress') {
        context.log(
          `[saga] Job ${this.jobId} already in_progress — another executor is running, skipping`
        );
        return { success: false, error: 'already_in_progress' };
      }
    }

    // Load existing step rows (for idempotent retry)
    const existingSteps = await getProvisioningSteps(this.jobId);
    const stepMap = new Map(
      existingSteps.map((s: { step_type: string; id: string; status: string; metadata: Record<string, unknown> }) => [s.step_type, s])
    );

    // Ensure all step rows exist in DB
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      if (!stepMap.has(step.type)) {
        const created = await createProvisioningStep({
          job_id: this.jobId,
          step_type: step.type,
          step_order: i + 1,
          status: 'pending',
          metadata: {},
        });
        stepMap.set(step.type, created);
      }
    }

    // Update job to in_progress — use conditional update so a concurrent
    // executor can't re-enter between the guard above and this line.
    const { data: claimed, error: claimError } = await supabase
      .from('provisioning_jobs')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', this.jobId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError || !claimed) {
      context.log(
        `[saga] Job ${this.jobId} could not be claimed (already in_progress by another executor). Skipping.`
      );
      return { success: false, error: 'claim_failed' };
    }

    const completedStepIndices: number[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const dbStep = stepMap.get(step.type);
      if (!dbStep) continue;

      // Idempotency: skip already completed steps, merge metadata
      if (dbStep.status === 'completed') {
        completedStepIndices.push(i);
        if (dbStep.metadata && typeof dbStep.metadata === 'object') {
          Object.assign(context, dbStep.metadata);
        }
        const pct = this.calculateProgress(completedStepIndices.length);
        this.onProgress?.(pct, step.type, 'Skipped (already completed)');
        continue;
      }

      // Mark step as in_progress
      const startTime = Date.now();
      await updateProvisioningStep(dbStep.id, {
        status: 'in_progress' as StepStatus,
        started_at: new Date().toISOString(),
      });

      await supabase
        .from('provisioning_jobs')
        .update({
          current_step: step.type,
          progress_pct: this.calculateProgress(completedStepIndices.length),
        })
        .eq('id', this.jobId);

      this.onProgress?.(
        this.calculateProgress(completedStepIndices.length),
        step.type,
        `Starting: ${step.name}`
      );

      try {
        const result = await step.execute(context);
        const durationMs = Date.now() - startTime;

        if (result.success) {
          if (result.metadata) {
            Object.assign(context, result.metadata);
          }

          const finalStatus: StepStatus = result.manualRequired
            ? 'manual_required'
            : 'completed';

          await updateProvisioningStep(dbStep.id, {
            status: finalStatus,
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            output: result.output,
            metadata: result.metadata || {},
          });

          completedStepIndices.push(i);
          const pct = this.calculateProgress(completedStepIndices.length);

          await supabase
            .from('provisioning_jobs')
            .update({ progress_pct: pct })
            .eq('id', this.jobId);

          this.onProgress?.(
            pct,
            step.type,
            result.output || `Completed: ${step.name}`
          );

          if (result.manualRequired) {
            context.log(
              `Step ${step.name} requires manual intervention: ${result.output}`
            );
          }
        } else {
          await updateProvisioningStep(dbStep.id, {
            status: 'failed' as StepStatus,
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            error_message: result.error || 'Unknown error',
            output: result.output,
          });

          await supabase
            .from('provisioning_jobs')
            .update({
              status: 'failed',
              error_message: `Step "${step.name}" failed: ${result.error}`,
            })
            .eq('id', this.jobId);

          this.onProgress?.(
            this.calculateProgress(completedStepIndices.length),
            step.type,
            `Failed: ${result.error}`
          );

          await this.rollback(context, completedStepIndices);

          return {
            success: false,
            error: `Step "${step.name}" failed: ${result.error}`,
          };
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;

        await updateProvisioningStep(dbStep.id, {
          status: 'failed' as StepStatus,
          completed_at: new Date().toISOString(),
          duration_ms: durationMs,
          error_message: errorMsg,
        });

        await supabase
          .from('provisioning_jobs')
          .update({
            status: 'failed',
            error_message: `Step "${step.name}" threw: ${errorMsg}`,
          })
          .eq('id', this.jobId);

        this.onProgress?.(
          this.calculateProgress(completedStepIndices.length),
          step.type,
          `Error: ${errorMsg}`
        );

        await this.rollback(context, completedStepIndices);

        return {
          success: false,
          error: `Step "${step.name}" threw: ${errorMsg}`,
        };
      }
    }

    // All steps completed
    await supabase
      .from('provisioning_jobs')
      .update({
        status: 'completed',
        progress_pct: 100,
        completed_at: new Date().toISOString(),
      })
      .eq('id', this.jobId);

    this.onProgress?.(100, 'done', 'All steps completed successfully');
    return { success: true };
  }

  /**
   * Rollback completed steps in reverse order.
   */
  async rollback(
    context: ProvisioningContext,
    completedIndices?: number[]
  ): Promise<void> {
    const supabase = await createAdminClient();

    const indicesToRollback = completedIndices
      ? [...completedIndices]
      : await this.getCompletedIndices();

    indicesToRollback.sort((a, b) => b - a);

    context.log(
      `[Saga] Rolling back ${indicesToRollback.length} completed steps...`
    );

    const existingSteps = await getProvisioningSteps(this.jobId);
    const stepMap = new Map(
      existingSteps.map((s: { step_type: string; id: string }) => [s.step_type, s])
    );

    for (const idx of indicesToRollback) {
      const step = this.steps[idx];
      if (!step) continue;

      const dbStep = stepMap.get(step.type);
      context.log(`[Saga] Rolling back step: ${step.name}`);

      try {
        await step.compensate(context);
        context.log(`[Saga] Rollback of "${step.name}" succeeded`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        context.log(
          `[Saga] Rollback of "${step.name}" failed (non-fatal): ${msg}`
        );
      }

      if (dbStep) {
        await updateProvisioningStep(dbStep.id, {
          status: 'skipped' as StepStatus,
        });
      }
    }

    await supabase
      .from('provisioning_jobs')
      .update({ status: 'rolled_back' })
      .eq('id', this.jobId);

    context.log('[Saga] Rollback complete');
  }

  /**
   * Weighted progress by estimatedDurationMs.
   */
  private calculateProgress(completedCount: number): number {
    if (this.steps.length === 0) return 100;

    const totalWeight = this.steps.reduce(
      (sum, s) => sum + s.estimatedDurationMs,
      0
    );

    if (totalWeight === 0) {
      return Math.round((completedCount / this.steps.length) * 100);
    }

    let completedWeight = 0;
    for (let i = 0; i < completedCount && i < this.steps.length; i++) {
      completedWeight += this.steps[i].estimatedDurationMs;
    }

    return Math.min(99, Math.round((completedWeight / totalWeight) * 100));
  }

  private async getCompletedIndices(): Promise<number[]> {
    const existingSteps = await getProvisioningSteps(this.jobId);
    const completedTypes = new Set(
      existingSteps
        .filter((s: { status: string }) => s.status === 'completed' || s.status === 'manual_required')
        .map((s: { step_type: string }) => s.step_type)
    );

    const indices: number[] = [];
    for (let i = 0; i < this.steps.length; i++) {
      if (completedTypes.has(this.steps[i].type)) {
        indices.push(i);
      }
    }
    return indices;
  }
}
