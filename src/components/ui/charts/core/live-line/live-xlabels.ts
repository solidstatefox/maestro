import type { ChartControl } from "@tanstack/charts";
import { LABEL_POOL } from "./head-ease";

export interface LiveXLabelsOptions {
  readonly id: string;
  /** Slot times (ms) at the start of the roll: slot i sits at the scale position of its end-of-roll time (times[i] + rollMs), which never moves. */
  readonly times: readonly number[];
  /** The roll's length: the labels' clock advances this far over it. */
  readonly rollMs: number;
  /** Gap between the plot bottom and the label box (the axis padding it replaces). */
  readonly padding: number;
  readonly fontSize: number;
  readonly format: (time: number) => string;
}

/** The last commit step a slot's text walks to (live-steps.ts): the badge's span (head-ease.ts LABEL_POOL); a tick restarts it. */
export const X_LABEL_STEPS = LABEL_POOL - 1;

export function liveXLabels(options: LiveXLabelsOptions): ChartControl<Date, number> {
  const { id, times, rollMs, padding, fontSize, format } = options;
  return {
    id,
    resolve: ({ scales, chart }) => {
      const {x} = scales;
      const children = times.flatMap((time) => {
        const at = x.map(new Date(time + rollMs));
        if (!Number.isFinite(at)) {
          return [];
        }
        return [{
          kind: "label" as const,
          // Unkeyed, matched by position: no per-node motion lookup.
          key: "",
          className: "bkm-live-xlabel",
          x: at,
          y: chart.y + chart.height + padding + fontSize * 0.8,
          text: format(time),
          anchor: "middle" as const,
          fontSize,
          style: { fill: "var(--chart-label)", fillOpacity: 1 },
        }];
      });
      // Classed so the focus x (`--bkm-fx`, not inherited) reaches the labels through this group alone (live-tick-fade.ts FOCUS_VARS_CSS).
      return { nodes: [{ kind: "group", key: id, className: "bkm-live-xlabels", ariaHidden: true, children }] };
    },
  };
}
