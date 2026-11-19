import { groupMarkerItems } from "../cartesian/overlays";
import { isMotionNode } from "../renderer-dom";
import { springDriver } from "./spring-animate";
import { MARKER_ACT_SPRING, MARKER_BADGE_SPRING, MARKER_BODY_SPRING, MARKER_ITEM_SPRING } from "./springs";
import type { Spring } from "./springs";
import type { ChartMarker } from "../types/cartesian";

const ACT_HOVER_SCALE = 1.15;
const ACT_PRESS_SCALE = 0.95;
const ITEM_STAGGER_MS = 40;
const GROUP = ".bkm-evt-cluster";

/** Milliseconds left before the body's CSS entrance starts (0 once it has started or ended). */
const entranceLeftMs = (body: Element): number => {
  let left = 0;
  for (const animation of body.getAnimations()) {
    if (animation instanceof CSSAnimation) { left = Math.max(left, Number(animation.effect?.getTiming().delay ?? 0) - Number(animation.currentTime ?? 0)); }
  }
  return left;
};

const play = (el: Element, spring: Spring, hot: boolean, frame: (value: number) => Keyframe, delay = 0): void => {
  // An element the native renderer is tweening keeps that tween; the static rule applies once the marker is gone.
  if (isMotionNode(el)) { return; }
  springDriver.play({ delay, el, frame, rest: 0, spring, target: hot ? 1 : 0 });
};

const springCluster = (group: Element, hot: boolean): void => {
  const body = group.querySelector(".bkm-evt-body");
  if (body !== null) {
    // bklit delays every hover change of the body by the group's entrance delay (animationDuration + groupIndex * 100ms), over a second after the entrance.
    // Snappy variant: only what is left of it while the entrance has yet to start, so a hover after the entrance fans the body at once.
    play(body, MARKER_BODY_SPRING, hot, (v) => ({ filter: `blur(${Math.max(0, 2 * v)}px)`, opacity: String(1 - v), transform: `scale(${1 - 0.4 * v})` }), entranceLeftMs(body));
  }
  const badge = group.querySelector(".bkm-evt-badge");
  if (badge !== null) { play(badge, MARKER_BADGE_SPRING, hot, (v) => ({ opacity: String(1 - v), transform: `scale(${1 - v})` })); }
  const core = group.querySelector(".bkm-evt-core");
  if (core !== null) { play(core, MARKER_BADGE_SPRING, hot, (v) => ({ opacity: String(0.5 * v), transform: `scale(${v})` })); }
  for (const [k, item] of [...group.querySelectorAll(".bkm-evt-item")].entries()) {
    play(item, MARKER_ITEM_SPRING, hot, (v) => ({ opacity: String(v), transform: `scale(${v})` }), k * ITEM_STAGGER_MS);
  }
};

const clusterOf = (node: EventTarget | null): Element | null => (node instanceof Element ? node.closest(GROUP) : null);

const ACT = ".bkm-evt-act";
const actOf = (node: EventTarget | null): Element | null => (node instanceof Element ? node.closest(ACT) : null);
// Disc shadow as two blurred circles (styles.css `.bkm-evt-sh*`): tailwind shadow-lg at rest, bklit's whileHover "0 4px 20px rgba(0,0,0,0.25)" hot.
// Per layer [spread, offset y, blur radius, alpha]; the circle's `r` is the rest radius, and the hot radius is that minus the rest spread.
const REST_SHADOW = [[-3, 10, 15, 0.1], [-4, 4, 6, 0.1]] as const;
const HOT_SHADOW = [[0, 4, 20, 0.25], [0, 0, 0, 0]] as const;
const SHADOW_LAYERS = [[".bkm-evt-sh1", 0], [".bkm-evt-sh2", 1]] as const;
const shadowFrame = (layer: 0 | 1, rest: number, t: number): Keyframe => {
  const [s0, y0, b0, a0] = REST_SHADOW[layer];
  const [s1, y1, b1, a1] = HOT_SHADOW[layer];
  const mix = (v0: number, v1: number): number => v0 + (v1 - v0) * t;
  return { cy: `${mix(y0, y1)}px`, fillOpacity: String(Math.max(0, mix(a0, a1))), filter: `blur(${Math.max(0, mix(b0, b1)) / 2}px)`, r: `${Math.max(0, rest - s0 + mix(s0, s1))}px` };
};

const actScale = (hover: boolean, pressed: boolean): number => {
  if (pressed) { return ACT_PRESS_SCALE; }
  return hover ? ACT_HOVER_SCALE : 1;
};

