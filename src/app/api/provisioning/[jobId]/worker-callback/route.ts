import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { decrypt, encrypt } from "@/lib/provisioning/encryption";
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

    // STALE-CALLBACK REJECT (HL #94) — a zombie retry's failure must not overwrite
    // a successful completion. Drop the callback silently, 200 OK so pg-boss acks.
    if (step.status === "completed" && status === "failed") {
      console.warn(`[WorkerCallback] Dropping stale failed callback for completed step`, {
        jobId, stepType, stepId: step.id,
        completed_at: step.completed_at,
      });
      return NextResponse.json({ accepted: false, reason: "stale_callback" }, { status: 200 });
    }

    // Symmetric: if step is already 'failed' and callback is 'completed', also drop.
    // A second attempt might succeed but we've already closed the saga on failure.
    if (step.status === "failed" && status === "completed") {
      console.warn(`[WorkerCallback] Dropping stale completed callback for failed step`, {
        jobId, stepType, stepId: step.id,
      });
      return NextResponse.json({ accepted: false, reason: "stale_callback" }, { status: 200 });
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
        .select("org_id, ns_domain, server1_ip, server2_ip, sending_domains, mail_accounts_per_domain")
        .eq("id", jobId)
        .single();

      const vpsMetadata = (createVpsStep?.metadata as Record<string, unknown>) || {};
      const server1IP = (vpsMetadata.server1IP as string) || jobRow?.server1_ip || "";
      const server2IP = (vpsMetadata.server2IP as string) || jobRow?.server2_ip || "";

      if (jobRow && server1IP && server2IP) {
        // Hard Lesson #94: provisioning_jobs.org_id stores organizations.id
        // (the internal DB PK), NOT the Clerk org ID. getInternalOrgId() in
        // the POST handler returns organizations.id, so jobRow.org_id IS the
        // DB org ID already — no lookup needed. The old code tried to match
        // it against clerk_org_id which failed when the two diverged.
        const dbOrgId = jobRow.org_id;

        // HL #116: pair_number is NOT NULL with UNIQUE(org_id, pair_number).
        // Must compute next pair_number before insert.
        const { data: maxPairRow } = await supabase
          .from("server_pairs")
          .select("pair_number")
          .eq("org_id", dbOrgId)
          .order("pair_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextPairNumber = ((maxPairRow?.pair_number as number) || 0) + 1;

        // Create server_pair record (column names: s1_ip, s2_ip, s1_hostname, s2_hostname)
        const { data: serverPair, error: pairError } = await supabase
          .from("server_pairs")
          .insert({
            org_id: dbOrgId,
            pair_number: nextPairNumber,
            ns_domain: jobRow.ns_domain,
            s1_ip: server1IP,
            s2_ip: server2IP,
            s1_hostname: `mail1.${jobRow.ns_domain}`,
            s2_hostname: `mail2.${jobRow.ns_domain}`,
            status: "active",
            provisioning_job_id: jobId,
          })
          .select()
          .single();

        // HL #116: server_pair creation failure must be FATAL —
        // do NOT mark job as "completed" with server_pair_id=NULL.
        if (pairError) {
          console.error(`[WorkerCallback] server_pairs insert FAILED: ${pairError.message}`);
          await supabase
            .from("provisioning_jobs")
            .update({
              status: "failed",
              error_message: `Completion handler failed: server_pairs insert error: ${pairError.message}`,
            })
            .eq("id", jobId);
          return NextResponse.json({
            jobId,
            stepType,
            status: "failed",
            message: `server_pairs insert failed: ${pairError.message}`,
          }, { status: 500 });
        }

        // Create email accounts from setup_mail_domains step metadata
        let accountsCreated = 0;
        let accountsFailed = 0;
        if (serverPair) {
          const { data: mailStep } = await supabase
            .from("provisioning_steps")
            .select("metadata")
            .eq("job_id", jobId)
            .eq("step_type", "setup_mail_domains")
            .single();

          const mailMeta = (mailStep?.metadata as Record<string, unknown>) || {};
          const allAccountsCreated = mailMeta.allAccountsCreated as Record<string, string[]> | undefined;
          const server1Domains = (mailMeta.server1Domains as string[]) || [];

          // Get server password for smtp_pass (HL #132: smtp_user + smtp_pass are NOT NULL)
          const { data: vpsStep } = await supabase
            .from("provisioning_steps")
            .select("metadata")
            .eq("job_id", jobId)
            .eq("step_type", "create_vps")
            .single();
          const vpsMeta = (vpsStep?.metadata as Record<string, unknown>) || {};
          const encryptedPassword = vpsMeta.serverPassword_encrypted as string | undefined;
          const serverPassword = encryptedPassword ? decrypt(encryptedPassword) : "";

          if (allAccountsCreated) {
            const accountRows = [];
            for (const [domain, names] of Object.entries(allAccountsCreated)) {
              const isServer1Domain = server1Domains.includes(domain);
              const smtpHost = isServer1Domain ? server1IP : server2IP;
              for (const name of names) {
                accountRows.push({
                  org_id: dbOrgId,
                  email: `${name}@${domain}`,
                  display_name: name
                    .split(".")
                    .map((n: string) => n.charAt(0).toUpperCase() + n.slice(1))
                    .join(" "),
                  server_pair_id: serverPair.id,
                  smtp_host: smtpHost,
                  smtp_port: 587,
                  smtp_secure: false,
                  smtp_user: `${name}@${domain}`,
                  smtp_pass: serverPassword,
                  imap_host: smtpHost,
                  imap_port: 993,
                  status: "active",
                  daily_send_limit: 50,
                  sends_today: 0,
                });
              }
            }
            if (accountRows.length > 0) {
              const { error: accountError, count } = await supabase
                .from("email_accounts")
                .insert(accountRows);
              if (accountError) {
                console.error(`[WorkerCallback] email_accounts insert failed: ${accountError.message}`);
                accountsFailed = accountRows.length;
              } else {
                accountsCreated = accountRows.length;
              }
            }
          }

          // Populate sending_domains table for domain-in-use filtering.
          // Attach primary_server_id ('s1' | 's2') from setup_mail_domains metadata
          // so downstream verification (VG2 ssl_cert_existence, https_connectivity)
          // probes only the owning server. HL #R1 (Session 04b).
          const sendingDomainsList = jobRow.sending_domains as string[] | undefined;
          if (sendingDomainsList && sendingDomainsList.length > 0) {
            const server1DomainsSet = new Set(server1Domains);
            const sdRows = sendingDomainsList.map((domain: string) => ({
              pair_id: serverPair.id,
              domain,
              primary_server_id: server1DomainsSet.has(domain) ? 's1' : 's2',
            }));
            const { error: sdError } = await supabase
              .from("sending_domains")
              .insert(sdRows);
            if (sdError) {
              console.error(`[WorkerCallback] sending_domains insert failed: ${sdError.message}`);
            }
          }

          // Create SSH credentials
          if (encryptedPassword) {
            for (const [ip, hostname, label] of [
              [server1IP, `mail1.${jobRow.ns_domain}`, "S1"],
              [server2IP, `mail2.${jobRow.ns_domain}`, "S2"],
            ]) {
              const { data: credRow, error: credError } = await supabase
                .from("ssh_credentials")
                .insert({
                  org_id: dbOrgId,
                  server_ip: ip,
                  hostname,
                  username: "root",
                  password_encrypted: encryptedPassword,
                  port: 22,
                  provisioning_job_id: jobId,
                })
                .select("id")
                .single();

              if (credError) {
                console.error(`[CRITICAL] ssh_credentials insert FAILED for ${label} at ${ip} (job ${jobId}): ${JSON.stringify(credError)}`);
              } else {
                console.log(`[WorkerCallback] SSH credentials saved: id=${credRow.id} for ${label} at ${ip} (job ${jobId})`);
              }
            }
          } else {
            console.error(`[CRITICAL] No encrypted password available for ssh_credentials insert (job ${jobId})`);
          }

          // Update server_pair total_accounts
          if (accountsCreated > 0) {
            await supabase
              .from("server_pairs")
              .update({ total_accounts: accountsCreated })
              .eq("id", serverPair.id);
          }
        }

        // Mark job completed (include account creation status in metadata)
        await supabase
          .from("provisioning_jobs")
          .update({
            status: "completed",
            progress_pct: 100,
            completed_at: new Date().toISOString(),
            server_pair_id: serverPair?.id || null,
            server1_ip: server1IP,
            server2_ip: server2IP,
            ...(accountsFailed > 0 ? {
              error_message: `Completed with ${accountsFailed} email account insert failures`,
            } : {}),
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
