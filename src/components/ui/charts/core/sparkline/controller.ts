import { REVEAL_EASING } from "../motion/easing";
import type { AnySparklineProps, SparklineSpringConfig } from "../types/sparkline";
import { DEFAULT_SPARKLINE_ANIMATION_DURATION_MS, DEFAULT_SPARKLINE_DATA_TRANSITION_MS, DEFAULT_SPARKLINE_HOVER_SPRING } from "./constants";
import {
  computeSparklineDomain,
  computeSparklineLayout,
  describeSparkline,
  interpolateSparklineLayout,
  resolveSparklineValues,
  sameSparklineShape,
  type SparklineLayout,
  type SparklineSlot,
  sparklineIndexAtX,
} from "./geometry";
import { SPARKLINE_LINE_DASH, sparklineDotAttrs, sparklineLook as lookOf, sparklinePaintKey as paintKey, sparklineStrokeAttrs } from "./look";
import type { SparklineKind } from "./look";
import { sparklineServerMarkup } from "./markup";
import { createSpring, observeWidth, onFrames } from "./motion";
import { sparklineAreaPath, sparklineBarSegment, sparklineBarsPath, sparklineBarWidth, sparklineLinePath } from "./paths";
import { formatNumber } from "../a11y/describe";

export { SPARKLINE_HEIGHT } from "./look";
export type { SparklineKind } from "./look";

export interface SparklineController<T = unknown> {
  /** The latest props (cheap when nothing that draws changed: a controlled `hoverIndex` only moves the hover). */
  update(props: AnySparklineProps<T>): void;
  /**
   * Draws into `host` and takes over its input; re-attachable after `detach`. The host is empty (the adapter's), or holds the svg
   * `prerender` wrote on the server, which is adopted as it is.
   */
  attach(host: HTMLElement): void;
  /** Removes what `attach` drew and its listeners (a server svg it adopted stays, at rest); the controller can attach again. */
  detach(): void;
  /**
   * The svg a fixed-width sparkline draws at rest, as markup for the server to write into the host (`""` without a fixed width);
   * `idPrefix` is the framework's hydration-stable id, so the server's and the hydrating client's markup are the same.
   */
  prerender(props: AnySparklineProps<T>, idPrefix: string): string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_EASING = "cubic-bezier(0.85, 0, 0.15, 1)";
/** The highlight band's spring (bklit's `highlightSpring`). */
const HIGHLIGHT_SPRING: SparklineSpringConfig = { stiffness: 180, damping: 28 };
const HIGHLIGHT_FADE: KeyframeAnimationOptions = { duration: 400, easing: "ease-in-out" };
const BAR_FADE: KeyframeAnimationOptions = { duration: 200, easing: "ease-in-out" };
const REDUCED_FADE: KeyframeAnimationOptions = { duration: 200, easing: "ease-out" };
const CROSSHAIR = "var(--chart-crosshair)";
const FADED = { opacity: 0 } as const;
const SHOWN = { opacity: 1 } as const;

/** z-order of what a sparkline draws: the series, the line's highlight, the end dot, the crosshair, the hover dot. */
const SERIES = 0;
const HIGHLIGHT = 1;
const END_DOT = 2;
const CROSS = 3;
const DOT = 4;

const svgEl = <K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] => document.createElementNS(SVG_NS, name);
const attrs = (el: Element, values: Readonly<Record<string, string | number>>): void => {
  for (const name in values) {
    el.setAttribute(name, String(values[name]));
  }
};

let reduceQuery: MediaQueryList | undefined;
const reducedMotion = (): boolean => {
  if (typeof matchMedia !== "function") {
    return false;
  }
  reduceQuery ??= matchMedia("(prefers-reduced-motion: reduce)");
  return reduceQuery.matches;
};

let idBase: string | undefined;
let idCount = 0;
/** A document-unique id for a sparkline's gradients and clip (drawn on the client only, so it never has to match a server's). */
const nextId = (): string => {
  idBase ??= Math.random().toString(36).slice(2, 7);
  idCount += 1;
  return `bkm-sp-${idBase}${idCount}`;
};

