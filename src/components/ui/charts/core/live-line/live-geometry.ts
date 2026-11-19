import { memoCell } from "../memo";
import type { ChartMargin } from "../theme";
import type { LiveSample } from "./live-frame";

const DEFAULT_HEIGHT = 300;
const TIP_OVERHANG = 160;
/** Sample intervals of slack between the renderer's plot edge and plotRight: the demo seed's newest sample is an interval old at
 *  mount (getLiveLineSeed), so the first ticks' N-1 trails bklit's clock by one interval plus the render delay. */
const ROLL_SLACK_STEPS = 2;

function medianInterval(times: readonly number[]): number {
  const deltas: number[] = [];
  for (let i = Math.max(1, times.length - 20); i < times.length; i += 1) {
    const d = (times[i] ?? 0) - (times[i - 1] ?? 0);
    if (d > 0) {
      deltas.push(d);
    }
  }
  if (deltas.length === 0) {
    return 1;
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)] ?? 1;
}

export interface LivePlotInput {
  readonly width: number;
  readonly data: readonly LiveSample[];
  readonly windowSecs: number;
  readonly numXTicks: number;
  readonly nowOffsetUnits: number;
  readonly margin: ChartMargin;
  readonly rightAxis: boolean;
}

export interface LivePlot {
  readonly bklitWidth: number;
  readonly pxPerMs: number;
  readonly stepSecs: number;
  readonly plotRight: number;
  readonly plotWidth: number;
  readonly rollEdge: number;
  readonly plotMargin: ChartMargin;
  readonly clipExt: number;
  readonly labelShift: number;
}

/** The plot geometry of one chart: call it with the latest inputs on every render; `plotMargin` keeps its object until it changes. */
export function createLivePlot(): (input: LivePlotInput) => LivePlot {
  const measuredStepCell = memoCell<number>();
  const plotMarginCell = memoCell<ChartMargin>();
  // The sample interval is fixed per window size: it sets the plot width, which must not drift between rolls.
  let stepLock = { windowSecs: 0, secs: 0 };
  return ({ width, data, windowSecs, numXTicks, nowOffsetUnits, margin, rightAxis }) => {
    // bklit's pixel scale: the window spans the margin-inset width and the dot sits `leading` short of its right edge. The native plot ends two
    // intervals left of the dot (the path ends at N-1; live-tail.ts draws the rest); the clip is widened back by --bkm-live-ext (live-css.ts).
    const W = width || 800;
    const bklitWidth = Math.max(1, W - margin.left - margin.right);
    const pxPerMs = bklitWidth / (windowSecs * 1000);
    const measuredStep = measuredStepCell([data], () => medianInterval(data.map((p) => p.time)));
    if (stepLock.secs === 0 || stepLock.windowSecs !== windowSecs) {
      stepLock = { windowSecs, secs: measuredStep };
    }
    const stepSecs = stepLock.secs;
    const leadingMs = (nowOffsetUnits * windowSecs * 1000) / Math.max(1, numXTicks - 1);
    const plotRight = Math.max(margin.left + 1, margin.left + bklitWidth - leadingMs * pxPerMs - 2 * stepSecs * 1000 * pxPerMs);
    const plotWidth = plotRight - margin.left;
    // The renderer's plot edge, ROLL_SLACK_STEPS short of plotRight: the rolling contract only transforms a path that reaches it
    // (charts-core motion-path.ts:8 coordinateTolerance 0.05px, :140-150 coverage) and snaps one that does not; the tail starts at the path's end.
    const rollEdge = Math.max(margin.left + 1, plotRight - ROLL_SLACK_STEPS * stepSecs * 1000 * pxPerMs);
    const plotMargin = plotMarginCell([margin, W, rollEdge], () => ({ ...margin, right: W - rollEdge }));
    // Where the clip should end: past the container's right edge by the badge's overhang, whichever side the axis is on. bklit's svg is overflow-visible
    // (live-line-chart.tsx:600-604) and its ParentSize drops visx's overflow hidden (chart-parent-size.tsx), so the tip (dot, halo, badge) overlaps a
    // right-hand axis, and past a left-hand axis's 16px default margin it runs beyond the chart (since bklit #241; a container that clips, such as a
    // Card, needs the margin to hold it).
    const clipExt = Math.max(0, W + TIP_OVERHANG - rollEdge);
    // A right-hand axis keeps its labels where bklit puts them, not at the narrower plot's edge.
    const labelShift = rightAxis ? Math.max(0, W - margin.right - rollEdge) : 0;
    return { bklitWidth, pxPerMs, stepSecs, plotRight, plotWidth, rollEdge, plotMargin, clipExt, labelShift };
  };
}

/** The chart's height in px from its style's `height` (a positive number, or a string read by `parseFloat`), else 300. */
export function parseHeight(raw: unknown): number {
  if (typeof raw === "number" && raw > 0) {
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return DEFAULT_HEIGHT;
}
