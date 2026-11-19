import { motion } from "@tanstack/charts/motion";
import type { ChartController, ChartClock, ChartEnv, ChartInput } from "../chart/controller";
import { erase } from "../erased-types";
import { attachTouchInert } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { nextTask } from "../lifecycle/next-task";
import { liveTilesHost } from "../markup/live";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import type { MarkupChild, MarkupNode } from "../markup/node";
import { backgroundResourcesFor, overlayResourcesFor } from "../cartesian/features";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { BackgroundConfig } from "../types/cartesian";
import type { ReferenceAreaProps } from "../types/reference-area";
import { memoCell } from "../memo";
import { observeParentSize, observeResize } from "../size/resize";
import { cssText, px } from "../style";
import type { StyleObject } from "../style";
import { liveLineA11y } from "./describe";
import type { ChartA11yInput } from "../a11y/layer";
import { createChartSurface, SURFACE_CLASS, SURFACE_STYLE, surfaceHostClass, surfaceIdPrefix, surfaceOptions } from "../surface/surface";
import type { ChartSurface } from "../surface/surface";
import { keepPresentation } from "../surface/final-positions";
import { tooltipTargetStore } from "../surface/tooltip-target";
import type { TooltipTarget } from "../surface/tooltip-target";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import type { ChartMargin } from "../theme";
import type { LiveLineChartProps } from "../types/live-line";
import { createLiveBuilt } from "./live-built";
import type { LiveTooltipConfig } from "./live-built";
import { LIVE_DEFAULT_MARGIN, LIVE_LERP_SPEED, liveCarriers, liveHostAttributes, liveInk } from "./live-config";
import { measureDisplayFrame } from "./live-display";
import { createLiveFocus } from "./live-focus";
import { createLiveHover } from "./live-hover";
import { createHeadClock } from "./live-head";
import type { HeadTick } from "./live-head";
import type { TailGeometry } from "./live-tail";
import type { LiveHoverModel } from "./live-hover";
import { COMMIT_MS, commitSteps } from "./head-ease";
import type { HeadLabel } from "./head-ease";
import { stepsTrack } from "./live-steps";
import type { LabelTrack } from "./live-steps";
import { badgeWidth } from "./live-tip";
import { X_LABEL_STEPS } from "./live-xlabels";
import type { Frame } from "./live-frame";
import { createLiveFrame } from "./live-frame-build";
import { createLivePlot, parseHeight } from "./live-geometry";
import { LIVE_VARS_CSS, liveHostVars } from "./live-host-style";
import { TICK_FADE_CSS } from "./live-tick-fade";
import { createLiveTooltipOptions, liveTooltipEqual } from "./live-tooltip";
import { createLiveYLabels, measureYLabel, Y_LABEL_GAP } from "./live-ylabels";
import type { LiveYLabels, ShownYLabels, YLabelRepickInput } from "./live-ylabels";
import { BARE_HOST_ATTRS, BARE_HOST_STYLE, LABELS_LAYER_STYLE, LIVE_HOST_STYLE, liveSurfaceStyle } from "./view";
import type { LiveLineView } from "./view";

/** The props a LiveLineChart hands its controller (the adapter keeps `className` and `children`, and merges the reader's `style` itself). */
export interface LiveLineProps extends Omit<LiveLineChartProps<unknown, never>, "children" | "className" | "style"> {
  /** The reader's style, read for its `height`: the chart's height in px (live-geometry.ts `parseHeight`, 300 by default). */
  readonly style?: { readonly height?: unknown };
}

export interface LiveLineControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

/** The elements a live line adapter rendered: the host, and the surface once it has one (React renders it only while the chart is built). */
export interface LiveLineDom {
  readonly host: HTMLElement;
  readonly surface: HTMLElement | null;
}

export interface LiveLineController extends ChartController<LiveLineProps, LiveLineView> {
  attach(dom: LiveLineDom, clock: ChartClock): void;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<LiveLineProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
  /** "adapter": the surface element React rendered for the built chart (a ref callback: null once it unmounts). Stable. */
  readonly setSurface: (element: HTMLElement | null) => void;
}

/** The width laid out on when ParentSize's first measure reads 0. */
const FALLBACK_WIDTH_PX = 640;
const NONE: readonly unknown[] = [];
const NONE_LABELS: readonly HeadLabel[] = [];

