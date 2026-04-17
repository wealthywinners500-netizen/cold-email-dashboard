/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// vi.mock() is hoisted to the top of the file. Variables used inside the
// mock factories must be declared via vi.hoisted() so they exist at hoist
// time, not later at normal module-body evaluation.
const { flagMock, routerRefresh } = vi.hoisted(() => ({
  flagMock: vi.fn(() => true),
  routerRefresh: vi.fn(),
}));

vi.mock('@/lib/featureFlags', () => ({
  isFeatureEnabledSync: flagMock,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh, push: vi.fn() }),
}));

import CreateCampaignModal from '../create-campaign-modal';

const fetchMock = vi.fn();

beforeEach(() => {
  flagMock.mockReturnValue(true);
  fetchMock.mockReset();
  routerRefresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: 'camp-1' }), { status: 201 })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CreateCampaignModal — Phase 4 v2 sections', () => {
  it('flag ON: expanded sections render', () => {
    render(<CreateCampaignModal open={true} onOpenChange={() => {}} />);
    expect(screen.getByText('Sending Window')).toBeInTheDocument();
    expect(screen.getByText('Tracking')).toBeInTheDocument();
    expect(screen.getByText('Unsubscribe')).toBeInTheDocument();
    expect(screen.getByText('Ramp-up (optional)')).toBeInTheDocument();
  });

  it('flag OFF: expanded sections do NOT render', () => {
    flagMock.mockReturnValue(false);
    render(<CreateCampaignModal open={true} onOpenChange={() => {}} />);
    expect(screen.queryByText('Sending Window')).toBeNull();
    expect(screen.queryByText('Tracking')).toBeNull();
    expect(screen.queryByText('Unsubscribe')).toBeNull();
    expect(screen.queryByText('Ramp-up (optional)')).toBeNull();
    // Core 4 fields still present
    expect(screen.getByText('Campaign Name')).toBeInTheDocument();
    expect(screen.getByText('Region')).toBeInTheDocument();
  });

  it('toggling track_opens shows the deliverability warning banner', () => {
    render(<CreateCampaignModal open={true} onOpenChange={() => {}} />);
    // No warning initially
    expect(
      screen.queryByText(/Tracking can hurt deliverability/)
    ).toBeNull();

    // Click the track_opens checkbox
    fireEvent.click(screen.getByLabelText(/Track opens/));

    // Banner appears
    expect(
      screen.getByText(/Tracking can hurt deliverability/)
    ).toBeInTheDocument();
  });

  it('toggling ramp_enabled shows the three ramp inputs', () => {
    render(<CreateCampaignModal open={true} onOpenChange={() => {}} />);
    // Ramp inputs absent initially
    expect(screen.queryByText(/Start rate/)).toBeNull();

    fireEvent.click(screen.getByLabelText(/Enable ramp-up/));

    expect(screen.getByText(/Start rate/)).toBeInTheDocument();
    expect(screen.getByText(/Daily \+/)).toBeInTheDocument();
    expect(screen.getByText(/Target/)).toBeInTheDocument();
  });

  it('submit sends all v2 fields in POST body', async () => {
    render(<CreateCampaignModal open={true} onOpenChange={() => {}} />);

    // Toggle the v2 booleans first so we verify they land in the payload.
    fireEvent.click(screen.getByLabelText(/Track opens/));
    fireEvent.click(screen.getByLabelText(/Enable ramp-up/));

    // Fill required fields via name-attribute lookups (labels aren't `htmlFor`-
    // associated in this markup).
    const form = screen.getByRole('button', { name: /Create/ }).closest('form')!;
    const nameInput = form.querySelector('input[name="name"]') as HTMLInputElement;
    const regionInput = form.querySelector('input[name="region"]') as HTMLInputElement;
    const storeInput = form.querySelector('input[name="store_chain"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Test' } });
    fireEvent.change(regionInput, { target: { value: 'NY' } });
    fireEvent.change(storeInput, { target: { value: 'Tops' } });

    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    // Let the async submit handler settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/campaigns');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    const payload = JSON.parse(String(init.body));
    expect(payload.name).toBe('Test');
    expect(payload.region).toBe('NY');
    expect(payload.store_chain).toBe('Tops');
    expect(payload.track_opens).toBe(true);
    expect(payload.ramp_enabled).toBe(true);
    expect(payload.sending_schedule).toEqual(
      expect.objectContaining({
        start_hour: 9,
        end_hour: 17,
        timezone: 'America/New_York',
        days_of_week: expect.any(Array),
      })
    );
  });
});
