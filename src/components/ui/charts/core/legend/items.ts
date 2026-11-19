import type { StyleObject } from "../style";
import type { LegendItem, LegendItemContextValue, LegendItemData } from "../types/legend";

/** `value / maxValue` as a percentage. */
const PERCENT = 100;

/** The legend's theme variables (`legendCssVars`). @internal */
export const legendCssVars = {
  background: "var(--legend)",
  foreground: "var(--legend-foreground)",
  muted: "var(--legend-muted)",
  mutedForeground: "var(--legend-muted-foreground)",
  track: "var(--legend-track)",
};

/** bklit's truthiness test on `maxValue` (`Legend`, `LegendValue`, `LegendProgress`): set, non-zero and not NaN. */
export const hasLegendMax = (maxValue: number | undefined): maxValue is number => maxValue !== undefined && maxValue !== 0 && !Number.isNaN(maxValue);

/** A `ChartLegend` row's state: its hover flags and `ChartLegend`'s percentage (a missing or zero maximum is 0; a NaN one stays NaN). */
export const chartLegendRowState = (
  item: LegendItem,
  index: number,
  hoveredIndex: number | null,
): { readonly isHovered: boolean; readonly isFaded: boolean; readonly percentage: number } => {
  const maxValue = item.maxValue ?? 0;
  return {
    isHovered: hoveredIndex === index,
    isFaded: hoveredIndex !== null && hoveredIndex !== index,
    percentage: maxValue === 0 ? 0 : (item.value / maxValue) * PERCENT,
  };
};

/** Whether a `ChartLegend` row draws the progress item (`showProgress` and a maximum that isn't missing or zero) rather than the plain one. */
export const chartLegendShowsProgress = (item: LegendItem, showProgress: boolean): boolean => showProgress && (item.maxValue ?? 0) !== 0;

/** `Legend`'s item contexts, one per item (what `useLegendItem()` returns inside each). */
export const legendItemContexts = (items: readonly LegendItemData[], hoveredIndex: number | null): LegendItemContextValue[] =>
  items.map((item, index) => ({
    item,
    index,
    isHovered: hoveredIndex === index,
    isFaded: hoveredIndex !== null && hoveredIndex !== index,
    percentage: hasLegendMax(item.maxValue) ? (item.value / item.maxValue) * PERCENT : 0,
  }));

/** A percentage rounded to a whole number, then `%`: `LegendValue`'s default format and the `ChartLegend` progress item's text. */
export const formatWholePercent = (percentage: number): string => `${percentage.toFixed(0)}%`;

/** A default `ChartLegend` row's `<button>` reset: only the UA chrome the div never had (padding, cursor and background come from classes). */
export const LEGEND_ROW_BUTTON_STYLE: StyleObject = { border: "none", color: "inherit", font: "inherit", margin: 0, "text-align": "left" };

/** A `renderItem` row's `<button>` reset: all of the UA chrome (the bare div had no padding, margin, color or cursor). */
export const LEGEND_CUSTOM_ROW_BUTTON_STYLE: StyleObject = {
  border: "none",
  color: "inherit",
  cursor: "inherit",
  font: "inherit",
  margin: 0,
  padding: 0,
  "text-align": "left",
};
