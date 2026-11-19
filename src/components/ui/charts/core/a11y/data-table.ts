import type { ChartDescription } from "./describe";

/** The carrier's role in a chart's child table. */
export const DATA_TABLE_ROLE = "dataTable";

export interface ChartDataTableProps {
  /** A "View as table" button over the chart's top-end corner that swaps the chart for the table and back. Default: false (the table is
   * visually hidden and read by screen readers). */
  readonly toggle?: boolean;
  /** Controlled: the table shown in place of the chart (a toggle of your own drives it). */
  readonly open?: boolean;
  /** With `toggle`: the table shown first. Default: false. */
  readonly defaultOpen?: boolean;
  /** With `toggle`: called when the button opens or closes the table. */
  readonly onOpenChange?: (open: boolean) => void;
  /** The table's caption (visually hidden). Default: the chart's `ariaLabel`. */
  readonly caption?: string;
  /** The button's label while the chart shows. Default: "View as table". */
  readonly showLabel?: string;
  /** The button's label while the table shows. Default: "View as chart". */
  readonly hideLabel?: string;
  /** Classes on the table's panel (`.bkm-data-table`). */
  readonly className?: string;
}

const CLASS = "bkm-data-table";

/** Writes `description` as a `<table>` (caption, a header row, a row header per row) into `panel`, replacing what it held. */
export const writeDataTable = (panel: HTMLElement, description: ChartDescription, caption: string): void => {
  const doc = panel.ownerDocument;
  const table = doc.createElement("table");
  table.className = `${CLASS}__table`;
  const cap = doc.createElement("caption");
  cap.className = `${CLASS}__caption`;
  cap.textContent = caption;
  table.append(cap);
  const head = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  for (const column of description.columns) {
    const th = doc.createElement("th");
    th.scope = "col";
    th.textContent = column.label;
    if (column.numeric) {
      th.dataset.numeric = "";
    }
    headRow.append(th);
  }
  head.append(headRow);
  const body = doc.createElement("tbody");
  for (const row of description.rows) {
    const tr = doc.createElement("tr");
    const th = doc.createElement("th");
    th.scope = "row";
    th.textContent = row.header;
    tr.append(th);
    row.cells.forEach((cell, i) => {
      const td = doc.createElement("td");
      td.textContent = cell;
      if (description.columns[i + 1]?.numeric) {
        td.dataset.numeric = "";
      }
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(head, body);
  panel.replaceChildren(table);
};
