import type { ContainerRef } from "../cartesian/context";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { erase } from "../erased-types";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus, createInteractionHandle } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import { createFluidWidth } from "../size/fluid-width";
import type { FluidWidth } from "../size/fluid-width";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import type { StyleObject } from "../style";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import { heatmapA11y } from "./describe";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import type { HeatmapContextValue, HeatmapHoverCoordinator } from "../types/heatmap";
import { createHeatmapCellLayer } from "./cell-layer";
import { createHeatmapContext, createHeatmapHoverCoordinator, resolveHeatmapCoordinator } from "./context";
import { createHeatmapGridFocus } from "./grid-focus";
import { applyHeatmapLabelClasses } from "./label-classes";
import { createHeatmapTooltipGlide } from "./tooltip-glide";
import type { HeatmapLabelClasses } from "./label-classes";
import { watchHeatmapHoverAttrs, watchHeatmapHoverSheet } from "./hover-attrs";
import { createHeatmapPass, HEATMAP_INITIAL_WIDTH_PX, HEATMAP_RENDERER, HEATMAP_WIDTH_EPSILON_PX } from "./pass";
import type { HeatmapPass, HeatmapPassProps } from "./pass";
import { HEATMAP_SURFACE_CLASS_NAME, heatmapHostAttrs, heatmapResourceHost, heatmapSurfaceStyle } from "./view";
import type { HeatmapChartView, HeatmapView } from "./view";
import { hostPointerMove } from "../interaction/host-pointer";

/** What `useHeatmap()` returns: the chart's layout, scales and settings, its host as `containerRef`. */
export type HeatmapContext<Style> = HeatmapContextValue<ContainerRef, Style>;

/** The props a HeatmapChart hands its controller (the adapter keeps `className` and places its children itself). */
export interface HeatmapProps extends HeatmapPassProps {
  /** The coordinator an enclosing `HeatmapInteractionProvider` shares (React: its context), or null: the chart then uses its own
   * (`controller.coordinator`), which the adapter provides to its children. */
  readonly coordinator?: HeatmapHoverCoordinator | null;
}

export interface HeatmapControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

/** The heatmap's host: its surface comes later, through `setSurface`. */
export interface HeatmapDom {
  readonly host: HTMLElement;
}

export interface HeatmapController<Style> extends ChartController<HeatmapProps, HeatmapView<Style>, HeatmapContext<Style>> {
  /** Never null: `useHeatmap()`, rebuilt with the pass (never on hover). "adapter": read it in the render, after `prepare` (it notifies
   * only in "self" mode). */
  readonly context: Readable<HeatmapContext<Style>>;
  /** The chart's own coordinator, for an adapter to provide to its children when no `HeatmapInteractionProvider` encloses the chart. */
  readonly coordinator: HeatmapHoverCoordinator;
  /** Takes the host's work; the renderer mounts once the surface element arrives (`setSurface`). No clock: the reveal clock is stamped by
   * the pass that mounts the svg. Re-attachable after `detach` (StrictMode). */
  attach(dom: HeatmapDom): void;
  /** The surface element (`ts-chart-surface`) the adapter renders while `view.chart` is set, and null when it goes (React: its ref). */
  readonly setSurface: (surface: HTMLElement | null) => void;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<HeatmapProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
}

/** Everything one pass derives from the input and the controller's state. */
interface Pass<Style> {
  /** The width was measured (`HEATMAP_INITIAL_WIDTH_PX` until then). */
  readonly ready: boolean;
  /** The chart is drawn: measured, large enough, with a `HeatmapCells` carrier. */
  readonly shown: boolean;
  /** The coordinator the chart reports to: the enclosing provider's, else its own. */
  readonly coordinator: HeatmapHoverCoordinator;
  readonly hoverEmphasis: boolean;
  readonly hoverLook: HeatmapPass<Style>["hoverLook"];
  readonly model: HeatmapPass<Style>;
  readonly options: ReturnType<typeof surfaceOptions>;
  readonly view: HeatmapView<Style>;
}

/** The renderer's tooltip element, a child of the surface (styles.css matches it the same way), and the mark of a leaving one. */
const TOOLTIP_SELECTOR = ":scope > .ts-chart-tooltip";
const TOOLTIP_OUT_ATTR = "data-hm-out";

/** The inner box a legend level's rule goes in: the surface's host box's parent (host > inner box > ts-chart-host > ts-chart-surface). */
const innerBoxOf = (surface: HTMLElement | null): HTMLElement | null => surface?.parentElement?.parentElement ?? null;

