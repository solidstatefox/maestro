import { labelsThatFit } from "../axis-fit";
import { scaleUtc } from "../scales";
import { shortDateFmt } from "../format";
import { X_TICK_PADDING } from "../theme";
import { strictRows } from "./domains";
import type { CartesianInput } from "./input";
import { toDate } from "./series";
import type { Row } from "./series";
import { withPillGeometry } from "./date-pill";
import type { PillTicks } from "./date-pill";
import { selectEvenlySpacedIndices } from "./tick-layout";
import type { ResponsiveChartLabelCount } from "../types/cartesian";

export interface XAxisProps {
  numTicks?: number | ResponsiveChartLabelCount;
  tickMode?: "domain" | "data";
  tickerHalfWidth?: number;
  formatValue?: (value: Date) => string;
  labels?: readonly string[];
}

/** bklit `resolveResponsiveChartLabelCount`: a count, or the one of the widest breakpoint the chart reaches (by its full width). */
export function resolveLabelCount(value: number | ResponsiveChartLabelCount | undefined, chartWidth: number, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "number") {
    return value;
  }
  const candidates = [
    [1280, value.xl],
    [1024, value.lg],
    [768, value.md],
    [640, value.sm],
    [0, value.base],
  ] as const;
  return candidates.find(([minWidth, count]) => chartWidth >= minWidth && count !== undefined)?.[1] ?? fallback;
}

/** `XAxis` `labels`: the tick text of a data row, by its time; else the date format. */
export function xLabelFormat(input: Pick<CartesianInput, "data" | "xKey">, xAxis: XAxisProps | undefined): (d: Date) => string {
  const format = xAxis?.formatValue ?? ((d: Date): string => shortDateFmt.format(d));
  const labels = xAxis?.labels;
  if (!labels) {
    return format;
  }
  const byTime = new Map<number, string>();
  input.data.forEach((row, i) => {
    const label = labels[i];
    if (label !== undefined) {
      byTime.set(toDate(row[input.xKey]).getTime(), label);
    }
  });
  return (d) => byTime.get(d.getTime()) ?? format(d);
}

/** Evenly spaced data-row indices, first and last included (bklit `tickMode="data"`). */
export function dataTickValues(rows: readonly Row[], xKey: string, count: number, brushed?: readonly [Date, Date], labelOf: (d: Date) => string = (d) => shortDateFmt.format(d)): Date[] {
  if (rows.length === 0) {
    return [];
  }
  // bklit buildDataAlignedTicks: the even-spacing search over the rows (the brushed window's rows when brushed).
  const times = rows.map((row) => toDate(row[xKey]).getTime());
  const labels = times.map((t) => labelOf(new Date(t)));
  const picked = selectEvenlySpacedIndices(rows.length, count, labels, (i) => times[i] ?? 0);
  const seen = new Set<string>();
  const out: Date[] = [];
  for (const index of picked) {
    const label = labels[index];
    if (!seen.has(label)) {
      seen.add(label);
      out.push(new Date(times[index]));
    }
  }
  if (brushed) {
    // bklit appendProjectionTailTicks: a window ending past its last row gets labels in that tail (mid-points, then the end).
    const lastTime = times.at(-1);
    const endTime = Math.max(brushed[0].getTime(), brushed[1].getTime());
    if (lastTime !== undefined && endTime > lastTime) {
      const extraCount = Math.min(Math.max(1, count - out.length + 1), 3);
      for (let i = 1; i <= extraCount; i += 1) {
        const date = new Date(lastTime + (i / (extraCount + 1)) * (endTime - lastTime));
        const label = shortDateFmt.format(date);
        if (!seen.has(label)) {
          seen.add(label);
          out.push(date);
        }
      }
      const endLabel = shortDateFmt.format(new Date(endTime));
      if (!seen.has(endLabel)) {
        out.push(new Date(endTime));
      }
    }
  }
  return out;
}

type XTicks = { values: Date[]; count?: undefined } | { count: number; values?: undefined };

function evenDomainTicks(domain: readonly [Date, Date], tickCount: number): Date[] {
  const [d0, d1] = domain;
  const steps = Math.max(1, tickCount - 1);
  return Array.from({ length: tickCount }, (_unused, i) => new Date(d0.getTime() + ((d1.getTime() - d0.getTime()) * i) / steps));
}

