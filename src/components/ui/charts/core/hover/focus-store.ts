import { writable } from "../store";
import type { Writable } from "../store";

/** `set` is deduped by `index` (null/null is a no-op): subscribers hear only a real change. */
export type FocusStore<T extends { readonly index: number }> = Writable<T | null>;

export function createFocusStore<T extends { readonly index: number }>(): FocusStore<T> {
  const store = writable<T | null>(null);
  return {
    get: store.get,
    subscribe: store.subscribe,
    set: (next) => {
      const value = store.get();
      if (next && value && next.index === value.index) {
        return;
      }
      store.set(next);
    },
  };
}
