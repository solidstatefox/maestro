"use client";

import { STREAM_FAMILY, STREAM_ROLES } from "../core/stream/stream";
import type { StreamChartProps as CoreStreamChartProps, StreamProps, StreamLabelsProps, StreamChartLoadingProps } from "../core/types/stream";
import { defineCarrier } from "../kit/role";
import { createMarkChart, createMarkChartLoading } from "../mark-chart/mark-chart";
import type { MarkChartHostProps } from "../mark-chart/mark-chart";

/** Props for `StreamChart`. */
export interface StreamChartProps extends CoreStreamChartProps, MarkChartHostProps {}

/**
 * Stream chart: stacked layers around a moving baseline (a streamgraph), or a silhouette, normalised or plain stack.
 * Hover lights a layer and shows every layer at that x. Compose it with a `Stream` per layer, `StreamLabels`, `Grid`, `XAxis`, `YAxis` and `ChartTooltip`.
 */
export const StreamChart = /* @__PURE__ */ createMarkChart(STREAM_FAMILY, "StreamChart");

/** Ready-made loading placeholder for a stream chart: shorthand for `<StreamChart status="loading" />` with no data, drawing shimmering muted wavy bands. */
export const StreamChartLoading = /* @__PURE__ */ createMarkChartLoading<CoreStreamChartProps, StreamChartLoadingProps>(STREAM_FAMILY, StreamChart, "StreamChartLoading");

/**
 * One layer of the stream chart, its values read from `dataKey`. It renders nothing itself; place it inside `StreamChart`.
 */
export const Stream = /* @__PURE__ */ defineCarrier<StreamProps>(STREAM_ROLES.stream, "Stream");

/** Each layer's name inside it, where it is thickest. It renders nothing itself; place it inside `StreamChart`. */
export const StreamLabels = /* @__PURE__ */ defineCarrier<StreamLabelsProps>(STREAM_ROLES.labels, "StreamLabels");