interface XScaleInput {
  readonly input: CartesianInput;
  readonly rows: readonly Row[];
  readonly xAxis: XAxisProps | undefined;
  /** The resolved x domain (the brushed window, else the data and overlay extent). */
  readonly xDomain: [Date, Date] | undefined;
  /** An overlay (projection, ...) widens the domain past the data: bklit then spaces ticks evenly over the domain. */
  readonly overlaysWidenX: boolean;
  /** The date pill hides the tick labels it would cover, so the tick times are needed. */
  readonly pillActive: boolean;
}

function xTickSpec(args: XScaleInput, tickCount: number, labelOf: (d: Date) => string): XTicks {
  const { input, rows, xAxis, xDomain } = args;
  if (args.overlaysWidenX && xDomain) {
    return { values: evenDomainTicks(xDomain, tickCount) };
  }
  if (xAxis?.tickMode === "domain") {
    return { count: tickCount };
  }
  return { values: dataTickValues(input.xDomain ? strictRows(rows, input.xKey, input.xDomain) : rows, input.xKey, tickCount, input.xDomain, labelOf) };
}

// Accepted divergence: bklit spaces its x ticks by count alone, so a phone ran eight dates together ("Oct 13Oct 18Oct 22"). The count is
// capped by the labels that fit the plot (core/axis-fit.ts), as the bar chart's category labels are; a wide chart keeps bklit's ticks.
/** The x ticks for `count` labels, or fewer when their labels would run together across the plot. */
function fittingXTicks(args: XScaleInput, count: number, labelOf: (d: Date) => string): XTicks {
  const plotWidth = args.input.plotWidth ?? 0;
  const labelsOf = (ticks: XTicks): string[] => (ticks.values ?? (args.xDomain ? scaleUtc().domain(args.xDomain).ticks(ticks.count) : [])).map(labelOf);
  let ticks = xTickSpec(args, count, labelOf);
  for (let fewer = count - 1; plotWidth > 0 && fewer >= 2; fewer -= 1) {
    const labels = labelsOf(ticks);
    if (labels.length <= labelsThatFit(labels, plotWidth)) {
      break;
    }
    ticks = xTickSpec(args, fewer, labelOf);
  }
  return ticks;
}

function tickTimesOf(ticks: XTicks, xDomain: [Date, Date] | undefined): number[] {
  if (ticks.values) {
    return ticks.values.map((d) => d.getTime());
  }
  return xDomain ? scaleUtc().domain(xDomain).ticks(ticks.count ?? 5).map((d) => d.getTime()) : [];
}

interface XScale {
  readonly scale: Record<string, unknown>;
  readonly tickTimes: PillTicks;
}

/** The `scales.x` option and the tick times (ms) the pill's blanking CSS reads (empty unless the pill is active). */
export function buildXScale(args: XScaleInput): XScale {
  const { input, xAxis, xDomain } = args;
  const formatX = xLabelFormat(input, xAxis);
  const xTicks = fittingXTicks(args, resolveLabelCount(xAxis?.numTicks, (input.plotWidth ?? 0) + input.margin.left + input.margin.right, 5), formatX);
  // bklit's labels hang a fixed 12px above the host's bottom edge whatever the plot is; the renderer floors the plot at 1px,
  // so a host shorter than its margins would push them below it. Pull them back by the lost height.
  const xLabelLift = Math.min(0, (input.plotHeight ?? 1) - 1);
  const times = args.pillActive ? tickTimesOf(xTicks, xDomain) : [];
  // x layout for the pill's tick-opacity ramp (date-pill.ts pillTickStaticCss reads it off the array).
  const tickTimes: PillTicks = args.pillActive && xDomain ? withPillGeometry(times, { plotLeft: input.margin.left, domainStart: xDomain[0].getTime() }) : times;
  const scale = {
    scale: scaleUtc().domain(xDomain ?? [new Date(0), new Date(1)]),
    grid: false,
    axis: xAxis === undefined
      ? false
      : { line: false, ticks: { ...xTicks, size: 0, padding: X_TICK_PADDING, format: formatX }, tickLabels: { fontSize: 12, opacity: 1, thin: false, ...(xLabelLift < 0 ? { dy: xLabelLift } : null), ...(input.xDomain ? { motion: false } : null) } },
  };
  return { scale, tickTimes };
}