/** Springs an actionable disc to its hover / press state: scale 1 / 1.15 / 0.95 (press wins over hover, as motion's whileTap) and the shadow lift (hover only). */
const springAct = (act: Element, hover: boolean, pressed: boolean): void => {
  const scale = actScale(hover, pressed);
  springDriver.play({ el: act, frame: (v) => ({ transform: `scale(${v})` }), rest: 1, spring: MARKER_ACT_SPRING, target: scale });
  for (const [sel, layer] of SHADOW_LAYERS) {
    const sh = act.querySelector(sel);
    if (sh instanceof SVGElement) {
      const rest = Number(sh.getAttribute("r"));
      // gaps #48 / #20: the radius is a renderer-set attribute and reconcile strips inline style, so the hot value is the `.bkm-evt-act:hover` rule in styles.css.
      springDriver.play({ el: sh, frame: (v) => shadowFrame(layer, rest, v), rest: 0, spring: MARKER_ACT_SPRING, target: hover ? 1 : 0 });
    }
  }
};

/** bklit MarkerCircleHTML.handleClick (marker-group.tsx:476-487): onClick wins, else href in this tab or (target "_blank") a new one with noopener,noreferrer. */
const runAction = (marker: Readonly<ChartMarker>): void => {
  if (marker.onClick !== undefined) {
    marker.onClick();
    return;
  }
  if (marker.href === undefined || marker.href === "") { return; }
  if (marker.target === "_blank") { window.open(marker.href, "_blank", "noopener,noreferrer"); }
  else { window.location.href = marker.href; }
};

// The actionable disc's documented `className` (SceneNodeBase.className, types.ts:1477-1486) carries its marker indices (core/cartesian/overlays.ts).
const ACT_INDEX = /(?:^|\s)bkm-evt-act-(\d+)-(\d+)-(\d+)(?:\s|$)/u;

/** Delegated cluster enter / leave and actionable-disc hover / press / click on the chart host (hover itself stays :hover CSS).
 * `getLists` returns the items of every ChartMarkers child, in order (the `mi` of the scene keys). Returns the cleanup. */
const installMarkerSprings = (host: HTMLElement, getLists: () => readonly (readonly Readonly<ChartMarker>[])[]): (() => void) => {
  let pressed: Element | null = null;
  const onOver = (event: MouseEvent): void => {
    const nextAct = actOf(event.target);
    const prevAct = actOf(event.relatedTarget);
    if (nextAct !== prevAct) {
      if (prevAct !== null) { springAct(prevAct, false, pressed === prevAct); }
      if (nextAct !== null) { springAct(nextAct, true, pressed === nextAct); }
    }
    const next = clusterOf(event.target);
    const previous = clusterOf(event.relatedTarget);
    if (next === previous) { return; }
    if (previous !== null) { springCluster(previous, false); }
    if (next !== null) { springCluster(next, true); }
  };
  // Leaving the host altogether fires no mouseover inside it.
  const onOut = (event: MouseEvent): void => {
    if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) { return; }
    const act = actOf(event.target);
    if (act !== null) { springAct(act, false, pressed === act); }
    const previous = clusterOf(event.target);
    if (previous !== null) { springCluster(previous, false); }
  };
  const onDown = (event: PointerEvent): void => {
    const act = actOf(event.target);
    if (act === null || event.button !== 0) { return; }
    pressed = act;
    springAct(act, true, true);
  };
  // motion's whileTap ends on the release anywhere, not on leaving the disc.
  const onUp = (): void => {
    const act = pressed;
    pressed = null;
    if (act !== null) { springAct(act, act.matches(":hover"), false); }
  };
  const onClick = (event: MouseEvent): void => {
    const act = actOf(event.target);
    const match = ACT_INDEX.exec(act?.getAttribute("class") ?? "");
    if (match === null) { return; }
    const marker = groupMarkerItems(getLists()[Number(match[1])] ?? [])[Number(match[2])]?.at(Number(match[3]));
    if (marker === undefined) { return; }
    event.stopPropagation();
    runAction(marker);
  };
  host.addEventListener("mouseover", onOver);
  host.addEventListener("mouseout", onOut);
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("click", onClick);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  return () => {
    host.removeEventListener("mouseover", onOver);
    host.removeEventListener("mouseout", onOut);
    host.removeEventListener("pointerdown", onDown);
    host.removeEventListener("click", onClick);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
  };
};

export { installMarkerSprings };
