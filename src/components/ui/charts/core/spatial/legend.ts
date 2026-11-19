import { el } from "../markup/node";
import type { MarkupChild, MarkupNode } from "../markup/node";
import type { SpatialLegendProps } from "../types/spatial";
import { formatSpatialTick } from "./plane";

const LEGEND_CLASS = "bkm-sp-legend";

const root = (props: SpatialLegendProps, kind: string, items: readonly MarkupChild[]): MarkupNode =>
  el(
    "div",
    { class: props.className === undefined ? LEGEND_CLASS : `${LEGEND_CLASS} ${props.className}`, "data-align": props.align ?? "center", "data-kind": kind },
    [props.title === undefined ? null : el("span", { class: "bkm-sp-legend-title" }, [props.title]), ...items],
  );

/** Stepped fills: one swatch per fill, labelled with the value range it covers (`5–12`, the last `24+`); `whole` values (counts) end a
 * range one below the next step's start (`1–3`, `4–10`). */
export const stepLegend = (props: SpatialLegendProps, colors: readonly string[], thresholds: readonly number[], min: number, whole = false): MarkupNode => {
  const format = props.formatValue ?? formatSpatialTick;
  const steps = Math.min(colors.length, thresholds.length + 1);
  const items: MarkupNode[] = [];
  for (let i = 0; i < steps; i += 1) {
    const from = i === 0 ? min : (thresholds[i - 1] ?? min);
    const to = thresholds[i];
    const end = to === undefined ? undefined : whole ? to - 1 : to;
    let label = `${format(from)}+`;
    if (end !== undefined) {
      label = end <= from ? format(from) : `${format(from)}–${format(end)}`;
    }
    items.push(el("span", { class: "bkm-sp-legend-item" }, [el("span", { "aria-hidden": "true", class: "bkm-sp-legend-swatch" }, [], { style: { background: colors[i] ?? "var(--chart-1)" } }), label], { key: i }));
  }
  return root(props, "steps", items);
};

/** Bubble sizes: a circle per value at the radius the chart draws it, labelled with the value. */
export const sizeLegend = (props: SpatialLegendProps, values: readonly number[], radiusOf: (value: number) => number, color: string): MarkupNode => {
  const format = props.formatValue ?? formatSpatialTick;
  const items = values.map((value, i) => {
    const side = `${Math.max(2, radiusOf(value) * 2)}px`;
    return el("span", { class: "bkm-sp-legend-item" }, [
      el("span", { "aria-hidden": "true", class: "bkm-sp-legend-bubble" }, [], { style: { background: color, height: side, width: side } }),
      format(value),
    ], { key: i });
  });
  return root(props, "sizes", items);
};

/** Named groups: a dot per group in its color. */
export const seriesLegend = (props: SpatialLegendProps, entries: readonly { readonly label: string; readonly color: string }[]): MarkupNode =>
  root(props, "series", entries.map((entry, i) =>
    el("span", { class: "bkm-sp-legend-item" }, [el("span", { "aria-hidden": "true", class: "bkm-sp-legend-dot" }, [], { style: { background: entry.color } }), entry.label], { key: i })));

/** A continuous ramp from `min` to `max` through `colors`. */
export const rampLegend = (props: SpatialLegendProps, colors: readonly string[], min: number, max: number): MarkupNode => {
  const format = props.formatValue ?? formatSpatialTick;
  return root(props, "ramp", [
    el("span", { class: "bkm-sp-legend-value" }, [format(min)]),
    el("span", { "aria-hidden": "true", class: "bkm-sp-legend-ramp" }, [], { style: { background: `linear-gradient(90deg, ${colors.join(", ")})` } }),
    el("span", { class: "bkm-sp-legend-value" }, [format(max)]),
  ]);
};
