/**
 * DNS record templates shared across the pair-provisioning saga, auto-fix,
 * and Hestia script emitters. Centralising values here closes the
 * 2026-04-21 audit's "one-way feedback loop" finding — the rule that was
 * patched into memory (HL #109) but never into the 5 DMARC emitter sites.
 *
 * HL #109: canonical cold-email DMARC.
 *
 * No `rua=`, no `ruf=`, no `fo=` — all optional per RFC 7489 §6.3. External
 * DMARC reporting (where the reporter's Organizational Domain — RFC 7489
 * §3.2, Public Suffix + one label — differs from the publisher's) requires
 * an authorization TXT record at
 * `<publishing-domain>._report._dmarc.<reporting-mailbox-domain>` per
 * RFC 7489 §7.1 (External Destinations). Under a public suffix like `.info`,
 * every sending domain and the shared NS domain are each separate
 * Organizational Domains, so any `rua=mailto:dmarc@<nsDomain>` on a sending
 * domain's DMARC is external. Our saga does not create the 20+ per-pair
 * authorization records that would be needed — external `rua=` was the
 * 2026-04-21 audit root cause ("External Domains in your DMARC are not
 * giving permission").
 *
 * Verified on Pair 13 (launta.info, 2026-04-20) — mail-tester 10/10,
 * MXToolbox UI FAIL=0.
 */
export const CANONICAL_DMARC_VALUE = `"v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; pct=100"`;

/**
 * Build the HestiaCP `v-add-dns-record` command (without `HESTIA_PATH_PREFIX`)
 * for the canonical DMARC record. Wrap the result in `${HESTIA_PATH_PREFIX}`
 * at each callsite — the prefix is a saga-local constant so this helper
 * stays path-free.
 */
export function buildDmarcAddCommand(domain: string): string {
  return `v-add-dns-record admin ${domain} _dmarc TXT ${CANONICAL_DMARC_VALUE}`;
}
