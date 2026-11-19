import type { ChartDefinition } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { buildCartesianDefinition, SINGLE_TIME_SPAN_MS } from "../cartesian/definition";
import type { UpdateSequence } from "../cartesian/data-update-step";
import type { CartesianSpec } from "../cartesian/input";
import type { PlotSize, PlotSnapshot } from "../cartesian/plot-size";
import type { ResolvedSeries, Row } from "../cartesian/series";
import type { YDomainOverride } from "../cartesian/y-domain-utils";
import { erase } from "../erased-types";
import { memoCell } from "../memo";
import type { ChartMargin } from "../theme";
import { buildBarDots, buildBarMarks, barYValuesByAxis, halfSlotMs, seriesBarWidth } from "./bars";
import type { BarLayoutInput, SeriesBarSpec } from "./bars";
import { buildExtraDots, buildExtraMarks as buildCandleScatterMarks, extraValuesByAxis } from "./extras";
import type { ComposedCandleSpec, ComposedScatterSpec } from "./extras";
import { dateValue, stringValue } from "./narrow";
import { plotFocusOf } from "./plot-focus";
import { orderSeriesMarks } from "./series-order";

const NONE: never[] = [];

export interface ComposedDefinitionInput {
  readonly data: readonly Row[];
  readonly xDataKey: string;
  readonly table: ChildTable;
  readonly series: readonly ResolvedSeries[];
  readonly bars: readonly SeriesBarSpec[];
  /** The Candlestick child (bklit registers one OHLC series) and the Scatter children (extras.ts). */
  readonly candle: ComposedCandleSpec | null;
  readonly scatters: readonly ComposedScatterSpec[];
  /** ComposedChart `yDomains`: per-axis overrides of the resolved domains. */
  readonly yDomains: Readonly<Record<string, YDomainOverride>> | undefined;
  /** ComposedChart `barEdgeInset`: half a slot of x padding each side while bars or candles are drawn. */
  readonly barEdgeInset: boolean;
  readonly order: readonly string[];
  readonly margin: Readonly<ChartMargin>;
  readonly uid: string;
  readonly duration: number;
  readonly aspectRatio: string;
  readonly barSize?: number;
  readonly maxBarSize?: number;
  readonly barGap: number;
  readonly stacked: boolean;
  readonly stackGap: number;
  readonly entered: boolean;
  /** The reveal arm's `performance.now()`, read by the bar mark `motion` during the build that flips `entered` (bar-grow.ts). */
  readonly growing: { readonly current: number | null };
  /** Receives every build TanStack's draw makes (see `buildCartesianDefinition`). */
  readonly onBuilt: (snapshot: PlotSnapshot) => void;
  /** The data update step this build draws (core/cartesian/data-update-step.ts), fed `composedStepDeps`. */
  readonly update: Pick<UpdateSequence, "step" | "from">;
}

/** What resets the data update step: any input but the data. */
export const composedStepDeps = (input: Omit<ComposedDefinitionInput, "growing" | "onBuilt" | "update">): readonly unknown[] => {
  const { xDataKey, table, series, bars, candle, scatters, yDomains, barEdgeInset, order, margin, uid, duration, aspectRatio, barSize, maxBarSize, barGap, stacked, stackGap, entered } = input;
  return [xDataKey, table, series, bars, candle, scatters, yDomains, barEdgeInset, order, margin, uid, duration, aspectRatio, barSize, maxBarSize, barGap, stacked, stackGap, entered];
};

