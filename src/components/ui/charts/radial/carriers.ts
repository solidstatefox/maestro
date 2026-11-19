"use client";
// The radial chart's layers as config carriers: each renders nothing, the chart reads its props (React: from its children; read-children.ts)
// and folds every layer, in the order written, into one native polar definition (core/radial/model.ts).
import { enableRadialArea, enableRadialAxis, enableRadialBar, enableRadialDotBar, enableRadialLine, enableRadialRingBar, enableRadialScrubber } from "../core/radial/enable";
import type { RadialAreaProps, RadialAxisProps, RadialBarProps, RadialDotBarProps, RadialLineProps, RadialRingBarProps, RadialScrubberProps } from "../core/types/radial";
// Each role is written as its string (core/radial/roles.ts `RADIAL_ROLES`): a property read in a pure call's arguments keeps the call,
// and every layer with it, in a bundle that imports one carrier.
import { defineCarrier } from "../kit/role";

/** Axis chrome: the centre circle, the tick ring, angle labels (clock hours, rotated categories or time ticks), value grid rings with labels and, on angular charts, value ticks along the arc with a label at the start of each ring. Its grid grows in from the centre on enter. Renders nothing itself; `RadialChart` reads its props. */
const RadialAxis = /* @__PURE__ */ defineCarrier<RadialAxisProps>("radialAxis", "RadialAxis", undefined, enableRadialAxis);
/** Radial stacked bars: every bin an arc column with one segment per series (innermost first) on a radial scale, so a segment's area tracks its value. Bars grow outward on enter, staggered clockwise; hovering a bin dims the others. Renders nothing itself; `RadialChart` reads its props. */
const RadialBar = /* @__PURE__ */ defineCarrier<RadialBarProps>("radialBar", "RadialBar", undefined, enableRadialBar);
/** Radial dot bars: every bin a stacked column of dots on concentric rows, with ghost dots in future bins, pattern fills and callout annotations. Dots cascade outward around the clock on enter. Renders nothing itself; `RadialChart` reads its props. */
const RadialDotBar = /* @__PURE__ */ defineCarrier<RadialDotBarProps>("radialDotBar", "RadialDotBar", undefined, enableRadialDotBar);
/** Concentric ring bars for an `orientation="angular"` chart: every bin a ring and each series' value sweeping along the arc, stacked end to end over a faint track. Renders nothing itself; `RadialChart` reads its props. */
const RadialRingBar = /* @__PURE__ */ defineCarrier<RadialRingBarProps>("radialRingBar", "RadialRingBar", undefined, enableRadialRingBar);
/** A smooth radial line through the bin centres: a series line, or a comparison line for any other key. It draws itself clockwise on enter, ends in a pulsing "now" marker and marks the hovered bin with a dot that rides the line. Renders nothing itself; `RadialChart` reads its props. */
const RadialLine = /* @__PURE__ */ defineCarrier<RadialLineProps>("radialLine", "RadialLine", undefined, enableRadialLine);
/** Radial areas: every chart series stacked or overlaid from the band base, or a single `dataKey` area (a band with `baseDataKey`), with a gradient rising outward. They sweep in clockwise on enter; an active dot rides each outer edge. Renders nothing itself; `RadialChart` reads its props. */
const RadialArea = /* @__PURE__ */ defineCarrier<RadialAreaProps>("radialArea", "RadialArea", undefined, enableRadialArea);
/** A line from the centre circle outward that springs to the hovered bin and rests on "now" on clock charts. Its spring is the chart's crosshair, which the hover dots ride. Renders nothing itself; `RadialChart` reads its props. */
const RadialScrubber = /* @__PURE__ */ defineCarrier<RadialScrubberProps>("radialScrubber", "RadialScrubber", undefined, enableRadialScrubber);

export { RadialArea, RadialAxis, RadialBar, RadialDotBar, RadialLine, RadialRingBar, RadialScrubber };
