const MAX_RESOLVE_DELAY_MS = 40;

/** motion-dom `frameloop/batcher.mjs`: the first frame after the loop wakes advances by this. */
const MOTION_FIRST_FRAME_MS = 1000 / 60;

type EntranceOrigin = "frame" | "motion";

/** Resolves motion's two entrance clocks in the first rAF after the call: `frame` for a WAAPI-backed value, `motion` for a JS-driven one (see the header).
 * `createdAt` is motion's creation clock. Returns the cancel function. */
const resolveEntranceOrigins = (createdAt: number | "frame", onResolved: (clocks: Readonly<Record<EntranceOrigin, number>>) => void, resolveOnFrame = false): (() => void) => {
  // Resolves motion's first-frame clock in one rAF (motion-dom AsyncMotionValueAnimation.mjs:20, see the header).
  const id = requestAnimationFrame((frameTime) => {
    // `resolveOnFrame`: judge staleness on the frame timestamp (motion's `resolvedAt` is the batch start); `performance.now()` runs after
    // bklit's own first batch (~25-40 ms on a production sunburst) and called a 12 ms-old creation stale about one run in four.
    const resolvedAt = resolveOnFrame ? frameTime : performance.now();
    const created = createdAt === "frame" ? frameTime : createdAt;
    const stamp = resolvedAt - created > MAX_RESOLVE_DELAY_MS ? resolvedAt : created;
    onResolved({ frame: stamp, motion: stamp + MOTION_FIRST_FRAME_MS });
  });
  return () => { cancelAnimationFrame(id); };
};

/** Call from a layout effect after the entrance DOM is committed; returns the cleanup. `origins` maps a CSS animation name to its origin. `createdAt` is motion's creation clock:
 * a `performance.now()` reading, or "frame" (the first rAF's timestamp) when bklit's counterpart is created well before the migrated commit. */
const alignEntranceStart = (host: HTMLElement | (() => HTMLElement | null), origins: Readonly<Record<string, EntranceOrigin>>, createdAt: number | "frame" = performance.now(), resolveOnFrame = false): (() => void) => {
  let second = 0;
  const cancelFirst = resolveEntranceOrigins(createdAt, (clocks) => {
    // Second frame: CSS animations exist after the style recalc (motion-dom AsyncMotionValueAnimation.mjs:20, see the header).
    second = requestAnimationFrame(() => {
      // Every read before any write: a CSS animation's timing is read from style, and each write (a fill, a start time) dirties it, so
      // interleaved they forced one style recalc per animation (a radar's ~40).
      const due: { readonly animation: Animation; readonly origin: EntranceOrigin; readonly fill: FillMode | undefined }[] = [];
      // oxlint-disable-next-line no-restricted-properties -- one subtree getAnimations() per alignment pass, never per element (AGENTS.md exception)
      for (const animation of (typeof host === "function" ? host() : host)?.getAnimations({ subtree: true }) ?? []) {
        const origin = animation instanceof CSSAnimation ? origins[animation.animationName] : undefined;
        if (origin !== undefined) { due.push({ animation, fill: animation.effect?.getTiming().fill, origin }); }
      }
      for (const { animation, fill, origin } of due) {
        // A stamp past the timeline's current time puts the animation in its before phase: hold keyframe 0 there, never the rest value.
        if (fill !== "backwards" && fill !== "both") { animation.effect?.updateTiming({ fill: fill === "forwards" ? "both" : "backwards" }); }
        animation.startTime = clocks[origin];
      }
    });
  }, resolveOnFrame);
  return () => { cancelFirst(); cancelAnimationFrame(second); };
};

export { alignEntranceStart, resolveEntranceOrigins };
export type { EntranceOrigin };
