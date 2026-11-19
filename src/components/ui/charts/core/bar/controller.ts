import type { ChartRendererRenderContext } from "@tanstack/charts";
import type { ChildTable } from "../carriers/table";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import type { ContainerRef, ChartContext, FocusedRow } from "../cartesian/context";
import { createDataUpdated } from "../data-updated";
import { createReadyGate } from "../entrance/ready-gate";
import type { ReadyGateRun, ReadyStore } from "../entrance/ready-gate";
import { erase } from "../erased-types";
import { createFocusStore } from "../hover/focus-store";
import type { FocusStore } from "../hover/focus-store";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTouchInert, createInteractionHandle } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import { createResizeBox } from "../size/resize";
import type { ResizeBox } from "../size/resize";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import type { ChartSurface } from "../surface/surface";
import { sameCategoryTarget, tooltipTargetStore } from "../surface/tooltip-target";
import { createBarContext } from "./context";
import { barFocusedRow, createBarHost } from "./host";
import { createBarPass } from "./pass";
import type { BarChartOptions, BarPass } from "./pass";
import { createBarLink } from "./link";
import { barSkeletonCount, barSkeletonFill, barSkeletonStyle } from "./skeleton";
import { barSurfaceStyle } from "./view";
import { barA11y } from "./describe";
import type { BarSkeleton, BarView } from "./view";

export interface BarControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface BarController extends ChartController<BarChartOptions, BarView, ChartContext> {
  /** Never null: built from the latest pass, the host box (`size`), the gate and the focus. */
  readonly context: Readable<ChartContext>;
  /** The focused category: the custom children's leaf subscribes (`context` reads it). */
  readonly focus: FocusStore<FocusedRow>;
  /** The interaction-ready gate's flag (the context's `isLoaded`). */
  readonly ready: ReadyStore;
  /** The host's content box, measured while something subscribes (the ports' loading skeleton, and `context`'s subscribers). */
  readonly size: Readable<ResizeBox>;
  /** The custom children's context at the host box `box`. `context` reads it at `size`; React passes the box it keeps in state. */
  contextAt(box: { readonly width: number; readonly height: number }): ChartContext;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<BarChartOptions>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
}

/** Everything one pass derives from the input and the controller's state (what React's render computed). */
interface State {
  readonly pass: BarPass;
  readonly table: ChildTable;
  readonly options: ReturnType<typeof surfaceOptions>;
  readonly view: BarView;
}

const sameKeys = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

/** Runs `callback` in a task of its own (a MessageChannel message, as React's scheduler posts a render). Returns the cancel function. */
const nextTask = (callback: () => void): (() => void) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = (): void => {
    channel.port1.close();
    callback();
  };
  channel.port2.postMessage(null);
  return (): void => { channel.port1.close(); };
};

