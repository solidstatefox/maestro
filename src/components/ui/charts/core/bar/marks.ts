import { createMark } from "@tanstack/charts";
import type { ChartMark, ChartMotionContext, ChartPoint, ResolvedScale, SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { isString } from "../guards";
import type { ChildTable } from "../carriers/table";
import { scaleBand } from "d3-scale";
import type { OverlayDot } from "../cartesian/hover-overlay";
import { computeSquareColumn, topSquareCenterY } from "./geometry";
import type { BarColumnTrackProps } from "../types/bar";
import { REVEAL_EASING } from "../motion/easing";
import { enterOrResume } from "./enter-timing";
import type { EnterTiming } from "./enter-timing";
import { barIndexClass } from "./hover";
import type { HoverTarget } from "./hover";
import type { BarDatum, BarSeries } from "./model";

export interface ExtraMarkInput {
  readonly datums: readonly BarDatum[];
  readonly series: readonly BarSeries[];
  readonly table: ChildTable;
  readonly categories: readonly string[];
  readonly animationDuration: number;
  readonly faded: number;
  readonly uid: string;
  /** First paint of an entrance: square columns render collapsed so the next build tweens them in. */
  readonly seed: boolean;
  /** Entrance clock shared across builds (the seed build and the one after it): later updates resume it, then snap. */
  readonly clock: { at: number | null };
  /** The plot height of the latest draw, unfloored (written by the definition's `chart` callback before the marks render). */
  readonly live: { innerHeight: number };
}

/** Documented node `className` (reference/runtime-and-scene.md "Scene nodes") the hover CSS selects, instead of the key encoding. */
const columnClass = (kind: "squares" | "track", seriesIndex: number): string => `bkm-b${kind}-s${seriesIndex}`;

const SQUARE_GAP = 3;
const SQUARE_RADIUS = 0.25;

type Scales = Readonly<Record<string, ResolvedScale>>;

/** A chart scale by channel name; typed optional because a chart without that channel has no scale. */
export const scaleAt = (scales: Scales, key: string): ResolvedScale | undefined => scales[key];

/** Linear blend across gradient stops, expressed with CSS `color-mix` so `var(--chart-*)` colours stay themeable. */
function stopColor(stops: readonly { offset: number; color: string }[], t: number): string {
  if (stops.length === 0) { return "currentColor"; }
  // bklit emits `offset={`${offset}%`}`: offsets are PERCENTAGES (0..100), so a 0..1 pair is ~flat (0% / 1%).
  const scale = 100;
  const pos = Math.min(1, Math.max(0, t));
  let prev = stops[0];
  if (pos <= prev.offset / scale) { return prev.color; }
  for (const next of stops.slice(1)) {
    if (pos <= next.offset / scale) {
      const span = (next.offset - prev.offset) / scale || 1;
      const u = (pos - prev.offset / scale) / span;
      return `color-mix(in srgb, ${prev.color} ${((1 - u) * 100).toFixed(1)}%, ${next.color})`;
    }
    prev = next;
  }
  return prev.color;
}

interface ColumnInput {
  readonly id: string;
  readonly datums: readonly BarDatum[];
  readonly slot: number;
  readonly slots: number;
  readonly groupGap: number;
  readonly kind: "squares" | "track";
  readonly squareGap: number;
  readonly squareRadius: number;
  readonly squareFit: boolean;
  readonly fill: string;
  readonly opacity: number;
  readonly stops?: readonly { offset: number; color: string }[];
  /** BarSquares `colorKey`: a row's string under this key solid-fills its column (no gradient). */
  readonly colorKey?: string;
  readonly animationDuration: number;
  readonly staggerMs: number;
  readonly seed: boolean;
  readonly clock: { at: number | null };
  readonly uid: string;
  readonly live: { innerHeight: number };
}

interface ColumnFrame {
  readonly pointKey: string;
  readonly className: string;
  readonly x: number;
  readonly size: number;
  readonly radius: number;
  readonly columnTop: number;
  readonly baseline: number;
}

// Parity: bklit's BarColumnTrack is one rounded rect per column over the empty remainder above the squares (squareGap / squareFit only place its bottom,
// squareRadius rounds it), not a stack of empty squares; bar-chart.md's "faint empty squares" wording was wrong, the carrier's JSDoc says what it draws.
function trackNode(input: ColumnInput, f: ColumnFrame, seedTop: number): SceneNode {
  const height = Math.max(0, f.columnTop - seedTop);
  // Seed: bklit starts the track as a full-height column (y 0 .. baseline) that shrinks to its remainder.
  return {
    kind: "rect",
    key: `${f.pointKey}:sq0`,
    className: f.className,
    x: f.x,
    y: input.seed ? seedTop : f.columnTop - height,
    width: f.size,
    height: input.seed ? f.baseline - seedTop : height,
    radius: f.radius,
    ariaHidden: true,
    style: { fill: input.fill, opacity: input.opacity },
  };
}

function squareNodes(input: ColumnInput, f: ColumnFrame, col: ReturnType<typeof computeSquareColumn>, own: string | undefined): SceneNode[] {
  return col.positions.map((rel, i): SceneNode => {
    const centreT = col.columnHeight > 0 ? (col.columnHeight - (rel + f.size / 2)) / col.columnHeight : 0;
    // Seed: each square starts as a zero-height sliver on its own bottom edge (bklit grows it in place).
    const squareY = f.columnTop + rel;
    return {
      kind: "rect",
      key: `${f.pointKey}:sq${i}`,
      className: f.className,
      x: f.x,
      y: input.seed ? squareY + f.size : squareY,
      width: f.size,
      height: input.seed ? 0 : f.size,
      radius: f.radius,
      style: { fill: own ?? (input.stops ? stopColor(input.stops, centreT) : input.fill), opacity: 1 },
    };
  });
}

function columnTiming(input: ColumnInput, counts: ReadonlyMap<string, number>, ctx: ChartMotionContext<BarDatum>): EnterTiming {
  const { id, kind } = input;
  const total = input.animationDuration;
  const cat = Math.max(0, ctx.datumIndex);
  const sqIndex = Number(/:sq(\d+)$/u.exec(ctx.key)?.[1] ?? 0);
  const count = counts.get(ctx.key.slice(id.length + 1).replace(/:sq\d+$/u, "")) ?? 1;
  const cascade = kind === "squares" && count > 1 ? (total * 0.4) / (count - 1) : 0;
  // bklit runs every square on the full enter tween (delay = column stagger + square cascade); the track
  // shrinks from the full plot height over that tween plus the column's whole cascade.
  const trackSpan = count > 1 ? total * 1.4 : total;
  const plan = { delay: cat * input.staggerMs + sqIndex * cascade, duration: kind === "squares" ? total : trackSpan, easing: REVEAL_EASING };
  // Seeded squares are collapsed nodes, so the entrance arrives as the first UPDATE. A render forced mid-entrance
  // (web-font swap) re-enters here as another update: resume the schedule instead of restarting it; false once it is over.
  return enterOrResume(input.clock, ctx.phase, plan);
}

/** One column of stacked squares per category (kind "squares") or the empty remainder above it (kind "track"), as plain rect nodes keyed under a point key. */
function columnMark(input: ColumnInput): ChartMark<BarDatum, string, number> {
  const { id, datums, slot, slots, groupGap, kind } = input;
  const counts = new Map<string, number>();
  const gapPx = slots > 1 ? groupGap : 0;
  // The schedule must outlive the mark thunk (re-run per render) and the build (seed, then full): clock lives in the input.
  return createMark<BarDatum, string, number>(() => ({
    id,
    channels: {
      x: { scale: "x", values: datums.map((d) => d.category) },
      y: { scale: "y", includeZero: true, values: datums.map((d) => d.value) },
    },
    motion: (ctx: ChartMotionContext<BarDatum>): EnterTiming => columnTiming(input, counts, ctx),
    render: ({ scales, color }) => {
      const sx = scaleAt(scales, "x");
      const sy = scaleAt(scales, "y");
      const nodes: SceneNode[] = [];
      const points: ChartPoint<BarDatum, string, number>[] = [];
      if (sx === undefined || sy === undefined) {
        return { nodes, points };
      }
      // bklit's value scale runs [innerHeight, 0], so a host shorter than its margins gives every column a negative length and no square (bar-squares.tsx:338-355);
      // the renderer floors the plot at 1px, which would leave a row of sub-pixel squares.
      if (input.live.innerHeight <= 0) {
        return { nodes, points };
      }
      const bw = sx.bandwidth || 0;
      const size = Math.max(0, (bw - gapPx * (slots - 1)) / slots);
      const radius = size * input.squareRadius;
      const baseline = sy.map(0);
      for (const [index, d] of datums.entries()) {
        const centre = sx.map(d.category);
        const top = sy.map(d.value);
        if (Number.isFinite(centre) && Number.isFinite(top) && d.value > 0) {
          const x = centre - bw / 2 + slot * (size + gapPx);
          const col = computeSquareColumn({ barLengthPx: baseline - top, squareSize: size, gap: input.squareGap, fit: input.squareFit });
          const columnTop = baseline - col.columnHeight;
          const pointKey = `${id}:${d.index}`;
          const className = `${columnClass(kind, slot)} ${barIndexClass(d.index)}`;
          counts.set(String(d.index), col.count);
          points.push({
            key: pointKey,
            markId: id,
            group: d.series,
            groupLabel: d.series,
            datum: d,
            datumIndex: index,
            xValue: d.category,
            yValue: d.value,
            x: x + size / 2,
            y: columnTop,
            color: color(d.series),
          });
          const frame: ColumnFrame = { pointKey, className, x, size, radius, columnTop, baseline };
          const own = input.colorKey === undefined ? undefined : d.source[input.colorKey];
          nodes.push(...(kind === "track" ? [trackNode(input, frame, sy.map(sy.domain[1]))] : squareNodes(input, frame, col, isString(own) ? own : undefined)));
        }
      }
      return { nodes, points };
    },
  }));
}

export interface ExtraMarks {
  readonly marks: ChartMark<BarDatum, string, number>[];
  readonly hover: HoverTarget[];
}

export function buildExtraMarks(input: ExtraMarkInput): ExtraMarks {
  const { series, datums, table, animationDuration } = input;
  const squares = series.flatMap((s) => (s.kind === "squares" && s.squares ? [{ series: s, props: s.squares }] : []));
  const out: ChartMark<BarDatum, string, number>[] = [];
  if (squares.length === 0) {
    return { marks: out, hover: [] };
  }
  const staggerMs = (animationDuration * 0.4) / Math.max(1, input.categories.length);
  const track = propsFor<BarColumnTrackProps>(table, "barColumnTrack").at(0);
  const slots = series.length;
  const hover: HoverTarget[] = [];
  const common = { uid: input.uid, seed: input.seed, clock: input.clock, live: input.live, animationDuration, staggerMs };
  if (track !== undefined) {
    for (const { series: s } of squares) {
      // bklit hides the empty track on any hover.
      hover.push({ select: `.${columnClass("track", s.index)}`, keep: null, dim: 0, snap: true });
      out.push(
        columnMark({
          ...common,
          id: `track:${s.key}`,
          datums: datums.filter((d) => d.series === s.key),
          slot: s.index,
          slots,
          groupGap: track.groupGap ?? 4,
          kind: "track",
          squareGap: track.squareGap ?? SQUARE_GAP,
          squareRadius: track.squareRadius ?? SQUARE_RADIUS,
          squareFit: track.squareFit ?? false,
          fill: track.fill ?? "var(--chart-grid)",
          opacity: track.opacity ?? 0.3,
          // An own `staggerDelay` (seconds) replaces the derived column spread (bklit bar-squares.tsx:460-462).
          staggerMs: track.staggerDelay === undefined ? staggerMs : track.staggerDelay * 1000,
        }),
      );
    }
  }
  for (const { series: s, props } of squares) {
    hover.push({
      select: `.${columnClass("squares", s.index)}`,
      keep: (index) => `.${barIndexClass(index)}`,
      dim: props.fadedOpacity ?? input.faded,
      seriesIndex: s.index,
    });
    const stops = props.useGradient === true && (props.gradientStops?.length ?? 0) >= 2 ? props.gradientStops : undefined;
    out.push(
      columnMark({
        ...common,
        id: `squares:${s.key}`,
        datums: datums.filter((d) => d.series === s.key),
        slot: s.index,
        slots,
        groupGap: props.groupGap ?? 4,
        kind: "squares",
        squareGap: props.squareGap ?? SQUARE_GAP,
        squareRadius: props.squareRadius ?? SQUARE_RADIUS,
        squareFit: props.squareFit ?? false,
        fill: s.fill,
        opacity: 1,
        stops,
        colorKey: props.colorKey,
        // An own `staggerDelay` (seconds) replaces the derived column spread (bklit bar-squares.tsx:334-336).
        staggerMs: props.staggerDelay === undefined ? staggerMs : props.staggerDelay * 1000,
      }),
    );
  }
  return { marks: out, hover };
}

/** Where bklit's horizontal-bar crosshair sits for a category: the end of the longest bar (cumulative end when stacked), as a value on the value scale. */
export function barEndValues(datums: readonly BarDatum[], stacked: boolean): ReadonlyMap<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const d of datums) {
    if (Number.isFinite(d.value)) {
      const list = byCategory.get(d.category);
      if (list) {
        list.push(d.value);
      } else {
        byCategory.set(d.category, [d.value]);
      }
    }
  }
  return new Map([...byCategory].map(([category, values]) => [category, stacked ? values.reduce((a, b) => a + b, 0) : Math.max(...values)] as const));
}

interface DotCross {
  readonly d: BarDatum;
  readonly i: number;
  readonly bandwidth: number;
  readonly slot: number;
  readonly gapPx: number;
  readonly seriesCount: number;
  readonly stacked: boolean;
  readonly square: { readonly groupGap: number } | undefined;
}

/** Offset of a bar's dot from the band centre: stacked bars sit on it, square columns use their own slot width. */
function dotCross({ d, i, bandwidth, slot, gapPx, seriesCount, stacked, square }: DotCross): number {
  if (square && d.value > 0) {
    const sqGap = seriesCount > 1 ? square.groupGap : 0;
    const size = Math.max(0, (bandwidth - sqGap * (seriesCount - 1)) / seriesCount);
    return -bandwidth / 2 + i * (size + sqGap) + size / 2;
  }
  return stacked ? 0 : -bandwidth / 2 + i * (slot + gapPx) + slot / 2;
}

/** bklit TooltipDot variant "ring": a transparent rounded square around the bar end (tooltip-dot.tsx:30-35, 132-148; chart-tooltip.tsx:145-160). */
export interface RingDots {
  readonly fraction: number;
  readonly scale: number;
  readonly size: number;
  /** Gap between square slots: the squareSnap group gap, else 4 for several series. */
  readonly slotGap: number;
  readonly strokeWidth: number;
  readonly color?: string;
}

function ringHalfExtent(ring: RingDots, bandwidth: number, count: number): number {
  if (bandwidth <= 0) {
    return ring.size * ring.scale;
  }
  return (Math.max(0, (bandwidth - ring.slotGap * (count - 1)) / count) / 2) * ring.scale;
}

export interface HoverDotsOptions {
  readonly datums: readonly BarDatum[];
  readonly series: readonly BarSeries[];
  readonly categories: readonly string[];
  readonly barGap: number;
  readonly groupGap: number;
  readonly ring?: RingDots;
  readonly radius?: number;
  readonly stacked?: boolean;
  readonly stackGap?: number;
  /** Series drawn as stacked squares: dots sit on the column top, not the raw value. */
  readonly squares?: ReadonlyMap<string, { readonly gap: number; readonly fit: boolean; readonly groupGap: number }>;
  /** BarChart `squareSnap`: grouped vertical dots sit on the centre of the column's top square (bklit bar-chart.tsx:486-494). */
  readonly squareSnap?: { readonly squareGap: number; readonly fit?: boolean };
}

/** The band geometry of a plot: bandwidth and the centre of each category from the left of the plot (the chart's `scaleBand` with the same padding). */
export function bandOf(categories: readonly string[], barGap: number, innerWidth: number): { readonly bandwidth: number; readonly centre: (category: string) => number } {
  const band = scaleBand().domain(categories).range([0, innerWidth]).padding(barGap);
  const bandwidth = band.bandwidth();
  return { bandwidth, centre: (category) => (band(category) ?? Number.NaN) + bandwidth / 2 };
}

