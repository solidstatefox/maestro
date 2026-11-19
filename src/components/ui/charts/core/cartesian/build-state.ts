import type { ChartGradient } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import type { AnyMark } from "../erased-types";
import type { HoverDimRule, HoverHighlight, ProfitLossRule, ScopedStyle } from "./hover-css";
import { DEFAULT_Y_AXIS_ID, axisId } from "./series";
import type { ResolvedSeries } from "./series";

/** What the per-concern builders append to, in call order: mark order is paint order. */
export interface BuildState {
  readonly marks: AnyMark[];
  readonly gradients: ChartGradient[];
  readonly hoverDim: HoverDimRule[];
  readonly hoverHighlights: HoverHighlight[];
  readonly plRules: ProfitLossRule[];
  /** Static per-mark rules (a glow's blur, an area's own fade mask), scoped to the chart with the hover CSS. */
  readonly styles: ScopedStyle[];
}

/** Appends `mark` wrapped in `decorative()` (never takes focus), so call sites stay within the nesting limit. */
export const pushDecorative = (marks: AnyMark[], mark: AnyMark): void => {
  marks.push(decorative(mark));
};

export const keyAttr =(value: string): string => value.replaceAll(/["\\\n]/g, String.raw`\$&`);

/** The mark option that binds a mark to a secondary y scale (`y:<id>`, see definition buildYScales); the default axis needs none. */
export const yScaleForAxis = (id: string | number | undefined): { yScale?: string } => {
  const axis = axisId(id);
  return axis === DEFAULT_Y_AXIS_ID ? {} : { yScale: `y:${axis}` };
};

export const yScaleOf = (s: ResolvedSeries): { yScale?: string } => yScaleForAxis(s.yAxisId);
