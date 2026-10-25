// ============================================================
// The "no agent available" message a queued lead receives once.
// `{proximo_horario}` becomes e.g. "segunda-feira às 12:00" in the
// account's timezone; without a future schedule it is dropped and the
// sentence is sent without a date. A failed send is retried by the cron
// (nextNoticeRetry) instead of being lost.
// ============================================================

export const NEXT_SLOT_VARIABLE = '{proximo_horario}';

/**
 * "segunda-feira às 12:00" — weekday + time in `timeZone`. The joiner
 * comes from the i18n catalogue (`{weekday} às {time}` in pt).
 */
export function formatNextSlot(
  slot: Date,
  timeZone: string,
  locale: string,
  pattern: string,
): string {
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long' }).format(slot);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(slot);
  return pattern.replace('{weekday}', weekday).replace('{time}', time);
}

/** Fill `{proximo_horario}`; with no slot, remove it and tidy the spacing. */
export function renderQueueMessage(template: string, slotText: string | null): string {
  if (slotText) return template.split(NEXT_SLOT_VARIABLE).join(slotText);
  return template
    .split(NEXT_SLOT_VARIABLE)
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

/** Waits before each retry of a failed notice: 1, 5, 15, 60 minutes. */
export const QUEUE_NOTICE_RETRY_MINUTES = [1, 5, 15, 60];

/**
 * When to try the notice again after `attempts` failed sends, or null
 * when the retries are used up (5 sends in all) — then admins are told.
 */
export function nextNoticeRetry(attempts: number, now: Date): Date | null {
  const wait = QUEUE_NOTICE_RETRY_MINUTES[attempts - 1];
  return wait === undefined ? null : new Date(now.getTime() + wait * 60_000);
}
