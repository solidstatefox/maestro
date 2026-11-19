import type { ProfitLossLegendProps } from "./types/legend";

/** @internal */
export const PROFIT_LOSS_POSITIVE_COLOR = "var(--chart-positive)";
/** @internal */
export const PROFIT_LOSS_NEGATIVE_COLOR = "var(--chart-negative)";
/** @internal */
export const PROFIT_LOSS_TOOLTIP_LABEL_FALLBACK = "Profit/Loss";

/** @internal */
export function profitLossColor(value: number): string {
  return value >= 0 ? PROFIT_LOSS_POSITIVE_COLOR : PROFIT_LOSS_NEGATIVE_COLOR;
}

/** @internal */
export function resolveProfitLossTooltipLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed || PROFIT_LOSS_TOOLTIP_LABEL_FALLBACK;
}

/** A run of consecutive rows that share one sign. */
export interface ProfitLossSegment {
  /** The rows of the run. */
  data: Record<string, unknown>[];
  /** Whether the run is at or above zero. */
  isPositive: boolean;
}

/** @internal */
export const PROFIT_LOSS_LEGEND_ITEMS = [
  { label: "Profit", value: 0, color: PROFIT_LOSS_POSITIVE_COLOR },
  { label: "Loss", value: 0, color: PROFIT_LOSS_NEGATIVE_COLOR },
] as const;

export const LEGEND_ALIGN_CLASSES: Record<NonNullable<ProfitLossLegendProps["align"]>, string> = {
  start: "bk-justify-start",
  center: "bk-justify-center",
  end: "bk-justify-end",
};
