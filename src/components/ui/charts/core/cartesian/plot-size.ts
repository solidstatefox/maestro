import type { ChartMargin } from "../theme";
import type { CartesianBuild } from "./definition";

/** The host size TanStack passed to `chart` (rounded) and the inner plot derived from it; `innerHeight` is unclamped (negative when the margins exceed the host). */
export interface PlotSize {
  readonly width: number;
  readonly height: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

export const ZERO_SIZE: PlotSize = { width: 0, height: 0, innerWidth: 0, innerHeight: 0 };

export const plotSizeOf = (width: number, height: number, margin: Readonly<ChartMargin>): PlotSize => {
  const w = Math.round(width);
  const h = Math.round(height);
  return { width: w, height: h, innerWidth: Math.max(0, w - margin.left - margin.right), innerHeight: h - margin.top - margin.bottom };
};

export interface PlotSnapshot {
  readonly built: CartesianBuild;
  readonly size: PlotSize;
}

export interface PlotStore {
  readonly get: () => PlotSnapshot | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly set: (next: PlotSnapshot) => void;
}

export function createPlotStore(): PlotStore {
  let value: PlotSnapshot | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
    set: (next) => {
      value = next;
      for (const listener of listeners) { listener(); }
    },
  };
}
