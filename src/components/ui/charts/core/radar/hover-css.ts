import { HOVER_TRANSITION_CSS } from "../motion/springs";
import { NOT_MOTION } from "../renderer-dom";

export const MAX_SERIES = 12;
/** Interactive labels carry one rule per metric up to this count. */
const MAX_METRICS = 24;
const HOVER_SCALE_DELTA = 0.05;
const DIM_OPACITY = 0.3;
const GLOW_BLUR_PX = 12;
const LABEL_INTERACTIVE = "g.bkm-radar-label-i";
const HOST = "[data-bkm-radar]";
// Series groups carry the radialArea/radialDot `className` set in radar/definition.ts (reference/marks/polar.md).
const SERIES_GROUPS = "g.bkm-radar-area,g.bkm-radar-dot";
const AREA_GROUPS = "g.bkm-radar-area";
const DOT_GROUPS = "g.bkm-radar-dot";

const radarHoverCss = (): string => {
  let css = "";
  for (let series = 0; series < MAX_SERIES; series += 1) {
    const area = `g.bkm-radar-area.bkm-radar-s${series}`;
    css += `${HOST}[data-hover="${series}"] :is(${area},g.bkm-radar-dot.bkm-radar-s${series}){--bkm-h:1}`;
    css += `${HOST}[data-bkm-glow][data-hover="${series}"] ${area} path{filter:drop-shadow(0 0 ${GLOW_BLUR_PX}px var(--bkm-radar-glow))}`;
  }
  // Hover scale waits for the native entrance tween (role marker, no public hook: UPSTREAM-GAPS #36) and then scales about the fill-box centre.
  css += `${HOST} :is(${SERIES_GROUPS})${NOT_MOTION}{transform-box:fill-box;transform-origin:50% 50%}`;
  css += `${HOST} ${AREA_GROUPS}${NOT_MOTION}{transform:scale(calc(1 + ${HOVER_SCALE_DELTA} * var(--bkm-h,0)))}`;
  css += `${HOST} ${DOT_GROUPS}{transform:scale(calc(1 + ${HOVER_SCALE_DELTA} * var(--bkm-h,0)))}`;
  // The dim: bklit 150ms ease-out; the snappy variant: the hover profile.
  css += `${HOST} :is(${SERIES_GROUPS})${NOT_MOTION}{transition:opacity ${HOVER_TRANSITION_CSS}}`;
  css += `${HOST}[data-hover] :is(${SERIES_GROUPS}){opacity:calc(1 - ${1 - DIM_OPACITY} * (1 - var(--bkm-h,0)))}`;
  // Interactive axis labels (bklit `transition-opacity duration-150 cursor-pointer`): the label colour at rest (bklit's 0.8 read 3.2:1),
  // the foreground under the pointer, a CSS fill transition (bklit 150ms; the snappy variant's hover profile).
  css += `${HOST} ${LABEL_INTERACTIVE}{cursor:pointer}`;
  css += `${HOST} ${LABEL_INTERACTIVE} text${NOT_MOTION}{transition:fill ${HOVER_TRANSITION_CSS}}`;
  // The label under the pointer (the host's `data-bkm-label`, hover.ts): full strength.
  for (let metric = 0; metric < MAX_METRICS; metric += 1) {
    css += `${HOST}[data-bkm-label="${metric}"] ${LABEL_INTERACTIVE} text:nth-child(${metric + 1}){fill:var(--bkm-foreground)}`;
  }
  css += `${HOST} ${AREA_GROUPS} path{fill-opacity:calc(.15 + .2 * var(--bkm-h,0));stroke-width:calc(2px + 1px * var(--bkm-h,0))}`;
  css += `${HOST} ${DOT_GROUPS} circle{r:calc(4px + 2px * var(--bkm-h,0))}`;
  return css;
};

export { HOVER_SCALE_DELTA };
export const RADAR_HOVER_CSS = /* @__PURE__ */ radarHoverCss();
