import { createSvgChartRenderer } from "@tanstack/charts/svg/renderer";
import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import type { ChildTable } from "../carriers/table";
import type { ChartClock, ChartController, ChartDom, ChartEnv, ChartInput } from "../chart/controller";
import type { AnyInteraction } from "../erased-types";
import { writeAttribute, writePresence } from "../host-write";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus } from "../interaction/touch-focus";
import { prefersReducedMotion } from "../loading/reduced-motion";
import { CENTER_NUMBER_REST_MS, CENTER_NUMBER_STILL_MS } from "../polar/center";
import { measureNoText } from "../polar/measure-no-text";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import { px } from "../style";
import type { StyleObject } from "../style";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import { radialA11y } from "./describe";
import type { ChartSurface } from "../surface/surface";
import type { TooltipTarget } from "../surface/tooltip-target";
import type { RadialAngleValue, RadialCenterState, RadialChartProps, RadialLegendProps } from "../types/radial";
import { radialCenterState, radialLegendItems } from "./context";
import type { RadialChartContextValue, RadialLegendItem } from "./context";
import type { RadialHitRow } from "./definition";
import type { LayerEnterEnv } from "./layers/types";
import { buildRadialModel } from "./model";
import type { RadialModel } from "./model";
import { createRadialOverlay } from "./overlay";
import type { RadialOverlay } from "./overlay";
import { createRadialShell, radialStageBounds } from "./shell";
import type { RadialShell } from "./shell";
import { RADIAL_CROSSHAIR_SPRING, RADIAL_DOT_SPRING, createRadialAngleSpring } from "./spring";
import type { RadialAngleSpring } from "./spring";
import { binOfElement } from "./layers/common";
import { degreesToRadians } from "./geometry";

/** The props a RadialChart hands its controller (the adapter keeps `className` and `children`). */
export type RadialControllerProps = Omit<RadialChartProps<unknown>, "children" | "className">;

/** What a RadialChart adapter renders. */
export interface RadialView {
  /** The host's attributes beside the adapter's own `class`. */
  readonly hostAttrs: Readonly<Record<string, string>>;
  /** The host's style (its max width), before the reader's. */
  readonly hostStyle: StyleObject;
  /** The stage's style: its aspect ratio (the arc's bounding box), reserved before the first measure and on the server. */
  readonly stageStyle: StyleObject;
  /** The centre box's style, relative to the host (RadialCenter renders in it), or `null` before the first measure. */
  readonly centerStyle: StyleObject | null;
}

/** RadialLegend's state: its items and the hovered series. */
export interface RadialLegendState {
  readonly items: readonly RadialLegendItem[];
  readonly hoveredSeries: number | null;
}

export interface RadialController extends ChartController<RadialControllerProps, RadialView, RadialChartContextValue> {
  /** Never null: `useRadialChart()`'s value, a new object on a new pass, a hover or a legend hover. */
  readonly context: Readable<RadialChartContextValue>;
  /** RadialCenter's state: a new object when the hovered bin or the totals change. */
  readonly center: Readable<RadialCenterState>;
  /** Whether the centre's numbers roll to a new value: false while the hover sweeps across bins (changes under 150 ms apart), so a
   * sweep shows each bin's value at once instead of starting a roll per bin; true again once it rests (80 ms). */
  readonly centerRolls: Readable<boolean>;
  /** The legend's items for the props `read` returns (read at each `get`) and the hovered series. */
  legend(read: () => Readonly<RadialLegendProps>): Readable<RadialLegendState>;
  setHoveredSeries(index: number | null): void;
}

const NO_TOOLTIP: Readable<TooltipTarget | null> = readonly(writable<TooltipTarget | null>(null));

interface Pass {
  readonly shell: RadialShell;
  readonly model: RadialModel | null;
  readonly view: RadialView;
}

/** Props the shell and the model never read: they change without a rebuild. */
const VOLATILE: ReadonlySet<string> = /* @__PURE__ */ new Set(["hoveredIndex", "onHoverChange", "ariaLabel", "ariaDescription", "maxWidth"]);

const sameProps = (a: RadialControllerProps, b: RadialControllerProps): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    // SAFETY: both are the chart's props records.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
    if (!VOLATILE.has(key) && !Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
};

