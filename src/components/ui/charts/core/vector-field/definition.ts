import type { ChartBounds, ChartPoint, SceneNode } from "@tanstack/charts";
import { defineChart } from "@tanstack/charts/scene";
import { vector } from "@tanstack/charts/vector";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import { el } from "../markup/node";
import { SEQUENTIAL_SCALE, sqrtThresholds, stepColor } from "../spatial/colors";
import { SPATIAL_BASE_KEYS, SPATIAL_FADE_LIMIT } from "../spatial/family";
import { round2, skeletonRandom, skeletonStroke, spatialSkeleton } from "../spatial/loading";
import type { SpatialBuild, SpatialBuildInput, SpatialFamily } from "../spatial/family";
import { stepLegend } from "../spatial/legend";
import { extentOf, niceDomain, planeMargin, planeScales } from "../spatial/plane";
import { formatSpatialValue, spatialTooltipOption } from "../spatial/tooltip";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { SpatialRow } from "../types/spatial";
import type { VectorFieldArrowsProps, VectorFieldAxisProps, VectorFieldChartProps, VectorFieldGridProps, VectorFieldLegendProps, VectorFieldTooltipProps, VectorFieldVector } from "../types/vector-field";
import { describeVectors } from "../spatial/describe";

/** The vector field's carrier roles. */
export const VECTOR_FIELD_ROLES = {
  arrows: "vectorFieldArrows",
  grid: "vectorFieldGrid",
  xAxis: "vectorFieldXAxis",
  yAxis: "vectorFieldYAxis",
  tooltip: "vectorFieldTooltip",
  legend: "vectorFieldLegend",
} as const;

/** What a VectorFieldChart hands its controller (the adapter keeps `className` and `children`). */
export type VectorFieldProps = Omit<VectorFieldChartProps<unknown>, "className" | "children">;

const ARROWS_ID = "vector-field-arrows";
const HEAD_LENGTH = 5;
const HEAD_ANGLE = 30;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const SKELETON_ID = "skeleton-vector-field";
/** The skeleton's eddy, in plot shares (x right, y down), and the drift across it. */
const EDDY = { x: 0.58, y: 0.48, reach: 0.32 } as const;
const DRIFT = 0.55;

/** The skeleton: an arrow every `spacing` px, turning about the eddy over a rightward drift, its length `maxLength` at most. */
const vectorSkeleton = (maxLength: number, strokeWidth: number) => (chart: ChartBounds): SceneNode[] => {
  const random = skeletonRandom(13);
  const spacing = Math.max(14, maxLength * 1.3);
  const columns = Math.max(1, Math.floor(chart.width / spacing));
  const rows = Math.max(1, Math.floor(chart.height / spacing));
  const head = (HEAD_ANGLE * Math.PI) / 180;
  const nodes: SceneNode[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = chart.x + ((column + 0.5) / columns) * chart.width;
      const y = chart.y + ((row + 0.5) / rows) * chart.height;
      // Around the eddy, weaker away from it, over the drift.
      const ex = (x - chart.x) / chart.width - EDDY.x;
      const ey = (y - chart.y) / chart.height - EDDY.y;
      const pull = Math.exp(-(ex * ex + ey * ey) / (2 * EDDY.reach * EDDY.reach));
      const u = DRIFT - ey * pull * 3;
      const v = ex * pull * 3;
      const magnitude = Math.min(1, Math.hypot(u, v));
      const length = maxLength * (0.45 + 0.4 * magnitude + random() * 0.1);
      const angle = Math.atan2(v, u);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const tx = x - (cos * length) / 2;
      const ty = y - (sin * length) / 2;
      const hx = x + (cos * length) / 2;
      const hy = y + (sin * length) / 2;
      const left = angle + Math.PI - head;
      const right = angle + Math.PI + head;
      const d = `M${round2(tx)},${round2(ty)}L${round2(hx)},${round2(hy)}M${round2(hx + Math.cos(left) * HEAD_LENGTH)},${round2(hy + Math.sin(left) * HEAD_LENGTH)}L${round2(hx)},${round2(hy)}L${round2(hx + Math.cos(right) * HEAD_LENGTH)},${round2(hy + Math.sin(right) * HEAD_LENGTH)}`;
      nodes.push(skeletonStroke(`${SKELETON_ID}:${column}-${row}`, d, { strokeWidth }));
    }
  }
  return nodes;
};

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const lastOf = <T>(table: SpatialBuildInput<VectorFieldProps>["table"], role: string): T | undefined => propsFor<T>(table, role).at(-1);

