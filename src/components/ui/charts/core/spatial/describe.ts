import { describeFlows, describeParts, describeSeries, field, formatNumber, numberField, rangeText, sampleStats } from "../a11y/describe";
import type { ChartDescription, DescribedColumn, ValueFormat } from "../a11y/describe";
import type { SpatialRow } from "../types/spatial";
import type { RouteMapData } from "../types/route-map";

interface Axis {
  readonly key: string;
  readonly label?: string;
  readonly format?: ValueFormat;
}

/** A point cloud: a row per group (or one for all) with its count and the minimum, median and maximum of x and of y. */
export const describeCloud = (kind: string, data: readonly SpatialRow[], x: Axis, y: Axis, groupKey?: string): ChartDescription => {
  const groups = new Map<string, SpatialRow[]>();
  for (const row of data) {
    const name = groupKey === undefined ? "All points" : String(field(row, groupKey) ?? "");
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  const xf = x.format ?? formatNumber;
  const yf = y.format ?? formatNumber;
  const xl = x.label ?? x.key;
  const yl = y.label ?? y.key;
  const columns: DescribedColumn[] = [
    { label: groupKey === undefined ? "Points" : "Group" },
    { label: "Count", numeric: true },
    ...[`${xl} minimum`, `${xl} median`, `${xl} maximum`, `${yl} minimum`, `${yl} median`, `${yl} maximum`].map((label) => ({ label, numeric: true })),
  ];
  const rows = [...groups].map(([name, list]) => {
    const xs = sampleStats(list.map((r) => numberField(r, x.key) ?? Number.NaN));
    const ys = sampleStats(list.map((r) => numberField(r, y.key) ?? Number.NaN));
    return { header: name, cells: [formatNumber(list.length), xf(xs.min), xf(xs.median), xf(xs.max), yf(ys.min), yf(ys.median), yf(ys.max)], datum: list };
  });
  const xr = rangeText(data.map((r) => numberField(r, x.key) ?? Number.NaN), xf);
  const yr = rangeText(data.map((r) => numberField(r, y.key) ?? Number.NaN), yf);
  const grouped = groupKey === undefined ? "" : ` in ${formatNumber(groups.size)} groups`;
  return { kind, columns, rows, summary: `${kind} of ${formatNumber(data.length)} points${grouped}, ${xl} ${xr}, ${yl} ${yr}.` };
};

/** A vector field: a row per arrow, its position, direction and magnitude. */
export const describeVectors = (
  data: readonly SpatialRow[],
  x: Axis,
  y: Axis,
  vectorOf: (row: SpatialRow) => { readonly angle: number; readonly magnitude: number },
  compass: (angle: number) => string,
): ChartDescription => {
  const xf = x.format ?? formatNumber;
  const yf = y.format ?? formatNumber;
  const out = describeSeries({
    kind: "Vector field",
    unit: "arrows",
    rows: data,
    headerLabel: `${x.label ?? x.key}, ${y.label ?? y.key}`,
    header: (row) => `${xf(numberField(row, x.key) ?? 0)}, ${yf(numberField(row, y.key) ?? 0)}`,
    series: [
      { label: "Direction", value: (row) => vectorOf(row).angle, cell: (row) => compass(vectorOf(row).angle) },
      { label: "Magnitude", value: (row) => vectorOf(row).magnitude },
    ],
  });
  const magnitudes = data.map((row) => vectorOf(row).magnitude);
  const strongest = magnitudes.indexOf(Math.max(...magnitudes));
  const at = out.rows[strongest]?.header ?? "";
  return { ...out, summary: `Vector field of ${formatNumber(data.length)} arrows, magnitudes ${rangeText(magnitudes)}${data.length > 0 ? `, strongest at ${at} pointing ${compass(vectorOf(data[strongest]).angle)}` : ""}.` };
};

/** A map's places: a row per place, its value when the marks are sized by one, and its coordinates. */
export const describePlaces = (
  kind: string,
  data: readonly SpatialRow[],
  keys: { readonly name: string; readonly longitude: string; readonly latitude: string; readonly value?: string },
  valueLabel: string | undefined,
  format: ValueFormat | undefined,
): ChartDescription => {
  const coord = (v: number | null, pos: string, neg: string): string => (v === null ? "" : `${formatNumber(Math.abs(v))}° ${v >= 0 ? pos : neg}`);
  const extra = [
    { label: "Latitude", cell: (row: SpatialRow) => coord(numberField(row, keys.latitude), "N", "S") },
    { label: "Longitude", cell: (row: SpatialRow) => coord(numberField(row, keys.longitude), "E", "W") },
  ];
  const valueKey = keys.value;
  if (valueKey === undefined) {
    const out = describeParts({ kind, unit: "places", items: data, headerLabel: "Place", label: (row) => String(field(row, keys.name) ?? ""), value: () => null, extra });
    return { ...out, columns: [out.columns[0], ...out.columns.slice(2)], rows: out.rows.map((r) => ({ ...r, cells: r.cells.slice(1) })), summary: `${kind} of ${formatNumber(data.length)} places.` };
  }
  return describeParts({
    kind,
    unit: "places",
    items: data,
    headerLabel: "Place",
    label: (row) => String(field(row, keys.name) ?? ""),
    value: (row) => numberField(row, valueKey),
    valueLabel,
    format,
    extra,
  });
};

/** A route map: a row per route, from place to place by name, with its value. */
export const describeRoutes = (data: RouteMapData, valueLabel: string | undefined, format: ValueFormat | undefined): ChartDescription => {
  const name = new Map(data.places.map((p) => [p.id, p.name ?? p.id]));
  const weighted = data.routes.some((r) => r.value !== undefined);
  return describeFlows({
    kind: "Route map",
    unit: "routes",
    links: data.routes,
    nodeCount: data.places.length,
    nodeUnit: "place",
    source: (r) => name.get(r.from) ?? r.from,
    target: (r) => name.get(r.to) ?? r.to,
    ...(weighted ? { value: (r: RouteMapData["routes"][number]) => r.value ?? null, valueLabel, format } : {}),
  });
};
