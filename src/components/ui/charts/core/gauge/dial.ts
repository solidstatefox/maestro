import { markupToString } from "../markup/node";
import type { MarkupChild, MarkupNode } from "../markup/node";
import { cssText } from "../style";
import { buildGaugeScene } from "./scene";
import type { GaugeAria, GaugeScene, GaugeSpec, ScenePart } from "./scene";
import { createSweep } from "./sweep";
import type { SweepMotion } from "./transition";
import { TRACK_FADE_EASE, TRACK_FADE_MS } from "./transition";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface DialInput {
  readonly spec: GaugeSpec;
  readonly aria: GaugeAria;
  /** Lit notches and value (0–1) the sweep goes to. */
  readonly fill: number;
  readonly value: number;
  /** The drawing's size when the props fix it; null to follow the surface's box. */
  readonly fixed: { readonly width: number; readonly height: number } | null;
  /** The size the server markup is drawn at when the box is fluid (the svg scales to its box). */
  readonly nominal: { readonly width: number; readonly height: number };
  readonly motion: SweepMotion;
  /** False under reduced motion (or while geometry is scrubbed): no fade, no sweep. */
  readonly animate: boolean;
  /** How long the first sweep waits after mount (ms). */
  readonly delayMs: number;
}

export interface GaugeDial {
  readonly attach: (surface: HTMLElement) => void;
  readonly detach: () => void;
  readonly update: (input: DialInput) => void;
  /** The svg at rest, at the fixed or nominal size (the server's markup). */
  readonly prerender: (input: DialInput) => string;
}

const toDom = (node: MarkupNode, svg: boolean, made: Map<MarkupNode, Element>): Element => {
  const inSvg = svg || node.tag === "svg";
  const element = inSvg ? document.createElementNS(SVG_NS, node.tag) : document.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (value !== undefined && value !== false) { element.setAttribute(name, value === true ? "" : String(value)); }
  }
  if (node.style !== undefined) { element.setAttribute("style", cssText(node.style)); }
  for (const child of node.children) { appendChild(element, child, inSvg, made); }
  made.set(node, element);
  return element;
};

const appendChild = (parent: Element, child: MarkupChild, svg: boolean, made: Map<MarkupNode, Element>): void => {
  if (child === null) { return; }
  if (typeof child === "string") { parent.append(child); return; }
  if ("tag" in child) { parent.append(toDom(child, svg, made)); }
};

const sizeOf = (input: DialInput): { readonly width: number; readonly height: number } => input.fixed ?? input.nominal;

