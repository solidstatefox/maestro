import type { ChartTooltipContent } from "@tanstack/charts";
import { hasText, isString } from "../guards";
import { el } from "../markup/node";
import type { MarkupNode, MarkupTree } from "../markup/node";
import type { StyleObject } from "../style";

const TITLE_CLASS = "ts-chart-tooltip__title";
const ROWS_CLASS = "ts-chart-tooltip__rows";
const ROW_CLASS = "ts-chart-tooltip__row";
const SWATCH_STYLE: StyleObject = { display: "block", width: "0.55rem", height: "0.55rem", "border-radius": "0.15rem", "box-shadow": "inset 0 0 0 1px rgb(0 0 0/.12)" };
const TITLE_STYLE: StyleObject = { display: "flex", "align-items": "center", gap: "0.4rem", "font-weight": 650 };
const ROW_STYLE: StyleObject = { display: "grid", "grid-template-columns": "0.55rem minmax(0,1fr) auto", "align-items": "center", "column-gap": "0.4rem" };
const ACTIVE_ROW_STYLE: StyleObject = /* @__PURE__ */ ((): StyleObject => ({
  ...ROW_STYLE,
  "font-weight": "var(--ts-chart-tooltip-active-row-font-weight, 700)",
  background: "var(--ts-chart-tooltip-active-row-background, color-mix(in srgb, currentColor 12%, transparent))",
  "border-radius": "var(--ts-chart-tooltip-active-row-border-radius, .2rem)",
  "box-shadow": "var(--ts-chart-tooltip-active-row-shadow, 0 0 0 2px color-mix(in srgb, currentColor 12%, transparent))",
}))();
const TITLE_WITH_ROWS_STYLE: StyleObject = /* @__PURE__ */ ((): StyleObject => ({ ...TITLE_STYLE, "margin-bottom": "0.3rem" }))();
const TITLE_ALONE_STYLE: StyleObject = /* @__PURE__ */ ((): StyleObject => ({ ...TITLE_STYLE, "margin-bottom": 0 }))();
const VALUE_STYLE: StyleObject = { "text-align": "right", "font-variant-numeric": "tabular-nums", "white-space": "nowrap" };

const swatch = (color: string): MarkupNode => el("span", { "aria-hidden": "true", class: "ts-chart-tooltip__swatch" }, [], { style: { ...SWATCH_STYLE, background: color } });

/** The body for a target's content: its text, or a title (with its swatch) over one row per series. */
export const defaultTooltipBody = (content: ChartTooltipContent | string): MarkupTree => {
  if (isString(content)) {
    return content;
  }
  const hasRows = content.rows.length > 0;
  return [
    hasText(content.title)
      ? el("div", { class: TITLE_CLASS }, [hasText(content.color) ? swatch(content.color) : null, content.title], { style: hasRows ? TITLE_WITH_ROWS_STYLE : TITLE_ALONE_STYLE })
      : null,
    hasRows
      ? el(
          "div",
          { "aria-hidden": "true", class: ROWS_CLASS },
          content.rows.map((row, index) =>
            el(
              "div",
              { class: ROW_CLASS, "data-active": String(row.active === true) },
              [hasText(row.color) ? swatch(row.color) : el("span", {}), el("span", {}, [row.label]), el("span", {}, [row.value], { style: VALUE_STYLE })],
              // Rows carry no id and labels can repeat, so the position disambiguates.
              { key: `${row.label}\0${index}`, style: row.active === true ? ACTIVE_ROW_STYLE : ROW_STYLE },
            ),
          ),
        )
      : null,
  ];
};
