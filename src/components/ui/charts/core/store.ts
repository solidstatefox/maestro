export interface Readable<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/** A `Readable` its owner sets. */
export interface Writable<T> extends Readable<T> {
  set(next: T): void;
}

/** A store holding `initial`; `set` notifies only when the value changes (`Object.is`), each listener once, in subscription order. */
export function writable<T>(initial: T): Writable<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) {
        return;
      }
      value = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The read half of a store, for handing out without `set`. */
export const readonly = <T>(store: Readable<T>): Readable<T> => ({ get: store.get, subscribe: store.subscribe });

/**
 * A value built on first read and held until `invalidate()`, which drops it and notifies: for state costly to build that a reader may
 * never ask for (a chart's `useChart()` context).
 */
export function lazyStore<T>(build: () => T): Readable<T> & { invalidate(): void } {
  let built = false;
  let value: T | undefined;
  const listeners = new Set<() => void>();
  return {
    get() {
      if (!built) {
        value = build();
        built = true;
      }
      // SAFETY: `built` is set right after `value` is assigned from `build()`, so `value` holds a T here.
      return value as T;
    },
    invalidate() {
      built = false;
      value = undefined;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
