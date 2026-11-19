const QUERY = "(prefers-reduced-motion: reduce)";

/** The current preference; read it once per frame or render, not per node. */
export const prefersReducedMotion = (): boolean => {
  if (typeof window === "undefined") { return false; }
  return window.matchMedia(QUERY).matches;
};

/** Calls `notify` whenever the preference changes; returns the unsubscribe. */
export const subscribeReducedMotion = (notify: () => void): (() => void) => {
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", notify);
  return () => {
    list.removeEventListener("change", notify);
  };
};
