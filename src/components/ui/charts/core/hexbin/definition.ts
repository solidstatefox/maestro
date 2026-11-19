import type { ChartBounds, ChartPoint, SceneNode } from "@tanstack/charts";
import { defineChart } from "@tanstack/charts/scene";
import { hexbin } from "@tanstack/charts/spatial/hexbin";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { el } from "../markup/node";
import { SEQUENTIAL_SCALE, sqrtThresholds, stepColor } from "../spatial/colors";
import { SPATIAL_BASE_KEYS, SPATIAL_FADE_LIMIT } from "../spatial/family";
import { skeletonArea, skeletonRandom, spatialSkeleton } from "../spatial/loading";
import type { SpatialBuild, SpatialBuildInput, SpatialFamily } from "../spatial/family";
import { stepLegend } from "../spatial/legend";
import { extentOf, niceDomain, planeMargin, planeScales } from "../spatial/plane";
import { formatSpatialValue, spatialTooltipOption } from "../spatial/tooltip";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { HexbinAxisProps, HexbinBin, HexbinCellsProps, HexbinChartProps, HexbinGridProps, HexbinLegendProps, HexbinReduce, HexbinTooltipProps } from "../types/hexbin";
import type { SpatialRow } from "../types/spatial";
import { hexagonPath, latticeValues } from "./lattice";
import { describeCloud } from "../spatial/describe";

/** The hexbin carriers' table roles. */
export const HEXBIN_ROLES = {
  cells: "hexbinCells",
  grid: "hexbinGrid",
  xAxis: "hexbinXAxis",
  yAxis: "hexbinYAxis",
  tooltip: "hexbinTooltip",
  legend: "hexbinLegend",
} as const;

/** What a HexbinChart hands its controller (the adapter keeps `className` and `children`). */
export type HexbinProps = Omit<HexbinChartProps<unknown>, "className" | "children">;

const CELLS_ID = "hexbin-cells";
const SKELETON_ID = "skeleton-hexbin";
const DEFAULT_BIN_WIDTH = 22;
const DEFAULT_GAP = 1.5;
/** The nominal width the default thresholds are estimated at. */
const NOMINAL_WIDTH = 640;