export function createBarController(env: ChartEnv, initial: ChartInput<BarChartOptions>, options: BarControllerOptions = {}): BarController {
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  // The public context's `containerRef` (the host while attached).
  const containerRef: ContainerRef = { current: null };
  const focus = createFocusStore<FocusedRow>();
  // Moving between the bars of one category changes the primary point, not the body.
  const tooltip = tooltipTargetStore(sameCategoryTarget);
  // The hover indicator (rule, dots, date pill) and the plot rect each draw publishes (host.ts).
  const barHost = createBarHost();
  const handle = createInteractionHandle();
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(() => handle.interaction.current);
  const gate = createReadyGate(() => host);
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  const barPass = createBarPass();
  // syncId / activeIndex (link.ts): the category this chart shares with the others of its group, and its controlled focus.
  const link = createBarLink({
    focus,
    input: () => {
      const { pass } = current();
      return { props: latestInput.props, data: pass.data, categories: pass.categories };
    },
  });
  let linkOff: (() => void) | undefined;
  const updated = createDataUpdated(initial.props.data);
  // Custom marks (squares, depth) only animate enter when they join a painted scene: the first build is seeded until a flip after its paint.
  let entered = false;
  let latestInput = initial;
  let state: State | undefined;
  let changedFromInside: () => void = () => undefined;

  // --- One pass ---------------------------------------------------------------------------------------------------------------
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const surfaceStyleCell = memoCell<BarView["surfaceStyle"]>();
  const skeletonCell = memoCell<BarSkeleton | null>();
  const viewCell = memoCell<BarView>();
  const derive = ({ props, table }: ChartInput<BarChartOptions>): State => {
    const pass = barPass({ props, table, uid, entered, updated: updated(props.data), plot: barHost.plot, legendHovered: env.legendHover?.get().legend ?? null });
    const { built, renderer, chartAspect, ariaLabel, fillHeight, loading, margin } = pass;
    const { ariaDescription } = props;
    const surface = optionsCell([built.definition, renderer, chartAspect, ariaLabel, ariaDescription, props.data, table, loading], () =>
      surfaceOptions(erase({ definition: erase(built.definition), renderer, aspectRatio: chartAspect, ariaLabel, ariaDescription, onFocusChange, onRender: erase(onRender), onTooltipBodyChange: tooltip.onChange, a11y: barA11y({ data: props.data, xDataKey: pass.xDataKey, series: pass.series, loading, horizontal: pass.horizontal, stacked: pass.stacked, table }) }), uid));
    const surfaceStyle = surfaceStyleCell([chartAspect, fillHeight], () => barSurfaceStyle(chartAspect, fillHeight));
    const fill = barSkeletonFill(props.loadingFill, pass.series);
    const skeleton = skeletonCell([loading, pass.data.length, margin, fill], () => (loading ? { barCount: barSkeletonCount(pass.data.length), style: barSkeletonStyle(margin), fill } : null));
    const view = viewCell(
      [pass.hostAttrs, pass.hostStyle, surfaceStyle, pass.staticCss, skeleton, margin, table, pass.data, pass.tooltip, pass.horizontal, pass.depthConfig, surface],
      () => ({ hostAttrs: pass.hostAttrs, hostStyle: pass.hostStyle, surfaceStyle, staticCss: pass.staticCss, skeleton, margin, table, data: pass.data, tooltipBase: pass.tooltip, horizontal: pass.horizontal, depthConfig: pass.depthConfig, surface }),
    );
    return { pass, table, options: surface, view };
  };
  const current = (): State => {
    state ??= derive(latestInput);
    return state;
  };

  // --- The renderer's callbacks --------------------------------------------------------------------------------------------------
  // The state whose options the renderer was last handed: a draw places the indicator from that build (the shell's onRender closed over it).
  let drawn: State | undefined;
  function onRender(context: ChartRendererRenderContext<never, never, never>): void {
    handle.onRender(context);
    link.rendered(context);
    const { built, margin, horizontal } = (drawn ?? current()).pass;
    barHost.draw(context.scene.chart, built, margin, horizontal);
  }
  function onFocusChange(point: { readonly datum: unknown } | null): void {
    hold(erase(point));
    const row = barFocusedRow(point);
    focus.set(row);
    link.focused(row);
  }

  // --- The host's box and the custom children's context -----------------------------------------------------------------------------
  // bklit's react-use-measure box, tracked only while something reads it: a plain bar never measures its host.
  const box = createResizeBox();
  let readers = 0;
  let unobserve: (() => void) | undefined;
  const track = (): void => {
    if (host && readers > 0 && unobserve === undefined) {
      box.measure(host);
      unobserve = box.observe(host);
    }
  };
  const untrack = (): void => {
    unobserve?.();
    unobserve = undefined;
  };
  const size: Readable<ResizeBox> = {
    get: box.get,
    subscribe(listener) {
      const off = box.subscribe(listener);
      readers += 1;
      // Subscribed first, so a reader hears the measure it starts.
      track();
      let subscribed = true;
      return (): void => {
        if (!subscribed) { return; }
        subscribed = false;
        off();
        readers -= 1;
        if (readers === 0) { untrack(); }
      };
    },
  };
  const buildContext = createBarContext();
  const contextAt = (at: { readonly width: number; readonly height: number }): ChartContext => {
    const { pass, table } = current();
    return buildContext({
      data: pass.data,
      xDataKey: pass.xDataKey,
      orientation: pass.orientation,
      stacked: pass.stacked,
      barGap: pass.barGap,
      series: pass.series,
      valueDomain: pass.built.valueDomain,
      margin: pass.margin,
      size: at,
      animationDuration: pass.animationDuration,
      table,
      containerRef,
      interaction: handle.interaction,
      isLoaded: gate.store.get(),
      focused: focus.get(),
    });
  };
  const context: Readable<ChartContext> = {
    get: () => contextAt(box.get()),
    subscribe: (listener) => {
      const offs = [size.subscribe(listener), gate.store.subscribe(listener), focus.subscribe(listener), contextVersion.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  // "self": the stylesheet React renders after the surface (`view.staticCss`), as an element the controller owns.
  let ownedStyle: HTMLStyleElement | null = null;
  const writeOwnedStyle = (): void => {
    const css = current().view.staticCss;
    if (ownedStyle && ownedStyle.textContent !== css) { ownedStyle.textContent = css; }
  };
  /** A commit's layout half: the renderer gets the latest options (RendererChart.js's layout effect). */
  const layout = (): void => {
    const el = surfaceEl;
    if (!el || !host) {
      return;
    }
    drawn = current();
    surfaceOf().render(el, drawn.options);
    link.applied();
    writeOwnedStyle();
  };
  // What the passive work last ran for (React effects' deps); reset by `detach`, so a re-attach runs it again.
  let clockLoading: boolean | undefined;
  let gateDelay: number | undefined;
  let armedLoading: boolean | undefined;
  let followed: readonly unknown[] = [];
  let unfollow: (() => void) | undefined;
  let touchOff: (() => void) | undefined;
  let holdOff: (() => void) | undefined;
  let cancelFlip: (() => void) | undefined;
  const gateRun = (): ReadyGateRun => ({ duration: current().pass.readyDelay });
  /** A commit's passive half, in the order the shell ran these effects. */
  const committed = (): void => {
    const { pass } = current();
    const { loading, horizontal, categories, barGap, margin } = pass;
    // The bars' entrance clock restarts with each reveal (bklit revealEpoch, bar-chart.tsx:372-386).
    if (loading !== clockLoading) {
      clockLoading = loading;
      if (loading) { pass.clock.at = null; }
    }
    if (!host) {
      return;
    }
    // bklit bar chart has mouse handlers only: touch pointers never reach the renderer (interaction/touch-focus.ts).
    touchOff ??= attachTouchInert(host);
    // The seeded build has drawn: one flip builds the full definition, whose update tweens the custom marks in.
    if (pass.needsSeed && !entered && cancelFlip === undefined) {
      const flip = (): void => {
        cancelFlip = undefined;
        entered = true;
        changedFromInside();
      };
      // "adapter": the shell flipped React state, which renders in a task of its own; a sync commit's passive effects run before the
      // paint, and the seed must still paint first.
      if (selfDriven) { flip(); } else { cancelFlip = nextTask(flip); }
    }
    // The ready gate (bklit `canInteract`, bar-chart.tsx:372-386, 549): its timer restarts with a new delay, and a status flip to ready re-arms it
    // (loading holds the skeleton: no reveal, no interaction).
    if (pass.readyDelay !== gateDelay) {
      gateDelay = pass.readyDelay;
      gate.restart(gateRun());
    }
    if (loading !== armedLoading) {
      armedLoading = loading;
      if (!loading) { gate.arm(gateRun()); }
    }
    // The hovered category mirrored onto the host imperatively (no render, no rebuild).
    const geom = [horizontal, categories, barGap, margin.left];
    if (!sameKeys(geom, followed)) {
      followed = geom;
      unfollow?.();
      unfollow = barHost.follow(host, focus, { horizontal, categories, barGap, left: margin.left });
    }
    holdOff ??= hold.attach(host);
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
    const before = state?.view;
    state = derive(latestInput);
    if (state.view !== before) {
      bump(viewVersion);
      bump(contextVersion);
    }
    if (!selfDriven || microtask) {
      return;
    }
    // Never inside the renderer's own callbacks: the next microtask, as a port's own flush would.
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      layout();
      schedulePassive();
    });
  };

  let overlayOff: (() => void) | undefined;
  let legendOff: (() => void) | undefined;
  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context,
    focus,
    ready: gate.store,
    size,
    contextAt,
    prepare(input) {
      latestInput = input;
      state = derive(input);
    },
    update(input) {
      const before = state?.view;
      latestInput = input;
      state = derive(input);
      if (selfDriven && state.view !== before) {
        bump(viewVersion);
        bump(contextVersion);
      }
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    committed,
    attach(dom) {
      host = dom.host;
      surfaceEl = dom.surface;
      // SAFETY: an adapter's chart host is a <div> (the public context types the ref as one).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      containerRef.current = dom.host as HTMLDivElement;
      if (selfDriven) {
        // Where React renders it: after the surface's host element.
        let after: Node = dom.surface;
        while (after.parentNode !== null && after.parentNode !== dom.host) { after = after.parentNode; }
        ownedStyle = dom.host.ownerDocument.createElement("style");
        dom.host.insertBefore(ownedStyle, after.parentNode === dom.host ? after.nextSibling : null);
        writeOwnedStyle();
      }
      // Mount: TanStack's draw publishes the plot rect (onRender).
      drawn = current();
      surfaceOf().render(dom.surface, drawn.options);
      overlayOff = barHost.mount(dom.host);
      linkOff = link.attach(dom.host);
      link.applied();
      // The legend's hovered series is a host attribute of the view (`data-legend`).
      legendOff = env.legendHover?.subscribe(() => { changedFromInside(); });
      track();
      if (selfDriven) { schedulePassive(); }
    },
    mounted() {
      if (cancelPassive !== undefined) {
        cancelPassive();
        cancelPassive = undefined;
        committed();
      }
    },
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      cancelFlip?.();
      cancelFlip = undefined;
      touchOff?.();
      touchOff = undefined;
      holdOff?.();
      holdOff = undefined;
      unfollow?.();
      unfollow = undefined;
      legendOff?.();
      legendOff = undefined;
      untrack();
      overlayOff?.();
      overlayOff = undefined;
      linkOff?.();
      linkOff = undefined;
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      gate.dispose();
      clockLoading = undefined;
      gateDelay = undefined;
      armedLoading = undefined;
      followed = [];
      drawn = undefined;
      host = null;
      surfaceEl = null;
      containerRef.current = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
