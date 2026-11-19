import type { StyleObject } from "../style";
import type { GaugeLabelAlign, GaugeLabelPlacement } from "../types/gauge";

/** The stat's classes: the arc centre's box, value and caption, and the linear label's value and caption. */
export const GAUGE_STAT_CLASSES = {
  arc: { box: "ts-bkm-center-stat", label: "ts-bkm-center-stat-label", value: "ts-bkm-center-stat-value ts-bkm-gauge-arc-value" },
  linear: { label: "ts-bkm-gauge-linear-stat-label", value: "ts-bkm-gauge-linear-stat-value" },
} as const;

/** Arc centre: a square box tracking max(40% of the gauge size - 16px, 88px), sized with container query units. */
export const GAUGE_CENTER_STYLES: Readonly<Record<"outer" | "inner", StyleObject>> = {
  inner: { "align-items": "center", display: "flex", "flex-direction": "column", height: "max(88px, calc(40cqh - 16px))", "justify-content": "center", "text-align": "center", width: "max(88px, calc(40cqh - 16px))" },
  outer: { "align-items": "center", display: "flex", inset: 0, "justify-content": "center", "padding-top": "8cqh", "pointer-events": "none", position: "absolute" },
};

const ALIGN_ITEMS = { center: "center", end: "flex-end", start: "flex-start" } as const;
const TEXT_ALIGN = { center: "center", end: "right", start: "left" } as const;
const perAlign = (style: (align: GaugeLabelAlign) => StyleObject): Readonly<Record<GaugeLabelAlign, StyleObject>> => ({ center: style("center"), end: style("end"), start: style("start") });

/** The linear label stack (plain inherited typography), per alignment.
 * Accepted divergence: bklit's GaugeLabelShell is a size container (`@container size-full min-w-0`, gauge-label-layout.tsx:45-52) inside a
 * content-sized `self-*` / `shrink-0` wrapper. A container's inline size ignores its content, so the wrapper sizes to 0px: the NumberFlow value
 * overflows into view and the `truncate` caption is clipped to nothing. The linear stat reads no container units (its font size inherits, see
 * styles.css), so here it is a plain flex column and its caption shows. */
export const GAUGE_STAT_STYLES = /* @__PURE__ */ perAlign((align) => ({ "align-items": ALIGN_ITEMS[align], display: "flex", "flex-direction": "column", "min-width": 0, "text-align": TEXT_ALIGN[align] }));

/** The track's box when the gauge has no label. */
export const GAUGE_LABEL_FILL: StyleObject = { "min-width": 0, width: "100%" };
const TRACK_FILL: StyleObject = { flex: "1 1 0%", "min-width": 0 };
const LABEL_SHRINK: StyleObject = { "flex-shrink": 0 };
// bklit's top/bottom stack: `flex-col gap-3 items-*` (gauge-label-layout.tsx:107-135); left/right row: `items-center gap-4 justify-*` (:137-164).
const COLUMN_STYLES = /* @__PURE__ */ perAlign((align) => ({ "align-items": ALIGN_ITEMS[align], display: "flex", "flex-direction": "column", gap: "0.75rem", ...GAUGE_LABEL_FILL }));
const ROW_STYLES = /* @__PURE__ */ perAlign((align) => ({ "align-items": "center", display: "flex", "flex-direction": "row", gap: "1rem", "justify-content": ALIGN_ITEMS[align], ...GAUGE_LABEL_FILL }));
const LABEL_SELF_STYLES = /* @__PURE__ */ perAlign((align) => ({ "align-self": ALIGN_ITEMS[align] }));

/** A labelled linear gauge's three boxes and their order: the container, the label's box and the track's box. */
export interface GaugeLabelBoxes {
  readonly labelFirst: boolean;
  readonly container: StyleObject;
  readonly label: StyleObject;
  readonly track: StyleObject;
}

/** The boxes of a label at `placement`, aligned `align` (the same style objects on every call). */
export const gaugeLabelBoxes = (placement: GaugeLabelPlacement, align: GaugeLabelAlign): GaugeLabelBoxes => {
  const vertical = placement === "top" || placement === "bottom";
  return {
    container: vertical ? COLUMN_STYLES[align] : ROW_STYLES[align],
    label: vertical ? LABEL_SELF_STYLES[align] : LABEL_SHRINK,
    labelFirst: placement === "top" || placement === "left",
    track: vertical ? GAUGE_LABEL_FILL : TRACK_FILL,
  };
};

/** bklit's arc centre (PieCenterShell) paints 0, then swaps in the real value two frames later so NumberFlow rolls 0 -> value (pie-center-shell.tsx:59-61, nested requestAnimationFrame).
 * Only that first swap is deferred; later value changes pass straight through. Call it once the 0 is painted (React: a passive effect); `done` swaps
 * the value in. Returns the cancel function. */
export function scheduleStatIntro(done: () => void): () => void {
  let inner = 0;
  // Two frames, as pie-center-shell.tsx:59-60.
  const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => { done(); }); });
  return (): void => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
}
