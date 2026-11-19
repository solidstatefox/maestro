import type { ChartMargin, ChartTooltipContent, SceneNode } from "@tanstack/charts";
import type { ChildTable } from "../carriers/table";
import type { StyleObject } from "../style";
import type { ChartDescriber } from "../a11y/describe";

/** Where a point's datum takes the pointer: exact containment, topmost first. */
export type MarkHit =
  | { readonly kind: "rect"; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
  | { readonly kind: "circle"; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: "band"; readonly points: readonly (readonly [number, number])[] }
  /** Any of several boxes, each `[x0, y0, x1, y1]` (a waffle category's cells). */
  | { readonly kind: "rects"; readonly rects: readonly (readonly [number, number, number, number])[] }
  | { readonly kind: "none" };

/** One interactive item of a mark chart's scene. */
export interface MarkDatum {
  /** The `key` of the scene group drawn for it: hover marks that element `data-bkm-on`. */
  readonly item: string;
  /** Further scene keys lit with it (a node's links, a branch's header). */
  readonly related?: readonly string[];
  /** The tooltip's anchor and the keyboard order's position. */
  readonly x: number;
  readonly y: number;
  readonly hit: MarkHit;
  /** What a `ChartTooltip`'s `content({ point, index })` receives as `point`. */
  readonly row: Readonly<Record<string, unknown>>;
  /** …and as `index`. */
  readonly index: number;
  /** Its name (a screen reader's label). */
  readonly label: string;
  readonly color?: string;
  /** Its series, for a legend's hover. */
  readonly series?: number;
}

/** The plot box a family lays its scene out in (pixels), and how to measure label text in the chart's font. */
export interface MarkFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Text width in px at `size` and `weight` in the host's font (an estimate on the server). */
  readonly measure: (text: string, size: number, weight: number) => number;
}

export interface MarkLayout<Datum extends MarkDatum = MarkDatum> {
  readonly nodes: readonly SceneNode[];
  /** Interactive items, in keyboard order. */
  readonly points: readonly Datum[];
}

/** How one drawn element plays in: Web Animation keyframes and timing (ms). */
export interface MarkEnter {
  readonly keyframes: Keyframe[];
  readonly delay: number;
  readonly duration: number;
  readonly easing: string;
}

/** What a family builds from its props, carriers and state: one per input (keep its identity while they hold: memo cells). */
export interface MarkChartBuild<Datum extends MarkDatum = MarkDatum> {
  /** The scene in the final plot bounds. */
  readonly layout: (frame: MarkFrame) => MarkLayout<Datum>;
  /** Width over height; none with a `height`. */
  readonly aspectRatio?: number;
  readonly height?: number;
  /** The least height (px) of a chart sized by its `aspectRatio`: a narrow one grows taller rather than squeeze its labels together. */
  readonly minHeight?: number;
  readonly margin?: Partial<ChartMargin>;
  readonly ariaLabel: string;
  readonly ariaDescription?: string;
  /** The chart's data for screen readers: the svg's summary, a `<ChartDataTable>`'s rows, the keyboard's announcements (core/a11y/describe.ts). */
  readonly describe?: ChartDescriber;
  /** The host's own attributes and style (entrance and hover numbers the family's CSS reads). */
  readonly hostAttrs?: Readonly<Record<string, string>>;
  readonly hostStyle?: StyleObject;
  /** The default tooltip panel for a focused item (title and rows); null shows none for it. */
  readonly tooltip?: (datum: Datum) => ChartTooltipContent | null;
  /** The hovered or focused item changed (null: none): a chart's `onHoverChange`. */
  readonly hover?: (datum: Datum | null) => void;
  /** A click or Enter on an item (null: on nothing). */
  readonly select?: (datum: Datum | null) => void;
  /** Dragging an item with the pointer (a network's nodes), in scene pixels: `start` claims the drag (true) for the item under it. */
  readonly drag?: {
    readonly start: (datum: Datum, x: number, y: number) => boolean;
    readonly move: (x: number, y: number) => void;
    readonly end: () => void;
  };
  /** The scene keys a legend's hovered series lights. */
  readonly seriesItems?: (series: number) => readonly string[];
  /** The entrance of each drawn element (by its `data-ts-key`), played once per reveal, and again when the chart turns ready from
   * loading; none plays it without one, and then the loading skeleton holds still too (a chart's `animate={false}`). */
  readonly enter?: (key: string, element: Element) => MarkEnter | undefined;
  /** `status="loading"`'s skeleton: muted placeholder shapes hinting at the family's form (skeleton.ts `boneRect`, `boneDot`, `boneBand`,
   * `boneLink`), laid out in the final plot box. The controller draws them in place of the scene (no hover, no tooltip), shimmers them
   * and, when the chart turns ready, plays the entrance. */
  readonly skeleton?: (frame: MarkFrame) => readonly SceneNode[];
  /** A new value replays the entrance. */
  readonly revealKey?: string;
  /** Keyed updates (a drill-down, new data) glide to their new geometry. */
  readonly glide?: boolean;
  /** The host's cursor over an item: a pointer where items select. */
  readonly selectable?: boolean;
}

/** What a builder is handed. */
export interface MarkBuildInput<Props> {
  readonly props: Props;
  readonly table: ChildTable;
  readonly uid: string;
  /** The family's own state (a drill-down root, dragged positions), set through `setState`. */
  readonly state: MarkState;
  readonly setState: (patch: MarkState) => void;
}

export type MarkState = Readonly<Record<string, unknown>>;

/** A chart family on the mark chart. */
export interface MarkChartFamily<Props> {
  /** `data-bkm-chart`: the family's CSS scope. */
  readonly chart: string;
  /** Every prop the chart takes, by name (the ports read each, so each is tracked), and which are booleans (Vue casts `<X animate>`). */
  readonly props: MarkChartPropNames<Props>;
  /** Its state at mount. */
  readonly initialState?: MarkState;
  /** The props its loading placeholder (`<Family>ChartLoading`) draws with: no data, the skeleton's defaults. */
  readonly placeholder: Props;
  /** A builder for one chart (its memo cells are that chart's). */
  readonly createBuilder: () => (input: MarkBuildInput<Props>) => MarkChartBuild;
  /** Pointer handlers on the host (a network's drag): installed at attach, removed at detach. */
  readonly listen?: (host: HTMLElement, chart: MarkChartHandle) => () => void;
}

/** A family's prop names: all of them, and its booleans among them. */
export interface MarkChartPropNames<Props> {
  readonly names: readonly (keyof Props & string)[];
  readonly booleans: readonly (keyof Props & string)[];
}

/** What a family's listeners can reach of the mounted chart. */
export interface MarkChartHandle {
  readonly state: () => MarkState;
  readonly setState: (patch: MarkState) => void;
  /** The item under a client point, if any. */
  readonly itemAt: (clientX: number, clientY: number) => MarkDatum | null;
  /** Client coordinates to scene pixels. */
  readonly toScene: (clientX: number, clientY: number) => readonly [number, number];
  /** Pauses the hover and tooltip (a drag owns the pointer). */
  readonly suspendHover: (suspended: boolean) => void;
}

/** What the `ChartTooltip` carrier gives a mark chart: its `content` render prop (any framework's node), its class. */
export interface MarkTooltipCarrier<Node> {
  readonly content?: (args: { readonly point: Readonly<Record<string, unknown>>; readonly index: number }) => Node;
  readonly className?: string;
}
