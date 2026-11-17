/** Calendar-day intervals are half-open [start, end); the RDF domain is inclusive.
 * This keeps year/month/week/day navigation consistent at every zoom level. */
export type TemporalDomain = { min: string; max: string };
export type TemporalPage = { start: string; end: string };
export function temporalPageOverlapsDomain(page: TemporalPage, domain: TemporalDomain | null): boolean {
  return !domain || (page.start <= domain.max && page.end > domain.min);
}
export function temporalDayDomain(value: string | null | undefined, edge: "min" | "max"): string | null {
  if (!value) return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ].*)?$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]), month = match[2] ? Number(match[2]) : edge === "min" ? 1 : 12;
  if (year < 1 || month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = match[3] ? Number(match[3]) : edge === "min" ? 1 : lastDay;
  if (day < 1 || day > lastDay) return null;
  return `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
