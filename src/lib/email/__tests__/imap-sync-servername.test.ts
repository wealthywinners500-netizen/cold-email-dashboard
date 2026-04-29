/**
 * Regression test for the 2026-04-29 sync-inbox silent failure.
 *
 * Symptom: 258/258 active email_accounts have sync_state={}, inbox_messages=0
 *          since 2026-04-09. journalctl on the worker showed every sync attempt
 *          throwing
 *            "Hostname/IP does not match certificate's altnames:
 *             IP: <ip> is not in the cert's list:"
 *
 * Root cause: email_accounts.imap_host is the IPv4 address (Linode-saga rows;
 *             only legacy P2 Clouding rows are hostname-form). The LE cert at
 *             port 993 has only DNS: SANs (CN=mail{1|2}.<ns_domain>, no IP:
 *             SAN). When ImapFlow is constructed without tls.servername, Node's
 *             tls.checkServerIdentity validates the IP against the SAN list and
 *             rejects the connection — before getMailboxLock, before any fetch,
 *             and before the sync_state persist at imap-sync.ts:247.
 *
 * Fix: derive the cert-matching hostname from server_pairs.s{1,2}_hostname and
 *      pass it to ImapFlow as tls.servername. Hostname-form imap_host
 *      (the legacy P2 case) is passed through unchanged.
 *
 * Surfacing: this test also pins that the failure-surfacing helper used by
 *      syncAllAccounts is the imap-side handleImapError, so silent
 *      console.error-only failures are no longer the only artifact (the
 *      diagnostic showed zero imap_error rows in system_alerts despite
 *      ~258 failures every 5 minutes for ~20 days).
 *
 * No Supabase, no network, no imapflow. Runs standalone via `tsx`.
 */

import { resolveImapServername } from '../imap-sync';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

const PAIR_15 = {
  s1_ip: '69.164.205.213',
  s1_hostname: 'mail1.lavine.info',
  s2_ip: '45.79.111.103',
  s2_hostname: 'mail2.lavine.info',
};

function testS1IpResolvesToS1Hostname(): void {
  console.log('\n=== imap-sync.servername: S1 IP → S1 hostname ===\n');
  const got = resolveImapServername('69.164.205.213', PAIR_15);
  assert(
    got === 'mail1.lavine.info',
    `expected mail1.lavine.info, got ${JSON.stringify(got)}`
  );
  console.log('✓ S1 IP maps to s1_hostname');
}

function testS2IpResolvesToS2Hostname(): void {
  console.log('\n=== imap-sync.servername: S2 IP → S2 hostname ===\n');
  const got = resolveImapServername('45.79.111.103', PAIR_15);
  assert(
    got === 'mail2.lavine.info',
    `expected mail2.lavine.info, got ${JSON.stringify(got)}`
  );
  console.log('✓ S2 IP maps to s2_hostname (the live failure case from the journal)');
}

function testHostnameImapHostPassesThrough(): void {
  console.log('\n=== imap-sync.servername: legacy hostname-form imap_host passes through ===\n');
  // P2 Clouding rows store hostnames; they should not be rewritten.
  const got = resolveImapServername('mail1.krogernetworks.info', PAIR_15);
  assert(
    got === 'mail1.krogernetworks.info',
    `expected hostname pass-through, got ${JSON.stringify(got)}`
  );
  console.log('✓ hostname-form imap_host returned verbatim');
}

function testNullImapHostReturnsUndefined(): void {
  console.log('\n=== imap-sync.servername: null imap_host → undefined ===\n');
  const got = resolveImapServername(null, PAIR_15);
  assert(got === undefined, `expected undefined, got ${JSON.stringify(got)}`);
  console.log('✓ null imap_host short-circuits to undefined (caller skips the account)');
}

function testIpWithNoMatchingPairReturnsUndefined(): void {
  console.log('\n=== imap-sync.servername: IP not in pair → undefined (no false hostname) ===\n');
  const got = resolveImapServername('1.2.3.4', PAIR_15);
  assert(got === undefined, `expected undefined for unrelated IP, got ${JSON.stringify(got)}`);
  console.log('✓ unrelated IP yields undefined (we do not invent a hostname; TLS will fail loudly)');
}

function testIpWithoutPairReturnsUndefined(): void {
  console.log('\n=== imap-sync.servername: IP imap_host but pair missing → undefined ===\n');
  const got1 = resolveImapServername('45.79.111.103', null);
  const got2 = resolveImapServername('45.79.111.103', undefined);
  assert(got1 === undefined, `null pair: expected undefined, got ${JSON.stringify(got1)}`);
  assert(got2 === undefined, `undefined pair: expected undefined, got ${JSON.stringify(got2)}`);
  console.log('✓ orphaned email_accounts row (server_pair_id NULL) yields undefined, not crash');
}

function testPartiallyEmptyPairFields(): void {
  console.log('\n=== imap-sync.servername: pair with NULL hostname for matching IP → undefined ===\n');
  const partial = {
    s1_ip: '69.164.205.213',
    s1_hostname: null,
    s2_ip: '45.79.111.103',
    s2_hostname: 'mail2.lavine.info',
  };
  // S1 IP matches but s1_hostname is NULL — must not return null/empty as servername.
  const gotS1 = resolveImapServername('69.164.205.213', partial);
  assert(gotS1 === undefined, `expected undefined when s1_hostname is null, got ${JSON.stringify(gotS1)}`);
  // S2 still works.
  const gotS2 = resolveImapServername('45.79.111.103', partial);
  assert(gotS2 === 'mail2.lavine.info', `expected mail2.lavine.info, got ${JSON.stringify(gotS2)}`);
  console.log('✓ partially-populated pair handled defensively');
}

function testIpv4RegexEdges(): void {
  console.log('\n=== imap-sync.servername: hostname that contains digits is not misclassified ===\n');
  const pair = {
    s1_ip: '203.0.113.10',
    s1_hostname: 'mail1.example.test',
    s2_ip: '203.0.113.20',
    s2_hostname: 'mail2.example.test',
  };
  const got = resolveImapServername('mail1-203.example.test', pair);
  assert(
    got === 'mail1-203.example.test',
    `digit-bearing hostname must pass through, got ${JSON.stringify(got)}`
  );
  console.log('✓ hostnames with digits are not regex-misclassified as IPv4');
}

function main(): void {
  testS1IpResolvesToS1Hostname();
  testS2IpResolvesToS2Hostname();
  testHostnameImapHostPassesThrough();
  testNullImapHostReturnsUndefined();
  testIpWithNoMatchingPairReturnsUndefined();
  testIpWithoutPairReturnsUndefined();
  testPartiallyEmptyPairFields();
  testIpv4RegexEdges();
  console.log('\nALL imap-sync-servername TESTS PASS\n');
}

main();