/** Vertical-bar dots for the host's HoverOverlay (bklit's per-bar TooltipDot): one per series, placed on the focused category's bar end. */
export function barOverlayDots(options: HoverDotsOptions): OverlayDot[] {
  const { datums, series, categories, barGap, groupGap, radius = 5, squares, squareSnap, stacked = false, stackGap = 0, ring } = options;
  const slots = new Map(series.map((s, i) => [s.key, i] as const));
  const byCategory = new Map<string, BarDatum[]>();
  for (const d of datums) {
    const list = byCategory.get(d.category);
    if (list) {
      list.push(d);
    } else {
      byCategory.set(d.category, [d]);
    }
  }
  const count = Math.max(1, series.length);
  const gapPx = count > 1 ? groupGap : 0;
  const bandFor = memoBand(categories, barGap);
  const seriesKeys = [...new Set(datums.map((d) => d.series))];
  return seriesKeys.map((key): OverlayDot => {
    const i = slots.get(key) ?? 0;
    const fill = series[i]?.fill ?? "currentColor";
    return {
      yAxis: "y",
      valueOf: () => undefined,
      glide: true,
      shapes: ring
        ? (plot) => {
            const half = ringHalfExtent(ring, bandFor(plot.innerWidth).bandwidth, count);
            return [{ r: half, corner: half * 2 * Math.max(0, Math.min(0.5, ring.fraction)), fill: "transparent", stroke: ring.color ?? fill, strokeWidth: ring.strokeWidth }];
          }
        : [{ r: radius, fill, stroke: "var(--chart-background)", strokeWidth: 2 }],
      at: (_row, plot, index) => {
        const list = byCategory.get(categories[index] ?? "");
        const sy = plot.yDomains.y;
        if (!list || !sy) {
          return undefined;
        }
        const { bandwidth } = bandFor(plot.innerWidth);
        const slot = Math.max(0, (bandwidth - gapPx * (count - 1)) / count);
        let cumulative = 0;
        let seen = 0;
        for (const d of list) {
          let { value } = d;
          let along = 0;
          if (stacked) {
            cumulative += Number.isFinite(d.value) ? d.value : 0;
            value = cumulative;
            along = seen * stackGap * -1;
            seen += 1;
          }
          if (d.series === key) {
            const toY = (v: number): number => plot.innerHeight - ((v - sy[0]) / (sy[1] - sy[0] || 1)) * plot.innerHeight;
            const raw = toY(value) + along;
            const y = squareSnap && !stacked && value > 0
              ? topSquareCenterY({ baselineY: toY(0), barLengthPx: toY(0) - raw, squareSize: slot, gap: squareSnap.squareGap, fit: squareSnap.fit })
              : raw;
            return Number.isFinite(y) ? { dx: dotCross({ d, i, bandwidth, slot, gapPx, seriesCount: series.length, stacked, square: squares?.get(d.series) }), y } : undefined;
          }
        }
        return undefined;
      },
    };
  });
}

/** `bandOf` for the latest plot width only: a focus move reads it for every dot, the width changes on resize. */
export function memoBand(categories: readonly string[], barGap: number): (innerWidth: number) => ReturnType<typeof bandOf> {
  let width = Number.NaN;
  let band: ReturnType<typeof bandOf> | null = null;
  return (innerWidth) => {
    if (band === null || width !== innerWidth) {
      width = innerWidth;
      band = bandOf(categories, barGap, innerWidth);
    }
    return band;
  };
}
