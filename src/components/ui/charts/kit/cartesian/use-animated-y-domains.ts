"use client";
// bklit useAnimatedYDomains on React: core/cartesian/animated-y-domains.ts tweens; the hook feeds it each commit's options and reads it.
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { animatedYDomainsFor, createAnimatedYDomains } from "../../core/cartesian/animated-y-domains";
import type { UseAnimatedYDomainsOptions } from "../../core/cartesian/animated-y-domains";
import type { YDomain } from "../../core/cartesian/y-domain-utils";

/**
 * The y domain per axis a custom time-series chart draws with: the skeleton's while loading, the target's once ready, tweened over
 * `durationMs` (bklit's pulse ease) through the grid-tween phases, and on target changes while ready with `tweenOnTargetChange`. A change
 * that does not tween lands in the same render.
 */
export function useAnimatedYDomains(options: UseAnimatedYDomainsOptions): Record<string, YDomain> {
  const [store] = useState(() => createAnimatedYDomains(options));
  useLayoutEffect(() => {
    store.update(options);
  });
  useEffect(() => store.destroy, [store]);
  const animated = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { ...animatedYDomainsFor(options, animated) };
}
