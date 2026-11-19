import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import { motion } from "@tanstack/charts/motion";
import type { ChildTable } from "../carriers/table";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { erase } from "../erased-types";
import { clearAttribute, writePresence } from "../host-write";
import { hostPointerMove } from "../interaction/host-pointer";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus, createInteractionHandle } from "../interaction/touch-focus";
import { prefersReducedMotion } from "../loading/reduced-motion";
import type { MarkupTree } from "../markup/node";
import { memoCell } from "../memo";
import type { ChartStatus } from "../motion/phase";
import { measureNoText } from "../polar/measure-no-text";
import { readonly, writable } from "../store";
import type { StyleObject } from "../style";
import { createChartSurface, surfaceBox, surfaceHostStyle, surfaceOptions } from "../surface/surface";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import { bklitSurfaceStyle } from "../theme";
import { hoverCss, SPATIAL_CSS, SPATIAL_HOST_ATTR } from "./css";
import { playSpatialEntrance } from "./entrance";
import type { SpatialBuild, SpatialDescribe, SpatialFamily, SpatialTooltipPlan } from "./family";
import { createSpatialHover } from "./hover";
import { createSpatialLoadingLayer, spatialLoadingLabel } from "./loading";
import type { SpatialLoadingInput } from "./loading";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import { propsFor } from "../carriers/table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { loadingDescription } from "../a11y/describe";

/** The props every spatial controller reads beside the family's own (the adapter keeps `className` and `children`). */
export interface SpatialControllerProps {
  readonly animate?: boolean;
  readonly animationDuration?: number;
  readonly revealSignature?: string;
  readonly status?: ChartStatus;
  readonly loadingLabel?: string;
}

export interface SpatialControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

