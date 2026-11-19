import { useRef } from "react";
import type { RefObject } from "react";

/** `performance.now()` at the start of the chart component's latest render; the commit that mounts the entrance is the render after it,
 * so by its layout effect this holds that commit's start: the controller's `attach` aligns the entrance on it (its `renderStart`,
 * core/entrance/entrance-origin.ts `alignEntranceStart`). */
export const useRenderStart = (): RefObject<number> => {
  const start = useRef(0);
  start.current = performance.now();
  return start;
};
