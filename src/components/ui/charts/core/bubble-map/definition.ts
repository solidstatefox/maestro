import type { ChartBounds, ChartPoint, SceneNode } from "@tanstack/charts";
import { geoShape } from "@tanstack/charts/geo";
import { defineChart } from "@tanstack/charts/scene";
import type { Feature, Point } from "geojson";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import { el } from "../markup/node";
import { CHART_PALETTE } from "../palette";
import { SPATIAL_BASE_KEYS, SPATIAL_FADE_LIMIT } from "../spatial/family";
import type { SpatialBuild, SpatialBuildInput, SpatialEntrance, SpatialFamily } from "../spatial/family";
import { createGeoProjectionHolder, fitTarget, geoFocus, graticuleLayer, landLayer, LAND_ID, lonLatOf, mapCss, nearestWithin, projectionOption, sphereLayer } from "../spatial/geo";
import type { GeoFrame, GeoProjectionHolder } from "../spatial/geo";
import { skeletonDot, skeletonPlaces, skeletonRandom, spatialSkeleton } from "../spatial/loading";
import { seriesLegend, sizeLegend } from "../spatial/legend";
import { formatSpatialValue, spatialTooltipOption } from "../spatial/tooltip";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { BubbleMapBubblesProps, BubbleMapChartProps, BubbleMapGraticuleProps, BubbleMapLandProps, BubbleMapLegendProps, BubbleMapTooltipProps } from "../types/bubble-map";
import type { SpatialRow } from "../types/spatial";
import { describePlaces } from "../spatial/describe";

/** What the description reads of a tooltip carrier: its value label and format. */
type SpatialTip = { readonly valueLabel?: string; readonly formatValue?: (value: number) => string };

/** The bubble map's carrier roles. */
export const BUBBLE_MAP_ROLES = {
  land: "bubbleMapLand",
  graticule: "bubbleMapGraticule",
  bubbles: "bubbleMapBubbles",
  tooltip: "bubbleMapTooltip",
  legend: "bubbleMapLegend",
} as const;

/** What a BubbleMapChart hands its controller (the adapter keeps `className` and `children`). */
export type BubbleMapProps = Omit<BubbleMapChartProps<unknown>, "className" | "children">;

const BUBBLES_ID = "bubble-map-bubbles";
const SKELETON_ID = "skeleton-bubble-map";
const SKELETON_BUBBLES = 16;
const FOCUS_SLACK_PX = 6;

interface BubbleProperties {
  readonly row: SpatialRow;
  readonly index: number;
  readonly r: number;
}

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const lastOf = <T>(table: SpatialBuildInput<BubbleMapProps>["table"], role: string): T | undefined => propsFor<T>(table, role).at(-1);

/** Rounds a legend value to a readable figure (two significant digits). */
const readable = (value: number): number => {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(value) || 1)) - 1);
  return Math.round(value / magnitude) * magnitude;
};

/** The skeleton: bubbles of seeded sizes on the land (anywhere on the world without a geography), the largest drawn first. */
const bubbleSkeleton = (holder: GeoProjectionHolder, geography: BubbleMapProps["geography"], minRadius: number, maxRadius: number) => (chart: ChartBounds): SceneNode[] => {
  const random = skeletonRandom(7);
  const places = skeletonPlaces(chart, holder.at(chart), geography, SKELETON_BUBBLES, 7);
  const sized = places.map(([x, y]) => ({ x, y, r: Math.max(minRadius + 1, maxRadius * (0.25 + random() * 0.55)) })).sort((a, b) => b.r - a.r);
  return sized.map(({ x, y, r }, i) => skeletonDot(`${SKELETON_ID}:${i}`, x, y, r, { fillOpacity: 0.65, stroke: "var(--chart-background)", strokeWidth: 1 }));
};

