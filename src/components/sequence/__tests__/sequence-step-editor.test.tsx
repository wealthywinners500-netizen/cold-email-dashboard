/**
 * @vitest-environment jsdom
 *
 * Tests for SequenceStepEditor Phase 4 retrofit: new AI/spintax/grammar row,
 * grammar panel under the body textarea, modal mounted once outside the
 * variant loop. Flag off path stays pixel-identical to pre-phase-4.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SequenceStep } from '@/lib/supabase/types';

// ---- Mocks ---------------------------------------------------------------
// vi.mock() is hoisted to the top of the file, so any variables used inside
// factories must be created via vi.hoisted() to survive the lift.
const { flagMock } = vi.hoisted(() => ({ flagMock: vi.fn(() => true) }));

vi.mock('@/lib/featureFlags', () => ({
  isFeatureEnabledSync: flagMock,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The three Phase 3 components gate internally on the same flag; for editor
// unit tests we mock them to simple stubs so we can assert mount counts.
vi.mock('@/components/campaigns/add-random-spintax-button', () => ({
  AddRandomSpintaxButton: ({ value }: { value: string }) => (
    <div data-testid="add-spintax-btn">spintax-btn:{value.length}</div>
  ),
}));
vi.mock('@/components/campaigns/ai-copy-builder-modal', () => ({
  AICopyBuilderModal: ({ open }: { open: boolean }) => (
    <div data-testid="ai-copy-builder-modal">open:{String(open)}</div>
  ),
}));
vi.mock('@/components/campaigns/grammar-check', () => ({
  GrammarCheck: ({ text }: { text: string }) => (
    <div data-testid="grammar-check">grammar:{text.length}</div>
  ),
}));

import { SequenceStepEditor } from '../sequence-step-editor';

function makeSteps(opts: { bodyText?: string } = {}): SequenceStep[] {
  return [
    {
      step_number: 1,
      delay_days: 0,
      delay_hours: 0,
      subject: 'Hi',
      body_html: '',
      body_text: opts.bodyText ?? '',
      send_in_same_thread: false,
      ab_variants: [
        {
          variant: 'A',
          subject: 'Hi A',
          body_html: '',
          body_text: opts.bodyText ?? '',
        },
      ],
    },
  ];
}

beforeEach(() => {
  flagMock.mockReturnValue(true);
  vi.clearAllMocks();
});

describe('SequenceStepEditor — Phase 4 retrofit', () => {
  it('flag ON + editable: renders the new spintax/AI row + mounts modal once', () => {
    const steps = makeSteps({ bodyText: 'hello there' });
    render(<SequenceStepEditor steps={steps} onChange={() => {}} readOnly={false} />);

    // Existing merge-field buttons still render (no regression)
    expect(screen.getByText('first_name')).toBeInTheDocument();
    expect(screen.getByText('last_name')).toBeInTheDocument();
    expect(screen.getByText('company_name')).toBeInTheDocument();

    // New Phase 4 row
    expect(screen.getByTestId('add-spintax-btn')).toBeInTheDocument();
    expect(screen.getByText('AI Copy Builder')).toBeInTheDocument();

    // Modal mounted exactly once
    expect(screen.getAllByTestId('ai-copy-builder-modal')).toHaveLength(1);

    // Grammar panel renders (body_text is non-empty)
    expect(screen.getByTestId('grammar-check')).toBeInTheDocument();
  });

  it('flag ON + empty body: grammar panel does NOT render, spintax row still does', () => {
    render(
      <SequenceStepEditor steps={makeSteps({ bodyText: '' })} onChange={() => {}} readOnly={false} />
    );

    // Empty body short-circuits the grammar panel
    expect(screen.queryByTestId('grammar-check')).toBeNull();
    // But the spintax row is still there — user may type text in and it shows up
    expect(screen.getByTestId('add-spintax-btn')).toBeInTheDocument();
  });

  it('flag OFF: new row / grammar / modal are NOT rendered', () => {
    flagMock.mockReturnValue(false);
    render(
      <SequenceStepEditor steps={makeSteps({ bodyText: 'hi' })} onChange={() => {}} readOnly={false} />
    );

    // Old merge-field buttons still render
    expect(screen.getByText('first_name')).toBeInTheDocument();

    // Phase 4 additions all absent
    expect(screen.queryByTestId('add-spintax-btn')).toBeNull();
    expect(screen.queryByText('AI Copy Builder')).toBeNull();
    expect(screen.queryByTestId('grammar-check')).toBeNull();
    expect(screen.queryByTestId('ai-copy-builder-modal')).toBeNull();
  });

  it('readOnly=true + flag ON: new row / grammar / modal are NOT rendered', () => {
    render(
      <SequenceStepEditor steps={makeSteps({ bodyText: 'hi' })} onChange={() => {}} readOnly={true} />
    );

    // Old merge-field buttons also suppressed when readOnly (existing behavior)
    expect(screen.queryByText('first_name')).toBeNull();

    // Phase 4 additions all absent
    expect(screen.queryByTestId('add-spintax-btn')).toBeNull();
    expect(screen.queryByText('AI Copy Builder')).toBeNull();
    expect(screen.queryByTestId('grammar-check')).toBeNull();
    expect(screen.queryByTestId('ai-copy-builder-modal')).toBeNull();
  });

  it('existing merge-field button still appends to body (no regression)', () => {
    const onChange = vi.fn();
    render(<SequenceStepEditor steps={makeSteps()} onChange={onChange} readOnly={false} />);

    fireEvent.click(screen.getByText('first_name'));
    expect(onChange).toHaveBeenCalled();
    const newSteps = onChange.mock.calls[0][0] as SequenceStep[];
    // The button appends to body_text of the selected variant.
    expect(newSteps[0].ab_variants[0].body_text).toContain('{{first_name}}');
  });
});
