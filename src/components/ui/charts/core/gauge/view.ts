import { MARKUP_SLOT } from "../markup/node";
import type { MarkupNode } from "../markup/node";
import type { StyleObject } from "../style";
import type { GaugeLabelAlign, GaugeLabelPlacement, GaugeStatFormat } from "../types/gauge";
import { gaugeLabelBoxes } from "./label";

/** The number the centre (arc) or the label (linear) shows and its caption; a framework's NumberFlow renders the value (label.ts lays it out). */
export interface GaugeStat {
  readonly value: number;
  readonly label: string;
  readonly prefix: string | undefined;
  readonly suffix: string | undefined;
  readonly format: GaugeStatFormat;
}

/** A fluid linear gauge's box around its label layout: `clipped` (`bk-gauge-clip` > `bk-gauge-clip-box` > `bk-gauge-clip-inner`) without a label, one
 * `bk-gauge-clip` in flow with one (see `linearBoxOf`). */
export interface GaugeLinearBox {
  readonly clipped: boolean;
  readonly style: StyleObject;
}

export interface GaugeView {
  readonly linear: boolean;
  /** Where the renderer's host sits in the tree (`gaugeLayout`): a new value is a new host element, which the adapter attaches again. */
  readonly layout: string;
  readonly rootClass: string;
  /** The root's attributes (`undefined` leaves one out), beside its class and the adapter's hydration marker. */
  readonly rootAttrs: Readonly<Record<string, string | undefined>>;
  /** A fluid arc's min-width. */
  readonly rootStyle: StyleObject | undefined;
  /** The renderer's host: the arc's size container (with its class), or the linear track (none). */
  readonly hostClass: string | undefined;
  readonly hostStyle: StyleObject;
  readonly linearBox: GaugeLinearBox | null;
  /** The surface's host box (`ts-chart-host`, dist/react/RendererChart.js:104-110). */
  readonly surfaceStyle: StyleObject;
  /** The label's stat; null without a `centerValue` (no label). */
  readonly stat: GaugeStat | null;
  /** A linear label's side of the track and alignment across it. */
  readonly labelPlacement: GaugeLabelPlacement;
  readonly labelAlign: GaugeLabelAlign;
}

/** The hidden svg the reader's children (pattern tiles) render in, its `<defs>` holding them (the core's slot): after the surface. */
export const GAUGE_CHILD_DEFS: MarkupNode = { attrs: { "aria-hidden": "true", focusable: "false", height: 0, width: 0 }, children: [{ attrs: {}, children: [MARKUP_SLOT], tag: "defs" }], style: { height: 0, overflow: "hidden", position: "absolute", width: 0 }, styleBefore: "width", tag: "svg" };

interface LinearBoxInput {
  readonly width: number | undefined;
  readonly labelled: boolean;
  readonly clip: StyleObject;
  readonly flow: StyleObject;
}

/** bklit's fluid linear gauge renders track and label inside a `linearHeight`-tall box through ParentSize, whose children are absolute (gauge.tsx:683-705).
 * A bare track fills that box exactly, so the box stays. Accepted divergence: a label does not fit it. visx's ParentSize clipped it (bklit's own docs
 * example showed only the number, no caption or track); since bklit #241 (chart-parent-size.tsx, no overflow hidden) the stack spills out of the box over
 * whatever follows. Here a labelled gauge lays out in flow instead, as a fixed `width` does in bklit. A fixed width has no box. */
export const linearBoxOf = ({ width, labelled, clip, flow }: LinearBoxInput): GaugeLinearBox | null => {
  if (width !== undefined) { return null; }
  return labelled ? { clipped: false, style: flow } : { clipped: true, style: clip };
};

/** The host's place in the tree: everything the markup above it branches on (the arc, a linear gauge's box, whether it is labelled and on which side). */
export const gaugeLayout = (linear: boolean, box: GaugeLinearBox | null, stat: GaugeStat | null, placement: GaugeLabelPlacement, align: GaugeLabelAlign): string => {
  if (!linear) { return "arc"; }
  const boxKey = box === null ? "fixed" : (box.clipped ? "clip" : "flow");
  if (stat === null) { return `linear:${boxKey}`; }
  return `linear:${boxKey}:${gaugeLabelBoxes(placement, align).labelFirst ? "label-first" : "label-last"}`;
};
