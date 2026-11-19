import { motion } from "@tanstack/charts/motion";
import type { ChartPoint } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { focusEmptyHiddenCss } from "../cartesian/gate-css";
import { HoverOverlay } from "../cartesian/hover-overlay";
import type { OverlayPlot } from "../cartesian/hover-overlay";
import { erase } from "../erased-types";
import { writeLegendHover } from "../hover/host-sync";
import { clearAttribute, raiseAttribute, writeAttribute, writeFocusHost } from "../host-write";
import { loadingHostAttrs, loadingHostVars } from "../cartesian/loading";
import type { LoadingGrid } from "../cartesian/loading";
import { INTERACTIVE_ATTR } from "../entrance/ready-gate";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { loadingLabelBox } from "../loading/label-box";
import { attachPressGuard, createInteractionHandle } from "../interaction/touch-focus";
import { memoCell } from "../memo";
import { measureNoText } from "../polar/measure-no-text";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import type { StyleObject } from "../style";
import { createChartSurface, surfaceBox, surfaceHostStyle, surfaceOptions } from "../surface/surface";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import { bklitSurfaceStyle } from "../theme";
import type { ChartMargin } from "../theme";
import type { TooltipRow } from "../types/tooltip";
import { createPlotSizeStore } from "./definition";
import { concealMarks, dropChartSvg, holdSkeleton, loadingDefinition, loadingMotion, skeletonCss } from "./loading";
import type { PlotBuild, PlotDatum, PlotFamily, PlotSize, PlotTooltip } from "./types";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { loadingDescription } from "../a11y/describe";

