import { CLS, keyIs, keyStarts, isMotionNode } from "../renderer-dom";
import { SNAPPY_HOVER_MS } from "../motion/springs";
import { SANKEY_SETTLED_ATTR } from "./view";

// Sankey hover: an opacity on a few group elements dims the chart, and the lit items are redrawn over it.
//
// bklit fades every node, label and flow on its own (sankey-node.tsx:247-249, sankey-link.tsx:133-167). Done per element here (an inline
// custom property each, read by static rules, each element with its own opacity transition), a hover change restyled every node, label and
// flow (sankey-default: about 90 elements), then every one of them again on each frame of the fade, and each transition fired its run /
// start / cancel / end events through the document (React's root listener heard all of them). TanStack 1.5 paints more frames per pointer
// move (the raw pointer stream), and every extra frame of a fade restyled every faded element: 2-3 ms more a move than on 1.1. Now:
// - The dim fades group elements: the marks group to the nodes' faded opacity (the nodes and names follow), the flow group to what the
//   flows still need (faded / (rest x node faded)), the value-label group to 0.8 of its own (the value texts draw at full foreground under a
//   static 0.6 on their group: 0.6 at rest, 0.4 x 0.8 dimmed, bklit's `fadedOpacity * 0.8`). Three elements whatever the node and flow
//   counts. When a flow's faded opacity is more than the marks group leaves it (faded > rest x node faded), the marks group stays and each
//   node group and both label groups dim instead.
// - The lit items (the focus, its flows and their far ends) are clones in two svgs the chart owns beside the renderer's surface: the flows in
//   one under the surface, so the dimmed nodes and labels still paint over them as bklit's do, the nodes and their labels in one over it.
//   The originals stay as they are, dimmed with their groups: each clone draws at the alpha that, with its dimmed original, reads the item's
//   own opacity (a node and its name are opaque; a flow and a value label are computed, `over`). Nothing in the renderer's svg is written
//   for an item: a hover change adds or drops only the clones whose item changed.
// - The fades are Web Animations on the hover profile (`--bkm-hover-dur` / `--bkm-hover-ease`, read from the host; bklit: the nodes on
//   their staggered enter transition, the flows over 180ms ease-out), not CSS transitions: no events, a fade restarts from where the last
//   one stands over the full duration (as bklit's motion does), and a render that drops the groups' `style` leaves them be. The flow and
//   value clones fade in and out with the dim; a lit item swaps in and out at once while dimmed, as the heatmap's and the beeswarm's do.
// - Leaving fades the groups back; once the fades end the clones go. A render may replace elements: the writer reads the chart again and
//   paints its state again after each one (`refresh`).
// - Before the CSS entrance has settled, a clone copies its original's running animations (node grow, label fade, flow draw), timed to
//   the same start, so a lit item enters with the rest.
// - styles.css's re-inherited Segment* vars are reset on the marks (see the static rules): an element that inherits a property explicitly
//   restyles with its parent, so each frame of the marks group's fade restyled every node group and rect too.

/** The value labels at rest: 0.9 (bklit's 0.6, sankey-node.tsx:249, takes them under 4.5:1 over a flow), the node's faded opacity x 0.8 dimmed. */
const VALUE_LABEL_OPACITY = 0.9;
const DIMMED_VALUE_SCALE = 0.8;
/** bklit's hovered flow: its rest opacity x 1.3, at most 1 (sankey-link.tsx:138). */
const HOVER_STROKE_BOOST = 1.3;

const HOST = '[data-bkm-chart="sankey"]';
const VALUE_GROUP = `g${/* @__PURE__ */ keyIs("sankey:vlabel")}`;
const OVERLAY_CLASS = "bkm-sk-ov";

const staticRules = (): string => {
  // The value labels' rest 0.9 is their group's, the texts at full foreground under it (the renderer's attribute is the 60% mix, which the
  // over svg's clones keep).
  let css = `${HOST} ${VALUE_GROUP}{opacity:${VALUE_LABEL_OPACITY}}${HOST} ${VALUE_GROUP} > text{fill:var(--bkm-foreground)}`;
  css += `${HOST} .${OVERLAY_CLASS}{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}`;
  // styles.css re-inherits the cartesian Segment* vars down the marks group and its rect groups (`inherit` on a non-inheriting registered
  // property): a child that inherits explicitly restyles with its parent, so each frame of the marks group's fade would restyle every node
  // group and node rect (sankey-default: 40 elements a frame instead of 3). The sankey reads neither var; this sheet is unlayered, so it wins.
  css += `${HOST} :is(${CLS.marks},${CLS.marks} > g,${CLS.marks} > g > *){--bkm-hl0:initial;--bkm-hl1:initial}`;
  return css;
};

