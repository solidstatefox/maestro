import { motion } from "@tanstack/charts/motion";
import type { ChartRendererRenderContext } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { armReveal } from "../entrance/arm";
import { createReadyGate } from "../entrance/ready-gate";
import type { ReadyGateRun } from "../entrance/ready-gate";
import { erase } from "../erased-types";
import { clearAttribute } from "../host-write";
import { createFocusStore } from "../hover/focus-store";
import type { FocusStore } from "../hover/focus-store";
import { createHoverHostSync, writeLegendHover } from "../hover/host-sync";
import { createDragSelect } from "../interaction/drag-select";
import type { DragGeom } from "../interaction/drag-select";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { afterPaint } from "../lifecycle/after-paint";
import { createLoadingPhase, loadingFlags, loadingWipe, yDomainsTween } from "../loading/phase-machine";
import type { LoadingPhase } from "../loading/phase-machine";
import { generateChartSkeletonData, generateChartSkeletonFromTarget } from "../loading/skeleton-data";
import { highlightBandClip } from "../markup/band-clip";
import { memoCell } from "../memo";
import type { ChartStatus, EnterTransition } from "../motion/phase";
import { parseEasing } from "../motion/easing";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import { createChartSurface, surfaceBox, surfaceHostStyle, surfaceOptions } from "../surface/surface";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import type { StyleObject } from "../style";
import { DEFAULT_ANIMATION_MS, DEFAULT_MARGIN, parseAspectRatio } from "../theme";
import type { ChartMargin } from "../theme";
import type { ChartMarker } from "../types/cartesian";
import type { ChartLinkProps } from "../types/link";
import { createBrush } from "./brush";
import { createCartesianContext } from "./context";
import type { CartesianFocus, ChartContext, ContainerRef } from "./context";
import { createDataUpdateStep } from "./data-update-step";
import type { DataUpdateStep, UpdateSequence } from "./data-update-step";
import { buildCartesianDefinition, gridAttrsOf, hasHighlight } from "./definition";
import { seriesHighlightBands } from "./series-marks";
import type { CartesianBuild } from "./definition";
import { backgroundResourcesFor, createCrosshairSlot, installMarkers, markerListsFor, overlayResourcesFor, rangeResourcesFor } from "./features";
import { cartesianStaticCss, writeSizeVars } from "./host-style";
import type { BrushVars } from "./host-style";
import { pillFadeHalf, refreshTickVars } from "./date-pill";
import { HoverOverlay, overlayPlotOf } from "./hover-overlay";
import { createCartesianLink } from "./link";
import { loadingHostAttrs } from "./loading";
import type { LoadingGrid } from "./loading";
import { createPlotStore } from "./plot-size";
import type { PlotSnapshot, PlotStore } from "./plot-size";
import { resolveSeries, toDate } from "./series";
import type { ResolvedSeries, Row } from "./series";
import { brushPanes, cartesianHostStyle, loadingHostStyle, tooltipBaseOf, withRangeRows } from "./view";
import type { YDomainOverride } from "./y-domain-utils";
import type { CartesianView } from "./view";
import { describeCartesian } from "./describe";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";

/** The props a LineChart / AreaChart hands its controller (the adapter keeps `className` and merges the reader's `style` itself). */
export interface CartesianProps extends ChartLinkProps {
  readonly data: readonly Row[];
  readonly xDataKey?: string;
  readonly animationDuration?: number;
  readonly margin?: Partial<ChartMargin>;
  readonly aspectRatio?: string | number;
  /** The reader's style, read for one thing: `aspectRatio: "unset"` makes the surface fill the host's height. */
  readonly style?: { readonly aspectRatio?: unknown };
  readonly xDomain?: [Date, Date];
  /** Full dataset length while brush-zoomed: the slot count behind `columnWidth`. */
  readonly xDomainSlotCount?: number;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
  readonly defaultAriaLabel: string;
  /** `"loading"`: series pulse instead of drawing, the grid takes its loading look, the host is inert (bklit chart phase "loading"). */
  readonly status?: ChartStatus;
  /** Centered shimmer label while loading. */
  readonly loadingLabel?: string;
  /** Animate the y domain on the loading -> ready transition. Default: true. */
  readonly yDomainTween?: boolean;
  /** Per-axis y-domain overrides (`YDomainOverride`). */
  readonly yDomains?: Readonly<Record<string, YDomainOverride>>;
  /** bklit `yDomainTweenDuration` (ms): the y-domain glide of a data update or a brushed window. Default: 500. */
  readonly yDomainTweenDuration?: number;
  /** bklit `yScaleDomainMax`: a fixed y top on a single-axis chart. */
  readonly yScaleDomainMax?: number;
  /** The entrance easing (CSS). */
  readonly animationEasing?: string;
  /** The entrance as a motion transition: its duration (s) and ease override `animationDuration` / `animationEasing`. */
  readonly enterTransition?: EnterTransition;
}

