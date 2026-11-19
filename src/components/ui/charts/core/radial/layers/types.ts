import type { PolarMark } from "@tanstack/charts/polar";
import type { RadialDotMotion, RadialEdgeLookup, RadialSpringOptions } from "../../types/radial";
import type { RadialShell } from "../shell";

// oxlint-disable-next-line typescript/no-explicit-any -- TanStack's polar marks are typed per datum; a layer's list mixes them
export type AnyPolarMark = PolarMark<any, any, any, any, any>;

/** What a layer is built from. */
export interface LayerContext {
  readonly shell: RadialShell;
  /** The layer's index among the chart's layers: its marks' ids and classes carry it. */
  readonly index: number;
  /** The chart's id: its SVG resources' ids carry it (they live in the document, beside other charts'). */
  readonly uid: string;
}

/** What a layer's entrance runs on: the drawn chart, after the draw that mounts it and before its paint. */
export interface LayerEnterEnv {
  /** The rendered group of a mark (`id`), or `null` when it drew nothing. */
  readonly group: (markId: string) => SVGGElement | null;
  /** The overlay's `<defs>`: an entrance adds its masks and clips here (and removes them when done). */
  readonly defs: SVGDefsElement;
  /** `performance.now()` when the entrance starts: every delay counts from it. */
  readonly start: number;
  /** Cancels the entrance's frame loops and animations (a new draw, an unmount). Register each cancel here. */
  readonly onCancel: (cancel: () => void) => void;
}

/** A dot that rides an edge at an animated angle (a `RadialLine` marker, a `RadialArea` active dot), drawn in the overlay. */
export interface HoverDotSpec {
  readonly key: string;
  readonly lookup: RadialEdgeLookup;
  /** Shows only while the hovered bin has a point on this edge. */
  readonly showsAt: (bin: number) => boolean;
  readonly motion: RadialDotMotion;
  readonly spring: RadialSpringOptions | undefined;
  readonly r: number;
  readonly fill: string;
  readonly fillOpacity: number | undefined;
  readonly stroke: string;
  readonly strokeWidth: number;
  /** The legend dim class the dot shares with its layer. */
  readonly dimClass: string;
}

/** The scrubber's look and rest, drawn in the overlay and driven by the crosshair spring. */
export interface ScrubberSpec {
  readonly variant: "solid" | "dashed" | "gradient";
  readonly dashArray: string;
  readonly showDot: boolean;
  readonly color: string;
  readonly lineOpacity: number;
  readonly strokeWidth: number;
  readonly dotRadius: number;
  readonly rest: "now" | "hidden";
  readonly spring: RadialSpringOptions;
  /** The line's ends (px from the centre). */
  readonly inner: number;
  readonly outer: number;
}

export interface RadialLayer {
  readonly marks: readonly AnyPolarMark[];
  /** SVG markup for the overlay's `<defs>` (gradients, patterns), ids prefixed with the chart's. */
  readonly defs: string;
  /** Scoped CSS for the chart's owned `<style>` (the legend and bin dims). */
  readonly css: string;
  /** Marks whose children are per-bin elements (keyed `<letter><bin>`): the hovered bin's are marked hot, the others dim. */
  readonly hotMarks?: readonly string[];
  readonly dots?: readonly HoverDotSpec[];
  readonly scrubber?: ScrubberSpec;
  /** Runs after every draw, on the drawn elements (attributes the marks can't carry, such as a column's clip). */
  readonly decorate?: (env: LayerEnterEnv) => void;
  /** The layer's entrance on the drawn elements (only when the chart animates). */
  readonly enter?: (env: LayerEnterEnv) => void;
}

/** A layer that draws nothing. */
export const EMPTY_LAYER: RadialLayer = { marks: [], defs: "", css: "" };
