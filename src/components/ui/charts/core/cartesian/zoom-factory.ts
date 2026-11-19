import type { createZoomGestures, writeZoomPreview } from "./zoom";

export interface ZoomFeature {
  readonly gestures: typeof createZoomGestures;
  readonly preview: typeof writeZoomPreview;
}

let feature: ZoomFeature | undefined;

export const registerZoom = (next: ZoomFeature): void => {
  feature = next;
};

export const getZoom = (): ZoomFeature | undefined => feature;
