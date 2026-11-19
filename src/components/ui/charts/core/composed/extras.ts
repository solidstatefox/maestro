import { dot, rect } from "@tanstack/charts";
import type { ChartMark } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { yScaleForAxis } from "../cartesian/build-state";
import type { OverlayDot } from "../cartesian/hover-overlay";
import { axisId } from "../cartesian/series";
import { decorative } from "@tanstack/charts/mark/decorative";
import { erase } from "../erased-types";
import type { ScatterConfig } from "../types/cartesian";
import type { CandlestickProps } from "../types/candlestick";
import type { BarLayoutInput } from "./bars";
import { growMotionOf } from "./bars";
import { dateValue, numberValue, stringValue } from "./narrow";

type Row = Record<string, unknown>;
type ExtraMark = ChartMark<Row, Date, number>;

const POSITIVE = "var(--chart-positive)";
const NEGATIVE = "var(--chart-negative)";
/** bklit's default candle fills are gradients defined by CandlestickChart; outside it they fall back to these solid colours (candlestick.tsx). */
const DEFAULT_FILLS: ReadonlySet<string> = /* @__PURE__ */ new Set(["url(#candlestick-positive)", "url(#candlestick-negative)"]);
const WICK_WIDTH = 1.5;
/** bklit `defaultScatterColors`: a Scatter without `fill` or `stroke` takes the next of these. */
const SCATTER_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;

export interface ComposedCandleSpec {
  readonly yAxisId: string;
  readonly positiveFill: string;
  readonly negativeFill: string;
  readonly widthRatio: number;
  readonly animate: boolean;
  readonly fadedOpacity: number;
  readonly showHoverFade: boolean;
}

export interface ComposedScatterSpec {
  readonly dataKey: string;
  readonly label?: string;
  readonly yAxisId: string;
  readonly fill: string;
  readonly radius: number;
  /** An offset ring (`strokeWidth` > 0, `ringGap` from the dot), bklit's opt-in. */
  readonly ring: { readonly color: string; readonly width: number; readonly gap: number } | null;
  readonly animate: boolean;
  readonly fadeOnHover: boolean;
  readonly inactiveOpacity: number;
}

/** The chart's first Candlestick child (bklit registers one OHLC series), with its defaults. */
export function candleSpecOf(table: ChildTable): ComposedCandleSpec | null {
  const p = propsFor<CandlestickProps & { readonly yAxisId?: string | number; readonly widthRatio?: number }>(table, "candlestick").at(0);
  if (p === undefined) {
    return null;
  }
  const solid = (fill: string | undefined, fallback: string): string => (fill === undefined || DEFAULT_FILLS.has(fill) ? fallback : fill);
  return {
    yAxisId: axisId(p.yAxisId),
    positiveFill: solid(p.positiveFill, POSITIVE),
    negativeFill: solid(p.negativeFill, NEGATIVE),
    widthRatio: Math.min(Math.max(p.widthRatio ?? 0.6, 0.05), 1),
    animate: p.animate !== false,
    fadedOpacity: p.fadedOpacity ?? 0.3,
    showHoverFade: p.showHoverFade !== false,
  };
}

/** The Scatter children in tree order, with their defaults; one without a dataKey draws nothing. */
export function scatterSpecsOf(table: ChildTable): ComposedScatterSpec[] {
  return propsFor<ScatterConfig>(table, "scatter").flatMap((p, i): ComposedScatterSpec[] => {
    if (p.dataKey === "") {
      return [];
    }
    const fill = stringValue(p.fill) ?? stringValue(p.stroke) ?? SCATTER_COLORS[i % SCATTER_COLORS.length];
    const width = p.strokeWidth ?? 0;
    return [{
      dataKey: p.dataKey,
      label: p.label,
      yAxisId: axisId(p.yAxisId),
      fill,
      radius: p.radius ?? 5,
      ring: width > 0 ? { color: stringValue(p.stroke) ?? fill, width, gap: p.ringGap ?? 2 } : null,
      animate: p.animate !== false,
      fadeOnHover: p.fadeOnHover !== false,
      inactiveOpacity: p.inactiveOpacity ?? 0.3,
    }];
  });
}

