import { intFmt } from "../format";
import type { FunnelChartProps } from "../types/funnel";

type DefaultedProp = "orientation" | "color" | "layers" | "showPercentage" | "showValues" | "showLabels" | "formatPercentage" | "formatValue" | "staggerDelay" | "gap" | "edges" | "labelLayout" | "labelAlign" | "grid";

/** `FunnelChartProps` with every defaulted prop set. */
export type ResolvedFunnelProps<Node, Style> = Omit<FunnelChartProps<Node, Style>, DefaultedProp> & Required<Pick<FunnelChartProps<Node, Style>, DefaultedProp>>;

const fmtPct = (pct: number): string => `${Math.round(pct)}%`;

const or = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);

export const resolveFunnelProps = <Node, Style>(p: Readonly<FunnelChartProps<Node, Style>>): ResolvedFunnelProps<Node, Style> => ({
  ...p,
  color: or(p.color, "var(--chart-1)"),
  edges: or(p.edges, "curved"),
  formatPercentage: or(p.formatPercentage, fmtPct),
  formatValue: or(p.formatValue, intFmt),
  gap: or(p.gap, 4),
  grid: or(p.grid, false),
  labelAlign: or(p.labelAlign, "center"),
  labelLayout: or(p.labelLayout, "spread"),
  layers: or(p.layers, 3),
  orientation: or(p.orientation, "horizontal"),
  showLabels: or(p.showLabels, true),
  showPercentage: or(p.showPercentage, true),
  showValues: or(p.showValues, true),
  staggerDelay: or(p.staggerDelay, 0.12),
});
