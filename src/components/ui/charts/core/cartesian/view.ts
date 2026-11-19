import type { LoadingPhase } from "../loading/phase-machine";
import { el } from "../markup/node";
import type { MarkupNode } from "../markup/node";
import type { StyleObject } from "../style";
import type { ChartMargin } from "../theme";
import { bklitSurfaceStyle } from "../theme";
import type { TooltipRange } from "../tooltip/range-rows";
import type { TooltipRowColor } from "../tooltip/series-labels";
import { seriesLabels } from "../tooltip/series-labels";
import type { ChildTable } from "../carriers/table";
import { rangeTooltipFor } from "./features";
import { cartesianHostVars } from "./host-style";
import { loadingHostVars } from "./loading";
import type { LoadingGrid } from "./loading";
import type { PlotSnapshot } from "./plot-size";
import type { ResolvedSeries, Row } from "./series";

/** The sweep loading style's silhouettes (bklit line.tsx:173-186 / area.tsx:294-355), drawn over the plot at the size the draw published. */
export interface SweepOverlays {
  readonly series: readonly ResolvedSeries[];
  /** The phase is exiting: the silhouette fades out (loading-sweep.tsx:395-409). */
  readonly exiting: boolean;
  readonly margin: ChartMargin;
}

/** The default tooltip body's per-series inputs: rows in declaration order, each with its dot colour and label. */
export interface TooltipBase {
  readonly order: readonly string[];
  readonly colors: Readonly<Partial<Record<string, TooltipRowColor>>>;
  readonly labels: Readonly<Partial<Record<string, string>>>;
  /** Band rows: their group key -> edge keys (the row shows the range, core/tooltip/range-rows.ts); absent without a Band. */
  readonly ranges?: Readonly<Partial<Record<string, TooltipRange>>>;
}

/** The base with the chart's Band rows after the series' (bklit lists line rows, then band ranges); the base itself without a Band. */
export const withRangeRows = (base: TooltipBase, table: ChildTable): TooltipBase => {
  const bands = rangeTooltipFor(table);
  if (!bands || bands.order.length === 0) {
    return base;
  }
  return { order: [...base.order, ...bands.order], colors: { ...base.colors, ...bands.colors }, labels: { ...base.labels, ...bands.labels }, ranges: bands.ranges };
};

export interface CartesianView {
  readonly phase: LoadingPhase;
  /** The host's attributes (`undefined` leaves one out), beside the adapter's own `class` and hydration marker. */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`. */
  readonly hostStyle: StyleObject;
  /** While the chart is not ready, the host's style after the reader's (inert to the pointer, the grid shimmer's period). */
  readonly hostLoadingStyle: StyleObject | undefined;
  /** The surface's host box (`ts-chart-host`): RendererChart.js:116-119, filling the host's height when the reader's style unsets the aspect ratio. */
  readonly surfaceStyle: StyleObject;
  /** The hidden defs beside the svg, in this order: the Background's pattern, the ReferenceAreas' patterns, the hover band's clipPath. */
  readonly resources: readonly (MarkupNode | null)[];
  /** The centred shimmer label while loading (and while it exits). */
  readonly loadingLabel: { readonly text: string; readonly exiting: boolean } | null;
  readonly sweep: SweepOverlays | null;
  /** The brush strip's blurred panes, shown once the plot has an x span (`brushPanesShown`). */
  readonly brushPanes: readonly MarkupNode[] | null;
  /** The carriers, the (skeleton while loading) data and series the tooltip body and the custom children read. */
  readonly table: ChildTable;
  readonly data: readonly Row[];
  readonly tooltipBase: TooltipBase;
  /** The renderer's options: a new definition is a new view, so the adapter's next commit hands it over. */
  readonly surface: object;
}

interface HostStyleInput {
  readonly animationDuration: number;
  readonly margin: ChartMargin;
  readonly clipped: boolean;
  /** The entrance easing (CSS), when not bklit's default. */
  readonly enterEase?: string;
}

/** The host's style before the reader's: the `--bkm-*` custom properties the scoped CSS reads that do not depend on the plot size, and the surface tokens. */
export const cartesianHostStyle = ({ animationDuration, margin, clipped, enterEase }: HostStyleInput): StyleObject => ({
  width: "100%",
  position: "relative",
  ...cartesianHostVars({ animationDuration, margin, clipped }),
  ...(enterEase === undefined ? null : { "--bkm-enter-ease": enterEase }),
  "user-select": "none",
  "-webkit-user-select": "none",
  ...bklitSurfaceStyle,
});

/** The loading host's style after the reader's: inert to the pointer, then the core's custom properties (loading.ts). */
export const loadingHostStyle = (grid: LoadingGrid | undefined): StyleObject => ({
  "pointer-events": "none",
  ...loadingHostVars(grid),
});

/** bklit ChartBrushTrackOverlay: the strip outside the selection is blurred, faded out toward the outer ends. Static (not hover). */
export const brushPanes = (fade: boolean): MarkupNode[] =>
  (["left", "right"] as const).map((edge) => el("div", { "aria-hidden": "true", class: "bkm-brush-pane", "data-edge": edge, "data-fade": fade ? "" : undefined }));

/** The panes mount with the size the draw published, once the x domain spans time. */
export const brushPanesShown = (snapshot: PlotSnapshot | null): boolean =>
  snapshot !== null && snapshot.size.innerWidth > 0 && snapshot.built.domains.x[1].getTime() > snapshot.built.domains.x[0].getTime();

/** A row's dot colour: the series stroke; a ProfitLossLine's row takes the hovered value's sign colour. Accepted divergence: bklit's default row reads the
 * stroke of the hidden `Line` bklit pairs with a ProfitLossLine (docs profit-loss-line.md), so its demos colour the row in `rows`; here the ProfitLossLine is
 * the series, and its stroke alone would paint a loss in the profit colour. */
export const rowColorOf = (s: ResolvedSeries): TooltipRowColor => {
  const pl = s.profitLoss;
  return pl ? (value: number): string => (value >= 0 ? pl.positive : pl.negative) : s.stroke;
};

/** Rows follow the declared Area / Line order: resolveSeries lists pattern areas first (their paint order), and a PatternArea under an Area of the same dataKey
 * would otherwise lift that row above the series declared before it. A pattern-only key still gets a slot, after them. */
export const tooltipBaseOf = (series: readonly ResolvedSeries[]): TooltipBase => {
  const named = [...series.filter((s) => s.kind !== "pattern"), ...series.filter((s) => s.kind === "pattern")];
  return {
    order: [...new Set(named.map((s) => s.dataKey))],
    colors: Object.fromEntries(named.toReversed().map((s): [string, TooltipRowColor] => [s.dataKey, rowColorOf(s)])),
    labels: seriesLabels(named),
  };
};
