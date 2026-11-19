import { motion } from "@tanstack/charts/motion";
import type { ChartRendererRenderContext } from "@tanstack/charts";
import type { ChildTable } from "../carriers/table";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import type { ChartContext, ContainerRef, FocusedRow } from "../cartesian/context";
import { createDataUpdateStep } from "../cartesian/data-update-step";
import type { DataUpdateStep, UpdateSequence } from "../cartesian/data-update-step";
import { gridAttrsOf, hasHighlight } from "../cartesian/definition";
import type { PlotStore } from "../cartesian/plot-size";
import { resolveSeries } from "../cartesian/series";
import type { ResolvedSeries } from "../cartesian/series";
import { armReveal } from "../entrance/arm";
import { createReadyGate } from "../entrance/ready-gate";
import { erase } from "../erased-types";
import type { FocusStore } from "../hover/focus-store";
import { writeLegendHover } from "../hover/host-sync";
import { createDragSelect } from "../interaction/drag-select";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { afterPaint } from "../lifecycle/after-paint";
import { highlightBandClip } from "../markup/band-clip";
import { seriesHighlightBands } from "../cartesian/series-marks";
import { memoCell } from "../memo";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import { composedA11y } from "./describe";
import type { ChartSurface } from "../surface/surface";
import { sameCategoryTarget, tooltipTargetStore } from "../surface/tooltip-target";
import type { StyleObject } from "../style";
import { DEFAULT_ANIMATION_MS, DEFAULT_MARGIN, parseAspectRatio } from "../theme";
import type { ChartMargin } from "../theme";
import type { ComposedChartProps } from "../types/composed";
import { createBarGrow } from "./bar-grow";
import type { SeriesBarSpec } from "./bars";
import { createComposedContext } from "./context";
import { composedStepDeps, createComposedDefinition } from "./definition";
import { candleSpecOf, scatterSpecsOf } from "./extras";
import type { ComposedCandleSpec, ComposedScatterSpec } from "./extras";
import { createComposedHover } from "./hover";
import type { ComposedHoverPass } from "./hover";
import { DEFAULT_BAR_GAP, enterDurationMs, seriesBarSpecs } from "./props";
import { seriesOrder } from "./series-order";
import { composedHostStyle, composedSurfaceStyle, composedTooltipBase } from "./view";
import { withRangeRows } from "../cartesian/view";
import { overlayResourcesFor, rangeResourcesFor } from "../cartesian/features";
import type { ComposedView } from "./view";

/** The props a ComposedChart hands its controller (the adapter keeps `className` and renders the custom children). */
export type ComposedProps = Omit<ComposedChartProps<unknown>, "children" | "className">;

export interface ComposedControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface ComposedController extends ChartController<ComposedProps, ComposedView, ChartContext> {
  /** Never null: before the first draw it holds the empty plot. */
  readonly context: Readable<ChartContext>;
  /** The plot the latest draw published. */
  readonly plot: PlotStore;
  /** The focused row: the custom children's leaf subscribes (`context` reads it). */
  readonly focus: FocusStore<FocusedRow>;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<ComposedProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
  /** The reveal arm: the bars grow, the wipe opens, the ready gate starts. "adapter": called from the adapter's reveal trigger (its two passive commits), as
   * `mounted` does for "self". */
  readonly arm: () => void;
}

const ORDER_SEPARATOR = "\u0000";
/** The `onPhaseChange` the passive work has not seen yet (React ran that effect at mount whatever the prop). */
const NOT_NOTIFIED = /* @__PURE__ */ Symbol("not notified");

/** Everything one pass derives from the input and the controller's state (what React's render computed). */
interface Pass {
  readonly duration: number;
  readonly revealSignature: string;
  readonly entered: boolean;
  /** The inputs a draw's publish and a focus read (hover.ts). */
  readonly hover: ComposedHoverPass;
  readonly table: ChildTable;
  readonly barSize: number | undefined;
  readonly maxBarSize: number | undefined;
  readonly stackGap: number;
  readonly step: UpdateSequence;
  readonly onPhaseChange: ComposedProps["onPhaseChange"];
  readonly options: ReturnType<typeof surfaceOptions>;
  readonly view: ComposedView;
}