const STATIC_CSS = /* @__PURE__ */ staticRules();

/** Static (data-independent) stylesheet text. */
const sankeyHoverCss = (): string => STATIC_CSS;

/** The opacities a hover reads, from the SankeyNode and SankeyLink props (bklit's defaults 0.4, 0.1 and 0.5). */
interface SankeyDim {
  /** SankeyNode `fadedOpacity`. */
  readonly node: number;
  /** SankeyLink `fadedOpacity`. */
  readonly link: number;
  /** SankeyLink `strokeOpacity`: the flows' rest. */
  readonly stroke: number;
}

interface SankeyLinkRef {
  readonly source: number;
  readonly target: number;
}

type SankeyHoverFocus = { readonly node: number } | { readonly link: number };

interface SankeyHoverSets {
  readonly nodes: readonly number[];
  readonly links: readonly number[];
}

/** The active node / flow indices for a focused node (itself, its flows and their far ends) or a focused flow (it and its two ends). */
const sankeyHoverSets = (links: readonly SankeyLinkRef[], focus: SankeyHoverFocus): SankeyHoverSets => {
  const nodes = new Set<number>();
  const flows: number[] = [];
  if ("node" in focus) {
    nodes.add(focus.node);
    for (const [index, row] of links.entries()) {
      if (row.source === focus.node || row.target === focus.node) {
        flows.push(index);
        nodes.add(row.source);
        nodes.add(row.target);
      }
    }
  } else {
    const row = links.at(focus.link);
    if (row !== undefined) {
      flows.push(focus.link);
      nodes.add(row.source);
      nodes.add(row.target);
    }
  }
  return { links: flows, nodes: [...nodes] };
};

const SVG_NS = "http://www.w3.org/2000/svg";
const FLOW_KEY = "sankey:flow";
const NODE_KEY_PREFIX = "sankey:sankey-node-";
const NAME_KEY = "sankey:nlabel";
const VALUE_KEY = "sankey:vlabel";
const KEY_INDEX = /:number:(\d+)$/u;
const NODE_SELECTOR = `:scope > g${/* @__PURE__ */ keyStarts(NODE_KEY_PREFIX)}`;
/** A float slack on the marks-group test (faded <= rest x node faded). */
const EPSILON = 1e-6;

/** The renderer's elements a hover reads, by index: the groups it dims and the items it clones. */
interface SankeyHoverTargets {
  readonly svg: SVGSVGElement;
  readonly marks: Element | null;
  readonly flowGroup: Element | null;
  readonly nameGroup: Element | null;
  readonly valueGroup: Element | null;
  readonly nodeGroups: Element[];
  readonly flows: (Element | undefined)[];
  readonly rects: (Element | undefined)[];
  readonly names: (Element | undefined)[];
  readonly values: (Element | undefined)[];
}

const indexOf = (element: Element): number | undefined => {
  const index = KEY_INDEX.exec(element.getAttribute("data-ts-key") ?? "")?.[1];
  return index === undefined ? undefined : Number(index);
};

/** Each keyed child of `group` (not a renderer tween's copy) at its datum index. */
const byIndex = (group: Element | null): (Element | undefined)[] => {
  const out: (Element | undefined)[] = [];
  for (const child of group?.children ?? []) {
    const index = indexOf(child);
    if (index !== undefined && !isMotionNode(child)) { out[index] = child; }
  }
  return out;
};