export function createHeatmapController<Style>(env: ChartEnv, initial: ChartInput<HeatmapProps>, options: HeatmapControllerOptions = {}): HeatmapController<Style> {
  const selfDriven = options.commits !== "adapter";
  // The heatmap reads neither the static preview nor the config: its entrance is the cells' own.
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  const containerRef: ContainerRef = { current: null };
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let pass: Pass<Style> | undefined;
  const ownCoordinator = createHeatmapHoverCoordinator();
  const tooltip = tooltipTargetStore();
  // The renderer's interaction controller, from each draw: the grid arrows, the press focus and the hold read it at event time.
  const handle = createInteractionHandle();
  const getInteraction = () => handle.interaction.current;
  const grid = createHeatmapGridFocus({ capture: handle.onRender, interaction: getInteraction });
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(getInteraction);
  // The first width on ParentSize's chain, then the host's own observer (size/fluid-width.ts): a post-mount width change is a resize, which
  // would cancel the entrance, so the svg mounts once, at the measured width.
  // `layout="fill"` follows the host's height too (bklit useElementSize), to fit the cells in it.
  const width = createFluidWidth(HEATMAP_INITIAL_WIDTH_PX, false, { height: () => latestInput.props.layout === "fill" });
  // The cells' entrance, shimmer, conceal and hover lift, on the cells each draw leaves (cell-layer.ts).
  const cells = createHeatmapCellLayer();
  // The readers' label and separator classes on the drawn elements (label-classes.ts): after each draw and each commit.
  let classesOn: HeatmapLabelClasses | null = null;
  const labelClasses = (): void => {
    const next = pass?.model.labelClasses ?? null;
    if (surfaceEl !== null && (next !== null || classesOn !== null)) {
      applyHeatmapLabelClasses(surfaceEl, next, classesOn);
      classesOn = next;
    }
  };
  // bklit's tooltip fades out after its hideDelay hold (TooltipBox exit): the leaving tooltip is marked, and styles.css fades it after the
  // host's `--bkm-hm-hide-delay` (the native `hideDelay`, tooltip.ts `heatmapTooltipHold`, keeps it that long plus the fade). One attribute
  // on one element per change.
  let tooltipEl: Element | null = null;
  const focusChange: typeof grid.focusChange = (point) => {
    grid.focusChange(point);
    if (tooltipEl?.parentElement !== surfaceEl || tooltipEl === null) { tooltipEl = surfaceEl?.querySelector(TOOLTIP_SELECTOR) ?? null; }
    if (point === null) { tooltipEl?.setAttribute(TOOLTIP_OUT_ATTR, ""); } else { tooltipEl?.removeAttribute(TOOLTIP_OUT_ATTR); }
  };
  // The tooltip's glide from cell to cell (tooltip-glide.ts): a Web Animation of its `translate`, the plain renderer having no tooltip motion.
  const glide = createHeatmapTooltipGlide();
  const onRender: typeof grid.onRender = (context) => {
    grid.onRender(context);
    if (surfaceEl !== null) { cells.drawn(surfaceEl, context.scene); }
    labelClasses();
  };
  let changedFromInside: () => void = () => undefined;
  width.subscribe(() => { changedFromInside(); });

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's useMemo did) -------------------------
  const heatmapPass = createHeatmapPass<Style>({ getScene: grid.getScene, idPrefix: uid });
  const buildContext = createHeatmapContext<ContainerRef, Style>();
  const hostAttrs = heatmapHostAttrs(uid);
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const resourcesCell = memoCell<HeatmapChartView["resources"]>();
  const chartCell = memoCell<HeatmapChartView>();
  const viewCell = memoCell<HeatmapView<Style>>();

  const derive = ({ props, table }: ChartInput<HeatmapProps>): Pass<Style> => {
    const measured: FluidWidth = width.get();
    const coordinator = resolveHeatmapCoordinator(props.coordinator ?? null, ownCoordinator);
    const model = heatmapPass({ liveHeight: measured.height, liveWidth: measured.width, props, table });
    cells.latest(model.cellLayer);
    // The grid focus reads the latest pass's grid, coordinator and hold at event time.
    grid.latest({ columnCount: model.columnCount, coordinator, hold, interactive: model.interactive, rowCount: model.rowCount });
    const shown = measured.ready && model.isRenderable && model.cellsProps !== undefined;
    const surface = optionsCell([model.definition, model.ariaLabel, model.ariaDescription, model.chartWidth, model.surfaceHeight, measured.width, props.data, table, props.status], () =>
      surfaceOptions(erase({
        definition: model.definition, renderer: HEATMAP_RENDERER, ariaLabel: model.ariaLabel, ariaDescription: model.ariaDescription, width: model.chartWidth,
        height: model.surfaceHeight, initialWidth: measured.width, onFocusChange: focusChange, onRender, onTooltipBodyChange: tooltip.onChange,
        a11y: heatmapA11y(props.data, table, props.status === "loading"),
      }), uid));
    const surfaceStyle = surfaceStyleCell([model.chartWidth, model.surfaceHeight], () => heatmapSurfaceStyle(model.chartWidth, model.surfaceHeight));
    const resources = resourcesCell([model.resources], () => heatmapResourceHost(uid, model.resources));
    const chart = shown
      ? chartCell([model.innerStyle, surfaceStyle, resources, model.loadingLabel], () => ({ innerStyle: model.innerStyle, surfaceClassName: HEATMAP_SURFACE_CLASS_NAME, surfaceStyle, resources, loadingLabel: model.loadingLabel }))
      : null;
    const view = viewCell([model.hostStyle, chart, model.tooltipBody], () => ({ hostAttrs, hostStyle: model.hostStyle, chart, tooltipBody: model.tooltipBody }));
    return { ready: measured.ready, shown, coordinator, hoverEmphasis: model.hoverEmphasis, hoverLook: model.hoverLook, model, options: surface, view };
  };

  const current = (): Pass<Style> => {
    pass ??= derive(latestInput);
    return pass;
  };

  // The custom children's context: the pass's fields with the host as `containerRef`; the value keeps its object while they hold.
  const context: Readable<HeatmapContext<Style>> = {
    get: () => buildContext({ ...current().model.context, containerRef }),
    subscribe: contextVersion.subscribe,
  };

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  // useFluidWidth's layout effect (React's before W5; core/size/fluid-width.ts): once measured, the host's own observer follows the width.
  let followOn: HTMLElement | null = null;
  let followReady = false;
  let followOff: (() => void) | undefined;
  const follow = (): void => {
    const { ready } = current();
    if (host === followOn && ready === followReady) {
      return;
    }
    followOff?.();
    followOff = undefined;
    followOn = host;
    followReady = ready;
    if (host && ready) { followOff = width.follow(host, HEATMAP_WIDTH_EPSILON_PX); }
  };
  // The hovered cell's lift and a legend level's rule while the emphasis runs, from the commit that shows the chart.
  let sheetOn: { readonly box: HTMLElement; readonly coordinator: HeatmapHoverCoordinator; readonly scales: boolean } | null = null;
  let sheetOff: (() => void) | undefined;
  const syncSheet = (): void => {
    const { shown, hoverEmphasis, hoverLook, coordinator } = current();
    const hoverScales = hoverLook.scaled;
    const box = host && shown && hoverEmphasis ? innerBoxOf(surfaceEl) : null;
    if (box === (sheetOn?.box ?? null) && (box === null || (coordinator === sheetOn?.coordinator && hoverScales === sheetOn.scales))) {
      return;
    }
    sheetOff?.();
    sheetOff = undefined;
    sheetOn = box === null ? null : { box, coordinator, scales: hoverScales };
    if (box !== null) {
      const sheetDone = watchHeatmapHoverSheet(coordinator, box, uid, hoverScales);
      const liftDone = cells.watchLift(coordinator);
      sheetOff = (): void => {
        sheetDone();
        liftDone();
      };
    }
  };
  /** A commit's layout half: the renderer mounts into the surface or gets the latest options (RendererChart.js's layout effect), then the
   * width follow, the lift and a legend level's rule. */
  const layout = (): void => {
    const el = surfaceEl;
    // The glide follows the surface (a re-attach after `detach` gets it back here) and the latest pass's curve.
    glide.surface(el);
    glide.curve(current().model.tooltipGlide);
    if (host && el && current().shown) {
      cells.beforeDraw(el);
      surfaceOf().render(el, current().options);
      labelClasses();
    }
    follow();
    syncSheet();
  };

  // The passive work's keys (React effects' deps) and the host it ran on; `detach` resets them, so a re-attach runs it again.
  let ranOn: HTMLElement | null = null;
  let hoverOn: { readonly coordinator: HeatmapHoverCoordinator; readonly look: HeatmapPass<Style>["hoverLook"] } | null = null;
  let hoverOff: (() => void) | undefined;
  let measureKey: boolean | undefined;
  let cancelMeasure: (() => void) | undefined;
  let legendOn: HeatmapHoverCoordinator | null = null;
  let legendOff: (() => void) | undefined;
  let listenersOff: (() => void) | undefined;
  /** A commit's passive half, in React's effect order: every cleanup due, then the setups (the hover attributes, the press focus, the width
   * measure, the keyboard hold, the legend release). The grid's host listeners go around the hold's, in the order a
   * dispatch from React's root (above the host) gives them: the capture keydown before it (a grid arrow never reaches it), the focusout and
   * the pointer move after it. */
  const committed = (): void => {
    const el = host;
    if (el === null) {
      return;
    }
    const { ready, shown, hoverEmphasis, hoverLook, coordinator } = current();
    const fresh = el !== ranOn;
    const nextHover = shown && hoverEmphasis ? { coordinator, look: hoverLook } : null;
    const rehover = fresh || nextHover?.coordinator !== hoverOn?.coordinator || nextHover?.look !== hoverOn?.look;
    const remeasure = fresh || ready !== measureKey;
    const relegend = fresh || coordinator !== legendOn;
    if (rehover) {
      hoverOff?.();
      hoverOff = undefined;
    }
    if (fresh) {
      listenersOff?.();
      listenersOff = undefined;
    }
    if (remeasure) {
      cancelMeasure?.();
      cancelMeasure = undefined;
    }
    if (relegend) {
      legendOff?.();
      legendOff = undefined;
    }
    ranOn = el;
    hoverOn = nextHover;
    measureKey = ready;
    legendOn = coordinator;
    // `data-hm-hover`, `data-hm-scale`, `data-hm-shrink`, `data-hm-decor` on the host, following the coordinator.
    if (rehover && nextHover !== null) { hoverOff = watchHeatmapHoverAttrs(nextHover.coordinator, () => host, nextHover.look); }
    // bklit's cells have pointer handlers: under touch, the cell under the finger is the hover while it is down (UPSTREAM-GAPS #39).
    const tapOff = fresh ? attachTapFocus(el, getInteraction, "press") : undefined;
    // The first width, on ParentSize's chain (size/fluid-width.ts `measure`).
    if (remeasure && !ready) { cancelMeasure = width.measure(el); }
    if (fresh) {
      el.addEventListener("keydown", grid.keyDown, true);
      const holdOff = hold.attach(el);
      el.addEventListener("focusout", grid.blur);
      el.addEventListener(hostPointerMove(el), grid.release);
      listenersOff = (): void => {
        tapOff?.();
        el.removeEventListener("keydown", grid.keyDown, true);
        holdOff();
        el.removeEventListener("focusout", grid.blur);
        el.removeEventListener(hostPointerMove(el), grid.release);
      };
    }
    if (relegend) { legendOff = grid.watchLegend(coordinator); }
  };
  let cancelPassive: (() => void) | undefined;
  const schedulePassive = (): void => {
    cancelPassive?.();
    cancelPassive = afterPaint(() => {
      cancelPassive = undefined;
      committed();
    });
  };
  let lastContext: HeatmapContext<Style> | undefined;
  const rederive = (): void => {
    const before = pass?.view;
    pass = derive(latestInput);
    if (pass.view !== before) { bump(viewVersion); }
    const value = context.get();
    if (value !== lastContext) {
      lastContext = value;
      bump(contextVersion);
    }
  };
  let microtask = false;
  /** "self": the renderer gets the latest pass in the next microtask (never inside the renderer's own callbacks, nor a framework's patch),
   * then the passive work after the next paint. */
  const flush = (): void => {
    if (microtask) {
      return;
    }
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      // Detached meanwhile (the adapter unmounted): nothing left to hand over.
      if (host !== null) {
        layout();
        schedulePassive();
      }
    });
  };
  changedFromInside = (): void => {
    if (!selfDriven) {
      // React re-renders (on the default lane: a state update) and its render prepares the pass with the change.
      bump(viewVersion);
      return;
    }
    rederive();
    flush();
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context,
    coordinator: ownCoordinator,
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      // "adapter": the pass this commit's render prepared, unless a different input arrives.
      if (selfDriven || input !== latestInput || pass === undefined) {
        latestInput = input;
        if (selfDriven) {
          rederive();
        } else {
          pass = derive(input);
        }
      }
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    committed,
    attach(dom) {
      host = dom.host;
      // SAFETY: an adapter's chart host is a <div> (the public context types the ref as one).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      containerRef.current = dom.host as HTMLDivElement;
      // A surface already there (a re-attach) gets its renderer back.
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    setSurface: (el) => {
      if (el === surfaceEl) {
        return;
      }
      // The surface went (or was replaced): its renderer goes with it (RendererChart.js's layout cleanup), and its cells' motion.
      if (surfaceEl !== null) {
        chart?.destroy();
        cells.destroy();
      }
      surfaceEl = el;
      glide.surface(el);
      if (el !== null && selfDriven) { flush(); }
    },
    mounted() {
      // The heatmap's reveal starts in the draw that adds its cells (cell-layer.ts): nothing to arm at the host's mount.
    },
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      hoverOff?.();
      hoverOff = undefined;
      listenersOff?.();
      listenersOff = undefined;
      cancelMeasure?.();
      cancelMeasure = undefined;
      legendOff?.();
      legendOff = undefined;
      followOff?.();
      followOff = undefined;
      sheetOff?.();
      sheetOff = undefined;
      chart?.destroy();
      cells.destroy();
      glide.surface(null);
      ranOn = null;
      hoverOn = null;
      measureKey = undefined;
      legendOn = null;
      followOn = null;
      followReady = false;
      sheetOn = null;
      host = null;
      containerRef.current = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