/** The rolling paths the write filter below is on. */
const filtered = /* @__PURE__ */ new WeakSet<Element>();
/** The renderer writes a rolling path's transform on every frame of its tween (charts-core motion.ts, the rolling track's `apply`), the same
 * text between the roll's steps (its easing is stepped), and an attribute write restyles the element even when nothing changed: on those
 * frames the page would have nothing else to do (the head clock writes on the steps alone, live-head.ts). A write of the value already
 * there is dropped. */
function skipSameTransform(path: Element): void {
  if (filtered.has(path)) {
    return;
  }
  filtered.add(path);
  const native = path.setAttribute;
  path.setAttribute = (name: string, value: string): void => {
    if (name === "transform" && path.getAttribute(name) === value) {
      return;
    }
    native.call(path, name, value);
  };
}

/** The roll's steady ease: linear, held for each of bklit's commit steps (the path's tween's, live-built.ts). */
const steppedEase = (ms: number): ((p: number) => number) => {
  const n = commitSteps(ms);
  return (p) => (p >= 1 ? 1 : Math.floor(p * n) / n);
};
/** A key no pass has: the keyed work runs at its first chance after an attach. */
const UNSET = /* @__PURE__ */ Symbol("unset");
const NO_CONTEXT: Readable<null> = { get: () => null, subscribe: () => () => undefined };

/** The tiles of a resources host (markup/resources.ts `resourceHost`: an svg holding one <defs>). */
const tilesOf = (host: MarkupNode | null): readonly MarkupChild[] => {
  const defs = host?.children[0];
  return defs !== null && defs !== undefined && typeof defs !== "string" && "tag" in defs ? defs.children : [];
};

/** The Background's and the ReferenceAreas' pattern tiles, when the chart has any. */
function liveDefsHost(table: ChildTable, uid: string): MarkupNode | null {
  return liveTilesHost([...tilesOf(backgroundResourcesFor(table, uid)), ...tilesOf(overlayResourcesFor(table, uid))]);
}

/** bklit Background's edge fade lengths (% per edge, background.tsx clampFadeLength) for styles.css `.bkm-bg`; none without a Background. */
function liveBackgroundVars(table: ChildTable): StyleObject {
  const props = propsFor<BackgroundConfig>(table, "background").at(0);
  if (!props) {
    return {};
  }
  const fade = (on: boolean | undefined, length: number | undefined): string => `${on === false ? 0 : Math.min(45, Math.max(0, length ?? 10))}%`;
  return { "--bkm-bg-h": fade(props.fadeHorizontal, props.fadeHorizontalLength), "--bkm-bg-v": fade(props.fadeVertical, props.fadeVerticalLength) };
}

type SurfaceOptions = ReturnType<typeof surfaceOptions>;

/** One mount of the y labels' layer: its labels state, renderer and elements (a layer that goes away starts afresh). */
interface LabelsLayer {
  readonly labels: LiveYLabels;
  /** The re-pick loop's latest commit. */
  shown: ShownYLabels | null;
  readonly renderer: ReturnType<typeof motion>;
  readonly options: (deps: readonly unknown[], compute: () => SurfaceOptions) => SurfaceOptions;
  chart: ChartSurface | undefined;
  dom: { readonly root: HTMLElement; readonly box: HTMLElement; readonly surface: HTMLElement; boxStyle: StyleObject } | undefined;
}

/** What one pass derives for the y labels' layer. */
interface LabelsPass {
  readonly layer: LabelsLayer;
  readonly options: SurfaceOptions;
  readonly repick: YLabelRepickInput;
  /** What restarts the re-pick loop: the frame, the plot's top and height, the gap, the lerp, follow and start. */
  readonly repickKey: readonly unknown[];
}

/** The texts a tick's labels walk through (live-steps.ts): the badge's (none without one) and the x label slots' start times and format. */
interface Walks {
  readonly badge: readonly HeadLabel[];
  readonly xTimes: readonly number[];
  readonly format: (time: number) => string;
}

/** Everything one pass derives from the input and the controller's state (what React's render computes). */
interface Pass {
  readonly frame: Frame | null;
  readonly walks: Walks;
  /** The hover indicator's model (none without a ChartTooltip). */
  readonly hover: LiveHoverModel | null;
  /** The frame's roll: its length and its ease (the path's tween's), for the head clock. */
  readonly roll: { readonly ms: number; readonly ease: (progress: number) => number } | null;
  readonly lerpSpeed: number;
  /** The live dot's radius (the pulse ring's start). */
  readonly dotSize: number;
  readonly built: boolean;
  /** The line's renderer options, while built. */
  readonly options: SurfaceOptions | undefined;
  /** The owned <style>'s text (the tick fade and the head's rules). */
  readonly css: string;
  readonly labels: LabelsPass | null;
  readonly view: LiveLineView;
}

