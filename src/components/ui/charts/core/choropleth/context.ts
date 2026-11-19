import { geoPath } from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import type { ChartBounds } from "@tanstack/charts";
import type { FeatureCollection, Geometry } from "geojson";
import type { ReadyStore } from "../entrance/ready-gate";
import { memoCell } from "../memo";
import type { EnterTransition } from "../motion/phase";
import type { ChoroplethSize } from "./feature-hover";
import { tooltipSetter } from "./hover-store";
import type { ChoroplethTooltipSetter } from "./hover-store";
import { makeProjection } from "./projection";
import type { ZoomTransform } from "./zoom";
import type { ChoroplethContextValue, ChoroplethFeatureProperties, HoverStore, Margin } from "../types/choropleth";

/** Everything `useChoropleth()` returns, with the framework's container ref. */
export type ChoroplethContext<ContainerRef> = ChoroplethContextValue<ContainerRef, ChoroplethTooltipSetter>;

const EMPTY_COLLECTION: FeatureCollection<Geometry, ChoroplethFeatureProperties> = { features: [], type: "FeatureCollection" };

/** What `useChoropleth()` returns outside a chart: empty defaults. */
export const CHOROPLETH_CONTEXT_DEFAULT: ChoroplethContext<{ current: HTMLDivElement | null }> = {
  animationDuration: 0,
  containerRef: { current: null },
  featureCollection: EMPTY_COLLECTION,
  featurePaths: [],
  features: [],
  height: 0,
  hoveredFeatureIndex: null,
  innerHeight: 0,
  innerWidth: 0,
  isLoaded: false,
  margin: { bottom: 0, left: 0, right: 0, top: 0 },
  markerTooltip: null,
  pathGenerator: (): string | undefined => undefined,
  projectPoint: () => null,
  rawPathGenerator: () => null,
  revealEpoch: 0,
  setHoveredFeatureIndex: (): void => undefined,
  setTooltipData: (): void => undefined,
  tooltipData: null,
  unprojectPoint: () => null,
  width: 0,
};

interface ChoroplethContextInput<ContainerRef> {
  readonly containerRef: ContainerRef;
  readonly data: FeatureCollection<Geometry, ChoroplethFeatureProperties>;
  readonly margin: Margin;
  readonly center: [number, number];
  readonly scale: number | undefined;
  readonly translate: [number, number] | undefined;
  /** The size the renderer measured (feature-hover.ts `onSize`). */
  readonly size: ChoroplethSize;
  /** The zoom layer's transform (zoom.ts `onTransform`). */
  readonly transform: ZoomTransform;
  readonly animationDuration: number;
  readonly enterTransition: EnterTransition | undefined;
  readonly epoch: number;
  readonly ready: ReadyStore;
  readonly hoverStore: HoverStore;
  readonly setHoveredFeatureIndex: (index: number | null) => void;
}

/** One builder per chart, fed on every read: the hover slice is left at rest (`withHover` fills it per reader). */
export function createChoroplethContext<ContainerRef>(): (input: ChoroplethContextInput<ContainerRef>) => ChoroplethContext<ContainerRef> {
  const cell = memoCell<ChoroplethContext<ContainerRef>>();
  return (input) => {
    const { animationDuration, center, containerRef, data, enterTransition, hoverStore, ready, epoch, margin, scale, setHoveredFeatureIndex, size, transform, translate } = input;
    return cell([animationDuration, center, containerRef, data, enterTransition, hoverStore, ready, epoch, margin, scale, setHoveredFeatureIndex, size, transform, translate], () => {
      const bounds: ChartBounds = { height: size.height - margin.top - margin.bottom, width: size.width - margin.left - margin.right, x: margin.left, y: margin.top };
      const projection = makeProjection(bounds, { center, k: transform.k, scale, translate, tx: transform.x, ty: transform.y });
      const path = geoPath(projection);
      const raw = (geo: GeoPermissibleObjects): string | null => path(geo);
      const projectPoint = (coords: [number, number]): [number, number] | null => {
        const p = projection(coords);
        return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null;
      };
      let featurePaths: (string | null)[] | undefined = undefined;
      return {
        animationDuration,
        containerRef,
        enterTransition,
        featureCollection: data,
        get featurePaths() { return (featurePaths ??= data.features.map(raw)); },
        features: data.features,
        height: size.height,
        hoveredFeatureIndex: null,
        hoverStore,
        innerHeight: Math.max(0, bounds.height),
        innerWidth: Math.max(0, bounds.width),
        isLoaded: false,
        margin,
        markerTooltip: null,
        pathGenerator: (feature) => raw(feature) ?? undefined,
        projectPoint,
        readyStore: ready,
        rawPathGenerator: raw,
        revealEpoch: epoch,
        setHoveredFeatureIndex,
        setTooltipData: tooltipSetter(hoverStore),
        tooltipData: null,
        unprojectPoint: (point) => {
          const p = projection.invert?.(point);
          return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null;
        },
        width: size.width,
      };
    });
  };
}

/** A reader's context: `ctx` with the hovered feature and tooltip the hover store holds now and the ready gate's flag (`loaded`); `ctx` itself outside a chart. */
export const withHover = <Ctx extends ChoroplethContextValue<unknown, ChoroplethTooltipSetter>>(ctx: Ctx, loaded: boolean): Ctx => {
  const store = ctx.hoverStore;
  if (!store) {return ctx;}
  return {
    ...ctx,
    hoveredFeatureIndex: store.hovered,
    isLoaded: loaded,
    markerTooltip: store.marker,
    setTooltipData: tooltipSetter(store),
    tooltipData: store.tooltip,
  };
};
