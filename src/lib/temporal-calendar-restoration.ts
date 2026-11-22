/** Calendar viewport restoration from authoritative FCT temporal bounds.
 * Display month is presentation, NOT another query constraint or saved value.
 * All dates are UTC to avoid DST and browser-local midnight shifts.
 */
export type CalendarDomain = { min: string; max: string } | null;

function datePrefix(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const yyyy = Number(match[1]), mm = Number(match[2]), dd = Number(match[3]);
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  return date.getUTCFullYear() === yyyy && date.getUTCMonth() === mm - 1 && date.getUTCDate() === dd
    ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Restore From first, then To; otherwise today. Clamp to actual facet domain. */
export function restoredCalendarDate(
  from: string, to: string, domain: CalendarDomain = null, today = new Date(),
): Date {
  const picked = datePrefix(from) ?? datePrefix(to) ?? today.toISOString().slice(0, 10);
  let day = picked;
  const min = datePrefix(domain?.min ?? ""), max = datePrefix(domain?.max ?? "");
  if (min && day < min) day = min;
  if (max && day > max) day = max;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

export function restoredCalendarWeekStart(date: Date): Date {
  return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000);
}
