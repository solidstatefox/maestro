import type { ChartTooltipBodyContext, ChartTooltipBodyTarget } from "@tanstack/charts";
import { sameValue } from "../guards";
import { writable } from "../store";
import type { Readable } from "../store";

/** Where the tooltip body goes (the renderer's tooltip element) and what it shows. */
export interface TooltipTarget {
  readonly element: HTMLElement;
  readonly body: ChartTooltipBodyContext;
}

/** When two reported targets show the same body (the store keeps the first). */
export type TooltipEqual = (a: ChartTooltipBodyTarget, b: ChartTooltipBodyTarget) => boolean;

type TargetPoint = ChartTooltipBodyTarget["points"][number];

const POINT_FIELDS = ["key", "datumIndex", "datum", "x", "y", "yValue", "xValue"] as const;

const samePoint = (p: TargetPoint, q: TargetPoint): boolean => p === q || POINT_FIELDS.every((field) => p[field] === q[field]);

const samePoints = (a: ChartTooltipBodyTarget["points"], b: ChartTooltipBodyTarget["points"]): boolean => a === b || (a.length === b.length && a.every((p, i) => samePoint(p, b[i])));

const samePrimary = (a: ChartTooltipBodyTarget, b: ChartTooltipBodyTarget): boolean => a.primaryPoint?.key === b.primaryPoint?.key && a.primaryPoint?.datumIndex === b.primaryPoint?.datumIndex;

/** The default equality: same element, pin, primary point and points. */
const sameTarget: TooltipEqual = (a, b) => a.element === b.element && a.pinned === b.pinned && samePrimary(a, b) && samePoints(a.points, b.points);

/** Opt-in equality for bodies that depend only on the hovered x and per-series values (bar, composed): moving between bars of one category changes the primary point
 * but not what the body shows. Same host element, same x, same series values (any order). */
export const sameCategoryTarget: TooltipEqual = (a, b) => {
  if (a.element !== b.element || a.pinned !== b.pinned || a.points.length !== b.points.length) {
    return false;
  }
  return a.points.every((p) => b.points.some((q) => q.key === p.key && sameValue(q.xValue, p.xValue) && sameValue(q.yValue, p.yValue) && q.datum === p.datum));
};

/** The hovered tooltip target, deduped by `equal`. */
export interface TooltipTargetStore extends Readable<TooltipTarget | null> {
  /** Stable; pass as the renderer's `onTooltipBodyChange`. */
  readonly onChange: (target: ChartTooltipBodyTarget | null) => void;
}

export const tooltipTargetStore = (equal: TooltipEqual = sameTarget): TooltipTargetStore => {
  const store = writable<TooltipTarget | null>(null);
  let reported: ChartTooltipBodyTarget | null = null;
  return {
    get: store.get,
    subscribe: store.subscribe,
    onChange: (next) => {
      if (next === reported || (next !== null && reported !== null && equal(next, reported))) {
        return;
      }
      reported = next;
      if (next === null) {
        store.set(null);
        return;
      }
      const { element, ...body } = next;
      store.set({ element, body });
    },
  };
};
