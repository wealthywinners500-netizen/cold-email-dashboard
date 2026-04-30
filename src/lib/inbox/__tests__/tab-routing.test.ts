/**
 * Unibox tab routing — pure-predicate unit tests.
 *
 * V1+a (2026-04-30) extends the 4-tab UX to 6 tabs:
 *   All / Warm Up / Interested / Hot Leads / Bounced / Spam
 *
 * Design docs:
 *   dashboard-app/reports/2026-04-29-unibox-ux-design.md (PR #24, 4-tab base)
 *   dashboard-app/reports/2026-04-29-unibox-v1a-design.md (V1+a, 6-tab)
 *
 * Locked decisions exercised here:
 *   - Warm Up: subject suffix '- wsn' (Snov.io warm-up marker; matched 301/675
 *     live threads as of 2026-04-29). Plus self-test (all-participants-our-accounts).
 *   - Spam: CONSERVATIVE multi-signal AND. latest_classification = 'SPAM' AND
 *     no external participant is a known sender. Single signals MUST NOT fire.
 *   - Interested (V1+a): classification = 'INTERESTED' — soft first-touch
 *     positive ("asks for info/pricing"). Distinct from HOT_LEAD.
 *   - Hot Leads (V1+a redefined): classification IN (HOT_LEAD, OBJECTION) —
 *     substantive qualifying questions or pushback. Excludes warm-up + spam.
 *   - Bounced: classification = 'BOUNCE'.
 *   - All: NOT (warm-up OR spam OR bounced). Includes Interested + Hot Leads
 *     as visible subsets so Dean's default view shows engagement alongside
 *     AUTO_REPLY/NOT_INTERESTED/STOP.
 *
 * No Supabase, no network. Runs standalone via `tsx`.
 */

