/**
 * Unibox tab routing — pure-predicate unit tests.
 *
 * Pins the 4-tab UX shipped on 2026-04-29:
 *   All / Warm Up / Hot Leads / Spam
 *
 * Design doc: dashboard-app/reports/2026-04-29-unibox-ux-design.md
 *
 * Locked decisions exercised here:
 *   - Warm Up signal: subject suffix '- wsn' (Snov.io warm-up marker; matched
 *     301/675 live threads as of 2026-04-29). Plus self-test secondary signal
 *     (all participants are our own accounts).
 *   - Spam routing: CONSERVATIVE multi-signal AND. Requires latest_classification
 *     = 'SPAM' AND no external participant is a known sender. Single signals
 *     (LLM SPAM only, or unknown sender only) MUST NOT route to Spam.
 *   - Hot Leads: classification IN (OBJECTION, INTERESTED) — engagement (pushback
 *     or interest) per Dean's mental model. Excludes warm-up + spam.
 *   - All: NOT warm-up AND NOT spam (Dean's stated intent: "separate Snov.io
 *     warm-up from real replies"; All is the useful default, not the union).
 *
 * No Supabase, no network. Runs standalone via `tsx`.
 */

import {
  isWarmUpThread,
  isSpamThread,
  isHotLeadThread,
  isAllThread,
  matchesTab,
  parseTab,
  postgrestHintsFor,
  ThreadLike,
} from '../tab-routing';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

const ORG_EMAILS = new Set([
  'zachary.king@nicema.info',
  'rebecca.peterson@nicema.info',
  'gerald.murphy@krogerbrandimpact.info',
  'rachel.matthews@krogermedia.info',
]);

// Sender that has appeared in a prior thread. Live data shows these are
// returned alongside org_emails by getKnownSenders (lead_contacts is empty
// per memory). For unit tests we just pre-populate the set.
const KNOWN_SENDERS = new Set<string>([
  ...ORG_EMAILS,
  'edf@limaatgraphicss.com',          // appeared in prior thread (live id 664)
  'sales@practivist.ae',              // appeared in prior thread (live id 654)
]);

const t = (overrides: Partial<ThreadLike> = {}): ThreadLike => ({
  subject: 'Quick question',
  participants: ['stranger@example.com', 'gerald.murphy@krogerbrandimpact.info'],
  account_emails: ['gerald.murphy@krogerbrandimpact.info'],
  latest_classification: null,
  ...overrides,
});

let tests = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  tests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

console.log('\nUnibox tab routing — pure predicate tests\n');

// ───── Warm-Up ─────
console.log('Warm Up:');

test('subject ending in "- wsn" routes to warm-up', () => {
  const thread = t({ subject: 'Following up on the new project idea - wsn' });
  assert(isWarmUpThread(thread), 'expected warm-up');
});

test('subject containing "- wsn" anywhere routes to warm-up', () => {
  const thread = t({ subject: "Operation Dinner: Tonight's Culinary Adventure - wsn" });
  assert(isWarmUpThread(thread), 'expected warm-up (case-real Snov template)');
});

test('marker is case-insensitive', () => {
  const thread = t({ subject: 'Weekend BBQ - WSN' });
  assert(isWarmUpThread(thread), 'expected warm-up (uppercase WSN)');
});

test('cold-email reply WITHOUT marker stays out of warm-up', () => {
  const thread = t({ subject: 'Re: Quick question about your store' });
  assert(!isWarmUpThread(thread), 'real reply leaked into warm-up');
});

test('self-test (all participants are our own accounts) routes to warm-up', () => {
  // Live message ids 164/167/174 — "Testing your new email with Snov.io".
  const thread = t({
    subject: 'Testing your new email with Snov.io',
    participants: ['zachary.king@nicema.info'],
    account_emails: ['zachary.king@nicema.info'],
  });
  assert(isWarmUpThread(thread), 'self-test should be warm-up');
});

test('null subject + external participant is NOT warm-up', () => {
  const thread = t({ subject: null });
  assert(!isWarmUpThread(thread), 'null subject leaked into warm-up');
});

// ───── Spam (CONSERVATIVE multi-signal AND) ─────
console.log('\nSpam (conservative AND):');

