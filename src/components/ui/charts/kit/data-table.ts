import { DATA_TABLE_ROLE } from "../core/a11y/data-table";
import type { ChartDataTableProps } from "../core/a11y/data-table";
import { defineCarrier } from "./role";

/**
 * The chart's data as a table: visually hidden for screen readers by default; `toggle` adds a "View as table" button that swaps the chart
 * for the table in its box; `open` shows it from a control of your own. Place it among the chart's children.
 */
export const ChartDataTable = /* @__PURE__ */ defineCarrier<ChartDataTableProps>(DATA_TABLE_ROLE, "ChartDataTable");
