import { createMark } from "@tanstack/charts";
import { defineChart } from "@tanstack/charts/scene";
import type { ChartMotionDefinition, ChartPoint, ChartRendererHostOptions, ChartRendererRenderContext, ChartTooltipContent } from "@tanstack/charts";
import { motion } from "@tanstack/charts/motion";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { propsFor } from "../carriers/table";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { joinClasses } from "../cn";
import type { AnyInteraction } from "../erased-types";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus } from "../interaction/touch-focus";
import { loadingLabelBox } from "../loading/label-box";
import { prefersReducedMotion } from "../loading/reduced-motion";
import { memoCell } from "../memo";
import { readonly, writable } from "../store";
import { px } from "../style";
import type { StyleObject } from "../style";
import { createChartSurface, surfaceBox, surfaceHostStyle, surfaceOptions } from "../surface/surface";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import { textWidth } from "../text-width";
import { TOOLTIP_MOTION } from "../theme";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { bklitTooltipPlacement } from "../tooltip/bklit-tooltip-portal";
import { itemAt, MARK_FOCUS } from "./focus";
import { createMarkLoadingLayer } from "./loading";
import { bonePhases, SKELETON_CLASS, SKELETON_KEY } from "./skeleton";
import type { MarkChartBuild, MarkChartFamily, MarkChartHandle, MarkDatum, MarkState, MarkTooltipCarrier } from "./types";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { loadingDescription } from "../a11y/describe";

/** The `ChartTooltip` carrier's role (the cartesian charts' carrier, reused: the same `content({ point, index })` on every family). */
export const MARK_TOOLTIP_ROLE = "tooltip";

