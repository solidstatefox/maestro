import { createSvgChartRenderer } from "@tanstack/charts/svg/renderer";
import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChartClock, ChartController, ChartEnv, ChartInput } from "../chart/controller";
import type { ContainerRef } from "../cartesian/context";
import { alignEntranceStart } from "../entrance/entrance-origin";
import type { AnyInteraction } from "../erased-types";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import { createPolarHover, polarHoverValue, watchHostHover } from "../polar/hover";
import type { HoverSource } from "../polar/hover";
import { measureNoText } from "../polar/measure-no-text";
import { MAX_INDEX } from "../polar/polar-dim";
import { INITIAL_WIDTH_PX, createFluidWidth } from "../size/fluid-width";
import { writable } from "../store";
import type { Readable } from "../store";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import { ringA11y } from "../polar/describe";
import type { ChartSurface } from "../surface/surface";
import type { TooltipTarget } from "../surface/tooltip-target";
import type { PolarHoverValue } from "../types/polar";
import type { RingChartProps, RingGridProps, RingLabelsProps, RingProps, RingStableValue } from "../types/ring";
import type { RingArcRow } from "./arc";
import { createRingContext, ringContextValue } from "./context";
import { RING_GRID_CARRIER, RING_LABELS_CARRIER } from "./decor-roles";
import { ringIndexOf } from "./definition";
import { MIN_RING_SIZE_PX, RING_ENTRANCE_ORIGINS, createRingModel } from "./model";
import { RING_HOST_ATTRS, ringSurfaceStyle } from "./view";
import type { RingView } from "./view";

/** The props a RingChart hands its controller (the adapter keeps `className`, `style` and `children`; `animationDuration` has no effect). */
export type RingControllerProps = Omit<RingChartProps<unknown, unknown>, "animationDuration" | "children" | "className" | "style">;

/** The carrier role of `Ring` in the table: React reads its children (ring/model.tsx `classifyRingChildren`), a port registers each `Ring`. */
export const RING_CARRIER = "ring";
export { RING_GRID_CARRIER, RING_LABELS_CARRIER };

/** `useRingStable()`: the geometry after the fit, the data and the getters. */
export type RingStable = RingStableValue<ContainerRef>;
/** `useRing()`: the stable half with the hover's. */
export type RingContext = RingStable & PolarHoverValue;

export interface RingControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

/** The ring's host: its surface mounts later, through `setSurface`. */
export interface RingDom {
  readonly host: HTMLElement;
}

export interface RingController extends ChartController<RingControllerProps, RingView, RingContext> {
  /** Never null: `useRing()`'s value, a new object when the geometry or the hovered ring changes. */
  readonly context: Readable<RingContext>;
  /** `useRingStable()`: the geometry and data without the hover (custom children that should not re-render on hover). */
  readonly stable: Readable<RingStable>;
  /** The hovered ring: `RingCenter`, `useRingHover()` and a reader's `setHoveredIndex` go through it. */
  readonly hover: HoverSource;
  /** Takes over the host: the width measure and follow, the listeners, the hover mirror; mounts the surface if one was handed over. */
  attach(dom: RingDom, clock: ChartClock): void;
  /** The surface element the adapter rendered for `view.showSurface` (`null` once it unmounts): the renderer mounts into it, the entrance
   * aligned first, both before the next paint; and is destroyed with it. Stable, so it serves as a ref callback. */
  readonly setSurface: (surface: HTMLElement | null) => void;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<RingControllerProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
}

const NONE: readonly RingProps[] = [];
// The ring reports values in its centre (RingCenter), not a tooltip: the definition has `tooltip: false`.
const NO_TOOLTIP: Readable<TooltipTarget | null> = { get: () => null, subscribe: () => () => undefined };
// The width follow drops changes under half a pixel (size/fluid-width.ts `follow`).
const FOLLOW_EPSILON_PX = 0.5;

const isFixed = (size: number | undefined): size is number => size !== undefined && size !== 0;

