"use client";
// SeriesBar config carrier: renders nothing. ComposedChart reads its props with
// `readChildren` (role "seriesBar") and compiles them into native rect marks.
import type { ReactElement } from "react";
import { CHART_ROLE } from "../core/carriers/roles";
import type { SeriesBarProps } from "../core/types/composed";

const SeriesBarCarrier = (_props: Readonly<SeriesBarProps>): ReactElement | null => null;

/** A bar series for a `ComposedChart`, drawn together with `Line` and `Area` series. Bars are grouped by default or stacked with `stacked`. It renders nothing itself; place it as a child of the chart. */
export const SeriesBar = /* @__PURE__ */ (() => Object.assign(SeriesBarCarrier, {
  [CHART_ROLE]: "seriesBar",
  displayName: "SeriesBar",
}))();
