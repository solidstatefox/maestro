import { cubicBezier } from "../motion/easing";

// bklit sunburst zoom (750ms) curve; the sweep uses the shared reveal curve.
export const ZOOM_EASING = /* @__PURE__ */ cubicBezier(0.22, 1, 0.36, 1);
export const ZOOM_MS = 750;
