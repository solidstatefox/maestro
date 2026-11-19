import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { describeHierarchy } from "../a11y/describe";
import { isRecord } from "../guards";
import type { ChartA11yInput } from "../a11y/layer";
import type { SunburstNode } from "./arcs";

export const sunburstA11y = (data: SunburstNode, table: ChildTable): ChartA11yInput => ({
  describe: () => {
    const out = describeHierarchy({
      kind: "Sunburst chart",
      root: data,
      name: (n) => n.name,
      children: (n) => n.children,
      value: (n) => (n.children !== undefined && n.children.length > 0 ? null : (n.value ?? null)),
    });
    // A sector's id is its names joined with " / " (arcs.ts), the root's included or not; the rows' headers join them with " › ".
    const ids = out.rows.map((row) => row.header.replaceAll(" › ", " / "));
    const rowOf = (datum: unknown): number => {
      const record = isRecord(datum) ? datum : undefined;
      const inner = record !== undefined && isRecord(record.data) ? record.data : undefined;
      const id = record?.id ?? inner?.id;
      if (typeof id !== "string") {
        return -1;
      }
      const bare = id.startsWith(`${data.name} / `) ? id.slice(data.name.length + 3) : id;
      return ids.indexOf(bare);
    };
    return { ...out, rowOf };
  },
  dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0],
});
