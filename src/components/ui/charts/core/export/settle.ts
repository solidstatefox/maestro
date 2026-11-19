const SETTLE_LIMIT_MS = 2000;

const frame = (view: Window): Promise<void> =>
  new Promise((resolve) => {
    view.requestAnimationFrame(() => {
      resolve();
    });
  });

const sleep = (view: Window, ms: number): Promise<void> =>
  new Promise((resolve) => {
    view.setTimeout(resolve, ms);
  });

/** Leaves what the pointer hovers in `root`: `pointerleave` and `mouseleave` on each hovered element, `pointerout`/`mouseout` on the deepest. */
const leave = (root: Element): boolean => {
  const hovered = [...root.querySelectorAll(":hover")];
  if (root.matches(":hover")) {
    hovered.unshift(root);
  }
  // A hovered button of the export (`ChartExportButton` in the card's header) isn't the chart: only a hovered chart is left.
  const charts = hovered.filter((element) => element.matches("svg, .ts-chart-host, .ts-chart-host *, [data-bkm-spark], [data-bkm-spark] *"));
  if (charts.length === 0) {
    return false;
  }
  const init = { bubbles: false, clientX: -1, clientY: -1, pointerType: "mouse", isPrimary: true, relatedTarget: root.ownerDocument.body };
  const deepest = charts.at(-1) as Element;
  deepest.dispatchEvent(new PointerEvent("pointerout", { ...init, bubbles: true }));
  deepest.dispatchEvent(new MouseEvent("mouseout", { ...init, bubbles: true }));
  for (const element of [...charts].reverse()) {
    element.dispatchEvent(new PointerEvent("pointerleave", init));
    element.dispatchEvent(new MouseEvent("mouseleave", init));
  }
  return true;
};

/** Brings `root`'s charts to rest: hover and focus left, finite animations finished (or `SETTLE_LIMIT_MS` passed). */
export async function settleChart(root: Element): Promise<void> {
  const view = root.ownerDocument.defaultView;
  if (view === null) {
    return;
  }
  const active = root.ownerDocument.activeElement;
  let moved = false;
  // A chart focused from the keyboard (its svg, its host); never a control (the export's own button keeps its focus).
  if (active !== null && active !== root.ownerDocument.body && root.contains(active) && active.closest("button, a, input, select, textarea, [data-bkm-export-skip]") === null) {
    (active as HTMLElement).blur();
    moved = true;
  }
  moved = leave(root) || moved;
  if (moved) {
    // The families clear their hover on the next frame (their loops), and only then start the transitions that fade it out.
    await frame(view);
    await frame(view);
  }
  const running = root.getAnimations({ subtree: true }).filter((animation) => {
    const end = animation.effect?.getComputedTiming().endTime;
    return animation.playState === "running" && typeof end === "number" && Number.isFinite(end);
  });
  if (running.length > 0) {
    await Promise.race([Promise.allSettled(running.map((animation) => animation.finished)), sleep(view, SETTLE_LIMIT_MS)]);
  }
  await frame(view);
}
