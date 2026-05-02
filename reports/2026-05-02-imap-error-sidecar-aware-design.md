# CC #5b1.5 — handleImapError sidecar-aware + diagnostic context capture

**Phase 0 design doc.** 2026-05-02. V9 → CC. Worktree: `dreamy-lamarr-c74ae9`. Branch (will rename for PR): `feat/imap-error-sidecar-aware-2026-05-02`. Base: `main` @ `961a395`.

---

## 1. Why this session

CC #5b2's flag-flip HALT (2026-05-02 keen-taussig-88e60b/reports) named "IMAP AUTH failure" as the cause of the 100 `system_alerts.alert_type='imap_error'` rows. V9's panel-side dovecot.log forensic invalidated that diagnosis — every May-01 14:20–15:30 worker-IP IMAP session shows `Login: user=<...>, method=PLAIN, TLS` succeeding. The 100 alerts ALL carry `details.error="Command failed"`, which is imapflow's generic post-AUTH command-failure message — falling through `error-handler.ts:190-200`'s GENERIC catch-all branch and cascade-disabling at `consecutive_failures >= 3`.

Two scoped, code-only changes solve this:

1. **Sidecar-aware suppress in the GENERIC catch-all branch.** Reads `USE_PANEL_SIDECAR_ACCOUNT_IDS` (CC #5b1's env var). Sidecar-flagged accounts hitting generic errors ≥3× create a `severity='warning'` alert with `details.sidecar_protected=true`, but DO NOT set `status='disabled'`. AUTH-failure / Mailbox-not-found / connection-lost branches stay as-is for sidecar accounts (real errors should still cascade).
2. **Capture imapflow error context.** New optional `context?: ImapErrorContext` parameter spreads imapflow fields (`responseStatus`, `responseText`, `executedCommand`, `code`, `cause`) into every alert's `details` JSONB. Caller in `imap-sync.ts` wraps the caught error.

After this lands + CC #5b2 mass-reactivates: future "Command failed" alerts will surface the actual IMAP command + server response — root-cause data for a follow-up CC.

---

## 2. Current state of `handleImapError` (verified line numbers)

`src/lib/email/error-handler.ts` — 281 LOC total.

| Lines       | Section                                                                                  |
|-------------|------------------------------------------------------------------------------------------|
| 136-140     | `export async function handleImapError(error: Error, accountId: string, orgId: string)` |
| 141-142     | `getSupabase()` + `message`                                                              |
| 144-149     | account lookup (consecutive_failures + email)                                            |
| 151-152     | `failures = (cf ?? 0) + 1` + `email`                                                     |
| 154-158     | `updateData` init (failures + last_error + last_error_at)                                |
| 160-175     | **AUTH-failure branch** — cascades `status='disabled'` at cf>=3                          |
| 176-182     | **Connection-lost branch** — alert warning only, no cascade                              |
| 183-189     | **Mailbox-not-found branch** — alert critical, no cascade                                |
| 190-200     | **GENERIC catch-all** — cascades `status='disabled'` at cf>=3 ← **THIS** session targets |
| 202-205     | final `update(updateData)`                                                               |

Line numbers match the prompt's expectations exactly. No structural drift. NO HALT.

---

## 3. Callers of `handleImapError`

`grep -rn "handleImapError" dashboard-app/src/ --include="*.ts"` returns:

- `src/lib/email/error-handler.ts:136` — definition
- `src/lib/email/imap-sync.ts:5` — import
- `src/lib/email/imap-sync.ts:345` — **only call site** (inside `syncAllAccounts`'s per-account `catch`)

Surrounding shape at line 332-350:

```ts
for (const account of accounts || []) {
  if (!account.imap_host) continue;
  try {
    const count = await syncAccount(account.id);
    totalSynced += count;
  } catch (err) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    const msg = `[IMAP] Error syncing ${account.email}: ${errObj.message}`;
    console.error(msg);
    errors.push(msg);
    try {
      await handleImapError(errObj, account.id, orgId);
    } catch (alertErr) {
      console.error(`[IMAP] handleImapError failed for ${account.email}:`, alertErr);
    }
  }
}
```

`errObj` is the imapflow error re-thrown out of `syncAccount`. Wrapping it with the new context arg is straightforward — single call site, no DRY helper needed.

---

## 4. imapflow error object actual shape

Verified by reading `node_modules/imapflow/lib/imap-flow.js` (the panel parent dashboard-app has node_modules; worktree does not).

The relevant error-throw sites (lines 724-790):

```js
case 'NO':
case 'BAD': {
    let txt = parsed.attributes.filter(...).map(v => v.value.trim()).join(' ');
    let err = new Error('Command failed');                  // ← err.message
    err.response = parsed;                                  // rich; SKIP from logs
    err.responseStatus = parsed.command.toUpperCase();      // 'NO' | 'BAD'
    err.executedCommand = parsed.tag + (await compiler(...)).toString();  // full IMAP command string
    if (txt) {
        err.responseText = txt;                              // ← server text
        if (throttle) err.code = 'ETHROTTLE';                // ← err.code
    }
    request.reject(err);
}
```

Other error-throw paths set `err.code` to:
- `'NoConnection'` (line 420, 507, 560)
- `'StateLogout'` (line 427)
- `'EConnectionClosed'` (line 568)
- `'InvalidResponse'` (line 794)
- `'ETIMEOUT'` (line 862)
- `'UPGRADE_TIMEOUT'` (line 1165)
- `'ProxyError'` (line 1628)
- `'CONNECT_TIMEOUT'` (line 1638)
- `'GREETING_TIMEOUT'` (line 1657)
- `'ClosedAfterConnect{TLS,Text}'` (line 1786)

**Final fields the wrapper captures** (correcting the prompt's assumptions):

| Field             | Set by imapflow when                                              |
|-------------------|-------------------------------------------------------------------|
| `responseStatus`  | NO/BAD response from server (always the most diagnostic post-AUTH) |
| `responseText`    | NO/BAD response with text                                         |
| `executedCommand` | NO/BAD response (the full IMAP command string)                    |
| `code`            | many paths (NoConnection / ETIMEOUT / ETHROTTLE / etc.)           |
| `cause`           | sometimes (Node.js Error cause pattern, esp. STARTTLS upgrades)   |

NB: prompt assumed `command` — actual is `executedCommand`. Test cases adjusted. The `response` field is intentionally NOT captured (rich parsed-object; risk of leaking inbox contents).

---

## 5. Existing test infrastructure

- No existing `error-handler.test.ts` — will create new at `src/lib/email/__tests__/error-handler.test.ts`.
- Pattern template: `src/lib/email/__tests__/smtp-manager-sidecar.test.ts` (assertion + source-grep style; tsx `--test`-free, just `node` exec via tsx).
- Wire into `package.json` `test:gate0` chain (one new entry at end of the chain).

---

## 6. CC #5b1's `getSidecarAccountIds()` pattern (verbatim, to mirror)

`src/worker/handlers/smtp-connection-monitor.ts:46-49`:

```ts
function getSidecarAccountIds(): Set<string> {
  const raw = process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS || "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}
```

Will mirror exactly into `error-handler.ts` (with double-quotes → single-quotes for codebase consistency in that file; verified single-quotes are used throughout error-handler.ts).

---

## 7. Files to modify

| File                                         | Type     | Approx LOC delta |
|----------------------------------------------|----------|------------------|
| `src/lib/email/error-handler.ts`             | edit     | +35 / -8         |
| `src/lib/email/imap-sync.ts`                 | edit     | +12 / -1         |
| `src/lib/email/__tests__/error-handler.test.ts` | new   | +180             |
| `package.json`                               | edit     | +1 line (test gate) |

Total ≈ +228 / -9.

No DB migration. No saga file touched. No DNS.

---

## 8. Verbatim before/after — `handleImapError` signature + helpers

**Before** (lines 134-142):

```ts
/**
 * Handle IMAP errors with classification and auto-disable logic.
 */
export async function handleImapError(
  error: Error,
  accountId: string,
  orgId: string
): Promise<void> {
  const supabase = getSupabase();
  const message = error.message || '';
```

**After**:

```ts
/**
 * Optional imapflow error context. Verified field names against
 * node_modules/imapflow/lib/imap-flow.js NO/BAD throw site (CC #5b1.5).
 */
export interface ImapErrorContext {
  responseStatus?: string;     // 'NO' | 'BAD'
  responseText?: string;        // server text after status
  executedCommand?: string;     // full IMAP command string
  code?: string | number;       // 'ETHROTTLE' | 'NoConnection' | 'ETIMEOUT' | ...
  cause?: string;               // serialized Error.cause if present
}

/**
 * Sidecar-routed accounts (CC #5a v2) write outbound via Exim local-pipe;
 * the worker IP can't SMTP-AUTH to those panels. Imap-sync still polls them
 * (Unibox needs inbox reads), but if imapflow returns an opaque "Command
 * failed" mid-poll, we should NOT cascade-disable — the canonical liveness
 * path is sidecar-health-monitor (CC #5b1) hitting /admin/health, not
 * imap-sync command success. Mirrors CC #5b1's parser in smtp-connection-monitor.ts.
 */
function getSidecarAccountIds(): Set<string> {
  const raw = process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS || '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * Handle IMAP errors with classification and auto-disable logic.
 * @param context optional imapflow fields captured by caller for diagnostics.
 */
export async function handleImapError(
  error: Error,
  accountId: string,
  orgId: string,
  context?: ImapErrorContext
): Promise<void> {
  const supabase = getSupabase();
  const message = error.message || '';
  const sidecarIds = getSidecarAccountIds();
  const isSidecarAccount = sidecarIds.has(accountId);
```

---

## 9. Verbatim before/after — GENERIC catch-all (lines 190-200)

**Before**:

```ts
} else {
  // Generic IMAP error
  if (failures >= 3) {
    updateData.status = 'disabled';
    await createAlert(orgId, 'imap_error', 'critical',
      `${email} auto-disabled after ${failures} IMAP failures`,
      { error: message, failures },
      accountId
    );
  }
}
```

**After**:

```ts
} else {
  // Generic IMAP error
  if (failures >= 3) {
    if (isSidecarAccount) {
      // Sidecar-routed account: don't cascade-disable on opaque generic errors
      // (sidecar handles outbound via Exim local-pipe; imap-sync polling errors
      // here are likely imapflow command-level failures, not credential or
      // account-state issues). Keep status='active' — sidecar-health-monitor
      // owns liveness for these accounts (CC #5b1). Alert for visibility. CC #5b1.5.
      await createAlert(orgId, 'imap_error', 'warning',
        `Sidecar-routed account ${email} hit ${failures} generic IMAP failures (cascade-disable suppressed)`,
        {
          error: message,
          failures,
          sidecar_protected: true,
          ...(context || {}),
        },
        accountId
      );
    } else {
      updateData.status = 'disabled';
      await createAlert(orgId, 'imap_error', 'critical',
        `${email} auto-disabled after ${failures} IMAP failures`,
        {
          error: message,
          failures,
          ...(context || {}),
        },
        accountId
      );
    }
  }
}
```

The other three branches (AUTH / connection-lost / mailbox-not-found) get a `...(context || {})` spread into their alert details too — additive, no behavior change.

---

## 10. Verbatim before/after — `imap-sync.ts` caller wrapping

**Before** (lines 335-350):

```ts
} catch (err) {
  const errObj = err instanceof Error ? err : new Error(String(err));
  const msg = `[IMAP] Error syncing ${account.email}: ${errObj.message}`;
  console.error(msg);
  errors.push(msg);
  try {
    await handleImapError(errObj, account.id, orgId);
  } catch (alertErr) {
    console.error(`[IMAP] handleImapError failed for ${account.email}:`, alertErr);
  }
}
```

**After**:

```ts
} catch (err) {
  const errObj = err instanceof Error ? err : new Error(String(err));
  const msg = `[IMAP] Error syncing ${account.email}: ${errObj.message}`;
  console.error(msg);
  errors.push(msg);
  // Capture imapflow's NO/BAD context fields (verified against imap-flow.js
  // NO/BAD throw site: responseStatus, responseText, executedCommand, code).
  // Persists into system_alerts.details so a future CC can root-cause the
  // 100x "Command failed" cascade that drove CC #5b1.5. Pre-CC#5b1.5 alerts
  // captured only error.message — losing the diagnostic data.
  const e = errObj as Error & {
    responseStatus?: string;
    responseText?: string;
    executedCommand?: string;
    code?: string | number;
    cause?: unknown;
  };
  try {
    await handleImapError(errObj, account.id, orgId, {
      responseStatus: e.responseStatus,
      responseText: typeof e.responseText === 'string' ? e.responseText.substring(0, 500) : undefined,
      executedCommand: typeof e.executedCommand === 'string' ? e.executedCommand.substring(0, 500) : undefined,
      code: e.code,
      cause: e.cause ? String(e.cause).substring(0, 500) : undefined,
    });
  } catch (alertErr) {
    console.error(`[IMAP] handleImapError failed for ${account.email}:`, alertErr);
  }
}
```

Note: each string field truncated to 500 chars (matching `last_error.substring(0, 500)` pattern at error-handler.ts:69 / 156).

---

## 11. Tests to add (`src/lib/email/__tests__/error-handler.test.ts`)

Test runner: same pattern as `smtp-manager-sidecar.test.ts` — manual `assert` + counter, no jest/vitest. Mocks supabase via `process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:0'` (forces network-like failure that we catch) → fall back to source-grep contracts for cases where DB mocking is impractical.

Cases:

| # | Name                                                                       | Style       |
|---|----------------------------------------------------------------------------|-------------|
| 1 | `getSidecarAccountIds()` returns empty Set when env var unset              | unit        |
| 2 | `getSidecarAccountIds()` parses comma-separated IDs                        | unit        |
| 3 | `getSidecarAccountIds()` is whitespace-tolerant                            | unit        |
| 4 | source-grep: AUTH-failure branch unchanged for sidecar accounts            | source-grep |
| 5 | source-grep: GENERIC branch reads sidecar set + branches on isSidecarAccount | source-grep |
| 6 | source-grep: sidecar suppress alert sets `sidecar_protected: true` + `severity='warning'` | source-grep |
| 7 | source-grep: non-sidecar GENERIC branch still sets `status='disabled'`     | source-grep |
| 8 | source-grep: all 4 branches spread `...(context || {})` into alert details | source-grep |
| 9 | source-grep: signature includes optional `context?: ImapErrorContext`      | source-grep |
| 10| source-grep: imap-sync.ts caller wraps `responseText` + `executedCommand` + `code` | source-grep |
| 11| source-grep: imap-sync.ts caller truncates string fields to 500 chars       | source-grep |
| 12| source-grep: `handleSmtpError` byte-identical (no out-of-scope changes)    | source-grep |
| 13| typecheck contract: `handleImapError` 3-arg call still compiles (backward-compat) | unit (compile-time-only) |

Why source-grep dominates: the runtime path of `handleImapError` requires Supabase (`createClient`); mocking that without jest is brittle. Source-grep contracts verify the COMMITTED CODE matches the design intent, which is the ground truth that runs in production. Pattern matches CC #5b1's tests (smtp-manager-sidecar.test.ts) — same approach, validates same kind of contract.

---

## 12. Migration needed: NO

Confirmed. The new alert details fields (`responseStatus`, `responseText`, `executedCommand`, `code`, `cause`, `sidecar_protected`) are JSONB additive — no schema change.

---

## 13. Risks + mitigations

| Risk                                                               | Mitigation                                                                              |
|--------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| imapflow error field names differ between versions                 | Verified against installed v1.2.18 (package.json). Caller uses `as Error & { ... }` so undefined fields gracefully omit. |
| `responseText` could leak inbox content into alerts                | Truncated to 500 chars + JSONB-only (not user-facing UI yet); risk minor.              |
| Cascade-disable suppress hides a real problem                      | Alert still fires (severity=warning, sidecar_protected=true) — visible in dashboard. Operator-driven re-disable always available. |
| Backward-compat break in `handleImapError` signature               | Optional 4th param; existing 3-arg callers compile + run unchanged.                    |
| Worker not actually on `961a395` (memory-stale)                    | git log confirms main HEAD = 961a395; trust until SSH access confirmed (CC #5b2 verified worker active 2026-05-02 morning). |
| Phase 5 SSH blocked from CC session                                | Prompt explicitly authorizes worker SSH; if blocked, surface to user before merge.     |
| Test:gate0 chain too long, easy to break ordering                  | Append at end of chain; verify by running locally before push.                         |

---

## 14. Decisions that diverge from the prompt

1. **Field name `executedCommand` not `command`.** Prompt's example assumed `command`, but imapflow v1.2.18 uses `executedCommand` (verified at imap-flow.js:738). The wrapper accepts both per Error-augmentation pattern, but the canonical interface field is `executedCommand`. Tests assert `executedCommand`.
2. **Add `responseStatus` to context.** Not in prompt, but it's the cheapest signal of NO vs BAD and the most useful for triage (NO = command refused; BAD = malformed). Trivial addition.
3. **Truncate captured fields to 500 chars.** Matches existing `last_error.substring(0, 500)` precedent at error-handler.ts:69. Prevents JSONB bloat and inbox-content leakage.
4. **Single call-site wrapping inline (no helper).** Prompt suggested helper if ≥2 callers — there's only 1.
5. **Source-grep dominates tests.** Pattern matches CC #5b1's tests; runtime DB mocking is brittle without jest.

All divergences flagged here for V9 review on PR open.

---

## 15. Phase 5 SSH dependency note

This CC session's environment denied SSH to the production worker (`root@200.234.226.226`). Will surface to user at Phase 5 boundary; user approves SSH OR the user runs the worker pull manually. Phases 0-4 (code + tests + PR + auto-merge) proceed regardless.

---

**End of design doc.** Proceeding to Phase 1.