test('LLM SPAM + unknown sender → routes to spam', () => {
  const thread = t({
    latest_classification: 'SPAM',
    participants: ['novel-spammer@malicious.example', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(isSpamThread(thread, KNOWN_SENDERS), 'two-signal AND should fire');
});

test('LLM SPAM + KNOWN sender → DOES NOT route to spam (false positive guard)', () => {
  // Real reply from a sender we already corresponded with, even if LLM
  // misclassifies as SPAM. Dean's lock: real replies must almost never misroute.
  const thread = t({
    latest_classification: 'SPAM',
    participants: ['edf@limaatgraphicss.com', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(!isSpamThread(thread, KNOWN_SENDERS), 'KNOWN-sender SPAM leaked into spam');
});

test('UNKNOWN sender alone (no LLM SPAM label) → DOES NOT route to spam', () => {
  // Critical: a single signal MUST NOT route to spam.
  const thread = t({
    latest_classification: 'AUTO_REPLY',
    participants: ['novel-stranger@unknown.example', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(!isSpamThread(thread, KNOWN_SENDERS), 'single-signal SPAM routing — bug');
});

test('LLM SPAM with NO external participant (only our accounts) → NOT spam', () => {
  // Defensive: if for some reason a thread has only org accounts as
  // participants and somehow got SPAM-labeled, do not surface it as spam.
  const thread = t({
    latest_classification: 'SPAM',
    participants: ['zachary.king@nicema.info'],
    account_emails: ['zachary.king@nicema.info'],
  });
  assert(!isSpamThread(thread, KNOWN_SENDERS), 'all-org-accounts SPAM leaked');
});

test('null classification + unknown sender → NOT spam', () => {
  const thread = t({
    latest_classification: null,
    participants: ['novel-stranger@unknown.example', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(!isSpamThread(thread, KNOWN_SENDERS), 'null classification leaked into spam');
});

// ───── Hot Leads ─────
console.log('\nHot Leads:');

test('OBJECTION classification routes to hot-leads', () => {
  const thread = t({ latest_classification: 'OBJECTION' });
  assert(isHotLeadThread(thread, KNOWN_SENDERS), 'OBJECTION should be a hot lead');
});

test('INTERESTED classification routes to hot-leads', () => {
  const thread = t({ latest_classification: 'INTERESTED' });
  assert(isHotLeadThread(thread, KNOWN_SENDERS), 'INTERESTED should be a hot lead');
});

test('AUTO_REPLY does NOT route to hot-leads', () => {
  const thread = t({ latest_classification: 'AUTO_REPLY' });
  assert(!isHotLeadThread(thread, KNOWN_SENDERS), 'AUTO_REPLY leaked into hot-leads');
});

test('OBJECTION on a warm-up thread does NOT route to hot-leads (warm-up wins)', () => {
  const thread = t({
    subject: 'Following up on our chat - wsn',
    latest_classification: 'OBJECTION',
  });
  assert(!isHotLeadThread(thread, KNOWN_SENDERS), 'warm-up engagement leaked into hot-leads');
});

test('OBJECTION + LLM SPAM + unknown sender → NOT hot-leads (spam wins over engagement)', () => {
  const thread = t({
    latest_classification: 'SPAM',
    participants: ['novel@unknown.example', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(!isHotLeadThread(thread, KNOWN_SENDERS), 'SPAM-classified leaked into hot-leads');
});

// ───── All ─────
console.log('\nAll (default — excludes warm-up + spam):');

test('regular cold-email reply lives in All', () => {
  const thread = t({ latest_classification: 'AUTO_REPLY' });
  assert(isAllThread(thread, KNOWN_SENDERS), 'normal reply missing from All');
});

test('warm-up thread does NOT live in All', () => {
  const thread = t({ subject: 'Weekend BBQ and a hilarious pet story - wsn' });
  assert(!isAllThread(thread, KNOWN_SENDERS), 'warm-up leaked into All');
});

test('spam thread does NOT live in All', () => {
  const thread = t({
    latest_classification: 'SPAM',
    participants: ['novel-spammer@malicious.example', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(!isAllThread(thread, KNOWN_SENDERS), 'spam leaked into All');
});

test('SPAM-with-known-sender (false-positive case) STAYS in All', () => {
  // Critical inverse of the spam test: real reply that was misclassified by
  // the LLM as SPAM must still appear under All so Dean can find it.
  const thread = t({
    latest_classification: 'SPAM',
    participants: ['edf@limaatgraphicss.com', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(isAllThread(thread, KNOWN_SENDERS), 'misclassified SPAM lost from All');
});

// ───── Bucket exclusivity ─────
console.log('\nBucket partition (exclusivity invariant):');

test('every thread lives in exactly one of {All, Warm Up, Spam}', () => {
  const corpus: ThreadLike[] = [
    t({ subject: 'Following up - wsn' }),                                                   // warm-up
    t({ latest_classification: 'SPAM', participants: ['novel@x.example', 'gerald.murphy@krogerbrandimpact.info'] }), // spam
    t({ latest_classification: 'INTERESTED' }),                                             // all (+ hot-leads)
    t({ latest_classification: 'AUTO_REPLY' }),                                             // all
    t({ latest_classification: 'OBJECTION', subject: 'Re: pricing question' }),             // all (+ hot-leads)
    t({ latest_classification: null, subject: null }),                                      // all
    t({ subject: 'Testing your new email with Snov.io', participants: ['zachary.king@nicema.info'], account_emails: ['zachary.king@nicema.info'] }), // warm-up
  ];

  for (const thread of corpus) {
    const inAll = isAllThread(thread, KNOWN_SENDERS);
    const inWarmUp = isWarmUpThread(thread);
    const inSpam = isSpamThread(thread, KNOWN_SENDERS);
    const count = (inAll ? 1 : 0) + (inWarmUp ? 1 : 0) + (inSpam ? 1 : 0);
    assert(
      count === 1,
      `partition broken for ${JSON.stringify({ subject: thread.subject, cls: thread.latest_classification })}: All=${inAll} WarmUp=${inWarmUp} Spam=${inSpam}`
    );
  }
});

// ───── matchesTab dispatch ─────
console.log('\nmatchesTab dispatch:');

test('matchesTab("warm-up") agrees with isWarmUpThread', () => {
  const thread = t({ subject: 'Crazy delay at the airport! - wsn' });
  assert(matchesTab('warm-up', thread, KNOWN_SENDERS), 'dispatch broken for warm-up');
});

test('matchesTab("hot-leads") respects engagement set', () => {
  const thread = t({ latest_classification: 'INTERESTED' });
  assert(matchesTab('hot-leads', thread, KNOWN_SENDERS), 'dispatch broken for hot-leads');
});

test('matchesTab("spam") requires multi-signal AND', () => {
  const thread = t({ latest_classification: 'SPAM', participants: ['novel@x.example', 'gerald.murphy@krogerbrandimpact.info'] });
  assert(matchesTab('spam', thread, KNOWN_SENDERS), 'dispatch broken for spam');
});

test('matchesTab("all") for default thread', () => {
  const thread = t({ latest_classification: 'AUTO_REPLY' });
  assert(matchesTab('all', thread, KNOWN_SENDERS), 'dispatch broken for all');
});

// ───── parseTab safety ─────
console.log('\nparseTab safety:');

test('parseTab(null) → "all"', () => {
  assert(parseTab(null) === 'all', 'null should default to all');
});

test('parseTab("hot-leads") preserves valid tab', () => {
  assert(parseTab('hot-leads') === 'hot-leads', 'valid tab not preserved');
});

test('parseTab("OBJECTION") (legacy filter value) → "all"', () => {
  // Old URLs may have ?tab=OBJECTION etc. from the previous classification-as-tab
  // scheme. Defensive default to "all" (not crash).
  assert(parseTab('OBJECTION') === 'all', 'legacy URL crashed parseTab');
});

test('parseTab("../malicious") rejects', () => {
  assert(parseTab('../malicious') === 'all', 'parseTab let through unsafe value');
});

// ───── postgrestHintsFor cheap-pass shape ─────
console.log('\nPostgREST hints (server cheap-pass):');

test('warm-up hints uses subject ILIKE', () => {
  const h = postgrestHintsFor('warm-up');
  assert(h.subjectIlike?.includes('- wsn'), 'warm-up should ILIKE the marker');
  assert(!h.subjectNotIlike, 'warm-up should not negate the marker');
});

test('hot-leads hints includes engagement set + warm-up exclusion', () => {
  const h = postgrestHintsFor('hot-leads');
  assert(h.classificationIn?.includes('OBJECTION'), 'hot-leads missing OBJECTION');
  assert(h.classificationIn?.includes('INTERESTED'), 'hot-leads missing INTERESTED');
  assert(h.subjectNotIlike?.includes('- wsn'), 'hot-leads should exclude warm-up');
});

test('spam hints scopes to classification=SPAM', () => {
  const h = postgrestHintsFor('spam');
  assert(h.classificationEq === 'SPAM', 'spam hint missing classification=SPAM');
});

test('all hints excludes warm-up and lets JS layer tighten spam', () => {
  const h = postgrestHintsFor('all');
  assert(h.subjectNotIlike?.includes('- wsn'), 'all hint should exclude warm-up subject');
  assert(!h.classificationEq, 'all should not pin classification');
});

// ───── Summary ─────
console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log('All tab-routing tests passed.\n');