/** What a plot chart's adapter renders (`view`): the host's attributes and style, the surface box, and the tooltip body's model. */
export interface PlotView {
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`. */
  readonly hostStyle: StyleObject;
  /** TanStack's `.ts-chart-host` box around the surface. */
  readonly surfaceStyle: StyleObject;
  /** The carriers: the tooltip leaf reads `ChartTooltip`'s `content`, `className` and children from it. */
  readonly table: ChildTable;
  /** The default body's model for a hovered target's points (null: none). */
  readonly tooltip: (points: readonly unknown[]) => PlotTooltip | null;
  /** The loading label (`ChartLoadingLabel`'s look) in its box over the plot, while `status="loading"` with a `loadingLabel` (null: none). */
  readonly loadingLabel: { readonly text: string; readonly boxStyle: StyleObject } | null;
}

export type PlotController<Props> = ChartController<Props, PlotView>;

/** The loading props every plot chart takes (core/types/plot-loading.ts). */
interface LoadingInput {
  readonly status?: string;
  readonly loadingLabel?: string;
  readonly animate?: boolean;
}

const loadingOf = (props: object): boolean => (props as LoadingInput).status === "loading";

/** `ChartTooltip`'s `rows` as the table holds it. */
interface TooltipRowsCarrier {
  readonly rows?: (point: PlotDatum) => readonly TooltipRow[];
}

/** The props a chart's adapter keeps to itself: they never reach the builder (a new `children` every render would rebuild it). */
const ADAPTER_PROPS = /* @__PURE__ */ new Set(["children", "className", "class", "style", "revealSignature"]);

/** Whether two props objects hold the same values (the adapter-only props aside). */
const sameProps = (a: object, b: object): boolean => {
  const ea = Object.entries(a).filter(([key]) => !ADAPTER_PROPS.has(key));
  const rb: Record<string, unknown> = { ...b };
  return ea.length === Object.keys(b).filter((key) => !ADAPTER_PROPS.has(key)).length && ea.every(([key, value]) => Object.is(value, rb[key]));
};

/** The overlay's plot at a measured size: category charts place by `xOf` and the dots' `at`, so the domains are nominal. */
const overlayPlot = (size: PlotSize, margin: ChartMargin): OverlayPlot => ({
  height: size.height,
  innerWidth: Math.max(0, size.width - margin.left - margin.right),
  innerHeight: Math.max(0, size.height - margin.top - margin.bottom),
  xDomain: [0, 1],
  yDomains: {},
});

const tooltipOf = (build: PlotBuild, table: ChildTable) => (points: readonly unknown[]): PlotTooltip | null => {
  // SAFETY: the renderer reports ChartPoints of this definition.
  const [first] = points as readonly ChartPoint[];
  if (first === undefined) {
    return null;
  }
  const item = build.items[build.itemOf(first.datum)];
  if (item === undefined) {
    return null;
  }
  const carrier = propsFor<TooltipRowsCarrier>(table, "tooltip").at(0);
  return { title: item.title, rows: carrier?.rows ? carrier.rows(item.datum) : item.rows, point: item.datum, index: item.index };
};

export function createPlotController<Props extends object>(env: ChartEnv, initial: ChartInput<Props>, family: PlotFamily<Props>): PlotController<Props> {
  const { uid } = env;
  const scope = `[data-bkm-kit="${uid}"]`;
  const size = createPlotSizeStore();
  // Two targets in one element show the same body when their first points are the same item (a bump series' dots, a Gantt row's
  // length): the leaf keeps its body, so moving along an item renders nothing.
  const itemAt = (target: { readonly points: readonly { readonly datum: unknown }[] }): number => {
    const [first] = target.points;
    return first === undefined || build === undefined ? -1 : build.itemOf(first.datum);
  };
  const tooltip = tooltipTargetStore((a, b) => a.element === b.element && a.pinned === b.pinned && itemAt(a) >= 0 && itemAt(a) === itemAt(b));
  const overlay = new HoverOverlay();
  const handle = createInteractionHandle();
  const hold = createKeyboardFocusHold(() => handle.interaction.current);
  // One renderer per chart: `initial: "always"` replays the entrance on hydrated (server-rendered) SVG too.
  const renderer = motion(erase({ initial: "always" }));
  const baseCss = focusEmptyHiddenCss(scope);
  const viewVersion = writable(0);
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  let latest = initial;
  let builtFrom: { readonly props: Props; readonly table: ChildTable } | undefined;
  let build: PlotBuild | undefined;
  let focused = -1;

  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const hostStyleCell = memoCell<StyleObject>();
  const hostAttrsCell = memoCell<PlotView["hostAttrs"]>();
  const viewCell = memoCell<PlotView>();
  const loadingDefinitionCell = memoCell<object>();
  const labelCell = memoCell<PlotView["loadingLabel"]>();

  const buildOf = ({ props, table }: ChartInput<Props>): PlotBuild => {
    if (build === undefined || builtFrom === undefined || builtFrom.table !== table || !sameProps(builtFrom.props, props)) {
      build = family.build({ props, table, uid, scope, size });
      builtFrom = { props, table };
    }
    return build;
  };
  /** The definition the renderer draws: the family's, or while loading its frame around the skeleton. */
  const definitionOf = (b: PlotBuild, loading: boolean): object => {
    const { skeleton } = b;
    return loading && skeleton !== undefined ? loadingDefinitionCell([b.definition, skeleton], () => loadingDefinition(b.definition, skeleton)) : b.definition;
  };
  const options = (b: PlotBuild, loading = loadingOf(latest.props)) =>
    optionsCell([definitionOf(b, loading), b.box, b.ariaLabel, b.ariaDescription, b.describe, loading, latest.table], () =>
      surfaceOptions(
        erase({
          a11y: { describe: loading ? () => loadingDescription(b.ariaLabel) : b.describe, dataTable: propsFor<ChartDataTableProps>(latest.table, DATA_TABLE_ROLE)[0] },
          definition: definitionOf(b, loading),
          renderer,
          aspectRatio: b.box.height === undefined ? b.box.aspectRatio : undefined,
          height: b.box.height,
          ariaLabel: b.ariaLabel,
          ariaDescription: b.ariaDescription,
          onFocusChange,
          // Fixed margins and no label thinning: layout never reads text metrics, and no font load re-renders mid-entrance.
          measureText: measureNoText,
          onRender: handle.onRender,
          onTooltipBodyChange: tooltip.onChange,
        }),
        uid,
      ));
  const viewOf = (input: ChartInput<Props>): PlotView => {
    const b = buildOf(input);
    const { box } = b;
    const surfaceStyle = surfaceStyleCell([box], () =>
      surfaceHostStyle(surfaceBox({ aspectRatio: box.aspectRatio, height: box.height }), box.minWidth === undefined ? undefined : { "min-width": `${box.minWidth}px` }));
    const loading = loadingOf(input.props);
    // A `Grid shimmer` sweeps the grid too while loading (the line chart's, styles.css `[data-bkm-loading-shimmer]`).
    const grid = loading ? propsFor<LoadingGrid>(input.table, "grid").at(0) : undefined;
    const hostStyle = hostStyleCell([b.hostStyle, box.minWidth, loading, grid], () => ({
      width: "100%",
      position: "relative",
      ...bklitSurfaceStyle,
      ...(box.minWidth === undefined ? null : { "overflow-x": "auto", "overflow-y": "hidden", "overscroll-behavior-x": "contain" }),
      ...(loading ? loadingHostVars(grid) : null),
      ...b.hostStyle,
    }));
    const hostAttrs = hostAttrsCell([b.hostAttrs, loading, grid], () => ({
      "data-bkm-chart": family.chart,
      "data-bkm-kit": uid,
      ...(loading ? { ...loadingHostAttrs(grid), "aria-busy": "true" } : null),
      ...b.hostAttrs,
    }));
    const text = (input.props as LoadingInput).loadingLabel ?? "";
    const loadingLabel = labelCell([loading, text, b.margin], () => (loading && text.trim() !== "" ? { text, boxStyle: loadingLabelBox(b.margin) } : null));
    return viewCell([hostAttrs, hostStyle, surfaceStyle, input.table, b, loadingLabel], () => ({ hostAttrs, hostStyle, surfaceStyle, table: input.table, tooltip: tooltipOf(b, input.table), loadingLabel }));
  };

  // --- Hover ------------------------------------------------------------------------------------------------------------------------
  function onFocusChange(point: ChartPoint | null): void {
    hold(erase(point));
    const b = build;
    const index = point === null || b === undefined ? -1 : b.itemOf(point.datum);
    const item = index < 0 ? undefined : b?.items[index];
    const el = host;
    if (el) {
      writeFocusHost(el, { focused: item !== undefined, hovered: item !== undefined, liftPress: true });
      if (item === undefined) { clearAttribute(el, "data-bkm-hi"); } else { writeAttribute(el, "data-bkm-hi", String(index)); }
    }
    if (index === focused) {
      return;
    }
    focused = item === undefined ? -1 : index;
    const chrome = b?.chrome;
    if (chrome) {
      overlay.focus(item === undefined ? null : chrome.keyOf(index), item === undefined ? null : erase(item.datum));
    }
  }
  const placeChrome = (): void => {
    const b = build;
    if (!host || !b) {
      return;
    }
    const measured = size.get();
    overlay.update(b.chrome?.model ?? null, overlayPlot(measured, b.margin), b.margin, null);
  };

  // --- The renderer and the host ----------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(options(buildOf(latest)));
    return chart;
  };
  let ownedStyle: HTMLStyleElement | null = null;
  let chromeOf: PlotBuild | undefined;
  /** Whether the latest draw was the skeleton (undefined before the first draw of an attach). */
  let drewLoading: boolean | undefined;
  /** The draw that puts the skeleton up behind a conceal: the skeleton holds back after it renders. */
  let holdNext = false;
  const draw = (): void => {
    const el = surfaceEl;
    if (!el || !host) {
      return;
    }
    const b = buildOf(latest);
    const loading = loadingOf(latest.props) && b.skeleton !== undefined;
    const animate = (latest.props as LoadingInput).animate !== false;
    // The family's CSS stays while loading: its entrance rules key on marks the skeleton doesn't draw, and a copy concealing keeps its paint.
    const css = `${baseCss}${b.css}${loading ? skeletonCss(scope, animate) : ""}`;
    if (ownedStyle && ownedStyle.textContent !== css) { ownedStyle.textContent = css; }
    if (drewLoading !== undefined && loading !== drewLoading) {
      if (loading) {
        // Ready -> loading: drop any hover, then fade the drawn marks out over the skeleton's arrival.
        onFocusChange(null);
        holdNext = loadingMotion(animate) && concealMarks(el);
      } else if (chart) {
        // Loading -> ready: a fresh mount, so the family's entrance plays as on the first.
        chart.destroy();
        dropChartSvg(el);
      }
    }
    drewLoading = loading;
    surfaceOf().render(el, options(b, loading));
    if (holdNext) {
      holdNext = false;
      holdSkeleton(el);
    }
    if (chromeOf !== b) {
      chromeOf = b;
      placeChrome();
    }
  };
  let offs: (() => void)[] = [];

  return {
    view: { get: () => viewOf(latest), subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context: readonly(writable(null)),
    update(input) {
      const before = viewOf(latest);
      latest = input;
      if (viewOf(input) !== before) { viewVersion.set(viewVersion.get() + 1); }
      draw();
    },
    attach(dom) {
      host = dom.host;
      surfaceEl = dom.surface;
      // The owned stylesheet sits before the surface's box, inside the host.
      let before: Node = dom.surface;
      while (before.parentNode !== null && before.parentNode !== dom.host) { before = before.parentNode; }
      ownedStyle = dom.host.ownerDocument.createElement("style");
      dom.host.insertBefore(ownedStyle, before.parentNode === dom.host ? before : null);
      dom.host.append(overlay.root);
      // Hover is live from the first draw (the dims skip nodes mid-entrance, core/plot/css.ts).
      raiseAttribute(dom.host, INTERACTIVE_ATTR);
      raiseAttribute(dom.host, "data-bkm-ready");
      offs = [attachPressGuard(dom.host, () => handle.interaction.current, false), hold.attach(dom.host), size.subscribe(placeChrome)];
      const legend: Readable<{ legend: number | null; profitLoss: number | null }> | undefined = env.legendHover;
      if (legend) {
        const el = dom.host;
        const write = (): void => { writeLegendHover(el, legend.get()); };
        write();
        offs.push(legend.subscribe(write));
      }
      chromeOf = undefined;
      draw();
    },
    mounted: () => undefined,
    detach() {
      for (const off of offs) { off(); }
      offs = [];
      overlay.root.remove();
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      handle.interaction.current = null;
      focused = -1;
      chromeOf = undefined;
      drewLoading = undefined;
      holdNext = false;
      host = null;
      surfaceEl = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
