## VERDICT: BLOCKED — saga failed at Step 1 (create_vps): Linode account service-limit reached

**Date (UTC):** 2026-04-22
**Monitor window:** 2026-04-22T12:55:04Z … 2026-04-22T13:07:00Z
**Git HEAD at monitor start:** `7b64ad3` (`gate0: HL #107 domain.sh patch + SOA serial-format verification (#18)`)
**Intended run:** First end-to-end saga exercise of the HL #107 SOA-fix chain (Step 2 `patchDomainSHSOATemplate`, un-swallowed `v-change-dns-domain-soa`, Check 5 `validateSOASerialFormat`, auto-fix `fix_soa_serial_format`).
**Actual outcome:** Saga halted at Step 1. **SOA fix chain was never reached.**

---

### 1. Intended P15 pair (from `provisioning_jobs.id = 13bb6949-51fb-4fab-aa6a-e53962712dad`)

| Field | Value |
|---|---|
| Job id | `13bb6949-51fb-4fab-aa6a-e53962712dad` |
| Org id | `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` |
| NS domain | `camire.info` |
| Sending domains (10) | carosi.info, cerino.info, cirone.info, lamore.info, lavine.info, luvena.info, malino.info, morice.info, renita.info, semira.info |
| Provider | `linode` (region=`us-central`, secondaryRegion=`us-southeast`, size=`small`) |
| Admin email | `admin@camire.info` |
| server_pair_id | **null** (never created) |
| s1_ip / s2_ip | **null / null** (never allocated) |
| Status | `failed` |
| Created | 2026-04-22T12:55:04.707Z |
| Started | 2026-04-22T12:55:07.209Z |

---

### 2. Saga step log (from `provisioning_steps` WHERE job_id = 13bb6949)

| # | Step | Status | Duration | Notes |
|---|---|---|---|---|
| 1 | `create_vps` | **failed** | 5.577 s | See §3 — Linode API returned HTTP 400 |
| 2 | `install_hestiacp` | pending | — | not reached; HL #107 `patchDomainSHSOATemplate` lives here |
| 3 | `configure_registrar` | pending | — | not reached |
| 4 | `await_dns_propagation` | pending | — | not reached |
| 5 | `setup_dns_zones` | pending | — | not reached |
| 6 | `set_ptr` | pending | — | not reached |
| 7 | `setup_mail_domains` | pending | — | not reached |
| 8 | `await_s2_dns` | pending | — | not reached |
| 9 | `security_hardening` | pending | — | not reached |
| 10 | `verification_gate` | pending | — | Check 5 (`validateSOASerialFormat`) not reached |
| 11 | `auto_fix` | pending | — | `fix_soa_serial_format` dispatcher not reached |
| 12 | `verification_gate_2` | pending | — | not reached |

---

### 3. Root cause

`src/worker/handlers/provision-step.ts` `handleCreateVpsStep` called the Linode API to create `mail1-camire-info`. Linode rejected with:

```
HTTP 400 from linode: {"errors": [{"reason": "You've reached a limit for the number of active services on your account. Please contact Support to request an increase and provide the total number of services you may need."}]}
```

The handler surfaced the error correctly — [`provision-step.ts:485-496`](src/worker/handlers/provision-step.ts:485) wraps the whole create path in a single try/catch that posts `status: 'failed'` back to the callback with the verbatim provider message. There is **no bug in the saga and no regression in the SOA-fix chain**. The failure is at the provider account layer.

Evidence that the saga handled this correctly and the error shape is genuine Linode:
- Existing active Linode pairs: **P13** (`launta.info`, 69.164.213.37/50.116.14.26), **P14** (`savini.info`, 45.56.75.67/45.79.213.21), plus earlier Linode-provisioned pairs. Each pair consumes 2 Linode Instance services — so active Linode Instances for this account include at least P12+P13+P14 Linodes (6+ VPSes), on top of the worker VPS (`200.234.226.226`) and any other services on the account.
- The fetch took 5.577 s — consistent with a provider-side rejection, not a local timeout. `MAX_IP_REROLL_ATTEMPTS = 5` at [`provision-step.ts:325`](src/worker/handlers/provision-step.ts:325) is reachable only **after** both servers report `active`; that code path was never entered for P15.

---

### 4. Gate A–E pass/fail table (from monitor prompt)

| Gate | Description | Status |
|---|---|---|
| A | `timedatectl` returns `Etc/UTC` on S1+S2 before Step 2 | **N/A — Step 2 not reached** |
| B | `PATCHED_BY_PROVISIONING_SAGA` marker count = 1 in `/usr/local/hestia/data/templates/dns/domain.sh` on both | **N/A — Step 2 not reached** |
| C | `v-change-dns-domain-soa` exit codes surfaced (no `.catch(() => {})` swallow) | **N/A — not invoked** |
| D | Check 5 / `validateSOASerialFormat` ran against every zone | **N/A — Step 10 not reached** |
| E | `fix_soa_serial_format` dispatcher conditional — fired for needy zones or no-op on clean first pass | **N/A — Step 11 not reached** |

