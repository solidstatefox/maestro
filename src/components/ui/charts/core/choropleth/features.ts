import type { Backdrop } from "./backdrop";
import type { DotGrid } from "./dots";
import type { Markers } from "./markers";

interface ChoroplethLayers {
  dots?: () => DotGrid;
  markers?: () => Markers;
  backdrop?: () => Backdrop;
}

const layers: ChoroplethLayers = {};

export const registerChoroplethDots = (create: () => DotGrid): void => { layers.dots = create; };
export const registerChoroplethMarkers = (create: () => Markers): void => { layers.markers = create; };
export const registerChoroplethBackdrop = (create: () => Backdrop): void => { layers.backdrop = create; };

/** The registered layer's factory, or undefined (its carrier was never used). */
export const choroplethLayer = <K extends keyof ChoroplethLayers>(name: K): ChoroplethLayers[K] => layers[name];
