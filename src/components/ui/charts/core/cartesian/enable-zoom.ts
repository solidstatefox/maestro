import { createZoomGestures, writeZoomPreview } from "./zoom";
import { registerZoom } from "./zoom-factory";

export const enableZoom = (): void => {
  registerZoom({ gestures: createZoomGestures, preview: writeZoomPreview });
};
