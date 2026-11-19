import type { ChartTooltipContent, SceneNode } from "@tanstack/charts";
import { intFmt } from "../format";
import { popIn } from "../mark-chart/enter";
import { boneDot, boneRect } from "../mark-chart/skeleton";
import { paletteColor, percentText } from "../mark-chart/paint";
import type { MarkChartBuild, MarkChartFamily, MarkDatum, MarkEnter, MarkFrame, MarkLayout } from "../mark-chart/types";
import { memoCell } from "../memo";
import { parseAspectRatio } from "../theme";
import type { WaffleChartProps, WaffleDatum, WafflePoint } from "../types/waffle";
import { describeParts } from "../a11y/describe";

const SWEEP_MS = 650;
const TRACK = "var(--legend-track)";

interface Allocation {
  /** Each category's first cell and cell count, in fill order. */
  readonly spans: readonly { readonly start: number; readonly count: number }[];
  readonly totalCells: number;
  readonly total: number;
}

/** Cumulative rounding (TanStack's `round: true`): category i ends at round(cum_i / total * cells), so the counts sum to the rounded whole. */
const allocate = (data: readonly WaffleDatum[], total: number | undefined, totalCells: number): Allocation => {
  const values = data.map((datum) => Math.max(0, Number(datum.value) || 0));
  const sum = values.reduce((a, b) => a + b, 0);
  const whole = total !== undefined && total > 0 ? Math.max(total, sum) : sum;
  const spans: { start: number; count: number }[] = [];
  let cumulative = 0;
  let previous = 0;
  for (const value of values) {
    cumulative += value;
    const boundary = whole > 0 ? Math.min(totalCells, Math.round((cumulative / whole) * totalCells)) : 0;
    spans.push({ count: boundary - previous, start: previous });
    previous = boundary;
  }
  return { spans, total: whole, totalCells };
};

interface WaffleDatumOut extends MarkDatum {
  readonly category: number;
}

interface Resolved {
  readonly data: readonly WaffleDatum[];
  readonly allocation: Allocation;
  readonly columns: number;
  readonly rows: number;
  readonly gap: number;
  readonly circle: boolean;
  readonly radius: number;
  readonly byRows: boolean;
  readonly colors: readonly string[] | undefined;
}

const colorOf = (r: Resolved, index: number): string => r.data[index]?.color ?? paletteColor(r.colors, index);

/** The grid in the plot: square cells centred in it, the side of a cell, its corner radius and cell `n`'s box in fill order. */
const gridOf = (r: Resolved, frame: MarkFrame) => {
  const { columns, rows, gap } = r;
  const cell = Math.max(1, Math.min((frame.width - gap * (columns - 1)) / columns, (frame.height - gap * (rows - 1)) / rows));
  const gridWidth = columns * cell + gap * (columns - 1);
  const gridHeight = rows * cell + gap * (rows - 1);
  const ox = frame.x + (frame.width - gridWidth) / 2;
  const oy = frame.y + (frame.height - gridHeight) / 2;
  const box = (n: number): readonly [number, number, number, number] => {
    const col = r.byRows ? n % columns : Math.floor(n / rows);
    const row = r.byRows ? Math.floor(n / columns) : n % rows;
    const x = ox + col * (cell + gap);
    const y = oy + row * (cell + gap);
    return [x, y, x + cell, y + cell];
  };
  const radius = r.circle ? cell / 2 : Math.min(0.5, Math.max(0, r.radius)) * cell;
  return { box, cell, ox, oy, radius };
};

/** The loading skeleton: every cell of the grid, muted. */
const waffleSkeleton = (r: Resolved, frame: MarkFrame): SceneNode[] => {
  const { box, cell, radius } = gridOf(r, frame);
  const bones: SceneNode[] = [];
  for (let n = 0; n < r.columns * r.rows; n += 1) {
    const [x0, y0] = box(n);
    bones.push(r.circle ? boneDot(`wf:${n}`, x0 + cell / 2, y0 + cell / 2, cell / 2) : boneRect(`wf:${n}`, x0, y0, cell, cell, radius));
  }
  return bones;
};