function composedDefinition(input: ComposedDefinitionInput): ChartDefinition<Row, Date, number> {
  const { data, xDataKey, table, series, bars, candle, scatters, order, margin, uid, duration, barSize, maxBarSize, barGap, stacked, stackGap, entered, growing, onBuilt, update } = input;
  // Every axis the bars, candles and points stand on gets their values (an axis only they use still gets a scale); a candle's axis floats.
  const extraYByAxis = barYValuesByAxis(data, bars, stacked);
  for (const [axis, values] of extraValuesByAxis(data, candle, scatters)) {
    extraYByAxis.set(axis, [...(extraYByAxis.get(axis) ?? []), ...values]);
  }
  const floatingAxes = new Set(candle ? [candle.yAxisId] : []);
  const times = data.map((row) => dateValue(row[xDataKey]).getTime());
  const spread = Math.max(...times) - Math.min(...times);
  // Accepted divergence: bklit centres the edge bars on the first and last x of an unpadded time scale, so half of each hangs past the plot (its reveal
  // clip is padded for them, below); in a Card they paint over the YAxis labels and run into the card's padding. With bars, the x domain gets half a
  // slot each side (as the candlestick's does), so every bar sits inside the plot; a chart of lines and areas alone keeps bklit's edge-to-edge x.
  // bklit's `barEdgeInset` (default on) is the same inset; candles take it too, and `barEdgeInset={false}` draws edge to edge.
  const half = input.barEdgeInset && (bars.length > 0 || candle !== null) ? halfSlotMs(times) : 0;
  const padX = half > 0 ? [new Date(Math.min(...times) - half), new Date(Math.max(...times) + half)] : NONE;
  const span = spread > 0 ? spread + 2 * half : SINGLE_TIME_SPAN_MS;
  const tooltipProps = propsFor<{ showDots?: boolean; dotSize?: number; dotStrokeWidth?: number; dotColor?: unknown }>(table, "tooltip").at(0);
  const dots =
    tooltipProps !== undefined && tooltipProps.showDots !== false
      ? { radius: tooltipProps.dotSize ?? 5, strokeWidth: tooltipProps.dotStrokeWidth ?? 2, color: stringValue(tooltipProps.dotColor) }
      : false;
  // bklit's one ChartRevealClip wipes lines, areas and bars together (native `wipe-` groups, kit wipeWrap), padded by half a bar/group
  // (computeSeriesBarRevealClipPadding); a revealSignature change remounts with `entered` false, so the wipe replays with the grow.
  const barPad = (innerWidth: number): number => {
    if (bars.length === 0) {
      return 0;
    }
    const barWidth = seriesBarWidth({ innerWidth, dataLength: data.length, seriesCount: bars.length, barSize, maxBarSize, gap: barGap, stacked });
    return Math.ceil((stacked || bars.length <= 1 ? barWidth : bars.length * barWidth + (bars.length - 1) * barGap) / 2);
  };
  const layoutOf = ({ innerWidth, innerHeight }: PlotSize, yDomains: BarLayoutInput["yDomains"]): BarLayoutInput => ({
    data,
    xKey: xDataKey,
    bars,
    innerWidth,
    innerHeight: Math.max(0, innerHeight),
    xSpanMs: span,
    yDomains,
    barSize,
    maxBarSize,
    barGap,
    stacked,
    stackGap,
    animationDuration: duration,
    entered,
    glide: update.step === "glide",
    growingSince: () => growing.current,
    dots,
  });
  const barMarks = (size: PlotSize, yDomains: BarLayoutInput["yDomains"]) => {
    const layout = layoutOf(size, yDomains);
    return [...buildBarMarks(layout), ...buildCandleScatterMarks({ layout, candle, scatters })];
  };
  const barDots = (size: PlotSize, yDomains: BarLayoutInput["yDomains"]) => [...buildBarDots(layoutOf(size, yDomains)), ...buildExtraDots({ candle, scatters }, dots)];
  // The x domain of the latest draw, for the row focus (written before any focus resolves).
  let xDomain: readonly [Date, Date] | undefined;
  const published = (snapshot: PlotSnapshot): void => {
    xDomain = snapshot.built.domains.x;
    onBuilt(snapshot);
  };
  const spec: CartesianSpec = {
    updateStep: update.step,
    yDomainFrom: update.from,
    data,
    xKey: xDataKey,
    table,
    series,
    margin,
    uid,
    animationDuration: duration,
    wipe: { ms: duration, progress: () => (duration > 0 && !entered ? 0 : 1), pad: ({ innerWidth }) => barPad(innerWidth), armedAt: growing },
    extraMarks: barMarks,
    extraDots: barDots,
    extraXValues: padX,
    extraYValues: NONE,
    extraYByAxis,
    floatingAxes,
    yDomainOverrides: input.yDomains,
    extraGradients: NONE,
    renderTooltipEnabled: true,
    orderMarks: (marks) => erase(orderSeriesMarks(erase(marks), order)),
    focusOf: (size) => plotFocusOf(margin, size, () => xDomain),
  };
  return buildCartesianDefinition(spec, published);
}

/** The definition builder of one chart: call it with every pass's input; it builds again only when an input changes (as React's `useMemo` did). */
export function createComposedDefinition(): (input: ComposedDefinitionInput) => ChartDefinition<Row, Date, number> {
  const cell = memoCell<ChartDefinition<Row, Date, number>>();
  return (input) => {
    const { data, xDataKey, table, series, bars, candle, scatters, yDomains, barEdgeInset, order, margin, uid, duration, aspectRatio, barSize, maxBarSize, barGap, stacked, stackGap, entered, update, growing, onBuilt } = input;
    return cell(
      [data, xDataKey, table, series, bars, candle, scatters, yDomains, barEdgeInset, order, margin, uid, duration, aspectRatio, barSize, maxBarSize, barGap, stacked, stackGap, entered, update.step, update.from, growing, onBuilt],
      () => composedDefinition(input),
    );
  };
}
