import type { ChartPoint, ChartRendererHostOptions } from "@tanstack/charts";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import type { ChartContext, ContainerRef, FocusedRow } from "../cartesian/context";
import { createReadyGate } from "../entrance/ready-gate";
import type { ReadyGateRun } from "../entrance/ready-gate";
import { erase } from "../erased-types";
import type { FocusStore } from "../hover/focus-store";
import { writeLegendHover } from "../hover/host-sync";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachPressGuard, createInteractionHandle } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import { createResizeBox } from "../size/resize";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import { candlestickA11y } from "./describe";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import { createCandlestickContext } from "./context";
import type { Candle } from "./definition";
import { createCandlestickHover } from "./hover";
import { createCandlestickPass } from "./pass";
import type { CandlestickPass, CandlestickPassProps, CandlestickPlacement } from "./pass";
import type { CandlestickView } from "./view";

/** The props a CandlestickChart hands its controller (the adapter keeps `className`, merges the reader's `style` and keys its host by `revealSignature`). */
export interface CandlestickControllerProps extends CandlestickPassProps {
  /** Changing it replays the entrance: the ready gate restarts and the entrance marks return until it flips again. */
  readonly revealSignature?: string;
}

export interface CandlestickControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface CandlestickController extends ChartController<CandlestickControllerProps, CandlestickView, ChartContext> {
  /** Never null: before the first measure it holds the zero-size plot. */
  readonly context: Readable<ChartContext>;
  /** The focused candle: the custom children's leaf subscribes (`context` reads it). */
  readonly focus: FocusStore<FocusedRow>;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<CandlestickControllerProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
}

type CandlestickSurfaceOptions = ChartRendererHostOptions<Candle, Date, number>;

/** One pass and what the controller derives beside it from the same input. */
interface Derived {
  readonly pass: CandlestickPass;
  /** The ready gate's flag the pass was derived at: true draws the static candles, false bklit's entrance marks. */
  readonly loaded: boolean;
  readonly options: CandlestickSurfaceOptions;
}

const resetKeyOf = ({ props }: ChartInput<CandlestickControllerProps>): string => props.revealSignature ?? "";

