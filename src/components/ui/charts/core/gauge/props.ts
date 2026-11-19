import { DEFAULT_ACTIVE_FILL_OPACITY, DEFAULT_INACTIVE_FILL_OPACITY, DEFAULT_LINEAR_HEIGHT } from "./fills";
import type { GaugeProps, GaugeStatFormat } from "../types/gauge";

/** The centre / label stat's number format when `formatOptions` is left out. */
const defaultGaugeStatFormat: GaugeStatFormat = { maximumFractionDigits: 0, notation: "standard" };

type DefaultedProp = "arcStyle" | "arcThickness" | "zoneDisplay" | "orientation" | "totalNotches" | "spacing" | "notchCornerRadius" | "startAngle" | "endAngle" | "useGradient" | "defaultLabel" | "formatOptions" | "labelPlacement" | "labelAlign" | "inactiveFillOpacity" | "activeFillOpacity" | "notchLengthPercent" | "notchWidthPercent" | "linearHeight" | "enterStaggerScale";

/** `GaugeProps` with every defaulted prop set. */
export type ResolvedGaugeProps<Node> = Omit<GaugeProps<Node>, DefaultedProp> & Required<Pick<GaugeProps<Node>, DefaultedProp>>;

export const resolveGaugeProps = <Node>(p: GaugeProps<Node>): ResolvedGaugeProps<Node> => ({
  ...p,
  activeFillOpacity: p.activeFillOpacity ?? DEFAULT_ACTIVE_FILL_OPACITY,
  arcStyle: p.arcStyle ?? "notches",
  arcThickness: p.arcThickness ?? 0.035,
  defaultLabel: p.defaultLabel ?? "Total",
  endAngle: p.endAngle ?? 405,
  enterStaggerScale: p.enterStaggerScale ?? 1,
  formatOptions: p.formatOptions ?? defaultGaugeStatFormat,
  inactiveFillOpacity: p.inactiveFillOpacity ?? DEFAULT_INACTIVE_FILL_OPACITY,
  labelAlign: p.labelAlign ?? "start",
  labelPlacement: p.labelPlacement ?? "top",
  linearHeight: p.linearHeight ?? DEFAULT_LINEAR_HEIGHT,
  notchCornerRadius: p.notchCornerRadius ?? 0,
  notchLengthPercent: p.notchLengthPercent ?? 100,
  notchWidthPercent: p.notchWidthPercent ?? 80,
  orientation: p.orientation ?? "arc",
  spacing: p.spacing ?? 25,
  startAngle: p.startAngle ?? 135,
  totalNotches: p.totalNotches ?? 40,
  useGradient: p.useGradient ?? false,
  zoneDisplay: p.zoneDisplay ?? "band",
});

// A gauge has no focusable data: `keyboard: false` makes the native host tabIndex -1 (no tab stop) while the svg stays one
// role="img" that carries the reading: in its label by default, in its description when the caller names it.
const gaugeReading = (value: number): string => `${Math.round(value)}%`;

/** The svg's accessible name and description for a `value`, the caller's `label` and `description`. */
export const gaugeAria = (value: number, label: string | undefined, description: string | undefined): { readonly ariaLabel: string; readonly ariaDescription: string | undefined } =>
  label === undefined ? { ariaDescription: description, ariaLabel: `Gauge: ${gaugeReading(value)}` } : { ariaDescription: description ?? gaugeReading(value), ariaLabel: label };
