import type { ChartTheme } from "@tanstack/charts";
import { bklitTooltipPlacement } from "./tooltip/bklit-tooltip-portal";
import { REST_PX } from "./motion/spring-curve";
import { TOOLTIP_BOX_SPRING } from "./motion/springs";
import { isFiniteNumber, isString, leadingFloat } from "./guards";
import { CHART_PALETTE } from "./palette";
import type { StyleObject } from "./style";

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: ChartMargin = { top: 40, right: 40, bottom: 40, left: 40 };
export const DEFAULT_ANIMATION_MS = 1100;
const DEFAULT_ASPECT_RATIO = 2;
export const DEFAULT_LINE_STROKE = "var(--chart-line-primary)";
export const DEFAULT_GRID_STROKE = "var(--chart-grid)";

/**
 * Text drawn in a series' colour (an end label, an annotation, an emphasised total): the colour pulled a third of the way toward the theme's
 * foreground, so it keeps its hue and reads at 4.5:1 on the card for shadcn's default palettes in light and dark (a light series darkens on
 * a light theme, a dark one lightens on a dark theme). `--chart-series-text-mix` (styles/base.css) sets how much of the series stays.
 */
/**
 * Text drawn on a mark (a treemap cell's name, a stream's label): black on a light fill, white on a dark one, whichever reads better, from
 * the fill itself (CSS relative colour: its CIE lightness against 49.44, where black and white tie at 4.6:1). So a label passes 4.5:1 on
 * any fill a palette or a theme gives it.
 */
export const contrastingText = (fill: string): string => `lch(from ${fill} calc((49.44 - l) * infinity) 0 0)`;

/** Secondary text on a light tint of a series (a treemap branch's header total): the label colour a fifth of the way to the foreground. */
export const STRONG_LABEL = "color-mix(in oklab, var(--chart-label) 80%, var(--bkm-foreground))";

export const seriesTextColor = (color: string): string => `color-mix(in oklab, ${color} var(--chart-series-text-mix, 65%), var(--chart-series-text-toward, var(--bkm-foreground)))`;

/** Native theme tokens (foreground, grid, background) mapped to bklit's CSS variables. */
export const bklitTheme: Partial<ChartTheme> = {
  foreground: "var(--chart-foreground)",
  muted: "var(--chart-label)",
  grid: "var(--chart-grid)",
  background: "transparent",
  palette: CHART_PALETTE,
};

/** Container style: maps the native `--ts-chart-*` hooks (tooltip panel, focus fill, crosshair halo) onto bklit tokens,
 * so the built-in tooltip surface renders like bklit's TooltipBox. */
export const bklitSurfaceStyle: StyleObject = {
  "--ts-chart-tooltip-background": "var(--chart-tooltip-background)",
  "--ts-chart-tooltip-color": "var(--chart-tooltip-foreground)",
  "--ts-chart-tooltip-border": "0",
  "--ts-chart-tooltip-border-radius": "var(--radius-lg, 0.5rem)",
  "--ts-chart-tooltip-padding": "0",
  "--ts-chart-tooltip-max-width": "none",
  "--ts-chart-tooltip-shadow":
    "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  "--ts-chart-tooltip-font": "400 0.875rem/1.25rem var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
  "--ts-chart-focus-fill": "var(--chart-background)",
  "--ts-chart-crosshair-label-halo": "transparent",
};

/** Parses bklit's `"2 / 1"` / `"16/9"` / numeric aspect ratio into a number. */
export function parseAspectRatio(value: string | number | undefined): number {
  if (isFiniteNumber(value) && value > 0) {
    return value;
  }
  if (isString(value)) {
    const [w, h] = value.split("/").map((part) => leadingFloat(part.trim()));
    if (isFiniteNumber(w) && isFiniteNumber(h) && w !== 0 && h > 0) {
      return w / h;
    }
    const single = leadingFloat(value);
    if (Number.isFinite(single) && single > 0) {
      return single;
    }
  }
  return DEFAULT_ASPECT_RATIO;
}

/** Native tooltip presence + movement transition (`tooltip.motion` takes a bare transition, NOT a `{ transition }` definition).
 * bklit TooltipBox follows the pointer with tooltipBoxSpring (100/20 in bklit; TOOLTIP_BOX_SPRING, the snappy variant's hover spring, here). */
export const TOOLTIP_MOTION = /* @__PURE__ */ (() => ({ type: "spring", ...TOOLTIP_BOX_SPRING, restSpeed: REST_PX.speed, restDelta: REST_PX.delta } as const))();

export const TOOLTIP_OFFSET = 16;

export const MS_PER_SECOND = 1000;

/** bklit TooltipBox placement: panel top aligned with the plot top, `offset` px right of the focused x, flipping left when `x + width + offset` passes the chart width
 * (position-only portal, container-relative). */
export const BKLIT_TOOLTIP_PLACEMENT = {
  // Declarative anchor: the renderer then skips repainting the tooltip while the pointer moves within one focused point.
  anchor: { x: "value", y: "plot-top" },
  offset: TOOLTIP_OFFSET,
  portal: /* @__PURE__ */ bklitTooltipPlacement({ pinTop: true }),
} as const;

/** bklit's x tick labels (HTML spans, text-xs/16px) sit 12px under the plot bottom; the native label box starts ~2.4px above the axis line at padding 0,
 * so 14.4px lands the box top on bklit's. The date pill follows it. */
export const X_TICK_PADDING = 14.4;
