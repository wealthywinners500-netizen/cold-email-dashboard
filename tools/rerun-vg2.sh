#!/usr/bin/env bash
#
# tools/rerun-vg2.sh — manual fallback for the VG2 fcrdns retry exhaustion
# class. Re-invokes verification_gate_2 for an existing `provisioning_jobs`
# row by resetting that step to 'pending' and the job to 'in_progress'. The
# worker's pollAdvanceableJobs tick will atomically claim the step and
# dispatch to the saga engine via `boss.send('provision-step', …)` — same
# canonical path the wizard uses.
#
# Use after the in-saga fcrdns retry-with-backoff has exhausted (3 attempts,
# ~20 min). Run 30 min between re-invocations to give Linode's authoritative
# `.ip.linodeusercontent.com` zone time to propagate further.
#
# Usage:
#   DATABASE_URL=postgres://… ./tools/rerun-vg2.sh <jobId>
#
# Typically run from the worker VPS (/opt/dashboard-worker/) where the env is
# already configured. The worker must be up (pm2/systemd) for pollAdvanceableJobs
# to pick up the re-pended step.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <jobId>" >&2
  exit 1
fi

JOB_ID="$1"
: "${DATABASE_URL:?DATABASE_URL must be set (export or run on worker VPS with /opt/dashboard-worker/.env loaded)}"

psql "$DATABASE_URL" <<SQL
BEGIN;

UPDATE provisioning_steps
   SET status = 'pending',
       started_at = NULL,
       completed_at = NULL,
       duration_ms = NULL,
       error_message = NULL,
       metadata = jsonb_build_object(
         'reset_by', 'tools/rerun-vg2.sh',
         'reset_at', now()
       )
 WHERE job_id = '${JOB_ID}'
   AND step_type = 'verification_gate_2';

UPDATE provisioning_jobs
   SET status = 'in_progress',
       error_message = NULL,
       completed_at = NULL
 WHERE id = '${JOB_ID}'
   AND status = 'failed';

COMMIT;

\\echo --- step status after reset ---
SELECT step_type, status, started_at
  FROM provisioning_steps
 WHERE job_id = '${JOB_ID}'
   AND step_type = 'verification_gate_2';

\\echo --- job status after reset ---
SELECT id, status, error_message
  FROM provisioning_jobs
 WHERE id = '${JOB_ID}';
SQL

echo
echo "verification_gate_2 reset to pending for job ${JOB_ID}."
echo "Worker pollAdvanceableJobs (10s tick) will claim and dispatch within ~30s."
echo "Tail the worker log for progress:   pm2 logs worker --lines 50"