/** The chart's hover targets from its svg: the marks group's direct children only (flow group, node groups, label groups). */
const hoverTargets = (svg: SVGSVGElement): SankeyHoverTargets => {
  const marks = svg.querySelector(`:scope > ${CLS.marks}`);
  const child = (key: string): Element | null => marks?.querySelector(`:scope > g${keyIs(key)}`) ?? null;
  const flowGroup = child(FLOW_KEY);
  const nameGroup = child(NAME_KEY);
  const valueGroup = child(VALUE_KEY);
  const nodeGroups: Element[] = [];
  const rects: (Element | undefined)[] = [];
  for (const group of marks?.querySelectorAll(NODE_SELECTOR) ?? []) {
    const index = Number((group.getAttribute("data-ts-key") ?? "").slice(NODE_KEY_PREFIX.length));
    nodeGroups.push(group);
    const rect = group.firstElementChild;
    if (Number.isInteger(index) && rect !== null) { rects[index] = rect; }
  }
  return { flowGroup, flows: byIndex(flowGroup), marks, nameGroup, names: byIndex(nameGroup), nodeGroups, rects, svg, valueGroup, values: byIndex(valueGroup) };
};

/** A group a dim fades: its dimmed opacity and its rest (the value its styles give it, which a settled fade hands back to). */
interface DimTarget {
  readonly element: Element;
  readonly dim: number;
  readonly rest: number;
}

/** The groups a dim fades. */
const dimTargets = (at: SankeyHoverTargets, dim: SankeyDim): DimTarget[] => {
  const out: DimTarget[] = [];
  const push = (element: Element | null, value: number, rest = 1): void => {
    if (element !== null) { out.push({ dim: Math.max(0, Math.min(1, value)), element, rest }); }
  };
  if (dim.node > 0 && dim.link <= dim.stroke * dim.node + EPSILON) {
    // The marks group carries the nodes' dim; the flows and the value labels take what remains of theirs.
    push(at.marks, dim.node);
    push(at.flowGroup, dim.link / (dim.stroke * dim.node));
    push(at.valueGroup, DIMMED_VALUE_SCALE, VALUE_LABEL_OPACITY);
    return out;
  }
  for (const group of at.nodeGroups) { push(group, dim.node); }
  push(at.nameGroup, dim.node);
  push(at.valueGroup, dim.node * DIMMED_VALUE_SCALE, VALUE_LABEL_OPACITY);
  push(at.flowGroup, dim.stroke > 0 ? dim.link / dim.stroke : 1);
  return out;
};

/** The hover profile (`--bkm-hover-dur` / `--bkm-hover-ease`, styles.css) as Web Animations timing, read from the chart's host. */
const hoverTiming = (host: Element): KeyframeAnimationOptions => {
  const style = getComputedStyle(host);
  const value = style.getPropertyValue("--bkm-hover-dur").trim();
  const amount = Number.parseFloat(value);
  const MS_PER_S = 1000;
  let duration = SNAPPY_HOVER_MS;
  if (Number.isFinite(amount)) { duration = value.endsWith("ms") ? amount : amount * MS_PER_S; }
  return { duration, easing: style.getPropertyValue("--bkm-hover-ease").trim() || "ease-out", fill: "forwards" };
};

/** A group's fade: from where the last one left it, held at its end (`fill: forwards`) until the next one or until it settles. */
interface Fade {
  readonly animation: Animation;
  readonly from: number;
  readonly to: number;
}

/** The group fades of one chart, as Web Animations rather than CSS transitions: no transition events through the document per fade (React's
 * root listener hears each), a fade restarts from wherever the last one stands over the full duration (bklit's motion does; a reversed CSS
 * transition is shortened), and a render that drops the groups' `style` leaves them be. */
const createFader = (timingOf: () => KeyframeAnimationOptions) => {
  const fades = new Map<Element, Fade>();
  const valueOf = (element: Element, rest: number): number => {
    const fade = fades.get(element);
    if (fade === undefined) { return rest; }
    const progress = fade.animation.effect?.getComputedTiming().progress;
    return typeof progress === "number" ? fade.from + (fade.to - fade.from) * progress : fade.to;
  };
  const animate = (element: Element, from: number, to: number, timing: KeyframeAnimationOptions): Animation => {
    const keyframes = [{ opacity: from }, { opacity: to }];
    try {
      return element.animate(keyframes, timing);
    } catch {
      // An easing this browser can't parse (`linear()` before its support): the plain curve.
      return element.animate(keyframes, { ...timing, easing: "ease-out" });
    }
  };
  return {
    /** Fades `element` to `to` (at once when `instant`), from where it stands. */
    fade: (element: Element, to: number, rest: number, instant = false): Animation => {
      const from = valueOf(element, rest);
      fades.get(element)?.animation.cancel();
      const animation = animate(element, from, to, instant ? { duration: 0, fill: "forwards" } : timingOf());
      fades.set(element, { animation, from, to });
      return animation;
    },
    has: (element: Element): boolean => fades.has(element),
    /** Drops `element`'s fade: it reads its styles' own value again. */
    settle: (element: Element): void => {
      fades.get(element)?.animation.cancel();
      fades.delete(element);
    },
  };
};

