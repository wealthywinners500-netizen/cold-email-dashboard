import { createClient } from "@supabase/supabase-js";
import { getBoss } from "../../lib/email/campaign-queue";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    }
  );
}

export async function handleQueueSequenceSteps() {
  const supabase = getSupabase();
  const boss = getBoss();

  try {
    // Query sequence states ready to send
    const { data: states, error: queryError } = await supabase
      .from("lead_sequence_state")
      .select(
        "id, recipient_id, sequence_id, current_step, campaign_id, org_id"
      )
      .eq("status", "active")
      .lte("next_send_at", new Date().toISOString())
      .limit(10000);

    if (queryError) {
      console.error("[queue-sequence-steps] Query error:", queryError);
      // Log alert - skip since we have no org context from failed query
      // Cannot safely log system_alerts without org_id, which requires successful query
      throw new Error(`Query failed: ${queryError.message}`);
    }

    if (!states || states.length === 0) {
      console.log(
        "[queue-sequence-steps] No sequences ready to send at this time"
      );
      return;
    }

    // Queue each step
    let queuedCount = 0;
    const queueErrors: Array<{ stateId: string; error: string }> = [];

    for (const state of states) {
      try {
        await boss.send(
          "process-sequence-step",
          {
            stateId: state.id,
            recipientId: state.recipient_id,
            sequenceId: state.sequence_id,
            stepNumber: state.current_step,
            campaignId: state.campaign_id,
            orgId: state.org_id,
          },
          {
            priority: 7,
            retryLimit: 3,
            retryDelay: 60,
            retryBackoff: true,
          }
        );
        queuedCount++;
      } catch (jobError) {
        console.error(
          `[queue-sequence-steps] Failed to queue state ${state.id}:`,
          jobError
        );
        queueErrors.push({
          stateId: state.id,
          error: jobError instanceof Error ? jobError.message : String(jobError),
        });
      }
    }

    console.log(
      `[queue-sequence-steps] Queued ${queuedCount} sequence steps (${queueErrors.length} failures)`
    );

    // Log alert if there were partial failures
    if (queueErrors.length > 0 && queueErrors.length < states.length) {
      const { error: alertError } = await supabase
        .from("system_alerts")
        .insert({
          alert_type: "sequence_queue_partial_failure",
          severity: "warning",
          title: `Partial failure queuing sequence steps (${queueErrors.length}/${states.length})`,
          details: {
            failedStates: queueErrors,
            totalAttempted: states.length,
            successCount: queuedCount,
          },
          org_id: states[0]?.org_id,
        });

      if (alertError) {
        console.error("[queue-sequence-steps] Alert log error:", alertError);
      }
    }

    // Log alert if all failed
    if (queueErrors.length === states.length && states.length > 0) {
      const { error: alertError } = await supabase
        .from("system_alerts")
        .insert({
          alert_type: "sequence_queue_failure",
          severity: "critical",
          title: "Failed to queue any sequence steps",
          details: {
            failedStates: queueErrors,
            totalAttempted: states.length,
          },
          org_id: states[0]?.org_id,
        });

      if (alertError) {
        console.error("[queue-sequence-steps] Alert log error:", alertError);
      }

      throw new Error(
        `Failed to queue all ${states.length} sequence steps: ${queueErrors.map((e) => e.error).join("; ")}`
      );
    }
  } catch (error) {
    console.error("[queue-sequence-steps] Handler error:", error);
    throw error;
  }
}
