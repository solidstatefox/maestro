import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import { motion } from "@tanstack/charts/motion";
import type { ChildTable } from "../carriers/table";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { erase } from "../erased-types";
import type { AnyPoint } from "../erased-types";
import { clearAttribute, writeAttribute } from "../host-write";
import { writeLegendHover } from "../hover/host-sync";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus, createInteractionHandle } from "../interaction/touch-focus";
import { loadingLabelBox } from "../loading/label-box";
import { memoCell } from "../memo";
import type { ChartStatus } from "../motion/phase";
import { measureNoText } from "../polar/measure-no-text";
import { readonly, writable } from "../store";
import type { StyleObject } from "../style";
import { createChartSurface, surfaceBox, surfaceHostStyle, surfaceOptions } from "../surface/surface";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import { bklitSurfaceStyle } from "../theme";
import type { ChartMargin } from "../theme";
import type { TooltipRow } from "../types/tooltip";
import { createConceal } from "./conceal";
import { createLive } from "./frame";
import type { DistributionLive } from "./frame";
import { createOverlay } from "./overlay";
import type { DistributionOverlayModel } from "./overlay";
import type { DistributionPhase } from "./skeleton";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import { propsFor } from "../carriers/table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { loadingDescription } from "../a11y/describe";
import type { ChartDescriber } from "../a11y/describe";

/** The tooltip body for a focus: the default panel's title and rows, and what a `content` render prop is called with. */
export interface DistributionTooltipView {
  readonly title: string;
  readonly rows: readonly TooltipRow[];
  /** The hovered item (each family's `…Point`). */
  readonly point: unknown;
  readonly index: number;
}

/** What a family's pass reads. */
export interface DistributionPassInput<Props> {
  readonly props: Props;
  readonly table: ChildTable;
  readonly uid: string;
  /** The plot box the marks write as they draw (the focus reads it). */
  readonly live: DistributionLive;
  /** Loading or ready, and whether the status just changed: the mark reads it (marks.ts `distributionMark`). */
  readonly phase: DistributionPhase;
}

/** What a family's pass derives from its props and carriers. */
export interface DistributionPass {
  /** The native definition (marks, scales, focus and tooltip options). */
  readonly definition: unknown;
  readonly aspectRatio: number;
  /** The plot margins (the loading label's box). */
  readonly margin: ChartMargin;
  readonly ariaLabel: string | undefined;
  readonly ariaDescription: string | undefined;
  /** The chart's data for screen readers (core/a11y/describe.ts): the svg's summary, a `<ChartDataTable>`'s rows. */
  readonly describe?: ChartDescriber;
  /** The owned stylesheet (core/distribution/css.ts). */
  readonly css: string;
  /** The host's `data-hover` for a focused point: the item index the dims key on. */
  readonly hoverIndex: (point: AnyPoint) => number | null;
  /** The tooltip body for the focused points, or undefined to show none. */
  readonly tooltip: (points: readonly AnyPoint[]) => DistributionTooltipView | undefined;
  /** The tooltip carrier's props (an adapter calls its `content`), or null without one. */
  readonly tooltipProps: Readonly<Record<string, unknown>> | null;
  /** The crosshair and dots drawn over the plot while a point is focused (an ECDF's), or null. */
  readonly overlay: DistributionOverlayModel | null;
}

/** The props the engine itself reads, beside a family's (core/types/distribution.ts `DistributionChartProps`). */
export interface DistributionStatusProps {
  readonly status?: ChartStatus;
  readonly loadingLabel?: string;
}

/** A distribution family: its `data-bkm-chart` name, its default accessible name and its pass. */
export interface DistributionFamily<Props> {
  readonly chart: string;
  /** The chart's accessible name when the reader gives none (the renderer needs one). */
  readonly ariaLabel: string;
  /** A pure derivation: the controller calls it again only when a prop (by `Object.is`) or the carrier table changes. */
  readonly pass: (input: DistributionPassInput<Props>) => DistributionPass;
}

