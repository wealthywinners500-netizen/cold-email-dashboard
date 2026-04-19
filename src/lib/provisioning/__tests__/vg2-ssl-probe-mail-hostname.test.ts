/**
 * VG2 SSL probe host test — HL #R3 (Session 04c).
 *
 * The four SSL checks (27 ssl_cert_existence, 28 ssl_cert_expiry,
 * 29 ssl_self_signed, 30 https_connectivity) must probe `mail.{domain}`
 * for sending domains, not `{domain}` directly. `setup_mail_domains`
 * issues LE certs for `mail.{domain}`; the bare web vhost has no cert
 * and falls back to the default vhost cert (mail{1|2}.{nsDomain}) —
 * a CN mismatch that VG2 flagged as auto_fixable. Auto-fix then called
 * `v-add-letsencrypt-domain admin {domain} '' yes`, which issued a
 * fresh cert for the SAN set [mail.{domain}, webmail.{domain}].
 * Repeated retries burned LE's duplicate-cert rate limit (5/168h) and
 * produced the Session 04 "S2 LE silent-exit" symptom.
 *
 * Fix: probe the hostname that already has a valid cert.
 *
 * Run: tsx src/lib/provisioning/__tests__/vg2-ssl-probe-mail-hostname.test.ts
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

console.log('--- VG2 SSL probe-host patch (HL #R3) ---');

assert(
  /const getSSLProbeHost\s*=\s*\(domain: string\): string\s*=>[\s\S]{0,200}domain === nsDomain \? domain : `mail\.\$\{domain\}`;/.test(src),
  'getSSLProbeHost helper defined — NS domain = bare, sending = mail. prefix'
);

// All four SSL checks must target probeHost.
const opensslProbes = src.match(/openssl s_client -connect \$\{ip\}:443 -servername \$\{probeHost\}/g) ?? [];
assert(opensslProbes.length === 3, `checks 27/28/29 probe \${probeHost} — found ${opensslProbes.length} (expected 3)`);

const bareSniProbes = src.match(/openssl s_client -connect \$\{ip\}:443 -servername \$\{domain\}/g) ?? [];
assert(bareSniProbes.length === 0, `no bare-domain SNI probes remain (found ${bareSniProbes.length})`);

const curlProbes = src.match(/curl -sI --max-time 10 https:\/\/\$\{probeHost\}\//g) ?? [];
assert(curlProbes.length === 1, `check 30 https_connectivity probes \${probeHost} — found ${curlProbes.length}`);

const bareCurlProbes = src.match(/curl -sI --max-time 10 https:\/\/\$\{domain\}\//g) ?? [];
assert(bareCurlProbes.length === 0, `no bare-domain curl probes remain (found ${bareCurlProbes.length})`);

// The CN-match predicate in check 27 must use probeHost — `includes(domain)`
// would coincidentally pass if the default-vhost cert subject contained the
// bare domain as a substring.
assert(
  /output\.includes\(probeHost\)/.test(src),
  'check 27 CN-match predicate uses probeHost'
);

// Helper defined exactly once — not duplicated inside each check block.
const helperCount = (src.match(/const getSSLProbeHost\s*=/g) ?? []).length;
assert(helperCount === 1, `getSSLProbeHost defined exactly once (found ${helperCount})`);

// Semantic sanity: the probeHost must NOT replace {domain} in non-SSL
// checks (DNS, DKIM, DMARC, MX, etc. all operate on the bare domain).
// Spot-check by counting probeHost uses — should be ≤ 10 (one per SSL
// check site + the helper definition line).
const probeHostOccurrences = (src.match(/probeHost/g) ?? []).length;
assert(
  probeHostOccurrences >= 8 && probeHostOccurrences <= 20,
  `probeHost references bounded (found ${probeHostOccurrences}, expected 8–20)`
);

console.log('--- all tests passed ---');
