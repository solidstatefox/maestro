import { createMark } from "@tanstack/charts";
import type { ChartMark, SceneNode } from "@tanstack/charts";
import { warnOnce } from "../carriers/registry";
import { gridLineStyle } from "../cartesian/grid-guides";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { scaleLinear } from "../scales";

/** bklit `Grid` `numTicksRows` default (grid.tsx:99). */
const DEFAULT_ROW_TICKS = 5;

export interface LiveGridOptions {
  readonly id: string;
  readonly grid: GridGuideProps;
  /** The frame's drawn (nice) y domain: bklit's `yScale` at rest. */
  readonly yDomain: readonly [number, number];
  /** bklit's inner width in chart px (the margin-inset plot, wider than the rolling plot). */
  readonly left: number;
  readonly right: number;
  /** Flips each tick, restarting the y reprojection (live-css.ts). */
  readonly parity: number;
}

/** bklit `hideEdgeTicks` (grid.tsx:71-76). */
const withoutEdges = (ticks: readonly number[], hide: boolean): readonly number[] => (hide && ticks.length > 2 ? ticks.slice(1, -1) : ticks);

export function liveGrid({ id, grid, yDomain, left, right, parity }: LiveGridOptions): ChartMark<unknown, Date, number> {
  if (grid.vertical === true) {
    // Accepted divergence: bklit's columns are `xScale.ticks(numTicksColumns)` of the scrolling time scale; here only the rows are drawn.
    warnOnce("LiveLineChart draws a Grid's horizontal rows only: `vertical` columns are not drawn.");
  }
  const rows = grid.horizontal === false ? [] : withoutEdges(grid.rowTickValues ?? scaleLinear().domain([yDomain[0], yDomain[1]]).ticks(grid.numTicksRows ?? DEFAULT_ROW_TICKS), grid.hideHorizontalEdgeLines === true);
  const highlight = grid.horizontal === false ? [] : (grid.highlightRowValues ?? []);
  const style = gridLineStyle(grid);
  const highlightStyle = {
    stroke: grid.highlightRowStroke ?? "var(--chart-foreground-muted)",
    strokeDasharray: (grid.highlightRowStrokeDasharray ?? "0").replace(",", " "),
    strokeOpacity: grid.highlightRowStrokeOpacity ?? 1,
    strokeWidth: grid.highlightRowStrokeWidth ?? 1,
  };
  return createMark<unknown, Date, number>(() => ({
    id,
    // No channels: the grid never influences either domain.
    channels: {},
    render: ({ scales }) => {
      const rules = (values: readonly number[], kind: string, paint: typeof style | typeof highlightStyle): SceneNode[] =>
        values.flatMap((value): SceneNode[] => {
          const y = scales.y.map(value);
          return Number.isFinite(y) ? [{ kind: "rule", key: `${id}:${kind}:${value}`, x1: left, x2: right, y1: y, y2: y, style: paint }] : [];
        });
      const children: SceneNode[] = [];
      if (rows.length > 0) {
        // bklit masks the rows with its 0/10/90/100% left-to-right fade (grid.tsx:180-201, :248) and not the highlight rows (:273-296): styles.css.
        children.push({ kind: "group", key: `${id}:rows`, className: grid.fadeHorizontal === false ? "bkm-live-grid-rows" : "bkm-live-grid-rows bkm-live-grid-fade", children: [{ kind: "group", key: `${id}:rows-rp`, className: "bkm-live-rp", children: rules(rows, "row", style) }] });
      }
      if (highlight.length > 0) {
        children.push({ kind: "group", key: `${id}:highlight-rp`, className: "bkm-live-rp", children: rules(highlight, "highlight", highlightStyle) });
      }
      return { nodes: children.length > 0 ? [{ kind: "group", key: id, className: `bkm-live-grid bkm-tp${parity}`, ariaHidden: true, children }] : [], points: [] };
    },
  }), false);
}