export interface CartesianControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface CartesianController extends ChartController<CartesianProps, CartesianView, ChartContext> {
  /** Never null: before the first draw it holds the empty plot. */
  readonly context: Readable<ChartContext>;
  /** The plot the latest draw published: the leaves that draw from the size (sweep overlays, brush panes) subscribe. */
  readonly plot: PlotStore;
  /** The focused row: the custom children's leaf subscribes (`context` reads it). */
  readonly focus: FocusStore<CartesianFocus>;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<CartesianProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
  /** Opens the ready gate; "adapter": called from the adapter's reveal trigger (its two passive commits), as `mounted` does for "self". */
  readonly arm: () => void;
}

const NONE: never[] = [];
const WIPE_IN_ATTR = "data-bkm-wipe-in";
const FILL_HEIGHT: StyleObject = { height: "100%" };
const BRUSH_LABEL = "Range selector (drag to select a range)";

/** The event markers of the ChartMarkers / MarkerGroup children (the delegated click handler reads the latest). */
type MarkerLists = readonly (readonly ChartMarker[])[];

/** Everything one pass derives from the input and the controller's state (what React's render computed). */
interface Pass {
  readonly animationDuration: number;
  readonly phase: LoadingPhase;
  readonly table: ChildTable;
  readonly series: readonly ResolvedSeries[];
  readonly hasMarkers: boolean;
  readonly markerLists: MarkerLists;
  readonly pulseCycle: (() => void) | undefined;
  readonly sweep: boolean;
  readonly data: readonly Row[];
  readonly rowIndex: ReadonlyMap<Row, number>;
  readonly times: readonly number[];
  readonly margin: ChartMargin;
  readonly hasBrush: boolean;
  readonly brushVars: BrushVars | undefined;
  readonly step: UpdateSequence;
  readonly yDomainTween: boolean;
  readonly xDataKey: string;
  readonly xDomain: [Date, Date] | undefined;
  readonly xDomainSlotCount: number | undefined;
  readonly options: ReturnType<typeof surfaceOptions>;
  readonly view: CartesianView;
}

/** bklit `clipRevealTransition`: the entrance length and easing. A tween `enterTransition` gives both (its `ease` a cubic-bezier array or a CSS easing); any other gives its
 * `duration` alone; `animationEasing` is the CSS easing otherwise. `ease` is undefined for bklit's default curve. */
function enterOf(transition: EnterTransition | undefined, easing: string | undefined, durationMs: number): { readonly ms: number; readonly ease: string | undefined } {
  const ms = typeof transition?.duration === "number" ? transition.duration * 1000 : durationMs;
  const given = transition === undefined || transition.type === "tween" || transition.type === undefined ? transition?.ease : undefined;
  let ease = easing;
  if (Array.isArray(given) && given.length === 4 && given.every((n) => typeof n === "number")) {
    ease = `cubic-bezier(${given.join(",")})`;
  } else if (typeof given === "string") {
    ease = MOTION_EASES[given] ?? given;
  }
  return { ms, ease };
}

/** motion's named easings as CSS (a CSS name passes through). */
const MOTION_EASES: Readonly<Record<string, string>> = { linear: "linear", easeIn: "cubic-bezier(0.42,0,1,1)", easeOut: "cubic-bezier(0,0,0.58,1)", easeInOut: "cubic-bezier(0.42,0,0.58,1)", circIn: "cubic-bezier(0,0.65,0.55,1)", circOut: "cubic-bezier(0.55,0,1,0.45)", circInOut: "cubic-bezier(0.85,0,0.15,1)", backIn: "cubic-bezier(0.31,0.01,0.66,-0.59)", backOut: "cubic-bezier(0.33,1.53,0.69,0.99)", backInOut: "cubic-bezier(0.68,-0.6,0.32,1.6)" };

