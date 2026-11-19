import type { ChartPoint, ChartRendererHostOptions } from "@tanstack/charts";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { alignEntranceStart } from "../entrance/entrance-origin";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import type { HoverSource } from "../polar/hover";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import { createChartSurface, surfaceIdPrefix, surfaceOptions } from "../surface/surface";
import { radarA11y } from "../polar/describe";
import type { ChartSurface } from "../surface/surface";
import type { TooltipTarget } from "../surface/tooltip-target";
import type { RadarChartProps, RadarContextValue } from "../types/radar";
import { createRadarContext, radarContextValue, radarHoverValue } from "./context";
import { RADAR_ENTRANCE_ORIGINS } from "./entrance";
import { createRadarHover } from "./hover";
import { createRadarModel, DEFAULT_ENTER_MS, DEFAULT_LEVELS, DEFAULT_MARGIN, RADAR_CSS, RADAR_RENDERER, radarParts } from "./model";
import type { RadarRow } from "./rows";
import { radarHostAttrs, radarSurfaceStyle } from "./view";
import type { RadarView } from "./view";

/** The props a RadarChart hands its controller: the adapter keeps `className` and `style`, and its carriers come as the table. */
export type RadarProps = Omit<RadarChartProps<unknown, unknown>, "children" | "className" | "style">;

export interface RadarControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface RadarController extends ChartController<RadarProps, RadarView, RadarContextValue> {
  /** `useRadar()`: never null (the stable half of the latest pass, the hovered series). */
  readonly context: Readable<RadarContextValue>;
  /** The hovered series: RadarProvider's hover half (`useRadarHover()`) reads it. */
  readonly hover: HoverSource;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<RadarProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
}

type RadarOptions = ChartRendererHostOptions<RadarRow, string | number, number>;
type RadarPoint = ChartPoint<RadarRow, string | number, number>;

/** Everything one pass derives from the input (what React's render computed). */
interface Pass {
  readonly animate: boolean;
  readonly replayKey: string;
  readonly hoveredIndex: number | null | undefined;
  /** `undefined` without metrics (the view is hidden). */
  readonly options: RadarOptions | undefined;
  readonly view: RadarView;
}