import {
  isWarmUpThread,
  isSpamThread,
  isInterestedThread,
  isHotLeadThread,
  isBouncedThread,
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

// ───── Interested (V1+a — soft first-touch positive) ─────
console.log('\nInterested (V1+a — soft first-touch positive):');

test("INTERESTED routes to interested", () => {
  const thread = t({ latest_classification: 'INTERESTED' });
  assert(isInterestedThread(thread, KNOWN_SENDERS), 'INTERESTED should land in interested');
});

test('HOT_LEAD does NOT route to interested (vocab split)', () => {
  // V1+a: HOT_LEAD is the upgrade path from INTERESTED — they should NOT
  // both land in the same tab. This is the whole point of the vocab refine.
  const thread = t({ latest_classification: 'HOT_LEAD' });
  assert(!isInterestedThread(thread, KNOWN_SENDERS), 'HOT_LEAD leaked into interested — vocab split broken');
});

test('OBJECTION does NOT route to interested', () => {
  const thread = t({ latest_classification: 'OBJECTION' });
  assert(!isInterestedThread(thread, KNOWN_SENDERS), 'OBJECTION leaked into interested');
});

test('warm-up INTERESTED → NOT interested (warm-up wins)', () => {
  const thread = t({ subject: 'Quick question - wsn', latest_classification: 'INTERESTED' });
  assert(!isInterestedThread(thread, KNOWN_SENDERS), 'warm-up + INTERESTED leaked into interested');
});

// ───── Hot Leads (V1+a — redefined to HOT_LEAD + OBJECTION) ─────
console.log('\nHot Leads (V1+a — substantive engagement):');

test('HOT_LEAD routes to hot-leads', () => {
  const thread = t({ latest_classification: 'HOT_LEAD' });
  assert(isHotLeadThread(thread, KNOWN_SENDERS), 'HOT_LEAD should be a hot lead');
});

test('OBJECTION routes to hot-leads', () => {
  const thread = t({ latest_classification: 'OBJECTION' });
  assert(isHotLeadThread(thread, KNOWN_SENDERS), 'OBJECTION should still be a hot lead');
});

test('INTERESTED does NOT route to hot-leads (V1+a vocab split)', () => {
  // V1+a: INTERESTED no longer routes here — it has its own tab.
  // This is the inverse of the vocab-split test above.
  const thread = t({ latest_classification: 'INTERESTED' });
  assert(!isHotLeadThread(thread, KNOWN_SENDERS), 'INTERESTED leaked into hot-leads — old vocab regression');
});

test('AUTO_REPLY does NOT route to hot-leads', () => {
  const thread = t({ latest_classification: 'AUTO_REPLY' });
  assert(!isHotLeadThread(thread, KNOWN_SENDERS), 'AUTO_REPLY leaked into hot-leads');
});

test('HOT_LEAD on a warm-up thread does NOT route to hot-leads (warm-up wins)', () => {
  const thread = t({
    subject: 'Following up on our chat - wsn',
    latest_classification: 'HOT_LEAD',
  });
  assert(!isHotLeadThread(thread, KNOWN_SENDERS), 'warm-up engagement leaked into hot-leads');
});

test('HOT_LEAD + LLM SPAM + unknown sender → NOT hot-leads (spam wins over engagement)', () => {
  const thread = t({
    latest_classification: 'SPAM',
    participants: ['novel@unknown.example', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(!isHotLeadThread(thread, KNOWN_SENDERS), 'SPAM-classified leaked into hot-leads');
});

// ───── Bounced (V1+a — own terminal bucket) ─────
console.log('\nBounced (V1+a):');

test('BOUNCE routes to bounced', () => {
  const thread = t({ latest_classification: 'BOUNCE' });
  assert(isBouncedThread(thread), 'BOUNCE should land in bounced');
});

test('non-BOUNCE classifications do NOT route to bounced', () => {
  for (const cls of ['INTERESTED', 'HOT_LEAD', 'OBJECTION', 'AUTO_REPLY', 'STOP', 'SPAM', 'NOT_INTERESTED']) {
    const thread = t({ latest_classification: cls });
    assert(
      !isBouncedThread(thread),
      `${cls} leaked into bounced`
    );
  }
});

test('null classification does NOT route to bounced', () => {
  const thread = t({ latest_classification: null });
  assert(!isBouncedThread(thread), 'null leaked into bounced');
});

// ───── V1+b: warm-up exclusion in Bounced + Spam ─────
console.log('\nV1+b warm-up exclusion (Bounced/Spam stop double-counting Snov warm-up):');

test('warm-up + BOUNCE → NOT bounced (V1+b: warm-up wins)', () => {
  // V1+a deploy report §4.1: 19 of 19 Bounced rows were also warm-up bounces
  // — Snov manages its own warm-up bounce visibility, so we exclude here.
  const thread = t({
    subject: 'Following up on the new project idea - wsn',
    latest_classification: 'BOUNCE',
  });
  assert(!isBouncedThread(thread), 'warm-up BOUNCE leaked into Bounced — V1+a regression');
});

test('non-warm-up + BOUNCE → still routes to bounced', () => {
  // V1+b only excludes WHEN ALSO warm-up. Real bounces must still surface.
  const thread = t({
    subject: 'Re: your real cold-email campaign',
    latest_classification: 'BOUNCE',
  });
  assert(isBouncedThread(thread), 'real bounce dropped from Bounced — V1+b over-tightened');
});

test('warm-up + SPAM → NOT spam (V1+b: warm-up wins)', () => {
  const thread = t({
    subject: 'Quick warm-up message - wsn',
    latest_classification: 'SPAM',
    participants: ['novel@unknown.example', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(
    !isSpamThread(thread, KNOWN_SENDERS),
    'warm-up SPAM leaked into Spam — V1+a regression'
  );
});

test('matchesTab("bounced") excludes warm-up BOUNCE', () => {
  const thread = t({
    subject: 'BBQ recipes - wsn',
    latest_classification: 'BOUNCE',
  });
  assert(
    !matchesTab('bounced', thread, KNOWN_SENDERS),
    'matchesTab dispatch missed V1+b warm-up exclusion (Bounced)'
  );
});

test('matchesTab("spam") excludes warm-up SPAM', () => {
  const thread = t({
    subject: 'Funny pet story - wsn',
    latest_classification: 'SPAM',
    participants: ['novel@unknown.example', 'gerald.murphy@krogerbrandimpact.info'],
  });
  assert(
    !matchesTab('spam', thread, KNOWN_SENDERS),
    'matchesTab dispatch missed V1+b warm-up exclusion (Spam)'
  );
});

// ───── All ─────
console.log('\nAll (V1+a — excludes warm-up + spam + bounced):');

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

test('BOUNCE thread does NOT live in All (V1+a — own terminal bucket)', () => {
  const thread = t({ latest_classification: 'BOUNCE' });
  assert(!isAllThread(thread, KNOWN_SENDERS), 'BOUNCE leaked into All — V1+a Bounced split broken');
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

test('INTERESTED + HOT_LEAD live in All (subsets, not exclusive)', () => {
  // V1+a contract: Interested + Hot Leads are visible UNDER All — not
  // partitioned out. Bounced + Warm Up + Spam are the ones excluded.
  for (const cls of ['INTERESTED', 'HOT_LEAD', 'OBJECTION', 'NOT_INTERESTED', 'STOP']) {
    const thread = t({ latest_classification: cls });
    assert(
      isAllThread(thread, KNOWN_SENDERS),
      `${cls} dropped from All — engagement subsets must remain under default view`
    );
  }
});

// ───── Bucket exclusivity (6-tab partition) ─────
console.log('\nBucket partition (V1+a exclusivity invariant):');

test('every thread lives in exactly one of {All, Warm Up, Bounced, Spam}', () => {
  // Interested + Hot Leads are SUBSETS of All (not partitioned out), so the
  // exclusive partition is 4-way: {Warm Up, Bounced, Spam, All}.
  const corpus: ThreadLike[] = [
    t({ subject: 'Following up - wsn' }),                                                                                 // warm-up
    t({ latest_classification: 'SPAM', participants: ['novel@x.example', 'gerald.murphy@krogerbrandimpact.info'] }),      // spam
    t({ latest_classification: 'BOUNCE' }),                                                                               // bounced
    t({ latest_classification: 'INTERESTED' }),                                                                           // all (+ interested)
    t({ latest_classification: 'HOT_LEAD' }),                                                                             // all (+ hot-leads)
    t({ latest_classification: 'OBJECTION', subject: 'Re: pricing question' }),                                           // all (+ hot-leads)
    t({ latest_classification: 'AUTO_REPLY' }),                                                                           // all
    t({ latest_classification: 'NOT_INTERESTED' }),                                                                       // all
    t({ latest_classification: null, subject: null }),                                                                    // all
    t({ subject: 'Testing your new email with Snov.io', participants: ['zachary.king@nicema.info'], account_emails: ['zachary.king@nicema.info'] }), // warm-up
  ];

  for (const thread of corpus) {
    const inAll = isAllThread(thread, KNOWN_SENDERS);
    const inWarmUp = isWarmUpThread(thread);
    const inSpam = isSpamThread(thread, KNOWN_SENDERS);
    const inBounced = isBouncedThread(thread);
    const count = (inAll ? 1 : 0) + (inWarmUp ? 1 : 0) + (inSpam ? 1 : 0) + (inBounced ? 1 : 0);
    assert(
      count === 1,
      `partition broken for ${JSON.stringify({ subject: thread.subject, cls: thread.latest_classification })}: All=${inAll} WarmUp=${inWarmUp} Spam=${inSpam} Bounced=${inBounced}`
    );
  }
});

test('Interested ⊂ All, Hot Leads ⊂ All (subset invariant)', () => {
  // Both engagement tabs are subsets of All — every Interested thread also
  // shows up under All, every Hot Leads thread also shows up under All.
  const interestedThread = t({ latest_classification: 'INTERESTED' });
  assert(
    isInterestedThread(interestedThread, KNOWN_SENDERS) && isAllThread(interestedThread, KNOWN_SENDERS),
    'Interested thread missing from All'
  );
  const hotLeadThread = t({ latest_classification: 'HOT_LEAD' });
  assert(
    isHotLeadThread(hotLeadThread, KNOWN_SENDERS) && isAllThread(hotLeadThread, KNOWN_SENDERS),
    'HOT_LEAD thread missing from All'
  );
  const objectionThread = t({ latest_classification: 'OBJECTION' });
  assert(
    isHotLeadThread(objectionThread, KNOWN_SENDERS) && isAllThread(objectionThread, KNOWN_SENDERS),
    'OBJECTION thread missing from All'
  );
});

// ───── matchesTab dispatch ─────
console.log('\nmatchesTab dispatch (6 tabs):');

test('matchesTab("warm-up") agrees with isWarmUpThread', () => {
  const thread = t({ subject: 'Crazy delay at the airport! - wsn' });
  assert(matchesTab('warm-up', thread, KNOWN_SENDERS), 'dispatch broken for warm-up');
});

test('matchesTab("interested") for INTERESTED', () => {
  const thread = t({ latest_classification: 'INTERESTED' });
  assert(matchesTab('interested', thread, KNOWN_SENDERS), 'dispatch broken for interested');
});

test('matchesTab("hot-leads") for HOT_LEAD', () => {
  const thread = t({ latest_classification: 'HOT_LEAD' });
  assert(matchesTab('hot-leads', thread, KNOWN_SENDERS), 'dispatch broken for hot-leads (HOT_LEAD)');
});

test('matchesTab("hot-leads") for OBJECTION', () => {
  const thread = t({ latest_classification: 'OBJECTION' });
  assert(matchesTab('hot-leads', thread, KNOWN_SENDERS), 'dispatch broken for hot-leads (OBJECTION)');
});

test('matchesTab("bounced") for BOUNCE', () => {
  const thread = t({ latest_classification: 'BOUNCE' });
  assert(matchesTab('bounced', thread, KNOWN_SENDERS), 'dispatch broken for bounced');
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

test('parseTab("interested") preserves V1+a tab', () => {
  assert(parseTab('interested') === 'interested', 'interested tab not preserved');
});

test('parseTab("bounced") preserves V1+a tab', () => {
  assert(parseTab('bounced') === 'bounced', 'bounced tab not preserved');
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

test('hot-leads hints includes V1+a engagement set + warm-up exclusion', () => {
  const h = postgrestHintsFor('hot-leads');
  assert(h.classificationIn?.includes('OBJECTION'), 'hot-leads missing OBJECTION');
  assert(h.classificationIn?.includes('HOT_LEAD'), 'hot-leads missing HOT_LEAD (V1+a vocab)');
  assert(!h.classificationIn?.includes('INTERESTED'), 'hot-leads should NOT include INTERESTED — own tab now');
  assert(h.subjectNotIlike?.includes('- wsn'), 'hot-leads should exclude warm-up');
});

test('interested hints (V1+a) scopes to classification=INTERESTED + warm-up exclusion', () => {
  const h = postgrestHintsFor('interested');
  assert(h.classificationIn?.includes('INTERESTED'), 'interested missing INTERESTED');
  assert(!h.classificationIn?.includes('HOT_LEAD'), 'interested should NOT include HOT_LEAD');
  assert(!h.classificationIn?.includes('OBJECTION'), 'interested should NOT include OBJECTION');
  assert(h.subjectNotIlike?.includes('- wsn'), 'interested should exclude warm-up');
});

test('bounced hints (V1+a) pins classification=BOUNCE', () => {
  const h = postgrestHintsFor('bounced');
  assert(h.classificationEq === 'BOUNCE', 'bounced hint missing classification=BOUNCE');
});

test('spam hints scopes to classification=SPAM', () => {
  const h = postgrestHintsFor('spam');
  assert(h.classificationEq === 'SPAM', 'spam hint missing classification=SPAM');
});

test('all hints excludes warm-up + bounced and lets JS layer tighten spam', () => {
  const h = postgrestHintsFor('all');
  assert(h.subjectNotIlike?.includes('- wsn'), 'all hint should exclude warm-up subject');
  assert(h.classificationNotEq === 'BOUNCE', 'all hint should exclude BOUNCE classification');
  assert(!h.classificationEq, 'all should not pin classification=');
});

// ───── Summary ─────
console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log('All tab-routing tests passed.\n');