/** What a distribution chart's adapter renders. */
export interface DistributionView {
  /** The host's attributes: `data-bkm-chart`, `data-bkm-d` (the owned rules' scope), `data-slot`, `data-bkm-static`, and while loading `data-bkm-status` and `aria-busy`. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's: bklit's tooltip tokens on TanStack's hooks. */
  readonly hostStyle: StyleObject;
  /** The surface's host box (`ts-chart-host`): its aspect ratio. */
  readonly surfaceStyle: StyleObject;
  /** The body for the focused points (the adapter's tooltip leaf renders it, or calls the carrier's `content` with it). */
  readonly tooltip: DistributionPass["tooltip"];
  readonly tooltipProps: DistributionPass["tooltipProps"];
  /** While loading with a `loadingLabel`: its text and its box over the plot (`<div class="ts-bkm-d-loading-box">` around the kit's label). */
  readonly loadingLabel: { readonly text: string; readonly boxStyle: StyleObject } | null;
}

export type DistributionController<Props> = ChartController<Props, DistributionView, null>;

// The data-update glide (a keyed rect or path moves from its painted geometry); the first paint is the CSS entrance, so no native one.
const DISTRIBUTION_RENDERER = /* @__PURE__ */ motion({ initial: false, transition: { type: "tween", duration: 500, easing: "ease-out" }, respectReducedMotion: true });

const HOST_STYLE: StyleObject = /* @__PURE__ */ (() => ({ position: "relative", ...bklitSurfaceStyle }))();

