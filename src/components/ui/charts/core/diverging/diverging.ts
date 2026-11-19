import type { ChartTooltipContent, SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { intFmt } from "../format";
import { ENTER_SPRING } from "../mark-chart/enter";
import { gridRule, readGuides, tickLabel } from "../mark-chart/guides";
import type { MarkGuides } from "../mark-chart/guides";
import { fitText, percentText, tint } from "../mark-chart/paint";
import { boneLabel, boneRect, boneShare } from "../mark-chart/skeleton";
import type { MarkChartBuild, MarkChartFamily, MarkDatum, MarkEnter, MarkFrame, MarkLayout } from "../mark-chart/types";
import { memoCell } from "../memo";
import { parseAspectRatio } from "../theme";
import type { DivergingBarChartProps, DivergingLabelsProps, DivergingPoint, DivergingSegmentProps } from "../types/diverging";
import { describeRowsChart } from "../a11y/rows";
import { contrastingText } from "../theme";

export const DIVERGING_ROLES = { labels: "divergingLabels", segment: "divergingSegment" } as const;

type Row = Readonly<Record<string, unknown>>;

const X_AXIS_HEIGHT = 24;
const ROW_STAGGER_MS = 60;
const STEP_STAGGER_MS = 70;
const NEGATIVE = "var(--chart-negative)";
const POSITIVE = "var(--chart-positive)";
const NEUTRAL = "var(--chart-foreground-muted)";

interface Segment {
  readonly dataKey: string;
  readonly label: string;
  /** The colour the hover, legend and tooltip use. */
  readonly color: string;
  /** The segment's paint. */
  readonly fill: string;
}

/** The centre: the index of the segment split across it (null: it falls between `before` and `before + 1`), and how many come before. */
interface Center {
  readonly split: number | null;
  readonly before: number;
}

const centerOf = (segments: readonly Segment[], center: string | undefined): Center => {
  const index = center === undefined ? -1 : segments.findIndex((segment) => segment.dataKey === center);
  if (index >= 0) { return { before: index, split: index }; }
  const count = segments.length;
  return count % 2 === 1 ? { before: (count - 1) / 2, split: (count - 1) / 2 } : { before: count / 2, split: null };
};

/** The default diverging scheme: negative tints before the centre, neutral at it, positive after, strongest at the ends. */
const schemeColor = (index: number, count: number, center: Center): string => {
  if (center.split === index) { return NEUTRAL; }
  const negative = index < center.before;
  const side = negative ? center.before : count - center.before - (center.split === null ? 0 : 1);
  const step = negative ? center.before - index : index - center.before - (center.split === null ? 0 : 1) + 1;
  const strength = side <= 1 ? 100 : 55 + ((step - 1) / (side - 1)) * 45;
  return tint(negative ? NEGATIVE : POSITIVE, strength);
};

const valueOf = (row: Row, key: string): number => Math.max(0, Number(row[key]) || 0);

interface Resolved {
  readonly data: readonly Row[];
  readonly yDataKey: string;
  readonly segments: readonly Segment[];
  readonly center: Center;
  readonly guides: MarkGuides;
  readonly labels: DivergingLabelsProps | null;
  readonly normalize: boolean;
  readonly barSize: number;
  readonly radius: number;
}

/** The left end of a row (its negative extent, as a negative number) in its unit (shares when normalised). */
const negativeOf = (r: Resolved, row: Row, total: number): number => {
  let negative = 0;
  r.segments.forEach((segment, index) => {
    const value = valueOf(row, segment.dataKey);
    if (index < r.center.before) { negative += value; }
    if (index === r.center.split) { negative += value / 2; }
  });
  return r.normalize && total > 0 ? negative / total : negative;
};

/** Round steps for a symmetric axis of half-width `extent`. */
const stepFor = (extent: number, normalize: boolean): number => {
  if (normalize) { return extent > 0.6 ? 0.25 : extent > 0.3 ? 0.2 : 0.1; }
  const raw = extent / 2;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? raw;
};

interface Enter {
  readonly delay: number;
  readonly origin: string;
}

function layoutDiverging(r: Resolved, frame: MarkFrame, enters: Map<string, Enter>, format: (value: number) => string): MarkLayout {
  const { data, segments, guides } = r;
  enters.clear();
  const names = data.map((row) => String(row[r.yDataKey] ?? ""));
  const labelWidth = guides.yAxis === null ? 0 : Math.min(frame.width * 0.38, Math.max(0, ...names.map((name) => frame.measure(name, 12, 400))) + 14);
  const bottom = guides.xAxis === null ? 0 : X_AXIS_HEIGHT;
  const px = frame.x + labelWidth;
  const py = frame.y + 4;
  const pw = Math.max(0, frame.width - labelWidth - 4);
  const ph = Math.max(0, frame.height - bottom - 4);
  const totals = data.map((row) => segments.reduce((sum, segment) => sum + valueOf(row, segment.dataKey), 0));
  const unit = (row: number, value: number): number => (r.normalize ? ((totals[row] ?? 0) > 0 ? value / (totals[row] ?? 1) : 0) : value);
  // The domain: the widest negative and positive extents, each rounded out to a step (asymmetric: no room wasted on a lighter side).
  let negativeExtent = 0;
  let positiveExtent = 0;
  data.forEach((row, index) => {
    const negative = negativeOf(r, row, totals[index] ?? 0);
    const whole = r.normalize ? ((totals[index] ?? 0) > 0 ? 1 : 0) : (totals[index] ?? 0);
    negativeExtent = Math.max(negativeExtent, negative);
    positiveExtent = Math.max(positiveExtent, whole - negative);
  });
  const step = stepFor(Math.max(negativeExtent, positiveExtent) || 1, r.normalize);
  const lo = -Math.max(step, Math.ceil(negativeExtent / step - 1e-9) * step);
  const hi = Math.max(step, Math.ceil(positiveExtent / step - 1e-9) * step);
  const cx = px + (pw * -lo) / (hi - lo);
  const x = (value: number): number => px + ((value - lo) / (hi - lo)) * pw;
  const band = data.length > 0 ? ph / data.length : 0;
  const thickness = Math.max(2, band * Math.min(1, Math.max(0.1, r.barSize)));
  const nodes: SceneNode[] = [];
  const ticks: number[] = [];
  // Ticks at multiples of a step wide enough for their labels (doubling the grid step on a narrow plot).
  let tickStep = step;
  while (tickStep * (pw / (hi - lo)) < 44 && tickStep < hi - lo) { tickStep *= 2; }
  for (let value = Math.ceil(lo / tickStep - 1e-9) * tickStep; value <= hi + tickStep * 1e-9; value += tickStep) { ticks.push(Math.round(value / tickStep) * tickStep); }
  if (guides.grid !== null && guides.grid.vertical !== false) {
    for (const value of ticks) {
      if (value !== 0) { nodes.push(gridRule(`dv:grid:${value}`, guides.grid, x(value), py, x(value), py + ph)); }
    }
  }
  if (guides.xAxis !== null) {
    for (const value of ticks) {
      const text = r.normalize ? `${Math.round(Math.abs(value) * 100)}%` : format(Math.abs(value));
      nodes.push(tickLabel(`dv:x:${value}`, text, x(value), py + ph + 14, value === lo ? "start" : value === hi ? "end" : "middle"));
    }
  }
  const points: MarkDatum[] = [];
  data.forEach((row, rowIndex) => {
    const total = totals[rowIndex] ?? 0;
    const name = names[rowIndex] ?? "";
    const y = py + band * rowIndex + (band - thickness) / 2;
    if (guides.yAxis !== null) {
      const text = fitText(name, labelWidth - 14, 12, 400, frame.measure);
      if (text !== null) { nodes.push(tickLabel(`dv:y:${rowIndex}`, text, px - 12, y + thickness / 2, "end", { fill: "var(--chart-tooltip-foreground)" })); }
    }
    let at = -negativeOf(r, row, total);
    const live = segments.map((segment, index) => ({ index, segment, value: valueOf(row, segment.dataKey) })).filter((entry) => entry.value > 0);
    let positive = 0;
    let negative = 0;
    live.forEach(({ segment, index, value }, order) => {
      const width = unit(rowIndex, value);
      const x0 = x(at);
      const x1 = x(at + width);
      at += width;
      if (index < r.center.before) { negative += value; }
      if (index > r.center.before || (index === r.center.before && r.center.split === null)) { positive += value; }
      const key = `dv:${rowIndex}:${index}`;
      const inset = order === live.length - 1 ? 0 : 1;
      const w = Math.max(0, x1 - x0 - inset);
      const first = order === 0;
      const last = order === live.length - 1;
      const radius = Math.min(r.radius, thickness / 2, w / 2);
      const children: SceneNode[] = [{
        className: "bkm-dv-cell", cornerRadii: [first ? radius : 0, last ? radius : 0, last ? radius : 0, first ? radius : 0],
        height: thickness, key: `${key}:cell`, kind: "rect", width: w, x: x0, y, style: { fill: segment.fill },
      }];
      const share = total > 0 ? value / total : 0;
      if (r.labels !== null && w >= (r.labels.minWidth ?? 30) && thickness >= 16) {
        const text = fitText(percentText(share), w - 6, 11, 600, frame.measure);
        if (text !== null) {
          children.push({ anchor: "middle", baseline: "middle", className: "bkm-dv-label", fontSize: 11, fontWeight: 600, key: `${key}:label`, kind: "label", style: { fill: contrastingText(segment.fill) }, text, x: x0 + w / 2, y: y + thickness / 2 + 1 });
        }
      }
      nodes.push({ children, className: "bkm-mc-item bkm-dv-segment", key, kind: "group" });
      // Grow out from the centre line: a segment wholly on one side from its centre-side edge, the split one from the centre itself.
      const origin = index === r.center.split ? `${w > 0 ? ((cx - x0) / w) * 100 : 50}% 50%` : index < r.center.before ? "100% 50%" : "0% 50%";
      const distance = index === r.center.split ? 0 : index < r.center.before ? r.center.before - index : index - r.center.before - (r.center.split === null ? 0 : 1) + 1;
      enters.set(key, { delay: rowIndex * ROW_STAGGER_MS + distance * STEP_STAGGER_MS, origin });
      const point: DivergingPoint = { color: segment.color, dataKey: segment.dataKey, name, net: 0, row, series: segment.label, share, value };
      points.push({
        color: segment.color, hit: { kind: "rect", x0, x1: x0 + w, y0: y, y1: y + thickness }, index: rowIndex, item: key, label: `${name}, ${segment.label}`,
        related: data.map((_, other) => `dv:${other}:${index}`).filter((other) => other !== key), row: point, series: index, x: x0 + w / 2, y: y + thickness / 2,
      });
    });
    // Net score: the positive share minus the negative one (the neutral left out).
    const net = total > 0 ? (positive - negative) / total : 0;
    for (const point of points) {
      if (point.index === rowIndex) { (point.row as { net: number }).net = net; }
    }
  });
  // The zero rule over the bars.
  nodes.push({ className: "bkm-dv-zero", key: "dv:zero", kind: "rule", style: { stroke: "var(--chart-foreground)", strokeWidth: 1 }, x1: cx, x2: cx, y1: py - 2, y2: py + ph + 2 });
  return { nodes, points };
}

/** The loading skeleton: as many bars as the data has rows (else 6), each two segments either side of the centre line with a seeded
 * reach, in the plot the guides leave (the grid and the zero rule drawn, the tick labels as stubs). */
const divergingSkeleton = (r: Resolved, frame: MarkFrame): SceneNode[] => {
  const { guides } = r;
  const names = r.data.map((row) => String(row[r.yDataKey] ?? ""));
  const widest = names.length > 0 ? Math.max(0, ...names.map((name) => frame.measure(name, 12, 400))) : 70;
  const labelWidth = guides.yAxis === null ? 0 : Math.min(frame.width * 0.38, widest + 14);
  const bottom = guides.xAxis === null ? 0 : X_AXIS_HEIGHT;
  const px = frame.x + labelWidth;
  const py = frame.y + 4;
  const pw = Math.max(0, frame.width - labelWidth - 4);
  const ph = Math.max(0, frame.height - bottom - 4);
  const rows = r.data.length > 0 ? Math.min(24, r.data.length) : 6;
  const band = ph / rows;
  const thickness = Math.max(2, band * Math.min(1, Math.max(0.1, r.barSize)));
  const cx = px + pw / 2;
  const nodes: SceneNode[] = [];
  if (guides.grid !== null && guides.grid.vertical !== false) {
    for (const f of [0, 0.25, 0.75, 1]) { nodes.push(gridRule(`dv:grid:${f}`, guides.grid, px + pw * f, py, px + pw * f, py + ph)); }
  }
  if (guides.xAxis !== null) {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) { nodes.push(boneLabel(`dv:x:${f}`, px + pw * f, py + ph + 14, 26, f === 0 ? "start" : f === 1 ? "end" : "middle")); }
  }
  for (let row = 0; row < rows; row += 1) {
    const y = py + band * row + (band - thickness) / 2;
    if (guides.yAxis !== null) {
      nodes.push(boneLabel(`dv:y:${row}`, px - 12, y + thickness / 2, Math.max(16, (labelWidth - 26) * (0.55 + boneShare(row, 41) * 0.45)), "end"));
    }
    const reach = [0.3 + boneShare(row, 13) * 0.6, 0.3 + boneShare(row, 17) * 0.65];
    reach.forEach((share, side) => {
      const length = (pw / 2) * share;
      const inner = length * (0.45 + boneShare(row * 2 + side, 29) * 0.3);
      const sign = side === 0 ? -1 : 1;
      const radius = Math.min(r.radius, thickness / 2);
      // Inner segment against the centre line, then the outer one past a 2px gap.
      nodes.push(boneRect(`dv:${row}:${side}:0`, sign < 0 ? cx - inner : cx, y, inner, thickness, radius));
      const outer = Math.max(0, length - inner - 2);
      nodes.push(boneRect(`dv:${row}:${side}:1`, sign < 0 ? cx - inner - 2 - outer : cx + inner + 2, y, outer, thickness, radius));
    });
  }
  nodes.push({ className: "bkm-dv-zero", key: "dv:zero", kind: "rule", style: { stroke: "var(--chart-foreground)", strokeOpacity: 0.4, strokeWidth: 1 }, x1: cx, x2: cx, y1: py - 2, y2: py + ph + 2 });
  return nodes;
};

