import type { ChartTextMeasurer } from "@tanstack/charts";

// A polar chart that paints no chart text: a constant measurer is exact. Supplying one also stops charts-core from re-rendering the chart when
// a web font finishes loading (handleFontLoad), a render that reaches motion with unchanged geometry and cancels the in-flight sweep.
export const measureNoText: ChartTextMeasurer = () => ({ height: 0, width: 0, x: 0, y: 0 });
