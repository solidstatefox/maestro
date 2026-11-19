"use client";
// Bar-family config carriers. They render nothing; BarChart reads their props
// with `readBarChildren` and compiles them into one native definition.
import type { ReactNode } from "react";
import type { BarColumnTrackProps, BarDepthProviderProps as CoreBarDepthProviderProps, BarProps, BarSquaresProps, BarXAxisProps, BarYAxisProps } from "../core/types/bar";
import { defineCarrier } from "../kit/role";

/** Props of `BarDepthProvider`. */
export interface BarDepthProviderProps extends CoreBarDepthProviderProps<ReactNode> {}

/** A bar series for the `dataKey` column. Bars grow from the baseline and fade the other bars on hover. It renders nothing itself; place it as a child of the chart. */
export const Bar = /* @__PURE__ */ defineCarrier<BarProps>("bar", "Bar");
/** Draws each bar as a stack of squares instead of one solid rectangle. It renders nothing itself; place it as a child of the chart. */
export const BarSquares = /* @__PURE__ */ defineCarrier<BarSquaresProps>("barSquares", "BarSquares");
/** Draws a faint rounded column over the empty part of each `BarSquares` column, from its top square to the top of the plot. It renders nothing itself; place it as a child of the chart. */
export const BarColumnTrack = /* @__PURE__ */ defineCarrier<BarColumnTrackProps>("barColumnTrack", "BarColumnTrack");
/** The category axis of a `BarChart`: one label per bar group. It renders nothing itself; place it as a child of the chart. */
export const BarXAxis = /* @__PURE__ */ defineCarrier<BarXAxisProps>("barXAxis", "BarXAxis");
/** The value axis of a `BarChart`. It renders nothing itself; place it as a child of the chart. */
export const BarYAxis = /* @__PURE__ */ defineCarrier<BarYAxisProps>("barYAxis", "BarYAxis");
