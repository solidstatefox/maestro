import type { ChartTooltipContent, SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { intFmt } from "../format";
import { growIn } from "../mark-chart/enter";
import { fractions, gridRule, readGuides, tickLabel } from "../mark-chart/guides";
import type { MarkGuides } from "../mark-chart/guides";
import { fitText, paletteColor, percentText, tint } from "../mark-chart/paint";
import { boneLabel, boneRect, boneShare } from "../mark-chart/skeleton";
import type { MarkChartBuild, MarkChartFamily, MarkDatum, MarkEnter, MarkFrame, MarkLayout } from "../mark-chart/types";
import { memoCell } from "../memo";
import { parseAspectRatio } from "../theme";
import type { MarimekkoChartProps, MarimekkoLabelsProps, MarimekkoPoint, MarimekkoSegmentProps } from "../types/marimekko";
import { describeRowsChart } from "../a11y/rows";
import { contrastingText } from "../theme";

export const MARIMEKKO_ROLES = { labels: "marimekkoLabels", segment: "marimekkoSegment" } as const;

const Y_AXIS_WIDTH = 44;
const X_AXIS_HEIGHT = 40;
const COLUMN_STAGGER_MS = 70;
const SEGMENT_STAGGER_MS = 90;

interface Series {
  readonly dataKey: string;
  readonly label: string;
  readonly color: string;
}

interface Resolved {
  readonly data: readonly Record<string, unknown>[];
  readonly xDataKey: string;
  readonly series: readonly Series[];
  readonly guides: MarkGuides;
  readonly labels: MarimekkoLabelsProps | null;
  readonly gap: number;
  readonly radius: number;
  readonly format: (value: number) => string;
}

const valueOf = (row: Readonly<Record<string, unknown>>, key: string): number => Math.max(0, Number(row[key]) || 0);

function layoutMarimekko(r: Resolved, frame: MarkFrame, delays: Map<string, number>): MarkLayout {
  const { data, series, guides, gap } = r;
  const left = guides.yAxis === null ? 0 : Y_AXIS_WIDTH;
  const bottom = guides.xAxis === null ? 0 : X_AXIS_HEIGHT;
  const px = frame.x + left;
  const py = frame.y + 6;
  const pw = Math.max(0, frame.width - left);
  const ph = Math.max(0, frame.height - bottom - 6);
  const totals = data.map((row) => series.reduce((sum, s) => sum + valueOf(row, s.dataKey), 0));
  const whole = totals.reduce((a, b) => a + b, 0);
  const shown = data.map((_, index) => (totals[index] ?? 0) > 0);
  const columns = shown.filter(Boolean).length;
  const room = Math.max(0, pw - gap * Math.max(0, columns - 1));
  const nodes: SceneNode[] = [];
  const points: MarkDatum[] = [];
  delays.clear();
  // Guides under the marks.
  if (guides.grid !== null && guides.grid.horizontal !== false) {
    for (const f of fractions(4)) {
      nodes.push(gridRule(`mm:grid:${f}`, guides.grid, px, py + ph * (1 - f), px + pw, py + ph * (1 - f)));
    }
  }
  if (guides.yAxis !== null) {
    for (const f of fractions(4)) {
      nodes.push(tickLabel(`mm:y:${f}`, `${Math.round(f * 100)}%`, px - 10, py + ph * (1 - f), "end"));
    }
  }
  let x = px;
  let column = 0;
  data.forEach((row, rowIndex) => {
    const total = totals[rowIndex] ?? 0;
    if (!shown[rowIndex]) { return; }
    const width = whole > 0 ? (room * total) / whole : 0;
    const name = String(row[r.xDataKey] ?? "");
    const live = series.filter((s) => valueOf(row, s.dataKey) > 0);
    const segRoom = Math.max(0, ph - gap * Math.max(0, live.length - 1));
    let y = py + ph;
    let segment = 0;
    series.forEach((s, seriesIndex) => {
      const value = valueOf(row, s.dataKey);
      if (value <= 0) { return; }
      const height = (segRoom * value) / total;
      y -= height;
      const key = `mm:${rowIndex}:${seriesIndex}`;
      const share = value / total;
      const children: SceneNode[] = [{
        className: "bkm-mm-cell", height, key: `${key}:cell`, kind: "rect", radius: Math.min(r.radius, width / 2, height / 2), width, x, y,
        style: { fill: tint(s.color, 62), stroke: tint(s.color, 88), strokeWidth: 1 },
      }];
      if (r.labels !== null && width >= 34 && height >= 22) {
        const text = fitText(percentText(share), width - 12, 12, 600, frame.measure);
        if (text !== null) {
          const twoLines = r.labels.showValues === true && height >= 40;
          children.push({ anchor: "start", baseline: "middle", className: "bkm-mm-label", fontSize: 12, fontWeight: 600, key: `${key}:share`, kind: "label", style: { fill: contrastingText(tint(s.color, 62)) }, text, x: x + 7, y: y + 13 });
          if (twoLines) {
            const value2 = fitText(r.format(value), width - 12, 11, 500, frame.measure);
            if (value2 !== null) {
              children.push({ anchor: "start", baseline: "middle", className: "bkm-mm-value", fontSize: 11, fontWeight: 500, key: `${key}:value`, kind: "label", style: { fill: contrastingText(tint(s.color, 62)) }, text: value2, x: x + 7, y: y + 28 });
            }
          }
        }
      }
      nodes.push({ children, className: "bkm-mc-item bkm-mm-segment", key, kind: "group" });
      delays.set(key, column * COLUMN_STAGGER_MS + segment * SEGMENT_STAGGER_MS);
      const point: MarimekkoPoint = { color: s.color, column: name, columnShare: whole > 0 ? total / whole : 0, columnTotal: total, dataKey: s.dataKey, row, series: s.label, share, value };
      points.push({
        color: s.color, hit: { kind: "rect", x0: x, x1: x + width, y0: y, y1: y + height }, index: rowIndex, item: key, label: `${name}, ${s.label}`,
        related: data.map((_, other) => `mm:${other}:${seriesIndex}`).filter((other) => other !== key), row: point, series: seriesIndex, x: x + width / 2, y: y + height / 2,
      });
      y -= gap;
      segment += 1;
    });
    if (guides.xAxis !== null) {
      const label = fitText(name, width + gap - 4, 12, 500, frame.measure);
      if (label !== null) {
        nodes.push(tickLabel(`mm:x:${rowIndex}`, label, x + width / 2, py + ph + 14, "middle", { fill: "var(--chart-tooltip-foreground)", weight: 500 }));
      }
      const share = fitText(percentText(whole > 0 ? total / whole : 0), width + gap - 4, 11, 400, frame.measure);
      if (share !== null) {
        nodes.push(tickLabel(`mm:xs:${rowIndex}`, share, x + width / 2, py + ph + 30, "middle", { size: 11 }));
      }
    }
    x += width + gap;
    column += 1;
  });
  return { nodes, points };
}

/** The loading skeleton: as many columns as the data has rows (else 5), each as many segments as there are series (else 3), seeded
 * widths and heights, in the plot the guides leave (the grid drawn, the tick labels as stubs). */
const marimekkoSkeleton = (r: Resolved, frame: MarkFrame): SceneNode[] => {
  const { guides, gap } = r;
  const left = guides.yAxis === null ? 0 : Y_AXIS_WIDTH;
  const bottom = guides.xAxis === null ? 0 : X_AXIS_HEIGHT;
  const px = frame.x + left;
  const py = frame.y + 6;
  const pw = Math.max(0, frame.width - left);
  const ph = Math.max(0, frame.height - bottom - 6);
  const columns = r.data.length > 0 ? Math.min(12, r.data.length) : 5;
  const segments = r.series.length > 0 ? Math.min(6, r.series.length) : 3;
  const nodes: SceneNode[] = [];
  if (guides.grid !== null && guides.grid.horizontal !== false) {
    for (const f of fractions(4)) {
      nodes.push(gridRule(`mm:grid:${f}`, guides.grid, px, py + ph * (1 - f), px + pw, py + ph * (1 - f)));
    }
  }
  if (guides.yAxis !== null) {
    for (const f of fractions(4)) { nodes.push(boneLabel(`mm:y:${f}`, px - 10, py + ph * (1 - f), 22, "end")); }
  }
  const weights = Array.from({ length: columns }, (_, index) => 0.55 + boneShare(index, 11));
  const whole = weights.reduce((a, b) => a + b, 0);
  const room = Math.max(0, pw - gap * (columns - 1));
  let x = px;
  weights.forEach((weight, column) => {
    const width = (room * weight) / whole;
    const parts = Array.from({ length: segments }, (_, index) => 0.5 + boneShare(column * 7 + index, 23));
    const total = parts.reduce((a, b) => a + b, 0);
    const segRoom = Math.max(0, ph - gap * (segments - 1));
    let y = py + ph;
    parts.forEach((part, index) => {
      const height = (segRoom * part) / total;
      y -= height;
      nodes.push(boneRect(`mm:${column}:${index}`, x, y, width, height, Math.min(r.radius, width / 2, height / 2)));
      y -= gap;
    });
    if (guides.xAxis !== null) {
      nodes.push(boneLabel(`mm:x:${column}`, x + width / 2, py + ph + 14, Math.min(width * 0.6, 44)));
      nodes.push(boneLabel(`mm:xs:${column}`, x + width / 2, py + ph + 30, Math.min(width * 0.4, 26), "middle", 6));
    }
    x += width + gap;
  });
  return nodes;
};

/** The marimekko family: one builder per chart. */
export const MARIMEKKO_FAMILY: MarkChartFamily<MarimekkoChartProps> = {
  chart: "marimekko",
  props: {
    booleans: ["animate"],
    names: ["data", "status", "loadingLabel", "xDataKey", "gap", "radius", "formatValue", "onHoverChange", "aspectRatio", "height", "animate", "ariaLabel", "ariaDescription"],
  },
  placeholder: { data: [], xDataKey: "" },
  createBuilder: () => {
    const seriesCell = memoCell<readonly Series[]>();
    const guidesCell = memoCell<MarkGuides>();
    const buildCell = memoCell<MarkChartBuild>();
    return ({ props, table }) => {
      const segments = propsFor<MarimekkoSegmentProps>(table, MARIMEKKO_ROLES.segment);
      const series = seriesCell(segments.flatMap((s) => [s.dataKey, s.label, s.fill]), () =>
        segments.map((s, index) => ({ color: s.fill ?? paletteColor(undefined, index), dataKey: s.dataKey, label: s.label ?? s.dataKey })));
      const fresh = readGuides(table);
      const guides = guidesCell([fresh.grid, fresh.xAxis, fresh.yAxis], () => fresh);
      const labels = propsFor<MarimekkoLabelsProps>(table, MARIMEKKO_ROLES.labels).at(-1) ?? null;
      const animate = props.animate !== false;
      return buildCell([props.data, props.xDataKey, series, guides, labels, props.gap, props.radius, props.formatValue, props.onHoverChange, props.aspectRatio, props.height, animate, props.ariaLabel, props.ariaDescription], () => {
        const format = props.formatValue ?? intFmt;
        const resolved: Resolved = { data: props.data, format, gap: Math.max(0, props.gap ?? 2), guides, labels, radius: Math.max(0, props.radius ?? 4), series, xDataKey: props.xDataKey };
        const delays = new Map<string, number>();
        const enter = (key: string): MarkEnter | undefined => {
          const delay = delays.get(key);
          return delay === undefined ? undefined : growIn(delay, "y");
        };
        const tooltip = (datum: MarkDatum): ChartTooltipContent => {
          const point = datum.row as MarimekkoPoint;
          return {
            rows: series.map((s, index) => {
              const value = valueOf(point.row, s.dataKey);
              return { active: index === datum.series, color: s.color, label: s.label, value: `${format(value)} · ${percentText(point.columnTotal > 0 ? value / point.columnTotal : 0)}` };
            }),
            title: `${point.column} · ${percentText(point.columnShare)} of the total`,
          };
        };
        const items = (index: number): readonly string[] => props.data.map((_, row) => `mm:${row}:${index}`);
        return {
          ariaDescription: props.ariaDescription,
          describe: () => describeRowsChart({ kind: "Marimekko chart", unit: "columns", data: props.data, xKey: props.xDataKey, series: series.map((s) => ({ key: s.dataKey, label: s.label, format })) }),
          ariaLabel: props.ariaLabel ?? "Marimekko chart",
          ...(props.height === undefined ? { aspectRatio: parseAspectRatio(props.aspectRatio ?? "16 / 9") } : { height: props.height }),
          ...(animate ? { enter } : {}),
          ...(props.onHoverChange === undefined ? {} : { hover: (datum: MarkDatum | null) => props.onHoverChange?.(datum?.series ?? null) }),
          layout: (frame) => layoutMarimekko(resolved, frame, delays),
          seriesItems: items,
          skeleton: (frame) => marimekkoSkeleton(resolved, frame),
          tooltip,
        };
      });
    };
  },
};
