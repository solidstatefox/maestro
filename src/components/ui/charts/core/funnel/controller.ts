import type { ChartPoint, ChartRendererHostOptions, ChartRendererRenderContext } from "@tanstack/charts";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { alignEntranceStart } from "../entrance/entrance-origin";
import { attachTapFocus } from "../interaction/touch-focus";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import { readonly, writable } from "../store";
import { createChartSurface, surfaceBox, surfaceHostStyle, surfaceOptions } from "../surface/surface";
import { funnelA11y } from "./describe";
import type { ChartSurface } from "../surface/surface";
import type { TooltipTarget } from "../surface/tooltip-target";
import type { StyleObject } from "../style";
import type { FunnelChartProps } from "../types/funnel";
import type { FunnelDatum } from "./focus";
import { createFunnelHover } from "./hover";
import { createFunnelModel, FUNNEL_ENTRANCE_ORIGINS, FUNNEL_RENDERER, FUNNEL_SURFACE_STYLE, funnelPatternTiles } from "./model";
import type { FunnelModel, FunnelPatternTile } from "./model";
import { resolveFunnelProps } from "./props";
import type { ResolvedFunnelProps } from "./props";
import { FUNNEL_HOST_ATTRS } from "./view";
import type { FunnelView } from "./view";

/** The props a FunnelChart hands its controller (the adapter keeps `className` and merges the reader's `style` itself; `renderPattern` is read for
 * whether it is given, the adapter calls it). */
export interface FunnelControllerProps extends FunnelChartProps<unknown, unknown> {
  /** True on the server and while React hydrates its markup: the labels repeat the server's fallback measurements (model.ts). The ports leave it out. */
  readonly hydrating?: boolean;
}

export interface FunnelControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

/** Its `view` is null while there are no stages: the chart renders nothing. */
export interface FunnelController extends ChartController<FunnelControllerProps, FunnelView | null> {
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<FunnelControllerProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
}

type SurfaceOptions = ChartRendererHostOptions<FunnelDatum, number, number>;

/** Everything one pass derives from the input and the controller's state (what React's render computed). */
interface Pass {
  readonly resolved: ResolvedFunnelProps<unknown, unknown>;
  readonly model: FunnelModel;
  readonly hasPattern: boolean;
  readonly options: SurfaceOptions;
  readonly view: FunnelView | null;
}

