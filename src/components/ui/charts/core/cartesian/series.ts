import type { CurveFactory } from "d3-shape";
import { curveLinear, curveMonotoneX, curveNatural } from "d3-shape";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DEFAULT_LINE_STROKE } from "../theme";
import type { LineLoadingPulseMode, LoadingStyle } from "../motion/phase";
import type { LineGlow, LineHighlight, SeriesMarkersProps, SeriesPointMarkerStyle } from "../types/cartesian";
import type { FadeEdges, StrokeGradient } from "./stroke-paint";
import type { ChartMarkRenderer } from "../canvas/renderer";

type MarkerStyleInput = Readonly<SeriesPointMarkerStyle>;

export type Row = Record<string, unknown>;

/** A row's x value as a Date: the chart data contract is a Date, an ISO string or epoch milliseconds (bklit `new Date(row[xKey])`). */
export function toDate(value: unknown): Date {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- Date | string | number is the documented x contract
  return value instanceof Date ? value : new Date(value as string | number);
}

/** bklit SeriesPointMarkerStyle with SeriesMarkers' defaults (series-markers.tsx:55-72); `fill` / `stroke` default to the series stroke. */
interface ResolvedMarker {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly ringGap: number;
  readonly outlineWidth: number;
  readonly outlineColor: string;
  readonly radius: number;
  readonly fadeOnHover: boolean;
  readonly inactiveOpacity: number;
  readonly inactiveBlur: number;
  readonly enterBlur: number;
  readonly showActiveHighlight: boolean;
  readonly animate: boolean;
}

function resolveMarker(style: MarkerStyleInput | undefined, seriesStroke: string, animate = true): ResolvedMarker {
  const fill = style?.fill ?? seriesStroke;
  const stroke = style?.stroke ?? fill;
  return {
    fill,
    stroke,
    strokeWidth: style?.strokeWidth ?? 2,
    ringGap: style?.ringGap ?? 2,
    outlineWidth: style?.outlineWidth ?? 0,
    outlineColor: style?.outlineColor ?? stroke,
    radius: style?.radius ?? 5,
    fadeOnHover: style?.fadeOnHover ?? true,
    inactiveOpacity: style?.inactiveOpacity ?? 0.5,
    inactiveBlur: style?.inactiveBlur ?? 2,
    enterBlur: style?.enterBlur ?? 2,
    showActiveHighlight: style?.showActiveHighlight ?? true,
    animate,
  };
}

/** bklit line.tsx resolveLineGlow: blur 6, opacity 0.7, twice the stroke's width. */
export interface ResolvedGlow {
  readonly blur: number;
  readonly opacity: number;
  readonly strokeWidth: number;
}

export function resolveGlow(glow: boolean | Readonly<LineGlow> | undefined, strokeWidth: number): ResolvedGlow | undefined {
  if (!glow) {
    return undefined;
  }
  const options = glow === true ? {} : glow;
  return { blur: Math.max(0, options.blur ?? 6), opacity: options.opacity ?? 0.7, strokeWidth: options.strokeWidth ?? strokeWidth * 2 };
}

/** The hover highlight's look (bklit line.tsx useLineHighlightPaint): a colour override or the line's ramp without its fade. */
export interface ResolvedHighlight {
  /** An own colour (`highlight.stroke` with no ramp of its own). */
  readonly stroke: string | undefined;
  /** The ramp the segment paints: its own `strokeGradient`, else the line's unless `highlight.stroke` overrides it. */
  readonly gradient: StrokeGradient | undefined;
  readonly strokeWidth: number;
  /** Rows either side of the hovered one (>= 1). */
  readonly span: number;
  /** Soft ends, % of the segment width per side (0-50). */
  readonly fadeLength: number;
  readonly glow: ResolvedGlow | undefined;
}