const hotOpacity = (dim: SankeyDim): number => Math.min(1, dim.stroke * HOVER_STROKE_BOOST);

/** The alpha a clone draws at over its dimmed original (`under`) for the pair to read `target`: 1 - (1 - under) (1 - a) = target. */
const over = (target: number, under: number): number => (under >= 1 || target <= under ? 0 : (target - under) / (1 - under));

/** A dimmed flow's opacity: the link's faded opacity, at most its rest (a group's fade only lowers it). */
const fadedFlow = (dim: SankeyDim): number => Math.min(dim.link, dim.stroke);

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, doc: Document): SVGElementTagNameMap[K] => doc.createElementNS(SVG_NS, tag);

/** A clone shows its original as a standalone element: no key (the chart's queries never find it), no hover writes. */
const cloneOf = (original: Element, deep: boolean): Element | null => {
  const clone = original.cloneNode(deep);
  if (!(clone instanceof Element)) { return null; }
  clone.removeAttribute("data-ts-key");
  clone.removeAttribute("style");
  return clone;
};

const isTransition = (animation: Animation): boolean => typeof CSSTransition !== "undefined" && animation instanceof CSSTransition;

/** The original's running entrance animations, copied onto its clone on the same clock (only before the entrance has settled). */
const mirrorAnimations = (original: Element, clone: Element): void => {
  for (const animation of original.getAnimations()) {
    const { effect } = animation;
    if (isTransition(animation) || animation.playState === "finished" || !(effect instanceof KeyframeEffect)) { continue; }
    const copy = clone.animate(effect.getKeyframes(), effect.getTiming());
    if (animation.playState === "paused" || animation.startTime === null) {
      copy.pause();
      copy.currentTime = animation.currentTime;
    } else {
      copy.startTime = animation.startTime;
    }
  }
};

/** One kind of clone (flows, nodes, names or values) in its overlay group, by item index, kept in index order. */
interface CloneLayer {
  readonly group: SVGGElement;
  readonly clones: Map<number, Element>;
}

interface Overlay {
  readonly under: SVGSVGElement;
  readonly over: SVGSVGElement;
  readonly flows: CloneLayer;
  readonly rects: CloneLayer;
  readonly names: CloneLayer;
  readonly values: CloneLayer;
}

const createOverlay = (doc: Document): Overlay => {
  const layer = (parent: SVGSVGElement): CloneLayer => {
    const group = svgEl("g", doc);
    parent.append(group);
    return { clones: new Map(), group };
  };
  const svg = (): SVGSVGElement => {
    const root = svgEl("svg", doc);
    root.setAttribute("class", OVERLAY_CLASS);
    root.setAttribute("aria-hidden", "true");
    return root;
  };
  const under = svg();
  const over = svg();
  // In paint order: the nodes, then their names, then their values (the renderer's own order).
  const flows = layer(under);
  const rects = layer(over);
  const names = layer(over);
  const values = layer(over);
  // The flow and value clones fade in with the dim (at rest they add nothing); the node and name clones are opaque, at full from the start.
  for (const { group } of [flows, values]) { group.style.setProperty("opacity", "0"); }
  return { flows, names, over, rects, under, values };
};

/** Keeps a layer's clones to `indices` (ascending): drops the others, adds the missing ones before their next neighbour (nothing that stays moves). */
const syncLayer = (layer: CloneLayer, indices: readonly number[], make: (index: number) => Element | null): void => {
  const keep = new Set(indices);
  for (const [index, clone] of layer.clones) {
    if (!keep.has(index)) {
      clone.remove();
      layer.clones.delete(index);
    }
  }
  let anchor: Element | null = null;
  for (let at = indices.length - 1; at >= 0; at -= 1) {
    const index = indices[at] ?? 0;
    const existing = layer.clones.get(index);
    if (existing !== undefined) {
      anchor = existing;
      continue;
    }
    const clone = make(index);
    if (clone !== null) {
      layer.group.insertBefore(clone, anchor);
      layer.clones.set(index, clone);
      anchor = clone;
    }
  }
};

