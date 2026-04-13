import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import type { StepType } from "@/lib/provisioning/types";

export const dynamic = "force-dynamic";

/**
 * Verify HMAC-SHA256 signature from the worker.
 * Worker signs: HMAC(WORKER_CALLBACK_SECRET, `${jobId}:${stepType}:${timestamp}`)
 * Header: X-Worker-Signature: <hex digest>
 * Header: X-Worker-Timestamp: <unix seconds>
 */
function verifyWorkerSignature(
  jobId: string,
  stepType: string,
  timestamp: string,
  signature: string
): boolean {
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!secret) {
    console.error("[WorkerCallback] WORKER_CALLBACK_SECRET not configured");
    return false;
  }

  // Reject timestamps older than 5 minutes (replay protection)
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    console.error(`[WorkerCallback] Timestamp too old: ${ts} vs ${now}`);
    return false;
  }

  const payload = `${jobId}:${stepType}:${timestamp}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/provisioning/[jobId]/worker-callback
 *
 * Called by the worker VPS after completing (or failing) an SSH step.
 * Authenticated via HMAC signature — no Clerk auth required.
 *
 * Body: {
 *   stepType: StepType,
 *   status: "completed" | "failed",
 *   output?: string,
 *   error_message?: string,
 *   duration_ms?: number,
 *   metadata?: Record<string, unknown>,
 * }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // Parse body first to get stepType for signature verification
    const body = await req.json();
    const {
      stepType,
      status,
      output,
      error_message,
      duration_ms,
      metadata,
    } = body as {
      stepType: StepType;
      status: "completed" | "failed";
      output?: string;
      error_message?: string;
      duration_ms?: number;
      metadata?: Record<string, unknown>;
    };

    if (!stepType || !status) {
      return NextResponse.json(
        { error: "Missing required fields: stepType, status" },
        { status: 400 }
      );
    }

    // Verify HMAC signature
    const signature = req.headers.get("x-worker-signature") || "";
    const timestamp = req.headers.get("x-worker-timestamp") || "";

    if (!verifyWorkerSignature(jobId, stepType, timestamp, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const supabase = await createAdminClient();

    // Load the step row
    const { data: step, error: stepError } = await supabase
      .from("provisioning_steps")
      .select("*")
      .eq("job_id", jobId)
      .eq("step_type", stepType)
      .single();

    if (stepError || !step) {
      return NextResponse.json(
        { error: `Step ${stepType} not found for job ${jobId}` },
        { status: 404 }
      );
    }

    // Update step with worker result
    const now = new Date().toISOString();

    if (status === "completed") {
      await supabase
        .from("provisioning_steps")
        .update({
          status: "completed",
          completed_at: now,
          duration_ms: duration_ms || null,
          output: output || `Worker completed ${stepType}`,
          metadata: { ...(step.metadata as Record<string, unknown>), ...metadata, worker_completed: true },
        })
        .eq("id", step.id);
    } else {
      // Failed
      await supabase
        .from("provisioning_steps")
        .update({
          status: "failed",
          completed_at: now,
          duration_ms: duration_ms || null,
          error_message: error_message || `Worker step ${stepType} failed`,
          output: output || null,
        })
        .eq("id", step.id);

      // Mark job as failed
      await supabase
        .from("provisioning_jobs")
        .update({
          status: "failed",
          error_message: `Worker step "${stepType}" failed: ${error_message || "unknown error"}`,
        })
        .eq("id", jobId);

      return NextResponse.json({
        jobId,
        stepType,
        status: "failed",
        message: "Step failure recorded",
      });
    }

    // Recalculate progress after successful completion
    const { data: allSteps } = await supabase
      .from("provisioning_steps")
      .select("id, status, step_type")
      .eq("job_id", jobId)
      .order("step_order", { ascending: true });

    const completedCount = (allSteps || []).filter(
      (s: Record<string, unknown>) => s.status === "completed"
    ).length;
    const totalSteps = (allSteps || []).length;
    const progressPct = Math.round((completedCount / totalSteps) * 100);

    // Find next pending step to update current_step
    const nextPending = (allSteps || []).find(
      (s: Record<string, unknown>) => s.status === "pending"
    );

    await supabase
      .from("provisioning_jobs")
      .update({
        progress_pct: progressPct,
        current_step: nextPending ? (nextPending as Record<string, unknown>).step_type : stepType,
      })
      .eq("id", jobId);

    // Check if all steps are complete
    const isAllComplete = completedCount === totalSteps;

    if (isAllComplete) {
      // Get server IPs from create_vps step
      const { data: createVpsStep } = await supabase
        .from("provisioning_steps")
        .select("metadata")
        .eq("job_id", jobId)
        .eq("step_type", "create_vps")
        .single();

      const { data: jobRow } = await supabase
        .from("provisioning_jobs")
        .select("org_id, ns_domain, server1_ip, server2_ip")
        .eq("id", jobId)
        .single();

      const vpsMetadata = (createVpsStep?.metadata as Record<string, unknown>) || {};
      const server1IP = (vpsMetadata.server1IP as string) || jobRow?.server1_ip || "";
      const server2IP = (vpsMetadata.server2IP as string) || jobRow?.server2_ip || "";

      if (jobRow && server1IP && server2IP) {
        // Hard Lesson #50 + #62 parity (2026-04-11): this insert was using
        // the LEGACY server1_ip/server2_ip/server1_hostname/server2_hostname
        // column names that don't exist on the server_pairs table. The
        // execute-step finalization block was patched in commit 506a2a8
        // but THIS callback path was missed — until now verification_gate
        // ran serverless so this branch was unreachable, but Test #15 moves
        // verification_gate to the worker, so the worker callback now hits
        // this finalization branch on the last step. Use the same
        // pair_number-from-MAX+1 logic and the same s1_/s2_ column names
        // and the same provisioning_job_id FK.
        const { data: maxPairRow } = await supabase
          .from("server_pairs")
          .select("pair_number")
          .eq("org_id", jobRow.org_id)
          .order("pair_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextPairNumber =
          ((maxPairRow?.pair_number as number) || 0) + 1;

        const { data: serverPair, error: serverPairError } = await supabase
          .from("server_pairs")
          .insert({
            org_id: jobRow.org_id,
            pair_number: nextPairNumber,
            ns_domain: jobRow.ns_domain,
            s1_ip: server1IP,
            s1_hostname: `mail1.${jobRow.ns_domain}`,
            s2_ip: server2IP,
            s2_hostname: `mail2.${jobRow.ns_domain}`,
            status: "complete",
            provisioning_job_id: jobId,
          })
          .select()
          .single();

        if (serverPairError || !serverPair) {
          // Don't silently swallow — the whole point of Hard Lesson #50
          // was that this row HAS to land or downstream code can never
          // hop job → pair.
          await supabase
            .from("provisioning_jobs")
            .update({
              status: "failed",
              error_message: `Final server_pairs insert failed: ${
                serverPairError?.message || "unknown"
              }`,
            })
            .eq("id", jobId);

          return NextResponse.json(
            {
              jobId,
              stepType,
              status: "failed",
              error: `server_pairs insert failed: ${serverPairError?.message}`,
            },
            { status: 500 }
          );
        }

        // Create email_accounts from setup_mail_domains metadata
        const { data: mailStep } = await supabase
          .from("provisioning_steps")
          .select("metadata")
          .eq("job_id", jobId)
          .eq("step_type", "setup_mail_domains")
          .single();

        const mailMeta = (mailStep?.metadata as Record<string, unknown>) || {};
        const allAccounts = mailMeta.allAccountsCreated as Record<string, string[]> | undefined;
        const s1Domains = (mailMeta.server1Domains as string[]) || [];

        if (allAccounts && Object.keys(allAccounts).length > 0) {
          // Read mail password from ssh_credentials
          let mailPassword = "";
          try {
            const { data: sshCreds } = await supabase
              .from("ssh_credentials")
              .select("password_encrypted")
              .eq("provisioning_job_id", jobId)
              .limit(1)
              .maybeSingle();

            if (sshCreds?.password_encrypted) {
              const { decrypt } = await import("@/lib/provisioning/encryption");
              mailPassword = decrypt(sshCreds.password_encrypted);
            }
          } catch (decryptErr) {
            console.error(`[WorkerCallback] Failed to decrypt mail password: ${decryptErr}`);
          }

          const accountRows = [];
          for (const [domain, names] of Object.entries(allAccounts)) {
            const isS1 = s1Domains.includes(domain);
            const serverIP = isS1 ? server1IP : server2IP;
            for (const name of names) {
              const email = `${name}@${domain}`;
              accountRows.push({
                org_id: jobRow.org_id,
                email,
                display_name: name
                  .split(".")
                  .map((n: string) => n.charAt(0).toUpperCase() + n.slice(1))
                  .join(" "),
                server_pair_id: serverPair.id,
                smtp_host: serverIP,
                smtp_port: 587,
                smtp_user: email,
                smtp_pass: mailPassword,
                imap_host: serverIP,
                imap_port: 993,
                status: "active",
                daily_send_limit: 50,
              });
            }
          }

          if (accountRows.length > 0) {
            const { error: emailInsertErr } = await supabase
              .from("email_accounts")
              .insert(accountRows);
            if (emailInsertErr) {
              console.error(
                `[WorkerCallback] email_accounts insert failed: ${emailInsertErr.message}`
              );
            } else {
              console.log(
                `[WorkerCallback] Inserted ${accountRows.length} email accounts for pair ${serverPair.id}`
              );
            }
          }
        }

        // Mark job completed
        await supabase
          .from("provisioning_jobs")
          .update({
            status: "completed",
            progress_pct: 100,
            completed_at: new Date().toISOString(),
            server_pair_id: serverPair.id,
            server1_ip: server1IP,
            server2_ip: server2IP,
          })
          .eq("id", jobId);
      }
    }

    return NextResponse.json({
      jobId,
      stepType,
      status: "accepted",
      progress_pct: progressPct,
      allComplete: isAllComplete,
    });
  } catch (err) {
    console.error("[WorkerCallback] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
