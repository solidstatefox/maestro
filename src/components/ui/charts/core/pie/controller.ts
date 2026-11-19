import type { ChartGradient, ChartPoint } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChartController, ChartDom, ChartEnv, ChartInput } from "../chart/controller";
import { erase } from "../erased-types";
import { userGradients } from "../gradients";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus, createInteractionHandle } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import { createPolarHover, polarHoverValue, watchHostHover } from "../polar/hover";
import type { HoverSource } from "../polar/hover";
import { measureNoText } from "../polar/measure-no-text";
import { MAX_INDEX } from "../polar/polar-dim";
import { createFluidWidth, INITIAL_WIDTH_PX } from "../size/fluid-width";
import type { FluidWidth } from "../size/fluid-width";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import type { StyleObject } from "../style";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import { pieA11y } from "../polar/describe";
import type { ChartSurface } from "../surface/surface";
import type { TooltipTarget } from "../surface/tooltip-target";
import type { PieChartProps, PieSliceProps, PieStableValue } from "../types/pie";
import type { PolarHoverValue } from "../types/polar";
import type { PieArcRow } from "./arc";
import { createPieContext, pieContextValue } from "./context";
import { PIE_RENDERER, pieIndexOf } from "./definition";
import { DEFAULT_HOVER_OFFSET, FULL_SWEEP_END_ANGLE, MIN_PIE_SIZE_PX, createPieModel } from "./model";
import type { PieModel } from "./model";
import { PIE_SLICE_ROLE, pieHostAttrs, pieOwnedStyle, pieSurfaceStyle } from "./view";
import type { PieView } from "./view";

/** The public context's `containerRef`: the host while connected. */
type PieContainerRef = { current: HTMLDivElement | null };

/** What `usePieStable()` returns. */
export type PieStable = PieStableValue<PieContainerRef>;

/** What `usePie()` returns: the stable half with the hovered index and its setter. */
export type PieContext = PieStable & PolarHoverValue;

/** The props a PieChart hands its controller (the adapter keeps `className`, merges the reader's `style` and places its children itself). */
export interface PieProps extends Omit<PieChartProps<unknown, unknown>, "children" | "className" | "style"> {
  /** On the client and past hydration (React: `useIsClient`): the chart is drawn only then. A port leaves it out: its chart is drawn once
   * `connect` has its host (decision 1 of docs/plans/bklit-charts-ports.md: no SVG on the server). */
  readonly client?: boolean;
}

export interface PieControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface PieController extends ChartController<PieProps, PieView, PieContext> {
  /** Never null: `usePie()`, the stable half with the hover's. */
  readonly context: Readable<PieContext>;
  /** `usePieStable()`: the geometry and data, rebuilt with the pass (never on hover). */
  readonly stable: Readable<PieStable>;
  /** The hover index the centre and `usePieHover()` read (PieHoverCoordinatorContext). */
  readonly hover: HoverSource;
  /** The host the adapter rendered, from its mount, and null once it unmounts (React passes it as the host's ref). */
  readonly connect: (host: HTMLElement | null) => void;
  /** Mounts the renderer into `dom.surface` (the pie aligns no entrance: motion's own clock starts at the mount). */
  attach(dom: ChartDom): void;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<PieProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
}

/** The width follow's threshold in px (the epsilon React's pie handed `useFluidWidth` before W5). */
const FLUID_EPSILON_PX = 0.5;
const DEFAULT_START_ANGLE = -Math.PI / 2;
const DEFAULT_ARIA_LABEL = "Pie chart";

/** Everything one pass derives from the input and the controller's state (what the React shell's render computed). */
interface Pass {
  /** No `size`: the width is measured and followed. */
  readonly fluid: boolean;
  /** The measured width (`INITIAL_WIDTH_PX` until the first measure) and whether it was measured. */
  readonly width: FluidWidth;
  readonly hoveredIndex: number | null | undefined;
  /** `geometryScrubbing` off: the host mirrors the hover. */
  readonly mirrorHover: boolean;
  readonly model: PieModel;
  readonly stable: PieStable;
  readonly options: ReturnType<typeof surfaceOptions>;
  readonly view: PieView;
}