function resolveHighlight(highlight: Readonly<LineHighlight> | undefined, lineGradient: StrokeGradient | undefined, strokeWidth: number): ResolvedHighlight {
  const width = highlight?.strokeWidth ?? strokeWidth;
  const own = highlight?.strokeGradient !== undefined && highlight.strokeGradient.length > 0 ? highlight.strokeGradient : undefined;
  return {
    stroke: highlight?.stroke,
    gradient: own ?? (highlight?.stroke === undefined ? lineGradient : undefined),
    strokeWidth: width,
    span: Math.max(1, Math.round(highlight?.span ?? 1)),
    fadeLength: Math.min(50, Math.max(0, highlight?.fadeLength ?? 0)),
    glow: resolveGlow(highlight?.glow, width),
  };
}

interface SeriesBase {
  readonly kind: "line" | "area" | "pattern";
  /** Mark id, also the lookup key for tooltip rows (`markId.split(":")[0]`). */
  readonly id: string;
  readonly dataKey: string;
  /** The carrier's `label` (tooltip row name, `seriesLabel` in tooltip-body.tsx); undefined shows the dataKey. */
  readonly label?: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly curve: CurveFactory;
  readonly yAxisId: string;
  readonly fadeEdges: FadeEdges;
  readonly dashFromIndex: number | undefined;
  readonly dashArray: string;
  readonly showMarkers: boolean;
  readonly marker: ResolvedMarker;
  readonly showHighlight: boolean;
  /** Opacity the line (and fill) dims to while the chart is hovered: bklit's 0.3 for a line, 0.6 for an area, or `highlight.dimOpacity`. */
  readonly dimOpacity: number;
  /** The line's colour ramp (`strokeGradient`). */
  readonly strokeGradient?: StrokeGradient;
  /** The line's glow (`glow`). */
  readonly glow?: ResolvedGlow;
  /** The hover highlight's styling (`highlight`). */
  readonly highlight?: ResolvedHighlight;
  readonly index: number;
  /** Loading pulse overlay (bklit `loading` / `loadingPulseMode`); absent when the series does not pulse. */
  readonly loading: SeriesLoading | undefined;
  /** ProfitLossLine: one path, two colours split at zero. */
  readonly profitLoss?: { readonly positive: string; readonly negative: string };
  /** Where the line (and an area's fill) draws (`renderer`): SVG paths, or the chart's canvas layer (`canvasRenderer`, core/canvas/mark-renderer.ts). */
  readonly renderer: ChartMarkRenderer;
}

interface SeriesLoading {
  readonly mode: LineLoadingPulseMode;
  readonly style: LoadingStyle;
  readonly stroke: string;
  readonly strokeOpacity: number;
}

export interface AreaSeries extends SeriesBase {
  readonly fill: string;
  readonly fillOpacity: number;
  readonly gradientToOpacity: number;
  /** bklit `gradientSpan` (0-1): where the gradient reaches `gradientToOpacity`. */
  readonly gradientSpan?: number;
  /** bklit `fadeBottom` (0-100): the fill fades out over the bottom N% of the area; replaces `gradientToOpacity` / `gradientSpan`. */
  readonly fadeBottom?: number;
  readonly showLine: boolean;
  readonly pattern?: { readonly preset: string; readonly color: string };
  /** `showValue` labels (value-labels.ts). */
  readonly valueLabels?: ValueLabelSpec;
}

/** An Area's value labels (bklit area-value-labels.tsx): the props that place and paint them. */
export interface ValueLabelSpec {
  readonly minCount: number;
  readonly maxCount: number | undefined;
  readonly format: ((value: number) => string) | undefined;
  readonly color: string;
  readonly fade: boolean;
}

export type ResolvedSeries = SeriesBase & Partial<Omit<AreaSeries, keyof SeriesBase>>;

interface LineProps {
  dataKey: string;
  label?: string;
  stroke?: string;
  strokeWidth?: number;
  curve?: CurveFactory;
  yAxisId?: string | number;
  fadeEdges?: FadeEdges;
  strokeGradient?: StrokeGradient;
  glow?: boolean | Readonly<LineGlow>;
  highlight?: Readonly<LineHighlight>;
  showHighlight?: boolean;
  showMarkers?: boolean;
  markers?: MarkerStyleInput;
  animate?: boolean;
  dashFromIndex?: number;
  dashArray?: string;
  loading?: boolean;
  loadingStroke?: string;
  loadingStrokeOpacity?: number;
  loadingPulseMode?: LineLoadingPulseMode;
  loadingStyle?: LoadingStyle;
  renderer?: ChartMarkRenderer;
}