export function createComposedController(env: ChartEnv, initial: ChartInput<ComposedProps>, options: ComposedControllerOptions = {}): ComposedController {
  const selfDriven = options.commits !== "adapter";
  // The React shell never read the static preview: the composed entrance plays in previews too.
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  let ownedStyle: HTMLStyleElement | null = null;
  // The public context's `containerRef` (the host while attached).
  const containerRef: ContainerRef = { current: null };
  const tooltip = tooltipTargetStore(sameCategoryTarget);
  const gate = createReadyGate(() => host);
  const grow = createBarGrow();
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let pass: Pass | undefined;
  // The signature the reveal arm last entered (the React shell's `enteredSig` state): the bars are entered while it is the current one.
  let enteredSig: string | null = null;
  let changedFromInside: () => void = () => undefined;

  // --- The inputs a draw and a focus read: the memo cells keep each value's identity while its inputs hold (as React's useMemo did) -----
  const marginCell = memoCell<ChartMargin>();
  const seriesCell = memoCell<ResolvedSeries[]>();
  const orderKeyCell = memoCell<string>();
  const orderCell = memoCell<string[]>();
  const barsCell = memoCell<SeriesBarSpec[]>();
  const candleCell = memoCell<ComposedCandleSpec | null>();
  const scattersCell = memoCell<ComposedScatterSpec[]>();
  const hoverPassOf = ({ props, table }: ChartInput<ComposedProps>): ComposedHoverPass => {
    const margin = marginCell([props.margin], () => ({ ...DEFAULT_MARGIN, ...props.margin }));
    const series = seriesCell([table], () => resolveSeries(table));
    const orderKey = orderKeyCell([table], () => seriesOrder(table).join(ORDER_SEPARATOR));
    const order = orderCell([orderKey], () => orderKey.split(ORDER_SEPARATOR).filter(Boolean));
    const bars = barsCell([table], () => seriesBarSpecs(table));
    const candle = candleCell([table], () => candleSpecOf(table));
    const scatters = scattersCell([table], () => scatterSpecsOf(table));
    return { uid, data: props.data, xDataKey: props.xDataKey ?? "date", margin, series, bars, candle, scatters, order, stacked: props.stacked ?? false, barGap: props.barGap ?? DEFAULT_BAR_GAP, table };
  };
  const hover = createComposedHover({ host: () => host, sheet: () => ownedStyle }, hoverPassOf(initial));
  // bklit's drag selection (interaction/drag-select.ts): the press hides the tooltip and bar fade, the drag dims the series (host attributes only).
  const drag = createDragSelect({ geom: () => hover.dragGeom.current, host: { drag: hover.hostSync.drag, press: hover.hostSync.press } });
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts, UPSTREAM-GAPS #42).
  const hold = createKeyboardFocusHold(() => drag.interaction.current);
  let dataStep: DataUpdateStep | undefined;

  // --- One pass ------------------------------------------------------------------------------------------------------------------
  const build = createComposedDefinition();
  const rendererCell = memoCell<ReturnType<typeof motion>>();
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const attrsCell = memoCell<ComposedView["hostAttrs"]>();
  const hostStyleCell = memoCell<StyleObject>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const resourcesCell = memoCell<ComposedView["resources"]>();
  const tooltipBaseCell = memoCell<ComposedView["tooltipBase"]>();
  const viewCell = memoCell<ComposedView>();

  const derive = (input: ChartInput<ComposedProps>): Pass => {
    const { props, table } = input;
    const { aspectRatio = "2 / 1", barSize, maxBarSize, stackGap = 0, revealSignature = "", ariaLabel = "Composed chart", ariaDescription } = props;
    const duration = enterDurationMs(props.animationDuration ?? DEFAULT_ANIMATION_MS, props.enterTransition);
    const entered = enteredSig === revealSignature;
    const hoverPass = hoverPassOf(input);
    // Each draw publishes with this pass's inputs.
    hover.update(hoverPass);
    const { data, xDataKey, margin, series, bars, candle, scatters, order, stacked, barGap } = hoverPass;
    const buildInput = { data, xDataKey, table, series, bars, candle, scatters, yDomains: props.yDomains, barEdgeInset: props.barEdgeInset !== false, order, margin, uid, duration, aspectRatio, barSize, maxBarSize, barGap, stacked, stackGap, entered };
    dataStep ??= createDataUpdateStep(data, composedStepDeps(buildInput));
    // Adjusted in this pass, so its build already draws the new step.
    const step = dataStep.update(data, composedStepDeps(buildInput));
    const definition = build({ ...buildInput, update: step, growing: grow.growing, onBuilt: hover.publish });
    // `initial: "always"` replays the entrance on hydrated (server-rendered) SVG too.
    const renderer = rendererCell([duration], () => motion(erase({ initial: "always", transition: { type: "tween", duration } })));
    const chartAspect = parseAspectRatio(aspectRatio);
    const surface = optionsCell([definition, renderer, chartAspect, ariaLabel, ariaDescription, props.data, table], () =>
      surfaceOptions(erase({ definition: erase(definition), renderer, aspectRatio: chartAspect, ariaLabel, ariaDescription, onFocusChange, onRender: erase(onRender), onTooltipBodyChange: tooltip.onChange, a11y: composedA11y(props.data, xDataKey, table) }), uid));
    const hostAttrs = attrsCell([table], () => ({ "data-bkm-chart": "composed", "data-slot": "chart", "data-bkm-kit": uid, ...gridAttrsOf(table, false) }));
    const hostStyle = hostStyleCell([aspectRatio, duration], () => composedHostStyle(aspectRatio, duration));
    const surfaceStyle = surfaceStyleCell([chartAspect], () => composedSurfaceStyle(chartAspect));
    const highlight = hasHighlight(series);
    const resources = resourcesCell([highlight, series, table], () => [highlight ? highlightBandClip(`${uid}-hlband`, seriesHighlightBands(series)) : null, overlayResourcesFor(table, uid), rangeResourcesFor(table, uid)]);
    const tooltipBase = tooltipBaseCell([series, bars, candle, scatters, order, table], () => withRangeRows(composedTooltipBase(series, bars, order, candle, scatters), table));
    const view = viewCell([hostAttrs, hostStyle, surfaceStyle, resources, table, data, tooltipBase, surface], () => ({ hostAttrs, hostStyle, surfaceStyle, resources, table, data, tooltipBase, surface }));
    return { duration, revealSignature, entered, hover: hoverPass, table, barSize, maxBarSize, stackGap, step, onPhaseChange: props.onPhaseChange, options: surface, view };
  };

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- What the renderer reports ---------------------------------------------------------------------------------------------------
  function onFocusChange(point: Parameters<typeof hover.focusPoint>[0]): void {
    hold(erase(point));
    hover.focusPoint(point);
  }
  // Reported after each draw: the data-update step ends its snap / glide from the domains the draw built.
  function onRender(context: ChartRendererRenderContext<never, never, never>): void {
    drag.onRender(context);
    hover.rendered();
    const snapshot = hover.plot.get();
    if (snapshot && dataStep?.settle(snapshot.built, current().step.step)) {
      changedFromInside();
    }
  }

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  let listenersOff: (() => void) | undefined;
  let syncing = false;
  // The signature the mounted renderer was drawn for, and whether the latest options handed over are entered (React's `[entered]` effect deps).
  let mountedFor: string | undefined;
  let drawnEntered = false;
  /** A commit's layout half: the renderer gets the latest options (RendererChart.js's layout effect). */
  const layout = (): void => {
    const { options: opts, revealSignature, entered } = current();
    drawnEntered = entered;
    const el = surfaceEl;
    if (!el || !host) {
      return;
    }
    // React keyed the RendererChart on `revealSignature`: a new one destroys the mounted chart and mounts a fresh one (its seeds, the wipe closed),
    // with a fresh tooltip leaf.
    if (mountedFor !== undefined && mountedFor !== revealSignature) {
      chart?.destroy();
      chart = undefined;
      tooltip.onChange(null);
    }
    mountedFor = revealSignature;
    syncing = true;
    try {
      surfaceOf().render(el, opts);
    } finally {
      syncing = false;
    }
  };
  // The keys the passive work last ran for (React effects' deps); reset by `detach`, so a re-attach runs it again.
  let armedFor: string | undefined;
  let phaseNotified: ComposedProps["onPhaseChange"] | typeof NOT_NOTIFIED = NOT_NOTIFIED;
  let settledFor: boolean | undefined;
  let gateDuration: number | undefined;
  const arm = (): void => {
    const { revealSignature, duration } = current();
    armedFor = revealSignature;
    grow.arm();
    enteredSig = revealSignature;
    gate.arm({ duration });
    changedFromInside();
  };
  /** A commit's passive half, in the order React ran these effects (RevealArm's, a child's, first). */
  const committed = (): void => {
    const { revealSignature, onPhaseChange, duration } = current();
    // RevealArm's effect re-ran with the new signature's callback: once armed, it arms again, before the shell's own effects.
    if (armedFor !== undefined && armedFor !== revealSignature) { arm(); }
    if (onPhaseChange !== phaseNotified) {
      phaseNotified = onPhaseChange;
      onPhaseChange?.("ready");
    }
    // The entered build is drawn (or a new signature drew the seeds): later updates (hover, resize) run unstaggered. As React's `[entered]` effect ran, this
    // follows a new signature's re-arm above, so that signature's bars reach their heights without the staggered grow (the wipe replays).
    if (drawnEntered !== settledFor) {
      settledFor = drawnEntered;
      grow.settle();
    }
    if (duration !== gateDuration) {
      gateDuration = duration;
      gate.restart({ duration });
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
  changedFromInside = (): void => {
    const before = pass?.view;
    pass = derive(latestInput);
    if (pass.view !== before) { bump(viewVersion); }
    bump(contextVersion);
    if (!selfDriven || microtask) {
      return;
    }
    // Never inside the renderer's own callbacks (a draw's settle): the next microtask, as a port's own flush would.
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      if (!host) { return; }
      if (!syncing) { layout(); }
      schedulePassive();
    });
  };

  // --- Host listeners -----------------------------------------------------------------------------------------------------------
  const listen = (el: HTMLElement): (() => void) => {
    // The hover indicator (crosshair, dots, date pill) is an element we own, appended after the surface.
    const overlayOff = hover.attach(el);
    const dragOff = drag.attach(el);
    const holdOff = hold.attach(el);
    const legend = env.legendHover;
    const legendOff = legend ? legend.subscribe(() => { writeLegendHover(el, legend.get()); }) : undefined;
    if (legend) { writeLegendHover(el, legend.get()); }
    return (): void => {
      overlayOff();
      dragOff();
      holdOff();
      legendOff?.();
    };
  };

  // The custom children's context: built when read, from the plot, the ready gate, the focus and the latest pass; a field keeps its object while its content holds.
  // The value itself is held while its inputs are, so a read between changes skips the build (a framework's store read compares snapshots; the bridged
  // context also holds its fields, core/cartesian/context.ts `createBridgedContext`).
  const buildContext = createComposedContext();
  const contextCell = memoCell<ChartContext>();
  const context: Readable<ChartContext> = {
    get: () => {
      const { hover: { data, xDataKey, margin, series, bars, barGap, stacked }, duration, barSize, maxBarSize, stackGap, table } = current();
      const snapshot = hover.plot.get();
      const isLoaded = gate.store.get();
      const focused = hover.focus.get();
      return contextCell([snapshot, isLoaded, focused, data, xDataKey, margin, series, bars, duration, barSize, maxBarSize, barGap, stacked, stackGap, table], () =>
        buildContext({ snapshot, isLoaded, focused, containerRef, interaction: drag.interaction, data, xDataKey, margin, series, bars, duration, barSize, maxBarSize, barGap, stacked, stackGap, table }));
    },
    subscribe: (listener) => {
      const offs = [hover.plot.subscribe(listener), gate.store.subscribe(listener), hover.focus.subscribe(listener), contextVersion.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };

  let cancelArm: (() => void) | undefined;
  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context,
    plot: hover.plot,
    focus: hover.focus,
    arm,
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      const before = pass?.view;
      latestInput = input;
      pass = derive(input);
      if (selfDriven && pass.view !== before) { bump(viewVersion); bump(contextVersion); }
      layout();
      if (selfDriven && host) { schedulePassive(); }
    },
    committed,
    attach(dom) {
      host = dom.host;
      surfaceEl = dom.surface;
      // SAFETY: an adapter's chart host is a <div> (the public context types the ref as one).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      containerRef.current = dom.host as HTMLDivElement;
      // The owned stylesheet is the host's first child, where React rendered it.
      ownedStyle = dom.host.ownerDocument.createElement("style");
      dom.host.insertBefore(ownedStyle, dom.host.firstChild);
      // Mount: TanStack's draw runs `chart()`, which publishes the plot and writes the owned style.
      layout();
      listenersOff = listen(dom.host);
      if (selfDriven) { schedulePassive(); }
    },
    mounted() {
      cancelArm?.();
      cancelArm = armReveal(() => host, arm);
    },
    detach() {
      cancelArm?.();
      cancelArm = undefined;
      cancelPassive?.();
      cancelPassive = undefined;
      listenersOff?.();
      listenersOff = undefined;
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      gate.dispose();
      grow.settle();
      // A re-attach mounts like a first mount: seeds, then the arm (React's StrictMode re-attach comes before any arm, so nothing changes there).
      enteredSig = null;
      armedFor = undefined;
      phaseNotified = NOT_NOTIFIED;
      settledFor = undefined;
      gateDuration = undefined;
      mountedFor = undefined;
      host = null;
      surfaceEl = null;
      containerRef.current = null;
      const before = pass?.view;
      pass = derive(latestInput);
      if (selfDriven && pass.view !== before) { bump(viewVersion); }
    },
    prerender: () => surfaceOf().prerender(),
  };
}