const now = (): number => performance.now();

/** Plays `keyframes` on `el`, or does nothing where Web Animations are missing (or the easing is invalid: then the default curve). */
const play = (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null => {
  if (typeof el.animate !== "function") {
    return null;
  }
  try {
    return el.animate(keyframes, options);
  } catch {
    try {
      return el.animate(keyframes, { ...options, easing: DEFAULT_EASING });
    } catch {
      return null;
    }
  }
};

const EMPTY: AnySparklineProps = { data: [], dataKey: () => Number.NaN };

const sameValues = (a: readonly number[], b: readonly number[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) {
      return false;
    }
  }
  return true;
};

export function createSparklineController<T>(kind: SparklineKind): SparklineController<T> {
  const slot: SparklineSlot = kind === "bar" ? "band" : "point";
  let props = EMPTY as AnySparklineProps<T>;
  let look = lookOf(kind, EMPTY);
  let values: number[] = [];
  let label = "";
  /** The host's name at rest (the reader's label, else the summary); `sayPoint` adds the keyboard's point to it. */
  let named = "";
  let labelOf: number[] | null = null;

  // --- The host and what is drawn in it ---------------------------------------------------------------------------------------------
  let host: HTMLElement | null = null;
  let unobserve: (() => void) | null = null;
  let observing = false;
  let listening = false;
  let width = 0;
  /** Where the host's content box starts inside its padding edge (the pointer's `offsetX` is from the padding edge). */
  let contentLeft = 0;
  let svg: SVGSVGElement | null = null;
  let svgWidth = 0;
  let svgHeight = 0;
  /** What the enter animates: the line path (line), the group (area, bars). The hover fades it (line, area) or the bars' path. */
  let series: SVGGraphicsElement | null = null;
  let linePath: SVGPathElement | null = null;
  let areaPath: SVGPathElement | null = null;
  let barsPath: SVGPathElement | null = null;
  let fillStops: [SVGStopElement, SVGStopElement] | null = null;
  let fillId = "";
  let painted = "";
  let entered = false;
  /** The svg is the server's (adopted on attach): `detach` leaves it in the host. */
  let adopted = false;
  /** What is in the svg now, by z-order (SERIES … DOT): only connected nodes. */
  const layers: (SVGElement | null)[] = [null, null, null, null, null];
  // The overlays, made on first use and kept (out of the svg while unused) until the look changes.
  let crossGroup: SVGGElement | null = null;
  let hoverDot: SVGCircleElement | null = null;
  let endDot: SVGCircleElement | null = null;
  let highlightGroup: SVGGElement | null = null;
  let highlightPath: SVGPathElement | null = null;
  let highlightRect: SVGRectElement | null = null;
  let focusBar: SVGPathElement | null = null;
  let focusIndex: number | null = null;

  // --- Geometry: the target layout and the one on screen (mid-morph) --------------------------------------------------------------
  let layout: SparklineLayout | null = null;
  let onScreen: SparklineLayout | null = null;
  let layoutKey = "";
  let layoutValues: number[] | null = null;
  let stopMorph: (() => void) | null = null;

  // --- Hover -----------------------------------------------------------------------------------------------------------------------
  /** The index shown (the controlled prop, or the pointer's). */
  let shown: number | null = null;
  /** The last index picked or shown: moves inside one slot are free. */
  let current: number | null = null;
  /** The pointer's or keyboard's index while uncontrolled. */
  let internal: number | null = null;
  let hoverDirty = false;
  /** The marks are on a point; the series is faded. */
  let marked = false;
  let faded = false;
  let keyboard = false;
  const crossX = createSpring(0);
  const dotY = createSpring(0);
  const bandX = createSpring(0);
  const bandW = createSpring(0);
  let springing = false;

  const hoverSpring = (): SparklineSpringConfig | null =>
    props.hoverTransition === false || reducedMotion() ? null : { ...DEFAULT_SPARKLINE_HOVER_SPRING, ...props.springConfig };

  const place = (el: SVGElement, rank: number): void => {
    if (layers[rank] === el || svg === null) {
      return;
    }
    layers[rank]?.remove();
    layers[rank] = el;
    let before: SVGElement | null = null;
    for (let next = rank + 1; next < layers.length && before === null; next += 1) {
      before = layers[next] ?? null;
    }
    svg.insertBefore(el, before);
  };
  const drop = (rank: number): void => {
    layers[rank]?.remove();
    layers[rank] = null;
  };

  // --- Building ----------------------------------------------------------------------------------------------------------------------

  const build = (target: HTMLElement): void => {
    svg = svgEl("svg");
    svg.setAttribute("aria-hidden", "true");
    if (kind === "line") {
      linePath = svgEl("path");
      series = linePath;
    } else {
      const group = svgEl("g");
      series = group;
      if (kind === "area") {
        areaPath = svgEl("path");
        linePath = svgEl("path");
        group.append(areaPath, linePath);
      } else {
        barsPath = svgEl("path");
        barsPath.setAttribute("data-fade", "");
        group.append(barsPath);
      }
    }
    if (kind !== "bar") {
      series.setAttribute("data-fade", "");
    }
    layers[SERIES] = series;
    svg.append(series);
    target.append(svg);
  };

  /** The svg's attributes from the look: colours, widths, the fill; the overlays are made again on their next use. */
  const paint = (): void => {
    if (svg === null) {
      return;
    }
    const l = look;
    painted = paintKey(l);
    if (linePath !== null) {
      attrs(linePath, sparklineStrokeAttrs(l));
      if (kind === "line") {
        // Drawn in along its stroke: a dash as long as the path (bklit's `pathLength={1}` and `strokeDasharray={1}`).
        attrs(linePath, SPARKLINE_LINE_DASH);
      }
    }
    if (areaPath !== null) {
      if (l.fill === "gradient") {
        if (fillStops === null) {
          fillId = nextId();
          const defs = svgEl("defs");
          const gradient = svgEl("linearGradient");
          attrs(gradient, { id: fillId, x1: 0, x2: 0, y1: 0, y2: 1 });
          fillStops = [svgEl("stop"), svgEl("stop")];
          attrs(fillStops[1], { offset: 1, "stop-opacity": 0 });
          gradient.append(...fillStops);
          defs.append(gradient);
          svg.prepend(defs);
        }
        attrs(fillStops[0], { "stop-color": l.color, "stop-opacity": l.fillOpacity });
        fillStops[1].setAttribute("stop-color", l.color);
        attrs(areaPath, { fill: `url(#${fillId})`, "fill-opacity": 1 });
      } else {
        attrs(areaPath, { fill: l.color, "fill-opacity": l.fillOpacity });
      }
    }
    barsPath?.setAttribute("fill", l.color);
    for (const rank of [HIGHLIGHT, END_DOT, CROSS, DOT]) {
      drop(rank);
    }
    crossGroup = null;
    hoverDot = null;
    endDot = null;
    highlightGroup = null;
    highlightPath = null;
    highlightRect = null;
    focusBar?.remove();
    focusBar = null;
    focusIndex = null;
    marked = false;
    faded = false;
    (kind === "bar" ? barsPath : series)?.style.removeProperty("opacity");
  };

  const dotCircle = (): SVGCircleElement => {
    const dot = svgEl("circle");
    attrs(dot, sparklineDotAttrs(look));
    return dot;
  };

  const crosshair = (): SVGGElement => {
    const group = svgEl("g");
    const { crosshair: variant, height, padding } = look;
    if (variant === "gradient") {
      // A gradient stroke needs a non-zero bbox width: a 1 px rect, faded at both ends.
      const id = nextId();
      const defs = svgEl("defs");
      const gradient = svgEl("linearGradient");
      attrs(gradient, { id, x1: 0, x2: 0, y1: 0, y2: 1 });
      for (const [offset, opacity] of [
        [0, 0],
        [0.5, 1],
        [1, 0],
      ] as const) {
        const stop = svgEl("stop");
        attrs(stop, { offset, "stop-color": CROSSHAIR, "stop-opacity": opacity });
        gradient.append(stop);
      }
      defs.append(gradient);
      const rect = svgEl("rect");
      attrs(rect, { fill: `url(#${id})`, height, width: 1, x: -0.5, y: 0 });
      group.append(defs, rect);
    } else {
      const line = svgEl("line");
      attrs(line, { stroke: CROSSHAIR, "stroke-width": 1, x1: 0, x2: 0, y1: padding.top / 2, y2: height - padding.bottom / 2 });
      if (variant === "dashed") {
        line.setAttribute("stroke-dasharray", "2 2");
      }
      group.append(line);
    }
    return group;
  };

  /** The highlight: the series' stroke again, clipped to a band around the hovered point. */
  const highlight = (): SVGGElement => {
    const group = svgEl("g");
    const id = nextId();
    const defs = svgEl("defs");
    const clip = svgEl("clipPath");
    clip.setAttribute("id", id);
    highlightRect = svgEl("rect");
    // Bleeds by the stroke width so strokes at the min and max keep their full width.
    attrs(highlightRect, { y: -look.strokeWidth, height: look.height + look.strokeWidth * 2 });
    clip.append(highlightRect);
    defs.append(clip);
    highlightPath = svgEl("path");
    attrs(highlightPath, { "clip-path": `url(#${id})`, ...sparklineStrokeAttrs(look) });
    group.append(defs, highlightPath);
    return group;
  };

  // --- Drawing -----------------------------------------------------------------------------------------------------------------------

  /** The last point with a value: where the end dot rests. */
  const lastDefined = (l: SparklineLayout) => l.points.findLast((point) => Number.isFinite(point.y));

  const barSegment = (l: SparklineLayout, index: number): string => {
    const point = l.points[index];
    return point === undefined ? "" : sparklineBarSegment(point.x, sparklineBarWidth(l.band, look.barGap), point.y, l.baselineY, look.barRadius);
  };

  const placeEndDot = (l: SparklineLayout): void => {
    const last = lastDefined(l);
    if (endDot !== null && last !== undefined) {
      attrs(endDot, { cx: last.x, cy: last.y });
    }
  };

  /** Writes `l`'s paths: the target layout, or a frame of the morph to it. */
  const drawFrame = (l: SparklineLayout): void => {
    onScreen = l;
    if (linePath !== null) {
      const d = sparklineLinePath(l.points, look.curve);
      linePath.setAttribute("d", d);
      if (layers[HIGHLIGHT] !== null) {
        highlightPath?.setAttribute("d", d);
      }
    }
    areaPath?.setAttribute("d", sparklineAreaPath(l.points, look.curve, l.baselineY));
    if (barsPath !== null) {
      barsPath.setAttribute("d", sparklineBarsPath(l, look.barGap, look.barRadius));
      if (focusBar !== null && focusIndex !== null) {
        focusBar.setAttribute("d", barSegment(l, focusIndex));
      }
    }
    if (layers[END_DOT] !== null) {
      placeEndDot(l);
    }
  };

  const morph = (from: SparklineLayout, to: SparklineLayout, duration: number): void => {
    stopMorph?.();
    const start = now();
    drawFrame(interpolateSparklineLayout(from, to, 0));
    stopMorph = onFrames((time) => {
      const t = Math.min(1, Math.max(0, time - start) / duration);
      drawFrame(t >= 1 ? to : interpolateSparklineLayout(from, to, REVEAL_EASING(t)));
      if (t >= 1) {
        stopMorph = null;
        return false;
      }
      return true;
    });
  };

  /** The layout for the current values, size and look: the same object while none of them changed. */
  const nextLayout = (): SparklineLayout => {
    const l = look;
    const key = `${width}|${l.height}|${l.padding.top},${l.padding.right},${l.padding.bottom},${l.padding.left}|${l.yMin}|${l.yMax}`;
    if (layout !== null && layoutValues === values && layoutKey === key) {
      return layout;
    }
    layoutKey = key;
    layoutValues = values;
    return computeSparklineLayout(values, width, l.height, l.padding, computeSparklineDomain(values, l.yMin, l.yMax, kind === "bar"), slot);
  };

  const enter = (): void => {
    entered = true;
    const target = series;
    const duration = props.animationDuration ?? DEFAULT_SPARKLINE_ANIMATION_DURATION_MS;
    if (target === null || props.animate === false || duration <= 0) {
      return;
    }
    if (reducedMotion()) {
      play(target, [FADED, SHOWN], REDUCED_FADE);
      return;
    }
    const options = { duration, easing: props.animationEasing ?? DEFAULT_EASING };
    if (kind === "line") {
      play(target, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], options);
    } else if (kind === "area") {
      play(target, [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }], options);
    } else {
      // Bars grow from the baseline while a left-to-right wipe staggers them.
      const transformOrigin = `0 ${layout?.baselineY ?? 0}px`;
      play(
        target,
        [
          { clipPath: "inset(0 100% 0 0)", transform: "scaleY(0)", transformOrigin },
          { clipPath: "inset(0 0% 0 0)", transform: "scaleY(1)", transformOrigin },
        ],
        options,
      );
    }
  };

  /** Draws what changed: the first draw (with the enter), a resize (snaps), new data (morphs), a new look (snaps), the hover. */
  const draw = (resized: boolean): void => {
    if (host === null || width <= 0) {
      return;
    }
    if (svg === null) {
      build(host);
    }
    const node = svg as SVGSVGElement;
    if (svgWidth !== width) {
      svgWidth = width;
      node.setAttribute("width", String(width));
    }
    if (svgHeight !== look.height) {
      svgHeight = look.height;
      node.setAttribute("height", String(look.height));
    }
    const repaint = paintKey(look) !== painted;
    if (repaint) {
      paint();
    }
    const next = nextLayout();
    const moved = next !== layout;
    layout = next;
    if (moved || repaint) {
      const duration = props.animate === false ? 0 : (props.dataTransitionDuration ?? DEFAULT_SPARKLINE_DATA_TRANSITION_MS);
      const from = onScreen;
      if (from === null || !entered || resized || repaint || duration <= 0 || sameSparklineShape(from, next) || reducedMotion()) {
        // An interrupted morph may have left the paths mid-frame.
        stopMorph?.();
        stopMorph = null;
        drawFrame(next);
      } else {
        morph(from, next, duration);
      }
    }
    if (!entered) {
      enter();
    }
    if (moved || repaint || hoverDirty) {
      hoverDirty = false;
      showHover();
    }
  };

  // --- Hover ---------------------------------------------------------------------------------------------------------------------------

  const springStep = (time: number): boolean => {
    const x = crossX.at(time);
    const y = dotY.at(time);
    layers[CROSS]?.setAttribute("transform", `translate(${x},0)`);
    layers[DOT]?.setAttribute("transform", `translate(${x},${y})`);
    if (highlightRect !== null) {
      highlightRect.setAttribute("x", String(bandX.at(time)));
      highlightRect.setAttribute("width", String(Math.max(0, bandW.at(time))));
    }
    springing = !(crossX.done && dotY.done && bandX.done && bandW.done);
    return springing;
  };

  const fadeOutBar = (bar: SVGPathElement): void => {
    const animation = play(bar, [FADED], { ...BAR_FADE, fill: "forwards" });
    if (animation === null) {
      bar.remove();
    } else {
      animation.onfinish = () => {
        bar.remove();
      };
    }
  };

  /** The focused bar: on top at full strength, cross-faded as the hovered bar changes (the rest fade with the base path). */
  const showBar = (index: number | null): void => {
    if (index === focusIndex || layout === null || series === null) {
      return;
    }
    if (focusBar !== null) {
      fadeOutBar(focusBar);
      focusBar = null;
    }
    focusIndex = index;
    const point = index === null ? undefined : layout.points[index];
    if (index === null || point === undefined || !Number.isFinite(point.y)) {
      return;
    }
    focusBar = svgEl("path");
    attrs(focusBar, { fill: look.color, d: barSegment(onScreen ?? layout, index) });
    series.append(focusBar);
    play(focusBar, [{ opacity: look.inactiveOpacity }, SHOWN], BAR_FADE);
  };

  /** Puts the hover marks on `shown`, or takes them away; a hovered point the layout moved under has its marks spring after it. */
  const showHover = (): void => {
    const l = layout;
    if (l === null || series === null) {
      return;
    }
    const index = shown;
    const point = index === null ? undefined : l.points[index];
    const hovering = point !== undefined;
    const fade = hovering && look.inactiveOpacity !== 1;
    if (fade !== faded) {
      faded = fade;
      const target = kind === "bar" ? barsPath : series;
      if (fade) {
        target?.style.setProperty("opacity", String(look.inactiveOpacity));
      } else {
        target?.style.removeProperty("opacity");
      }
    }
    // The end dot rests on the last point while nothing is hovered.
    if (look.endDot && !hovering) {
      if (layers[END_DOT] === null) {
        endDot ??= dotCircle();
        place(endDot, END_DOT);
        placeEndDot(onScreen ?? l);
      }
    } else {
      drop(END_DOT);
    }

    if (point === undefined || index === null) {
      if (marked) {
        marked = false;
        drop(HIGHLIGHT);
        drop(CROSS);
        drop(DOT);
        showBar(null);
      }
      return;
    }

    // The springs start on the first hovered point (no slide in); after that they follow it.
    const entering = !marked;
    marked = true;
    const time = now();
    const spring = entering ? null : hoverSpring();
    const finite = Number.isFinite(point.y);
    crossX.to(point.x, spring, time);
    dotY.to(finite ? point.y : l.baselineY, spring, time);
    if (look.crosshair !== false) {
      crossGroup ??= crosshair();
      place(crossGroup, CROSS);
    }
    if (look.dot && finite) {
      hoverDot ??= dotCircle();
      place(hoverDot, DOT);
    } else {
      drop(DOT);
    }
    if (look.highlight && linePath !== null) {
      const start = l.points[Math.max(0, index - 1)]?.x ?? 0;
      const end = l.points[Math.min(l.points.length - 1, index + 1)]?.x ?? 0;
      const band = entering || reducedMotion() ? null : HIGHLIGHT_SPRING;
      bandX.to(start, band, time);
      bandW.to(end - start, band, time);
      if (layers[HIGHLIGHT] === null) {
        highlightGroup ??= highlight();
        // The base stroke's `d` as it is now (it may be mid-morph), faded in.
        highlightPath?.setAttribute("d", linePath.getAttribute("d") ?? "");
        place(highlightGroup, HIGHLIGHT);
        if (highlightPath !== null) {
          play(highlightPath, [FADED, SHOWN], HIGHLIGHT_FADE);
        }
      }
    }
    if (kind === "bar") {
      showBar(finite ? index : null);
    }
    if (!springStep(time)) {
      return;
    }
    onFrames(springStep);
  };

  /** The pointer or keyboard picked `index`: reported, and shown unless the hover is controlled. */
  const pick = (index: number | null): void => {
    if (index === current) {
      return;
    }
    current = index;
    if (props.hoverIndex === undefined) {
      internal = index;
      shown = index;
      showHover();
    }
    props.onHoverChange?.(index, index === null ? null : (props.data[index] ?? null));
    sayPoint();
  };

  const onPointer = (event: PointerEvent): void => {
    const target = host;
    if (target === null || width <= 0) {
      return;
    }
    // The offset in the host's own pixels (right under a CSS scale; no layout read of ours): the svg takes no pointer events, so the host
    // is the target unless styles.css is missing.
    const x = event.target === target ? event.offsetX - contentLeft : event.clientX - target.getBoundingClientRect().left - contentLeft;
    keyboard = false;
    pick(sparklineIndexAtX(x, values.length, width, look.padding, slot));
  };
  const onLeave = (): void => {
    pick(null);
  };
  const onFocus = (): void => {
    if (current === null && values.length > 0 && host?.matches(":focus-visible") === true) {
      keyboard = true;
      pick(values.length - 1);
    }
  };
  const onBlur = (): void => {
    if (keyboard) {
      keyboard = false;
      pick(null);
      sayPoint();
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    const count = values.length;
    const from = current ?? count - 1;
    let next: number | null;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = current === null ? from : Math.max(0, from - 1);
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = current === null ? from : Math.min(count - 1, from + 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      case "Escape":
        next = null;
        break;
      default:
        return;
    }
    if (count === 0) {
      return;
    }
    event.preventDefault();
    keyboard = next !== null;
    pick(next);
  };

  const listeners = (target: HTMLElement, on: boolean): void => {
    listening = on;
    if (on) {
      target.addEventListener("pointermove", onPointer);
      target.addEventListener("pointerdown", onPointer);
      target.addEventListener("pointerleave", onLeave);
      target.addEventListener("keydown", onKey);
      target.addEventListener("focus", onFocus);
      target.addEventListener("blur", onBlur);
    } else {
      target.removeEventListener("pointermove", onPointer);
      target.removeEventListener("pointerdown", onPointer);
      target.removeEventListener("pointerleave", onLeave);
      target.removeEventListener("keydown", onKey);
      target.removeEventListener("focus", onFocus);
      target.removeEventListener("blur", onBlur);
    }
  };

  /** The host's input and accessibility, as `interactive` and the label say. */
  const listen = (target: HTMLElement): void => {
    const on = props.interactive !== false;
    if (on !== listening) {
      listeners(target, on);
      if (on) {
        target.setAttribute("data-interactive", "");
        target.tabIndex = 0;
      } else {
        target.removeAttribute("data-interactive");
        target.removeAttribute("tabindex");
        onLeave();
      }
    }
    const given = props["aria-label"] ?? props.ariaLabel;
    if (given === undefined && labelOf !== values) {
      labelOf = values;
      label = "";
    }
    const next = given ?? (label === "" ? describeSparkline(values) : label);
    named = next;
    // A reader's label names it; the summary of its values then describes it.
    const summary = given === undefined ? null : describeSparkline(values);
    if (summary !== target.getAttribute("aria-description")) {
      if (summary === null) {
        target.removeAttribute("aria-description");
      } else {
        target.setAttribute("aria-description", summary);
      }
    }
    if (next !== target.getAttribute("aria-label") && !(keyboard && current !== null)) {
      target.setAttribute("role", "img");
      target.setAttribute("aria-label", next);
    }
    label = given === undefined ? next : "";
  };

  /** The keyboard's point, said through the focused host's name (a role="img" holds no live region): "Revenue: 4,200, point 12 of 12". */
  const sayPoint = (): void => {
    const target = host;
    if (target === null || named === "") {
      return;
    }
    const at = keyboard ? current : null;
    const value = at === null ? undefined : values[at];
    const next = at === null || value === undefined || !Number.isFinite(value) ? named : `${named}: ${formatNumber(value)}, point ${at + 1} of ${values.length}`;
    if (next !== target.getAttribute("aria-label")) {
      target.setAttribute("aria-label", next);
    }
  };

  /** Measures the host, or takes the fixed width: the first draw happens as soon as there is one. */
  const size = (target: HTMLElement): void => {
    const fixed = props.width;
    if (fixed !== undefined) {
      if (observing) {
        unobserve?.();
        unobserve = null;
        observing = false;
      }
      const resized = width > 0 && width !== fixed;
      width = fixed;
      contentLeft = 0;
      draw(resized);
      return;
    }
    if (observing) {
      draw(false);
      return;
    }
    observing = true;
    // A host that had a fixed width keeps it until measured again.
    unobserve = observeWidth(target, (measured, left) => {
      contentLeft = left;
      const next = Math.round(measured * 2) / 2;
      if (next === width) {
        return;
      }
      const resized = width > 0;
      width = next;
      draw(resized);
    });
  };

  /**
   * Takes over the svg the server wrote into the host (markup.ts): its elements become the controller's, as `build` and `paint` would
   * have made them, and the enter counts as played. A host without one (a client-only mount), or one whose svg isn't the shape this
   * sparkline draws, is drawn from scratch.
   */
  const adopt = (target: HTMLElement): void => {
    const node = target.querySelector<SVGSVGElement>(":scope > svg");
    if (node === null) {
      return;
    }
    const group = node.querySelector<SVGGElement>(":scope > g");
    const paths = group === null ? [] : [...group.querySelectorAll<SVGPathElement>(":scope > path")];
    const line = kind === "line" ? node.querySelector<SVGPathElement>(":scope > path") : kind === "area" ? (paths[1] ?? null) : null;
    const area = kind === "area" ? (paths[0] ?? null) : null;
    const bars = kind === "bar" ? (paths[0] ?? null) : null;
    const gradient = kind === "area" ? node.querySelector<SVGLinearGradientElement>(":scope > defs > linearGradient") : null;
    const stops = gradient === null ? [] : [...gradient.querySelectorAll<SVGStopElement>(":scope > stop")];
    const fits =
      props.width !== undefined &&
      (kind === "line" ? line !== null : kind === "area" ? line !== null && area !== null && (look.fill !== "gradient" || stops.length === 2) : bars !== null);
    if (!fits) {
      node.remove();
      return;
    }
    svg = node;
    svgWidth = Number(node.getAttribute("width"));
    svgHeight = Number(node.getAttribute("height"));
    linePath = line;
    areaPath = area;
    barsPath = bars;
    series = kind === "line" ? line : group;
    if (gradient !== null && stops.length === 2) {
      fillId = gradient.id;
      fillStops = [stops[0] as SVGStopElement, stops[1] as SVGStopElement];
    }
    layers[SERIES] = series;
    const dot = node.querySelector<SVGCircleElement>(":scope > circle");
    if (dot !== null) {
      endDot = dot;
      layers[END_DOT] = dot;
    }
    painted = paintKey(look);
    entered = true;
    adopted = true;
  };

  return {
    update(next) {
      const previous = props;
      props = next;
      if (next.data !== previous.data || next.dataKey !== previous.dataKey) {
        const resolved = resolveSparklineValues(next.data, next.dataKey);
        // A re-created array (or an inline accessor) with the same values keeps the layout.
        if (!sameValues(resolved, values)) {
          values = resolved;
        }
      }
      look = lookOf(kind, next);
      // A controlled index is what is shown; an uncontrolled one is the pointer's.
      const wanted = next.hoverIndex === undefined ? internal : next.hoverIndex;
      if (next.hoverIndex !== undefined) {
        current = wanted;
      }
      if (wanted !== shown) {
        shown = wanted;
        hoverDirty = true;
      }
      if (host !== null) {
        listen(host);
        size(host);
      }
    },
    attach(target) {
      host = target;
      if (svg === null) {
        adopt(target);
      }
      listen(target);
      size(target);
    },
    prerender(next, idPrefix) {
      return sparklineServerMarkup(kind, next, idPrefix);
    },
    detach() {
      const target = host;
      if (target === null) {
        return;
      }
      host = null;
      if (listening) {
        listeners(target, false);
      }
      unobserve?.();
      unobserve = null;
      observing = false;
      stopMorph?.();
      stopMorph = null;
      if (adopted) {
        // The server's svg is the framework's markup: it stays, at rest (no hover marks, no fade), for the next attach to adopt.
        for (const rank of [HIGHLIGHT, CROSS, DOT]) {
          drop(rank);
        }
        focusBar?.remove();
        (kind === "bar" ? barsPath : series)?.style.removeProperty("opacity");
      } else {
        svg?.remove();
      }
      adopted = false;
      svg = null;
      svgWidth = 0;
      svgHeight = 0;
      series = null;
      linePath = null;
      areaPath = null;
      barsPath = null;
      fillStops = null;
      painted = "";
      entered = false;
      layers.fill(null);
      crossGroup = null;
      hoverDot = null;
      endDot = null;
      highlightGroup = null;
      highlightPath = null;
      highlightRect = null;
      focusBar = null;
      focusIndex = null;
      layout = null;
      onScreen = null;
      layoutValues = null;
      width = 0;
      marked = false;
      faded = false;
      keyboard = false;
      internal = null;
      current = props.hoverIndex ?? null;
      shown = current;
    },
  };
}