interface ProfitLossProps {
  dataKey: string;
  label?: string;
  strokeWidth?: number;
  positiveColor?: string;
  negativeColor?: string;
  curve?: CurveFactory;
  fadeEdges?: FadeEdges;
}

interface AreaProps extends LineProps {
  fill?: string;
  fillOpacity?: number;
  showLine?: boolean;
  gradientToOpacity?: number;
  gradientSpan?: number;
  fadeBottom?: number;
  showValue?: boolean;
  valueLabelMinCount?: number;
  valueLabelMaxCount?: number;
  valueLabelFormatter?: (value: number) => string;
  valueLabelColor?: string;
  fadeValueLabels?: boolean;
}

interface PatternProps {
  dataKey: string;
  label?: string;
  patternPreset?: string;
  patternColor?: string;
  fill?: string;
  curve?: CurveFactory;
  fillOpacity?: number;
  fadeBottom?: number;
  fadeEdges?: FadeEdges;
}

/** @internal */
export const DEFAULT_Y_AXIS_ID = "left";

// bklit line.tsx / area.tsx: `loading === false` disables, an explicit mode or `loading` enables (mode defaults to "loop"),
// and an unset `loading` follows the chart's loading phase (line.tsx:259-264).
const loadingOf = (props: LineProps, chartLoading: boolean): SeriesLoading | undefined => {
  if (props.loading === false || (props.loading !== true && props.loadingPulseMode === undefined && !chartLoading)) {
    return undefined;
  }
  return {
    mode: props.loadingPulseMode ?? "loop",
    style: props.loadingStyle ?? "pulse",
    stroke: props.loadingStroke ?? "var(--chart-foreground)",
    strokeOpacity: props.loadingStrokeOpacity ?? 0.5,
  };
};

export const axisId = (value: string | number | undefined): string =>
  value === undefined ? DEFAULT_Y_AXIS_ID : String(value);