/** A direction as a compass point and its degrees: `NE 45°`. */
const compass = (angle: number): string => {
  const degrees = ((Math.round(angle) % 360) + 360) % 360;
  return `${COMPASS[Math.round(degrees / 45) % 8] ?? "N"} ${degrees}°`;
};

const createVectorFieldBuilder = () => (input: SpatialBuildInput<VectorFieldProps>): SpatialBuild => {
  const { props, table, loading } = input;
  const { data, xDataKey, yDataKey } = props;
  const arrows = lastOf<VectorFieldArrowsProps>(table, VECTOR_FIELD_ROLES.arrows);
  const xAxis = lastOf<VectorFieldAxisProps>(table, VECTOR_FIELD_ROLES.xAxis);
  const yAxis = lastOf<VectorFieldAxisProps>(table, VECTOR_FIELD_ROLES.yAxis);
  const grid = lastOf<VectorFieldGridProps>(table, VECTOR_FIELD_ROLES.grid);
  const legendProps = lastOf<VectorFieldLegendProps>(table, VECTOR_FIELD_ROLES.legend);
  const hasTooltip = table.has(VECTOR_FIELD_ROLES.tooltip) && arrows !== undefined;
  const aspectRatio = parseAspectRatio(props.aspectRatio ?? "16 / 9");
  const xDomain = props.xDomain ?? niceDomain(extentOf(data, xDataKey));
  const yDomain = props.yDomain ?? niceDomain(extentOf(data, yDataKey));
  const maxLength = arrows?.maxLength ?? 22;
  // An arrow at the domain's edge reaches half its length past it.
  const pad = Math.ceil(maxLength / 2);
  const margin = planeMargin(xAxis, yAxis, props.margin, pad);

  // Each sample's direction (clockwise from up) and magnitude.
  const angleKey = arrows?.angleDataKey;
  const magnitudeKey = arrows?.magnitudeDataKey;
  const uKey = arrows?.uDataKey ?? "u";
  const vKey = arrows?.vDataKey ?? "v";
  const vectorOf = (row: SpatialRow): { readonly angle: number; readonly magnitude: number } => {
    if (angleKey !== undefined && magnitudeKey !== undefined) {
      return { angle: finite(row[angleKey]), magnitude: Math.abs(finite(row[magnitudeKey])) };
    }
    const u = finite(row[uKey]);
    const v = finite(row[vKey]);
    return { angle: (Math.atan2(u, v) * 180) / Math.PI, magnitude: Math.hypot(u, v) };
  };
  const vectors = new Map(data.map((row) => [row, vectorOf(row)] as const));
  let maxMagnitude = 0;
  for (const { magnitude } of vectors.values()) { maxMagnitude = Math.max(maxMagnitude, magnitude); }
  const lengthOf = (magnitude: number): number => (maxMagnitude > 0 ? Math.sqrt(magnitude / maxMagnitude) * maxLength : 0);
  const colors = arrows?.colors !== undefined && arrows.colors.length > 0 ? arrows.colors : SEQUENTIAL_SCALE;
  const thresholds = sqrtThresholds(0, maxMagnitude, colors.length, false);
  const colorOf = (magnitude: number): string => arrows?.color ?? stepColor(magnitude, colors, thresholds);
  const strokeWidth = arrows?.strokeWidth ?? 1.5;
  const indexOf = new Map(data.map((row, i) => [row, i] as const));
  const at = (row: SpatialRow): { readonly angle: number; readonly magnitude: number } => vectors.get(row) ?? { angle: 0, magnitude: 0 };

  const skeleton = loading ? spatialSkeleton(SKELETON_ID, vectorSkeleton(maxLength, strokeWidth), { low: 0.2 }) : null;
  const marks = skeleton !== null ? [skeleton.mark] : arrows === undefined ? [] : [
    vector(erase(data), erase({
      id: ARROWS_ID,
      x: (row: SpatialRow) => finite(row[xDataKey]),
      y: (row: SpatialRow) => finite(row[yDataKey]),
      key: (row: SpatialRow) => indexOf.get(row) ?? 0,
      length: (row: SpatialRow) => lengthOf(at(row).magnitude),
      rotate: (row: SpatialRow) => at(row).angle,
      anchor: "middle",
      stroke: (row: SpatialRow) => colorOf(at(row).magnitude),
      strokeWidth,
      headLength: HEAD_LENGTH,
      headAngle: HEAD_ANGLE,
    })),
  ];
  const definition = defineChart(erase({
    marks,
    scales: planeScales({ xDomain, yDomain, xAxis, yAxis, grid, pad }),
    margin,
    theme: bklitTheme,
    focus: "nearest",
    maxFocusDistance: Math.max(12, maxLength * 0.75),
    focusRing: false,
    tooltip: spatialTooltipOption(hasTooltip && !loading),
  }));

  // SAFETY: every point of this chart is an arrow's, whose datum is its data row.
  const rowOf = (point: ChartPoint): SpatialRow => point.datum as SpatialRow;
  const xFormat = xAxis?.formatValue ?? formatSpatialValue;
  const yFormat = yAxis?.formatValue ?? formatSpatialValue;
  return {
    definition,
    aspectRatio,
    describeData: () => describeVectors(data, { key: xDataKey, label: xAxis?.label, format: xAxis?.formatValue }, { key: yDataKey, label: yAxis?.label, format: yAxis?.formatValue }, at, compass),
    ariaLabel: props.ariaLabel ?? "Vector field",
    ariaDescription: props.ariaDescription,
    hoverLayers: arrows !== undefined && arrows.fadeOnHover !== false ? [{ markId: ARROWS_ID, inactiveOpacity: arrows.inactiveOpacity ?? 0.3, fade: data.length <= SPATIAL_FADE_LIMIT }] : [],
    focusMarks: new Set([ARROWS_ID]),
    // The focused arrow again, wider and in full color, over a halo the card's color.
    lift: (point) => {
      const { angle, magnitude } = at(rowOf(point));
      const length = Math.max(4, lengthOf(magnitude));
      const radians = (angle * Math.PI) / 180;
      const dx = (Math.sin(radians) * length) / 2;
      const dy = (-Math.cos(radians) * length) / 2;
      const [x1, y1, x2, y2] = [point.x - dx, point.y - dy, point.x + dx, point.y + dy];
      const head = (side: number): string => {
        const a = radians + Math.PI + side * ((HEAD_ANGLE * Math.PI) / 180);
        return `M${x2},${y2}L${x2 + Math.sin(a) * (HEAD_LENGTH + 1)},${y2 - Math.cos(a) * (HEAD_LENGTH + 1)}`;
      };
      const d = `M${x1},${y1}L${x2},${y2}${head(1)}${head(-1)}`;
      const color = colorOf(magnitude);
      return el("g", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
        el("path", { d, stroke: "var(--chart-background)", "stroke-width": strokeWidth + 4 }),
        el("path", { d, stroke: color, "stroke-width": strokeWidth + 1.5 }),
      ]);
    },
    entrance: arrows === undefined ? [] : [{ markId: ARROWS_ID, kind: "wave", fromScale: 0 }],
    skeleton: skeleton === null ? [] : [skeleton.layer],
    hostVars: {},
    hostAttrs: {},
    legend: legendProps === undefined || arrows === undefined || arrows.color !== undefined ? null : stepLegend(legendProps, colors, thresholds, 0),
    describe: hasTooltip
      ? (points, carrier) => {
          const point = points.at(0);
          if (point === undefined || point.markId !== ARROWS_ID) {
            return undefined;
          }
          // SAFETY: the tooltip carrier's props are VectorFieldTooltipProps.
          const tooltip = carrier as VectorFieldTooltipProps<unknown, unknown>;
          const row = rowOf(point);
          const { angle, magnitude } = at(row);
          const vectorArgs: VectorFieldVector = { row, magnitude, angle };
          const format = tooltip.formatValue ?? formatSpatialValue;
          const color = colorOf(magnitude);
          return {
            args: { vector: vectorArgs, index: indexOf.get(row) ?? point.datumIndex },
            title: `${xFormat(finite(row[xDataKey]))}, ${yFormat(finite(row[yDataKey]))}`,
            rows: [
              { color, label: tooltip.valueLabel ?? "Magnitude", value: format(magnitude) },
              { color: "var(--chart-foreground-muted)", label: "Direction", value: compass(angle) },
            ],
          };
        }
      : null,
    drag: null,
  };
};

/** The vector field family for the spatial controller. */
export const VECTOR_FIELD_FAMILY: SpatialFamily<VectorFieldProps> = {
  chart: "vector-field",
  css: "",
  definitionRoles: [VECTOR_FIELD_ROLES.arrows, VECTOR_FIELD_ROLES.grid, VECTOR_FIELD_ROLES.xAxis, VECTOR_FIELD_ROLES.yAxis, VECTOR_FIELD_ROLES.legend],
  tooltipRole: VECTOR_FIELD_ROLES.tooltip,
  definitionProps: ["data", "xDataKey", "yDataKey", "xDomain", "yDomain", "aspectRatio", "margin", "revealSignature", "ariaLabel", "ariaDescription"],
  keys: ["data", "xDataKey", "yDataKey", "xDomain", "yDomain", ...SPATIAL_BASE_KEYS],
  createBuilder: createVectorFieldBuilder,
};
