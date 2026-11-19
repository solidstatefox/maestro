import type { ReactNode } from "react";
import { intFmt, weekdayDateFmt } from "../../core/format";
import { MarkerTooltipContent, TooltipContent } from "./tooltip-primitives";
import type { MarkerTooltipItem } from "./tooltip-primitives";
import type { TooltipRow } from "../../core/types/tooltip";
export type { TooltipRow } from "../../core/types/tooltip";
import type { AnyPoint as Point } from "../../core/erased-types";
import type { TooltipRowColor } from "../../core/tooltip/series-labels";
import { rangeRowValue } from "../../core/tooltip/range-rows";
import type { TooltipRange } from "../../core/tooltip/range-rows";
export { seriesLabels } from "../../core/tooltip/series-labels";


type Datum = Record<string, unknown>;

/** An event marker as the default panel lists it: `MarkerTooltipContent`'s item plus the date it sits on. */
export interface TooltipMarker extends MarkerTooltipItem {
  readonly date: Date;
}

export interface TooltipBodyOptions {
  readonly title?: (date: Date) => string;
  /** Formats a row value; `label` is the series key (its dataKey), whatever `labels` names the row. */
  readonly format?: (value: number, label: string) => string | number;
  readonly rows?: (rows: readonly TooltipRow[], point: Point) => readonly TooltipRow[];
  readonly content?: (args: { point: Point; rows: readonly TooltipRow[]; pinned?: boolean; dismiss?: () => void }) => ReactNode;
  readonly className?: string;
  /** bklit `<ChartTooltip>` children: extra content below the rows. */
  readonly footer?: ReactNode;
  /** Series keys (dataKeys) in declaration order; rows follow it. */
  readonly order?: readonly string[];
  /** Series dataKey -> row dot colour. */
  readonly colors?: Readonly<Partial<Record<string, TooltipRowColor>>>;
  /** Series dataKey -> row label (`seriesLabel`); a key with none shows the dataKey. */
  readonly labels?: Readonly<Partial<Record<string, string>>>;
  /** Band rows: their group key -> edge keys (the row shows the band's range, core/tooltip/range-rows.ts). */
  readonly ranges?: Readonly<Partial<Record<string, TooltipRange>>>;
  /** The chart's ChartMarkers items: without a `footer`, the panel lists the ones on the hovered date. */
  readonly markers?: readonly TooltipMarker[];
}

/** A series' name in its tooltip row: its `label`, else its `dataKey`. Every family's default rows name a series with it. */
export const seriesLabel = (series: { readonly dataKey: string; readonly label?: string }): string => series.label ?? series.dataKey;

/** One row per series: the native `group-x` focus already yields one point per `z` group (the series' dataKey).
 * `labels` names the rows and `order` (dataKeys) sorts them; both are keyed by the group, not the shown label. */
export const tooltipRows = (
  points: readonly Point[],
  format: TooltipBodyOptions["format"],
  colors?: TooltipBodyOptions["colors"],
  labels?: TooltipBodyOptions["labels"],
  order?: TooltipBodyOptions["order"],
  ranges?: TooltipBodyOptions["ranges"],
): TooltipRow[] => {
  const seen = new Set<string>();
  const rows: { readonly key: string; readonly row: TooltipRow }[] = [];
  for (const p of points) {
    const key = String(p.group ?? p.groupLabel);
    if (!seen.has(key)) {
      seen.add(key);
      const raw = Number(p.yValue);
      const color = colors?.[key];
      rows.push({
        key,
        row: { color: typeof color === "function" ? color(raw) : (color ?? p.color), label: labels?.[key] ?? key, value: rangeRowValue(ranges?.[key], p.datum, format, key) ?? (format === undefined ? intFmt(raw) : format(raw, key)) },
      });
    }
  }
  const sorted = order === undefined ? rows : rows.toSorted((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return sorted.map((r) => r.row);
};

/** The markers on `date`'s calendar day, as `useActiveMarkers` matches them. */
const markersOn = (markers: readonly TooltipMarker[] | undefined, date: Date): readonly TooltipMarker[] => {
  if (markers === undefined) {
    return [];
  }
  const day = date.toDateString();
  return markers.filter((m) => m.date.toDateString() === day);
};

const NO_DISMISS = (): void => undefined;

/** The body of the native tooltip; `pinned` / `dismiss` are the native body context's (ChartTooltip `pinnable`). */
export const BklitTooltipBody = ({ points, options, pinned = false, dismiss = NO_DISMISS }: { readonly points: readonly Point[]; readonly options: TooltipBodyOptions; readonly pinned?: boolean; readonly dismiss?: () => void }): ReactNode => {
  if (points.length === 0) {
    return null;
  }
  const [primary] = points;
  const date = primary.xValue instanceof Date ? primary.xValue : new Date(primary.xValue);
  const sorted = tooltipRows(points, options.format, options.colors, options.labels, options.order, options.ranges);
  const rows = options.rows === undefined ? sorted : options.rows(sorted, primary);
  if (options.content !== undefined) {
    return options.content({ point: primary, rows, pinned, dismiss });
  }
  // Accepted divergence: bklit shows ChartMarkers' titles only when the author renders `useActiveMarkers` + `MarkerTooltipContent` as ChartTooltip children
  // (docs markers.md "Marker details in the tooltip"); a chart without children lists them here, so a plain <ChartMarkers items /> + <ChartTooltip /> shows
  // the events, as markers.md's overview promises. Children replace it, so the bklit composition renders once.
  const active = options.footer === undefined ? markersOn(options.markers, date) : [];
  return (
    <TooltipContent className={options.className} rows={rows} title={options.title === undefined ? weekdayDateFmt.format(date) : options.title(date)}>
      {options.footer ?? (active.length > 0 ? <MarkerTooltipContent markers={active} /> : null)}
    </TooltipContent>
  );
};

export interface BklitTooltipCarrier {
  readonly rows?: (point: Datum) => readonly TooltipRow[];
  readonly content?: (args: { point: Datum; index: number; pinned?: boolean; dismiss?: () => void }) => ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}

/** Adapts bklit's `<ChartTooltip rows content>` signatures (data row + index) to the body options (native ChartPoint);
 * `order` / `colors` / `labels` / `markers` come from the chart's series and children. */
export const bklitTooltipOptions = (
  tooltip: BklitTooltipCarrier | undefined,
  data: readonly Datum[],
  base: Pick<TooltipBodyOptions, "order" | "colors" | "labels" | "markers" | "ranges">,
): TooltipBodyOptions => {
  const { rows, content, className, children } = tooltip ?? {};
  // SAFETY: bklit tooltips are authored over data rows, and a point's datum is the row it was built from.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  const rowOf = (point: Point): Datum => point.datum as Datum;
  return {
    ...base,
    className,
    footer: children,
    rows: rows === undefined ? undefined : (_rows, point) => rows(rowOf(point)),
    content: content === undefined ? undefined : ({ point, pinned, dismiss }) => content({ point: rowOf(point), index: data.indexOf(rowOf(point)), pinned, dismiss }),
  };
};