const clearLayer = (layer: CloneLayer): void => {
  for (const clone of layer.clones.values()) { clone.remove(); }
  layer.clones.clear();
};

const sorted = (indices: readonly number[]): number[] => [...indices].toSorted((left, right) => left - right);

/** The chart's hover writer. */
interface SankeyHoverWriter {
  /** The lit items (`null`: nothing is hovered) and the opacities they dim the rest by. */
  write: (sets: SankeyHoverSets | null, dim: SankeyDim) => void;
  /** After a render: the elements are read again and the state painted again (a render may replace an element or drop what was written). */
  refresh: () => void;
  /** A new chart (a remount): at rest, no clones, nothing written. */
  reset: () => void;
  /** The chart is detached: the owned svgs leave the DOM. */
  detach: () => void;
}

/** `host` is the chart's host, `surface` the renderer's surface (both null while detached). */
const createSankeyHoverWriter = (host: () => HTMLElement | null, surface: () => HTMLElement | null): SankeyHoverWriter => {
  let targets: SankeyHoverTargets | null = null;
  let overlay: Overlay | null = null;
  // What is shown: the lit items (null at rest), whether the groups are dimmed, and the groups the dim fades.
  let shown: SankeyHoverSets | null = null;
  let dimmed = false;
  let lastDim: SankeyDim = { link: 0.1, node: 0.4, stroke: 0.5 };
  let faded: DimTarget[] = [];
  let cancelLeave: (() => void) | undefined;
  let timing: KeyframeAnimationOptions | null = null;
  const fader = createFader(() => {
    const from = host();
    timing ??= from === null ? { duration: SNAPPY_HOVER_MS, easing: "ease-out", fill: "forwards" } : hoverTiming(from);
    return timing;
  });

  const targetsOf = (): SankeyHoverTargets | null => {
    if (targets === null || !targets.svg.isConnected) {
      const first = surface()?.firstElementChild;
      targets = first instanceof SVGSVGElement ? hoverTargets(first) : null;
    }
    return targets;
  };
  /** The owned svgs in place: the under one before the surface, the over one after it, both in the surface's frame (`.ts-chart-host`), on the svg's view box. */
  const place = (at: SankeyHoverTargets): Overlay | null => {
    const frame = surface();
    const parent = frame?.parentElement;
    if (!frame || !parent) { return null; }
    overlay ??= createOverlay(frame.ownerDocument);
    const { under, over } = overlay;
    if (under.nextElementSibling !== frame) { frame.before(under); }
    if (over.previousElementSibling !== frame) { frame.after(over); }
    for (const svg of [under, over]) {
      for (const name of ["viewBox", "direction", "preserveAspectRatio"]) {
        const value = at.svg.getAttribute(name);
        if (value === null) {
          svg.removeAttribute(name);
        } else if (svg.getAttribute(name) !== value) {
          svg.setAttribute(name, value);
        }
      }
    }
    return overlay;
  };
  /** The groups a dim fades: the renderer's, then the flow and value clones' groups (in from nothing). */
  const fadeTargets = (at: SankeyHoverTargets, ov: Overlay): DimTarget[] => [
    ...dimTargets(at, lastDim),
    { dim: 1, element: ov.flows.group, rest: 0 },
    { dim: 1, element: ov.values.group, rest: 0 },
  ];
  /** The clones for `sets`. */
  const paintItems = (at: SankeyHoverTargets, ov: Overlay, sets: SankeyHoverSets): void => {
    const nodes = sorted(sets.nodes);
    const links = sorted(sets.links);
    const mirror = host()?.hasAttribute(SANKEY_SETTLED_ATTR) !== true;
    // Over (flows: under) its dimmed original, each clone draws at what makes the pair read the item's own opacity.
    const flowAlpha = String(over(hotOpacity(lastDim), fadedFlow(lastDim)));
    const valueAlpha = String(over(VALUE_LABEL_OPACITY, lastDim.node * DIMMED_VALUE_SCALE) / VALUE_LABEL_OPACITY);
    const make = (list: readonly (Element | undefined)[], deep: boolean, prepare?: (clone: Element) => void) => (index: number): Element | null => {
      const original = list[index];
      if (original === undefined) { return null; }
      const clone = cloneOf(original, deep);
      if (clone === null) { return null; }
      prepare?.(clone);
      if (mirror) { mirrorAnimations(original, clone); }
      return clone;
    };
    syncLayer(ov.flows, links, make(at.flows, false, (clone) => {
      // The renderer's non-scaling stroke is undone for the originals by styles.css.
      clone.setAttribute("vector-effect", "none");
      clone.setAttribute("stroke-opacity", flowAlpha);
    }));
    syncLayer(ov.rects, nodes, make(at.rects, false, (clone) => {
      // The node grow scales about the rect's middle (styles.css), should the clone copy it.
      clone.setAttribute("style", "transform-origin:50% 50%;transform-box:fill-box");
    }));
    syncLayer(ov.names, nodes, make(at.names, true));
    // The value text's own fill is the 60% mix (the renderer's attribute): its fill opacity takes it to the clone's alpha.
    syncLayer(ov.values, nodes, make(at.values, true, (clone) => { clone.setAttribute("fill-opacity", valueAlpha); }));
  };
  const clearItems = (): void => {
    if (overlay !== null) {
      for (const layer of [overlay.flows, overlay.rects, overlay.names, overlay.values]) { clearLayer(layer); }
    }
    shown = null;
  };
  const settleAll = (): void => {
    for (const { element } of faded) { fader.settle(element); }
    faded = [];
  };
  const stopLeave = (): void => {
    cancelLeave?.();
    cancelLeave = undefined;
  };
  /** Once the leave's fades have ended they settle (each group reads its styles' rest again) and the clones go: by then the flow and value
   * clones are at 0 and the node and name clones read as their originals do at rest. */
  const armLeave = (fades: readonly Animation[]): void => {
    stopLeave();
    let live = true;
    cancelLeave = (): void => { live = false; };
    // A fade cancelled by a new hover rejects its promise; that hover has already stopped this leave.
    Promise.all(fades.map((animation) => animation.finished)).then(() => {
      if (!live) { return; }
      cancelLeave = undefined;
      settleAll();
      clearItems();
    }, () => undefined);
  };

  return {
    write: (sets, dim) => {
      const at = targetsOf();
      if (at === null) { return; }
      lastDim = dim;
      if (sets === null) {
        if (!dimmed) { return; }
        dimmed = false;
        armLeave(faded.map(({ element, rest }) => fader.fade(element, rest, rest)));
        return;
      }
      const ov = place(at);
      if (ov === null) { return; }
      stopLeave();
      if (!dimmed) {
        dimmed = true;
        faded = fadeTargets(at, ov);
        for (const { element, dim: to, rest } of faded) { fader.fade(element, to, rest); }
      }
      paintItems(at, ov, sets);
      shown = sets;
    },
    refresh: () => {
      targets = null;
      if (overlay === null) { return; }
      const at = targetsOf();
      if (at === null) { return; }
      const ov = place(at);
      if (ov === null) { return; }
      // A render while the leave fades ends it now. Otherwise the render may have replaced the groups and items or dropped what was written
      // on them (a group's fade survives on an element the render kept): new groups take the dim at once, every clone is made again.
      stopLeave();
      const sets = dimmed ? shown : null;
      const next = dimmed ? fadeTargets(at, ov) : [];
      for (const { element } of faded) {
        if (!next.some((target) => target.element === element)) { fader.settle(element); }
      }
      for (const { element, dim: to, rest } of next) {
        if (!fader.has(element)) { fader.fade(element, to, rest, true); }
      }
      faded = next;
      clearItems();
      if (sets !== null) {
        paintItems(at, ov, sets);
        shown = sets;
      }
    },
    reset: () => {
      stopLeave();
      settleAll();
      clearItems();
      dimmed = false;
      targets = null;
    },
    detach: () => {
      stopLeave();
      settleAll();
      clearItems();
      dimmed = false;
      targets = null;
      overlay?.under.remove();
      overlay?.over.remove();
      overlay = null;
    },
  };
};

export { createSankeyHoverWriter, sankeyHoverCss, sankeyHoverSets };
export type { SankeyDim, SankeyHoverFocus };
