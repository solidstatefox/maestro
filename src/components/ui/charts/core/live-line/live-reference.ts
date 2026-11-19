import { createMark } from "@tanstack/charts";
import type { ChartMark, SceneNode } from "@tanstack/charts";
import { BACKGROUND_PATTERN_ID } from "../cartesian/background";
import { referencePatternId, usesReferencePattern } from "../cartesian/reference-pattern";
import { scopePaintUrl } from "../resource-ids";
import type { ReferenceAreaProps } from "../types/reference-area";

export interface LiveReferenceOptions {
  readonly id: string;
  readonly uid: string;
  readonly references: readonly ReferenceAreaProps[];
  /** bklit's inner width in chart px (as the grid rows span). */
  readonly left: number;
  readonly right: number;
  /** Flips each tick, restarting the y reprojection (live-css.ts). */
  readonly parity: number;
}

const DEFAULT_FILL = "color-mix(in oklch, var(--chart-foreground-muted) 12%, transparent)";

/** bklit bracketMarkerPath: a size x size triangle on the band edge, its tip pointing into the band. */
const bracket = (key: string, cx: number, edgeY: number, size: number, dir: 1 | -1, fill: string): SceneNode => ({
  kind: "area",
  key,
  points: [[cx - size / 2, edgeY], [cx + size / 2, edgeY], [cx, edgeY + dir * size]],
  style: { fill, stroke: "none" },
});

export function liveReferenceMark({ id, uid, references, left, right, parity }: LiveReferenceOptions): ChartMark<unknown, Date, number> {
  return createMark<unknown, Date, number>(() => ({
    id,
    // No channels: a band never moves the live y domain (bklit's live range is the data's alone).
    channels: {},
    render: ({ scales, chart }) => {
      const bands = references.flatMap((r, i): SceneNode[] => {
        const top = scales.y.map(r.y2 ?? Number.NaN);
        const bottom = scales.y.map(r.y1 ?? Number.NaN);
        // An open edge runs to the plot's edge (bklit: y1 / y2 omitted extend to the plot bottom / top).
        const y0 = Number.isFinite(top) ? top : chart.y;
        const y1 = Number.isFinite(bottom) ? bottom : chart.y + chart.height;
        if (!(Number.isFinite(y0) && Number.isFinite(y1))) {
          return [];
        }
        const yTop = Math.min(y0, y1);
        const yBottom = Math.max(y0, y1);
        const stroke = r.stroke ?? "var(--chart-foreground-muted)";
        const dash = (r.strokeStyle ?? "dashed") === "dashed" ? (r.strokeDasharray ?? "4,4").replace(",", " ") : undefined;
        const edge = { stroke, strokeWidth: r.strokeWidth ?? 1, strokeDasharray: dash };
        const fill = usesReferencePattern(r) ? scopePaintUrl(`url(#${referencePatternId(i)})`, uid) : (r.fill ?? DEFAULT_FILL);
        const body: SceneNode[] = [
          { kind: "rect", key: `${id}:${i}:fill`, x: left, y: yTop, width: Math.max(0, right - left), height: yBottom - yTop, style: { fill, fillOpacity: r.fillOpacity ?? 1 } },
          ...(r.y2 === undefined ? [] : [{ kind: "rule" as const, key: `${id}:${i}:top`, x1: left, x2: right, y1: yTop, y2: yTop, style: edge }]),
          ...(r.y1 === undefined ? [] : [{ kind: "rule" as const, key: `${id}:${i}:bottom`, x1: left, x2: right, y1: yBottom, y2: yBottom, style: edge }]),
        ];
        const nodes: SceneNode[] = [{ kind: "group", key: `${id}:${i}:band`, className: r.fadeEdges === false ? "bkm-live-ref" : "bkm-live-ref bkm-live-ref-fade", children: body }];
        if (r.showMarkers === true) {
          const size = r.markerSize ?? 6;
          const color = r.markerColor ?? "var(--chart-1)";
          const cx = (left + right) / 2;
          nodes.push(bracket(`${id}:${i}:mk-top`, cx, yTop, size, 1, color), bracket(`${id}:${i}:mk-bottom`, cx, yBottom, size, -1, color));
        }
        return nodes;
      });
      return {
        nodes: bands.length > 0 ? [{ kind: "group", key: id, className: `bkm-live-refs bkm-tp${parity}`, ariaHidden: true, children: [{ kind: "group", key: `${id}:rp`, className: "bkm-live-rp", children: bands }] }] : [],
        points: [],
      };
    },
  }));
}

export interface LiveBackgroundOptions {
  readonly uid: string;
  readonly opacity: number;
  /** bklit's inner width in chart px: the live plot, wider than the native rolling one. */
  readonly left: number;
  readonly right: number;
}

/** bklit's `<Background>` inside a LiveLineChart: the preset's tile (hosted in the live chart's defs) over bklit's plot, under styles.css `.bkm-bg`'s edge fade.
 * The cartesian Background spans the native plot; the live one spans bklit's wider inner width, as the grid rows do. */
export function liveBackgroundMark({ uid, opacity, left, right }: LiveBackgroundOptions): ChartMark<unknown, Date, number> {
  const fill = scopePaintUrl(`url(#${BACKGROUND_PATTERN_ID})`, uid);
  return createMark<unknown, Date, number>(() => ({
    id: "live:background",
    channels: {},
    render: ({ chart }) => ({
      nodes: [{
        kind: "group",
        key: "live:background",
        className: "bkm-bg",
        ariaHidden: true,
        translateX: left,
        translateY: chart.y,
        children: [{ kind: "rect", key: "live:background:rect", x: 0, y: 0, width: Math.max(0, right - left), height: chart.height, style: { fill, opacity } }],
      }],
      points: [],
    }),
  }));
}
