import { createMark } from "@tanstack/charts";
import type { ChartMark, ChartTextMeasureOptions, SceneNode } from "@tanstack/charts";
import { toNumber } from "./domains";
import type { AreaSeries, ResolvedSeries, Row } from "./series";

/** bklit's label: `font-medium text-[10px]`, a 3px halo in the background colour painted under the fill. */
const FONT_SIZE = 10;
const FONT_WEIGHT = 500;
/** The text box height bklit's `getBBox()` gives a 10px line (the font's ascent and descent). */
const LINE_HEIGHT = 12;
/** bklit layoutAreaValueLabels: 4px from the plot edges, 6px between labels and above / below the point. */
const PADDING = 4;
const GAP = 6;
/** bklit resolveAreaValueLabelCount: one label per 48px of plot width at most. */
const PX_PER_LABEL = 48;

/** bklit `valueLabelFmt`: English integers. */
const integerFormat = /* @__PURE__ */ new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface LabelBox {
  readonly index: number;
  readonly series: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}

/** bklit resolveAreaValueLabelCount: the preferred minimum, the plot width's allowance and the maximum. */
export function valueLabelCount(length: number, width: number, min = 2, max?: number): number {
  const minimum = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 2;
  const maximum = max !== undefined && Number.isFinite(max) ? Math.max(0, Math.floor(max)) : length;
  return Math.min(length, maximum, Math.max(minimum, Math.floor(Math.max(0, width) / PX_PER_LABEL)));
}

/** bklit evenlySpacedLabelIndices: `count` indices over `[0, length - 1]`, both ends included. */
export function evenlySpacedIndices(length: number, count: number): number[] {
  const n = Math.min(Math.max(0, Math.floor(count)), length);
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [0];
  }
  return Array.from({ length: n }, (_, i) => Math.round((i * (length - 1)) / (n - 1)));
}

/** bklit layoutAreaValueLabels: box centres in plot px, endpoints placed first, then left to right; each tries above its point, then below, and is dropped on a collision. */
export function layoutValueLabels<B extends Omit<LabelBox, "text"> & { readonly text?: string }>(boxes: readonly B[], width: number, height: number): B[] {
  const placed: B[] = [];
  const visible = boxes.filter(
    (box) =>
      [box.index, box.x, box.y, box.width, box.height].every(Number.isFinite) &&
      box.x >= 0 &&
      box.x <= width &&
      box.y >= 0 &&
      box.y <= height &&
      box.width > 0 &&
      box.height > 0 &&
      box.width + PADDING * 2 <= width &&
      box.height + PADDING * 2 <= height,
  );
  if (visible.length === 0) {
    return placed;
  }
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const box of visible) {
    first = Math.min(first, box.index);
    last = Math.max(last, box.index);
  }
  const edge = (index: number): number => (index === first || index === last ? 0 : 1);
  const order = [...visible].sort((a, b) => edge(a.index) - edge(b.index) || a.x - b.x || a.y - b.y);
  for (const box of order) {
    const x = Math.max(PADDING + box.width / 2, Math.min(width - PADDING - box.width / 2, box.x));
    const offset = box.height / 2 + GAP;
    for (const y of [box.y - offset, box.y + offset]) {
      if (y - box.height / 2 < PADDING || y + box.height / 2 > height - PADDING) {
        continue;
      }
      const collides = placed.some((other) => Math.abs(x - other.x) < (box.width + other.width) / 2 + GAP && Math.abs(y - other.y) < (box.height + other.height) / 2 + GAP);
      if (!collides) {
        placed.push({ ...box, x, y });
        break;
      }
    }
  }
  return placed;
}

export interface ValueLabelsOptions {
  readonly id: string;
  readonly rows: readonly Row[];
  readonly series: readonly (ResolvedSeries & AreaSeries)[];
  readonly xOf: (row: Row) => Date;
}

/** The fade class of a series' labels (`fadeValueLabels`): styles.css masks the group with the series' edge fade over the plot. */
const fadeClass = (fade: ResolvedSeries["fadeEdges"]): string => {
  if (!fade) {
    return "";
  }
  if (fade === "left" || fade === "right") {
    return ` bkm-vlabels-fade-${fade}`;
  }
  return " bkm-vlabels-fade";
};

