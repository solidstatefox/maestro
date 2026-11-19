import type { ChartBounds, ChartPoint, SceneNode } from "@tanstack/charts";
import { dot } from "@tanstack/charts/dot";
import { defineChart } from "@tanstack/charts/scene";
import { densityContour } from "@tanstack/charts/spatial/density";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { el } from "../markup/node";
import { CHART_PALETTE } from "../palette";
import { SPATIAL_BASE_KEYS, SPATIAL_FADE_LIMIT } from "../spatial/family";
import type { SpatialBuild, SpatialBuildInput, SpatialEntrance, SpatialFamily, SpatialHoverLayer } from "../spatial/family";
import { blobPath, skeletonArea, skeletonDot, skeletonRandom, spatialSkeleton } from "../spatial/loading";
import type { SpatialSkeletonLayer } from "../spatial/loading";
import { seriesLegend } from "../spatial/legend";
import { extentOf, niceDomain, planeMargin, planeScales } from "../spatial/plane";
import { formatSpatialValue, spatialTooltipOption } from "../spatial/tooltip";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { DensityAxisProps, DensityChartProps, DensityContoursProps, DensityGridProps, DensityLegendProps, DensityPointsProps, DensityTooltipProps } from "../types/density";
import type { SpatialRow } from "../types/spatial";
import { describeCloud } from "../spatial/describe";

/** The density carriers' table roles. */
export const DENSITY_ROLES = {
  contours: "densityContours",
  points: "densityPoints",
  grid: "densityGrid",
  xAxis: "densityXAxis",
  yAxis: "densityYAxis",
  tooltip: "densityTooltip",
  legend: "densityLegend",
} as const;

/** What a DensityChart hands its controller (the adapter keeps `className` and `children`). */
export type DensityProps = Omit<DensityChartProps<unknown>, "className" | "children">;

const CONTOURS_ID = "density-contours";
const POINTS_ID = "density-points";
const SKELETON_BANDS_ID = "skeleton-density-bands";
const SKELETON_POINTS_ID = "skeleton-density-points";
/** The skeleton's clusters, in plot shares (x right, y down), and its band levels from the outermost in. */
const CLUSTERS = [
  { x: 0.3, y: 0.38, rx: 0.2, ry: 0.3 },
  { x: 0.7, y: 0.66, rx: 0.19, ry: 0.24 },
] as const;
const LEVELS = [1, 0.74, 0.5, 0.28] as const;
const SKELETON_DOTS = 72;
/** The color scale's key without groups. */
const ALL = "all";

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const lastOf = <T>(table: SpatialBuildInput<DensityProps>["table"], role: string): T | undefined => propsFor<T>(table, role).at(-1);

/** The groups in order of first appearance. */
const groupsOf = (data: readonly SpatialRow[], key: string | undefined): string[] => {
  if (key === undefined) {
    return [ALL];
  }
  const seen = new Set<string>();
  for (const row of data) {
    seen.add(String(row[key] ?? ""));
  }
  return [...seen];
};

/** The skeleton's bands: each cluster's levels, interleaved outermost first (both clusters breathe inward together). */
const skeletonBands = (chart: ChartBounds): SceneNode[] => {
  const random = skeletonRandom(5);
  const nodes: SceneNode[] = [];
  for (const [level, k] of LEVELS.entries()) {
    for (const [index, cluster] of CLUSTERS.entries()) {
      const d = blobPath(chart.x + cluster.x * chart.width, chart.y + cluster.y * chart.height, cluster.rx * chart.width * k, cluster.ry * chart.height * k, random);
      nodes.push(skeletonArea(`${SKELETON_BANDS_ID}:${index}-${level}`, d, { fillOpacity: 0.14, stroke: "var(--chart-foreground-muted)", strokeOpacity: 0.55, strokeWidth: 1 }));
    }
  }
  return nodes;
};

/** The skeleton's dots: scattered about the clusters (a seeded normal spread). */
const skeletonDots = (radius: number) => (chart: ChartBounds): SceneNode[] => {
  const random = skeletonRandom(9);
  const nodes: SceneNode[] = [];
  for (let i = 0; i < SKELETON_DOTS; i += 1) {
    const cluster = CLUSTERS[i % CLUSTERS.length] ?? CLUSTERS[0];
    const spread = Math.sqrt(-2 * Math.log(random() || 0.5)) * 0.45;
    const angle = random() * Math.PI * 2;
    const x = Math.min(1, Math.max(0, cluster.x + Math.cos(angle) * spread * cluster.rx));
    const y = Math.min(1, Math.max(0, cluster.y + Math.sin(angle) * spread * cluster.ry));
    nodes.push(skeletonDot(`${SKELETON_POINTS_ID}:${i}`, chart.x + x * chart.width, chart.y + y * chart.height, radius, { fillOpacity: 0.7 }));
  }
  return nodes;
};