export function createCartesianController(env: ChartEnv, initial: ChartInput<CartesianProps>, options: CartesianControllerOptions = {}): CartesianController {
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  // The public context's `containerRef` (the host while attached).
  const containerRef: ContainerRef = { current: null };
  const plot = createPlotStore();
  const focus = createFocusStore<CartesianFocus>();
  const tooltip = tooltipTargetStore();
  // The hover indicator (crosshair, dots, date pill) is an element we own, appended to the host and moved imperatively (hover-overlay.ts).
  const overlay = new HoverOverlay();
  // The ChartCrosshair child's view (crosshair.ts), once the chart has one.
  const crosshair = createCrosshairSlot();
  // Focus lives on the host, not in framework state or a regenerated <style> (host-sync.ts).
  const hostSync = createHoverHostSync(() => host);
  const gate = createReadyGate(() => host);
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let pass: Pass | undefined;
  // Whether the latest build's y domains move enough to tween (assigned from each draw; read when a tween phase starts).
  let yTween = false;
  // Latest plot geometry for the drag listeners (assigned by each draw).
  let dragGeom: DragGeom = { left: 0, top: 0, innerWidth: 0, innerHeight: 0 };
  // bklit's drag selection (use-chart-interaction, interaction/drag-select.ts): raw plot-space pixels, not snapped to data.
  let selection: { startX: number; endX: number } | null = null;
  let changedFromInside: () => void = () => undefined;
  const loading = createLoadingPhase(initial.props.status ?? "ready", () => host, () => { changedFromInside(); });
  const drag = createDragSelect({
    geom: () => dragGeom,
    host: { drag: hostSync.drag, press: hostSync.press },
    onSelect: (edges) => {
      if (selection?.startX === edges?.startX && selection?.endX === edges?.endX) {
        return;
      }
      selection = edges;
      bump(contextVersion);
    },
  });
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(() => drag.interaction.current);
  const brush = createBrush(plot.get, () => { changedFromInside(); }, (range, phase) => { link.brushed(range, phase); });
  // syncId / syncY / ChartZoom / activeIndex (link.ts): what this chart shares with the others of its group, and its controlled focus.
  const link = createCartesianLink({
    host: () => host,
    surface: () => surfaceEl,
    plot: plot.get,
    margin: () => current().margin,
    input: () => {
      const { table, data, times, series } = current();
      return { props: latestInput.props, table, data, times, series };
    },
    showCursor: (time, row) => {
      hostSync.sync(time);
      overlay.focus(time, row);
    },
    changed: () => { changedFromInside(); },
  });
  let dataStep: DataUpdateStep | undefined;
  let wipeIn: boolean | undefined;

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's useMemo did) -------------------------
  const seriesCell = memoCell<ResolvedSeries[]>();
  const timesCell = memoCell<number[]>();
  const dataCell = memoCell<readonly Row[]>();
  const rowIndexCell = memoCell<ReadonlyMap<Row, number>>();
  const marginCell = memoCell<ChartMargin>();
  const wipeCell = memoCell<{ ms: number; progress: (size: { readonly innerWidth: number }) => number }>();
  const specCell = memoCell<Parameters<typeof buildCartesianDefinition>[0]>();
  const definitionCell = memoCell<ReturnType<typeof buildCartesianDefinition>>();
  const rendererCell = memoCell<ReturnType<typeof motion>>();
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const attrsCell = memoCell<CartesianView["hostAttrs"]>();
  const hostStyleCell = memoCell<StyleObject>();
  const loadingStyleCell = memoCell<StyleObject | undefined>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const resourcesCell = memoCell<CartesianView["resources"]>();
  const labelCell = memoCell<CartesianView["loadingLabel"]>();
  const sweepCell = memoCell<CartesianView["sweep"]>();
  const panesCell = memoCell<CartesianView["brushPanes"]>();
  const tooltipBaseCell = memoCell<CartesianView["tooltipBase"]>();
  const viewCell = memoCell<CartesianView>();

  const derive = ({ props, table }: ChartInput<CartesianProps>): Pass => {
    const { data: targetData, xDataKey = "date", margin, aspectRatio = "2 / 1", style, status = "ready" } = props;
    const enter = enterOf(props.enterTransition, props.animationEasing, props.animationDuration ?? DEFAULT_ANIMATION_MS);
    const animationDuration = env.staticPreview ? 0 : enter.ms;
    // A status change adjusts the phase in this pass, so no stale phase is drawn.
    const phase = loading.update(status);
    // chartLoading drives the loading chrome (pulse, shimmer, label); swap / tween / concealing hold the series concealed.
    const { chartLoading, skeletonRows, gridLoading } = loadingFlags(phase);
    const fillHeight = style?.aspectRatio === "unset";
    const hasMarkers = table.has("chartMarkers") || table.has("markerGroup");
    const series = seriesCell([table, chartLoading], () => resolveSeries(table, chartLoading));
    // Loop-pulse cycles end as CSS iteration events bubbling to the host; only the animation name is read (bklit line.tsx onLoadingPulseCycleComplete).
    const pulseCycle = propsFor<{ onLoadingPulseCycleComplete?: () => void }>(table, "line").find((l) => l.onLoadingPulseCycleComplete)?.onLoadingPulseCycleComplete;
    const times = timesCell([targetData, xDataKey], () => targetData.map((row) => toDate(row[xDataKey]).getTime()));
    // The reader's xDomain, else the window a brush or a zoom of the group shows (link.ts).
    const linked = link.model({ props, table, data: targetData, times, series });
    const { xDomain } = linked;
    const xDomainSlotCount = props.xDomainSlotCount ?? (linked.windowed ? targetData.length : undefined);
    // bklit time-series-chart-shell.tsx:228-234: while loading the first series is replaced by skeleton rows (the others keep their data, so the y domain spans them all).
    const skeletonKey = series.find((s) => s.kind !== "pattern")?.dataKey;
    const data = dataCell([skeletonRows, targetData, skeletonKey], () => {
      if (!skeletonRows) {
        return targetData;
      }
      return targetData.length === 0 ? generateChartSkeletonData({ dataKey: skeletonKey }) : generateChartSkeletonFromTarget(targetData, skeletonKey ?? "value");
    });
    const rowIndex = rowIndexCell([data], () => new Map(data.map((row, i) => [row, i] as const)));
    const loadingGrid = chartLoading ? propsFor<LoadingGrid>(table, "grid")[0] : undefined;
    // First-mount entrance (status "ready"): the wipe groups play the CSS `bkm-wipe-*` keyframes from the first draw (styles.css); a later loading -> ready reveal is the native `wipe-` tween.
    wipeIn ??= status !== "loading" && animationDuration > 0;
    const { brushProps, brush: brushInput, brushCollapsed, shownRange } = brush.model(table, data, xDataKey);
    const resolvedMargin = marginCell([JSON.stringify(margin ?? null)], () => ({ ...DEFAULT_MARGIN, ...margin }));
    const { p: wipeP, ms: wipeMs, conceal: wipeConceal } = loadingWipe(phase, 1, animationDuration);
    // The conceal window runs past the plot by the left margin its fixed clip carries (wipe.ts), so the last data is gone at the end; it depends on the plot, so the draw resolves it.
    const wipe = wipeCell([wipeMs, wipeP, wipeConceal, resolvedMargin.left], () => ({ ms: wipeMs, progress: (size: { readonly innerWidth: number }): number => (wipeConceal ? 2 + resolvedMargin.left / Math.max(1, size.innerWidth) : wipeP) }));
    const yDomainOverrides = props.yDomains;
    const deps = [xDataKey, table, series, resolvedMargin, uid, animationDuration, brushInput, yDomainOverrides];
    dataStep ??= createDataUpdateStep(data, deps, xDomain);
    // Adjusted in this pass, so its build already draws the new step.
    const step = dataStep.update(data, deps, xDomain);
    const hasBrush = brushProps !== undefined;
    const brushVars = brushInput ? { shownStart: shownRange.start.getTime(), shownEnd: shownRange.end.getTime(), blurPx: brushProps?.blurPx } : undefined;
    const spec = specCell(
      [data, xDataKey, table, series, resolvedMargin, xDomain, gridLoading, animationDuration, brushInput, step.step, step.from, wipe, linked.zoom, linked.extraYValues, linked.fadeDomain, yDomainOverrides, props.yScaleDomainMax, props.yDomainTweenDuration, enter.ease],
      () => ({
        // A settled zoom redraws at once: its preview already moved the paths there (zoom.ts).
        updateStep: linked.zoom && step.step === "window" ? "snap" : step.step,
        yDomainFrom: step.from,
        yDomainOverrides,
        data,
        xKey: xDataKey,
        table,
        series,
        margin: resolvedMargin,
        xDomain,
        uid,
        chartLoading: gridLoading,
        animationDuration,
        extraMarks: NONE,
        extraXValues: NONE,
        extraYValues: linked.extraYValues,
        fadeDomain: linked.fadeDomain,
        extraGradients: NONE,
        renderTooltipEnabled: true,
        brush: brushInput,
        wipe,
        yScaleDomainMax: props.yScaleDomainMax,
        yGlideMs: props.yDomainTweenDuration,
        revealEasing: enter.ease === undefined ? undefined : parseEasing(enter.ease),
      }),
    );
    const definition = definitionCell([spec], () => buildCartesianDefinition(spec, publish));
    // `initial: "always"` replays the entrance on hydrated (server-rendered) SVG too.
    const renderer = rendererCell([animationDuration], () => motion(erase({ initial: "always", transition: { type: "tween", duration: animationDuration } })));
    const ariaLabel = props.ariaLabel ?? (brushInput ? BRUSH_LABEL : props.defaultAriaLabel);
    const chartAspect = fillHeight ? undefined : parseAspectRatio(aspectRatio);
    // The brush strip is pointer-only (TanStack's brush keyboard needs discrete values, which would snap the pointer range).
    const tabIndex = brushInput ? -1 : undefined;
    const surface = optionsCell([definition, renderer, chartAspect, ariaLabel, props.ariaDescription, tabIndex, targetData, table, chartLoading], () => {
      const kind = series.some((s) => s.kind !== "line") ? "Area chart" : "Line chart";
      const a11y = { describe: () => describeCartesian({ kind, data: targetData, xDataKey, table, loading: chartLoading }), dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0] };
      return surfaceOptions(erase({ definition: erase(definition), renderer, aspectRatio: chartAspect, ariaLabel, ariaDescription: props.ariaDescription, tabIndex, onFocusChange, onRender: erase(onRender), onTooltipBodyChange: tooltip.onChange, a11y }), uid);
    });
    const hostAttrs = attrsCell([wipeIn, table, gridLoading, xDomain === undefined, chartLoading, loadingGrid, hasMarkers, brushInput !== undefined && brushCollapsed, linked.zoom], () => ({
      "data-bkm-kit": uid,
      [WIPE_IN_ATTR]: wipeIn ? "" : undefined,
      ...gridAttrsOf(table, gridLoading),
      "data-bkm-clip": xDomain === undefined ? undefined : "",
      ...(chartLoading ? loadingHostAttrs(loadingGrid) : null),
      "data-bkm-evt": hasMarkers ? "" : undefined,
      "data-bkm-brushreset": brushInput && brushCollapsed ? "" : undefined,
      "data-bkm-zoom": linked.zoom ? "" : undefined,
    }));
    const hostStyle = hostStyleCell([animationDuration, resolvedMargin, xDomain !== undefined, enter.ease], () => cartesianHostStyle({ animationDuration, margin: resolvedMargin, clipped: xDomain !== undefined, enterEase: enter.ease }));
    const hostLoadingStyle = loadingStyleCell([phase === "ready", loadingGrid], () => (phase === "ready" ? undefined : loadingHostStyle(loadingGrid)));
    const surfaceStyle = surfaceStyleCell([chartAspect, fillHeight], () => surfaceHostStyle(surfaceBox({ aspectRatio: chartAspect }), fillHeight ? FILL_HEIGHT : undefined));
    const highlight = hasHighlight(series);
    const resources = resourcesCell([table, highlight, series], () => [backgroundResourcesFor(table, uid), overlayResourcesFor(table, uid), highlight ? highlightBandClip(`${uid}-hlband`, seriesHighlightBands(series)) : null, rangeResourcesFor(table, uid)]);
    const labelShown = !(phase === "ready" || phase === "concealing" || phase === "tweenLoading");
    const loadingLabel = labelCell([labelShown, props.loadingLabel, phase !== "loading"], () => (labelShown ? { text: props.loadingLabel ?? "", exiting: phase !== "loading" } : null));
    const sweepOverlays = sweepCell([chartLoading, series, phase === "exiting", resolvedMargin], () => (chartLoading ? { series, exiting: phase === "exiting", margin: resolvedMargin } : null));
    const panes = panesCell([brushInput !== undefined, brushProps?.fadeOuterEdges !== false], () => (brushInput ? brushPanes(brushProps?.fadeOuterEdges !== false) : null));
    const tooltipBase = tooltipBaseCell([series, table], () => withRangeRows(tooltipBaseOf(series), table));
    const view = viewCell(
      [phase, hostAttrs, hostStyle, hostLoadingStyle, surfaceStyle, resources, loadingLabel, sweepOverlays, panes, table, data, tooltipBase, surface],
      () => ({ phase, hostAttrs, hostStyle, hostLoadingStyle, surfaceStyle, resources, loadingLabel, sweep: sweepOverlays, brushPanes: panes, table, data, tooltipBase, surface }),
    );
    return {
      animationDuration,
      phase,
      table,
      series,
      hasMarkers,
      markerLists: hasMarkers ? markerListsFor(table) : NONE,
      pulseCycle,
      sweep: series.some((s) => s.loading?.style === "sweep"),
      data,
      rowIndex,
      times,
      margin: resolvedMargin,
      hasBrush,
      brushVars,
      step,
      yDomainTween: props.yDomainTween !== false,
      xDataKey,
      xDomain,
      xDomainSlotCount,
      options: surface,
      view,
    };
  };

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- What a draw hands back: static css, host vars and the lazy geometry hover and drag read (the latest pass's inputs) ------------
  const writeHost = (snapshot: PlotSnapshot): void => {
    const sheet = ownedStyle;
    if (!host || !sheet) { return; }
    const { series, hasBrush, margin, brushVars } = current();
    const css = cartesianStaticCss(uid, snapshot.built, hasBrush, series);
    if (sheet.textContent !== css) { sheet.textContent = css; }
    writeSizeVars(host, snapshot, margin, brushVars);
  };
  function publish(snapshot: PlotSnapshot): void {
    const { built, size } = snapshot;
    const { margin } = current();
    plot.set(snapshot);
    overlay.update(built.overlay, overlayPlotOf(snapshot), margin, built.pillTicks.active ? pillFadeHalf(built.pillTicks.reachPx) : null);
    crosshair.update(current().table, { margin, innerWidth: size.innerWidth, innerHeight: Math.max(0, size.innerHeight), yDomains: built.domains.y });
    yTween = yDomainsTween(built.domains.y, built.targetY);
    const xStart = built.domains.x[0].getTime();
    hostSync.geom.current = { times: built.hover.times, left: margin.left, xStart, xSpan: built.domains.x[1].getTime() - xStart, innerWidth: size.innerWidth, signs: built.hover.plSigns, hasBand: built.hover.highlights.length > 0 || built.hover.segmentLeft !== null, spans: built.hover.spans, pillTicks: built.pillTicks.active ? built.pillTicks.times : undefined };
    dragGeom = { left: margin.left, top: margin.top, innerWidth: size.innerWidth, innerHeight: Math.max(0, size.innerHeight) };
    writeHost(snapshot);
    link.drawn(snapshot);
  }
  function onFocusChange(point: { xValue: unknown; datum: unknown; datumIndex: number } | null): void {
    hold(erase(point));
    const time = point ? toDate(point.xValue).getTime() : null;
    // SAFETY: every datum of this chart is a Row of its data prop.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
    const row = point ? (point.datum as Row) : undefined;
    // A decimated chart's datumIndex counts the drawn rows; the context indexes `data`.
    const index = point && row ? (current().rowIndex.get(row) ?? point.datumIndex) : null;
    focus.set(point && row && time !== null && index !== null ? { row, index, time } : null);
    hostSync.sync(time);
    overlay.focus(time, row ?? null);
    link.focused(time, index);
    const snapshot = plot.get();
    if (snapshot) {
      const x0 = snapshot.built.domains.x[0].getTime();
      const span = snapshot.built.domains.x[1].getTime() - x0;
      crosshair.snap(time === null || span <= 0 ? null : ((time - x0) / span) * snapshot.size.innerWidth);
    }
  }
  // Reported after each draw: the data-update step ends its snap / glide from the domains the draw built.
  function onRender(context: ChartRendererRenderContext<never, never, never>): void {
    drag.onRender(context);
    link.rendered(context);
    // The render re-created the x tick labels or stripped their inline style: the pill tick fade's inputs go back on (date-pill.ts `writeTickVar`).
    refreshTickVars(host);
    const snapshot = plot.get();
    if (snapshot && dataStep?.settle(snapshot.built satisfies CartesianBuild, current().step.step)) {
      changedFromInside();
    }
  }

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  let ownedStyle: HTMLStyleElement | null = null;
  let markersOff: (() => void) | undefined;
  let listenersOff: (() => void) | undefined;
  let written: readonly unknown[] = [];
  let syncing = false;
  const sameKeys = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const installMarkerListeners = (): void => {
    const el = host;
    markersOff?.();
    markersOff = el && current().hasMarkers ? installMarkers(el, () => current().markerLists) : undefined;
  };
  /** A commit's layout half: the renderer gets the latest options (RendererChart.js's layout effect), the brush reports, the host re-writes. */
  const layout = (): void => {
    brush.report();
    const el = surfaceEl;
    if (!el || !host) {
      return;
    }
    const { options: opts, hasMarkers, margin, brushVars, hasBrush } = current();
    syncing = true;
    try {
      surfaceOf().render(el, opts);
    } finally {
      syncing = false;
    }
    link.applied();
    if ((markersOff !== undefined) !== hasMarkers) { installMarkerListeners(); }
    // A brush gesture moves the shown range without a draw.
    const keys = [margin, brushVars?.shownStart, brushVars?.shownEnd, brushVars?.blurPx, hasBrush];
    if (!sameKeys(keys, written)) {
      written = keys;
      const snapshot = plot.get();
      if (snapshot) { writeHost(snapshot); }
    }
  };
  // The keys the passive work last ran for (React effects' deps); reset by `detach`, so a re-attach runs it again.
  let entered: string | undefined;
  let cancelEnter: (() => void) | undefined;
  let gateDuration: number | undefined;
  let revealedPhase: LoadingPhase | undefined;
  let wipePhase: LoadingPhase | undefined;
  const gateRun = (): ReadyGateRun => ({ duration: current().animationDuration });
  const arm = (): void => { gate.arm(gateRun()); };
  /** A commit's passive half, in the order React ran these effects, for the pass that commit drew (default: the latest). */
  const committed = (of: Pass = current()): void => {
    const { phase, animationDuration, yDomainTween, sweep } = of;
    const key = `${phase}|${yDomainTween}|${animationDuration}`;
    if (key !== entered) {
      cancelEnter?.();
      entered = key;
      cancelEnter = loading.enter(phase, { sweep, yTweens: yDomainTween && yTween, animationDuration });
    }
    if (animationDuration !== gateDuration) {
      gateDuration = animationDuration;
      gate.restart(gateRun());
    }
    if (phase !== revealedPhase) {
      revealedPhase = phase;
      // bklit isLoaded (use-chart-phase-orchestrator.ts:164-169): the ready gate re-arms once the chart reaches ready from a concealed phase.
      if (loading.revealed(phase)) { arm(); }
    }
    if (phase !== wipePhase) {
      wipePhase = phase;
      if (phase !== "ready") { clearAttribute(host, WIPE_IN_ATTR); }
    }
  };
  let cancelPassive: (() => void) | undefined;
  /** The pass the pending passive work is for (the one the last layout drew). */
  let passivePass: Pass | undefined;
  let microtask = false;
  const schedulePassive = (): void => {
    cancelPassive?.();
    const of = current();
    passivePass = of;
    cancelPassive = afterPaint(() => {
      cancelPassive = undefined;
      passivePass = undefined;
      committed(of);
    });
  };
  /** "self", every port's: the pending passive work, now, before the next layout (the start of `update`, the change-from-inside
   * microtask), as React flushes a commit's pending passive effects before it renders the next one. A phase entered after a draw then
   * reads what that draw published (a tween's y domains move, `yTween`) and the pass it drew, before a settle's redraw in the same frame
   * (a data snap ending in the glide, whose domains no longer move) replaces them: a loading -> ready reveal keeps its y tween. Nothing
   * runs before the first `attach` (no commit yet: the pending work is dropped). React ("adapter") calls `committed` itself and never
   * reaches this. */
  const flushPassive = (): void => {
    const of = passivePass;
    if (cancelPassive === undefined || of === undefined) {
      return;
    }
    cancelPassive();
    cancelPassive = undefined;
    passivePass = undefined;
    if (host !== null) { committed(of); }
  };
  changedFromInside = (): void => {
    const before = pass?.view;
    pass = derive(latestInput);
    if (pass.view !== before) { bump(viewVersion); }
    bump(contextVersion);
    if (!selfDriven || microtask) {
      return;
    }
    // Never inside the renderer's own callbacks (a draw's settle, a brush gesture): the next microtask, as a port's own flush would.
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      flushPassive();
      if (!syncing) { layout(); }
      schedulePassive();
    });
  };

  // --- Host listeners -----------------------------------------------------------------------------------------------------------
  const onAnimationEvent = (event: AnimationEvent): void => { loading.onAnimationEvent(event); };
  const onAnimationIteration = (event: AnimationEvent): void => {
    loading.onAnimationEvent(event);
    if (event.animationName === "bkm-loading-pulse") { current().pulseCycle?.(); }
  };
  const onWipeEnd = (event: AnimationEvent): void => {
    if (event.animationName === "bkm-wipe-o") { clearAttribute(host, WIPE_IN_ATTR); }
  };
  const listen = (el: HTMLElement): (() => void) => {
    el.addEventListener("animationstart", onAnimationEvent);
    el.addEventListener("animationend", onWipeEnd);
    el.addEventListener("animationiteration", onAnimationIteration);
    installMarkerListeners();
    // A ChartZoom's drag pans (zoom.ts) and a pinnable tooltip's click pins: bklit's drag selection (which swallows the click) stands aside.
    const { table } = current();
    const dragOff = table.has("zoom") || propsFor<{ pinnable?: boolean }>(table, "tooltip")[0]?.pinnable === true ? (): void => undefined : drag.attach(el);
    const linkOff = link.attach(el);
    const holdOff = hold.attach(el);
    const legend = env.legendHover;
    const legendOff = legend ? legend.subscribe(() => { writeLegendHover(el, legend.get()); }) : undefined;
    if (legend) { writeLegendHover(el, legend.get()); }
    return (): void => {
      el.removeEventListener("animationstart", onAnimationEvent);
      el.removeEventListener("animationend", onWipeEnd);
      el.removeEventListener("animationiteration", onAnimationIteration);
      markersOff?.();
      markersOff = undefined;
      dragOff();
      linkOff();
      holdOff();
      legendOff?.();
    };
  };

  // The custom children's context: built when read, from the plot, the ready gate, the focus and the latest pass; a field keeps its object while its content holds.
  const buildContext = createCartesianContext();
  const context: Readable<ChartContext> = {
    get: () => {
      const { series, data, xDataKey, table, margin, animationDuration, xDomain, xDomainSlotCount, times } = current();
      return buildContext({
        snapshot: plot.get(),
        isLoaded: gate.store.get(),
        focused: focus.get(),
        series,
        data,
        xDataKey,
        table,
        containerRef,
        dragInteraction: drag.interaction,
        resolvedMargin: margin,
        animationDuration,
        xDomain,
        xDomainSlotCount,
        selection,
        times,
        clearSelection: drag.clear,
      });
    },
    subscribe: (listener) => {
      const offs = [plot.subscribe(listener), gate.store.subscribe(listener), focus.subscribe(listener), contextVersion.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };

  let cancelArm: (() => void) | undefined;
  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context,
    plot,
    focus,
    arm,
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      if (selfDriven) { flushPassive(); }
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
      dom.host.insertBefore(ownedStyle, before.parentNode === dom.host ? before : null);
      // A group member that registered its y extent after this pass was derived (small multiples render together, then mount).
      if (link.stale()) {
        pass = derive(latestInput);
        bump(viewVersion);
      }
      // Mount: TanStack's draw runs `chart()`, which publishes the plot.
      syncing = true;
      try {
        surfaceOf().render(dom.surface, current().options);
      } finally {
        syncing = false;
      }
      link.applied();
      dom.host.append(overlay.root);
      crosshair.attach(dom.host);
      const snapshot = plot.get();
      if (snapshot) { writeHost(snapshot); }
      const { margin, brushVars, hasBrush } = current();
      written = [margin, brushVars?.shownStart, brushVars?.shownEnd, brushVars?.blurPx, hasBrush];
      listenersOff = listen(dom.host);
      if (selfDriven) { schedulePassive(); }
    },
    mounted() {
      cancelArm?.();
      cancelArm = armReveal(() => host, arm);
    },
    detach() {
      cancelArm?.();
      cancelArm = undefined;
      cancelPassive?.();
      cancelPassive = undefined;
      passivePass = undefined;
      cancelEnter?.();
      cancelEnter = undefined;
      listenersOff?.();
      listenersOff = undefined;
      overlay.root.remove();
      crosshair.detach();
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      gate.dispose();
      entered = undefined;
      gateDuration = undefined;
      revealedPhase = undefined;
      wipePhase = undefined;
      written = [];
      host = null;
      surfaceEl = null;
      containerRef.current = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
