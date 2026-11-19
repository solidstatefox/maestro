import { isMotionNode } from "../renderer-dom";
import { springDriver } from "../motion/spring-animate";
import { HOVER_SPRING } from "../motion/springs";
import { HOVER_SCALE_DELTA, MAX_SERIES } from "./hover-css";

// Groups are queried by our own documented `className` (radar/definition.ts:199,216) and sprung with WAAPI (gaps #20/#36: no transform
// channel in `states`); a mid-tween node keeps its tween (#50).
const targetOf = (series: number, hovered: number | null): number => (series === hovered ? HOVER_SCALE_DELTA : 0);

const springSeries = (host: HTMLElement, series: number, previous: number | null, next: number | null): void => {
  const rest = targetOf(series, previous);
  const target = targetOf(series, next);
  if (rest === target) { return; }
  // The area group's entrance is a native tween on its transform (role marker present): the spring only runs once that is gone.
  const area = host.querySelector(`g.bkm-radar-area.bkm-radar-s${series}`);
  if (area !== null && !isMotionNode(area)) {
    springDriver.play({ affine: true, el: area, frame: (value) => ({ transform: `scale(${1 + value})` }), rest, spring: HOVER_SPRING, target });
  }
  const dots = host.querySelector(`g.bkm-radar-dot.bkm-radar-s${series}`);
  if (dots !== null) {
    springDriver.play({ affine: true, el: dots, frame: (value) => ({ transform: `scale(${1 + value})` }), rest, spring: HOVER_SPRING, target });
  }
};

/** Retargets the previous and the new hovered series' area and dot groups from their live scale and velocity. */
const springRadarHover = (host: HTMLElement, previous: number | null, next: number | null): void => {
  for (const series of new Set([previous, next])) {
    if (series !== null && series < MAX_SERIES) { springSeries(host, series, previous, next); }
  }
};

export { springRadarHover };
