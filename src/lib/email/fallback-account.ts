/**
 * Phase 1 — fallback account selector stub.
 *
 * Phase 2 will implement real fallback logic (domain affinity, threading
 * history lookup, per-account remaining cap). For now this returns null so
 * `process-sequence-step.ts` can wire the call site and Phase 2 only has to
 * replace the implementation.
 */

export interface SelectFallbackAccountArgs {
  orgId: string;
  recipientId: string;
  excludeAccountId: string;
}

export async function selectFallbackAccount(
  _args: SelectFallbackAccountArgs
): Promise<string | null> {
  // Intentionally a no-op in Phase 1. See Phase 2 prompt.
  return null;
}
