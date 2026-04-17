/**
 * Phase 1 — smart sending helpers.
 *
 * Exports:
 *   isWithinWindow(schedule, now?) — is `now` inside the campaign's sending window?
 *   nextWindowOpen(schedule, after) — next ISO timestamp at which the window opens
 *   getEffectiveCap(account, campaign) — account.daily_send_limit clamped by the
 *     optional per-campaign ramp-up.
 *
 * The shape of `schedule` matches what's already in campaigns.sending_schedule
 * (migration 003 default). Day labels: sun/mon/tue/wed/thu/fri/sat.
 */

import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addDays, startOfDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface SendingSchedule {
  send_between_hours: [number, number];
  timezone: string;
  days: Weekday[];
  max_per_day?: number;
  per_account_per_hour?: number;
}

export const DEFAULT_SCHEDULE: SendingSchedule = {
  send_between_hours: [9, 17],
  timezone: 'America/New_York',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  max_per_day: 500,
  per_account_per_hour: 13,
};

const WEEKDAY_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Coerce whatever the DB gave us (JSONB with looser typing) into a validated
 * SendingSchedule. Missing fields fall back to DEFAULT_SCHEDULE.
 */
export function normalizeSchedule(input: unknown): SendingSchedule {
  if (!input || typeof input !== 'object') return DEFAULT_SCHEDULE;
  const raw = input as Record<string, unknown>;

  const hours = raw.send_between_hours;
  const send_between_hours: [number, number] =
    Array.isArray(hours) && hours.length === 2 && typeof hours[0] === 'number' && typeof hours[1] === 'number'
      ? [hours[0], hours[1]]
      : DEFAULT_SCHEDULE.send_between_hours;

  const tz = typeof raw.timezone === 'string' ? raw.timezone : DEFAULT_SCHEDULE.timezone;

  // Accept either "days" (spec) or legacy "allowed_days" (distribute-campaign-sends).
  const rawDays = Array.isArray(raw.days)
    ? raw.days
    : Array.isArray(raw.allowed_days)
    ? raw.allowed_days
    : DEFAULT_SCHEDULE.days;
  const days: Weekday[] = rawDays.filter((d): d is Weekday =>
    typeof d === 'string' && WEEKDAY_INDEX.includes(d as Weekday)
  );

  return {
    send_between_hours,
    timezone: tz,
    days: days.length > 0 ? days : DEFAULT_SCHEDULE.days,
    max_per_day: typeof raw.max_per_day === 'number' ? raw.max_per_day : DEFAULT_SCHEDULE.max_per_day,
    per_account_per_hour:
      typeof raw.per_account_per_hour === 'number'
        ? raw.per_account_per_hour
        : DEFAULT_SCHEDULE.per_account_per_hour,
  };
}

/**
 * True if `now` (defaults to current time) is inside the campaign's sending
 * window in the campaign's timezone.
 */
export function isWithinWindow(schedule: SendingSchedule, now: Date = new Date()): boolean {
  const zoned = toZonedTime(now, schedule.timezone);
  const dayLabel = WEEKDAY_INDEX[zoned.getDay()];
  if (!schedule.days.includes(dayLabel)) return false;

  const [startH, endH] = schedule.send_between_hours;
  const hour = zoned.getHours();
  return hour >= startH && hour < endH;
}

/**
 * Return the next Date (in UTC) at which the sending window opens strictly
 * after `after`. If `after` is already inside the window, returns `after`.
 */
export function nextWindowOpen(schedule: SendingSchedule, after: Date = new Date()): Date {
  if (isWithinWindow(schedule, after)) return after;

  const [startH] = schedule.send_between_hours;
  let cursor = toZonedTime(after, schedule.timezone);

  // Advance at most 7 days looking for the next valid day-hour pair.
  for (let i = 0; i < 8; i++) {
    const dayLabel = WEEKDAY_INDEX[cursor.getDay()];
    const candidate = setMilliseconds(
      setSeconds(setMinutes(setHours(cursor, startH), 0), 0),
      0
    );

    if (schedule.days.includes(dayLabel)) {
      // Same-day open: candidate is today at startH. If we're already past
      // the window close, fall through to tomorrow.
      if (candidate.getTime() > cursor.getTime()) {
        return fromZonedTime(candidate, schedule.timezone);
      }
      // If same-day startH has already passed AND we're before endH, we'd
      // already be inside — that was caught by isWithinWindow above. So we
      // must be past endH; roll to next allowed day.
    }

    cursor = startOfDay(addDays(cursor, 1));
  }

  // Fallback — should be unreachable given the 7-day cycle, but return a
  // reasonable value.
  return fromZonedTime(setHours(startOfDay(addDays(cursor, 1)), startH), schedule.timezone);
}

export interface CapAccount {
  daily_send_limit: number;
  sends_today: number;
}

export interface CapCampaign {
  ramp_enabled?: boolean | null;
  ramp_start_rate?: number | null;
  ramp_increment?: number | null;
  ramp_target_rate?: number | null;
  ramp_started_at?: string | null;
}

/**
 * Effective daily cap for a given account+campaign pair. If the campaign has
 * ramp-up enabled, the cap is the smaller of the account limit and the linearly
 * ramped target. Matches the formula in the Phase 1 spec.
 */
export function getEffectiveCap(account: CapAccount, campaign: CapCampaign, now: Date = new Date()): number {
  const accountLimit = account.daily_send_limit;

  if (!campaign.ramp_enabled || !campaign.ramp_started_at) {
    return accountLimit;
  }

  const start = campaign.ramp_start_rate ?? 0;
  const inc = campaign.ramp_increment ?? 0;
  const target = campaign.ramp_target_rate ?? accountLimit;
  const rampStart = new Date(campaign.ramp_started_at).getTime();
  if (!Number.isFinite(rampStart)) return accountLimit;

  const daysSinceLaunch = Math.max(0, Math.floor((now.getTime() - rampStart) / 86400000));
  const rampCap = Math.min(target, start + daysSinceLaunch * inc);

  return Math.min(rampCap, accountLimit);
}
