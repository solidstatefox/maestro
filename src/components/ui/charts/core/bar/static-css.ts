import { focusEmptyHiddenCss, interactiveGateCss } from "../cartesian/gate-css";
import { typedAttr } from "../css-hooks";
import { keyStarts } from "../renderer-dom";
import { barDimCss } from "./hover";
import type { HoverTarget, TickFade } from "./hover";

interface BarStaticCssInput {
  /** The chart's `data-bkm-bar` id. */
  readonly uid: string;
  readonly hover: readonly HoverTarget[];
  readonly tickPositions: readonly number[];
  readonly hasSeries: boolean;
  readonly horizontal: boolean;
  /** bklit bar-x-axis.tsx:91: the date pill hides ticks within tickerHalfWidth of the focused band centre. */
  readonly tickerHalfWidth: number;
}

export function barStaticCss({ uid, hover, tickPositions, hasSeries, horizontal, tickerHalfWidth }: BarStaticCssInput): string {
  const scope = `[data-bkm-bar="${uid}"]`;
  const prefix = `${horizontal ? "y" : "x"}-tick-label:`;
  let tickFade: TickFade | null = null;
  if (hasSeries) {
    tickFade = horizontal ? { prefix, positions: tickPositions } : { prefix, ramp: tickerHalfWidth, positions: tickPositions };
  }
  const dim = barDimCss(scope, hover, tickFade, tickPositions.length);
  // bklit's bar is a rect with rx = ry = min(barWidth / 2, 8) (bar.tsx:262-263, 413-414); the native rect has rx = 8 and no ry, so narrow
  // bars got taller corners: clamp both radii to half the band thickness (each still clamps to its own axis, an oval when short, like bklit).
  const radius = `min(calc(attr(rx type(<number>)) * 1px),calc(attr(${horizontal ? "height" : "width"} type(<number>)) * .5px))`;
  // Typed attr() is Chromium-only (133+): under `@supports`, other browsers keep the native rx (ry follows it).
  // The `bars:` key selector has no documented hook (barY takes no className): gap #36; the scalar rect radius is emitted as `rx` only: gap #25.
  const corners = typedAttr(`${scope} rect${keyStarts("bars:")}[rx]{rx:${radius};ry:${radius}}`);
  return `${scope}[data-bkm-status="loading"] .ts-chart-host{pointer-events:none}${interactiveGateCss(scope, true)}${scope}:not([data-bkm-interactive]) .bkm-hov{visibility:hidden}${focusEmptyHiddenCss(scope)}${dim}${corners}`;
}