const createDensityBuilder = () => (input: SpatialBuildInput<DensityProps>): SpatialBuild => {
  const { props, table, loading } = input;
  const { data, xDataKey, yDataKey, groupDataKey } = props;
  const contours = lastOf<DensityContoursProps>(table, DENSITY_ROLES.contours);
  const points = lastOf<DensityPointsProps>(table, DENSITY_ROLES.points);
  const xAxis = lastOf<DensityAxisProps>(table, DENSITY_ROLES.xAxis);
  const yAxis = lastOf<DensityAxisProps>(table, DENSITY_ROLES.yAxis);
  const grid = lastOf<DensityGridProps>(table, DENSITY_ROLES.grid);
  const legendProps = lastOf<DensityLegendProps>(table, DENSITY_ROLES.legend);
  const hasTooltip = table.has(DENSITY_ROLES.tooltip) && points !== undefined;
  const aspectRatio = parseAspectRatio(props.aspectRatio ?? "16 / 9");
  const xDomain = props.xDomain ?? niceDomain(extentOf(data, xDataKey));
  const yDomain = props.yDomain ?? niceDomain(extentOf(data, yDataKey));
  const radius = points?.radius ?? 2.5;
  const pad = points === undefined ? 0 : Math.ceil(radius + 1);
  const margin = planeMargin(xAxis, yAxis, props.margin, pad);

  const groups = groupsOf(data, groupDataKey);
  const colorOf = (group: string): string => props.groupColors?.[group] ?? CHART_PALETTE[Math.max(0, groups.indexOf(group)) % CHART_PALETTE.length] ?? "var(--chart-1)";
  const groupOf = (row: SpatialRow): string => (groupDataKey === undefined ? ALL : String(row[groupDataKey] ?? ""));
  const rows = data.filter((row) => finite(row[xDataKey]) !== null && finite(row[yDataKey]) !== null);
  const indexOf = new Map(data.map((row, i) => [row, i] as const));
  const x = (row: SpatialRow): number | null => finite(row[xDataKey]);
  const y = (row: SpatialRow): number | null => finite(row[yDataKey]);

  const marks = [];
  const skeleton: SpatialSkeletonLayer[] = [];
  if (loading) {
    // The bands unless the chart shows only dots.
    if (contours !== undefined || points === undefined) {
      const bands = spatialSkeleton(SKELETON_BANDS_ID, skeletonBands, { pulse: "breathe", low: 0.35, stagger: 220 });
      marks.push(bands.mark);
      skeleton.push(bands.layer);
    }
    if (points !== undefined) {
      const dots = spatialSkeleton(SKELETON_POINTS_ID, skeletonDots(radius), { low: 0.2 });
      marks.push(dots.mark);
      skeleton.push(dots.layer);
    }
  }
  if (contours !== undefined && !loading) {
    const { thresholds } = contours;
    marks.push(densityContour(erase(rows), erase({
      id: CONTOURS_ID,
      x,
      y,
      ...(groupDataKey === undefined ? {} : { z: groupOf }),
      bandwidth: contours.bandwidth ?? 20,
      thresholds: thresholds === undefined ? 8 : typeof thresholds === "number" ? thresholds : [...thresholds],
      fill: (datum: { readonly group: unknown }) => contours.color ?? colorOf(datum.group === null ? ALL : String(datum.group)),
      fillOpacity: contours.fillOpacity ?? 0.14,
      ...((contours.strokeWidth ?? 1) > 0
        ? { stroke: (datum: { readonly group: unknown }) => contours.color ?? colorOf(datum.group === null ? ALL : String(datum.group)), strokeWidth: contours.strokeWidth ?? 1, strokeOpacity: contours.strokeOpacity ?? 0.55 }
        : {}),
    })));
  }
  if (points !== undefined && !loading) {
    marks.push(dot(erase(rows), erase({
      id: POINTS_ID,
      x,
      y,
      color: groupOf,
      key: (row: SpatialRow) => indexOf.get(row) ?? 0,
      r: radius,
      fillOpacity: points.opacity ?? 0.7,
    })));
  }
  const definition = defineChart(erase({
    marks,
    scales: planeScales({ xDomain, yDomain, xAxis, yAxis, grid, pad }),
    color: { domain: groups, range: groups.map(colorOf) },
    margin,
    theme: bklitTheme,
    focus: "nearest",
    maxFocusDistance: 14,
    focusRing: false,
    tooltip: spatialTooltipOption(hasTooltip && !loading),
  }));

  const hoverLayers: SpatialHoverLayer[] = [];
  const fade = rows.length <= SPATIAL_FADE_LIMIT;
  if (contours !== undefined && contours.fadeOnHover !== false) {
    hoverLayers.push({ markId: CONTOURS_ID, inactiveOpacity: contours.inactiveOpacity ?? 0.5, fade });
  }
  if (points !== undefined && points.fadeOnHover !== false) {
    hoverLayers.push({ markId: POINTS_ID, inactiveOpacity: points.inactiveOpacity ?? 0.35, fade });
  }
  const entrance: SpatialEntrance[] = [];
  if (contours !== undefined) {
    entrance.push({ markId: CONTOURS_ID, kind: "levels", fromScale: 0.85, duration: 700 });
  }
  if (points !== undefined) {
    entrance.push({ markId: POINTS_ID, kind: "wave", fromScale: 0, delay: contours === undefined ? 0 : 200 });
  }
  // SAFETY: every point of this chart is a dot's (the bands emit none), and a dot's datum is a data row.
  const rowOf = (point: ChartPoint): SpatialRow => point.datum as SpatialRow;
  const xFormat = xAxis?.formatValue ?? formatSpatialValue;
  const yFormat = yAxis?.formatValue ?? formatSpatialValue;
  return {
    definition,
    aspectRatio,
    describeData: () => describeCloud("Density chart", data, { key: xDataKey, label: xAxis?.label, format: xAxis?.formatValue }, { key: yDataKey, label: yAxis?.label, format: yAxis?.formatValue }, groupDataKey),
    ariaLabel: props.ariaLabel ?? "Density chart",
    ariaDescription: props.ariaDescription,
    hoverLayers,
    focusMarks: new Set([POINTS_ID]),
    lift: (point) => el("circle", { cx: point.x, cy: point.y, fill: colorOf(groupOf(rowOf(point))), r: radius * 1.9, stroke: "var(--chart-background)", "stroke-width": 2 }),
    entrance,
    skeleton,
    hostVars: {},
    hostAttrs: {},
    legend: legendProps === undefined || groupDataKey === undefined ? null : seriesLegend(legendProps, groups.map((group) => ({ color: colorOf(group), label: group }))),
    describe: hasTooltip
      ? (focused, carrier) => {
          const point = focused.at(0);
          if (point === undefined || point.markId !== POINTS_ID) {
            return undefined;
          }
          // SAFETY: the tooltip carrier's props are DensityTooltipProps.
          const tooltip = carrier as DensityTooltipProps<unknown, unknown>;
          const row = rowOf(point);
          const group = groupOf(row);
          const color = colorOf(group);
          const index = indexOf.get(row) ?? point.datumIndex;
          return {
            args: { point: row, index },
            title: groupDataKey === undefined ? "" : group,
            rows: [
              { color, label: tooltip.xLabel ?? xAxis?.label ?? xDataKey, value: xFormat(x(row) ?? 0) },
              { color, label: tooltip.yLabel ?? yAxis?.label ?? yDataKey, value: yFormat(y(row) ?? 0) },
            ],
          };
        }
      : null,
    drag: null,
  };
};

/** The density family for the spatial controller. */
export const DENSITY_FAMILY: SpatialFamily<DensityProps> = {
  chart: "density",
  css: "",
  definitionRoles: [DENSITY_ROLES.contours, DENSITY_ROLES.points, DENSITY_ROLES.grid, DENSITY_ROLES.xAxis, DENSITY_ROLES.yAxis, DENSITY_ROLES.legend],
  tooltipRole: DENSITY_ROLES.tooltip,
  definitionProps: ["data", "xDataKey", "yDataKey", "groupDataKey", "groupColors", "xDomain", "yDomain", "aspectRatio", "margin", "revealSignature", "ariaLabel", "ariaDescription"],
  keys: ["data", "xDataKey", "yDataKey", "groupDataKey", "groupColors", "xDomain", "yDomain", ...SPATIAL_BASE_KEYS],
  createBuilder: createDensityBuilder,
};
