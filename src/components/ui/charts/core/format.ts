export const shortDateFmt = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
export const weekdayDateFmt = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** `shortDateFmt` remembered by calendar day: it reads month and day only, so a day's rows (1,440 at one a minute) share one call. One per
 * build (the map holds a label per day seen). */
export function shortDateByDay(): (date: Date) => string {
  const byDay = new Map<number, string>();
  return (date) => {
    const day = date.getFullYear() * 512 + date.getMonth() * 32 + date.getDate();
    let label = byDay.get(day);
    if (label === undefined) {
      label = shortDateFmt.format(date);
      byDay.set(day, label);
    }
    return label;
  };
}
const intFormat = /* @__PURE__ */ new Intl.NumberFormat("en-US");
export const intFmt: Intl.NumberFormat["format"] = (value) => intFormat.format(value);