/** What an adapter renders. Hover never changes it. */
export interface MarkChartView<Node> {
  readonly hostAttrs: Readonly<Record<string, string>>;
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`): its reserved size. */
  readonly surfaceStyle: StyleObject;
  /** The `ChartTooltip` carrier, when there is one: the leaf renders its `content`, else the default body. */
  readonly tooltip: MarkTooltipCarrier<Node> | null;
  /** While `status="loading"` with a `loadingLabel`: its text and its box over the plot, where the adapter renders the kit's shimmering
   * label. Null otherwise. */
  readonly loadingLabel: { readonly text: string; readonly boxStyle: StyleObject } | null;
}

export interface MarkChartController<Props, Node> extends ChartController<Props, MarkChartView<Node>> {
  /** The input of the pass being rendered (React, while rendering): idempotent, never notifies. */
  prepare(input: ChartInput<Props>): void;
}

type Datum = MarkDatum;
type Point = ChartPoint<Datum, number, number>;
type Options = ChartRendererHostOptions<Datum, number, number>;

const MARK_ID = "mark";
const LIT_ATTR = "data-bkm-on";
const HOVER_ATTR = "data-hover";
const FALLBACK_FONT = "ui-sans-serif, system-ui, sans-serif";
/** A label's width without a canvas (the server): this share of its size per character. */
const SSR_WIDTH_RATIO = 0.58;

/** Keyed updates glide on this spring (a drill-down's zoom, new data); the first paint is the family's entrance, not motion's. */
export const MARK_RENDERER = /* @__PURE__ */ motion({ initial: false, respectReducedMotion: true });
const GLIDE = { transition: { type: "spring", stiffness: 170, damping: 26, mass: 1 } } as const;

const toPoint = (datum: Datum, index: number): Point => ({
  color: datum.color ?? "",
  datum,
  datumIndex: index,
  group: null,
  groupLabel: datum.label,
  key: `${MARK_ID}:${datum.item}`,
  markId: MARK_ID,
  x: datum.x,
  xValue: datum.x,
  y: datum.y,
  yValue: datum.y,
});


const FALLBACK_FONT_RATIO = SSR_WIDTH_RATIO;
const NO_CONTENT: ChartTooltipContent = { rows: [], title: "" };
/** The host while loading: busy for assistive tech, and `data-bkm-status` for the stylesheet (the pointer passes through, as on a bar chart). */
const LOADING_ATTRS: Readonly<Record<string, string>> = { "aria-busy": "true", "data-bkm-status": "loading" };

/** A family's `status` prop (every mark chart takes one): `"loading"` draws its skeleton. */
const isLoading = (props: unknown): boolean => typeof props === "object" && props !== null && "status" in props && props.status === "loading";
/** A family's `loadingLabel` prop (every mark chart takes one); blank is none. */
const loadingTextOf = (props: unknown): string => {
  const text = typeof props === "object" && props !== null && "loadingLabel" in props ? props.loadingLabel : undefined;
  return typeof text === "string" && text.trim() !== "" ? text : "";
};

/** What a draw reads besides its build: the bones' places in the shimmer's wave (filled by the skeleton's layout), and whether this draw
 * swaps the chart and its skeleton (a status flip snaps: no glide, the entrance or the skeleton's fade plays instead). */
interface DrawState {
  readonly phases: Map<string, number>;
  snapping: boolean;
}
/** The scene is laid out in pixels: the position scales are placeholders the mark never reads. */
const unitScale = () => scaleLinear().domain([0, 1]);

/** The family's build as one custom mark in a chart with no scales or guides, with the containment focus and, with a `ChartTooltip`,
 * bklit's tooltip panel at the pointer (never sticky: a click selects). `loading` draws the build's skeleton instead: no points, so no
 * focus, no hover and no tooltip. */
const markDefinition = (build: MarkChartBuild, hasTooltip: boolean, tooltipClass: string | undefined, loading: boolean, draw: DrawState) => {
  const motion: ChartMotionDefinition<Datum> = loading || build.glide !== true ? false : () => (draw.snapping ? false : GLIDE);
  const mark = createMark<Datum, number, number>(() => ({
    channels: {},
    id: MARK_ID,
    resolveLayout: ({ chart, layout }) => ({
      render: () => {
        const fontFamily = layout.typography?.fontFamily ?? FALLBACK_FONT;
        const measure = (text: string, size: number, weight: number): number => textWidth(text, size, weight, fontFamily, FALLBACK_FONT_RATIO);
        const frame = { height: chart.height, measure, width: chart.width, x: chart.x, y: chart.y };
        if (loading) {
          const bones = build.skeleton?.(frame) ?? [];
          bonePhases(bones, frame, draw.phases);
          const skeleton = { children: bones, className: SKELETON_CLASS, key: SKELETON_KEY, kind: "group" as const };
          return { nodes: [{ ariaHidden: true, children: [skeleton], className: "bkm-mc", key: `${MARK_ID}:root`, kind: "group" as const }], points: [] };
        }
        const laid = build.layout(frame);
        return { nodes: [{ ariaHidden: true, children: laid.nodes, className: "bkm-mc", key: `${MARK_ID}:root`, kind: "group" as const }], points: laid.points.map(toPoint) };
      },
    }),
  }), motion);
  const margin = { bottom: build.margin?.bottom ?? 0, left: build.margin?.left ?? 0, right: build.margin?.right ?? 0, top: build.margin?.top ?? 0 };
  if (!hasTooltip || loading) {
    return defineChart({ focus: MARK_FOCUS, focusRing: false, guides: false, margin, marks: [mark], scales: { x: { scale: unitScale() }, y: { scale: unitScale() } }, tooltip: false });
  }
  return defineChart({
    focus: MARK_FOCUS,
    focusRing: false,
    guides: false,
    margin,
    marks: [mark],
    scales: { x: { scale: unitScale() }, y: { scale: unitScale() } },
    tooltip: {
      anchor: "pointer",
      className: joinClasses("bkm-mc-tooltip", tooltipClass),
      content: (focusedPoints: readonly Point[]): ChartTooltipContent => {
        const datum = focusedPoints[0]?.datum;
        return (datum === undefined ? null : build.tooltip?.(datum)) ?? NO_CONTENT;
      },
      motion: TOOLTIP_MOTION,
      offset: 16,
      portal: bklitTooltipPlacement({ pointerAnchor: true }),
      sticky: false,
      use: bklitTooltip,
    },
  });
};
type MarkDefinition = ReturnType<typeof markDefinition>;

interface Pass<Node> {
  readonly build: MarkChartBuild;
  /** `status="loading"` (and the family draws a skeleton). */
  readonly loading: boolean;
  readonly options: Options;
  readonly view: MarkChartView<Node>;
}

export function createMarkChartController<Props, Node>(family: MarkChartFamily<Props>, env: ChartEnv, initial: ChartInput<Props>): MarkChartController<Props, Node> {
  const { uid } = env;
  const builder = family.createBuilder();
  let state: MarkState = family.initialState ?? {};
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  let interaction: AnyInteraction | null = null;
  const tooltip = tooltipTargetStore();
  const viewVersion = writable(0);
  let latestInput = initial;
  let pass: Pass<Node> | undefined;
  // The items the latest draw laid out (pointer lookups for a family's listeners).
  let points: readonly Datum[] = [];

  // --- Hover: attribute writes on the drawn elements -----------------------------------------------------------------------------
  let index: Map<string, Element> | null = null;
  let lit: readonly string[] = [];
  let suspended = false;
  const elementOf = (key: string): Element | undefined => {
    if (index === null) {
      index = new Map();
      for (const element of surfaceEl?.querySelectorAll("[data-ts-key]") ?? []) {
        index.set(element.getAttribute("data-ts-key") ?? "", element);
      }
    }
    return index.get(key);
  };
  const light = (keys: readonly string[]): void => {
    if (host === null) { return; }
    for (const key of lit) {
      if (!keys.includes(key)) { elementOf(key)?.removeAttribute(LIT_ATTR); }
    }
    for (const key of keys) {
      if (!lit.includes(key)) { elementOf(key)?.setAttribute(LIT_ATTR, ""); }
    }
    lit = keys;
    host.toggleAttribute(HOVER_ATTR, keys.length > 0);
  };
  const keysOf = (datum: Datum | null): readonly string[] => (datum === null ? [] : [datum.item, ...(datum.related ?? [])]);
  let focused: Datum | null = null;
  let legendSeries: number | null = null;
  const relight = (): void => {
    if (current().loading) {
      light([]);
    } else if (focused !== null) {
      light(keysOf(focused));
    } else if (legendSeries !== null) {
      light(current().build.seriesItems?.(legendSeries) ?? []);
    } else {
      light([]);
    }
  };
  const hold = createKeyboardFocusHold(() => interaction);
  const onFocusChange = (point: Point | null): void => {
    hold(point);
    const next = point?.datum ?? null;
    const changed = next?.item !== focused?.item;
    focused = next;
    if (!suspended) { relight(); }
    if (changed) { current().build.hover?.(next); }
  };

  // --- One pass ------------------------------------------------------------------------------------------------------------------
  const definitionCell = memoCell<MarkDefinition>();
  const optionsCell = memoCell<Options>();
  const viewCell = memoCell<MarkChartView<Node>>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const hostAttrsCell = memoCell<Readonly<Record<string, string>>>();
  const hostStyleCell = memoCell<StyleObject>();
  const labelCell = memoCell<MarkChartView<Node>["loadingLabel"]>();
  const draw: DrawState = { phases: new Map(), snapping: false };
  const setState = (patch: MarkState): void => {
    state = { ...state, ...patch };
    const before = pass;
    pass = undefined;
    const next = current();
    if (next.view !== before?.view) { viewVersion.set(viewVersion.get() + 1); }
    redraw();
  };
  const derive = ({ props, table }: ChartInput<Props>): Pass<Node> => {
    const build = builder({ props, table, uid, state, setState });
    const loading = isLoading(props) && build.skeleton !== undefined;
    const carrier = propsFor<MarkTooltipCarrier<Node>>(table, MARK_TOOLTIP_ROLE).at(-1) ?? null;
    const hasTooltip = carrier !== null && build.tooltip !== undefined;
    const tooltipClass = carrier?.className;
    const definition = definitionCell([build, hasTooltip, tooltipClass, loading], () => markDefinition(build, hasTooltip, tooltipClass, loading, draw));
    const dataTable = propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0];
    const options = optionsCell([definition, build.aspectRatio, build.height, build.ariaLabel, build.ariaDescription, build.describe, loading, dataTable], () => {
      const describe = loading ? () => loadingDescription(build.ariaLabel) : build.describe;
      return surfaceOptions<Datum, number, number>({ ariaDescription: build.ariaDescription, ariaLabel: build.ariaLabel, aspectRatio: build.aspectRatio, definition, height: build.height, onFocusChange, onRender, onSelect, onTooltipBodyChange: tooltip.onChange, renderer: MARK_RENDERER, a11y: { describe, dataTable } }, uid);
    });
    const minHeight = build.height === undefined ? build.minHeight : undefined;
    const surfaceStyle = surfaceStyleCell([build.aspectRatio, build.height, minHeight], () =>
      surfaceHostStyle(surfaceBox({ aspectRatio: build.aspectRatio, height: build.height }), minHeight === undefined ? undefined : { "min-height": px(minHeight) }));
    const hostAttrs = hostAttrsCell([build.hostAttrs, build.selectable, loading], () => ({
      "data-bkm-chart": family.chart,
      "data-bkm-mc": "",
      "data-slot": "chart",
      ...(build.selectable === true && !loading ? { "data-bkm-selectable": "" } : {}),
      ...build.hostAttrs,
      ...(loading ? LOADING_ATTRS : {}),
    }));
    // The label sits over the plot (the scene inside the build's margins), in the host: positioned while it shows.
    const text = loading ? loadingTextOf(props) : "";
    const loadingLabel = labelCell([text, build.margin], () => (text === "" ? null : { text, boxStyle: loadingLabelBox({ top: build.margin?.top ?? 0, right: build.margin?.right ?? 0, bottom: build.margin?.bottom ?? 0, left: build.margin?.left ?? 0 }) }));
    const hostStyle = hostStyleCell([build.hostStyle, loadingLabel === null], () => (loadingLabel === null ? build.hostStyle ?? {} : { ...build.hostStyle, position: "relative" }));
    const view = viewCell([hostAttrs, hostStyle, surfaceStyle, carrier, loadingLabel], () => ({ hostAttrs, hostStyle, surfaceStyle, tooltip: carrier, loadingLabel }));
    return { build, loading, options, view };
  };
  function current(): Pass<Node> {
    pass ??= derive(latestInput);
    return pass;
  }

  // --- The draw ----------------------------------------------------------------------------------------------------------------
  let enterFor: string | undefined;
  let entered = false;
  const loadingLayer = createMarkLoadingLayer();
  /** The status the surface last drew (null: nothing drawn since the attach). */
  let drawnLoading: boolean | null = null;
  /** Whether the entrance and the skeleton's motion play: a family's `enter` (none with `animate={false}`), not a static preview, and the
   * reader allows motion. */
  const moves = (build: MarkChartBuild): boolean => build.enter !== undefined && !env.staticPreview && !prefersReducedMotion();
  function onRender(context: ChartRendererRenderContext<Datum, number, number>): void {
    interaction = context.interaction;
    points = context.scene.points.map((point) => point.datum);
    index = null;
    const { build, loading } = current();
    if (loading) {
      // The skeleton fades in and shimmers; the entrance waits for the ready draw.
      if (moves(build)) { loadingLayer.drawn(context.container, draw.phases); }
    } else if (!entered || enterFor !== build.revealKey) {
      // The entrance, once per reveal, on the elements this draw made, before they paint.
      entered = true;
      enterFor = build.revealKey;
      const { enter } = build;
      if (enter !== undefined && moves(build)) {
        for (const element of context.container.querySelectorAll("[data-ts-key]")) {
          const spec = enter(element.getAttribute("data-ts-key") ?? "", element);
          if (spec !== undefined) {
            element.animate(spec.keyframes, { delay: spec.delay, duration: spec.duration, easing: spec.easing, fill: "backwards" });
          }
        }
      }
    }
    // A redraw may have made the lit elements anew.
    if (lit.length > 0) {
      const keys = lit;
      lit = [];
      light(keys);
    }
  }
  function onSelect(point: Point | null): void {
    current().build.select?.(point?.datum ?? null);
  }

  let chart: ChartSurface<Datum, number, number> | undefined;
  const surfaceOf = (): ChartSurface<Datum, number, number> => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  /** A draw that swaps the chart and its skeleton snaps (no glide): to loading, the drawn chart fades out first; to ready, the entrance
   * plays again. */
  const flip = (next: Pass<Node>, el: HTMLElement): void => {
    draw.snapping = true;
    relight();
    if (next.loading) {
      if (moves(next.build)) { loadingLayer.conceal(el); }
    } else {
      loadingLayer.clear();
      entered = false;
    }
  };
  function redraw(): void {
    if (surfaceEl === null) { return; }
    const next = current();
    if (drawnLoading !== null && drawnLoading !== next.loading) { flip(next, surfaceEl); }
    drawnLoading = next.loading;
    surfaceOf().render(surfaceEl, next.options);
    draw.snapping = false;
  }

  // --- Listeners ---------------------------------------------------------------------------------------------------------------
  const handle: MarkChartHandle = {
    itemAt: (clientX, clientY) => {
      const [x, y] = handle.toScene(clientX, clientY);
      return itemAt(points, x, y);
    },
    setState,
    state: () => state,
    suspendHover: (next) => {
      suspended = next;
      if (!next) { relight(); }
    },
    toScene: (clientX, clientY) => {
      const box = surfaceEl?.getBoundingClientRect();
      return box === undefined ? [clientX, clientY] : [clientX - box.left, clientY - box.top];
    },
  };
  let listenersOff: (() => void) | undefined;
  let legendOff: (() => void) | undefined;
  /** A family's drag (its build's `drag`): a press on an item it claims captures the pointer until release; hover pauses meanwhile. */
  const attachDrag = (el: HTMLElement): (() => void) => {
    let dragging: number | null = null;
    const down = (event: PointerEvent): void => {
      const { build, loading } = current();
      const drag = build.drag;
      if (drag === undefined || loading || event.button !== 0) { return; }
      const [x, y] = handle.toScene(event.clientX, event.clientY);
      const datum = itemAt(points, x, y);
      if (datum === null || !drag.start(datum, x, y)) { return; }
      dragging = event.pointerId;
      el.setPointerCapture(event.pointerId);
      el.toggleAttribute("data-bkm-dragging", true);
      event.preventDefault();
    };
    const move = (event: PointerEvent): void => {
      if (dragging !== event.pointerId) { return; }
      const [x, y] = handle.toScene(event.clientX, event.clientY);
      current().build.drag?.move(x, y);
    };
    const up = (event: PointerEvent): void => {
      if (dragging !== event.pointerId) { return; }
      dragging = null;
      el.toggleAttribute("data-bkm-dragging", false);
      if (el.hasPointerCapture(event.pointerId)) { el.releasePointerCapture(event.pointerId); }
      current().build.drag?.end();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return (): void => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  };
  const listen = (el: HTMLElement): (() => void) => {
    const tapOff = attachTapFocus(el, () => interaction, "tap");
    const holdOff = hold.attach(el);
    const dragOff = attachDrag(el);
    const familyOff = family.listen?.(el, handle);
    return (): void => {
      tapOff();
      holdOff();
      dragOff();
      familyOff?.();
    };
  };
  const followLegend = (): (() => void) | undefined => {
    const store = env.legendHover;
    if (store === undefined) { return undefined; }
    const read = (): void => {
      legendSeries = store.get().legend;
      if (focused === null) { relight(); }
    };
    read();
    return store.subscribe(read);
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
      if (pass.view !== before) { viewVersion.set(viewVersion.get() + 1); }
      redraw();
    },
    attach(dom) {
      host = dom.host;
      surfaceEl = dom.surface;
      entered = false;
      drawnLoading = current().loading;
      surfaceOf().render(dom.surface, current().options);
      listenersOff = listen(dom.host);
      legendOff = followLegend();
    },
    // No reveal to arm: the entrance plays from the first draw.
    mounted() {},
    detach() {
      listenersOff?.();
      listenersOff = undefined;
      legendOff?.();
      legendOff = undefined;
      chart?.destroy();
      loadingLayer.clear();
      drawnLoading = null;
      tooltip.onChange(null);
      lit = [];
      index = null;
      focused = null;
      interaction = null;
      host = null;
      surfaceEl = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
