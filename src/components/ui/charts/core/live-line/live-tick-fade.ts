import { typedAttr } from "../css-hooks";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import { CLS, NOT_MOTION } from "../renderer-dom";

/** `--bkm-fx` (focus x) and `--bkm-pgx` / `--bkm-pgy` (crosshair spring lag, UPSTREAM-GAPS #43) change every pointer move and spring frame, on the line's surface (a keyboard
 * focus's `--bkm-fx` is the host's rule below). Inherited, each write restyled 122 elements (0.77 ms); registered `inherits: false` (0.04 ms), they reach their readers
 * (liveline.css) through an explicit `inherit` down the path of documented host/surface and part classes (gap #36) and live-xlabels.ts's class.
 * Each var is inherited only down the path to its own readers: the line's host box, surface and svg (not the y labels' chart beside them), then the focus guide for the
 * glide's lag and the x labels for the focus x, so a spring frame never restyles the x labels nor a move's x the guide (a surface write: 59 elements, now 30 for the lag
 * and 45 for the x; a keyboard-held x on the host leaves the y labels' chart alone). Selector lists, so each rule is bucketed by its subject's class. */
const LIVE = '[data-bkm-chart="liveline"]';
const LINE_BOX = `${LIVE} > .ts-chart-host`;
const inside = (classes: readonly string[]): string => classes.map((part) => `${LIVE} ${part}`).join(",");
const FOCUS_VARS_CSS =
  /* @__PURE__ */ (() => '@property --bkm-fx{syntax:"<number>";inherits:false;initial-value:-9999}' +
  '@property --bkm-pgx{syntax:"<number>";inherits:false;initial-value:0}' +
  '@property --bkm-pgy{syntax:"<number>";inherits:false;initial-value:0}' +
  `${LINE_BOX},${LINE_BOX} > .ts-chart-surface,${LINE_BOX} > .ts-chart-surface > svg.ts-chart{--bkm-fx:inherit;--bkm-pgx:inherit;--bkm-pgy:inherit}` +
  `${/* @__PURE__ */ inside([CLS.guideLayer, CLS.crosshair, CLS.crosshairPlot, ".bkm-live-rule", CLS.crosshairLabelX, CLS.crosshairMarker])}{--bkm-pgx:inherit;--bkm-pgy:inherit}` +
  `${/* @__PURE__ */ inside([".bkm-live-xlabels", "text.bkm-live-xlabel"])}{--bkm-fx:inherit}`)();
/** bklit LiveXAxis labelFadeOpacity: 0 within 50px of the crosshair, a linear ramp over the next 20px, 0.15s easeOut (the snappy variant: the hover profile); one static rule on the slot's typed `x` vs `--bkm-fx`, inline (the CSS pipeline rewrites `type(<number>)`).
 * Keyboard focus rides the roll via `--bkm-kx` / `--bkm-fxr` / `--bkm-pl` / `--bkm-kslide` (`data-bkm-kedge`). The slide runs only while a key holds focus (--bkm-fxd rewinds a start mid-roll); a pointer focus never reads it. Typed attr() is Chromium-only (133+): under `@supports`, else labels stay visible. */
export const TICK_FADE_CSS = /* @__PURE__ */ [
  /* @__PURE__ */ typedAttr(`[data-bkm-chart="liveline"] text.bkm-live-xlabel${NOT_MOTION}{opacity:clamp(0,calc((abs(attr(x type(<number>)) - var(--bkm-fx,-9999)) - 50) / 20),1)!important;transition:opacity ${HOVER_TRANSITION_CSS}}`),
  `@property --bkm-fxr{syntax:"<number>";inherits:false;initial-value:0}`,
  `@keyframes bkm-fxr0{from{--bkm-fxr:var(--bkm-live-shift,0)}to{--bkm-fxr:0}}@keyframes bkm-fxr1{from{--bkm-fxr:var(--bkm-live-shift,0)}to{--bkm-fxr:0}}`,
  `[data-bkm-chart="liveline"][data-bkm-kfx][data-bkm-roll="0"]{animation:bkm-fxr0 var(--bkm-live-roll,600ms) var(--bkm-live-roll-ease,linear) var(--bkm-fxd,0ms) both}`,
  `[data-bkm-chart="liveline"][data-bkm-kfx][data-bkm-roll="1"]{animation:bkm-fxr1 var(--bkm-live-roll,600ms) var(--bkm-live-roll-ease,linear) var(--bkm-fxd,0ms) both}`,
  `[data-bkm-chart="liveline"][data-bkm-kfx]{--bkm-fx:max(var(--bkm-pl,-9999), calc(var(--bkm-kx) + var(--bkm-fxr)))}`,
  `[data-bkm-chart="liveline"][data-bkm-kfx][data-bkm-jump]{--bkm-fx:calc(max(var(--bkm-pl,-9999), var(--bkm-kx)) + var(--bkm-fxr))}`,
  `[data-bkm-chart="liveline"][data-bkm-kfx][data-bkm-jump][data-bkm-kedge]{--bkm-fx:max(var(--bkm-pl,-9999), calc(var(--bkm-kx) + var(--bkm-fxr)))}`,
  FOCUS_VARS_CSS,
].join("");
