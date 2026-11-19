import { measureNoText } from "../polar/measure-no-text";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import type { ChartContext, ContainerRef, FocusedRow } from "../cartesian/context";
import { refreshTickVars } from "../cartesian/date-pill";
import { HoverOverlay } from "../cartesian/hover-overlay";
import { createReadyGate } from "../entrance/ready-gate";
import type { ReadyGateRun } from "../entrance/ready-gate";
import { erase } from "../erased-types";
import { createFocusStore } from "../hover/focus-store";
import type { FocusStore } from "../hover/focus-store";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachPressGuard, createInteractionHandle } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import type { RevealClock } from "../size/reveal-clock";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import type { ScatterChartProps } from "../types/cartesian";
import { createScatterContext } from "./context";
import { createSizeStore } from "./definition";
import { createScatterHover } from "./hover";
import type { ScatterFocusPoint } from "./hover";
import { createScatterPass } from "./pass";
import { scatterA11y } from "./describe";
import type { ScatterPass, ScatterPassProps } from "./pass";
import { scatterSurfaceStyle, scatterTooltipBase } from "./view";
import type { ScatterView } from "./view";

/** The props a ScatterChart hands its controller (the adapter keeps `className`, `style`, `children` and the `revealSignature` remount). */
export type ScatterProps = ScatterPassProps & Pick<ScatterChartProps<unknown, unknown>, "onPhaseChange">;

export interface ScatterControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface ScatterController extends ChartController<ScatterProps, ScatterView, ChartContext> {
  /** Never null: before the first draw it holds the empty plot. */
  readonly context: Readable<ChartContext>;
  /** The focused row: the custom children's leaf subscribes (`context` reads it). */
  readonly focus: FocusStore<FocusedRow>;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). The render after `attach` reveals. */
  prepare(input: ChartInput<ScatterProps>): void;
  /** "adapter": after every commit (passive). */
  committed(): void;
}

/** One pass: what the pass derives plus what the controller adds around it. */
interface Pass {
  readonly pass: ScatterPass;
  readonly options: ReturnType<typeof surfaceOptions>;
  readonly view: ScatterView;
}