/** A rendered bin (TanStack's HexbinDatum with our outputs). */
interface BinDatum {
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly value?: number;
  readonly source: readonly SpatialRow[];
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const binValue = (bin: BinDatum, reduce: HexbinReduce): number => (reduce === "count" ? bin.count : (bin.value ?? 0));

const lastOf = <T>(table: SpatialBuildInput<HexbinProps>["table"], role: string): T | undefined => propsFor<T>(table, role).at(-1);

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

// The skeleton's patch: three soft clusters along the plot's diagonal, as scattered observations bin (x right, y down, in plot shares).
const PATCH = [
  { x: 0.2, y: 0.72, sx: 0.16, sy: 0.2, weight: 1 },
  { x: 0.48, y: 0.46, sx: 0.14, sy: 0.17, weight: 0.85 },
  { x: 0.78, y: 0.24, sx: 0.1, sy: 0.13, weight: 0.6 },
] as const;
const PATCH_EDGE = 0.3;

/** The skeleton: the hexagons of the cells' lattice (circumradius `latticeR`, drawn at `r`) inside the patch, denser toward its centers. */
const hexbinSkeleton = (latticeR: number, r: number) => (chart: ChartBounds): SceneNode[] => {
  const random = skeletonRandom(3);
  const dx = latticeR * Math.sqrt(3);
  const dy = latticeR * 1.5;
  const nodes: SceneNode[] = [];
  for (let row = 0; row * dy <= chart.height; row += 1) {
    for (let column = 0; (column + (row % 2) / 2) * dx <= chart.width; column += 1) {
      const x = (column + (row % 2) / 2) * dx;
      const y = row * dy;
      let field = 0;
      for (const blob of PATCH) {
        const u = (x / chart.width - blob.x) / blob.sx;
        const v = (y / chart.height - blob.y) / blob.sy;
        field += blob.weight * Math.exp(-(u * u + v * v) / 2);
      }
      const level = field + (random() - 0.5) * 0.24;
      if (level > PATCH_EDGE) {
        nodes.push(skeletonArea(`${SKELETON_ID}:${column}-${row}`, hexagonPath(chart.x + x, chart.y + y, r), { fillOpacity: Math.min(1, 0.3 + level * 0.6) }));
      }
    }
  }
  return nodes;
};

const reduceLabel = (reduce: HexbinReduce, key: string | undefined): string => {
  if (reduce === "count" || key === undefined) { return "Count"; }
  return reduce === "sum" ? `Total ${key}` : `Average ${key}`;
};

const createHexbinBuilder = () => (input: SpatialBuildInput<HexbinProps>): SpatialBuild => {
  const { props, table, loading } = input;
  const { data, xDataKey, yDataKey } = props;
  const cells = lastOf<HexbinCellsProps>(table, HEXBIN_ROLES.cells);
  const xAxis = lastOf<HexbinAxisProps>(table, HEXBIN_ROLES.xAxis);
  const yAxis = lastOf<HexbinAxisProps>(table, HEXBIN_ROLES.yAxis);
  const grid = lastOf<HexbinGridProps>(table, HEXBIN_ROLES.grid);
  const legendProps = lastOf<HexbinLegendProps>(table, HEXBIN_ROLES.legend);
  const hasTooltip = table.has(HEXBIN_ROLES.tooltip);
  const aspectRatio = parseAspectRatio(props.aspectRatio ?? "16 / 9");
  const xDomain = props.xDomain ?? niceDomain(extentOf(data, xDataKey));
  const yDomain = props.yDomain ?? niceDomain(extentOf(data, yDataKey));
  const binWidth = cells?.binWidth ?? DEFAULT_BIN_WIDTH;
  // The lattice's circumradius (d3-hexbin: neighbouring centres are r·√3 apart), and the drawn one, `gap` narrower.
  const latticeR = binWidth / Math.sqrt(3);
  // A hexagon on the domain's edge reaches its radius past it: the axes stand clear.
  const pad = Math.ceil(latticeR);
  const margin = planeMargin(xAxis, yAxis, props.margin, pad);
  const r = Math.max(1, latticeR - (cells?.gap ?? DEFAULT_GAP) / 2);
  const valueKey = cells?.valueDataKey;
  const reduce: HexbinReduce = cells?.reduce ?? (valueKey === undefined ? "count" : "sum");
  const colors = cells?.colors !== undefined && cells.colors.length > 0 ? cells.colors : SEQUENTIAL_SCALE;
  const valueOf = (row: SpatialRow): number => (valueKey === undefined ? 1 : (finite(row[valueKey]) ?? 0));

  // The default steps: the bin values a nominal layout makes, cut on a square-root scale so every fill is used however skewed they are.
  const nominalHeight = NOMINAL_WIDTH / aspectRatio;
  const innerW = Math.max(1, NOMINAL_WIDTH - margin.left - margin.right);
  const innerH = Math.max(1, nominalHeight - margin.top - margin.bottom);
  const values = cells === undefined || cells.thresholds !== undefined ? [] : latticeValues({
    points: data.map((row) => {
      const x = finite(row[xDataKey]);
      const y = finite(row[yDataKey]);
      return x === null || y === null ? null : {
        x: ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerW,
        y: (1 - (y - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerH,
        value: valueOf(row),
      };
    }),
    radius: latticeR,
    reduce,
  });
  const floor = reduce === "count" ? 1 : (values[0] ?? 0);
  const thresholds = cells?.thresholds ?? sqrtThresholds(floor, values.at(-1) ?? floor, colors.length, reduce === "count");
  const fillOf = (bin: BinDatum): string => stepColor(binValue(bin, reduce), colors, thresholds);

  const outputs = valueKey === undefined
    ? { count: { reduce: "count" } }
    : { count: { reduce: "count" }, value: { value: valueOf, reduce: reduce === "mean" ? "mean" : "sum" } };
  const skeleton = loading ? spatialSkeleton(SKELETON_ID, hexbinSkeleton(latticeR, r)) : null;
  const marks = skeleton !== null ? [skeleton.mark] : cells === undefined ? [] : [
    hexbin(erase(data), erase({
      id: CELLS_ID,
      x: (row: SpatialRow) => finite(row[xDataKey]),
      y: (row: SpatialRow) => finite(row[yDataKey]),
      binWidth,
      outputs,
      r,
      fill: fillOf,
      ...(cells.stroke === undefined ? {} : { stroke: cells.stroke, strokeWidth: 1 }),
    })),
  ];
  const definition = defineChart(erase({
    marks,
    scales: planeScales({ xDomain, yDomain, xAxis, yAxis, grid, pad }),
    margin,
    theme: bklitTheme,
    focus: "nearest",
    maxFocusDistance: latticeR,
    focusRing: false,
    tooltip: spatialTooltipOption(hasTooltip && !loading),
  }));

  // The default title: the bin center in the axes' formats, to one decimal.
  const xFormat = xAxis?.formatValue ?? formatSpatialValue;
  const yFormat = yAxis?.formatValue ?? formatSpatialValue;
  const binOf = (point: ChartPoint): HexbinBin => {
    // SAFETY: every point of this chart is a bin of the hexbin mark (BinDatum).
    const bin = point.datum as BinDatum;
    return { x: bin.x, y: bin.y, count: bin.count, value: binValue(bin, reduce), rows: bin.source };
  };
  const fadeOnHover = cells?.fadeOnHover !== false;
  return {
    definition,
    aspectRatio,
    describeData: () => describeCloud("Hexbin chart", data, { key: xDataKey, label: xAxis?.label, format: xAxis?.formatValue }, { key: yDataKey, label: yAxis?.label, format: yAxis?.formatValue }),
    ariaLabel: props.ariaLabel ?? "Hexbin chart",
    ariaDescription: props.ariaDescription,
    // About one bin per two observations at most: the dim fades unless that could pass the limit.
    hoverLayers: cells !== undefined && fadeOnHover ? [{ markId: CELLS_ID, inactiveOpacity: cells.inactiveOpacity ?? 0.35, fade: data.length <= SPATIAL_FADE_LIMIT * 4 }] : [],
    focusMarks: new Set([CELLS_ID]),
    // The focused hexagon redrawn on top, a little larger, ringed in the foreground.
    lift: (point) => {
      // SAFETY: as `binOf`.
      const fill = fillOf(point.datum as BinDatum);
      return el("path", { class: "bkm-hexbin-lift", d: hexagonPath(point.x, point.y, r * 1.18), fill, stroke: "var(--chart-foreground)", "stroke-width": 1.5, "stroke-linejoin": "round" });
    },
    entrance: [{ markId: CELLS_ID, kind: "wave", fromScale: 0.3 }],
    skeleton: skeleton === null ? [] : [skeleton.layer],
    hostVars: {},
    hostAttrs: {},
    legend: legendProps === undefined || cells === undefined ? null : stepLegend(legendProps, colors, thresholds, floor, reduce === "count"),
    describe: hasTooltip
      ? (points, carrier) => {
          const point = points.at(0);
          if (point === undefined || point.markId !== CELLS_ID) {
            return undefined;
          }
          // SAFETY: the tooltip carrier's props are HexbinTooltipProps.
          const tooltip = carrier as HexbinTooltipProps<unknown, unknown>;
          const bin = binOf(point);
          const format = tooltip.formatValue ?? formatSpatialValue;
          const title = tooltip.formatPosition?.(bin.x, bin.y) ?? `${xFormat(oneDecimal(bin.x))} · ${yFormat(oneDecimal(bin.y))}`;
          const rows = [{ color: fillOf(erase(point.datum)), label: tooltip.valueLabel ?? reduceLabel(reduce, valueKey), value: format(bin.value) }];
          if (reduce !== "count") {
            rows.push({ color: "var(--chart-foreground-muted)", label: "Count", value: formatSpatialValue(bin.count) });
          }
          return { args: { bin, index: point.datumIndex }, title, rows };
        }
      : null,
    drag: null,
  };
};

/** The hexbin family for the spatial controller. */
export const HEXBIN_FAMILY: SpatialFamily<HexbinProps> = {
  chart: "hexbin",
  css: "",
  definitionRoles: [HEXBIN_ROLES.cells, HEXBIN_ROLES.grid, HEXBIN_ROLES.xAxis, HEXBIN_ROLES.yAxis, HEXBIN_ROLES.legend],
  tooltipRole: HEXBIN_ROLES.tooltip,
  definitionProps: ["data", "xDataKey", "yDataKey", "xDomain", "yDomain", "aspectRatio", "margin", "revealSignature", "ariaLabel", "ariaDescription"],
  keys: ["data", "xDataKey", "yDataKey", "xDomain", "yDomain", ...SPATIAL_BASE_KEYS],
  createBuilder: createHexbinBuilder,
};
