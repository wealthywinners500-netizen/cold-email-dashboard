/**
 * VG2 FCrDNS resolver test — HL #102 (Session 04d).
 *
 * The fcrdns check runs `dig -x IP +short @RESOLVER` from S1 to look up the
 * reverse (PTR) name for each server's IP, then forward-confirms by resolving
 * the PTR name back to an A record. The REVERSE half needs recursion: our
 * authoritative NS does NOT own the relevant in-addr.arpa zone — only Linode
 * (or the IP-block delegatee) does. HestiaCP's default BIND config is
 * `allow-recursion { 127.0.0.1; ::1; };` — it refuses recursion for any
 * external source IP. When dig queries @S1_IP from S1 (source IP = S1's
 * external IP, not 127.0.0.1), BIND refuses, dig returns empty with +short,
 * the check reports "No PTR record found", VG2 fails as auto_fixable, and
 * auto-fix's fix_ptr cannot help (the PTR IS set at Linode and resolves
 * correctly via any recursive resolver).
 *
 * Fix: route the REVERSE lookup through a public recursive resolver.
 * Forward lookup of the PTR name (mail{1|2}.{nsDomain}) stays on
 * authoritativeResolver because that IS our zone.
 *
 * Run: tsx src/lib/provisioning/__tests__/vg2-fcrdns-resolver.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

const src = readFileSync(
  join(__dirname, '..', 'verification-checks.ts'),
  'utf8'
);

console.log('--- VG2 FCrDNS resolver (HL #102) ---');

// 1. reverseResolver defined and bound to a public recursive resolver
assert(
  /const reverseResolver\s*=\s*'8\.8\.8\.8';/.test(src),
  'reverseResolver helper defined = 8.8.8.8'
);

// 2. FCrDNS reverse-dig uses reverseResolver, not primaryResolver
assert(
  /dig -x \$\{ip\} \+short @\$\{reverseResolver\}/.test(src),
  'reverse PTR dig uses @${reverseResolver}'
);

// 3. The old broken pattern is gone — no `dig -x ... @${primaryResolver}`
assert(
  !/dig -x \$\{ip\} \+short @\$\{primaryResolver\}/.test(src),
  'no stale `dig -x ... @primaryResolver` (the HL #102 bug)'
);

// 4. Forward dig of the PTR name still uses primaryResolver — it hits our
//    own zone (mail{1|2}.{nsDomain}), so the authoritative NS is correct.
assert(
  /dig \+short \$\{ptrName\} A @\$\{primaryResolver\}/.test(src),
  'forward dig of ptrName still uses @${primaryResolver} (our zone)'
);

// 5. reverseResolver is scoped — not leaking into other DNS checks that rely
//    on our authoritative zone's answer (e.g., MX, SOA, SPF).
const reverseResolverUses = (src.match(/reverseResolver/g) ?? []).length;
assert(
  reverseResolverUses >= 2 && reverseResolverUses <= 4,
  `reverseResolver used 2\u20134 times (def + 1 or 2 reverse-dig sites) \u2014 found ${reverseResolverUses}`
);

console.log('--- all tests passed ---');