export function createScatterController(env: ChartEnv, initial: ChartInput<ScatterProps>, options: ScatterControllerOptions = {}): ScatterController {
  // bklit's ScatterChart reads no static preview, chart config or legend: `env` gives the chart its id only.
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  // The public context's `containerRef` (the host while attached).
  const containerRef: ContainerRef = { current: null };
  // The plot size comes from TanStack's own measure (the definition's `chart` callback writes it).
  const size = createSizeStore();
  const focus = createFocusStore<FocusedRow>();
  const tooltip = tooltipTargetStore();
  // The hover indicator (crosshair, dots, date pill) is an element we own, appended to the host and moved imperatively (core/cartesian/hover-overlay.ts).
  const overlay = new HoverOverlay();
  const handle = createInteractionHandle();
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(() => handle.interaction.current);
  const hover = createScatterHover({ host: () => host, size, focus, overlay, hold });
  // After each render: the renderer's interaction, and the x tick labels' fade inputs the render stripped (date-pill.ts `writeTickVar`).
  const onRender = (context: Parameters<typeof handle.onRender>[0]): void => {
    handle.onRender(context);
    refreshTickVars(host);
  };
  const gate = createReadyGate(() => host);
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let pass: Pass | undefined;
  // The two-pass mount: `attach` draws the unrevealed pass and leaves the reveal pending; the reveal clock is stamped where it lands.
  let revealed = false;
  let revealPending = false;
  let clock: RevealClock = { mountedAt: null };

  const derivePass = createScatterPass(uid, size);
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const surfaceStyleCell = memoCell<ScatterView["surfaceStyle"]>();
  const tooltipBaseCell = memoCell<ScatterView["tooltipBase"]>();
  const viewCell = memoCell<ScatterView>();
  const derive = ({ props, table }: ChartInput<ScatterProps>): Pass => {
    const p = derivePass({ props, table, revealed, revealClock: clock });
    const { built, renderer, aspectRatio, ariaLabel, ariaDescription } = p;
    // Axes use fixed margins and no label thinning, so layout never reads text metrics; skipping the DOM measurer also skips its font-load re-render (renderer.ts handleFontLoad).
    const surface = optionsCell([built.definition, aspectRatio, ariaLabel, ariaDescription, props.data, table], () =>
      surfaceOptions(erase({ definition: erase(built.definition), renderer, aspectRatio, ariaLabel, ariaDescription, onFocusChange, measureText: measureNoText, onRender, onTooltipBodyChange: tooltip.onChange, a11y: scatterA11y(props.data, props.xDataKey ?? "date", table, props.formatXLabel) }), uid));
    const surfaceStyle = surfaceStyleCell([aspectRatio], () => scatterSurfaceStyle(aspectRatio));
    const tooltipBase = tooltipBaseCell([built.series], () => scatterTooltipBase(built.series));
    const view = viewCell(
      [p.hostAttrs, p.hostStyle, surfaceStyle, table, props.data, tooltipBase, surface],
      () => ({ hostAttrs: p.hostAttrs, hostStyle: p.hostStyle, surfaceStyle, table, data: props.data, tooltipBase, surface }),
    );
    return { pass: p, options: surface, view };
  };
  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };
  function onFocusChange(point: ScatterFocusPoint | null): void {
    hover.focusChange(point, current().pass);
  }
  const reveal = (): void => {
    revealPending = false;
    revealed = true;
    // Stamped in the pass that reveals: the native enter resolves in its draw (core/size/reveal-clock.ts).
    clock.mountedAt ??= performance.now();
  };

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  let ownedStyle: HTMLStyleElement | null = null;
  // Whether the renderer has drawn a revealed pass since `attach`: the reveal timer starts in the passive work after it.
  let revealDrawn = false;
  /** A commit's layout half: the owned <style> takes the pass's rules (React wrote them before its layout effects), then the renderer its options. */
  const layout = (): void => {
    const el = surfaceEl;
    if (!el || !host) {
      return;
    }
    const { pass: p, options: opts } = current();
    if (ownedStyle && ownedStyle.textContent !== p.ownedCss) { ownedStyle.textContent = p.ownedCss; }
    surfaceOf().render(el, opts);
    revealDrawn ||= revealed;
  };
  // What the passive work last ran for (React effects' deps): the reveal timer armed in this attach, the duration it runs, the build the
  // indicator follows. `detach` drops the arm and the follow, so a re-attach runs them again.
  let armed = false;
  let gateDuration: number | undefined;
  let followed: ScatterPass["built"] | undefined;
  let followedMargin: ScatterPass["margin"] | undefined;
  let unfollow: (() => void) | undefined;
  const gateRun = (): ReadyGateRun => ({ duration: current().pass.animationDuration, onReady: () => { latestInput.props.onPhaseChange?.("ready"); } });
  /** A commit's passive half, in the order the React shell ran these effects. */
  const committed = (): void => {
    const { animationDuration, built, margin } = current().pass;
    // As React's useReadyGate did before W5: a new duration starts an armed timer again.
    if (animationDuration !== gateDuration) {
      gateDuration = animationDuration;
      if (armed) { gate.restart(gateRun()); }
    }
    // bklit's reveal timer (scatter-chart-shell.tsx:146-154), from the passive work of the commit that drew the dots.
    if (revealDrawn && !armed) {
      armed = true;
      latestInput.props.onPhaseChange?.("revealing");
      gate.arm(gateRun());
    }
    // The indicator is placed again when the build or the margin changes, and at every size the renderer measures (hover.ts `follow`).
    if (built !== followed || margin !== followedMargin) {
      unfollow?.();
      followed = built;
      followedMargin = margin;
      unfollow = hover.follow(built, margin);
    }
  };
  let cancelPassive: (() => void) | undefined;
  const schedulePassive = (): void => {
    cancelPassive?.();
    cancelPassive = afterPaint(() => {
      cancelPassive = undefined;
      committed();
    });
  };

  // --- Host listeners: touch focus and the mouse press guard (a press hides the chrome, core/interaction/touch-focus.ts), the keyboard hold --
  let listenersOff: (() => void) | undefined;
  const listen = (el: HTMLElement): (() => void) => {
    const pressOff = attachPressGuard(el, () => handle.interaction.current, true);
    const holdOff = hold.attach(el);
    return (): void => {
      pressOff();
      holdOff();
    };
  };

  // The custom children's context: built when read, from the size TanStack measured, the ready gate, the focus and the latest pass.
  const buildContext = createScatterContext();
  const context: Readable<ChartContext> = {
    get: () => buildContext({ pass: current().pass, size: size.get(), isLoaded: gate.store.get(), focused: focus.get(), containerRef, interaction: handle.interaction }),
    subscribe: (listener) => {
      const offs = [size.subscribe(listener), gate.store.subscribe(listener), focus.subscribe(listener), contextVersion.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context,
    focus,
    prepare(input) {
      latestInput = input;
      if (revealPending) { reveal(); }
      pass = derive(input);
    },
    update(input) {
      const before = pass?.view;
      latestInput = input;
      pass = derive(input);
      if (selfDriven && pass.view !== before) { bump(viewVersion); bump(contextVersion); }
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
      // The owned stylesheet sits where React rendered it, before the surface's host element.
      let before: Node = dom.surface;
      while (before.parentNode !== null && before.parentNode !== dom.host) { before = before.parentNode; }
      ownedStyle = dom.host.ownerDocument.createElement("style");
      ownedStyle.textContent = current().pass.ownedCss;
      dom.host.insertBefore(ownedStyle, before.parentNode === dom.host ? before : null);
      // The first pass: grid + axes only (TanStack's draw runs `chart()`, which writes the size store).
      surfaceOf().render(dom.surface, current().options);
      dom.host.append(overlay.root);
      listenersOff = listen(dom.host);
      revealPending = true;
      if (!selfDriven) {
        return;
      }
      // The reveal commit, before the first paint as React runs it: the pass that reveals, its draw, then its passive work.
      reveal();
      pass = derive(latestInput);
      bump(viewVersion);
      bump(contextVersion);
      layout();
      cancelPassive?.();
      cancelPassive = undefined;
      committed();
    },
    // React's shell arms nothing after the first paint: the reveal timer starts in the reveal commit's passive work, which React flushes before it.
    mounted: () => undefined,
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      unfollow?.();
      unfollow = undefined;
      followed = undefined;
      followedMargin = undefined;
      listenersOff?.();
      listenersOff = undefined;
      overlay.root.remove();
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      handle.interaction.current = null;
      gate.dispose();
      armed = false;
      revealDrawn = false;
      // A re-attach plays the two-pass mount again (StrictMode's second attach comes before the render that reveals, as the shell's remounted RendererChart did).
      revealed = false;
      revealPending = false;
      clock = { mountedAt: null };
      pass = undefined;
      host = null;
      surfaceEl = null;
      containerRef.current = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
