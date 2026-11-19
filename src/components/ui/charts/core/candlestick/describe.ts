import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import { formatNumber, numberField, rangeText } from "../a11y/describe";
import type { ChartA11yInput } from "../a11y/layer";
import { describeRowsChart } from "../a11y/rows";

export const candlestickA11y = (data: readonly Readonly<Record<string, unknown>>[], xDataKey: string, table: ChildTable, loading = false): ChartA11yInput => ({
  describe: () => {
    const out = describeRowsChart({
      kind: "Candlestick chart",
      unit: "candles",
      data,
      xKey: xDataKey,
      dates: true,
      loading,
      series: ["open", "high", "low", "close"].map((key) => ({ key })),
    });
    if (loading || data.length === 0) {
      return out;
    }
    const closes = data.map((row) => numberField(row, "close")).filter((v): v is number => v !== null);
    const lows = data.map((row) => numberField(row, "low") ?? Number.NaN);
    const highs = data.map((row) => numberField(row, "high") ?? Number.NaN);
    const range = rangeText([...lows, ...highs]);
    const first = out.rows[0]?.header ?? "";
    const last = out.rows.at(-1)?.header ?? "";
    const summary = `Candlestick chart, ${formatNumber(data.length)} candles from ${first} to ${last}, closing from ${formatNumber(closes[0] ?? 0)} to ${formatNumber(closes.at(-1) ?? 0)}, trading ${range}.`;
    return { ...out, summary };
  },
  dataTable: propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0],
});
