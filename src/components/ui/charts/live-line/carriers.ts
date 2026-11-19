"use client";
// Config-carrier children for the native LiveLineChart. They render nothing;
// the chart reads their props with the kit's `readChildren` (kit/role.ts).
import type { LiveLineConfig, LiveXAxisConfig, LiveYAxisConfig } from "../core/types/live-line";
import { defineCarrier } from "../kit/role";

/** The scrolling live line of a `LiveLineChart`, with a gradient fill, a pulsing dot and a value badge at the live tip. It renders nothing itself; place it as a child of the chart. */
export const LiveLine = /* @__PURE__ */ defineCarrier<Readonly<LiveLineConfig>>("liveLine", "LiveLine");
/** The time axis of a `LiveLineChart`. Labels roll with the window. It renders nothing itself; place it as a child of the chart. */
export const LiveXAxis = /* @__PURE__ */ defineCarrier<Readonly<LiveXAxisConfig>>("liveXAxis", "LiveXAxis");
/** The value axis of a `LiveLineChart`, with labels spaced by a minimum pixel gap. It renders nothing itself; place it as a child of the chart. */
export const LiveYAxis = /* @__PURE__ */ defineCarrier<Readonly<LiveYAxisConfig>>("liveYAxis", "LiveYAxis");
