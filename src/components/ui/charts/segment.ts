"use client";

import { createElement, Fragment } from "react";
import type { ReactElement } from "react";
import { CHART_ROLE } from "./children";
import type { SegmentBackgroundProps, SegmentLineProps } from "./core/types/cartesian";

interface SegmentChildComponent<ComponentProps> {
  (props: ComponentProps): ReactElement;
  [CHART_ROLE]?: string;
  displayName: string;
}

/** Shades the area of the current drag selection (`ChartSelection`) in a cartesian chart. */
const SegmentBackground: SegmentChildComponent<SegmentBackgroundProps> = /* @__PURE__ */ ((): SegmentChildComponent<SegmentBackgroundProps> => Object.assign(
  (_props: Readonly<SegmentBackgroundProps>): ReactElement => createElement(Fragment),
  { [CHART_ROLE]: "segmentBackground", displayName: "SegmentBackground" },
))();

/** Draws a vertical line at the start of the current drag selection. */
const SegmentLineFrom: SegmentChildComponent<SegmentLineProps> = /* @__PURE__ */ ((): SegmentChildComponent<SegmentLineProps> => Object.assign(
  (_props: Readonly<SegmentLineProps>): ReactElement => createElement(Fragment),
  { [CHART_ROLE]: "segmentLineFrom", displayName: "SegmentLineFrom" },
))();

/** Draws a vertical line at the end of the current drag selection. */
const SegmentLineTo: SegmentChildComponent<SegmentLineProps> = /* @__PURE__ */ ((): SegmentChildComponent<SegmentLineProps> => Object.assign(
  (_props: Readonly<SegmentLineProps>): ReactElement => createElement(Fragment),
  { [CHART_ROLE]: "segmentLineTo", displayName: "SegmentLineTo" },
))();

export { SegmentBackground, SegmentLineFrom, SegmentLineTo };
