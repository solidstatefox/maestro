import type { ChartInteractionController, ChartMark, ChartPoint, ChartRenderer, ChartSurface } from "@tanstack/charts";

// Lists of marks, points and controllers hold entries with different datum / scale generics; only `any` accepts them all.
/* oxlint-disable typescript/no-explicit-any -- generic erasure for heterogeneous TanStack collections */
export type AnyMark = ChartMark<any, any, any, any, any, any, any>;
export type AnyInteraction = ChartInteractionController<any, any, any>;
export type AnyPoint = ChartPoint<any, any, any>;
export type AnyRenderer = ChartRenderer<any, any, any>;
export type AnySurface = ChartSurface<any, any, any>;
/* oxlint-enable typescript/no-explicit-any */

export { erase } from "./erase";
