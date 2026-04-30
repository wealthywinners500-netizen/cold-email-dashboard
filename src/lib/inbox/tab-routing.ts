// Tab routing predicates for the Unibox.
//
// These are pure functions over a thread shape + the org's known-sender set.
// No Supabase calls, no I/O — fully unit-testable.
//
// V1+a (2026-04-30): expanded from 4 tabs to 6 — added Interested + Bounced,
// split the old Hot Leads (was OBJECTION+INTERESTED) into Interested vs
// Hot Leads (HOT_LEAD+OBJECTION) per the locked vocab refinement.
//
// Design docs:
//   dashboard-app/reports/2026-04-29-unibox-ux-design.md  (PR #24, 4-tab base)
//   dashboard-app/reports/2026-04-29-unibox-v1a-design.md (V1+a, 6-tab)

export type Tab =
  | 'all'
  | 'warm-up'
  | 'interested'
  | 'hot-leads'
  | 'bounced'
  | 'spam';

export const VALID_TABS: readonly Tab[] = [
  'all',
  'warm-up',
  'interested',
  'hot-leads',
  'bounced',
  'spam',
];

// V1+a vocab split: HOT_LEAD = substantive qualifying questions; OBJECTION =
// concern/pushback. Both are "real engagement, ready for human follow-up."
export const HOT_LEAD_CLASSIFICATIONS = ['HOT_LEAD', 'OBJECTION'] as const;
// INTERESTED = first-touch soft positive (asks for info/pricing only).
export const INTERESTED_CLASSIFICATIONS = ['INTERESTED'] as const;

// Snov.io appends this suffix to every warm-up touch's subject. The "- " spacing
// is mechanical (their template); a real human reply will not contain it.
const WARMUP_SUBJECT_MARKER = '- wsn';

export interface ThreadLike {
  subject: string | null;
  participants: string[] | null;
  account_emails: string[] | null;
  latest_classification: string | null;
}

export function parseTab(value: string | null | undefined): Tab {
  if (value && (VALID_TABS as readonly string[]).includes(value)) {
    return value as Tab;
  }
  return 'all';
}

export function isWarmUpThread(thread: ThreadLike): boolean {
  if (thread.subject && thread.subject.toLowerCase().includes(WARMUP_SUBJECT_MARKER)) {
    return true;
  }
  // Self-test secondary signal: a participant equals one of this thread's own
  // receiving accounts (e.g. `zachary.king@nicema.info` sending to itself
  // during onboarding). Caught here so it lands in Warm Up rather than All.
  const accounts = new Set((thread.account_emails || []).map((e) => e.toLowerCase()));
  if (accounts.size === 0) return false;
  const otherParticipants = (thread.participants || []).filter(
    (p) => !accounts.has(p.toLowerCase())
  );
  if (otherParticipants.length === 0 && (thread.participants || []).length > 0) {
    // All participants are our own accounts.
    return true;
  }
  return false;
}

// Conservative AND per Dean's lock (PR #24 design doc §5):
//   1. LLM classifier label = SPAM
//   2. From-side participants are NOT in the org's known-sender set.
// DKIM signal absent in schema; "needs >=2 of the remaining + content check"
// resolves to (1) AND (2) given the keyword check would over-tighten to zero.
export function isSpamThread(thread: ThreadLike, knownSenders: Set<string>): boolean {
  if (thread.latest_classification !== 'SPAM') return false;

  const accounts = new Set((thread.account_emails || []).map((e) => e.toLowerCase()));
  const externalParticipants = (thread.participants || [])
    .map((p) => p.toLowerCase())
    .filter((p) => !accounts.has(p));

  if (externalParticipants.length === 0) return false; // no external sender => not spam

  // If any external participant is a known sender, the thread is NOT spam.
  // Conservative: when in doubt, treat as known.
  for (const sender of externalParticipants) {
    if (knownSenders.has(sender)) return false;
  }
  return true;
}