/** What a spatial chart's adapter renders: the host, the surface box, the legend under it and the tooltip body's plan. */
export interface SpatialView {
  /** The host's attributes (`undefined` leaves one out), beside the adapter's own `class`. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`. */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`) at the chart's aspect ratio. */
  readonly surfaceStyle: StyleObject;
  /** The legend under the plot (markup every framework renders); null: none. */
  readonly legend: MarkupTree | null;
  /** While loading, the label over the plot (markup every framework renders, after the surface); null: none. */
  readonly loadingLabel: MarkupTree | null;
  /** The tooltip carrier and what it shows; null: no tooltip carrier (the chart has none). */
  readonly tooltip: SpatialTooltipPlan | null;
}

export interface SpatialController<Props> extends ChartController<Props, SpatialView> {
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<Props>): void;
}

const DEFAULT_SWEEP_MS = 900;
const DRAG_ATTR = "data-bkm-drag";
/** While the family draws the drag's frames itself: the renderer's marks are hidden under them. */
const DRAWING_ATTR = "data-bkm-drawing";
const DRAG_SVG_CLASS = "bkm-sp-drag";
const DRAG_ON_ATTR = "data-bkm-drag-on";

/** The definition's inputs as a flat list, compared position by position: the props it reads and its carriers' props, entry by entry, so
 * a framework's new props object (or table) with the same values keeps the definition. */
const definitionDeps = (props: Readonly<Record<string, unknown>>, table: ChildTable, propNames: readonly string[], roles: readonly string[]): unknown[] => {
  const deps: unknown[] = [];
  for (const name of propNames) {
    deps.push(props[name]);
  }
  for (const role of roles) {
    const list = table.get(role) ?? [];
    deps.push(role, list.length);
    for (const carrier of list) {
      for (const key of Object.keys(carrier).sort()) {
        deps.push(key, carrier[key]);
      }
    }
  }
  return deps;
};

/** The tooltip's plan: the latest tooltip carrier's props, and the build's content for the focused points. */
const tooltipPlan = (describe: SpatialDescribe | null, carrier: Readonly<Record<string, unknown>> | undefined): SpatialTooltipPlan | null => {
  if (describe === null || carrier === undefined) {
    return null;
  }
  return { carrier, shown: (points) => describe(points, carrier) };
};

interface Pass {
  readonly build: SpatialBuild;
  readonly options: ReturnType<typeof surfaceOptions>;
  readonly view: SpatialView;
  readonly animate: boolean;
  readonly sweepMs: number;
  readonly revealKey: string;
  /** `status="loading"`: the family draws its skeleton (loading.ts). */
  readonly loading: boolean;
}

export function createSpatialController<Props extends SpatialControllerProps>(
  env: ChartEnv,
  initial: ChartInput<Props>,
  family: SpatialFamily<Props>,
  options: SpatialControllerOptions = {},
): SpatialController<Props> {
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  const builder = family.createBuilder();
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  const tooltip = tooltipTargetStore();
  const handle = createInteractionHandle();
  const hold = createKeyboardFocusHold(() => handle.interaction.current);
  const hover = createSpatialHover(() => host);
  const loadingLayer = createSpatialLoadingLayer();
  const viewVersion = writable(0);
  const renderer = motion(erase({ initial: false, transition: { type: "tween", duration: 450 } }));
  let latestInput = initial;
  let pass: Pass | undefined;
  // Bumped by the family's drag: a new frame is a new definition.
  let frame = 0;

  // --- One pass: the memo cells keep each value's identity while its inputs hold --------------------------------------------------
  const buildCell = memoCell<SpatialBuild>();
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const hostStyleCell = memoCell<StyleObject>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const hostAttrsCell = memoCell<SpatialView["hostAttrs"]>();
  const planCell = memoCell<SpatialTooltipPlan | null>();
  const labelCell = memoCell<MarkupTree | null>();
  const viewCell = memoCell<SpatialView>();
  const derive = ({ props, table }: ChartInput<Props>): Pass => {
    // SAFETY: a chart's props are a plain record of its declared props.
    const record = props as unknown as Readonly<Record<string, unknown>>;
    const deps = definitionDeps(record, table, family.definitionProps, family.definitionRoles);
    const tooltipCarrier = table.get(family.tooltipRole)?.at(-1);
    const loading = props.status === "loading";
    deps.push(frame, tooltipCarrier !== undefined, loading);
    const build = buildCell(deps, () => builder({ props, table, uid, frame, loading }));
    const dataTable = propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0];
    const opts = optionsCell([build.definition, build.aspectRatio, build.ariaLabel, build.ariaDescription, build.describeData, loading, dataTable], () => {
      const a11y = { describe: loading ? () => loadingDescription(build.ariaLabel) : build.describeData, dataTable };
      return surfaceOptions(erase({ definition: build.definition, renderer, aspectRatio: build.aspectRatio, ariaLabel: build.ariaLabel, ariaDescription: build.ariaDescription, onFocusChange, onRender, measureText: measureNoText, onTooltipBodyChange: tooltip.onChange, a11y }), uid);
    });
    const hostStyle = hostStyleCell([build.hostVars], () => ({ width: "100%", position: "relative", ...bklitSurfaceStyle, ...build.hostVars }));
    const surfaceStyle = surfaceStyleCell([build.aspectRatio], () => surfaceHostStyle(surfaceBox({ aspectRatio: build.aspectRatio })));
    const hostAttrs = hostAttrsCell([build.hostAttrs, loading], () => ({ "data-bkm-chart": family.chart, [SPATIAL_HOST_ATTR]: "", "data-bkm-kit": uid, "data-slot": "chart", "data-bkm-status": loading ? "loading" : undefined, ...build.hostAttrs }));
    const plan = planCell([build.describe, tooltipCarrier], () => tooltipPlan(build.describe, tooltipCarrier));
    const loadingLabel = labelCell([loading, props.loadingLabel, build.aspectRatio], () => (loading ? spatialLoadingLabel(props.loadingLabel, build.aspectRatio) : null));
    const view = viewCell([hostAttrs, hostStyle, surfaceStyle, build.legend, plan, loadingLabel], () => ({ hostAttrs, hostStyle, surfaceStyle, legend: build.legend, loadingLabel, tooltip: plan }));
    return {
      build,
      options: opts,
      view,
      animate: props.animate !== false,
      sweepMs: props.animationDuration ?? DEFAULT_SWEEP_MS,
      revealKey: props.revealSignature ?? "",
      loading,
    };
  };
  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- What a draw and a focus change hand back -------------------------------------------------------------------------------
  // The reveal key the entrance last played for; reset by `detach` (a re-attach plays it again) and by a loading draw (the ready draw
  // after it plays it).
  let played: string | null = null;
  let cancelEntrance: (() => void) | undefined;
  const chartSvg = (): SVGSVGElement | null => {
    const svg = surfaceEl?.querySelector("svg.ts-chart");
    return svg instanceof SVGSVGElement ? svg : null;
  };
  const loadingInput = (): SpatialLoadingInput => {
    const { build, animate, loading } = current();
    return { loading, motion: animate && !prefersReducedMotion(), skeleton: build.skeleton ?? [] };
  };
  function onRender(context: ChartRendererRenderContext): void {
    handle.onRender(erase(context));
    const surface = surfaceEl;
    if (surface === null) {
      return;
    }
    if (dragSvgDone) {
      dropDragSvg();
    }
    hover.drawn(surface);
    const svg = chartSvg();
    const { build, animate, sweepMs, revealKey, loading } = current();
    if (svg !== null && (loading || loadingLayer.wasLoading())) {
      loadingLayer.drawn(svg, loadingInput());
    }
    if (loading) {
      played = null;
      return;
    }
    if (played === revealKey || svg === null) {
      return;
    }
    // After loading, the chrome the skeleton stood on (the land) stays as it was: only the marks the loading draw had not play.
    const kept = loadingLayer.kept();
    const entrances = kept === null ? build.entrance : build.entrance.filter((entrance) => !kept.has(entrance.markId));
    if (!animate || entrances.length === 0 || prefersReducedMotion()) {
      played = revealKey;
      loadingLayer.entered();
      return;
    }
    cancelEntrance?.();
    const entrance = playSpatialEntrance(svg, entrances, sweepMs);
    cancelEntrance = entrance.cancel;
    // Marks that are not drawn yet (no data) play when they first are.
    if (entrance.started > 0) {
      played = revealKey;
      loadingLayer.entered();
    }
  }
  function onFocusChange(point: ChartPoint | null): void {
    // Nothing is hovered while loading (the skeleton has no points; a focus left from before the flip goes).
    const focused = current().loading ? null : point;
    hold(erase(focused));
    hover.focus(focused, current().build);
  }

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  let ownedStyle: HTMLStyleElement | null = null;
  const ownedCss = (): string => `${SPATIAL_CSS}${family.css}${hoverCss(uid, current().build.hoverLayers)}`;
  const layout = (): void => {
    if (surfaceEl === null) {
      return;
    }
    if (ownedStyle !== null) {
      const text = ownedCss();
      if (ownedStyle.textContent !== text) { ownedStyle.textContent = text; }
    }
    surfaceOf().render(surfaceEl, current().options);
  };

  // --- The family's drag (the globe): a pointer drag on the host, one frame per animation frame ------------------------------------
  // With the family's `draw`, the frames are drawn into an svg of our own over the plot (the renderer's marks hidden, DRAWING_ATTR) and the
  // renderer draws once on release; else each frame is a new definition the renderer draws.
  let dragFrame = 0;
  let dragSvg: SVGSVGElement | null = null;
  // The drag svg goes once the renderer has drawn the released frame (the next draw).
  let dragSvgDone = false;
  const rebuild = (): void => {
    frame += 1;
    pass = derive(latestInput);
    layout();
  };
  const drawDrag = (): void => {
    const draw = current().build.drag?.draw;
    const surface = surfaceEl;
    const chartSvg = surface?.querySelector("svg.ts-chart");
    if (draw === undefined || surface === null || surface === undefined || !(chartSvg instanceof SVGSVGElement)) {
      rebuild();
      return;
    }
    if (dragSvg === null) {
      dragSvg = surface.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
      dragSvg.setAttribute("class", DRAG_SVG_CLASS);
      dragSvg.setAttribute("aria-hidden", "true");
      chartSvg.after(dragSvg);
    }
    dragSvg.setAttribute("viewBox", chartSvg.getAttribute("viewBox") ?? "");
    dragSvgDone = false;
    writePresence(host, DRAWING_ATTR, true);
    draw(dragSvg);
  };
  const redraw = (): void => {
    if (dragFrame !== 0) { return; }
    dragFrame = requestAnimationFrame(() => {
      dragFrame = 0;
      drawDrag();
    });
  };
  /** The release: the renderer draws the last frame; the drag svg stays until it has. */
  const settle = (): void => {
    cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    if (dragSvg === null) {
      return;
    }
    dragSvgDone = true;
    rebuild();
  };
  const dropDragSvg = (): void => {
    dragSvg?.remove();
    dragSvg = null;
    dragSvgDone = false;
    clearAttribute(host, DRAWING_ATTR);
  };
  const listenDrag = (el: HTMLElement): (() => void) => {
    let last: { readonly id: number; x: number; y: number } | null = null;
    const onDown = (event: PointerEvent): void => {
      const { build, loading } = current();
      const { drag } = build;
      if (drag === null || loading || event.button !== 0) { return; }
      last = { id: event.pointerId, x: event.clientX, y: event.clientY };
      el.setPointerCapture(event.pointerId);
      writePresence(el, DRAG_ATTR, true);
      handle.interaction.current?.setControlledFocus(null, { source: "pointer" });
      drag.start();
    };
    const onMove = (event: PointerEvent): void => {
      if (last?.id !== event.pointerId) { return; }
      const drag = current().build.drag;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last.x = event.clientX;
      last.y = event.clientY;
      event.stopPropagation();
      if (drag?.move(dx, dy) === true) { redraw(); }
    };
    const onUp = (event: PointerEvent): void => {
      if (last?.id !== event.pointerId) { return; }
      last = null;
      clearAttribute(el, DRAG_ATTR);
      current().build.drag?.end();
      settle();
    };
    el.addEventListener("pointerdown", onDown);
    // The drag swallows the host's own move stream (raw samples where the browser has them): no hover while the globe turns.
    const moveEvent = hostPointerMove(el);
    el.addEventListener(moveEvent, onMove, { capture: true });
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return (): void => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener(moveEvent, onMove, { capture: true });
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      clearAttribute(el, DRAG_ATTR);
    };
  };

  let listenersOff: (() => void) | undefined;
  const listen = (el: HTMLElement): (() => void) => {
    const dragged = current().build.drag !== null;
    writePresence(el, DRAG_ON_ATTR, dragged);
    // Under touch a drag chart rotates; the others focus on a tap (interaction/touch-focus.ts), with the keyboard hold.
    const touchOff = dragged ? listenDrag(el) : attachTapFocus(el, () => handle.interaction.current, "tap");
    const holdOff = hold.attach(el);
    return (): void => {
      touchOff();
      holdOff();
      clearAttribute(el, DRAG_ON_ATTR);
    };
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
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
    },
    attach(dom) {
      host = dom.host;
      surfaceEl = dom.surface;
      // The owned stylesheet sits first in the host, before the surface's box.
      let before: Node = dom.surface;
      while (before.parentNode !== null && before.parentNode !== dom.host) { before = before.parentNode; }
      ownedStyle = dom.host.ownerDocument.createElement("style");
      ownedStyle.textContent = ownedCss();
      dom.host.insertBefore(ownedStyle, before.parentNode === dom.host ? before : null);
      surfaceOf().render(dom.surface, current().options);
      listenersOff = listen(dom.host);
    },
    mounted: () => undefined,
    detach() {
      cancelAnimationFrame(dragFrame);
      dragFrame = 0;
      dropDragSvg();
      cancelEntrance?.();
      cancelEntrance = undefined;
      played = null;
      loadingLayer.detach();
      listenersOff?.();
      listenersOff = undefined;
      hover.detach();
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      tooltip.onChange(null);
      handle.interaction.current = null;
      host = null;
      surfaceEl = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
