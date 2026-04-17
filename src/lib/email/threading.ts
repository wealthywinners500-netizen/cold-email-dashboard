/**
 * Phase 2 — deterministic reply-header + subject builder for follow-up sends.
 *
 * "Real reply" policy: follow-up steps carry In-Reply-To + a full References
 * chain (not just the last Message-ID), and prefix the subject with a single
 * "Re:" when it's not already there. Gmail and Outlook render these as
 * native thread replies.
 *
 * Message-IDs are stored with angle brackets as Nodemailer returns them
 * (e.g. "<abc@domain.com>"). We preserve whatever shape history entries
 * provide — we do NOT strip or re-wrap.
 */

export interface HistoryEntry {
  step_index: number;
  message_id: string;
  sent_at: string;
  account_id: string;
}

export interface ThreadingHeaders {
  subject: string;
  inReplyTo: string | null;
  references: string | null;
}

/**
 * Build an RFC 2822 References header value from a history of prior sends.
 * Chronological by step_index, space-separated, angle brackets preserved.
 */
export function buildReferencesChain(history: HistoryEntry[]): string {
  if (!history || history.length === 0) return '';
  return history
    .slice()
    .sort((a, b) => a.step_index - b.step_index)
    .map((h) => h.message_id)
    .join(' ');
}

export interface BuildReplyHeadersInput {
  /** Subject rendered by the template engine for THIS step. May be empty. */
  stepSubject: string;
  /** Subject of the step whose thread we're replying into (usually step 0). */
  parentSubject: string;
  /** All prior outbound sends for this recipient+sequence. */
  history: HistoryEntry[];
  /** step.send_in_same_thread flag — user-configured on the step. */
  sendInSameThread: boolean;
}

/**
 * Decide subject + threading headers for a given step invocation.
 *
 * Follow-up is detected when history is non-empty AND either:
 *   - the step explicitly sets send_in_same_thread=true, OR
 *   - the step's rendered subject is empty (inherit parent subject).
 *
 * When not a follow-up: subject passes through unchanged, both headers null.
 * When a follow-up:
 *   - subject = stepSubject (or parentSubject if empty), prefixed with a
 *     single "Re:" if it doesn't already start with one (case-insensitive)
 *   - inReplyTo = last (highest step_index) history entry's message_id
 *   - references = full chronological chain, space-separated
 */
export function buildReplyHeaders(input: BuildReplyHeadersInput): ThreadingHeaders {
  const { stepSubject, parentSubject, history, sendInSameThread } = input;
  const stepSubjectTrimmed = (stepSubject ?? '').trim();

  const isFollowUp =
    Array.isArray(history) &&
    history.length > 0 &&
    (sendInSameThread === true || stepSubjectTrimmed === '');

  if (!isFollowUp) {
    return {
      subject: stepSubject,
      inReplyTo: null,
      references: null,
    };
  }

  const base = stepSubjectTrimmed === '' ? parentSubject : stepSubject;
  const subject = /^re:\s/i.test(base) ? base : `Re: ${base}`;

  const sorted = history.slice().sort((a, b) => a.step_index - b.step_index);
  const inReplyTo = sorted[sorted.length - 1].message_id;
  const references = buildReferencesChain(sorted);

  return { subject, inReplyTo, references };
}