const ohlc = (row: Row): { readonly open: number; readonly high: number; readonly low: number; readonly close: number } | null => {
  const open = numberValue(row.open);
  const high = numberValue(row.high);
  const low = numberValue(row.low);
  const close = numberValue(row.close);
  return open === undefined || high === undefined || low === undefined || close === undefined ? null : { open, high, low, close };
};

/** The candle and point values by axis, for the y domains (a candle's axis floats around its wicks: `floatingAxes`). */
export function extraValuesByAxis(data: readonly Row[], candle: ComposedCandleSpec | null, scatters: readonly ComposedScatterSpec[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const push = (axis: string, v: number): void => {
    const list = out.get(axis);
    if (list) {
      list.push(v);
    } else {
      out.set(axis, [v]);
    }
  };
  for (const row of data) {
    const c = candle ? ohlc(row) : null;
    if (candle && c) {
      push(candle.yAxisId, c.low);
      push(candle.yAxisId, c.high);
    }
    for (const s of scatters) {
      const v = numberValue(row[s.dataKey]);
      if (v !== undefined) {
        push(s.yAxisId, v);
      }
    }
  }
  return out;
}

interface ExtraLayout {
  readonly layout: BarLayoutInput;
  readonly candle: ComposedCandleSpec | null;
  readonly scatters: readonly ComposedScatterSpec[];
}

/** The candles: a wick (1.5px, low..high) and a body (open..close, `widthRatio` of the slot) per row, keyed by row index. */
function candleMarks({ layout, candle }: ExtraLayout, grow: ReturnType<typeof growMotionOf>): ExtraMark[] {
  const { data, xKey, innerWidth, innerHeight, xSpanMs, yDomains, entered } = layout;
  if (!candle || data.length === 0 || innerWidth <= 0 || innerHeight <= 0) {
    return [];
  }
  const domain = yDomains.get(candle.yAxisId) ?? [0, 100];
  const unitsPerPx = (domain[1] - domain[0]) / innerHeight;
  const msPerPx = xSpanMs / innerWidth;
  const slot = innerWidth / Math.max(1, data.length);
  const half = (Math.max(1, slot * candle.widthRatio) / 2) * msPerPx;
  const wickHalf = (WICK_WIDTH / 2) * msPerPx;
  const rows = data.flatMap((row, i) => {
    const c = ohlc(row);
    return c ? [{ i, row, t: dateValue(row[xKey]).getTime(), ...c }] : [];
  });
  const seeded = entered || !candle.animate;
  // bklit's body is `|close - open| || 1` px tall; before the grow, body and wick sit collapsed on their centres (bklit's scaleY from 0).
  const bodyLo = (r: (typeof rows)[number]): number => Math.min(r.open, r.close);
  const bodyHi = (r: (typeof rows)[number]): number => (r.open === r.close ? r.close + unitsPerPx : Math.max(r.open, r.close));
  const motion = candle.animate ? grow : false;
  const axis = yScaleForAxis(candle.yAxisId);
  // One wick and one body mark per direction: a native rect takes one fill.
  return ([["pos", candle.positiveFill, (r: (typeof rows)[number]): boolean => r.close >= r.open], ["neg", candle.negativeFill, (r: (typeof rows)[number]): boolean => r.close < r.open]] as const).flatMap(
    ([dir, fill, keep]): ExtraMark[] => {
      const own = rows.filter(keep);
      const at = (index: number): (typeof rows)[number] => own[index];
      const wick = rect(own.map((r) => r.row), {
        id: `candle:${dir}:wick`,
        x: (_d: Row, { index }: { index: number }) => new Date(at(index).t),
        x1: (_d: Row, { index }: { index: number }) => new Date(at(index).t - wickHalf),
        x2: (_d: Row, { index }: { index: number }) => new Date(at(index).t + wickHalf),
        y1: (_d: Row, { index }: { index: number }) => (seeded ? at(index).low : (at(index).low + at(index).high) / 2),
        y2: (_d: Row, { index }: { index: number }) => (seeded ? at(index).high : (at(index).low + at(index).high) / 2 + 0.01 * unitsPerPx),
        key: (_d: Row, { index }: { index: number }) => at(index).i,
        fill,
        inset: 0,
        motion,
        ...axis,
      });
      const body = rect(own.map((r) => r.row), {
        id: `candle:${dir}`,
        x: (_d: Row, { index }: { index: number }) => new Date(at(index).t),
        x1: (_d: Row, { index }: { index: number }) => new Date(at(index).t - half),
        x2: (_d: Row, { index }: { index: number }) => new Date(at(index).t + half),
        y: (_d: Row, { index }: { index: number }) => at(index).close,
        y1: (_d: Row, { index }: { index: number }) => (seeded ? bodyLo(at(index)) : (bodyLo(at(index)) + bodyHi(at(index))) / 2),
        y2: (_d: Row, { index }: { index: number }) => (seeded ? bodyHi(at(index)) : (bodyLo(at(index)) + bodyHi(at(index))) / 2 + 0.01 * unitsPerPx),
        z: () => "close",
        key: (_d: Row, { index }: { index: number }) => at(index).i,
        fill,
        stroke: fill,
        strokeWidth: 1,
        radius: 1,
        inset: 0,
        motion,
        ...axis,
      });
      return [erase(decorative(wick)), erase(body)];
    },
  );
}

/** The points of each Scatter: a dot of `radius` per row (radius 0 before the grow), an optional offset ring, keyed by row index. */
function scatterMarks({ layout, scatters }: ExtraLayout, grow: ReturnType<typeof growMotionOf>): ExtraMark[] {
  const { data, xKey, entered } = layout;
  return scatters.flatMap((s): ExtraMark[] => {
    const rows = data.flatMap((row, i) => {
      const v = numberValue(row[s.dataKey]);
      return v === undefined ? [] : [{ i, row, t: dateValue(row[xKey]), v }];
    });
    const at = (index: number): (typeof rows)[number] => rows[index];
    const grown = entered || !s.animate;
    const motion = s.animate ? grow : false;
    const common = {
      x: (_d: Row, { index }: { index: number }): Date => at(index).t,
      y: (_d: Row, { index }: { index: number }): number => at(index).v,
      key: (_d: Row, { index }: { index: number }): number => at(index).i,
      motion,
      ...yScaleForAxis(s.yAxisId),
    };
    const points = dot(rows.map((r) => r.row), erase({ ...common, id: `scatter:${s.dataKey}`, z: () => s.dataKey, r: grown ? s.radius : 0, fill: s.fill }));
    if (s.ring === null) {
      return [erase(points)];
    }
    const ring = dot(rows.map((r) => r.row), erase({ ...common, id: `scatter:${s.dataKey}:ring`, r: grown ? s.radius + s.ring.gap + s.ring.width / 2 : 0, fill: "none", stroke: s.ring.color, strokeWidth: s.ring.width }));
    return [erase(decorative(ring)), erase(points)];
  });
}

/** Candles and points for one draw, entering with the bars' staggered grow. */
export function buildExtraMarks(input: ExtraLayout): ExtraMark[] {
  const { layout } = input;
  const stagger = layout.data.length > 1 ? (layout.animationDuration * 0.4) / layout.data.length : 0;
  const grow = growMotionOf(layout, stagger, { at: null });
  return [...candleMarks(input, grow), ...scatterMarks(input, grow)];
}

/** Hover dots: the candle's close (its direction's colour) and each scatter's value, on their axes (bklit registers both as tooltip series). */
export function buildExtraDots({ candle, scatters }: Pick<ExtraLayout, "candle" | "scatters">, dots: BarLayoutInput["dots"]): OverlayDot[] {
  if (dots === false) {
    return [];
  }
  const out: OverlayDot[] = [];
  if (candle) {
    const fillOf = (row: Row): string => {
      const c = ohlc(row);
      return c && c.close < c.open ? candle.negativeFill : candle.positiveFill;
    };
    out.push({
      yAxis: candle.yAxisId,
      valueOf: (row) => ohlc(row)?.close,
      glide: true,
      shapes: [{ r: dots.radius, fill: dots.color ?? candle.positiveFill, fillOf: dots.color === undefined ? fillOf : undefined, stroke: "var(--chart-background)", strokeWidth: dots.strokeWidth }],
    });
  }
  for (const s of scatters) {
    out.push({
      yAxis: s.yAxisId,
      valueOf: (row) => numberValue(row[s.dataKey]),
      glide: true,
      shapes: [{ r: dots.radius, fill: dots.color ?? s.fill, stroke: "var(--chart-background)", strokeWidth: dots.strokeWidth }],
    });
  }
  return out;
}
