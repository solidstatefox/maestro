import type { ChildTable } from "../carriers/table";
import type { HoverOverlayModel } from "../cartesian/hover-overlay";
import type { PlotSkeleton } from "./loading";
import type { StyleObject } from "../style";
import type { ChartMargin } from "../theme";
import type { TooltipRow } from "../types/tooltip";
import type { ChartDescriber } from "../a11y/describe";

/** A data row as a reader wrote it. */
export type PlotDatum = Readonly<Record<string, unknown>>;

/** One thing a hover reports: a task, a category, a series. Its marks carry the key suffix `:i<index>` (`itemKey`), which the dim CSS keys on. */
export interface PlotItem {
  /** What `ChartTooltip`'s `rows(point)` and `content({ point, index })` receive: the reader's row. */
  readonly datum: PlotDatum;
  /** The row's index in the chart's `data` (`content`'s `index`). */
  readonly index: number;
  /** The default tooltip's heading. */
  readonly title: string;
  /** The default tooltip's rows. */
  readonly rows: readonly TooltipRow[];
}

/** The size TanStack measured at the latest draw (the definition's `chart` callback writes it). */
export interface PlotSize {
  readonly width: number;
  readonly height: number;
}

/** A store of the measured size: the definition writes it, the hover chrome follows it. */
export interface PlotSizeStore {
  get(): PlotSize;
  set(width: number, height: number): void;
  subscribe(listener: () => void): () => void;
}

/** What a family's builder is handed on each pass. */
export interface PlotBuildInput<Props> {
  readonly props: Props;
  readonly table: ChildTable;
  /** The chart's id: its svg ids' prefix and the `data-bkm-kit` scope of its owned CSS. */
  readonly uid: string;
  /** `[data-bkm-kit="<uid>"]`: the owned CSS's scope. */
  readonly scope: string;
  /** Written by the definition at each draw (`plotChart`, core/plot/definition.ts). */
  readonly size: PlotSizeStore;
}

/** The surface's box: an aspect ratio, or a fixed height (a schedule's rows decide it), and an optional minimum width (wider scrolls). */
export interface PlotBox {
  readonly aspectRatio?: number;
  readonly height?: number;
  readonly minWidth?: number;
}

/** bklit's hover chrome for a family: the overlay model, placed from the measured size (null: none). */
export interface PlotChrome {
  readonly model: HoverOverlayModel;
  /** The overlay key of an item (the crosshair's x is `model.xOf(key)`, the pill shows `model.pill.labels[model.indexOf(key)]`). */
  readonly keyOf: (item: number) => number;
}

/** One pass of a family: the definition and everything around it. Each field keeps its identity while its inputs do (the builder memoises). */
export interface PlotBuild {
  /** The native definition (`DomChartDefinition`, erased). */
  readonly definition: object;
  readonly items: readonly PlotItem[];
  /** The item a focused point's datum belongs to (-1: none). */
  readonly itemOf: (datum: unknown) => number;
  readonly margin: ChartMargin;
  readonly box: PlotBox;
  readonly ariaLabel: string;
  readonly ariaDescription?: string;
  /** The chart's data for screen readers: the svg's summary, a `<ChartDataTable>`'s rows, the keyboard's announcements (core/a11y/describe.ts). */
  readonly describe?: ChartDescriber;
  /** The owned <style>'s text (the dims, scoped to the chart). */
  readonly css: string;
  /** Host attributes beside `data-bkm-chart` and `data-bkm-kit`. */
  readonly hostAttrs?: Readonly<Record<string, string | undefined>>;
  /** Host style before the reader's. */
  readonly hostStyle?: StyleObject;
  readonly chrome: PlotChrome | null;
  /** The loading skeleton (`status="loading"`, core/plot/loading.ts): the family's shapes in the plot's pixels, hinting at its marks. */
  readonly skeleton?: PlotSkeleton;
}

/** One chart family on the shared plot controller. */
export interface PlotFamily<Props> {
  /** The host's `data-bkm-chart` (styles.css keys a family's static rules on it). */
  readonly chart: string;
  /** The default `ariaLabel`'s fallback when the builder has none. */
  readonly build: (input: PlotBuildInput<Props>) => PlotBuild;
}

/** The default tooltip body's model for a hovered target: the item's title and rows, the `ChartTooltip` `rows` override applied. */
export interface PlotTooltip {
  readonly title: string;
  readonly rows: readonly TooltipRow[];
  /** `ChartTooltip` `content`'s `point`: the reader's row. */
  readonly point: PlotDatum;
  /** `ChartTooltip` `content`'s `index`: the row's index in `data`. */
  readonly index: number;
}
