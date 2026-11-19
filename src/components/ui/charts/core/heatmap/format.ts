const ORDINAL_TEEN_START = 11;
const ORDINAL_TEEN_END = 13;
const ORDINAL_SUFFIX_MOD = 10;
const ORDINAL_RD_SUFFIX_DIGIT = 3;

const formatHeatmapOrdinalDay = (day: number): string => {
  if (day >= ORDINAL_TEEN_START && day <= ORDINAL_TEEN_END) {return `${day}th`;}
  switch (day % ORDINAL_SUFFIX_MOD) {
    case 1: {
      return `${day}st`;
    }
    case 2: {
      return `${day}nd`;
    }
    case ORDINAL_RD_SUFFIX_DIGIT: {
      return `${day}rd`;
    }
    default: {
      return `${day}th`;
    }
  }
}

const heatmapTooltipMonthFmt = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "long" });
const heatmapTooltipWeekdayFmt = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { weekday: "long" });
const heatmapMonthShortFmt = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "short" });

export const formatHeatmapMonthShort = (date: Readonly<Date>): string => heatmapMonthShortFmt.format(date);


/**
 * Tooltip header date, e.g. `January 20th 2026`.
 * @internal
 */
export const formatHeatmapTooltipDate = (date: Readonly<Date>): string => {
  const month = heatmapTooltipMonthFmt.format(date);
  const day = formatHeatmapOrdinalDay(date.getDate());
  return `${month} ${day} ${date.getFullYear()}`;
}

/**
 * Tooltip weekday line, e.g. `Monday`.
 * @internal
 */
export const formatHeatmapTooltipWeekday = (date: Readonly<Date>): string => heatmapTooltipWeekdayFmt.format(date);


/**
 * Tooltip contribution line, e.g. `3 contributions`; `_secondaryDate` is unused (call-site symmetry with other formatters).
 * @internal
 */
export const formatHeatmapContributionLabel = (count: number, _secondaryDate?: Readonly<Date>): string => {
  const word = count === 1 ? "contribution" : "contributions";
  return `${count} ${word}`;
}