export function createGaugeDial(): GaugeDial {
  let input: DialInput | null = null;
  let surface: HTMLElement | null = null;
  /** What is drawn: the scene, its size and the elements its parts write, with the last value written to each. */
  let drawn: { readonly scene: GaugeScene; readonly spec: GaugeSpec; aria: GaugeAria; readonly svg: Element; readonly width: number; readonly height: number; readonly elements: Element[]; readonly last: string[] } | null = null;
  let box: { width: number; height: number } | null = null;
  let stopObserving: (() => void) | null = null;
  /** When the entrance began (the fade's clock): null before the first attach and once it has played. */
  let enteredAt: number | null = null;
  let entered = false;

  const write = (parts: readonly ScenePart[], elements: Element[], last: string[], fill: number, value: number): void => {
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const next = part.at(fill, value);
      if (next !== last[i]) {
        last[i] = next;
        const element = elements[i];
        if (part.name.startsWith("--")) { (element as HTMLElement).style.setProperty(part.name, next); } else { element.setAttribute(part.name, next); }
      }
    }
  };

  const sweep = createSweep(0, 0, (fill, value) => {
    if (drawn !== null) { write(drawn.scene.parts, drawn.elements, drawn.last, fill, value); }
  });

  const fadeIn = (elements: readonly Element[]): void => {
    if (enteredAt === null) { return; }
    const elapsed = performance.now() - enteredAt;
    if (elapsed >= TRACK_FADE_MS) {
      enteredAt = null;
      return;
    }
    for (const element of elements) {
      if (typeof element.animate === "function") { element.animate([{ opacity: 0 }, { opacity: 1 }], { delay: -elapsed, duration: TRACK_FADE_MS, easing: TRACK_FADE_EASE, fill: "backwards" }); }
    }
  };

  const draw = (width: number, height: number): void => {
    if (surface === null || input === null || width <= 0 || height <= 0) { return; }
    const { spec, aria } = input;
    if (drawn !== null && drawn.spec === spec && drawn.width === width && drawn.height === height && drawn.aria.description === aria.description) {
      // A new reading only renames the svg.
      if (drawn.aria.label !== aria.label) { drawn.svg.setAttribute("aria-label", aria.label); }
      drawn.aria = aria;
      return;
    }
    const fill = sweep.fill();
    const value = sweep.value();
    const scene = buildGaugeScene(spec, aria, width, height, fill, value);
    const made = new Map<MarkupNode, Element>();
    const svg = toDom(scene.svg, true, made);
    const nodes: Element[] = scene.conic === null ? [svg] : [toDom(scene.conic, false, made), svg];
    surface.replaceChildren(...nodes);
    const elements = scene.parts.map((part) => made.get(part.node) as Element);
    drawn = { aria, elements, height, last: scene.parts.map((part) => part.at(fill, value)), scene, spec, svg, width };
    fadeIn(scene.fade.map((node) => made.get(node) as Element));
  };

  const redraw = (): void => {
    if (input === null) { return; }
    const size = input.fixed ?? box;
    if (size !== null) { draw(size.width, size.height); }
  };

  const observe = (el: HTMLElement): void => {
    stopObserving?.();
    stopObserving = null;
    if (typeof ResizeObserver === "undefined") {
      box = { ...sizeOf(input as DialInput) };
      return;
    }
    // The first delivery comes after layout and before paint: the scene is drawn once, at its real size, before anything shows.
    const observer = new ResizeObserver((entries) => {
      const rect = entries.at(-1)?.contentRect;
      if (rect === undefined) { return; }
      box = { height: rect.height, width: rect.width };
      redraw();
    });
    observer.observe(el);
    stopObserving = () => { observer.disconnect(); };
  };

  return {
    attach(el) {
      surface = el;
      drawn = null;
      if (input === null) { return; }
      if (!entered) {
        entered = true;
        // The entrance: the track fades in now; the fill sweeps from 0 after the enter delay (gauge.tsx useGaugeMotion).
        enteredAt = input.animate ? performance.now() : null;
        sweep.to(input.fill, input.value, { delayMs: input.delayMs, instant: !input.animate, motion: input.motion });
      }
      if (input.fixed === null) {
        // The server's markup (React) is replaced at the real size; until then nothing of a stale size or state shows.
        el.replaceChildren();
        observe(el);
      } else {
        stopObserving?.();
        stopObserving = null;
        redraw();
      }
      sweep.resume();
    },
    detach() {
      sweep.pause();
      stopObserving?.();
      stopObserving = null;
      surface = null;
      drawn = null;
    },
    update(next) {
      const before = input;
      input = next;
      if (surface === null) {
        if (entered) { sweep.to(next.fill, next.value, { delayMs: 0, instant: !next.animate, motion: next.motion }); }
        return;
      }
      if (before !== null && (before.fixed === null) !== (next.fixed === null)) {
        if (next.fixed === null) { observe(surface); } else { stopObserving?.(); stopObserving = null; }
      }
      redraw();
      sweep.to(next.fill, next.value, { delayMs: 0, instant: !next.animate, motion: next.motion });
    },
    prerender(next) {
      const { width, height } = sizeOf(next);
      return markupToString(buildGaugeScene(next.spec, next.aria, width, height, next.fill, next.value).svg);
    },
  };
}
