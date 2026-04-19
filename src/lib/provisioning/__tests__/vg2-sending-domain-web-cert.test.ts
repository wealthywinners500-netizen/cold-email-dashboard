/**
 * Sending-domain web-cert test — HL #104 (Session 04d).
 *
 * The saga's issueSSLCert must issue TWO LE certs per sending domain:
 *   1. Web vhost cert: SAN [{domain}, www.{domain}]
 *      — HestiaCP installs on the web vhost so `https://{domain}/` serves a
 *        matching-CN cert. Click-tracking, unsubscribe URLs, MTA-STS policy
 *        endpoint (`https://mta-sts.{domain}/`) all need this.
 *   2. Mail cert: SAN [mail.{domain}, webmail.{domain}]
 *      — HestiaCP installs on Exim4/Dovecot/Roundcube. The VG2 SSL checks
 *        probe `mail.{domain}:443` (HL #99).
 *
 * Before this change, issueSSLCert called `v-add-letsencrypt-domain admin {d}
 * '' yes` ONCE. The `yes` flag is the MAIL subdomain toggle — it issues only
 * the mail cert. The bare web vhost stayed SSL-disabled and nginx fell back
 * to the default_server cert (`mail{1|2}.{nsDomain}`), producing CN-mismatch
 * warnings on every real-world URL (links in cold-email bodies, unsubscribe
 * endpoints, etc.). Pair 13 on launta.info required operational backfill.
 *
 * This test pins the double-issue invariant so the `yes`-only pattern does
 * not reappear through a drive-by edit.
 *
 * Run: tsx src/lib/provisioning/__tests__/vg2-sending-domain-web-cert.test.ts
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
  join(__dirname, '..', 'hestia-scripts.ts'),
  'utf8'
);

console.log('--- VG2 sending-domain web-cert (HL #104) ---');

// 1. issueSSLCert exists and has an isHostname: false branch
assert(
  /export async function issueSSLCert\(/.test(src),
  'issueSSLCert is exported from hestia-scripts.ts'
);

// Scope the assertions to the issueSSLCert function body.
const fnMatch = src.match(/export async function issueSSLCert\([\s\S]*?\n\}\n/);
assert(fnMatch !== null, 'issueSSLCert body located');
const fnBody = fnMatch![0];

// 2. Both LE issuances appear (web cert without `yes`; mail cert with `yes`)
const webCall = /v-add-letsencrypt-domain admin \$\{domain\}"/.test(fnBody);
const mailCall = /v-add-letsencrypt-domain admin \$\{domain\} '' yes"/.test(fnBody);
assert(webCall, "web cert call present: v-add-letsencrypt-domain admin {domain} (no 'yes' flag)");
assert(mailCall, "mail cert call present: v-add-letsencrypt-domain admin {domain} '' yes");

// 3. Both calls appear exactly once (no accidental duplication)
const webCalls = fnBody.match(/v-add-letsencrypt-domain admin \$\{domain\}"/g) ?? [];
const mailCalls = fnBody.match(/v-add-letsencrypt-domain admin \$\{domain\} '' yes"/g) ?? [];
assert(webCalls.length === 1, `exactly 1 web-cert call (found ${webCalls.length})`);
assert(mailCalls.length === 1, `exactly 1 mail-cert call (found ${mailCalls.length})`);

// 4. HL #104 referenced inline
assert(/HL #104/.test(fnBody), 'HL #104 cited in source for context');

// 5. Exit codes 3/4 are tolerated on BOTH calls (idempotent re-runs)
const exitHandling = (fnBody.match(/webExit !== 0 && webExit !== 3 && webExit !== 4|mailExit !== 0 && mailExit !== 3 && mailExit !== 4/g) ?? []).length;
assert(exitHandling >= 2, `exit codes 3/4 tolerated on both calls (found ${exitHandling})`);

console.log('--- all tests passed ---');