---

### 5. E2E GREEN validation (Phase 3 per monitor prompt)

All sub-checks **skipped** because the saga produced no servers:

| Check | Description | Status |
|---|---|---|
| 3a | SSH parity (`timedatectl`, domain.sh marker, `hostnamectl`) on S1+S2 | SKIPPED (no S1/S2) |
| 3b | HestiaCP zone list on S1 | SKIPPED |
| 3c | AXFR parity `dig @S1 == dig @S2` per zone | SKIPPED |
| 3d | `tools/verify-zone.sh` FAIL=0 per zone | SKIPPED |
| 3e | SOA serial `yyyymmdd <= today_UTC` per zone | SKIPPED |
| 3f | MXToolbox Domain Health 0E/0W on 11 zones | SKIPPED |
| 3g | Mail-tester 10/10 on 3 sampled sending domains | SKIPPED |

---

### 6. Per-zone table

N/A — no zones were created. The 10 intended sending domains (see §1) remain at the registrar with no BIND presence on any Linode pair.

---

### 7. Auto-fix firings

None. `runAutoFixes` never ran because the saga halted before Step 10.

---

### 8. Residual risks / unverified

Because the saga did not reach the SOA-bearing steps, **the HL #107 fix chain remains unproven end-to-end on a live run.** Specifically:

1. `patchDomainSHSOATemplate` fail-loud (returns `{success:false}` on patch failure) — verified only via the existing test `soa-serial-format.test.ts` in `test:gate0`, not against a fresh HestiaCP install.
2. `v-change-dns-domain-soa` error surfacing at [`hestia-scripts.ts:298-320`](src/lib/provisioning/hestia-scripts.ts:298) — prior behavior (silent `.catch(() => {})`) is fixed in code, but not exercised on a live 2026-04-22 install.
3. Check 5's `validateSOASerialFormat` dispatching `fix_soa_serial_format` (vs `fix_soa`) when the serial's yyyymmdd is today-UTC or future — pure-helper unit tests pass; saga routing not yet run live.
4. `fix_soa_serial_format` direct-edit of `/home/admin/conf/dns/<z>.db` + metadata + `rndc retransfer` on peer — operationally validated on the P14 parity pass (2026-04-22, `reports/2026-04-22-p14-parity-complete.md`), but **not on a green saga from Step 1**.

P14 operational-backfill parity (0/0 on all 11 zones via MXToolbox UI) stands per the prompt's instruction; this report does not alter it.

---

### 9. Remediation (what Dean needs to do before retrying)

**Hard blocker — Linode account service quota.** Two independent remediation paths:

1. **Contact Linode Support and request a service-count increase** (template: "Request service-count limit raised to support production cold-email provisioning — currently provisioning pairs P1-P14, need headroom for P15-P40"). This is the path the error message itself recommends.
2. **Free up active services** on the Linode account by deleting unused Instances (especially any leftover test/re-roll stragglers from prior saga runs that didn't get cleaned up by the compensation path at [`pair-provisioning-saga.ts:239-260`](src/lib/provisioning/pair-provisioning-saga.ts:239)).

After Linode unblocks, Dean can re-click **Provision P15** from the dashboard. The job config is already captured in `provisioning_jobs.id = 13bb6949` — but the job is in `failed` state and cannot be resumed. A fresh click will:
- create a new `provisioning_jobs` row (and fresh UUID),
- re-run Step 1 with the same ns_domain / sending_domains config if Dean clicks the same form (or with adjusted config if edited),
- proceed through Step 2 where **HL #107 `patchDomainSHSOATemplate` is the first thing that runs after HestiaCP install** on both servers, materially derisking the SOA-warning path that bit P14 on its operational backfill.

---

### 10. What changed, what's next (summary)

- **Changed:** nothing on disk — the failed job is idempotent (no VPS created, no DNS written, no credentials persisted). No compensation work required.
- **Next:** Dean resolves the Linode service-count limit → re-clicks Provision P15 → I (or this monitor prompt rerun) picks up the new job id and re-starts Phase 1.
- **Not changed by this run:** P14 (savini.info) remains 0/0 on all 11 zones per the prior backfill report.

**Dean, do NOT click P16 — see report. Resolve the Linode service-count limit, then re-click Provision P15. The SOA fix chain is in code (git HEAD 7b64ad3) and ready to run — it just hasn't had a chance to execute yet.**