export function createFunnelController(env: ChartEnv, initial: ChartInput<FunnelControllerProps>, options: FunnelControllerOptions = {}): FunnelController {
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  const build = createFunnelModel();
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  const hover = createFunnelHover(() => host);
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(hover.interaction);
  const viewVersion = writable(0);
  let latestInput = initial;
  let pass: Pass | undefined;
  // The plot width the latest draw reported: only a renderPattern reads it (the tiles' origins per stage).
  let plotWidth = 0;

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's memoised hooks did) -------------------
  const optionsCell = memoCell<SurfaceOptions>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const tilesCell = memoCell<readonly FunnelPatternTile[] | null>();
  const viewCell = memoCell<FunnelView>();

  const derive = ({ props }: ChartInput<FunnelControllerProps>): Pass => {
    const resolved = resolveFunnelProps(props);
    const { data, color, gap, hoveredIndex, onHoverChange, ariaDescription } = resolved;
    hover.setProps(hoveredIndex, onHoverChange);
    const model = build({ hydrating: props.hydrating === true, idPrefix: uid, resolved });
    const { aspect, horizontal, patternPrefix } = model;
    const hasPattern = resolved.renderPattern !== undefined;
    const surface = optionsCell([model.definition, aspect, model.ariaLabel, ariaDescription, data, resolved.formatValue, resolved.formatPercentage, props.dataTable], () =>
      surfaceOptions({ definition: model.definition, renderer: FUNNEL_RENDERER, aspectRatio: aspect, ariaLabel: model.ariaLabel, ariaDescription, onFocusChange, onRender, a11y: funnelA11y(data, resolved.formatValue, resolved.formatPercentage, props.dataTable) }, uid));
    const surfaceStyle = surfaceStyleCell([aspect], () => surfaceHostStyle(surfaceBox({ aspectRatio: aspect }), FUNNEL_SURFACE_STYLE));
    const tiles = tilesCell([hasPattern, aspect, color, data, gap, horizontal, patternPrefix, plotWidth], () =>
      (hasPattern ? funnelPatternTiles({ aspect, color, data, gap, horizontal, patternPrefix, plotWidth }) : null));
    const view = data.length === 0
      ? null
      : viewCell([model.hostStyle, surfaceStyle, tiles, patternPrefix], () => ({
          hostAttrs: FUNNEL_HOST_ATTRS,
          hostStyle: model.hostStyle,
          surfaceStyle,
          patterns: tiles === null ? null : { prefix: patternPrefix, tiles },
        }));
    return { resolved, model, hasPattern, options: surface, view };
  };

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- What a draw and a focus change hand back -------------------------------------------------------------------------------------
  function onRender(context: ChartRendererRenderContext<FunnelDatum, number, number>): void {
    hover.rendered(context, current().hasPattern ? setPlotWidth : undefined);
  }
  function onFocusChange(point: ChartPoint<FunnelDatum, number, number> | null): void {
    hold(point);
    hover.focusChanged(point);
  }
  // A new plot width lays the tiles out again: a new view, which the adapter renders (the renderer's options do not depend on it).
  function setPlotWidth(width: number): void {
    if (width === plotWidth) { return; }
    plotWidth = width;
    const before = pass?.view;
    pass = derive(latestInput);
    if (pass.view !== before) { viewVersion.set(viewVersion.get() + 1); }
  }

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface<FunnelDatum, number, number> | undefined;
  const surfaceOf = (): ChartSurface<FunnelDatum, number, number> => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  /** A commit's layout half: the renderer gets the latest options (RendererChart.js's layout effect). */
  const layout = (): void => {
    if (surfaceEl) { surfaceOf().render(surfaceEl, current().options); }
  };
  // The keys the passive work last ran for (React effects' deps); reset by `detach`, so a re-attach runs it again.
  let popLayout: string | undefined;
  let disposePop: (() => void) | undefined;
  let cancelEnterComplete: (() => void) | undefined;
  let hoveredApplied: { readonly index: number | null | undefined } | undefined;
  /** A commit's passive half, in the order React ran these effects. */
  const committed = (): void => {
    if (!host) { return; }
    const { model, resolved } = current();
    const { horizontal, layers } = model;
    if (`${horizontal}|${layers}` !== popLayout) {
      disposePop?.();
      popLayout = `${horizontal}|${layers}`;
      disposePop = hover.attachPop({ horizontal, layers });
    }
    // Once per mount, with the mount's stages and timing.
    cancelEnterComplete ??= hover.scheduleEnterComplete({ durationSec: model.enterDurationSec, staggerDelaySec: resolved.staggerDelay, stages: resolved.data.length });
    if (hoveredApplied === undefined || !Object.is(hoveredApplied.index, resolved.hoveredIndex)) {
      hoveredApplied = { index: resolved.hoveredIndex };
      hover.hoveredChanged(resolved.hoveredIndex);
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

  let cancelAlign: (() => void) | undefined;
  let listenersOff: (() => void) | undefined;
  const listen = (el: HTMLElement): (() => void) => {
    // Tap focus under touch (interaction/touch-focus.ts, UPSTREAM-GAPS #39), then the keyboard hold (UPSTREAM-GAPS #42), as the shell installed them.
    const tapOff = attachTapFocus(el, hover.interaction, "tap");
    const holdOff = hold.attach(el);
    return (): void => {
      tapOff();
      holdOff();
    };
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(writable<TooltipTarget | null>(null)),
    context: readonly(writable(null)),
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      const before = pass?.view;
      latestInput = input;
      pass = derive(input);
      if (selfDriven && pass.view !== before) { viewVersion.set(viewVersion.get() + 1); }
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    committed,
    attach(dom, clock) {
      host = dom.host;
      surfaceEl = dom.surface;
      // The stage grow and the label fade are CSS (styles.css funnel rules), restamped to motion's clock from the mounting pass's start.
      cancelAlign = alignEntranceStart(() => host, FUNNEL_ENTRANCE_ORIGINS, clock.renderStart);
      // Mount: TanStack's draw reports the scene and its interaction controller (`onRender`).
      surfaceOf().render(dom.surface, current().options);
      listenersOff = listen(dom.host);
      if (selfDriven) { schedulePassive(); }
    },
    // No reveal to arm: the entrance plays from the first draw and was aligned by `attach`.
    mounted() {},
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      cancelAlign?.();
      cancelAlign = undefined;
      listenersOff?.();
      listenersOff = undefined;
      disposePop?.();
      disposePop = undefined;
      popLayout = undefined;
      cancelEnterComplete?.();
      cancelEnterComplete = undefined;
      hoveredApplied = undefined;
      chart?.destroy();
      host = null;
      surfaceEl = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
