import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { createResizeBox } from "../../core/size/resize";
import type { ResizeBox } from "../../core/size/resize";

/** Content box of `ref`, rounded to whole pixels, `initial` until the first delivery (bklit's react-use-measure first hop). */
export const useResizeBox = (ref: RefObject<HTMLElement | null>, initial?: { readonly width: number; readonly height: number }, measureBeforePaint = false): ResizeBox => {
  const [store] = useState(() => createResizeBox(initial));
  // Copied into state, not read through useSyncExternalStore: an observer delivery commits on the default lane, after paint, where a store read would commit
  // synchronously before it.
  const [box, setBox] = useState(store.get);
  useLayoutEffect(() => store.subscribe(() => { setBox(store.get()); }), [store]);
  // Opt-in: the first box lands in the layout-effect commit, before first paint, not on the first observer delivery.
  useLayoutEffect(() => {
    const el = ref.current;
    if (measureBeforePaint && el) {
      store.measure(el);
    }
  }, [ref, measureBeforePaint, store]);
  useEffect(() => {
    const el = ref.current;
    return el ? store.observe(el) : undefined;
  }, [ref, store]);
  return box;
};
