import { describe, it, expect } from 'vitest';
import {
  buildReferencesChain,
  buildReplyHeaders,
  type HistoryEntry,
} from '../threading';

function h(step: number, id: string, account = 'acc-x'): HistoryEntry {
  return {
    step_index: step,
    message_id: id,
    sent_at: new Date(2026, 3, 17, 10, step).toISOString(),
    account_id: account,
  };
}

describe('buildReferencesChain', () => {
  it('returns empty string for empty history', () => {
    expect(buildReferencesChain([])).toBe('');
  });

  it('returns single id with angle brackets preserved', () => {
    const chain = buildReferencesChain([h(0, '<abc@example.com>')]);
    expect(chain).toBe('<abc@example.com>');
  });

  it('returns space-separated chronological chain with brackets preserved', () => {
    const chain = buildReferencesChain([
      h(0, '<s0@example.com>'),
      h(1, '<s1@example.com>'),
      h(2, '<s2@example.com>'),
    ]);
    expect(chain).toBe('<s0@example.com> <s1@example.com> <s2@example.com>');
  });

  it('sorts by step_index even when input is out of order', () => {
    const chain = buildReferencesChain([
      h(2, '<s2@x>'),
      h(0, '<s0@x>'),
      h(1, '<s1@x>'),
    ]);
    expect(chain).toBe('<s0@x> <s1@x> <s2@x>');
  });
});

describe('buildReplyHeaders — non-follow-up', () => {
  it('empty history → passes subject through, null headers', () => {
    const r = buildReplyHeaders({
      stepSubject: 'Hello there',
      parentSubject: 'N/A',
      history: [],
      sendInSameThread: true,
    });
    expect(r.subject).toBe('Hello there');
    expect(r.inReplyTo).toBeNull();
    expect(r.references).toBeNull();
  });

  it('non-empty subject + sendInSameThread=false + no history → not a follow-up', () => {
    const r = buildReplyHeaders({
      stepSubject: 'First touch',
      parentSubject: 'parent',
      history: [],
      sendInSameThread: false,
    });
    expect(r.subject).toBe('First touch');
    expect(r.inReplyTo).toBeNull();
    expect(r.references).toBeNull();
  });
});

describe('buildReplyHeaders — follow-up', () => {
  const parent = 'Terraboost partnership';

  it('empty step subject + sendInSameThread=false + history.length > 0 → still follow-up (empty is stronger)', () => {
    const r = buildReplyHeaders({
      stepSubject: '',
      parentSubject: parent,
      history: [h(0, '<step0@x>')],
      sendInSameThread: false,
    });
    expect(r.subject).toBe(`Re: ${parent}`);
    expect(r.inReplyTo).toBe('<step0@x>');
    expect(r.references).toBe('<step0@x>');
  });

  it('non-empty subject + sendInSameThread=true + history → follow-up, keeps own subject prefixed', () => {
    const r = buildReplyHeaders({
      stepSubject: 'Quick follow-up',
      parentSubject: parent,
      history: [h(0, '<step0@x>')],
      sendInSameThread: true,
    });
    expect(r.subject).toBe('Re: Quick follow-up');
    expect(r.inReplyTo).toBe('<step0@x>');
    expect(r.references).toBe('<step0@x>');
  });

  it('parent subject already starts with "Re:" → does NOT double-prefix', () => {
    const r = buildReplyHeaders({
      stepSubject: '',
      parentSubject: 'Re: Already a reply',
      history: [h(0, '<step0@x>')],
      sendInSameThread: false,
    });
    expect(r.subject).toBe('Re: Already a reply');
  });

  it('step subject already starts with "Re:" → does NOT double-prefix', () => {
    const r = buildReplyHeaders({
      stepSubject: 'RE: keeping case flexible',
      parentSubject: parent,
      history: [h(0, '<step0@x>')],
      sendInSameThread: true,
    });
    expect(r.subject).toBe('RE: keeping case flexible');
  });

  it('4-entry history → inReplyTo = 4th id, references = all 4 in order', () => {
    const hist = [
      h(0, '<s0@x>', 'acc-1'),
      h(1, '<s1@x>', 'acc-1'),
      h(2, '<s2@x>', 'acc-2'),
      h(3, '<s3@x>', 'acc-2'),
    ];
    const r = buildReplyHeaders({
      stepSubject: '',
      parentSubject: parent,
      history: hist,
      sendInSameThread: true,
    });
    expect(r.inReplyTo).toBe('<s3@x>');
    expect(r.references).toBe('<s0@x> <s1@x> <s2@x> <s3@x>');
  });

  it('history out of order → sorted before inReplyTo / references derivation', () => {
    const hist = [h(2, '<s2@x>'), h(0, '<s0@x>'), h(1, '<s1@x>')];
    const r = buildReplyHeaders({
      stepSubject: '',
      parentSubject: parent,
      history: hist,
      sendInSameThread: true,
    });
    expect(r.inReplyTo).toBe('<s2@x>');
    expect(r.references).toBe('<s0@x> <s1@x> <s2@x>');
  });
});
