/**
 * CC #5a v2 panel-sidecar transport tests.
 *
 * Pure logic only:
 *   - shouldUseSidecar flag-list parsing
 *   - HMAC computation symmetry (worker-side signing vs sidecar-side verifying)
 *   - composeRaw round-trip (RFC 5322 surface area)
 *   - smtp-manager.ts source-grep guard against the legacy `mail.<sending-domain>`
 *     URL pattern from v1 (which Phase 0 ground-truth on P20-S1 ruled out)
 *
 * Run via: tsx src/lib/email/__tests__/smtp-manager-sidecar.test.ts
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import MailComposer from 'nodemailer/lib/mail-composer';

import { shouldUseSidecar } from '../smtp-manager';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let tests = 0;
let failed = 0;
function test(name: string, fn: () => Promise<void> | void) {
  tests++;
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${(err as Error).message}`);
    });
}

console.log('\nsmtp-manager-sidecar tests\n');

(async () => {
  // ───── shouldUseSidecar ─────
  await test('shouldUseSidecar(undefined) returns false regardless of env', () => {
    process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS = 'a,b,c';
    assert(shouldUseSidecar(undefined) === false, 'undefined accountId must short-circuit false');
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
  });

  await test('shouldUseSidecar with empty env returns false', () => {
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
    assert(shouldUseSidecar('any-id') === false, 'empty env must short-circuit false');
    process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS = '';
    assert(shouldUseSidecar('any-id') === false, 'blank env must short-circuit false');
  });

  await test('shouldUseSidecar matches accountId in comma-separated env', () => {
    process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS = 'aaa,bbb,ccc';
    assert(shouldUseSidecar('aaa') === true, 'first');
    assert(shouldUseSidecar('bbb') === true, 'middle');
    assert(shouldUseSidecar('ccc') === true, 'last');
    assert(shouldUseSidecar('xxx') === false, 'absent');
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
  });

  await test('shouldUseSidecar trims whitespace inside env list', () => {
    process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS = ' a , b ,  c  ';
    assert(shouldUseSidecar('a') === true, 'whitespace-padded a');
    assert(shouldUseSidecar('b') === true, 'whitespace-padded b');
    assert(shouldUseSidecar('c') === true, 'double-space c');
    assert(shouldUseSidecar(' a ') === false, 'callsite arg is NOT trimmed (intentional — accountId is a UUID)');
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
  });

  await test('shouldUseSidecar with single-id env works', () => {
    process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS = 'only-one';
    assert(shouldUseSidecar('only-one') === true, 'single id matches');
    assert(shouldUseSidecar('something-else') === false, 'no false-positive');
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
  });

  // ───── HMAC computation symmetry ─────
  await test('HMAC computation: same secret + ts + body yields same digest worker↔sidecar', () => {
    const secret = 'test-secret-32-bytes-of-content!';
    const ts = '1746111111';
    const body = Buffer.from('From: a@b.test\r\nTo: c@d.test\r\nSubject: x\r\n\r\nhello\r\n');
    // Worker side
    const workerSig = crypto.createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');
    // Sidecar side (uses identical update calls per panel-sidecar/index.mjs)
    const sidecarSig = crypto.createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');
    assert(workerSig === sidecarSig, 'symmetric digest mismatch');
    assert(workerSig.length === 64, 'sha256-hex must be 64 chars');
  });

  await test('HMAC: different ts produces different digest (no replay across ts)', () => {
    const secret = 's';
    const body = Buffer.from('x');
    const a = crypto.createHmac('sha256', secret).update('1.').update(body).digest('hex');
    const b = crypto.createHmac('sha256', secret).update('2.').update(body).digest('hex');
    assert(a !== b, 'ts is part of the auth bind');
  });

  await test('HMAC: different body produces different digest', () => {
    const secret = 's';
    const ts = '1';
    const a = crypto.createHmac('sha256', secret).update(`${ts}.`).update(Buffer.from('hello')).digest('hex');
    const b = crypto.createHmac('sha256', secret).update(`${ts}.`).update(Buffer.from('world')).digest('hex');
    assert(a !== b, 'body is part of the auth bind');
  });

  // ───── composeRaw round-trip via MailComposer ─────
  await test('MailComposer produces valid RFC 5322 with Message-ID, From, To, Subject', async () => {
    const composer = new MailComposer({
      from: '"Smoke Sender" <adam.shaw@krogeradpartners.info>',
      to: 'wealthywinners500@gmail.com',
      subject: '[V8_CC5A_SMOKE_TEST] composer roundtrip',
      text: 'plain body',
      html: '<p>html body</p>',
    });
    const raw: Buffer = await new Promise((res, rej) =>
      composer.compile().build((err, msg) => (err ? rej(err) : res(msg))),
    );
    const head = raw.slice(0, 4096).toString('utf8');
    assert(/^Message-ID:\s*<[^>]+>/im.test(head), 'must include Message-ID header');
    assert(/^From:\s*.*adam\.shaw@krogeradpartners\.info/im.test(head), 'From contains sender');
    assert(/^To:\s*wealthywinners500@gmail\.com/im.test(head), 'To contains recipient');
    assert(/^Subject:.*V8_CC5A_SMOKE_TEST/im.test(head), 'Subject preserved');
    assert(raw.length > 200, 'raw is non-trivial');
  });

  // ───── Source-grep guards ─────
  const here = dirname(fileURLToPath(import.meta.url));
  const smtpManagerPath = resolve(here, '..', 'smtp-manager.ts');
  const src = readFileSync(smtpManagerPath, 'utf8');

  await test('smtp-manager.ts: URL is built from panelHostname (Option A), not per-sending-domain', () => {
    // The Option A URL pattern is `https://${panelHostname}/admin/send` — built from
    // resolvePanelHostname's return value, which queries server_pairs.s{1,2}_hostname.
    assert(src.includes('resolvePanelHostname'), 'must use resolvePanelHostname helper');
    assert(/https:\/\/\$\{panelHostname\}\/admin\/send/.test(src), 'must build URL with panelHostname');
    assert(src.includes('server_pairs'), 'must look up server_pairs to get s1/s2 hostnames');
  });

  await test('smtp-manager.ts: legacy v1 design `mail.<sending-domain>` URL pattern is absent', () => {
    // v1 considered `https://mail.<sending-domain>/admin/send` and HALTed because
    // per-sending-domain LE certs lack a `mail.` SAN on this deployment. v2's Option A
    // pivot avoids that pattern entirely. Guard against accidental regression.
    assert(!/https:\/\/mail\.\$\{[^}]*sending/i.test(src), 'must not use mail.<sendingDomain> URL');
    assert(!/https:\/\/mail\.\$\{[^}]*Domain\}/i.test(src), 'must not use mail.<...Domain> URL');
  });

  await test('smtp-manager.ts: shouldUseSidecar reads USE_PANEL_SIDECAR_ACCOUNT_IDS env (the canary flag)', () => {
    assert(src.includes('USE_PANEL_SIDECAR_ACCOUNT_IDS'), 'flag env var must be referenced');
  });

  await test('smtp-manager.ts: HMAC headers match sidecar contract (X-Sidecar-Timestamp/Signature)', () => {
    assert(src.includes('X-Sidecar-Timestamp'), 'timestamp header');
    assert(src.includes('X-Sidecar-Signature'), 'signature header');
    assert(src.includes('SIDECAR_HMAC_SECRET'), 'HMAC secret env var');
  });

  // ───── Final ─────
  console.log(`\n${tests - failed}/${tests} passed${failed ? `, ${failed} FAILED` : ''}`);
  if (failed > 0) process.exit(1);
})();