/** Everything one pass derives from the input and the controller's state (what the React shell's render computed). */
interface Pass {
  /** A `size` prop: nothing is measured. */
  readonly fixed: boolean;
  /** The width is known (fixed, or measured once). */
  readonly ready: boolean;
  /** The fluid width is under the collapse size (the follow re-attaches on crossing it). */
  readonly fluidCollapsed: boolean;
  readonly hoveredIndex: number | null | undefined;
  readonly geometryScrubbing: boolean;
  readonly collapsed: boolean;
  readonly ringSprings: (host: HTMLElement, previous: number | null, next: number | null) => void;
  readonly stable: RingStable;
  readonly options: ReturnType<typeof surfaceOptions<RingArcRow, number, number>>;
  readonly view: RingView;
}

export function createRingController(env: ChartEnv, initial: ChartInput<RingControllerProps>, options: RingControllerOptions = {}): RingController {
  const selfDriven = options.commits !== "adapter";
  // Only the id is read: the ring's entrance and hover take no chart config, and a static preview plays the entrance as a live chart does.
  const { uid } = env;
  let host: HTMLElement | null = null;
  // The surface element handed over (`setSurface`) and the one the renderer is mounted in.
  let surfaceEl: HTMLElement | null = null;
  let mountedIn: HTMLElement | null = null;
  // The public context's `containerRef`, and the host the hit test reads its live ring scale from (definition.ts `scaleOf`).
  const containerRef: ContainerRef = { current: null };
  let clock: ChartClock | undefined;
  // "self": when a pass after `attach` showed the surface (the port renders it in that task, as React's mounting render starts), so a fluid
  // chart's entrance counts from there, not from setup. React's clock is live (its latest render's start).
  let surfaceShownAt: number | undefined;
  // `performance.now()` at the start of the pass that mounts the surface: motion's creation clock for the progress sweep and the tracks' entrance.
  const renderStart = {
    get current(): number | null {
      return surfaceShownAt ?? clock?.renderStart ?? null;
    },
  };
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  // The first width on ParentSize's chain, then the host's own observer (size/fluid-width.ts); a fixed chart is ready from the start.
  const fluid = createFluidWidth(INITIAL_WIDTH_PX, isFixed(initial.props.size));
  const hover = createPolarHover<RingArcRow>(ringIndexOf);
  // The mounted chart's interaction controller (from each draw's `onRender`), read at event time by the hold and tap focus.
  let interaction: AnyInteraction | null = null;
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts, gap #42).
  const hold = createKeyboardFocusHold(() => interaction);
  const ringModel = createRingModel();
  const ringContext = createRingContext<ContainerRef>();
  // TanStack's React `Chart` (dist/react/Chart.js): the svg renderer over `renderChartSvg`.
  const renderer = createSvgChartRenderer<RingArcRow, number, number>();
  let latestInput = initial;
  let pass: Pass | undefined;

  function onFocusChange(point: ChartPoint<RingArcRow, number, number> | null): void {
    hold(point);
    hover.focusChange(point);
  }
  function onRender(context: ChartRendererRenderContext<RingArcRow, number, number>): void {
    interaction = context.interaction;
  }

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's useMemo did) -------------------------
  const optionsCell = memoCell<Pass["options"]>();
  const surfaceStyleCell = memoCell<RingView["surfaceStyle"]>();
  const viewCell = memoCell<RingView>();

  const derive = ({ props, table }: ChartInput<RingControllerProps>): Pass => {
    const {
      data, size: fixedSize, strokeWidth = 12, ringGap = 6, baseInnerRadius = 60, startAngle = -Math.PI / 2, endAngle = (3 * Math.PI) / 2,
      enterTransition, enterStaggerScale = 1, geometryScrubbing = false, hoveredIndex, onHoverChange, ariaLabel = "Ring chart", ariaDescription, padding,
    } = props;
    const fixed = isFixed(fixedSize);
    const { width, ready } = fluid.get();
    const size = fixed ? fixedSize : width;
    hover.update({ hoveredIndex, onHoverChange });
    // The Ring carriers' props in declaration order; none keeps one empty list, so the model's cells hold.
    const rings = table.has(RING_CARRIER) ? propsFor<RingProps>(table, RING_CARRIER) : NONE;
    // The first RingGrid and RingLabels, as bklit renders whichever it is given (a second draws twice there; one here).
    const grid = table.has(RING_GRID_CARRIER) ? propsFor<RingGridProps>(table, RING_GRID_CARRIER).at(0) : undefined;
    const labels = table.has(RING_LABELS_CARRIER) ? propsFor<RingLabelsProps>(table, RING_LABELS_CARRIER).at(0) : undefined;
    const model = ringModel({
      baseInnerRadius, data, endAngle, enterStaggerScale, enterTransition, fixedSize, geometryScrubbing, grid, labels, padding,
      hostRef: containerRef, hoverSource: hover.source, renderStart, ringGap, rings, size, startAngle, strokeWidth,
    });
    const stable = ringContext({
      baseInnerRadius, containerRef, data, endAngle, enterStaggerScale, enterTransition, fit: model.fit, geometryScrubbing,
      getColor: model.getColor, getRingRadii: model.getRingRadii, ringGap, size, startAngle, strokeWidth, totalValue: model.totalValue,
    });
    // TanStack's `Chart` options (dist/react/Chart.js over RendererChart.js:42-62): the chart drawn at `size` px square, no text to measure.
    const surface = optionsCell([model.definition, size, ariaLabel, ariaDescription, data, table], () => surfaceOptions<RingArcRow, number, number>({
      ariaDescription, ariaLabel, definition: model.definition, height: size, initialWidth: size, measureText: measureNoText, onFocusChange, onRender, renderer, width: size,
      a11y: ringA11y(data, table),
    }, uid));
    const { collapsed } = model;
    const showSurface = ready && !collapsed;
    const surfaceStyle = surfaceStyleCell([size], () => ringSurfaceStyle(size));
    const hostStyle = collapsed ? model.boxStyle : model.hostStyle;
    const view = viewCell([hostStyle, collapsed, showSurface, surfaceStyle, surface], () => ({ hostAttrs: RING_HOST_ATTRS, hostStyle, collapsed, showSurface, surfaceStyle, surface }));
    return { fixed, ready, fluidCollapsed: width < MIN_RING_SIZE_PX, hoveredIndex, geometryScrubbing, collapsed, ringSprings: model.ringSprings, stable, options: surface, view };
  };

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface<RingArcRow, number, number> | undefined;
  const surfaceOf = (): ChartSurface<RingArcRow, number, number> => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  let cancelAlign: (() => void) | undefined;
  let followed: string | undefined;
  let unfollow: (() => void) | undefined;
  const unmountSurface = (): void => {
    cancelAlign?.();
    cancelAlign = undefined;
    chart?.destroy();
    mountedIn = null;
    interaction = null;
  };
  /** A commit's layout half, in the shell's order: the surface's own layout effects (EntranceAlign, then RendererChart's), then the width follow. */
  const layout = (): void => {
    const el = host;
    if (!el) {
      return;
    }
    if (mountedIn !== null && mountedIn !== surfaceEl) {
      unmountSurface();
    }
    if (surfaceEl !== null) {
      if (mountedIn === null) {
        // EntranceAlign's layout effect, before the renderer mounts: the tracks' CSS entrance re-stamped to motion's clock (entrance/entrance-origin.ts).
        cancelAlign = alignEntranceStart(() => host, RING_ENTRANCE_ORIGINS, renderStart.current ?? "frame");
        mountedIn = surfaceEl;
      }
      // Every commit hands the renderer its latest options and mounts it the first time (RendererChart.js's layout effect).
      surfaceOf().render(surfaceEl, current().options);
    }
    // useFluidWidth's follow (its layout effect, keyed on enabled, ready and the fluid collapse).
    const { fixed, ready, fluidCollapsed } = current();
    const key = `${fixed}|${ready}|${fluidCollapsed}`;
    if (key !== followed) {
      followed = key;
      unfollow?.();
      unfollow = !fixed && ready ? fluid.follow(el, FOLLOW_EPSILON_PX) : undefined;
    }
  };
  // The keys the passive work last ran for (the shell's effects' deps); reset by `detach`, so a re-attach runs it again.
  let measuredKey: string | undefined;
  let cancelMeasure: (() => void) | undefined;
  let tapOff: (() => void) | undefined;
  let controlled: { readonly index: number | null | undefined } | undefined;
  let holdOff: (() => void) | undefined;
  let watchedKey: string | undefined;
  let unwatch: (() => void) | undefined;
  /** A commit's passive half, in the order the shell ran these effects. */
  const committed = (): void => {
    const el = host;
    if (!el) {
      return;
    }
    const { fixed, ready, hoveredIndex, geometryScrubbing, collapsed } = current();
    // useFluidWidth's first measure (keyed on enabled and ready).
    const measure = `${fixed}|${ready}`;
    if (measure !== measuredKey) {
      measuredKey = measure;
      cancelMeasure?.();
      cancelMeasure = !fixed && !ready ? fluid.measure(el) : undefined;
    }
    // A tap focuses the ring under it, under touch (UPSTREAM-GAPS #39).
    tapOff ??= attachTapFocus(el, () => interaction, "tap");
    // A controlled `hoveredIndex` into the source (usePolarHover's effect on the prop).
    if (controlled === undefined || !Object.is(controlled.index, hoveredIndex)) {
      controlled = { index: hoveredIndex };
      hover.control(hoveredIndex);
    }
    holdOff ??= hold.attach(el);
    // The host's `data-hover` mirror and the springs retargeted from it (useHostHoverAttr, keyed on enabled and the collapse).
    const watch = `${geometryScrubbing}|${collapsed}`;
    if (watch !== watchedKey) {
      watchedKey = watch;
      unwatch?.();
      unwatch = watchHostHover(hover.source, () => host, !geometryScrubbing, MAX_INDEX, (target, previous, next) => { current().ringSprings(target, previous, next); });
    }
  };
  let cancelPassive: (() => void) | undefined;
  let microtask = false;
  const schedulePassive = (): void => {
    cancelPassive?.();
    cancelPassive = afterPaint(() => {
      cancelPassive = undefined;
      committed();
    });
  };
  /** "self": a change reaches the renderer in a microtask, never inside the renderer's or the observer's callbacks, and its passive work runs
   * after the paint. A surface element the port renders for the change arrives through `setSurface`, which schedules again if this one ran. */
  const scheduleLayout = (): void => {
    if (!selfDriven || microtask) {
      return;
    }
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      if (host) {
        layout();
        schedulePassive();
      }
    });
  };
  /** A new pass for `input`; "self": tells the port's view and context, and stamps a surface the change shows once attached (its render starts now). */
  const advance = (input: ChartInput<RingControllerProps>): void => {
    const before = pass;
    latestInput = input;
    pass = derive(input);
    if (!selfDriven) {
      return;
    }
    if (host !== null && pass.view.showSurface && before?.view.showSurface !== true) {
      surfaceShownAt = performance.now();
    }
    if (pass.view !== before?.view) { bump(viewVersion); }
    if (pass.stable !== before?.stable) { bump(contextVersion); }
  };
  // A width from the measure or the follow: a new pass, as useFluidWidth's state update re-rendered the shell ("adapter": the view tells it).
  fluid.subscribe(() => {
    const before = pass?.view;
    advance(latestInput);
    if (!selfDriven && pass?.view !== before) { bump(viewVersion); }
    scheduleLayout();
  });

  // The public context: built when read, from the latest pass's stable half and the hovered ring; the same object while both hold.
  const contextCell = memoCell<RingContext>();
  const context: Readable<RingContext> = {
    get: () => {
      const { stable } = current();
      const hovered = hover.source.getHovered();
      return contextCell([stable, hovered], () => ringContextValue(stable, polarHoverValue(hover.source, hovered)));
    },
    subscribe: (listener) => {
      const offs = [hover.source.subscribe(listener), contextVersion.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: NO_TOOLTIP,
    context,
    stable: { get: () => current().stable, subscribe: contextVersion.subscribe },
    hover: hover.source,
    setSurface: (surface) => {
      if (surface === surfaceEl) {
        return;
      }
      surfaceEl = surface;
      if (host) { scheduleLayout(); }
    },
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      advance(input);
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    committed,
    attach(dom, nextClock) {
      host = dom.host;
      // SAFETY: an adapter's chart host is a <div> (the public context types the ref as one).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      containerRef.current = dom.host as HTMLDivElement;
      clock = nextClock;
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    // Nothing to arm (see the head of this file): the centre's roll-in is its own leaf's (polar/center.ts `createFlowIntro`).
    mounted: () => undefined,
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      unmountSurface();
      unfollow?.();
      unfollow = undefined;
      followed = undefined;
      cancelMeasure?.();
      cancelMeasure = undefined;
      measuredKey = undefined;
      tapOff?.();
      tapOff = undefined;
      controlled = undefined;
      holdOff?.();
      holdOff = undefined;
      unwatch?.();
      unwatch = undefined;
      watchedKey = undefined;
      host = null;
      containerRef.current = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
