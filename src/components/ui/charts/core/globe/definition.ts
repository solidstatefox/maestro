import type { ChartBounds, ChartPoint, SceneNode } from "@tanstack/charts";
import { geoShape } from "@tanstack/charts/geo";
import { defineChart } from "@tanstack/charts/scene";
import { geoGraticule, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import { propsFor } from "../carriers/table";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import { el } from "../markup/node";
import { SPATIAL_BASE_KEYS, SPATIAL_FADE_LIMIT } from "../spatial/family";
import type { SpatialBuild, SpatialBuildInput, SpatialDrag, SpatialEntrance, SpatialFamily } from "../spatial/family";
import { createGeoProjectionHolder, geoFocus, graticuleLayer, landLayer, LAND_ID, lonLatOf, nearestWithin, projectionOption, sphereLayer, SPHERE_ID } from "../spatial/geo";
import type { GeoFrame, GeoProjectionHolder } from "../spatial/geo";
import { skeletonArea, skeletonDot, skeletonRandom, spatialSkeleton } from "../spatial/loading";
import type { SpatialSkeletonLayer } from "../spatial/loading";
import { formatSpatialValue, spatialTooltipOption } from "../spatial/tooltip";
import { bklitTheme, parseAspectRatio } from "../theme";
import type { GlobeChartProps, GlobeGraticuleProps, GlobeLandProps, GlobeMarkersProps, GlobeSphereProps, GlobeTooltipProps } from "../types/globe";
import type { SpatialRow } from "../types/spatial";
import { describePlaces } from "../spatial/describe";

/** What the description reads of a tooltip carrier: its value label and format. */
type SpatialTip = { readonly valueLabel?: string; readonly formatValue?: (value: number) => string };

/** The globe's carrier roles. */
export const GLOBE_ROLES = {
  sphere: "globeSphere",
  land: "globeLand",
  graticule: "globeGraticule",
  markers: "globeMarkers",
  tooltip: "globeTooltip",
} as const;

/** What a GlobeChart hands its controller (the adapter keeps `className` and `children`). */
export type GlobeProps = Omit<GlobeChartProps<unknown>, "className" | "children">;

const MARKERS_ID = "globe-markers";
const SKELETON_DISC_ID = "skeleton-globe-disc";
const SKELETON_MARKERS_ID = "skeleton-globe-markers";
const SKELETON_MARKERS = 9;

/** The globe's disc on the plot: the orthographic projection's center and radius (its scale), fitted to the sphere. */
const discOf = (holder: GeoProjectionHolder, chart: ChartBounds): { readonly x: number; readonly y: number; readonly r: number } => {
  const projection = holder.at(chart);
  const [x = 0, y = 0] = projection.translate();
  return { x, y, r: projection.scale() };
};

/** The skeleton's globe: the disc, and the land's silhouette on it when the globe shows land (one path; the land swells just after
 * the disc). */
const discSkeleton = (holder: GeoProjectionHolder, geography: GlobeProps["geography"]) => (chart: ChartBounds): SceneNode[] => {
  const disc = discOf(holder, chart);
  const nodes = [skeletonDot(`${SKELETON_DISC_ID}:disc`, disc.x, disc.y, disc.r, { fillOpacity: 0.35, stroke: "var(--chart-foreground-muted)", strokeWidth: 1 })];
  const land = geography === undefined ? null : geoPath(holder.at(chart))(erase(geography));
  if (land !== null && land !== "") {
    nodes.push(skeletonArea(`${SKELETON_DISC_ID}:land`, land, { fillOpacity: 0.8 }));
  }
  return nodes;
};

/** The skeleton's markers: seeded on the disc's front, clear of its rim. */
const markerSkeleton = (holder: GeoProjectionHolder, radius: number) => (chart: ChartBounds): SceneNode[] => {
  const disc = discOf(holder, chart);
  const random = skeletonRandom(17);
  return Array.from({ length: SKELETON_MARKERS }, (_, i) => {
    const reach = Math.sqrt(random()) * disc.r * 0.78;
    const angle = random() * Math.PI * 2;
    const r = Math.max(2, radius * (0.55 + random() * 0.45));
    return skeletonDot(`${SKELETON_MARKERS_ID}:${i}`, disc.x + Math.cos(angle) * reach, disc.y + Math.sin(angle) * reach, r, { stroke: "var(--chart-background)", strokeWidth: 1.5 });
  });
};
/** Degrees the globe turns per pixel dragged. */
const DRAG_DEGREES_PER_PX = 0.35;
const MAX_TILT = 80;
/** d3-geo's resampling tolerance (px) for the drag's own frames. */
const DRAG_PRECISION = 2;
const NO_ROWS: readonly SpatialRow[] = [];

/** What a drag frame draws (the latest pass's layers and look). */
interface GlobeLook {
  ocean: { readonly fill: string; readonly stroke: string };
  land: { readonly fill: string; readonly stroke: string; readonly strokeWidth: number } | null;
  geography: FeatureCollection<Geometry, unknown> | null;
  graticule: { readonly step: readonly [number, number]; readonly stroke: string; readonly strokeWidth: number } | null;
  markers: { readonly features: readonly Feature<Point, MarkerProperties>[]; readonly color: string } | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const pathElement = (doc: Document, d: string | null, attrs: Readonly<Record<string, string | number>>): SVGPathElement => {
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d ?? "");
  for (const [name, value] of Object.entries(attrs)) { path.setAttribute(name, String(value)); }
  return path;
};

interface MarkerProperties {
  readonly row: SpatialRow;
  readonly index: number;
  readonly r: number;
}

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const lastOf = <T>(table: SpatialBuildInput<GlobeProps>["table"], role: string): T | undefined => propsFor<T>(table, role).at(-1);

const createGlobeBuilder = () => {
  // The rotation the drag turns, `[λ, φ]`: d3's rotation puts (-λ, -φ) in front.
  let rotation: [number, number] = [-10, -20];
  let centerKey = "";
  let frame: GeoFrame = { projection: "orthographic", rotate: rotation, fit: { type: "Sphere" }, inset: 2 };
  const holder = createGeoProjectionHolder(() => frame);
  const look: GlobeLook = { ocean: { fill: "", stroke: "" }, land: null, geography: null, graticule: null, markers: null };
  // The graticule's lines, made once per step.
  let graticuleLines: { readonly key: string; readonly lines: GeoJSON.MultiLineString } | null = null;
  const drag: SpatialDrag = {
    start: () => undefined,
    move(dx, dy) {
      rotation = [rotation[0] + dx * DRAG_DEGREES_PER_PX, Math.max(-MAX_TILT, Math.min(MAX_TILT, rotation[1] - dy * DRAG_DEGREES_PER_PX))];
      return dx !== 0 || dy !== 0;
    },
    end: () => undefined,
    // A drag frame: the last projection turned to the drag's rotation (an orthographic fit to the sphere does not move with it), each
    // layer one path (all the land in one) drawn with d3-geo alone.
    draw(svg) {
      const projection = holder.current();
      if (projection === null) { return; }
      // Coarser resampling while it moves (d3's default is √½ px); the released frame is the renderer's, at full precision.
      projection.rotate([rotation[0], rotation[1], 0]).precision(DRAG_PRECISION);
      const path = geoPath(projection);
      const doc = svg.ownerDocument;
      const nodes: SVGElement[] = [pathElement(doc, path({ type: "Sphere" }), { fill: look.ocean.fill, stroke: look.ocean.stroke, "stroke-width": 1 })];
      if (look.graticule !== null) {
        const key = look.graticule.step.join();
        if (graticuleLines?.key !== key) { graticuleLines = { key, lines: geoGraticule().step([look.graticule.step[0], look.graticule.step[1]])() }; }
        nodes.push(pathElement(doc, path(graticuleLines.lines), { fill: "none", stroke: look.graticule.stroke, "stroke-width": look.graticule.strokeWidth }));
      }
      if (look.land !== null && look.geography !== null) {
        nodes.push(pathElement(doc, path(erase(look.geography)), { fill: look.land.fill, stroke: look.land.stroke, "stroke-width": look.land.strokeWidth, "stroke-linejoin": "round" }));
      }
      if (look.markers !== null) {
        for (const feature of look.markers.features) {
          nodes.push(pathElement(doc, path.pointRadius(feature.properties.r)(feature), { fill: look.markers.color, stroke: "var(--chart-background)", "stroke-width": 1.5 }));
        }
      }
      svg.replaceChildren(...nodes);
    },
  };
  return (input: SpatialBuildInput<GlobeProps>): SpatialBuild => {
    const { props, table, loading } = input;
    const { geography } = props;
    const data = props.data ?? NO_ROWS;
    const longitudeKey = props.longitudeKey ?? "longitude";
    const latitudeKey = props.latitudeKey ?? "latitude";
    const nameKey = props.nameKey ?? "name";
    const sphere = lastOf<GlobeSphereProps>(table, GLOBE_ROLES.sphere);
    const land = lastOf<GlobeLandProps>(table, GLOBE_ROLES.land);
    const graticule = lastOf<GlobeGraticuleProps>(table, GLOBE_ROLES.graticule);
    const markers = lastOf<GlobeMarkersProps>(table, GLOBE_ROLES.markers);
    const hasTooltip = table.has(GLOBE_ROLES.tooltip) && markers !== undefined;
    const aspectRatio = parseAspectRatio(props.aspectRatio ?? "4 / 3");
    // A new `center` turns the globe to it; a drag keeps turning it from there.
    const [lon, lat] = props.center ?? [10, 20];
    if (`${lon}|${lat}` !== centerKey) {
      centerKey = `${lon}|${lat}`;
      rotation = [-lon, -lat];
    }
    frame = { projection: "orthographic", rotate: rotation, fit: { type: "Sphere" }, inset: 2 };

    const maxRadius = markers?.radius ?? 5;
    const valueKey = markers?.dataKey;
    let maxValue = 0;
    if (valueKey !== undefined) {
      for (const row of data) { maxValue = Math.max(maxValue, finite(row[valueKey])); }
    }
    const radiusOf = (row: SpatialRow): number =>
      valueKey === undefined || maxValue <= 0 ? maxRadius : Math.max(2, Math.sqrt(Math.max(0, finite(row[valueKey])) / maxValue) * maxRadius);
    const features: Feature<Point, MarkerProperties>[] = [];
    for (const [index, row] of data.entries()) {
      const at = lonLatOf(row, longitudeKey, latitudeKey);
      if (at !== null) {
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: { row, index, r: radiusOf(row) } });
      }
    }
    features.sort((a, b) => b.properties.r - a.properties.r);
    const color = markers?.color ?? "var(--chart-1)";

    look.ocean = { fill: sphere?.fill ?? "var(--chart-scale-01)", stroke: sphere?.stroke ?? "var(--border)" };
    look.land = geography !== undefined && land !== undefined ? { fill: land.fill ?? "var(--chart-scale-02)", stroke: land.stroke ?? "var(--chart-scale-01)", strokeWidth: land.strokeWidth ?? 0.5 } : null;
    look.geography = geography ?? null;
    look.graticule = graticule === undefined ? null : { step: graticule.step ?? [20, 20], stroke: graticule.stroke ?? "var(--chart-graticule)", strokeWidth: graticule.strokeWidth ?? 0.5 };
    look.markers = markers === undefined ? null : { features, color };
    // Loading: the disc in the sphere's place, the graticule over it, a few markers on top.
    const skeleton: SpatialSkeletonLayer[] = [];
    const marks: AnyMark[] = [];
    if (loading) {
      const disc = spatialSkeleton(SKELETON_DISC_ID, discSkeleton(holder, land === undefined ? undefined : geography), { pulse: "breathe", low: 0.55, stagger: 200 });
      marks.push(disc.mark);
      skeleton.push(disc.layer);
    } else {
      marks.push(sphereLayer(holder, look.ocean.fill, look.ocean.stroke));
    }
    if (graticule !== undefined) {
      marks.push(graticuleLayer(holder, graticule));
    }
    if (geography !== undefined && land !== undefined && !loading) {
      marks.push(landLayer(geography, holder, look.land ?? {}));
    }
    if (markers !== undefined && loading) {
      const dots = spatialSkeleton(SKELETON_MARKERS_ID, markerSkeleton(holder, maxRadius), { low: 0.3 });
      marks.push(dots.mark);
      skeleton.push(dots.layer);
    } else if (markers !== undefined) {
      marks.push(geoShape(erase(features), erase({
        id: MARKERS_ID,
        projection: projectionOption(holder),
        key: (feature: Feature<Point, MarkerProperties>) => feature.properties.index,
        r: (feature: Feature<Point, MarkerProperties>) => feature.properties.r,
        fill: color,
        stroke: "var(--chart-background)",
        strokeWidth: 1.5,
        anchor: (feature: Feature<Point, MarkerProperties>) => feature.geometry.coordinates,
        motion: false,
      })));
    }
    const focusMarks = new Set([MARKERS_ID]);
    // SAFETY: every focused point is a marker's (geoFocus keeps MARKERS_ID's only), whose datum is its feature.
    const featureOf = (point: ChartPoint): Feature<Point, MarkerProperties> => point.datum as Feature<Point, MarkerProperties>;
    const definition = defineChart(erase({
      marks,
      scales: { x: null, y: null },
      margin: { top: 0, right: 0, bottom: 0, left: 0, ...props.margin },
      theme: bklitTheme,
      focus: geoFocus(focusMarks, (points, x, y) => nearestWithin(points, x, y, maxRadius + 6)),
      maxFocusDistance: maxRadius + 6,
      focusRing: false,
      tooltip: spatialTooltipOption(hasTooltip && !loading),
    }));

    const entrance: SpatialEntrance[] = [{ markId: SPHERE_ID, kind: "grow", fromScale: 0.92, duration: 700 }];
    if (geography !== undefined && land !== undefined) {
      entrance.push({ markId: LAND_ID, kind: "fade", delay: 150, duration: 600 });
    }
    if (markers !== undefined) {
      entrance.push({ markId: MARKERS_ID, kind: "grow", fromScale: 0, delay: 450, duration: 450 });
    }
    return {
      definition,
      aspectRatio,
      describeData: () => describePlaces("Globe", data, { name: nameKey, longitude: longitudeKey, latitude: latitudeKey, value: valueKey }, propsFor<SpatialTip>(table, GLOBE_ROLES.tooltip).at(-1)?.valueLabel, propsFor<SpatialTip>(table, GLOBE_ROLES.tooltip).at(-1)?.formatValue),
      ariaLabel: props.ariaLabel ?? "Globe",
      ariaDescription: props.ariaDescription,
      hoverLayers: markers !== undefined && markers.fadeOnHover !== false ? [{ markId: MARKERS_ID, inactiveOpacity: markers.inactiveOpacity ?? 0.35, fade: features.length <= SPATIAL_FADE_LIMIT }] : [],
      focusMarks,
      lift: (point) => el("circle", { cx: point.x, cy: point.y, fill: color, r: featureOf(point).properties.r * 1.35, stroke: "var(--chart-foreground)", "stroke-width": 1.5 }),
      entrance,
      skeleton,
      hostVars: {},
      hostAttrs: {},
      legend: null,
      describe: hasTooltip
        ? (points, carrier) => {
            const point = points.at(0);
            if (point === undefined || point.markId !== MARKERS_ID) {
              return undefined;
            }
            // SAFETY: the tooltip carrier's props are GlobeTooltipProps.
            const tooltip = carrier as GlobeTooltipProps<unknown, unknown>;
            const { row, index } = featureOf(point).properties;
            const format = tooltip.formatValue ?? formatSpatialValue;
            return {
              args: { marker: row, index },
              title: String(row[nameKey] ?? ""),
              rows: valueKey === undefined ? [] : [{ color, label: tooltip.valueLabel ?? valueKey, value: format(finite(row[valueKey])) }],
            };
          }
        : null,
      drag: props.draggable === false ? null : drag,
    };
  };
};

/** The globe family for the spatial controller. */
export const GLOBE_FAMILY: SpatialFamily<GlobeProps> = {
  chart: "globe",
  css: "",
  definitionRoles: [GLOBE_ROLES.sphere, GLOBE_ROLES.land, GLOBE_ROLES.graticule, GLOBE_ROLES.markers],
  tooltipRole: GLOBE_ROLES.tooltip,
  definitionProps: ["data", "geography", "center", "draggable", "longitudeKey", "latitudeKey", "nameKey", "aspectRatio", "margin", "revealSignature", "ariaLabel", "ariaDescription"],
  keys: ["data", "geography", "center", "draggable", "longitudeKey", "latitudeKey", "nameKey", ...SPATIAL_BASE_KEYS],
  createBuilder: createGlobeBuilder,
};
