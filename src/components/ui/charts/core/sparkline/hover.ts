import type { Readable } from "../store";

/** What a sparkline last reported. */
export interface SparklineHoverState<T> {
  readonly index: number | null;
  readonly datum: T | null;
}

export interface SparklineHoverStore<T> extends Readable<SparklineHoverState<T>> {
  /** Spread (with `hoverIndex`) onto one sparkline, or several to sync their crosshairs. */
  readonly onHoverChange: (index: number | null, datum: T | null) => void;
}

const IDLE: SparklineHoverState<never> = { index: null, datum: null };

export function createSparklineHoverStore<T>(): SparklineHoverStore<T> {
  let state: SparklineHoverState<T> = IDLE;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onHoverChange(index, datum) {
      if (index === state.index && datum === state.datum) {
        return;
      }
      state = { index, datum };
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