const sameStyle = (a: StyleObject | null, b: StyleObject | null): boolean =>
  a === b || (a !== null && b !== null && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v));

export function createRadialController(env: ChartEnv, initial: ChartInput<RadialControllerProps>): RadialController {
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  let latest = initial;
  /** The props the shell and the model were derived from: a new object only when a prop they read changes (React hands a new props
   * object on every render; a controlled hover or an inline callback must not rebuild the chart). */
  let structural = initial.props;
  let width = 0;
  /** The stage's offset in the host (the centre box is positioned in the host). */
  let stageOffset = { left: 0, top: 0 };
  const reducedMotion = prefersReducedMotion();

  // --- Hover state -------------------------------------------------------------------------------------------------------------------
  const hovered = writable<number | null>(null);
  // Registered first, so the numbers stop rolling before any reader hears the new bin (core/polar/center.ts paces the pie's the same way).
  const rolls = writable(true);
  let lastHoverChange = Number.NEGATIVE_INFINITY;
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  hovered.subscribe(() => {
    const now = performance.now();
    if (now - lastHoverChange < CENTER_NUMBER_STILL_MS) {
      rolls.set(false);
      clearTimeout(restTimer);
      restTimer = setTimeout(() => { rolls.set(true); }, CENTER_NUMBER_REST_MS);
    }
    lastHoverChange = now;
  });
  const series = writable<number | null>(null);
  const passVersion = writable(0);
  let revealed = false;
  const bump = (): void => { passVersion.set(passVersion.get() + 1); };

  // --- One pass ---------------------------------------------------------------------------------------------------------------------
  let pass: Pass | null = null;
  let passKey: { props: RadialControllerProps; table: ChildTable; width: number; left: number; top: number; maxWidth: number } | null = null;
  let modelKey: { props: RadialControllerProps; table: ChildTable; width: number } | null = null;
  let model: RadialModel | null = null;
  const derive = (): Pass => {
    const { table } = latest;
    const props = structural;
    const { maxWidth = 640 } = latest.props;
    if (pass && passKey && passKey.props === props && passKey.table === table && passKey.width === width && passKey.left === stageOffset.left && passKey.top === stageOffset.top && passKey.maxWidth === maxWidth) {
      return pass;
    }
    const shell = createRadialShell(props, width, reducedMotion || env.staticPreview);
    if (width > 0 && !(modelKey && modelKey.props === props && modelKey.table === table && modelKey.width === width)) {
      model = buildRadialModel(shell, table, uid);
      modelKey = { props, table, width };
    }
    const { startAngle = 0, endAngle, fitArc = true } = props;
    const bounds = radialStageBounds(degreesToRadians(startAngle), degreesToRadians(endAngle ?? startAngle + 360), fitArc);
    const aspect = `${bounds.maxX - bounds.minX} / ${bounds.maxY - bounds.minY}`;
    const centerSize = Math.max(0, shell.centerRadius * 2 - 16);
    const centerStyle: StyleObject | null = width > 0
      ? { height: px(centerSize), left: px(stageOffset.left + shell.stage.cx), top: px(stageOffset.top + shell.stage.cy), width: px(centerSize) }
      : null;
    const previous = pass?.view;
    const hostStyle: StyleObject = { "max-width": px(maxWidth) };
    const stageStyle: StyleObject = { "aspect-ratio": aspect };
    const view: RadialView = previous && sameStyle(previous.hostStyle, hostStyle) && sameStyle(previous.stageStyle, stageStyle) && sameStyle(previous.centerStyle, centerStyle)
      ? previous
      : { hostAttrs: { "data-bkm-chart": "radial", "data-bkm-kit": uid, "data-slot": "chart" }, hostStyle, stageStyle, centerStyle };
    pass = { shell, model: width > 0 ? model : null, view };
    passKey = { props, table, width, left: stageOffset.left, top: stageOffset.top, maxWidth };
    return pass;
  };

  // --- The surface, the overlay and the owned style ----------------------------------------------------------------------------------
  const renderer = createSvgChartRenderer<RadialHitRow, number, number>();
  let surface: ChartSurface<RadialHitRow, number, number> | null = null;
  let overlay: RadialOverlay | null = null;
  let ownedStyle: HTMLStyleElement | null = null;
  let interaction: AnyInteraction | null = null;
  const hold = createKeyboardFocusHold(() => interaction);
  let drawnModel: RadialModel | null = null;
  let entranceDone = false;
  const entranceCancels: (() => void)[] = [];
  const cancelEntrance = (): void => {
    for (const cancel of entranceCancels.splice(0)) {
      cancel();
    }
  };
  /** The hovered bin's elements, marked hot (the scoped CSS dims the others). */
  let hot: Element[] = [];
  let binElements: Map<number, Element[]> | null = null;

  const svgOf = (): SVGSVGElement | null => {
    const first = surfaceEl?.firstElementChild;
    return first instanceof SVGSVGElement ? first : null;
  };
  const enterEnv = (start: number): LayerEnterEnv => {
    const svg = svgOf();
    return {
      defs: (overlay as RadialOverlay).defs,
      group: (id) => {
        const found = svg?.querySelector(`g[data-ts-key="${id}"]`);
        return found instanceof SVGGElement ? found : null;
      },
      onCancel: (cancel) => { entranceCancels.push(cancel); },
      start,
    };
  };

  // --- The crosshair and the hover dots ------------------------------------------------------------------------------------------
  let crosshair: RadialAngleSpring | null = null;
  let crosshairKey = "";
  let registered: RadialAngleValue | null = null;
  let dotSprings: (RadialAngleSpring | null)[] = [];
  let unfollow: (() => void)[] = [];
  const crosshairValue = (): RadialAngleValue => registered ?? (crosshair as RadialAngleSpring).value;
  const crosshairInput = (shell: RadialShell, index: number | null, m: RadialModel | null): { angle: number; hidden: boolean; isFullCircle: boolean; snap: boolean } => {
    const scrubber = m?.scrubber ?? null;
    if (scrubber) {
      return {
        angle: index === null ? shell.binStartAngle(shell.nowIndex + 1) : shell.binAngle(index), hidden: index === null && scrubber.rest === "hidden",
        isFullCircle: shell.isFullCircle, snap: shell.reducedMotion,
      };
    }
    return { angle: shell.binAngle(index ?? 0), hidden: index === null, isFullCircle: shell.isFullCircle, snap: shell.reducedMotion };
  };
  const ensureCrosshair = (shell: RadialShell, m: RadialModel | null): void => {
    const spring = m?.scrubber?.spring ?? RADIAL_CROSSHAIR_SPRING;
    const key = `${spring.stiffness}/${spring.damping}/${spring.mass}`;
    if (crosshair === null || key !== crosshairKey) {
      crosshair?.value.destroy();
      crosshairKey = key;
      crosshair = createRadialAngleSpring(crosshairInput(shell, hovered.get(), m), spring);
    }
  };
  ensureCrosshair(derive().shell, null);

  /** The overlay follows the crosshair (the scrubber's arm) and each dot its angle. */
  const wireOverlay = (): void => {
    for (const off of unfollow.splice(0)) {
      off();
    }
    for (const spring of dotSprings) {
      spring?.value.destroy();
    }
    const { shell, model: m } = derive();
    if (!overlay || !m) {
      dotSprings = [];
      return;
    }
    const o = overlay;
    const index = hovered.get();
    dotSprings = m.dots.map((dot) => (dot.motion === "crosshair" ? null : createRadialAngleSpring(
      { angle: shell.binAngle(index ?? 0), hidden: index === null, isFullCircle: shell.isFullCircle, snap: dot.motion === "none" || shell.reducedMotion },
      dot.spring ?? RADIAL_DOT_SPRING,
    )));
    const placeDots = (onlyCrosshair: boolean): void => {
      const bin = hovered.get();
      m.dots.forEach((dot, i) => {
        const own = dotSprings[i];
        if (onlyCrosshair && own) {
          return;
        }
        const angle = own ? own.value.get() : crosshairValue().get();
        o.placeDot(i, angle, bin !== null && dot.showsAt(bin));
      });
    };
    const cross = crosshairValue();
    o.rotate(cross.get());
    unfollow.push(cross.on("change", (angle) => {
      o.rotate(angle);
      placeDots(true);
    }));
    dotSprings.forEach((spring, i) => {
      if (spring) {
        unfollow.push(spring.value.on("change", (angle) => {
          const bin = hovered.get();
          o.placeDot(i, angle, bin !== null && (m.dots[i]?.showsAt(bin) ?? false));
        }));
      }
    });
    placeDots(false);
    o.showScrubber(!crosshairInput(shell, index, m).hidden);
  };

  /** A bin change: the host's flag, the hot elements, the crosshair, the dots. */
  const applyHover = (): void => {
    const index = hovered.get();
    const { shell, model: m } = derive();
    if (host) {
      writePresence(host, "data-rd-hover", index !== null);
    }
    for (const element of hot) {
      element.removeAttribute("data-rd-hot");
    }
    hot = [];
    if (index !== null && m && m.hotMarks.length > 0) {
      binElements ??= collectBins(m);
      hot = binElements.get(index) ?? [];
      for (const element of hot) {
        element.setAttribute("data-rd-hot", "");
      }
    }
    const input = crosshairInput(shell, index, m);
    crosshair?.follow(input);
    overlay?.showScrubber(!input.hidden);
    if (m && overlay) {
      m.dots.forEach((dot, i) => {
        const own = dotSprings[i];
        own?.follow({ angle: shell.binAngle(index ?? 0), hidden: index === null, isFullCircle: shell.isFullCircle, snap: dot.motion === "none" || shell.reducedMotion });
        const angle = own ? own.value.get() : crosshairValue().get();
        overlay?.placeDot(i, angle, index !== null && dot.showsAt(index));
      });
    }
  };
  const collectBins = (m: RadialModel): Map<number, Element[]> => {
    const svg = svgOf();
    const out = new Map<number, Element[]>();
    for (const id of m.hotMarks) {
      const group = svg?.querySelector(`g[data-ts-key="${id}"]`);
      for (const element of group ? [...group.children] : []) {
        const bin = binOfElement(element);
        if (bin !== null) {
          const list = out.get(bin);
          if (list) { list.push(element); } else { out.set(bin, [element]); }
        }
      }
    }
    return out;
  };

  // --- Focus (pointer and keyboard) -------------------------------------------------------------------------------------------
  function onFocusChange(point: ChartPoint<RadialHitRow, number, number> | null): void {
    hold(point);
    const next = point === null ? null : point.datum.bin;
    if (latest.props.hoveredIndex === undefined) {
      hovered.set(next);
    }
    if (reported !== next) {
      reported = next;
      latest.props.onHoverChange?.(next);
    }
  }
  let reported: number | null = null;
  function onRender(context: ChartRendererRenderContext<RadialHitRow, number, number>): void {
    interaction = context.interaction;
  }
  let inRender = 0;

  /** After the renderer drew: the overlay in place, the model's decoration, the hot bin again, and the entrance on the first draw. */
  const afterDraw = (m: RadialModel, shell: RadialShell): void => {
    const surfaceElement = surfaceEl;
    if (!surfaceElement || !host) {
      return;
    }
    overlay ??= createRadialOverlay(host.ownerDocument);
    overlay.place(surfaceElement);
    const modelChanged = m !== drawnModel;
    drawnModel = m;
    binElements = null;
    const env = enterEnv(performance.now());
    if (modelChanged) {
      overlay.build({ defs: m.defs, dots: m.dots, scrubber: m.scrubber, stage: shell.stage, uid });
      if (ownedStyle && ownedStyle.textContent !== m.css) {
        ownedStyle.textContent = m.css;
      }
      ensureCrosshair(shell, m);
      wireOverlay();
    }
    m.decorate(env);
    if (!entranceDone) {
      entranceDone = true;
      if (shell.animate) {
        m.enter(env);
      }
    }
    applyHover();
    if (!revealed) {
      revealed = true;
      bump();
    }
  };

  const draw = (): void => {
    const el = surfaceEl;
    const { shell, model: m } = derive();
    if (!host || !el || !m) {
      return;
    }
    const { ariaLabel = "Radial chart", ariaDescription } = latest.props;
    // The renderer redraws on every `render`: hand it the options only when they change.
    // The carrier table too: a `<ChartDataTable open>` the reader toggles changes nothing else the draw reads.
    if (drawn && drawn.model === m && drawn.width === shell.stage.width && drawn.height === shell.stage.height && drawn.ariaLabel === ariaLabel && drawn.ariaDescription === ariaDescription && drawn.el === el && drawn.table === latest.table) {
      return;
    }
    drawn = { model: m, width: shell.stage.width, height: shell.stage.height, ariaLabel, ariaDescription, el, table: latest.table };
    const { props } = latest;
    const options = surfaceOptions<RadialHitRow, number, number>({
      ariaDescription, ariaLabel, definition: m.definition, height: shell.stage.height, initialWidth: shell.stage.width, measureText: measureNoText,
      onFocusChange, onRender, renderer, width: shell.stage.width,
      a11y: radialA11y(props.data, props.xDataKey ?? "time", props.series, props.angleType ?? "clock", latest.table),
    }, uid);
    if (m !== drawnModel) {
      // A new scene: a running entrance settles (the renderer only rewrites what changed) before it draws.
      cancelEntrance();
    }
    surface ??= createChartSurface(options);
    inRender += 1;
    try {
      surface.render(el, options);
    } finally {
      inRender -= 1;
    }
    afterDraw(m, shell);
  };
  let drawn: { model: RadialModel; width: number; height: number; ariaLabel: string; ariaDescription: string | undefined; el: HTMLElement; table: ChildTable } | null = null;
  let queued = false;
  const schedule = (): void => {
    if (inRender > 0) {
      if (!queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          draw();
        });
      }
      return;
    }
    draw();
  };

  // --- The stage's measure -------------------------------------------------------------------------------------------------------
  let resizeOff: (() => void) | null = null;
  let resizeFrame = 0;
  const measure = (): boolean => {
    const el = surfaceEl;
    const stage = el?.parentElement;
    if (!el || !stage) {
      return false;
    }
    const next = el.clientWidth;
    const offset = { left: stage.offsetLeft, top: stage.offsetTop };
    if (next === width && offset.left === stageOffset.left && offset.top === stageOffset.top) {
      return false;
    }
    width = next;
    stageOffset = offset;
    return true;
  };
  const watchSize = (el: HTMLElement): (() => void) => {
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (measure()) {
          bump();
          draw();
        }
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
    };
  };

  // --- The public stores ----------------------------------------------------------------------------------------------------------
  const setHoveredIndex = (index: number | null): void => {
    if (latest.props.hoveredIndex === undefined) {
      hovered.set(index);
    }
    latest.props.onHoverChange?.(index);
  };
  const setHoveredSeries = (index: number | null): void => {
    series.set(index);
  };
  series.subscribe(() => {
    const index = series.get();
    if (host) {
      if (index === null) {
        host.removeAttribute("data-rd-series");
      } else {
        writeAttribute(host, "data-rd-series", String(index));
      }
    }
  });
  hovered.subscribe(applyHover);
  const registerCrosshair = (angle: RadialAngleValue): (() => void) => {
    registered = angle;
    wireOverlay();
    return () => {
      if (registered === angle) {
        registered = null;
        wireOverlay();
      }
    };
  };
  const crosshairProxy: RadialAngleValue = {
    get: () => crosshairValue().get(),
    on: (event, listener) => crosshairValue().on(event, listener),
  };

  let contextCache: { pass: Pass; hovered: number | null; series: number | null; revealed: boolean; value: RadialChartContextValue } | null = null;
  const context: Readable<RadialChartContextValue> = {
    get: () => {
      const current = derive();
      const h = hovered.get();
      const s = series.get();
      if (contextCache && contextCache.pass.shell === current.shell && contextCache.hovered === h && contextCache.series === s && contextCache.revealed === revealed) {
        return contextCache.value;
      }
      const value: RadialChartContextValue = {
        ...current.shell, crosshairAngle: crosshairProxy, hoveredIndex: h, hoveredSeries: s, registerCrosshair, revealed, setHoveredIndex, setHoveredSeries,
      };
      contextCache = { pass: current, hovered: h, series: s, revealed, value };
      return value;
    },
    subscribe: (listener) => {
      const offs = [passVersion.subscribe(listener), hovered.subscribe(listener), series.subscribe(listener)];
      return () => { for (const off of offs) { off(); } };
    },
  };
  let centerCache: { shell: RadialShell; hovered: number | null; value: RadialCenterState } | null = null;
  const center: Readable<RadialCenterState> = {
    get: () => {
      const { shell } = derive();
      const h = hovered.get();
      if (centerCache && centerCache.shell.data === shell.data && centerCache.shell.series === shell.series && centerCache.hovered === h && centerCache.shell.totals === shell.totals) {
        return centerCache.value;
      }
      centerCache = { shell, hovered: h, value: radialCenterState(shell, h) };
      return centerCache.value;
    },
    subscribe: (listener) => {
      const offs = [passVersion.subscribe(listener), hovered.subscribe(listener)];
      return () => { for (const off of offs) { off(); } };
    },
  };

  // --- The controlled hover ----------------------------------------------------------------------------------------------------
  const control = (): void => {
    const { hoveredIndex } = latest.props;
    if (hoveredIndex !== undefined) {
      hovered.set(hoveredIndex);
    }
  };
  control();

  let tapOff: (() => void) | null = null;
  let holdOff: (() => void) | null = null;

  return {
    view: { get: () => derive().view, subscribe: passVersion.subscribe },
    tooltip: NO_TOOLTIP,
    context,
    center,
    centerRolls: readonly(rolls),
    legend: (read) => {
      let cache: { shell: RadialShell; format: RadialLegendProps["formatValue"]; show: boolean | undefined; series: number | null; value: RadialLegendState } | null = null;
      return {
        get: () => {
          const { shell } = derive();
          const s = series.get();
          const { formatValue: format, showValues: show } = read();
          if (cache && cache.shell.series === shell.series && cache.shell.totals === shell.totals && cache.format === format && cache.show === show && cache.series === s) {
            return cache.value;
          }
          cache = { shell, format, show, series: s, value: { items: radialLegendItems(shell, { formatValue: format, showValues: show }), hoveredSeries: s } };
          return cache.value;
        },
        subscribe: (listener) => {
          const offs = [passVersion.subscribe(listener), series.subscribe(listener)];
          return () => { for (const off of offs) { off(); } };
        },
      };
    },
    setHoveredSeries,
    update(input) {
      if (input.props === latest.props && input.table === latest.table) {
        return;
      }
      if (!sameProps(structural, input.props)) {
        structural = input.props;
      }
      const before = pass?.view;
      const shellBefore = pass?.shell;
      latest = input;
      const next = derive();
      control();
      if (next.view !== before || next.shell !== shellBefore) {
        bump();
      }
      if (host) {
        schedule();
      }
    },
    attach(dom: ChartDom, _clock: ChartClock) {
      host = dom.host;
      surfaceEl = dom.surface;
      ownedStyle = host.ownerDocument.createElement("style");
      host.insertBefore(ownedStyle, host.firstChild);
      if (series.get() !== null) {
        writeAttribute(host, "data-rd-series", String(series.get()));
      }
      // The stage is measured now, so the chart draws before the first paint (bklit-ui measures in a layout effect).
      measure();
      bump();
      draw();
      resizeOff = watchSize(dom.surface);
      tapOff = attachTapFocus(host, () => interaction, "tap");
      holdOff = hold.attach(host);
    },
    mounted() {
      // The entrance started with the first draw; nothing waits for the paint.
    },
    detach() {
      cancelEntrance();
      clearTimeout(restTimer);
      rolls.set(true);
      resizeOff?.();
      resizeOff = null;
      tapOff?.();
      tapOff = null;
      holdOff?.();
      holdOff = null;
      for (const off of unfollow.splice(0)) {
        off();
      }
      surface?.destroy();
      drawn = null;
      overlay?.remove();
      overlay = null;
      drawnModel = null;
      // A re-attach (StrictMode's second mount, a KeepAlive activation) plays the entrance again.
      entranceDone = false;
      ownedStyle?.remove();
      ownedStyle = null;
      hot = [];
      binElements = null;
      interaction = null;
      host = null;
      surfaceEl = null;
    },
    // Owner decision 1 (and React's too): the chart draws on the client, after its stage is measured; the server reserves the stage.
    prerender: () => "",
  };
}
