import { CHART_PALETTE } from "../palette";
import type { MarkFrame } from "./types";

/** `color` mixed into the chart's surface: `percent` of the colour (100 is the colour itself). */
export const tint = (color: string, percent: number): string =>
  percent >= 100 ? color : `color-mix(in oklab, ${color} ${Math.round(percent)}%, var(--chart-background))`;

/** The palette colour of position `index`, from `colors` when given (cycled). */
export const paletteColor = (colors: readonly string[] | undefined, index: number): string => {
  const list = colors !== undefined && colors.length > 0 ? colors : CHART_PALETTE;
  return list[index % list.length] ?? CHART_PALETTE[0];
};

const ELLIPSIS = "…";

/** `text` as it fits in `room` px at `size` / `weight` (cut with an ellipsis), or null when not even a few characters fit. */
export const fitText = (text: string, room: number, size: number, weight: number, measure: MarkFrame["measure"]): string | null => {
  if (room <= size) {
    return null;
  }
  if (measure(text, size, weight) <= room) {
    return text;
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}${ELLIPSIS}`, size, weight) <= room) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo < 3 ? null : `${text.slice(0, lo).trimEnd()}${ELLIPSIS}`;
};

/** A share as a whole percentage (one decimal under 10%). */
export const percentText = (share: number): string => {
  const pct = share * 100;
  return pct > 0 && pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
};