export function createPieController(env: ChartEnv, initial: ChartInput<PieProps>, options: PieControllerOptions = {}): PieController {
  const selfDriven = options.commits !== "adapter";
  // The pie reads neither the static preview nor the springs config (its React shell read neither): its entrance is the slices' own.
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  const containerRef: PieContainerRef = { current: null };
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let pass: Pass | undefined;
  const hover = createPolarHover<PieArcRow>(pieIndexOf);
  // The renderer's interaction controller, from each draw (`resolvePointer` / `setControlledFocus` for the tap focus and the hold).
  const interaction = createInteractionHandle();
  const getInteraction = () => interaction.interaction.current;
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(getInteraction);
  // Fluid mode: the chart mounts at the width ParentSize's chain delivers (observer, then one frame; bklit pie-chart.tsx:500), then the host's
  // own observer follows (size/fluid-width.ts). The definition's annular hit targets and the grow outlines are pixel geometry, so TanStack's
  // host cannot size this chart (TanStack-native host sizing only brings a first-layout paint). Fixed from the first input on: ready at once.
  const width = createFluidWidth(INITIAL_WIDTH_PX, initial.props.size !== undefined && initial.props.size !== 0);
  let changedFromInside: () => void = () => undefined;
  width.subscribe(() => { changedFromInside(); });

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's useMemo did) -------------------------
  const pieModel = createPieModel();
  const pieContext = createPieContext<PieContainerRef>();
  const slicesCell = memoCell<readonly PieSliceProps[]>();
  const gradientsCell = memoCell<readonly ChartGradient[]>();
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const attrsCell = memoCell<PieView["hostAttrs"]>();
  const ownedStyleCell = memoCell<PieView["ownedStyle"]>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const viewCell = memoCell<PieView>();

  const derive = ({ props, table }: ChartInput<PieProps>): Pass => {
    const {
      data, size: fixedSize, innerRadius = 0, padAngle = 0, cornerRadius = 0, startAngle = DEFAULT_START_ANGLE, endAngle = FULL_SWEEP_END_ANGLE,
      hoveredIndex, onHoverChange, hoverOffset = DEFAULT_HOVER_OFFSET, enterTransition, enterStaggerScale = 1, geometryScrubbing = false,
      ariaLabel = DEFAULT_ARIA_LABEL, ariaDescription,
    } = props;
    const measured = width.get();
    const fluid = fixedSize === undefined || fixedSize === 0;
    const size = fluid ? measured.width : fixedSize;
    // The hover reads the latest props (React: each render, as the focus callback's closure held them).
    hover.update({ hoveredIndex, onHoverChange });
    const slices = slicesCell([table], () => propsFor<PieSliceProps>(table, PIE_SLICE_ROLE));
    // The reader's LinearGradient / RadialGradient children, as the definition's resources (a slice's `fill="url(#id)"` paints with one).
    const gradients = gradientsCell([table], () => userGradients(table));
    const model = pieModel({
      cornerRadius, data, endAngle, enterStaggerScale, enterTransition, fixedSize, geometryScrubbing,
      gradients, hoverOffset, idPrefix: uid, innerRadius, padAngle, size, slices, startAngle,
    });
    // Mounted and measured in the browser (a port's chart is on the client once connected): the chart is drawn unless collapsed, and the
    // context reports it loaded.
    const isLoaded = (props.client ?? host !== null) && measured.ready;
    const stable = pieContext({
      arcs: model.arcs, containerRef, cornerRadius, data, enterStaggerScale, enterTransition, geometryScrubbing, getColor: model.getColor,
      getFill: model.getFill, hoverOffset, innerRadius, isLoaded, padAngle, size, totalValue: model.totalValue,
    });
    const surface = optionsCell([model.definition, size, ariaLabel, ariaDescription, data, innerRadius, table], () =>
      surfaceOptions(erase({ definition: model.definition, renderer: PIE_RENDERER, width: size, height: size, initialWidth: size, measureText: measureNoText, ariaLabel, ariaDescription, onFocusChange, onRender: interaction.onRender, a11y: pieA11y(data, innerRadius > 0, table) }), uid));
    const { collapsed } = model;
    const hostAttrs = attrsCell([collapsed, model.grow], () => pieHostAttrs(collapsed ? undefined : model.grow));
    const ownedStyle = ownedStyleCell([collapsed, model.dimCss], () => (collapsed ? null : pieOwnedStyle(model.dimCss)));
    const surfaceStyle = isLoaded && !collapsed ? surfaceStyleCell([size], () => pieSurfaceStyle(size)) : null;
    const hostStyle = collapsed ? model.boxStyle : model.hostStyle;
    const view = viewCell([collapsed, hostAttrs, hostStyle, ownedStyle, surfaceStyle, surface], () => ({ collapsed, hostAttrs, hostStyle, ownedStyle, surfaceStyle, surface }));
    return { fluid, width: measured, hoveredIndex, mirrorHover: !geometryScrubbing, model, stable, options: surface, view };
  };

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  function onFocusChange(point: ChartPoint<PieArcRow, number, number> | null): void {
    hold(erase(point));
    hover.focusChange(point);
  }

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  // useFluidWidth's layout effect (React's before W5; core/size/fluid-width.ts): once measured, the host's own observer follows it, re-attached when the
  // measured width crosses the collapse threshold (the fallback box) or the mode changes.
  let followOn: HTMLElement | null = null;
  let followKey: string | undefined;
  let followOff: (() => void) | undefined;
  const follow = (): void => {
    const { fluid, width: { ready, width: measured } } = current();
    const key = `${fluid}|${ready}|${measured < MIN_PIE_SIZE_PX}`;
    if (host === followOn && key === followKey) {
      return;
    }
    followOff?.();
    followOff = undefined;
    followOn = host;
    followKey = key;
    if (host && fluid && ready) { followOff = width.follow(host, FLUID_EPSILON_PX); }
  };
  /** A commit's layout half: the renderer gets the latest options (RendererChart.js's layout effect), then the width follow. */
  const layout = (): void => {
    const el = surfaceEl;
    if (el) { surfaceOf().render(el, current().options); }
    follow();
  };

  // The passive work's keys (React effects' deps) and the host it ran on; `connect(null)` resets them, so a re-connect runs it again.
  let ranOn: HTMLElement | null = null;
  let measureKey: string | undefined;
  let cancelMeasure: (() => void) | undefined;
  let listenersOff: (() => void) | undefined;
  let controlled: { readonly index: number | null | undefined } | undefined;
  let mirrorKey: string | undefined;
  let mirrorOff: (() => void) | undefined;
  // The host mirror retargets the springs of the latest pass's rows (polar/polar-dim.ts `createPieHoverSprings`).
  const retarget = (el: HTMLElement, previous: number | null, next: number | null): void => { current().model.hoverSprings(el, previous, next); };
  /** A commit's passive half, as React ran the shell's effects: every cleanup due, then the setups in its hook order (the width measure, the tap
   * focus, the controlled hover, the keyboard hold, the host mirror). */
  const committed = (): void => {
    const el = host;
    const { fluid, width: { ready }, hoveredIndex, mirrorHover, model: { collapsed } } = current();
    const fresh = el !== ranOn;
    const nextMeasure = `${fluid}|${ready}`;
    const nextMirror = `${mirrorHover}|${collapsed}`;
    const remeasure = fresh || nextMeasure !== measureKey;
    const remirror = fresh || nextMirror !== mirrorKey;
    if (remeasure) {
      cancelMeasure?.();
      cancelMeasure = undefined;
    }
    if (fresh) {
      listenersOff?.();
      listenersOff = undefined;
    }
    if (remirror) {
      mirrorOff?.();
      mirrorOff = undefined;
    }
    ranOn = el;
    measureKey = nextMeasure;
    mirrorKey = nextMirror;
    // The first width, on ParentSize's chain (size/fluid-width.ts `measure`).
    if (remeasure && el && fluid && !ready) { cancelMeasure = width.measure(el); }
    // bklit's pie has mouse handlers only: a tap is its hover under touch (UPSTREAM-GAPS #39).
    const tapOff = fresh && el ? attachTapFocus(el, getInteraction, "tap") : undefined;
    // A controlled `hoveredIndex` goes into the source after the commit that received it (React: a passive effect on the prop).
    if (controlled === undefined || !Object.is(controlled.index, hoveredIndex)) {
      controlled = { index: hoveredIndex };
      hover.control(hoveredIndex);
    }
    const holdOff = fresh && el ? hold.attach(el) : undefined;
    if (tapOff || holdOff) {
      listenersOff = (): void => {
        tapOff?.();
        holdOff?.();
      };
    }
    // `data-hover` on the host, which the dim and pop CSS keys on; scrub mode shows no hover.
    if (remirror && el) { mirrorOff = watchHostHover(hover.source, () => host, mirrorHover, MAX_INDEX, retarget); }
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
  const rederive = (): void => {
    const before = pass;
    pass = derive(latestInput);
    if (pass.view !== before?.view) { bump(viewVersion); }
    if (pass.stable !== before?.stable) { bump(contextVersion); }
  };
  changedFromInside = (): void => {
    rederive();
    if (!selfDriven || microtask) {
      return;
    }
    // A measured width arrives in a ResizeObserver or frame callback: the renderer gets it in the next microtask, as a port's own flush would.
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      // Disconnected meanwhile (the adapter unmounted): nothing left to hand over.
      if (host !== null) {
        layout();
        schedulePassive();
      }
    });
  };

  /** Undoes the host's work (`connect`): the measure, the follow, the listeners, the mirror, the scheduled passive work. */
  const release = (): void => {
    cancelPassive?.();
    cancelPassive = undefined;
    cancelMeasure?.();
    cancelMeasure = undefined;
    followOff?.();
    followOff = undefined;
    listenersOff?.();
    listenersOff = undefined;
    mirrorOff?.();
    mirrorOff = undefined;
    ranOn = null;
    followOn = null;
    measureKey = undefined;
    followKey = undefined;
    mirrorKey = undefined;
    controlled = undefined;
  };

  const hoverValueCell = memoCell<PieContext>();
  const context: Readable<PieContext> = {
    get: () => {
      const { stable } = current();
      const hovered = hover.source.getHovered();
      return hoverValueCell([stable, hovered], () => pieContextValue(stable, polarHoverValue(hover.source, hovered)));
    },
    subscribe: (listener) => {
      const offs = [contextVersion.subscribe(listener), hover.source.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    // The pie reports values in its centre, never in a tooltip (definition.ts `tooltip: false`).
    tooltip: readonly(writable<TooltipTarget | null>(null)),
    context,
    stable: { get: () => current().stable, subscribe: contextVersion.subscribe },
    hover: hover.source,
    connect: (el) => {
      if (el === host) {
        return;
      }
      if (host !== null) { release(); }
      host = el;
      // SAFETY: an adapter's chart host is a <div> (the public context types the ref as one).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      containerRef.current = el as HTMLDivElement | null;
      if (!selfDriven || el === null) {
        return;
      }
      rederive();
      layout();
      schedulePassive();
    },
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      latestInput = input;
      if (selfDriven) {
        rederive();
      } else {
        pass = derive(input);
      }
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    committed,
    attach(dom) {
      surfaceEl = dom.surface;
      // Mount: TanStack's draw runs the definition, then `onRender` hands over the interaction controller.
      surfaceOf().render(dom.surface, current().options);
    },
    mounted() {
      // bklit's pie arms nothing after its mount (no ready gate): the entrance is motion's own, from the mount.
    },
    detach() {
      chart?.destroy();
      surfaceEl = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