const createBubbleMapBuilder = () => {
  // The frame the projection holder reads: the latest pass's (one holder per chart, its projection rebuilt when the frame or plot changes).
  let frame: GeoFrame = { projection: "equal-earth", rotate: [0, 0], fit: { type: "Sphere" }, inset: 4 };
  const holder = createGeoProjectionHolder(() => frame);
  let frameKey = "";
  return (input: SpatialBuildInput<BubbleMapProps>): SpatialBuild => {
    const { props, table, loading } = input;
    const { data, geography } = props;
    const longitudeKey = props.longitudeKey ?? "longitude";
    const latitudeKey = props.latitudeKey ?? "latitude";
    const nameKey = props.nameKey ?? "name";
    const land = lastOf<BubbleMapLandProps>(table, BUBBLE_MAP_ROLES.land);
    const graticule = lastOf<BubbleMapGraticuleProps>(table, BUBBLE_MAP_ROLES.graticule);
    const bubbles = lastOf<BubbleMapBubblesProps>(table, BUBBLE_MAP_ROLES.bubbles);
    const legendProps = lastOf<BubbleMapLegendProps>(table, BUBBLE_MAP_ROLES.legend);
    const hasTooltip = table.has(BUBBLE_MAP_ROLES.tooltip) && bubbles !== undefined;
    const aspectRatio = parseAspectRatio(props.aspectRatio ?? "2 / 1");
    // Sizes: area proportional to the value, the largest at `maxRadius`.
    const maxRadius = bubbles?.maxRadius ?? 22;
    const minRadius = bubbles?.minRadius ?? 2;
    const valueKey = bubbles?.dataKey ?? "";
    let maxValue = 0;
    for (const row of data) {
      maxValue = Math.max(maxValue, finite(row[valueKey]));
    }
    const radiusOf = (value: number): number => (maxValue > 0 ? Math.max(minRadius, Math.sqrt(Math.max(0, value) / maxValue) * maxRadius) : minRadius);

    // Categories take the palette in order of appearance.
    const colorKey = bubbles?.colorKey;
    const categories: string[] = [];
    if (colorKey !== undefined) {
      for (const row of data) {
        const category = String(row[colorKey] ?? "");
        if (!categories.includes(category)) { categories.push(category); }
      }
    }
    const colorOf = (row: SpatialRow): string => {
      if (colorKey === undefined) { return bubbles?.color ?? "var(--chart-1)"; }
      return CHART_PALETTE[categories.indexOf(String(row[colorKey] ?? "")) % CHART_PALETTE.length] ?? "var(--chart-1)";
    };

    const features: Feature<Point, BubbleProperties>[] = [];
    for (const [index, row] of data.entries()) {
      const at = lonLatOf(row, longitudeKey, latitudeKey);
      if (at !== null) {
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { row, index, r: radiusOf(finite(row[valueKey])) } });
      }
    }
    // The largest first, so the smaller ones sit on top.
    features.sort((a, b) => b.properties.r - a.properties.r);
    // A new frame only when its inputs change: the projection holder rebuilds on a new one.
    const fitData = props.fit === "data";
    const nextKey = `${props.projection ?? "equal-earth"}|${(props.rotate ?? [0, 0]).join()}|${props.fit ?? "sphere"}`;
    if (nextKey !== frameKey || props.fit === "geography" || fitData) {
      frame = {
        projection: props.projection ?? "equal-earth",
        rotate: props.rotate ?? [0, 0],
        fit: fitTarget(props.fit, geography, features.map((feature) => feature.geometry.coordinates as [number, number])),
        // Fitted to the places, the biggest bubble still fits.
        inset: fitData ? maxRadius + 8 : 4,
      };
      frameKey = nextKey;
    }

    const marks: AnyMark[] = [];
    if (graticule !== undefined && graticule.outline !== false) {
      marks.push(sphereLayer(holder, "none", graticule.stroke ?? "var(--chart-graticule)"));
    }
    if (geography !== undefined && land !== undefined) {
      marks.push(landLayer(geography, holder, land));
    }
    if (graticule !== undefined) {
      marks.push(graticuleLayer(holder, graticule));
    }
    const skeleton = loading ? spatialSkeleton(SKELETON_ID, bubbleSkeleton(holder, land === undefined ? undefined : geography, minRadius, maxRadius), { low: 0.3 }) : null;
    if (skeleton !== null) {
      marks.push(skeleton.mark);
    } else if (bubbles !== undefined) {
      marks.push(geoShape(erase(features), erase({
        id: BUBBLES_ID,
        projection: projectionOption(holder),
        key: (feature: Feature<Point, BubbleProperties>) => feature.properties.index,
        r: (feature: Feature<Point, BubbleProperties>) => feature.properties.r,
        fill: (feature: Feature<Point, BubbleProperties>) => colorOf(feature.properties.row),
        fillOpacity: bubbles.fillOpacity ?? 0.65,
        stroke: bubbles.stroke ?? "var(--chart-background)",
        strokeWidth: 1,
        anchor: (feature: Feature<Point, BubbleProperties>) => feature.geometry.coordinates,
      })));
    }
    const focusMarks = new Set([BUBBLES_ID]);
    // SAFETY: every focused point is a bubble's (geoFocus keeps BUBBLES_ID's only), whose datum is its feature.
    const featureOf = (point: ChartPoint): Feature<Point, BubbleProperties> => point.datum as Feature<Point, BubbleProperties>;
    const pick = (points: readonly ChartPoint[], x: number, y: number): ChartPoint | null => {
      let inside: ChartPoint | null = null;
      let insideR = Number.POSITIVE_INFINITY;
      for (const point of points) {
        const { r } = featureOf(point).properties;
        if ((point.x - x) ** 2 + (point.y - y) ** 2 <= r * r && r < insideR) {
          inside = point;
          insideR = r;
        }
      }
      return inside ?? nearestWithin(points, x, y, FOCUS_SLACK_PX);
    };
    const definition = defineChart(erase({
      marks,
      scales: { x: null, y: null },
      margin: { top: 0, right: 0, bottom: 0, left: 0, ...props.margin },
      theme: bklitTheme,
      focus: geoFocus(focusMarks, pick),
      maxFocusDistance: maxRadius + FOCUS_SLACK_PX,
      focusRing: false,
      tooltip: spatialTooltipOption(hasTooltip && !loading),
    }));

    const entrance: SpatialEntrance[] = [];
    if (geography !== undefined && land !== undefined) {
      entrance.push({ markId: LAND_ID, kind: "fade", duration: 500 });
    }
    if (bubbles !== undefined) {
      entrance.push({ markId: BUBBLES_ID, kind: "grow", fromScale: 0, delay: 150, duration: 550 });
    }
    let legend = null;
    if (legendProps !== undefined && bubbles !== undefined && maxValue > 0) {
      const values = [readable(maxValue), readable(maxValue / 4), readable(maxValue / 16)].filter((value, i, all) => value > 0 && all.indexOf(value) === i);
      legend = colorKey === undefined
        ? sizeLegend(legendProps, values, radiusOf, bubbles.color ?? "var(--chart-1)")
        : [sizeLegend(legendProps, values, radiusOf, "var(--chart-foreground-muted)"), seriesLegend({ ...legendProps, title: undefined }, categories.map((label, i) => ({ label, color: CHART_PALETTE[i % CHART_PALETTE.length] ?? "var(--chart-1)" })))];
    }
    return {
      definition,
      aspectRatio,
      describeData: () => describePlaces("Bubble map", data, { name: nameKey, longitude: longitudeKey, latitude: latitudeKey, value: bubbles?.dataKey }, propsFor<SpatialTip>(table, BUBBLE_MAP_ROLES.tooltip).at(-1)?.valueLabel, propsFor<SpatialTip>(table, BUBBLE_MAP_ROLES.tooltip).at(-1)?.formatValue),
      ariaLabel: props.ariaLabel ?? "Bubble map",
      ariaDescription: props.ariaDescription,
      hoverLayers: bubbles !== undefined && bubbles.fadeOnHover !== false ? [{ markId: BUBBLES_ID, inactiveOpacity: bubbles.inactiveOpacity ?? 0.35, fade: features.length <= SPATIAL_FADE_LIMIT }] : [],
      focusMarks,
      lift: (point) => {
        const { row, r } = featureOf(point).properties;
        return el("circle", { cx: point.x, cy: point.y, fill: colorOf(row), "fill-opacity": 0.9, r, stroke: "var(--chart-foreground)", "stroke-width": 1.5 });
      },
      entrance,
      skeleton: skeleton === null ? [] : [skeleton.layer],
      hostVars: {},
      hostAttrs: {},
      legend,
      describe: hasTooltip
        ? (points, carrier) => {
            const point = points.at(0);
            if (point === undefined || point.markId !== BUBBLES_ID) {
              return undefined;
            }
            // SAFETY: the tooltip carrier's props are BubbleMapTooltipProps.
            const tooltip = carrier as BubbleMapTooltipProps<unknown, unknown>;
            const { row, index } = featureOf(point).properties;
            const format = tooltip.formatValue ?? formatSpatialValue;
            return {
              args: { bubble: row, index },
              title: String(row[nameKey] ?? ""),
              rows: [{ color: colorOf(row), label: tooltip.valueLabel ?? valueKey, value: format(finite(row[valueKey])) }],
            };
          }
        : null,
      drag: null,
    };
  };
};

/** The bubble map family for the spatial controller. */
export const BUBBLE_MAP_FAMILY: SpatialFamily<BubbleMapProps> = {
  chart: "bubble-map",
  css: /* @__PURE__ */ mapCss("bubble-map"),
  definitionRoles: [BUBBLE_MAP_ROLES.land, BUBBLE_MAP_ROLES.graticule, BUBBLE_MAP_ROLES.bubbles, BUBBLE_MAP_ROLES.legend],
  tooltipRole: BUBBLE_MAP_ROLES.tooltip,
  definitionProps: ["data", "geography", "longitudeKey", "latitudeKey", "nameKey", "projection", "rotate", "fit", "aspectRatio", "margin", "revealSignature", "ariaLabel", "ariaDescription"],
  keys: ["data", "geography", "longitudeKey", "latitudeKey", "nameKey", "projection", "rotate", "fit", ...SPATIAL_BASE_KEYS],
  createBuilder: createBubbleMapBuilder,
};