/** The diverging bar family: one builder per chart. */
export const DIVERGING_FAMILY: MarkChartFamily<DivergingBarChartProps> = {
  chart: "diverging",
  props: {
    booleans: ["normalize", "animate"],
    names: ["data", "status", "loadingLabel", "yDataKey", "center", "normalize", "barSize", "radius", "formatValue", "onHoverChange", "aspectRatio", "height", "animate", "ariaLabel", "ariaDescription"],
  },
  placeholder: { data: [], yDataKey: "" },
  createBuilder: () => {
    const segmentsCell = memoCell<readonly Segment[]>();
    const guidesCell = memoCell<MarkGuides>();
    const buildCell = memoCell<MarkChartBuild>();
    return ({ props, table }) => {
      const carriers = propsFor<DivergingSegmentProps>(table, DIVERGING_ROLES.segment);
      const segments = segmentsCell([props.center, ...carriers.flatMap((s) => [s.dataKey, s.label, s.fill])], () => {
        const plain = carriers.map((s) => ({ color: "", dataKey: s.dataKey, fill: "", label: s.label ?? s.dataKey }));
        const center = centerOf(plain, props.center);
        return carriers.map((s, index) => {
          const color = s.fill ?? schemeColor(index, carriers.length, center);
          return { color, dataKey: s.dataKey, fill: s.fill === undefined ? color : tint(s.fill, 82), label: s.label ?? s.dataKey };
        });
      });
      const fresh = readGuides(table);
      const guides = guidesCell([fresh.grid, fresh.xAxis, fresh.yAxis], () => fresh);
      const labels = propsFor<DivergingLabelsProps>(table, DIVERGING_ROLES.labels).at(-1) ?? null;
      const animate = props.animate !== false;
      return buildCell([props.data, props.yDataKey, segments, guides, labels, props.center, props.normalize, props.barSize, props.radius, props.formatValue, props.onHoverChange, props.aspectRatio, props.height, animate, props.ariaLabel, props.ariaDescription], () => {
        const format = props.formatValue ?? intFmt;
        const resolved: Resolved = {
          barSize: props.barSize ?? 0.62, center: centerOf(segments, props.center), data: props.data, guides, labels, normalize: props.normalize !== false,
          radius: Math.max(0, props.radius ?? 4), segments, yDataKey: props.yDataKey,
        };
        const enters = new Map<string, Enter>();
        const enter = (key: string): MarkEnter | undefined => {
          const spec = enters.get(key);
          if (spec === undefined) { return undefined; }
          return {
            delay: spec.delay, duration: ENTER_SPRING.durationMs, easing: ENTER_SPRING.ease,
            keyframes: [{ transform: "scaleX(0)", transformOrigin: spec.origin }, { transform: "none", transformOrigin: spec.origin }],
          };
        };
        const tooltip = (datum: MarkDatum): ChartTooltipContent => {
          const point = datum.row as DivergingPoint;
          const total = segments.reduce((sum, segment) => sum + valueOf(point.row, segment.dataKey), 0);
          const net = Math.round(point.net * 100);
          return {
            rows: [
              ...segments.map((segment, index) => {
                const value = valueOf(point.row, segment.dataKey);
                return { active: index === datum.series, color: segment.color, label: segment.label, value: `${format(value)} · ${percentText(total > 0 ? value / total : 0)}` };
              }),
              { label: "Net", value: `${net > 0 ? "+" : ""}${net} pts` },
            ],
            title: point.name,
          };
        };
        return {
          ariaDescription: props.ariaDescription,
          describe: () => describeRowsChart({ kind: "Diverging bar chart", unit: "rows", data: props.data, xKey: props.yDataKey, series: segments.map((s) => ({ key: s.dataKey, label: s.label, format })) }),
          ariaLabel: props.ariaLabel ?? "Diverging bar chart",
          ...(props.height === undefined ? { aspectRatio: parseAspectRatio(props.aspectRatio ?? "16 / 9") } : { height: props.height }),
          ...(animate ? { enter } : {}),
          ...(props.onHoverChange === undefined ? {} : { hover: (datum: MarkDatum | null) => props.onHoverChange?.(datum?.series ?? null) }),
          layout: (frame) => layoutDiverging(resolved, frame, enters, format),
          seriesItems: (series) => props.data.map((_, row) => `dv:${row}:${series}`),
          skeleton: (frame) => divergingSkeleton(resolved, frame),
          tooltip,
        };
      });
    };
  },
};