const sameProps = (a: object, b: object): boolean => {
  if (a === b) {
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  // SAFETY: both are plain prop records; reading a key of either is sound.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  return ak.length === bk.length && ak.every((key) => Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
};

export function createDistributionController<Props extends DistributionStatusProps>(env: ChartEnv, initial: ChartInput<Props>, family: DistributionFamily<Props>): DistributionController<Props> {
  const { uid } = env;
  const live = createLive();
  const tooltip = tooltipTargetStore();
  const handle = createInteractionHandle();
  const hold = createKeyboardFocusHold(() => handle.interaction.current);
  const overlay = createOverlay();
  const conceal = createConceal();
  const viewVersion = writable(0);
  let latest = initial;
  let derivedFrom: ChartInput<Props> | undefined;
  let pass: DistributionPass | undefined;
  /** The status of the latest pass and of the latest draw: a change between passes is a flip, a draw from ready to loading conceals. */
  let passLoading = false;
  let drawnLoading: boolean | undefined;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  let ownedStyle: HTMLStyleElement | null = null;
  let chart: ChartSurface | undefined;
  let focused: AnyPoint | null = null;

  const current = (): DistributionPass => {
    // Read once and kept as values: Solid's first input is getters over the live props, which would compare equal to every later input.
    const { props, table } = latest;
    if (pass === undefined || derivedFrom === undefined || derivedFrom.table !== table || !sameProps(derivedFrom.props, props)) {
      const loading = props.status === "loading";
      const phase: DistributionPhase = { loading, flip: pass !== undefined && loading !== passLoading };
      pass = family.pass({ props, table, uid, live, phase });
      passLoading = loading;
      derivedFrom = { props, table };
    }
    return pass;
  };

  // --- Hover: the host's `data-hover`, the overlay ----------------------------------------------------------------------------
  const showFocus = (): void => {
    const el = host;
    if (el === null) {
      return;
    }
    const index = focused === null ? null : current().hoverIndex(focused);
    if (index === null) {
      clearAttribute(el, "data-hover");
    } else {
      writeAttribute(el, "data-hover", String(index));
    }
    overlay.show(focused);
  };
  function onFocusChange(point: ChartPoint | null): void {
    const next: AnyPoint | null = point;
    hold(next);
    if (next === focused) {
      return;
    }
    const sameItem = next !== null && focused !== null && next.key === focused.key && next.markId === focused.markId;
    focused = next;
    if (sameItem) {
      // The same item after a redraw: only its pixels moved.
      overlay.show(next);
      return;
    }
    showFocus();
  }
  function onRender(context: ChartRendererRenderContext<never, never, never>): void {
    handle.onRender(context);
    overlay.drawn(live.chart);
    conceal.after(context.container);
  }

  // --- One pass's renderer options and view, kept while the pass holds ----------------------------------------------------------
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const viewCell = memoCell<DistributionView>();
  const hostAttrs = {
    "data-bkm-chart": family.chart,
    "data-bkm-d": uid,
    "data-slot": "chart",
    "data-bkm-static": env.staticPreview ? "" : undefined,
  } as const;
  const loadingHostAttrs = { ...hostAttrs, "data-bkm-status": "loading", "aria-busy": "true" } as const;
  const optionsOf = (p: DistributionPass): ReturnType<typeof surfaceOptions> =>
    optionsCell([p.definition, p.aspectRatio, p.ariaLabel, p.ariaDescription, p.describe, passLoading, latest.table], () =>
      surfaceOptions(
        erase({
          a11y: { describe: passLoading ? () => loadingDescription(p.ariaLabel ?? family.ariaLabel) : p.describe, dataTable: propsFor<ChartDataTableProps>(latest.table, DATA_TABLE_ROLE)[0] },
          definition: p.definition,
          renderer: DISTRIBUTION_RENDERER,
          aspectRatio: p.aspectRatio,
          ariaLabel: p.ariaLabel ?? family.ariaLabel,
          ariaDescription: p.ariaDescription,
          measureText: measureNoText,
          onFocusChange,
          onRender,
          onTooltipBodyChange: tooltip.onChange,
        }),
        uid,
      ));
  const viewOf = (p: DistributionPass): DistributionView => {
    const label = passLoading ? (latest.props.loadingLabel ?? "").trim() : "";
    return viewCell([p.aspectRatio, p.tooltip, p.tooltipProps, passLoading, label, p.margin], () => ({
      hostAttrs: passLoading ? loadingHostAttrs : hostAttrs,
      hostStyle: HOST_STYLE,
      surfaceStyle: surfaceHostStyle(surfaceBox({ aspectRatio: p.aspectRatio })),
      tooltip: p.tooltip,
      tooltipProps: p.tooltipProps,
      loadingLabel: label === "" ? null : { text: label, boxStyle: loadingLabelBox(p.margin) },
    }));
  };

  // --- The renderer and the host ---------------------------------------------------------------------------------------------
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(optionsOf(current()));
    return chart;
  };
  const draw = (): void => {
    const p = current();
    if (ownedStyle !== null && ownedStyle.textContent !== p.css) {
      ownedStyle.textContent = p.css;
    }
    overlay.model(p.overlay);
    if (surfaceEl !== null) {
      // Ready -> loading: the drawn marks fade out over the skeleton; back to ready drops what is left of them.
      if (passLoading && drawnLoading === false && !env.staticPreview) {
        conceal.before(surfaceEl);
      } else if (!passLoading) {
        conceal.clear();
      }
      drawnLoading = passLoading;
      surfaceOf().render(surfaceEl, optionsOf(p));
    }
  };

  let listenersOff: (() => void) | undefined;
  const listen = (el: HTMLElement): (() => void) => {
    const tapOff = attachTapFocus(el, () => handle.interaction.current, "press");
    const holdOff = hold.attach(el);
    const legend = env.legendHover;
    const legendOff = legend === undefined ? undefined : legend.subscribe(() => { writeLegendHover(el, legend.get()); });
    if (legend !== undefined) {
      writeLegendHover(el, legend.get());
    }
    return (): void => {
      tapOff();
      holdOff();
      legendOff?.();
    };
  };

  return {
    view: { get: () => viewOf(current()), subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context: readonly(writable(null)),
    update(input) {
      const before = pass;
      latest = input;
      const p = current();
      if (p !== before) {
        viewVersion.set(viewVersion.get() + 1);
        if (passLoading) {
          // The skeleton has no points: whatever was focused goes.
          focused = null;
        }
        if (focused !== null || passLoading) {
          // The items may have moved: the focus is the renderer's again on its next report.
          showFocus();
        }
      }
      if (host !== null) {
        draw();
      }
    },
    attach(dom) {
      host = dom.host;
      surfaceEl = dom.surface;
      ownedStyle = dom.host.ownerDocument.createElement("style");
      ownedStyle.textContent = current().css;
      dom.host.prepend(ownedStyle);
      draw();
      dom.host.append(overlay.root(dom.host.ownerDocument));
      listenersOff = listen(dom.host);
    },
    mounted() {
      // The entrance is CSS from the first paint: nothing to arm.
    },
    detach() {
      listenersOff?.();
      listenersOff = undefined;
      overlay.remove();
      conceal.clear();
      drawnLoading = undefined;
      ownedStyle?.remove();
      ownedStyle = null;
      chart?.destroy();
      handle.interaction.current = null;
      if (host !== null) {
        clearAttribute(host, "data-hover");
      }
      focused = null;
      host = null;
      surfaceEl = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