/** `chartLoading` is the chart's `status="loading"`: series follow bklit's loading phase (pulse overlay only; base stroke, fill, highlight and markers hidden, line.tsx:309-311). */
export function resolveSeries(table: ChildTable, chartLoading = false): ResolvedSeries[] {
  const out: ResolvedSeries[] = [];
  // Legend / hover indices count within each role (bklit extracts lines and areas separately).
  const counts = { line: 0, area: 0, pattern: 0 };
  const base = (
    kind: SeriesBase["kind"],
    props: LineProps & { fill?: string; curve?: CurveFactory },
    fallbackCurve: CurveFactory,
  ): SeriesBase => {
    const stroke = chartLoading ? "transparent" : (props.stroke ?? props.fill ?? DEFAULT_LINE_STROKE);
    const index = counts[kind];
    counts[kind] = index + 1;
    const strokeWidth = props.strokeWidth ?? (kind === "line" ? 2.5 : 2);
    // bklit's Line takes the ramp, glow and highlight styling; the Area only its fade (area.tsx has none of them).
    const styled = kind === "line" && !chartLoading;
    const strokeGradient = styled && props.strokeGradient !== undefined && props.strokeGradient.length > 0 ? props.strokeGradient : undefined;
    return {
      kind,
      id: `${kind}:${props.dataKey}`,
      dataKey: props.dataKey,
      label: props.label,
      stroke,
      strokeWidth,
      curve: props.curve ?? fallbackCurve,
      yAxisId: axisId(props.yAxisId),
      fadeEdges: props.fadeEdges ?? (kind === "line"),
      dashFromIndex: props.dashFromIndex,
      dashArray: props.dashArray ?? "6,4",
      showMarkers: !chartLoading && (props.showMarkers ?? false),
      marker: resolveMarker(props.markers, stroke, props.animate),
      showHighlight: !chartLoading && (props.showHighlight ?? true),
      dimOpacity: kind === "line" ? (props.highlight?.dimOpacity ?? 0.3) : 0.6,
      ...(strokeGradient === undefined ? undefined : { strokeGradient }),
      ...(styled && props.glow ? { glow: resolveGlow(props.glow, strokeWidth) } : undefined),
      ...(styled ? { highlight: resolveHighlight(props.highlight, strokeGradient, strokeWidth) } : undefined),
      index,
      loading: loadingOf(props, chartLoading),
      renderer: props.renderer ?? "svg",
    };
  };
  // Children render in document order: bklit paints patterns, then areas, then lines.
  for (const p of propsFor<PatternProps>(table, "patternArea")) {
    const preset = p.patternPreset ?? "diagonal";
    // bklit's "accent" preset is the diagonal hatch drawn in --chart-1 whatever the colour (pattern-preset-render.tsx renderLinePatternPreset); styles.css masks it as the diagonal.
    const color = preset === "accent" ? "var(--chart-1)" : (p.patternColor ?? p.fill ?? DEFAULT_LINE_STROKE);
    out.push({
      ...base("pattern", { dataKey: p.dataKey, label: p.label, stroke: p.patternColor ?? p.fill, curve: p.curve, fadeEdges: p.fadeEdges ?? false }, curveMonotoneX),
      id: `pattern-${preset}:${p.dataKey}`,
      fill: p.fill ?? p.patternColor ?? DEFAULT_LINE_STROKE,
      fillOpacity: p.fillOpacity ?? 1,
      gradientToOpacity: p.fillOpacity ?? 1,
      fadeBottom: p.fadeBottom,
      showLine: false,
      pattern: { preset, color },
    });
  }
  for (const a of propsFor<AreaProps>(table, "area")) {
    const stroke = a.stroke ?? a.fill ?? DEFAULT_LINE_STROKE;
    out.push({
      ...base("area", a, curveMonotoneX),
      fill: chartLoading ? "transparent" : (a.fill ?? stroke),
      fillOpacity: chartLoading ? 0 : (a.fillOpacity ?? 0.4),
      gradientToOpacity: a.gradientToOpacity ?? 0,
      gradientSpan: a.gradientSpan,
      fadeBottom: a.fadeBottom,
      showLine: a.showLine ?? true,
      valueLabels: a.showValue === true && !chartLoading
        ? { minCount: a.valueLabelMinCount ?? 2, maxCount: a.valueLabelMaxCount, format: a.valueLabelFormatter, color: a.valueLabelColor ?? stroke, fade: a.fadeValueLabels === true }
        : undefined,
    });
  }
  for (const l of propsFor<LineProps>(table, "line")) {
    out.push(base("line", l, curveNatural));
  }
  for (const p of propsFor<ProfitLossProps>(table, "profitLossLine")) {
    const positive = p.positiveColor ?? "var(--chart-positive)";
    const negative = p.negativeColor ?? "var(--chart-negative)";
    out.push({
      ...base("line", { dataKey: p.dataKey, label: p.label, stroke: positive, strokeWidth: p.strokeWidth, curve: p.curve, fadeEdges: false, showHighlight: false }, curveLinear),
      profitLoss: { positive, negative },
    });
  }
  // bklit SeriesMarkers as a child: the same point markers as `showMarkers` + `markers` on the series with that dataKey.
  for (const m of propsFor<SeriesMarkersProps>(table, "seriesMarkers")) {
    const at = out.findIndex((s) => s.dataKey === m.dataKey && s.kind !== "pattern");
    const target = at === -1 ? undefined : out[at];
    if (target) {
      out[at] = { ...target, showMarkers: true, marker: resolveMarker(m, target.stroke, m.animate) };
    }
  }
  return out;
}

/** The series config the chart context publishes (`useChart().lines`) and `ChartTooltip`'s function `dotColor` receives. */
export const lineConfigOf = ({ dataKey, label, stroke, strokeWidth, yAxisId }: ResolvedSeries): { dataKey: string; label?: string; stroke: string; strokeWidth: number; yAxisId: string } =>
  label === undefined ? { dataKey, stroke, strokeWidth, yAxisId } : { dataKey, label, stroke, strokeWidth, yAxisId };