export function createRadarController(env: ChartEnv, initial: ChartInput<RadarProps>, options: RadarControllerOptions = {}): RadarController {
  const selfDriven = options.commits !== "adapter";
  // RendererChart.js:37: the svg ids' prefix from the chart's id. The radar never read the static preview or the chart config (env).
  const idPrefix = surfaceIdPrefix(undefined, env.uid);
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  const hover = createRadarHover();
  const hold = createKeyboardFocusHold(hover.interaction);
  const viewVersion = writable(0);
  const bump = (): void => { viewVersion.set(viewVersion.get() + 1); };
  let latestInput = initial;
  let pass: Pass | undefined;
  // "adapter": when the pass being committed was rendered (react/kit/entrance/entrance-align.tsx `useRenderStart`): a replay's motion clock.
  let preparedAt = 0;
  // Inside one of the renderer's callbacks or its draw: a port's update reaches the renderer in a microtask instead.
  let inRenderer = 0;

  function onFocusChange(point: RadarPoint | null): void {
    inRenderer += 1;
    try {
      hold(point);
      hover.focusChange(point);
    } finally {
      inRenderer -= 1;
    }
  }

  // --- One pass: the model's and the context's cells keep each value's identity while its inputs hold (as React's useMemo did) -----
  const radarModel = createRadarModel();
  const radarContext = createRadarContext();
  const optionsCell = memoCell<RadarOptions | undefined>();
  const attrsCell = memoCell<RadarView["hostAttrs"]>();
  const surfaceStyleCell = memoCell<RadarView["surfaceStyle"]>();
  const viewCell = memoCell<RadarView>();

  const derive = ({ props, table }: ChartInput<RadarProps>): Pass => {
    const {
      data, metrics, size, levels = DEFAULT_LEVELS, margin = DEFAULT_MARGIN, animate = true, enterDurationMs = DEFAULT_ENTER_MS, staggerScale = 1,
      enterTransition, motionReplayKey = "", hoveredIndex, onHoverChange, ariaLabel = "Radar chart", ariaDescription,
    } = props;
    const parts = radarParts(table);
    // The hover reads the latest props (React: each render, as its refs held them).
    hover.update({ areas: parts.areas, data, hoveredIndex, onHoverChange });
    const model = radarModel({ animate, data, enterDurationMs, enterTransition, levels, margin, metrics, parts, size, staggerScale });
    const provider = radarContext({ animate, data, enterDurationMs, levels, margin, metrics, motionReplayKey, setHoveredIndex: hover.setHoveredIndex, size, staggerScale });
    const { definition } = model;
    // react/radar-chart.tsx rendered RendererChart (`@tanstack/charts/react/core` Chart) with these props.
    const surface = optionsCell([definition, size, ariaLabel, ariaDescription, data, metrics, table], () =>
      definition && surfaceOptions({ ariaDescription, ariaLabel, aspectRatio: 1, definition, height: size, onFocusChange, onRender: hover.onRender, renderer: RADAR_RENDERER, width: size, a11y: radarA11y(data, metrics, table) }, idPrefix));
    const hostAttrs = attrsCell([animate], () => radarHostAttrs(animate));
    const surfaceStyle = surfaceStyleCell([size], () => radarSurfaceStyle(size));
    const view = viewCell(
      [model.hidden, hostAttrs, model.hostClass, model.hostStyle, surfaceStyle, provider],
      () => ({ hidden: model.hidden, hostAttrs, hostClass: model.hostClass, hostStyle: model.hostStyle, surfaceStyle, provider }),
    );
    return { animate, replayKey: motionReplayKey, hoveredIndex, options: surface, view };
  };

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface<RadarRow, string | number, number> | undefined;
  const surfaceOf = (opts: RadarOptions): ChartSurface<RadarRow, string | number, number> => {
    chart ??= createChartSurface(opts);
    return chart;
  };
  let ownedStyle: HTMLStyleElement | null = null;
  let listenersOff: (() => void) | undefined;
  // The replay key the mounted chart was mounted for (`undefined`: none mounted), and the one the running alignment was made for.
  let mountedKey: string | undefined;
  let alignedKey: string | undefined;
  let cancelAlign: (() => void) | undefined;
  /** bklit's label / dot / grid-label fades are WAAPI opacity and its dot travel and label glide are JS tweens: the CSS entrances (entrance.ts)
   * are re-stamped to those origins (entrance/entrance-origin.ts) from the clock of the pass that mounts the scene. React mounted
   * <EntranceAlign key={`align-${motionReplayKey}`}> while animating: one alignment per replay key. */
  const realign = (key: string | undefined, renderStart: number): void => {
    if (key === alignedKey) {
      return;
    }
    cancelAlign?.();
    cancelAlign = undefined;
    alignedKey = key;
    if (key !== undefined) {
      cancelAlign = alignEntranceStart(() => host, RADAR_ENTRANCE_ORIGINS, renderStart);
    }
  };
  /** A commit's layout half: the renderer gets the latest options, mounting a fresh chart on a replay (React's keyed RendererChart: the old
   * one's cleanup, then EntranceAlign's layout effect, then RendererChart's update and mount). */
  const layout = (renderStart: number): void => {
    const el = surfaceEl;
    const { options: opts, animate, replayKey } = current();
    if (!host || !el || !opts) {
      return;
    }
    if (mountedKey !== undefined && mountedKey !== replayKey) {
      chart?.destroy();
      mountedKey = undefined;
    }
    realign(animate ? replayKey : undefined, renderStart);
    inRenderer += 1;
    try {
      surfaceOf(opts).render(el, opts);
    } finally {
      inRenderer -= 1;
    }
    mountedKey = replayKey;
  };
  let deferred = false;
  const deferLayout = (): void => {
    if (deferred) {
      return;
    }
    deferred = true;
    queueMicrotask(() => {
      deferred = false;
      layout(performance.now());
    });
  };
  // The `hoveredIndex` the passive half last ran for (React effects' deps); reset by `detach`, so a re-attach runs it again.
  let controlled: { readonly index: number | null | undefined } | undefined;
  /** A commit's passive half: React's two effects on `hoveredIndex`, in their order. */
  const committed = (): void => {
    const { hoveredIndex } = current();
    if (controlled !== undefined && Object.is(controlled.index, hoveredIndex)) {
      return;
    }
    controlled = { index: hoveredIndex };
    hover.control(hoveredIndex);
    hover.focusControlled(hoveredIndex);
  };
  let cancelPassive: (() => void) | undefined;
  const schedulePassive = (): void => {
    cancelPassive?.();
    cancelPassive = afterPaint(() => {
      cancelPassive = undefined;
      committed();
    });
  };

  // --- Host listeners: React's passive effects of the host's commit, in their order (tap focus, the keyboard hold, the host mirror) ---
  const listen = (el: HTMLElement): (() => void) => {
    // Tap focus under touch (UPSTREAM-GAPS #39) and the keyboard hold (gap #42) read the renderer's interaction controller at event time.
    const tapOff = attachTapFocus(el, hover.interaction, "tap");
    const holdOff = hold.attach(el);
    const mirrorOff = hover.mirror(() => host);
    return (): void => {
      tapOff();
      holdOff();
      mirrorOff();
    };
  };

  // `useRadar()`: the stable half of the latest pass with the hovered series, built when read.
  const contextCell = memoCell<RadarContextValue>();
  const context: Readable<RadarContextValue> = {
    get: () => {
      const { provider } = current().view;
      const hovered = hover.source.getHovered();
      return contextCell([provider, hovered], () => radarContextValue(provider, radarHoverValue(hovered, provider.setHoveredIndex)));
    },
    subscribe: (listener) => {
      const offs = [viewVersion.subscribe(listener), hover.source.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    // The radar shows no tooltip.
    tooltip: readonly(writable<TooltipTarget | null>(null)),
    context,
    hover: hover.source,
    prepare(input) {
      preparedAt = performance.now();
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      const before = pass?.view;
      // "adapter": the pass `prepare` derived from this same input.
      if (input !== latestInput || pass === undefined) {
        latestInput = input;
        pass = derive(input);
      }
      if (!selfDriven) {
        layout(preparedAt);
        return;
      }
      if (pass.view !== before) { bump(); }
      if (inRenderer > 0) { deferLayout(); } else { layout(performance.now()); }
      // Before `attach` there is nothing to schedule: `attach` runs the passive half itself.
      if (host) { schedulePassive(); }
    },
    committed,
    attach(dom, clock) {
      host = dom.host;
      surfaceEl = dom.surface;
      if (selfDriven) { committed(); }
      // The owned stylesheet sits where React rendered it: the host's first child, before the surface's host element.
      let before: Node = dom.surface;
      while (before.parentNode !== null && before.parentNode !== dom.host) { before = before.parentNode; }
      ownedStyle = dom.host.ownerDocument.createElement("style");
      ownedStyle.textContent = RADAR_CSS;
      dom.host.insertBefore(ownedStyle, before.parentNode === dom.host ? before : dom.host.firstChild);
      listenersOff = listen(dom.host);
      // Mount: EntranceAlign's layout effect, then RendererChart's update and mount.
      layout(clock.renderStart);
    },
    mounted() {
      // bklit's radar has no reveal gate: its entrance plays from the mount (entrance.ts), interaction is live at once.
    },
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      realign(undefined, 0);
      listenersOff?.();
      listenersOff = undefined;
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      mountedKey = undefined;
      controlled = undefined;
      host = null;
      surfaceEl = null;
    },
    prerender: () => {
      const opts = current().options;
      return opts ? surfaceOf(opts).prerender() : "";
    },
  };
}
