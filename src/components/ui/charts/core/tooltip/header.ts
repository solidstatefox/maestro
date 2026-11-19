import type { StyleObject } from "../style";

/** The header's class (styles.css has none: the look is the inline style, so a reader's `class` / utility classes override it). */
export const TOOLTIP_HEADER_CLASS = "bkm-tt-header";

export const TOOLTIP_HEADER_STYLE: StyleObject = {
  "border-bottom": "1px solid var(--border)",
  padding: "10px 14px",
  "text-align": "left",
  "font-size": "14px",
  "line-height": "20px",
  "font-weight": 500,
  color: "var(--chart-tooltip-foreground, var(--popover-foreground))",
};

/** The header's class with the reader's. */
export const tooltipHeaderClass = (className: string | undefined): string => (className ? `${TOOLTIP_HEADER_CLASS} ${className}` : TOOLTIP_HEADER_CLASS);
