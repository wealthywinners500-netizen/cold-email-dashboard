// ============================================
// B15-5: POST /api/provisioning/[jobId]/verify
// Re-run verification gate on a provisioning job
// ============================================

import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { DNSVerifier } from '@/lib/provisioning/verification';
import type { ProvisioningJobRow } from '@/lib/provisioning/types';

export const dynamic = 'force-dynamic';

async function getInternalOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .single();
  return data?.id || null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createAdminClient();

    // Load job with org_id isolation
    const { data: job, error: jobError } = await supabase
      .from('provisioning_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const provJob = job as ProvisioningJobRow;

    // Must have IPs to run verification
    if (!provJob.server1_ip || !provJob.server2_ip) {
      return NextResponse.json(
        { error: 'Job does not have server IPs — cannot run verification' },
        { status: 400 }
      );
    }

    // Run full health check
    const verifier = new DNSVerifier();
    const report = await verifier.fullHealthCheck({
      server1IP: provJob.server1_ip,
      server2IP: provJob.server2_ip,
      nsDomain: provJob.ns_domain,
      sendingDomains: provJob.sending_domains,
    });

    // Update verification_gate step if it exists
    const { data: steps } = await supabase
      .from('provisioning_steps')
      .select('*')
      .eq('job_id', jobId)
      .eq('step_type', 'verification_gate');

    if (steps && steps.length > 0) {
      const step = steps[0];
      await supabase
        .from('provisioning_steps')
        .update({
          status: report.overall === 'PASS' ? 'completed' : 'failed',
          output: JSON.stringify(report.summary),
          metadata: { ...step.metadata, health_report: report },
          completed_at: new Date().toISOString(),
        })
        .eq('id', step.id);
    }

    // Store report in job config
    await supabase
      .from('provisioning_jobs')
      .update({
        config: {
          ...provJob.config,
          last_health_report: report,
          last_health_check_at: report.timestamp,
        },
      })
      .eq('id', jobId);

    return NextResponse.json(report);
  } catch (error) {
    console.error('[Verify] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