const sameKeys = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

export function createLiveLineController(env: ChartEnv, initial: ChartInput<LiveLineProps>, options: LiveLineControllerOptions = {}): LiveLineController {
  // Started as the first chart is created, so the period is known before the first replay (the intro, in the seed's mount effect).
  measureDisplayFrame();
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  // The focus reads the host through a cell (live-focus.ts); it is the host while attached.
  const hostCell: { current: HTMLElement | null } = { current: null };
  // bklit's live tooltip commits only when its key changes (live-tooltip.ts `liveTooltipEqual`).
  const tooltip = tooltipTargetStore(liveTooltipEqual);
  const viewVersion = writable(0);
  const bump = (): void => { viewVersion.set(viewVersion.get() + 1); };
  let latestInput = initial;
  let pass: Pass | undefined;
  /** The first width on ParentSize's chain (null until it arrives), and the width the renderer's latest scene laid out on (0 before one). */
  let measuredWidth: number | null = null;
  let sceneWidth = 0;
  /** A change from inside: "chart" (the first width, the intro's start), "labels" (a y label pick), or "scene" (the scene's width, which
   * the renderer reports from inside its own draw). */
  let changedFromInside: (kind: "chart" | "labels" | "scene") => void = () => undefined;
  const frames = createLiveFrame();
  const focus = createLiveFocus(hostCell, (next) => {
    const width = next(sceneWidth);
    if (width !== sceneWidth) {
      const laidOut = sceneWidth || Math.round(measuredWidth ?? 0);
      sceneWidth = width;
      // The first scene reports the width the pass already laid out on (the measured one): nothing to lay out again. Handing it over
      // anyway re-rendered from inside the mounting draw, which pulled the intro's start (a passive effect) into the same task.
      if (width !== laidOut) {
        changedFromInside("scene");
      }
    }
  }, { get current() { return surfaceEl; } });
  const plot = createLivePlot();
  const liveBuilt = createLiveBuilt();
  const liveTooltip = createLiveTooltipOptions<unknown>();
  // The hover indicator, painted with every tooltip paint (live-hover.ts); one tooltip extension for the chart's life, so a new definition keeps its tooltip.
  const hoverIndicator = createLiveHover(uid);
  const tooltipUse = hoverIndicator.extension(bklitTooltip);
  // The tail's geometry at rest, handed by its mark from inside the renderer's draw (live-tail.ts), for the head clock.
  const tailSink: { tail: TailGeometry | null } = { tail: null };
  let labelsLayer: LabelsLayer | undefined;

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's useMemo did) -----------------------------
  const marginCell = memoCell<ChartMargin>();
  // First paint skips the entrance; every later update is the roll. One renderer for the chart's life.
  // The tooltip's marker rides the roll (live-hover.ts): the line keeps hit-testing its in-flight geometry.
  const renderer = keepPresentation(motion({ initial: false }));
  const optionsCell = memoCell<SurfaceOptions>();
  const attrsCell = memoCell<LiveLineView["hostAttrs"]>();
  const varsCell = memoCell<StyleObject>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const viewCell = memoCell<LiveLineView>();
  const backgroundCell = memoCell<{ readonly opacity: number } | undefined>();
  const referencesCell = memoCell<readonly ReferenceAreaProps[]>();
  const pillCell = memoCell<MarkupNode | null>();
  const hoverCell = memoCell<LiveHoverModel | null>();
  const backgroundVarsCell = memoCell<StyleObject>();
  const a11yCell = memoCell<ChartA11yInput>();

  const newLayer = (): LabelsLayer => ({ labels: createLiveYLabels(), shown: null, renderer: motion({ initial: false }), options: memoCell<SurfaceOptions>(), chart: undefined, dom: undefined });

  const derive = ({ props, table }: ChartInput<LiveLineProps>): Pass => {
    const { data, value, dataKey = "value", window: windowSecs = 30, numXTicks = 5, nowOffsetUnits = 0, exaggerate = false, lerpSpeed = LIVE_LERP_SPEED, paused = false, ariaLabel = "Live line chart", ariaDescription } = props;
    // Keyed on the prop's identity (a useMemo's deps): an inline margin is a new plot margin, so a new definition, per parent render.
    const margin = marginCell([props.margin], () => ({ ...LIVE_DEFAULT_MARGIN, ...props.margin }));
    const { line, xAxis, yAxis, tooltipCfg, grid, key, formatValue, formatTime, tooltipEnabled, rightAxis, minGap } = liveCarriers<LiveTooltipConfig>(table, dataKey);
    const height = parseHeight(props.style?.height);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);
    const width = sceneWidth || Math.round(measuredWidth ?? 0);
    // The renderers lay out at the host's width as measured (ParentSize's chain, then every resize): handed to them, they never measure
    // their container themselves, which read its box in the middle of the mounting task (a forced layout per renderer, charts-core renderer.js
    // `currentSize`). The renderer's scene still reports the width it laid out at (`sceneWidth`).
    const layoutWidth = measuredWidth ?? undefined;
    const { bklitWidth, pxPerMs, stepSecs, plotRight, plotWidth, rollEdge, plotMargin, clipExt, labelShift } = plot({ width, data, windowSecs, numXTicks, nowOffsetUnits, margin, rightAxis });
    const frame = frames.frame({ width, data, value, dataKey: key, top: margin.top, windowSecs, exaggerate, lerpSpeed, paused, pxPerMs, plotWidth, stepSecs, innerHeight, minGap, plotRight, rollEdge });
    const { momentumStroke, dotColor } = liveInk(frame, line);
    // bklit's underlay children: a Background (its marks and tile registered by its carrier, cartesian/features.ts) and the ReferenceAreas.
    // A painting Background whose carrier registered its tile (backgroundResourcesFor is null otherwise).
    const background = backgroundCell([table], () => {
      const props = propsFor<BackgroundConfig>(table, "background").at(0);
      return props && props.showFill !== false && props.pattern !== "none" && backgroundResourcesFor(table, uid) !== null ? { opacity: props.opacity ?? 1 } : undefined;
    });
    const references = referencesCell([table], () => propsFor<ReferenceAreaProps>(table, "referenceArea"));
    const { built, badgeLabels, xTickTimes, hoverBounds, pad, headCss, introEase, introEaseCss } = liveBuilt({ frame, width, margin, plotMargin, innerHeight, windowSecs, numXTicks, lerpSpeed, pxPerMs, stepSecs, uid, dataKey: key, momentumStroke, dotColor, line, xAxis, yAxis, tooltipCfg, tooltipEnabled, tooltipUse, tailSink, grid, background, references, formatValue, formatTime });
    const tooltipOptions = liveTooltip({ formatTime, formatValue, dataKey: key, label: line?.label, stroke: momentumStroke, tooltipCfg });
    focus.update({ frame, state: frames.state, hoverBounds, left: margin.left, top: margin.top, innerHeight, pxPerMs });
    const surfaceStyle = surfaceStyleCell([height], () => liveSurfaceStyle(height));
    // Keyed on the data, not the frame: the description (and a data table) follows each new sample, never each animation frame.
    const a11y = a11yCell([data, value, windowSecs, line?.label, formatValue, formatTime, table], () => liveLineA11y({ data, value, windowSecs, label: line?.label, formatValue, formatTime, table }));
    const lineOptions = built
      ? optionsCell([built.definition, height, layoutWidth, ariaLabel, ariaDescription, a11y], () =>
          surfaceOptions(erase({ definition: erase(built.definition), renderer, height, width: layoutWidth, ariaLabel, ariaDescription, onRender: erase(focus.onRender), onFocusChange: focus.onFocusChange, onTooltipBodyChange: tooltip.onChange, a11y }), uid))
      : undefined;
    // bklit's LiveYAxis layer, drawn only by a <LiveYAxis> child once there is a frame; a layer that goes away starts afresh when it comes back.
    let labels: LabelsPass | null = null;
    if (frame && yAxis) {
      labelsLayer ??= newLayer();
      const layer = labelsLayer;
      const top = margin.top;
      const { follow, start } = layer.labels.start(frame, top, innerHeight);
      const definition = layer.labels.definition({
        frame,
        shown: layer.shown,
        start,
        follow,
        margin: plotMargin,
        innerHeight,
        allowDecimals: yAxis.allowDecimals !== false,
        position: yAxis.position ?? "left",
        format: yAxis.formatValue ?? formatValue,
        labelBox: (rightAxis ? margin.right : margin.left) - Y_LABEL_GAP,
        labelShift,
      });
      labels = {
        layer,
        options: layer.options([definition, height, layoutWidth], () => surfaceOptions(erase({ definition: erase(definition), renderer: layer.renderer, height, width: layoutWidth, measureText: measureYLabel, ariaLabel: "", tabIndex: -1 }), surfaceIdPrefix(undefined, `${uid}y`))),
        repick: { frame, roll: frames.state, pick: frames.yPick, top, innerHeight, minGap, lerp: lerpSpeed, follow, start },
        repickKey: [layer, frame, top, innerHeight, minGap, lerpSpeed, follow, start],
      };
    } else {
      labelsLayer = undefined;
    }
    const hostAttrs = attrsCell([built !== null, frame], () => (built ? { ...BARE_HOST_ATTRS, "data-uid": uid, "data-slot": "chart", ...liveHostAttributes(frame) } : BARE_HOST_ATTRS));
    const backgroundVars = backgroundVarsCell([table], () => liveBackgroundVars(table));
    const hostVars = varsCell([height, built?.fillRamp, frame, pad, bklitWidth, plotRight, margin.left, clipExt, lerpSpeed, introEaseCss, backgroundVars], () =>
      built ? { height: px(height), ...backgroundVars, ...liveHostVars({ frame, pad, bklitWidth, plotRight, plotLeft: margin.left, clipExt, introEaseCss, fillRamp: built.fillRamp }) } : { height: px(height) });
    // The chart's pattern tiles (the Background's, the ReferenceAreas'), scoped to it.
    const pill = built ? pillCell([table], () => liveDefsHost(table, uid)) : null;
    // The hover indicator (live-hover.ts): bklit's crosshair rule, the tooltip's dot and LiveXAxis's time pill, on the renderer's plot.
    const showCrosshair = tooltipCfg?.showCrosshair !== false;
    const hover = hoverCell([tooltipEnabled, showCrosshair, tooltipCfg?.showDots, tooltipCfg?.dotSize, tooltipCfg?.dotScale, momentumStroke, xAxis !== undefined, formatTime, plotMargin, width, height, innerHeight], () =>
      tooltipEnabled
        ? {
            rule: showCrosshair,
            marker: tooltipCfg?.showDots === false ? null : { radius: (tooltipCfg?.dotSize ?? 5) * (tooltipCfg?.dotScale ?? 1), fill: momentumStroke },
            pill: showCrosshair && xAxis !== undefined ? { format: formatTime } : null,
            plot: { x: plotMargin.left, y: plotMargin.top, width: Math.max(0, width - plotMargin.left - plotMargin.right), height: innerHeight },
            width,
            height,
          }
        : null);
    const view = viewCell([built !== null, hostAttrs, hostVars, surfaceStyle, pill, tooltipOptions], () => ({
      built: built !== null,
      hostAttrs,
      hostStyle: built ? LIVE_HOST_STYLE : BARE_HOST_STYLE,
      hostVars,
      surfaceStyle,
      pill,
      tooltipOptions,
    }));
    const walks = { badge: line?.badge === false ? NONE_LABELS : badgeLabels, xTimes: xTickTimes, format: formatTime };
    const roll = frame ? { ms: frame.rollMs, ease: frame.intro ? introEase : steppedEase(frame.rollMs) } : null;
    return { frame, walks, roll, lerpSpeed, dotSize: line?.dotSize ?? 4, hover, built: built !== null, options: lineOptions, css: TICK_FADE_CSS + LIVE_VARS_CSS + headCss, labels, view };
  };

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  /** Which renderers the next layout hands their options: the y labels' on every commit, the line's on every commit but a pick's (a pick
   * re-renders the labels alone). */
  const dirty = { line: false, labels: false };
  let chart: ChartSurface | undefined;
  let chartIn: HTMLElement | null = null;
  let ownedStyle: HTMLStyleElement | null = null;
  let laidLayer: LabelsLayer | undefined;
  let laidFrame: Frame | null | typeof UNSET = UNSET;

  // The tick's motion after the renderer drew it at rest (live-head.ts): the tail's shapes, the tip's settle, the labels' texts after their
  // first (live-steps.ts) and the pulse ring, into the nodes the line's renderer just drew, on the rolling path's steps.
  const head = createHeadClock();
  const startTick = (surface: HTMLElement | null, p: Pass, origin: number): void => {
    const frame = p.frame;
    if (!surface || !frame || !p.roll) {
      head.stop();
      return;
    }
    const marks = surface.querySelector(":scope > svg.ts-chart > g.ts-chart__marks");
    const labels: LabelTrack[] = [];
    const { walks } = p;
    const badge = marks?.querySelector(".bkm-live-badge-text");
    const badgeBox = marks?.querySelector(".bkm-live-badge");
    if (badge && walks.badge.length > 1) {
      labels.push(stepsTrack(badge, walks.badge, badgeBox ? { node: badgeBox, width: badgeWidth } : undefined));
    }
    // A slot shows the clock at each commit step from its time at the start of the roll (bklit's LiveXAxis re-derives them per commit).
    const slots = surface.querySelectorAll(":scope > svg.ts-chart > g.bkm-live-xlabels > .bkm-live-xlabel");
    if (slots.length === walks.xTimes.length) {
      const { format } = walks;
      slots.forEach((node, i) => {
        const time = walks.xTimes[i] ?? 0;
        labels.push({ node, textAt: (step) => format(time + step * COMMIT_MS), until: X_LABEL_STEPS });
      });
    }
    const ring = marks?.querySelector<SVGElement>(":scope > g.bkm-live-tip .bkm-live-pulse") ?? null;
    let headMotion: HeadTick["head"] = null;
    if (!frame.seed) {
      const geometry = tailSink.tail;
      const tailGroup = geometry ? marks?.querySelector(":scope > g.bkm-live-tail") : null;
      const lines = tailGroup?.querySelectorAll(":scope > .bkm-live-tail-line");
      const a = lines?.[0];
      const b = lines?.[1];
      headMotion = {
        tip: frame.intro ? null : (marks?.querySelector<SVGElement>(":scope > g.bkm-live-tip") ?? null),
        tail: geometry && a && b ? { geometry, fill: tailGroup?.querySelector(".bkm-live-tail-fill") ?? null, a, b } : null,
        motion: { ax: frame.roll.x, ak: frame.roll.ak, xa: frame.roll.xa, b0: frame.roll.b0, s: frame.roll.s, t: frame.roll.t, k: frame.intro ? 1 : frame.k },
        dy: frame.intro ? 0 : frame.dy,
        d: frame.roll.d,
        lerp: p.lerpSpeed,
      };
    }
    const linePath = marks?.querySelector(":scope > g.ts-chart__line > path");
    const areaPath = marks?.querySelector(":scope > g.bkm-live-area > path");
    head.start({
      origin,
      rollMs: p.roll.ms,
      rollEase: p.roll.ease,
      continuous: frame.intro,
      head: headMotion,
      labels,
      follow: linePath && areaPath ? { line: linePath, area: areaPath } : null,
      ring: ring ? { node: ring, dotSize: p.dotSize } : null,
    });
  };

  const mountLayer = (el: HTMLElement, layer: LabelsLayer, layerPass: LabelsPass, surfaceStyle: StyleObject): void => {
    const doc = el.ownerDocument;
    const root = doc.createElement("div");
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("data-bkm-live-ylabels", "");
    root.style.cssText = cssText(LABELS_LAYER_STYLE);
    const box = doc.createElement("div");
    box.className = surfaceHostClass(undefined);
    box.style.cssText = cssText(surfaceStyle);
    const surface = doc.createElement("div");
    surface.className = SURFACE_CLASS;
    surface.style.cssText = cssText(SURFACE_STYLE);
    box.append(surface);
    root.append(box);
    // After the owned <style>, before the line's surface: the line's chart (and its tooltip) paints above it.
    el.insertBefore(root, ownedStyle?.nextSibling ?? el.firstChild);
    layer.dom = { root, box, surface, boxStyle: surfaceStyle };
    layer.chart ??= createChartSurface(layerPass.options);
    layer.chart.render(surface, layerPass.options);
  };
  const unmountLayer = (layer: LabelsLayer): void => {
    layer.chart?.destroy();
    layer.dom?.root.remove();
    layer.dom = undefined;
  };
  /** A commit's layout half: the owned <style>, the y labels' renderer, then the line's, then for a new frame the roll's stamp and the
   * focus' re-layout. */
  const layout = (): void => {
    const el = host;
    if (!el) {
      return;
    }
    const p = current();
    const { line: lineDirty, labels: labelsDirty } = dirty;
    dirty.line = false;
    dirty.labels = false;
    if (p.built) {
      if (!ownedStyle) {
        ownedStyle = el.ownerDocument.createElement("style");
        el.insertBefore(ownedStyle, el.firstChild);
      }
      if (ownedStyle.textContent !== p.css) { ownedStyle.textContent = p.css; }
    } else {
      ownedStyle?.remove();
      ownedStyle = null;
    }
    const next = p.labels;
    if (laidLayer && laidLayer !== next?.layer) {
      unmountLayer(laidLayer);
      laidLayer = undefined;
    }
    if (next) {
      const { layer } = next;
      if (layer.dom === undefined) {
        mountLayer(el, layer, next, p.view.surfaceStyle);
        laidLayer = layer;
      } else if (labelsDirty) {
        if (layer.dom.boxStyle !== p.view.surfaceStyle) {
          layer.dom.boxStyle = p.view.surfaceStyle;
          layer.dom.box.style.cssText = cssText(p.view.surfaceStyle);
        }
        layer.chart?.render(layer.dom.surface, next.options);
      }
    }
    const target = p.built ? surfaceEl : null;
    if (chart && chartIn !== null && chartIn !== target) {
      chart.destroy();
      chartIn = null;
    }
    let drawnAt: number | null = null;
    if (target && p.options && (chartIn === null || lineDirty)) {
      chart ??= createChartSurface(p.options);
      chart.render(target, p.options);
      chartIn = target;
      // The rolling tween's start: the renderer takes its clock as it draws (charts-core motion.ts `start`), and so does the head's.
      drawnAt = performance.now();
      for (const path of target.querySelectorAll(":scope > svg.ts-chart > g.ts-chart__marks > g.ts-chart__line > path")) {
        skipSameTransform(path);
      }
    }
    hoverIndicator.attach(chartIn);
    hoverIndicator.update(p.hover);
    hoverIndicator.place();
    if (p.frame !== laidFrame) {
      laidFrame = p.frame;
      frames.stampRoll(p.frame);
      focus.rolled();
      startTick(target, p, drawnAt ?? performance.now());
    } else if (drawnAt !== null) {
      // The same frame drawn again (a parent's render) puts the head's nodes back at rest: the step on screen is written again.
      head.refresh();
    }
  };

  // The keys the passive work last ran for (React effects' deps); reset by `detach`, so a re-attach runs it again.
  let passiveAttached = false;
  let repickKey: readonly unknown[] = NONE;
  let cancelRepick: (() => void) | undefined;
  let introFrame: Frame | null | typeof UNSET = UNSET;
  let hostedKey: boolean | undefined;
  let widthOff: (() => void) | undefined;
  let resizeOff: (() => void) | undefined;
  let keyboardOff: (() => void) | undefined;
  let touchOff: (() => void) | undefined;
  let pointerOff: (() => void) | undefined;
  const onWidth = (measured: number): void => {
    const width = measured > 0 ? measured : FALLBACK_WIDTH_PX;
    if (width !== measuredWidth) {
      measuredWidth = width;
      changedFromInside("chart");
    }
  };
  /** A commit's passive half: the y labels' re-pick loop, then the width observer, the intro, the keyboard and the pointer listeners;
   * every changed effect's cleanup before any setup, as React runs effects. */
  const committed = (): void => {
    const el = host;
    if (!el) {
      return;
    }
    const p = current();
    const labels = p.labels;
    const repickChanged = !sameKeys(labels?.repickKey ?? NONE, repickKey);
    const hostedChanged = p.built !== hostedKey;
    if (repickChanged) {
      cancelRepick?.();
      cancelRepick = undefined;
    }
    if (hostedChanged) {
      touchOff?.();
      touchOff = undefined;
      pointerOff?.();
      pointerOff = undefined;
    }
    const mounting = !passiveAttached;
    passiveAttached = true;
    if (repickChanged) {
      repickKey = labels?.repickKey ?? NONE;
      if (labels) {
        const { layer } = labels;
        cancelRepick = layer.labels.repick(labels.repick, (shown) => {
          layer.shown = shown;
          changedFromInside("labels");
        });
      }
    }
    if (mounting) {
      // bklit's ParentSize: the first width (live-line-chart.tsx:663; size/resize.ts).
      widthOff = observeParentSize(el, onWidth);
      // Every later width (the renderers no longer observe their containers): after ParentSize's first, each resize.
      resizeOff = observeResize(el, (entry) => {
        if (measuredWidth !== null && entry) {
          onWidth(entry.contentRect.width);
        }
      });
      measureDisplayFrame();
    }
    if (p.frame !== introFrame) {
      introFrame = p.frame;
      if (frames.startIntro(p.frame)) { changedFromInside("chart"); }
    }
    if (mounting) { keyboardOff = focus.attachKeyboard(el); }
    if (hostedChanged) {
      hostedKey = p.built;
      // bklit's live chart has mouse handlers only (onMouseMove / onMouseLeave): a touch never reaches its hover, so none reaches ours.
      if (p.built) { touchOff = attachTouchInert(el); }
      // Installed again once the chart is built (keyed on it).
      pointerOff = focus.attachPointer(el);
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
  /** "self": a new commit first runs the previous one's pending passive work, as React flushes passive effects before its next render.
   * The seed frame's draw reports the scene's width, which re-renders React synchronously: its passive work (the intro's start) runs
   * first, in the same task, so the intro's first roll is what paints, never the seed alone. Nothing runs before the first `attach`. */
  const flushPassive = (): void => {
    if (cancelPassive === undefined) {
      return;
    }
    cancelPassive();
    cancelPassive = undefined;
    committed();
  };
  // "adapter": what the next render is for: a pick re-renders only the labels, anything else the chart.
  const pending = { chart: false, labels: false };
  let committedInput: ChartInput<LiveLineProps> | undefined;
  let renderChart = true;
  // "self": the queued hand-off of a change from inside (the next microtask, or the next task).
  let microtask = false;
  let cancelTask: (() => void) | undefined;
  const handOver = (): void => {
    flushPassive();
    const before = pass?.view;
    pass = derive(latestInput);
    if (pass.view !== before) { bump(); }
    if (host) {
      layout();
      schedulePassive();
    }
  };
  changedFromInside = (kind): void => {
    if (!selfDriven) {
      pending[kind === "labels" ? "labels" : "chart"] = true;
      bump();
      return;
    }
    if (kind !== "labels") { dirty.line = true; }
    dirty.labels = true;
    if (microtask) {
      return;
    }
    // Never inside the renderers' own callbacks, and on React's lanes (see the head of this file). The scene's width comes from inside the
    // draw (React re-renders synchronously from its layout effect, before the paint): the next microtask. Anything else comes from a rAF
    // or a passive moment (React schedules a render, a task after it): the next task. A y label pick rendered inside its own animation
    // frame instead (a microtask there) restarts the leaving labels' fade track in the same frame, so it never advances: their fade-out
    // stalled until the next sample made them a real exit (~600 ms late on live-line-default).
    if (kind === "scene") {
      cancelTask?.();
      cancelTask = undefined;
      microtask = true;
      queueMicrotask(() => {
        microtask = false;
        handOver();
      });
      return;
    }
    cancelTask ??= nextTask(() => {
      cancelTask = undefined;
      handOver();
    });
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly<TooltipTarget | null>(tooltip),
    context: NO_CONTEXT,
    prepare(input) {
      renderChart = input.props !== committedInput?.props || input.table !== committedInput?.table || pending.chart || !pending.labels;
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      if (selfDriven) {
        flushPassive();
        const before = pass?.view;
        latestInput = input;
        pass = derive(input);
        if (pass.view !== before) { bump(); }
        dirty.line = true;
        dirty.labels = true;
        layout();
        schedulePassive();
        return;
      }
      if (input !== latestInput || pass === undefined) {
        latestInput = input;
        pass = derive(input);
      }
      committedInput = input;
      dirty.line = renderChart;
      dirty.labels = true;
      // Cleared before the layout: a change it causes (the scene's width on mount) is the next render's.
      pending.chart = false;
      pending.labels = false;
      layout();
    },
    committed,
    setSurface: (element) => { surfaceEl = element; },
    attach(dom) {
      host = dom.host;
      hostCell.current = dom.host;
      surfaceEl = dom.surface ?? surfaceEl;
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    // No reveal to arm: the live line's entrance is its intro roll, started from the seed frame's passive moment (`committed`).
    mounted: () => undefined,
    detach() {
      head.stop();
      cancelPassive?.();
      cancelPassive = undefined;
      cancelTask?.();
      cancelTask = undefined;
      cancelRepick?.();
      cancelRepick = undefined;
      widthOff?.();
      widthOff = undefined;
      resizeOff?.();
      resizeOff = undefined;
      keyboardOff?.();
      keyboardOff = undefined;
      focus.dispose();
      touchOff?.();
      touchOff = undefined;
      pointerOff?.();
      pointerOff = undefined;
      if (laidLayer) {
        unmountLayer(laidLayer);
        laidLayer = undefined;
      }
      chart?.destroy();
      chartIn = null;
      hoverIndicator.attach(null);
      ownedStyle?.remove();
      ownedStyle = null;
      passiveAttached = false;
      repickKey = NONE;
      introFrame = UNSET;
      hostedKey = undefined;
      laidFrame = UNSET;
      host = null;
      hostCell.current = null;
      if (selfDriven) { surfaceEl = null; }
    },
    // The live line draws after mount (bklit's ParentSize): the server renders the bare host, so there is no surface markup to serve.
    prerender: () => "",
  };
}
