import type { ChartScene } from "@tanstack/charts";
import { px } from "../style";
import type { StyleObject } from "../style";
import { defaultSunburstGrowPadding } from "./arcs";
import type { Focus, SunburstModel, SunburstNode } from "./arcs";

export const DEFAULT_SIZE = 520;
export const DEFAULT_HOVER_POP = 8;
export const DEFAULT_ARIA_DESCRIPTION = "Use arrow keys to inspect segments and Enter or Space to zoom into a branch. Once zoomed in, press Escape, or arrow to the center disc and press Enter or Space, to zoom out.";

/** The chart's accessible label: `ariaLabel`, else one naming the root. */
export const sunburstAriaLabel = (data: SunburstNode, ariaLabel: string | undefined): string => ariaLabel ?? `Sunburst chart of ${data.name}`;

interface ShownFocus {
  /** Undefined only when the model has no root focus: the chart renders nothing. */
  readonly focus: Focus | undefined;
  readonly focusId: string;
}

/** The focus the chart shows for the requested id (the `focusId` prop or the internal one): that node, else the root. */
export const resolveFocus = (model: SunburstModel, requestedFocusId: string): ShownFocus => {
  const focus = model.focusById.get(requestedFocusId) ?? model.focusById.get(model.rootId);
  return { focus, focusId: focus?.id ?? model.rootId };
};

interface MetricsInput {
  /** The stage's measured width (0 before it is measured). */
  readonly stageWidth: number;
  readonly size: number;
  /** The `padding` prop (relative to `size`), undefined for the default. */
  readonly padding: number | undefined;
  readonly hoverPop: number;
  readonly maxDepth: number;
}

interface Metrics {
  /** The inset reserved for hover growth, in rendered px. */
  readonly growPadding: number;
  /** How far the hovered segment grows, in rendered px. */
  readonly popPx: number;
}

/** bklit draws in a size-unit viewBox, so padding and pop distance shrink with the rendered width. */
export const sunburstMetrics = ({ stageWidth, size, padding, hoverPop, maxDepth }: MetricsInput): Metrics => {
  const unit = stageWidth > 0 ? stageWidth / size : 1;
  return { growPadding: (padding ?? defaultSunburstGrowPadding(maxDepth, size, hoverPop)) * unit, popPx: hoverPop * unit };
};

/** The chart centre in scene coordinates (the hit tests' origin), from a rendered scene. */
export const sceneCenter = <TDatum>(scene: ChartScene<TDatum, number, number>): { readonly x: number; readonly y: number } => ({
  x: scene.chart.x + scene.chart.width / 2,
  y: scene.chart.y + scene.chart.height / 2,
});

/** The host's style: `size` wide at most, with the entrance's vars (intro.ts) while it plays. */
export const sunburstHostStyle = (size: number, hostVars: Readonly<Record<string, string>>): StyleObject => ({ "max-width": "100%", width: px(size), ...hostVars });

/** The square stage the chart is drawn in. */
export const sunburstStageStyle = (size: number): StyleObject => ({ "aspect-ratio": "1 / 1", "max-width": px(size) });

/** `SunburstHint`'s element: one line tall while empty, so the layout does not jump as the hint changes. */
export const SUNBURST_HINT_STYLE: StyleObject = { "min-height": "20px" };
