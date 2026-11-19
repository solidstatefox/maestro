export interface RadarMetric {
  /** Unique key of the metric. Series look up their value in `values` under this key. */
  key: string;
  /** Text printed for the metric by `RadarLabels`. */
  label: string;
}

/** One series (polygon) of a radar chart. */
export interface RadarData {
  /** Name of the series. */
  label: string;
  /** Colour of the series, any CSS colour or `var(--...)` reference. Defaults to the `--chart-1` to `--chart-5` palette by series index. */
  color?: string;
  /** Value of the series for each metric, keyed by `RadarMetric.key`. Values run from 0 to 100 and are clamped to that range; a missing key counts as 0. */
  values: Record<string, number>;
}

export interface RadarRow {
  readonly metric: string;
  /** Data index of the series; -1 for chrome (rings, labels). */
  readonly series: number;
  readonly value: number;
  readonly label: string;
  /** Degrees clockwise from 12 o'clock; only set for grid ring vertices. */
  readonly angle?: number;
}

export const RADAR_VALUE_MAX = 100;

export const seriesRows = (datum: RadarData, index: number, metrics: readonly RadarMetric[]): RadarRow[] =>
  metrics.map((metric) => ({
    label: metric.label,
    metric: metric.key,
    series: index,
    value: Math.max(0, Math.min(RADAR_VALUE_MAX, datum.values[metric.key] ?? 0)),
  }));

/** One closed ring per level: a constant radius at every metric angle. */
export const ringRows = (level: number, levels: number, metrics: readonly RadarMetric[]): RadarRow[] =>
  metrics.map((metric, i) => ({
    // bklit: vertex i sits at -(i * step + step / 2) degrees.
    angle: 360 - ((i * 360) / metrics.length + 180 / metrics.length),
    label: metric.label,
    metric: metric.key,
    series: -1,
    value: ((level + 1) * RADAR_VALUE_MAX) / levels,
  }));

export const metricRows = (metrics: readonly RadarMetric[], value: number): RadarRow[] =>
  metrics.map((metric) => ({ label: metric.label, metric: metric.key, series: -1, value }));
