import { describe, it, expect } from 'vitest';
import {
  isWithinWindow,
  nextWindowOpen,
  getEffectiveCap,
  normalizeSchedule,
  DEFAULT_SCHEDULE,
  type SendingSchedule,
} from '../smart-sending';

// Reference schedule: Mon-Fri, 9am-5pm America/New_York.
const DEFAULT: SendingSchedule = {
  send_between_hours: [9, 17],
  timezone: 'America/New_York',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  max_per_day: 500,
  per_account_per_hour: 13,
};

describe('isWithinWindow', () => {
  it('is true at 2pm ET on a Wednesday', () => {
    // 2026-04-15 was a Wednesday. 14:00 America/New_York = 18:00 UTC (EDT, -4).
    const wed2pmNY = new Date('2026-04-15T18:00:00Z');
    expect(isWithinWindow(DEFAULT, wed2pmNY)).toBe(true);
  });

  it('is false at 8am ET on a Monday (before window)', () => {
    // 2026-04-13 Mon 08:00 ET = 12:00 UTC (EDT)
    const mon8amNY = new Date('2026-04-13T12:00:00Z');
    expect(isWithinWindow(DEFAULT, mon8amNY)).toBe(false);
  });

  it('is false at 6pm ET on a Friday (after window)', () => {
    // 2026-04-17 Fri 18:00 ET = 22:00 UTC (EDT)
    const fri6pmNY = new Date('2026-04-17T22:00:00Z');
    expect(isWithinWindow(DEFAULT, fri6pmNY)).toBe(false);
  });

  it('is false on Saturday regardless of hour', () => {
    // 2026-04-18 Sat 14:00 ET = 18:00 UTC (EDT)
    const sat2pmNY = new Date('2026-04-18T18:00:00Z');
    expect(isWithinWindow(DEFAULT, sat2pmNY)).toBe(false);
  });

  it('respects a different timezone', () => {
    const pacific: SendingSchedule = { ...DEFAULT, timezone: 'America/Los_Angeles' };
    // Wed 14:00 Pacific = 21:00 UTC (PDT, -7)
    const wed2pmPT = new Date('2026-04-15T21:00:00Z');
    expect(isWithinWindow(pacific, wed2pmPT)).toBe(true);
    // Wed 14:00 UTC = 07:00 Pacific = before window
    const wed14utc = new Date('2026-04-15T14:00:00Z');
    expect(isWithinWindow(pacific, wed14utc)).toBe(false);
  });
});

describe('nextWindowOpen', () => {
  it('returns Monday 9am when called on Saturday', () => {
    const sat = new Date('2026-04-18T18:00:00Z'); // Sat
    const opens = nextWindowOpen(DEFAULT, sat);
    // Expect Monday 2026-04-20 at 09:00 ET = 13:00 UTC (EDT)
    expect(opens.toISOString()).toBe('2026-04-20T13:00:00.000Z');
  });

  it('returns same-day 9am when called before the window', () => {
    const mon6amNY = new Date('2026-04-13T10:00:00Z'); // Mon 06:00 ET
    const opens = nextWindowOpen(DEFAULT, mon6amNY);
    expect(opens.toISOString()).toBe('2026-04-13T13:00:00.000Z'); // Mon 09:00 ET
  });

  it('returns next-day 9am when called after the window closes', () => {
    const mon6pmNY = new Date('2026-04-13T22:00:00Z'); // Mon 18:00 ET
    const opens = nextWindowOpen(DEFAULT, mon6pmNY);
    expect(opens.toISOString()).toBe('2026-04-14T13:00:00.000Z'); // Tue 09:00 ET
  });

  it('returns the passed-in date when already inside the window', () => {
    const wed2pmNY = new Date('2026-04-15T18:00:00Z');
    const opens = nextWindowOpen(DEFAULT, wed2pmNY);
    expect(opens.getTime()).toBe(wed2pmNY.getTime());
  });
});

describe('getEffectiveCap', () => {
  const account = { daily_send_limit: 200, sends_today: 0 };

  it('returns account limit when ramp_enabled is false', () => {
    expect(getEffectiveCap(account, { ramp_enabled: false })).toBe(200);
  });

  it('returns account limit when ramp_enabled is true but ramp_started_at is null', () => {
    expect(getEffectiveCap(account, { ramp_enabled: true, ramp_started_at: null })).toBe(200);
  });

  it('clamps to ramp_start_rate on day 0', () => {
    const now = new Date('2026-04-17T12:00:00Z');
    const start = new Date('2026-04-17T00:00:00Z').toISOString();
    const cap = getEffectiveCap(
      account,
      {
        ramp_enabled: true,
        ramp_start_rate: 20,
        ramp_increment: 5,
        ramp_target_rate: 50,
        ramp_started_at: start,
      },
      now
    );
    expect(cap).toBe(20);
  });

  it('ramps linearly by ramp_increment per day', () => {
    const now = new Date('2026-04-20T12:00:00Z'); // 3 days after start
    const start = new Date('2026-04-17T00:00:00Z').toISOString();
    const cap = getEffectiveCap(
      account,
      {
        ramp_enabled: true,
        ramp_start_rate: 20,
        ramp_increment: 5,
        ramp_target_rate: 50,
        ramp_started_at: start,
      },
      now
    );
    // day 3: 20 + 3*5 = 35
    expect(cap).toBe(35);
  });

  it('tops out at ramp_target_rate even after many days', () => {
    const now = new Date('2026-05-17T12:00:00Z'); // 30 days after start
    const start = new Date('2026-04-17T00:00:00Z').toISOString();
    const cap = getEffectiveCap(
      account,
      {
        ramp_enabled: true,
        ramp_start_rate: 20,
        ramp_increment: 5,
        ramp_target_rate: 50,
        ramp_started_at: start,
      },
      now
    );
    expect(cap).toBe(50); // capped at target
  });

  it('returns the smaller of ramp cap and account limit', () => {
    const smallAccount = { daily_send_limit: 30, sends_today: 0 };
    const now = new Date('2026-05-17T12:00:00Z');
    const start = new Date('2026-04-17T00:00:00Z').toISOString();
    const cap = getEffectiveCap(
      smallAccount,
      {
        ramp_enabled: true,
        ramp_start_rate: 20,
        ramp_increment: 5,
        ramp_target_rate: 50,
        ramp_started_at: start,
      },
      now
    );
    // ramp says 50, account says 30 → min=30
    expect(cap).toBe(30);
  });
});

describe('normalizeSchedule', () => {
  it('falls back to DEFAULT_SCHEDULE on null input', () => {
    expect(normalizeSchedule(null)).toEqual(DEFAULT_SCHEDULE);
  });

  it('accepts legacy allowed_days field (existing distribute-campaign-sends format)', () => {
    const n = normalizeSchedule({
      send_between_hours: [10, 16],
      timezone: 'UTC',
      allowed_days: ['mon', 'wed', 'fri'],
    });
    expect(n.days).toEqual(['mon', 'wed', 'fri']);
  });

  it('drops invalid day labels', () => {
    const n = normalizeSchedule({ days: ['mon', 'funday', 'fri'] });
    expect(n.days).toEqual(['mon', 'fri']);
  });

  it('defaults to Mon-Fri when days is empty after filtering', () => {
    const n = normalizeSchedule({ days: ['junk', 'garbage'] });
    expect(n.days).toEqual(DEFAULT_SCHEDULE.days);
  });
});
