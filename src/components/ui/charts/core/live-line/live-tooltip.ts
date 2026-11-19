import { memoCell } from "../memo";
import type { TooltipEqual } from "../surface/tooltip-target";
import type { ChartTooltipProps } from "../types/cartesian";
import type { TooltipRow } from "../types/tooltip";
import { liveRowOf } from "./definition";

/** bklit commits its live tooltip only when `liveTooltipKey` changes: cursor x and the line's y there, each rounded to a pixel (live-line-chart.tsx:219-227), checked once per frame (:403-421 via :271-284),
 * so the value text holds until the line moves a pixel. The tooltip body store takes a new target only when that key changes (kit's `tooltipEqual`), as bklit's `tooltipData` state does. */
export const liveTooltipEqual: TooltipEqual = (a, b) => {
  const p = a.points.at(0);
  const q = b.points.at(0);
  if (p === undefined || q === undefined || a.points.length !== b.points.length) {
    return false;
  }
  if (a.element !== b.element || a.pinned !== b.pinned) {
    return false;
  }
  return Math.round(p.x) === Math.round(q.x) && Math.round(p.y) === Math.round(q.y);
};

export interface LiveTooltipOptionsInput<Node> {
  readonly formatTime: (time: number) => string;
  readonly formatValue: (value: number) => string;
  readonly dataKey: string;
  /** The `LiveLine` `label`: the default row's name in place of the dataKey. */
  readonly label: string | undefined;
  readonly stroke: string;
  readonly tooltipCfg: ChartTooltipProps<Node, unknown> | undefined;
}

export interface LivePointArgs {
  readonly datum?: unknown;
  readonly yValue: unknown;
  readonly xValue: unknown;
}

/** The kit tooltip body's options: bklit's time title and value format, and the card's `rows` / `content` fed the focused x and its y. */
export interface LiveTooltipOptions<Node> {
  readonly title: (d: Date) => string;
  readonly format: (v: number) => string;
  readonly colors: Record<string, string>;
  readonly rows: ((rows: readonly TooltipRow[], point: LivePointArgs) => readonly TooltipRow[]) | undefined;
  readonly content: (({ point }: { point: LivePointArgs }) => Node | undefined) | undefined;
}

/** The point a card's `rows` / `content` receives: bklit's live tooltip point (`{ date, [dataKey]: value }`, live-line-chart.tsx:267) plus `time` (seconds) and `value`.
 * It is read from the focused x, not the datum reference: the datum can lag a roll behind while the x follows it. Exported for an adapter
 * whose `content` the options can't call (a Svelte snippet is rendered with `{@render}`, not called): it renders it with this point. */
export const livePoint = (point: LivePointArgs, key: string): Record<string, unknown> => {
  const row = liveRowOf(point);
  const t = point.xValue instanceof Date ? point.xValue.getTime() : (row?.t ?? 0);
  const v = typeof point.yValue === "number" ? point.yValue : 0;
  return { date: new Date(t), time: t / 1000, [key]: v, value: v };
};

/** One chart's tooltip body options: call it with the latest inputs on every render; the options keep their object until an input changes. */
export function createLiveTooltipOptions<Node>(): (input: LiveTooltipOptionsInput<Node>) => LiveTooltipOptions<Node> {
  const optionsCell = memoCell<LiveTooltipOptions<Node>>();
  return ({ formatTime, formatValue, dataKey: key, label, stroke: momentumStroke, tooltipCfg }) =>
    optionsCell([formatTime, formatValue, key, label, momentumStroke, tooltipCfg], () => ({
      title: (d: Date): string => formatTime(d.getTime()),
      format: (v: number): string => formatValue(v),
      colors: { [key]: momentumStroke },
      // bklit's ChartTooltip `rows(point)` replaces the default rows (chart-tooltip.tsx:364-365); the default row is named by its dataKey
      // (:376-379), which `label` (a kit addition, bklit's LiveLine has none) renames.
      rows: tooltipCfg?.rows
        ? (_rows: readonly TooltipRow[], point: LivePointArgs): readonly TooltipRow[] => tooltipCfg.rows?.(livePoint(point, key)) ?? []
        : label === undefined
          ? undefined
          : (rows: readonly TooltipRow[]): readonly TooltipRow[] => rows.map((row) => ({ ...row, label })),
      content: tooltipCfg?.content
        ? ({ point }: { point: LivePointArgs }): Node | undefined => tooltipCfg.content?.({ point: livePoint(point, key), index: 0 })
        : undefined,
    }));
}
