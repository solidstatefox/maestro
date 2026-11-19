import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { BandConfig, BandProps } from "../types/range-overlays";
import { axisId } from "./series";

/** `Band`'s default color (its `fill` default). */
export const DEFAULT_BAND_FILL = "var(--chart-line-primary)";

/** bklit's default tooltip label: the key of a one-key band, else `lower – upper`. */
export const defaultBandLabel = (upperKey: string, lowerKey: string): string => (upperKey === lowerKey ? upperKey : `${lowerKey} – ${upperKey}`);

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** The config of one Band's props; null when either key is missing (bklit `bandConfigFromProps`). */
export function bandConfigOf(props: Partial<BandProps> | undefined): BandConfig | null {
  if (!(nonEmpty(props?.upperKey) && nonEmpty(props.lowerKey))) {
    return null;
  }
  return {
    yAxisId: axisId(props.yAxisId),
    upperKey: props.upperKey,
    lowerKey: props.lowerKey,
    color: nonEmpty(props.fill) ? props.fill : DEFAULT_BAND_FILL,
    label: nonEmpty(props.label) ? props.label : defaultBandLabel(props.upperKey, props.lowerKey),
    showInTooltip: props.showInTooltip !== false,
  };
}

const isTable = (source: ChildTable | Iterable<Partial<BandProps>>): source is ChildTable => source instanceof Map;

/** The configs of a list of Band props, or of a chart's carrier table. */
export function bandConfigsOf(source: ChildTable | Iterable<Partial<BandProps>>): BandConfig[] {
  const list: Iterable<Partial<BandProps>> = isTable(source) ? propsFor<BandProps>(source, "band") : source;
  const out: BandConfig[] = [];
  for (const props of list) {
    const config = bandConfigOf(props);
    if (config) {
      out.push(config);
    }
  }
  return out;
}

/** Band edge keys grouped by y axis id (deduplicated, in insertion order). */
export function bandKeysByAxis(configs: readonly Pick<BandConfig, "yAxisId" | "upperKey" | "lowerKey">[]): Record<string, string[]> {
  const byAxis: Record<string, string[]> = {};
  for (const config of configs) {
    const keys = byAxis[config.yAxisId] ?? [];
    for (const key of [config.upperKey, config.lowerKey]) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
    byAxis[config.yAxisId] = keys;
  }
  return byAxis;
}

/** The tooltip group key of the i-th band's focus line (its rows are keyed by group, core/tooltip/series-labels.ts `tooltipRowValue`). */
export const bandGroupKey = (index: number): string => `band:${index}`;