export function isBouncedThread(thread: ThreadLike): boolean {
  return thread.latest_classification === 'BOUNCE';
}

// V1+a: split out from the old Hot Leads. INTERESTED = soft first-touch
// positive (asks for info/pricing) — distinct from HOT_LEAD's substantive
// qualifying questions.
export function isInterestedThread(
  thread: ThreadLike,
  knownSenders: Set<string>
): boolean {
  if (isWarmUpThread(thread)) return false;
  if (isSpamThread(thread, knownSenders)) return false;
  if (!thread.latest_classification) return false;
  return (INTERESTED_CLASSIFICATIONS as readonly string[]).includes(
    thread.latest_classification
  );
}

export function isHotLeadThread(thread: ThreadLike, knownSenders: Set<string>): boolean {
  if (isWarmUpThread(thread)) return false;
  if (isSpamThread(thread, knownSenders)) return false;
  if (!thread.latest_classification) return false;
  return (HOT_LEAD_CLASSIFICATIONS as readonly string[]).includes(
    thread.latest_classification
  );
}

// "All" excludes warm-up + spam + bounced. Per V1+a lock: Bounced is its own
// terminal bucket; Interested + Hot Leads remain visible under All so Dean's
// default view shows real engagement alongside everything-else (AUTO_REPLY,
// NOT_INTERESTED, STOP).
export function isAllThread(thread: ThreadLike, knownSenders: Set<string>): boolean {
  return (
    !isWarmUpThread(thread) &&
    !isSpamThread(thread, knownSenders) &&
    !isBouncedThread(thread)
  );
}

export function matchesTab(
  tab: Tab,
  thread: ThreadLike,
  knownSenders: Set<string>
): boolean {
  switch (tab) {
    case 'warm-up':
      return isWarmUpThread(thread);
    case 'interested':
      return isInterestedThread(thread, knownSenders);
    case 'hot-leads':
      return isHotLeadThread(thread, knownSenders);
    case 'bounced':
      return isBouncedThread(thread);
    case 'spam':
      return isSpamThread(thread, knownSenders);
    case 'all':
    default:
      return isAllThread(thread, knownSenders);
  }
}

// Helper exported for the API layer: how to express the cheap subset of each
// tab's filter as PostgREST query parameters. The post-fetch JS predicate
// (matchesTab) tightens the result for spam's known-sender check + the
// All/Warm-Up exclusion of bounced.
export interface PostgrestTabHints {
  // ILIKE pattern to match on subject. Empty means no constraint.
  subjectIlike?: string;
  subjectNotIlike?: string;
  // Classification IN (...) constraint
  classificationIn?: string[];
  // Classification = constraint
  classificationEq?: string;
  // Classification != constraint (used by All to exclude BOUNCE).
  classificationNotEq?: string;
}

export function postgrestHintsFor(tab: Tab): PostgrestTabHints {
  switch (tab) {
    case 'warm-up':
      return { subjectIlike: `%${WARMUP_SUBJECT_MARKER}%` };
    case 'interested':
      return {
        subjectNotIlike: `%${WARMUP_SUBJECT_MARKER}%`,
        classificationIn: [...INTERESTED_CLASSIFICATIONS],
      };
    case 'hot-leads':
      return {
        subjectNotIlike: `%${WARMUP_SUBJECT_MARKER}%`,
        classificationIn: [...HOT_LEAD_CLASSIFICATIONS],
      };
    case 'bounced':
      return { classificationEq: 'BOUNCE' };
    case 'spam':
      return { classificationEq: 'SPAM' };
    case 'all':
    default:
      // Cheap-pass: exclude warm-up by subject + bounced by classification.
      // JS-side matchesTab tightens spam (multi-signal AND) + warm-up self-test.
      return {
        subjectNotIlike: `%${WARMUP_SUBJECT_MARKER}%`,
        classificationNotEq: 'BOUNCE',
      };
  }
}
