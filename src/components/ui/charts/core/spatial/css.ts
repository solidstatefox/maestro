import { keyIs } from "../renderer-dom";
import type { SpatialHoverLayer } from "./family";

/** On every spatial chart's host. */
export const SPATIAL_HOST_ATTR = "data-bkm-sp";

const S = `[${SPATIAL_HOST_ATTR}]`;

/** The rules every spatial chart shares: the tooltip, the lift, the marks' entrance origin, the hover fade, the drag, the legend and the
 * loading state. */
export const SPATIAL_CSS = /* @__PURE__ */ [
  `${S} .ts-chart-tooltip.bkm-sp-tooltip{font-family:inherit!important}`,
  // The renderer's svg and the lift overlay share one box.
  `${S} .ts-chart-surface{position:relative}`,
  `${S} .bkm-sp-lift{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}`,
  `${S} .bkm-sp-lift>*{transform-box:fill-box;transform-origin:center;animation:bkm-sp-pop var(--bkm-hover-dur) var(--bkm-hover-ease)}`,
  "@keyframes bkm-sp-pop{from{transform:scale(.8);opacity:.5}}",
  // Entrances scale each element about its own center (entrance.ts).
  `${S} .ts-chart__marks>g>:not(defs){transform-box:fill-box;transform-origin:center}`,
  `${S}[data-bkm-drag-on]{cursor:grab;touch-action:none}`,
  `${S}[data-bkm-drag]{cursor:grabbing}`,
  `${S}[data-bkm-drag] .bkm-sp-lift{display:none}`,
  // The family's own drag frames (controller.ts) over the hidden marks.
  `${S} .bkm-sp-drag{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}`,
  `${S}[data-bkm-drawing] svg.ts-chart .ts-chart__marks{visibility:hidden}`,
  // The legend row under the plot: the cartesian legends' type.
  `${S} .bkm-sp-legend{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 14px;margin-top:12px;font-size:12px;line-height:16px;color:var(--chart-label)}`,
  `${S} .bkm-sp-legend[data-align="start"]{justify-content:flex-start}`,
  `${S} .bkm-sp-legend[data-align="end"]{justify-content:flex-end}`,
  `${S} .bkm-sp-legend-title{font-weight:500;color:var(--chart-foreground)}`,
  `${S} .bkm-sp-legend-item{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;white-space:nowrap}`,
  `${S} .bkm-sp-legend-swatch{width:12px;height:12px;border-radius:3px}`,
  `${S} .bkm-sp-legend-dot{width:8px;height:8px;border-radius:999px}`,
  `${S} .bkm-sp-legend-ramp{width:120px;height:8px;border-radius:999px}`,
  `${S} .bkm-sp-legend-bubble{border-radius:999px;opacity:.75}`,
  // The loading state (loading.ts): the pointer passes through the plot, the legend keeps its room but shows nothing, a drag chart shows
  // no grab cursor; the label's box sits over the surface.
  `${S}[data-bkm-status="loading"] .ts-chart-host{pointer-events:none}`,
  `${S}[data-bkm-status="loading"] .bkm-sp-legend{visibility:hidden}`,
  `${S}[data-bkm-status="loading"][data-bkm-drag-on]{cursor:auto}`,
  // Loading -> ready (loading.ts): the renderer's fade-in of the marks it adds (their group's `opacity` attribute, while it tweens) held
  // off, so they enter by the family's entrance alone, as on a first mount; the skeleton it fades out is left to fade.
  `${S}[data-bkm-entering] .ts-chart__marks>g[data-ts-motion-role]:not([data-ts-key^="skeleton-"]){opacity:1}`,
  `${S} .bkm-sp-loading{position:absolute;top:0;left:0;width:100%;pointer-events:none;z-index:1}`,
].join("");

/** The hover dim of one chart: while a point of a hover layer is focused, each layer's group fades to its opacity. A filter, not
 * `opacity`: a group opacity over translucent oklch fills (the contour bands) composites in the wrong colors in Chromium's software
 * rasteriser, `filter: opacity()` does not. */
export const hoverCss = (uid: string, layers: readonly SpatialHoverLayer[]): string =>
  layers.map((layer) => {
    const group = `.ts-chart__marks>g${keyIs(layer.markId)}`;
    const fade = layer.fade ? `${S}[data-bkm-kit="${uid}"] ${group}{transition:filter var(--bkm-hover-dur) var(--bkm-hover-ease)}` : "";
    return `${fade}${S}[data-bkm-kit="${uid}"][data-bkm-hover] ${group}{filter:opacity(${layer.inactiveOpacity})}`;
  }).join("");
