import type { StyleObject } from "../style";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import type { SankeyTooltipBodyContext } from "./tooltip";

/** Holds the CSS entrances (node grow, label fades: styles.css) at their first keyframe until two frames after the mount's passive moment. */
export const SANKEY_HOLD_ATTR = "data-bkm-sk-hold";

/** Raised once the CSS entrances have ended: styles.css drops the finished animations (cheaper hover recalcs). */
export const SANKEY_SETTLED_ATTR = "data-bkm-sk-settled";

/** When the last CSS entrance ends, from the hold's release: flows start at 0.2 of the duration, staggered over another 0.32 (styles.css),
 * and run one duration; labels and nodes end earlier. A margin covers a late frame. */
export const sankeySettleMs = (entranceMs: number): number => Math.ceil(entranceMs * 1.52) + 150;

export interface SankeyView<Node> {
  /** The host's attributes, beside the adapter's own `class` and hydration marker. `data-bkm-sk-hold` is a constant the controller removes and
   * re-raises itself (a framework diffs it against its last value, so it never writes it back). */
  readonly hostAttrs: Readonly<Record<string, string>>;
  /** The host's style: the entrance vars, the hover opacities, its box (pass.ts). */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`). */
  readonly surfaceStyle: StyleObject;
  /** The tooltip body: the SankeyTooltip's `nodeContent` / `linkContent`, else the framework's default body. */
  readonly renderTooltipBody: (context: SankeyTooltipBodyContext<Node>) => Node;
  /** The SankeyLink's `patterns` (framework nodes), rendered in a hidden defs host with their ids scoped to the chart's uid; null when none. */
  readonly patterns: Node | null;
}

/** The host's attributes. */
export const sankeyHostAttrs = (): Readonly<Record<string, string>> => ({ "data-bkm-chart": "sankey", [SANKEY_HOLD_ATTR]: "", "data-slot": "chart" });

/** RendererChart.js:116-119 with no width: as wide as the host (`100%`), the aspect ratio gives the height. */
export const sankeySurfaceStyle = (aspectRatio: number): StyleObject => surfaceHostStyle(surfaceBox({ aspectRatio }));