function layoutWaffle(r: Resolved, frame: MarkFrame, delays: Map<string, number>): MarkLayout<WaffleDatumOut> {
  const { gap, allocation } = r;
  const { box, cell, ox, oy, radius } = gridOf(r, frame);
  const shape = (key: string, n: number, fill: string, className: string): SceneNode => {
    const [x0, y0] = box(n);
    delays.set(key, (n / Math.max(1, allocation.totalCells)) * SWEEP_MS);
    return r.circle
      ? { className, key, kind: "dot", radius: cell / 2, style: { fill }, x: x0 + cell / 2, y: y0 + cell / 2 }
      : { className, height: cell, key, kind: "rect", radius, style: { fill }, width: cell, x: x0, y: y0 };
  };
  delays.clear();
  const used = allocation.spans.reduce((end, span) => Math.max(end, span.start + span.count), 0);
  const nodes: SceneNode[] = [];
  if (used < allocation.totalCells) {
    const track: SceneNode[] = [];
    for (let n = used; n < allocation.totalCells; n += 1) {
      track.push(shape(`wf:t:${n}`, n, TRACK, "bkm-wf-cell"));
    }
    nodes.push({ ariaHidden: true, children: track, className: "bkm-wf-track", key: "wf:track", kind: "group" });
  }
  const points: WaffleDatumOut[] = [];
  allocation.spans.forEach((span, index) => {
    const datum = r.data[index] as WaffleDatum;
    const color = colorOf(r, index);
    const key = `wf:${index}`;
    const cells: SceneNode[] = [];
    const rects: (readonly [number, number, number, number])[] = [];
    let cx = 0;
    let cy = 0;
    for (let n = span.start; n < span.start + span.count; n += 1) {
      cells.push(shape(`${key}:${n}`, n, color, "bkm-wf-cell"));
      const [x0, y0, x1, y1] = box(n);
      // A cell's hit box takes half the gap on each side, so the pointer never falls between two cells of one category.
      rects.push([x0 - gap / 2, y0 - gap / 2, x1 + gap / 2, y1 + gap / 2]);
      cx += (x0 + x1) / 2;
      cy += (y0 + y1) / 2;
    }
    nodes.push({ children: cells, className: "bkm-mc-item bkm-wf-cat", key, kind: "group" });
    const value = Math.max(0, Number(datum.value) || 0);
    const row: WafflePoint = { cells: span.count, color, label: datum.label, share: allocation.total > 0 ? value / allocation.total : 0, totalCells: allocation.totalCells, value };
    points.push({
      category: index, color, hit: { kind: "rects", rects }, index, item: key, label: datum.label, row, series: index,
      x: span.count > 0 ? cx / span.count : ox, y: span.count > 0 ? cy / span.count : oy,
    });
  });
  return { nodes, points };
}

/** The waffle family: one builder per chart. */
export const WAFFLE_FAMILY: MarkChartFamily<WaffleChartProps> = {
  chart: "waffle",
  props: {
    booleans: ["animate"],
    names: ["data", "status", "loadingLabel", "onHoverChange", "total", "columns", "rows", "gap", "shape", "radius", "fill", "colors", "formatValue", "valueLabel", "aspectRatio", "height", "animate", "ariaLabel", "ariaDescription"],
  },
  placeholder: { ariaLabel: "Waffle chart", data: [] },
  createBuilder: () => {
    const buildCell = memoCell<MarkChartBuild>();
    return ({ props }) => {
      const columns = Math.max(1, Math.round(props.columns ?? 10));
      const rows = Math.max(1, Math.round(props.rows ?? 10));
      const animate = props.animate !== false;
      return buildCell([props.data, props.onHoverChange, props.total, columns, rows, props.gap, props.shape, props.radius, props.fill, props.colors, props.formatValue, props.valueLabel, props.aspectRatio, props.height, animate, props.ariaLabel, props.ariaDescription], () => {
        const allocation = allocate(props.data, props.total, columns * rows);
        const resolved: Resolved = {
          allocation, byRows: props.fill !== "columns", circle: props.shape === "circle", colors: props.colors, columns, data: props.data,
          gap: Math.max(0, props.gap ?? 3), radius: props.radius ?? 0.2, rows,
        };
        const format = props.formatValue ?? intFmt;
        const delays = new Map<string, number>();
        const enter = (key: string): MarkEnter | undefined => {
          const delay = delays.get(key);
          return delay === undefined ? undefined : popIn(delay, 0.3);
        };
        const tooltip = (datum: MarkDatum): ChartTooltipContent => {
          const row = datum.row as WafflePoint;
          return {
            rows: [
              { color: row.color, label: props.valueLabel ?? "Value", value: format(row.value) },
              { label: "Share", value: percentText(row.share) },
            ],
            title: row.label,
          };
        };
        return {
          ariaDescription: props.ariaDescription,
          describe: () => describeParts({ kind: "Waffle chart", unit: "categories", items: props.data, headerLabel: "Category", label: (d) => d.label, value: (d) => d.value, valueLabel: props.valueLabel, format, share: true }),
          ariaLabel: props.ariaLabel ?? "Waffle chart",
          ...(props.height === undefined ? { aspectRatio: props.aspectRatio === undefined ? columns / rows : parseAspectRatio(props.aspectRatio) } : { height: props.height }),
          ...(animate ? { enter } : {}),
          layout: (frame) => layoutWaffle(resolved, frame, delays),
          ...(props.onHoverChange === undefined ? {} : { hover: (datum: MarkDatum | null) => props.onHoverChange?.(datum?.series ?? null) }),
          seriesItems: (series) => [`wf:${series}`],
          skeleton: (frame) => waffleSkeleton(resolved, frame),
          tooltip,
        };
      });
    };
  },
};
