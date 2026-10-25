// ============================================================
// Agent schedules in the account's timezone — docs/saas/setores-e-distribuicao.md.
//
// A schedule range is a wall-clock window on a weekday (0 = Sunday) in
// the ACCOUNT's timezone. An agent with no ranges is never available —
// sector members are required to have one (migration 064).
// Pure: no DB, no clock — `now` is always passed in.
// ============================================================

export interface ScheduleRange {
  weekday: number; // 0 = Sunday … 6 = Saturday
  start: string; // "HH:MM" (seconds ignored)
  end: string; // "HH:MM", after start, same day
}

/** Minutes since midnight of an "HH:MM[:SS]" string. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday, wall-clock minutes and calendar date of `instant` in `timeZone`. */
export function zonedParts(
  instant: Date,
  timeZone: string,
): { weekday: number; minutes: number; year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: WEEKDAYS.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

/** True when `now` falls inside one of the ranges (false with none). */
export function isWithinSchedule(ranges: ScheduleRange[], now: Date, timeZone: string): boolean {
  const { weekday, minutes } = zonedParts(now, timeZone);
  return ranges.some(
    (r) => r.weekday === weekday && minutes >= toMinutes(r.start) && minutes < toMinutes(r.end),
  );
}

/**
 * The UTC instant of a wall-clock time on a calendar date in `timeZone`.
 * Two passes absorb a DST shift between the guess and the result.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
): Date {
  const wanted = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60);
    guess += wanted - seen;
  }
  return new Date(guess);
}

/**
 * Earliest range START strictly after `now`, across all given ranges,
 * looking one week ahead (a range can be next week's same weekday).
 * Null when there are no ranges.
 */
export function nextScheduleStart(
  ranges: ScheduleRange[],
  now: Date,
  timeZone: string,
): Date | null {
  if (ranges.length === 0) return null;
  const today = zonedParts(now, timeZone);
  let best: Date | null = null;
  for (let offset = 0; offset <= 7; offset++) {
    // Calendar date `offset` days after today's local date.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = (today.weekday + offset) % 7;
    for (const r of ranges) {
      if (r.weekday !== weekday) continue;
      const start = zonedTimeToUtc(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        toMinutes(r.start),
        timeZone,
      );
      if (start.getTime() > now.getTime() && (!best || start < best)) best = start;
    }
    if (best) return best;
  }
  return best;
}
