import { intFmt } from "../format";
import type { TooltipRow } from "../types/tooltip";
import { FEATURES_ID, MARKERS_ID } from "./projection";
import type { ChoroplethFeature, ChoroplethMarkerTooltipData, ChoroplethTooltipProps } from "../types/choropleth";

/** A `ChoroplethTooltip`'s props with the value row's format and label defaulted. */
export interface TooltipCardConfig<Node, Style> {
  readonly props: Readonly<ChoroplethTooltipProps<Node, Style>>;
  readonly formatValue: (value: number) => string;
  readonly valueLabel: string;
  /** How long a feature the pointer left for nothing keeps its tooltip (ms). */
  readonly hideDelay: number;
}

/** bklit's TOOLTIP_HIDE_DELAY_MS (tooltip/use-delayed-tooltip-data.ts). */
const DEFAULT_HIDE_DELAY_MS = 120;

export const tooltipCardConfig = <Node, Style>(props: ChoroplethTooltipProps<Node, Style>): TooltipCardConfig<Node, Style> => ({
  formatValue: props.formatValue ?? intFmt,
  hideDelay: Math.max(0, props.hideDelay ?? DEFAULT_HIDE_DELAY_MS),
  props,
  valueLabel: props.valueLabel ?? "Value",
});

interface TooltipPoint {
  readonly markId: string;
  readonly datum: ChoroplethFeature;
  readonly datumIndex: number;
}

/** The feature a tooltip's points show: the first point's, when it is a feature (else the native default body shows). */
export const tooltipFeatureOf = (points: readonly TooltipPoint[]): { readonly feature: ChoroplethFeature; readonly index: number } | undefined => {
  const first = points.at(0);
  return first === undefined || first.markId !== FEATURES_ID ? undefined : { feature: first.datum, index: first.datumIndex };
};

/** The default body's title: `getFeatureName`, else the feature's name, else "Feature <index>". */
export const featureTitle = <Node, Style>({ getFeatureName }: ChoroplethTooltipProps<Node, Style>, feature: ChoroplethFeature, index: number): string =>
  getFeatureName ? getFeatureName(feature, index) : (feature.properties?.name ?? `Feature ${index}`);

/** The default body's value row; none when the feature has no value. */
export const featureValueRows = (value: number | undefined, valueLabel: string, formatValue: (value: number) => string): TooltipRow[] =>
  value === undefined ? [] : [{ color: "var(--chart-1)", label: valueLabel, value: formatValue(value) }];

/** The marker a tooltip's points show (a point of the hidden markers mark), else undefined. */
export const tooltipMarkerOf = (points: readonly TooltipPoint[]): ChoroplethMarkerTooltipData | undefined => {
  const first = points.at(0);
  // SAFETY: the markers mark's datum carries its marker's tooltip data (definition.ts `markerFeature`).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  return first?.markId === MARKERS_ID ? (first.datum.properties as unknown as { readonly marker: ChoroplethMarkerTooltipData }).marker : undefined;
};

/** A marker's tooltip row: its latitude and longitude (bklit's choropleth-tooltip.tsx:83-95). */
export const markerRows = ({ coordinates: [lon, lat] }: ChoroplethMarkerTooltipData): TooltipRow[] => [
  { color: "var(--chart-foreground-muted)", label: "Location", value: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°` },
];