// `env.staticPreview` is not read: the candlestick's shell never took the static preview (its entrance plays in a docs preview too).
export function createCandlestickController(env: ChartEnv, initial: ChartInput<CandlestickControllerProps>, options: CandlestickControllerOptions = {}): CandlestickController {
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  // The public context's `containerRef` (the host while attached).
  const containerRef: ContainerRef = { current: null };
  const tooltip = tooltipTargetStore();
  // The renderer's interaction controller, captured from each draw's `onRender` (the press guard, the hold and the context's setters focus through it).
  const interactionHandle = createInteractionHandle();
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(() => interactionHandle.interaction.current);
  const hover = createCandlestickHover(() => host, hold);
  const gate = createReadyGate(() => host);
  // The host's content box, rounded (bklit's react-use-measure first hop): zero until the first delivery.
  const box = createResizeBox();
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let derived: Derived | undefined;
  // The reveal key the gate last flipped ready for (null while it runs): `loaded` while it is the current `revealSignature`.
  let readyKey: string | null = null;
  let changedFromInside: () => void = () => undefined;

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's useMemo did) -------------------------
  const derivePass = createCandlestickPass();
  const optionsCell = memoCell<CandlestickSurfaceOptions>();
  function onFocusChange(point: ChartPoint<Candle, Date, number> | null): void {
    hover.focusChange(point, current().pass.focus);
  }
  // After each render: the handle's capture, then the focused candle's marks the redraw dropped.
  function onRender(context: Parameters<typeof interactionHandle.onRender>[0]): void {
    interactionHandle.onRender(context);
    hover.rendered();
  }
  const derive = (input: ChartInput<CandlestickControllerProps>): Derived => {
    const loaded = readyKey === resetKeyOf(input);
    const pass = derivePass({ props: input.props, table: input.table, uid, size: box.get(), loaded });
    const { built, renderer, aspectRatio, ariaLabel, ariaDescription } = pass;
    const surface = optionsCell([built.definition, renderer, aspectRatio, ariaLabel, ariaDescription, input.props.data, input.table], () =>
      surfaceOptions<Candle, Date, number>({ definition: built.definition, renderer: erase(renderer), aspectRatio, ariaLabel, ariaDescription, onFocusChange, onRender: erase(onRender), onTooltipBodyChange: tooltip.onChange, a11y: candlestickA11y(input.props.data, input.props.xDataKey ?? "date", input.table) }, uid));
    return { pass, loaded, options: surface };
  };
  const current = (): Derived => {
    derived ??= derive(latestInput);
    return derived;
  };

  // --- The ready gate: bklit `isLoaded` (use-chart-phase-orchestrator.ts:155-170), landed in the pass like the shell's `viaState` gate -------
  const gateRun = (): ReadyGateRun => {
    const key = resetKeyOf(latestInput);
    return {
      duration: current().pass.animationDuration,
      land: (flipped) => {
        const next = flipped ? key : null;
        if (next !== readyKey) {
          readyKey = next;
          changedFromInside();
        }
      },
    };
  };
  // Each change from inside (the measured box, the gate's flag) is a new pass.
  box.subscribe(() => { changedFromInside(); });

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface<Candle, Date, number> | undefined;
  const surfaceOf = (): ChartSurface<Candle, Date, number> => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  let ownedStyle: HTMLStyleElement | null = null;
  let overlayOff: (() => void) | undefined;
  // What the layout half last wrote (reset by `detach`, so a re-attach writes it again).
  let reflected: boolean | undefined;
  let placed: CandlestickPlacement | undefined;
  /** The gate's flag on the host (`data-bkm-ready`) in the commit that draws it, then the indicator at the draw's plot. */
  const reflectAndPlace = ({ pass, loaded }: Derived): void => {
    if (loaded !== reflected) {
      reflected = loaded;
      gate.reflect(loaded);
    }
    if (pass.placement !== placed) {
      placed = pass.placement;
      hover.place(pass.placement);
    }
  };
  /** A commit's layout half: the owned CSS, the renderer's latest options (RendererChart.js's layout effect), the gate's flag, the indicator. */
  const layout = (): void => {
    const el = surfaceEl;
    if (!el || !host) {
      return;
    }
    const latest = current();
    if (ownedStyle && ownedStyle.textContent !== latest.pass.css) { ownedStyle.textContent = latest.pass.css; }
    surfaceOf().render(el, latest.options);
    reflectAndPlace(latest);
  };

  // --- Host listeners: installed after the mount's paint (the shell's passive effects) ---------------------------------------------
  let listenersOff: (() => void) | undefined;
  const listen = (el: HTMLElement): (() => void) => {
    // Touch focus plus the mouse press freeze (bklit candlestick has no hover host); the tooltip stays on a press.
    const pressOff = attachPressGuard(el, () => interactionHandle.interaction.current, false);
    const holdOff = hold.attach(el);
    // The candlestick dims by the series legend only (its shell never read the profit / loss legend).
    const legend = env.legendHover;
    const write = (): void => { if (legend) { writeLegendHover(el, { legend: legend.get().legend, profitLoss: null }); } };
    const legendOff = legend?.subscribe(write);
    write();
    const observeOff = box.observe(el);
    return (): void => {
      pressOff();
      holdOff();
      legendOff?.();
      observeOff();
    };
  };
  // The gate run's keys the passive work last restarted it for (React's effect deps); reset by `detach`, so a re-attach restarts it.
  let gateKey: string | undefined;
  /** A commit's passive half, in the order the shell ran these effects. */
  const committed = (): void => {
    if (host && !listenersOff) {
      listenersOff = listen(host);
    }
    const key = `${current().pass.animationDuration}|${resetKeyOf(latestInput)}`;
    if (key !== gateKey) {
      gateKey = key;
      // A new animationDuration or revealSignature starts the timer again once armed (and drops the flag until it flips).
      gate.restart(gateRun());
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
  let microtask = false;
  changedFromInside = (): void => {
    if (!selfDriven) {
      // The adapter re-renders (prepares the new pass) and its next commit hands it over.
      bump(viewVersion);
      return;
    }
    const before = derived?.pass.view;
    derived = derive(latestInput);
    if (derived.pass.view !== before) { bump(viewVersion); }
    bump(contextVersion);
    if (microtask) {
      return;
    }
    // Never inside the caller's own pass (an observer delivery, the gate's timer or its restart): the next microtask, as a port's own flush would.
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      layout();
    });
  };

  // The custom children's context: built when read, from the latest pass, the ready gate and the focus; a field keeps its object while its content holds.
  const buildContext = createCandlestickContext();
  const context: Readable<ChartContext> = {
    get: () => buildContext({ pass: current().pass, containerRef, interaction: interactionHandle.interaction, isLoaded: gate.store.get(), focused: hover.focus.get() }),
    subscribe: (listener) => {
      const offs = [gate.store.subscribe(listener), hover.focus.subscribe(listener), contextVersion.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };

  return {
    view: { get: () => current().pass.view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context,
    focus: hover.focus,
    prepare(input) {
      latestInput = input;
      derived = derive(input);
    },
    update(input) {
      const before = derived?.pass.view;
      latestInput = input;
      derived = derive(input);
      if (selfDriven) {
        if (derived.pass.view !== before) { bump(viewVersion); }
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
      const latest = current();
      // The owned stylesheet sits where the shell rendered it: the host's first child, before the first draw.
      ownedStyle = dom.host.ownerDocument.createElement("style");
      ownedStyle.textContent = latest.pass.css;
      dom.host.insertBefore(ownedStyle, dom.host.firstChild);
      surfaceOf().render(dom.surface, latest.options);
      // The hover indicator (crosshair, close dot, date pill) is an element the hover owns, appended to the host after the surface.
      overlayOff = hover.attach(dom.host);
      reflectAndPlace(latest);
      if (selfDriven) { schedulePassive(); }
    },
    mounted() {
      // The shell armed the gate from its mount effect (no reveal clip to wait for): the first post-paint moment.
      gate.arm(gateRun());
    },
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      listenersOff?.();
      listenersOff = undefined;
      // The focus goes with the surface (the renderer's destroy reports the tooltip's end, not the focus's): no hover state on a re-attach.
      hover.focusChange(null, current().pass.focus);
      overlayOff?.();
      overlayOff = undefined;
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      gate.dispose();
      gateKey = undefined;
      reflected = undefined;
      placed = undefined;
      host = null;
      surfaceEl = null;
      containerRef.current = null;
      // A re-attach mounts like the first time: the entrance marks until the gate flips again.
      if (readyKey !== null) {
        readyKey = null;
        derived = undefined;
      }
    },
    prerender: () => surfaceOf().prerender(),
  };
}
