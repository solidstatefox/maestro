const attr = (op: string, key: string): string => `[data-ts-key${op}="${key}"]`;
export const keyIs = (key: string): string => attr("", key);
export const keyStarts = (prefix: string): string => attr("^", prefix);
export const keyEnds = (suffix: string): string => attr("$", suffix);
export const keyHas = (part: string): string => attr("*", part);

export const CLS = {
  marks: ".ts-chart__marks",
  area: ".ts-chart__area",
  rect: ".ts-chart__rect",
  text: ".ts-chart__text",
  link: ".ts-chart__link",
  dot: ".ts-chart__dot",
  focusLayer: ".ts-chart__focus-layer",
  guideLayer: ".ts-chart__focus-guide-layer",
  crosshair: ".ts-chart__crosshair",
  crosshairPlot: ".ts-chart__crosshair-plot",
  crosshairMarker: ".ts-chart__crosshair-marker",
  crosshairLabelX: ".ts-chart__crosshair-label--x",
  /** The root of a Canvas surface (@tanstack/charts/canvas): the marks drawn with `renderer={canvasRenderer}`, as one element. */
  canvas: ".ts-chart-canvas",
} as const;

/** Class (no dot) of a focus-guide group. Core's motion timing finds guide nodes with `closest('g.ts-chart__crosshair')`, so our own guide groups must carry it (#36). */
export const CROSSHAIR_CLASS = /* @__PURE__ */ CLS.crosshair.slice(1);

/** Skips a node the renderer is mid-tween on (#50). */
export const NOT_MOTION = ":not([data-ts-motion-role])";

/** True when the renderer is mid-tween on `el` (#50). */
export const isMotionNode = (el: Element): boolean => el.hasAttribute("data-ts-motion-role");

/** The renderer-owned layers that the ready and focus gates hide: the focus layer and the focus-guide layer. */
export const FOCUS_LAYERS = /* @__PURE__ */ (() => `${CLS.focusLayer},${CLS.guideLayer}`)();