/** One mark drawing every `showValue` Area's labels (none when no series shows them). */
export function valueLabelsMark({ id, rows, series, xOf }: ValueLabelsOptions): ChartMark<unknown, Date, number> | undefined {
  const shown = series.filter((s) => s.valueLabels !== undefined);
  if (shown.length === 0) {
    return undefined;
  }
  return createMark<unknown, Date, number>(() => ({
    id,
    // No channels: the labels never move a domain.
    channels: {},
    render: ({ chart, scales, layout }) => {
      const typography = layout.typography;
      const measure = (text: string): number => {
        const options: ChartTextMeasureOptions = {
          fontSize: FONT_SIZE,
          fontWeight: FONT_WEIGHT,
          fontFamily: typography?.fontFamily || "sans-serif",
          fontStyle: typography?.fontStyle || "normal",
          fontStretch: typography?.fontStretch || "normal",
          letterSpacing: typography?.letterSpacing ?? 0,
          direction: typography?.direction ?? "inherit",
          fontScale: typography?.fontScale ?? 1,
          anchor: "middle",
          baseline: "middle",
        };
        return layout.measureText ? layout.measureText(text, options).width : text.length * FONT_SIZE * 0.6;
      };
      const x = scales.x;
      // The rows inside the plot, with their x in plot px (bklit: `xScale(x)` within [0, innerWidth]).
      const inside = rows.flatMap((row, index) => {
        const px = (x?.map(xOf(row)) ?? Number.NaN) - chart.x;
        return Number.isFinite(px) && px >= 0 && px <= chart.width ? [{ row, index, x: px }] : [];
      });
      const perSeries = shown.map((s) => {
        const points = inside.filter(({ row }) => Number.isFinite(toNumber(row[s.dataKey])));
        const spec = s.valueLabels;
        return { s, points, count: valueLabelCount(points.length, chart.width, spec?.minCount, spec?.maxCount) };
      });
      const enabled = perSeries.map((p) => p.count).filter((n) => n > 0);
      const shared = enabled.length > 0 ? Math.min(...enabled) : 0;
      const boxes: LabelBox[] = perSeries.flatMap(({ s, points, count }, seriesIndex) => {
        const n = Math.min(shared, count);
        const yScale = scales[s.yAxisId === "left" ? "y" : `y:${s.yAxisId}`] ?? scales.y;
        return evenlySpacedIndices(points.length, n).flatMap((position) => {
          const point = points[position];
          if (!point) {
            return [];
          }
          const value = toNumber(point.row[s.dataKey]);
          const py = (yScale?.map(value) ?? Number.NaN) - chart.y;
          if (!Number.isFinite(py)) {
            return [];
          }
          const text = s.valueLabels?.format?.(value) ?? integerFormat.format(value);
          return [{ index: point.index, series: seriesIndex, x: point.x, y: py, width: measure(text), height: LINE_HEIGHT, text }];
        });
      });
      const placed = layoutValueLabels(boxes, chart.width, chart.height);
      const groups: SceneNode[] = perSeries.map(({ s }, seriesIndex) => {
        const spec = s.valueLabels;
        const labels: SceneNode[] = placed
          .filter((box) => box.series === seriesIndex)
          .map((box) => ({
            kind: "label",
            key: `${id}:${seriesIndex}:${box.index}`,
            className: "bkm-vlabel",
            x: chart.x + box.x,
            y: chart.y + box.y,
            text: box.text,
            anchor: "middle",
            baseline: "middle",
            fontSize: FONT_SIZE,
            fontWeight: FONT_WEIGHT,
            style: { fill: spec?.color ?? s.stroke },
          }));
        // A box the size of the plot, so a faded group's mask spans the plot as bklit's userSpaceOnUse mask does.
        const frame: SceneNode[] = spec?.fade ? [{ kind: "rect", key: `${id}:${seriesIndex}:frame`, x: chart.x, y: chart.y, width: chart.width, height: chart.height, style: { fill: "none" } }] : [];
        return { kind: "group", key: `${id}:${seriesIndex}`, className: `bkm-vlabels${spec?.fade ? fadeClass(s.fadeEdges) : ""}`, ariaHidden: true, children: [...frame, ...labels] };
      });
      return { nodes: groups, points: [] };
    },
  }));
}
