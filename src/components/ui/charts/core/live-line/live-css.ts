import { settleFrames, FRAME_MS } from "./head-ease";
import { typedAttr } from "../css-hooks";

const SCOPE = '[data-bkm-chart="liveline"]';
export const settleMs = (lerp: number): number => Math.round(settleFrames(lerp) * FRAME_MS);

/** Clip widened by `--bkm-live-ext` (tail + tip clearance); the grid's rows and the reference bands ride the path's y reprojection from its
 * start (Frame.roll; a parity class restarts it each tick, the nodes persist). The tail, the tip and its pulse ring move on the head
 * clock (live-head.ts). */
export function liveCss(): string {
  const rules: string[] = [
    // Typed attr() is Chromium-only (133+); unguarded, `width:auto` overrides the rect's width and collapses the clip (the plot vanishes).
    // Under `@supports` other browsers clip at the native width.
    typedAttr(`${SCOPE} clipPath rect{width:calc(attr(width type(<number>),0) * 1px + var(--bkm-live-ext,0px))}`),
  ];
  for (const parity of [0, 1]) {
    // The roll's clock: linear in steady state, the intro easing on the first roll (the path's own tween easing either way).
    const roll = "var(--bkm-live-roll,600ms) var(--bkm-live-roll-ease,linear)";
    // y: the path's y start on the same clock (gap #33: the rolling path reprojects y over the whole roll).
    rules.push(
      `@keyframes bkm-rp${parity}{from{transform:translate(0,var(--bkm-live-ry-t,0px)) scale(1,var(--bkm-live-ry-s,1))}to{transform:translate(0,0) scale(1,1)}}`,
      `${SCOPE} .bkm-tp${parity} .bkm-live-rp{transform-box:view-box;transform-origin:0 0;animation:bkm-rp${parity} ${roll}}`,
      `${SCOPE} .bkm-tp${parity} .bkm-live-rp :is(path,polyline){vector-effect:non-scaling-stroke}`,
    );
  }
  return rules.join("\n");
}
