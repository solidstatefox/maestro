import { useSyncExternalStore } from "react";
import { prefersReducedMotion, subscribeReducedMotion } from "../../core/loading/reduced-motion";

export const usePrefersReducedMotion = (): boolean =>
  useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );
