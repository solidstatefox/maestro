import { CLS, keyIs, keyStarts } from "../renderer-dom";

/** The classes, each `undefined` when not set. */
export interface HeatmapLabelClasses {
  readonly x: string | undefined;
  readonly y: string | undefined;
  readonly separatorLabel: string | undefined;
  readonly separatorLine: string | undefined;
}

const TARGETS: readonly (readonly [keyof HeatmapLabelClasses, string])[] = [
  ["x", `text${keyStarts("x-tick-label:")}`],
  ["y", `text${keyStarts("y-tick-label:")}`],
  ["separatorLabel", `${CLS.text}${keyIs("heatmap-separator-labels")} > text`],
  ["separatorLine", `${CLS.link}${keyIs("heatmap-separators")} > *`],
];

/** The tokens this layer added to each element, so a changed class drops the old tokens. */
const added = /* @__PURE__ */ new WeakMap<Element, readonly string[]>();

const tokensOf = (value: string | undefined): readonly string[] => (value === undefined ? [] : value.split(/\s+/u).filter((token) => token.length > 0));

/** Puts `classes` on the labels and lines drawn in `surface` (and takes earlier ones off). */
export const applyHeatmapLabelClasses = (surface: HTMLElement, classes: HeatmapLabelClasses | null, previous: HeatmapLabelClasses | null): void => {
  for (const [field, selector] of TARGETS) {
    const tokens = tokensOf(classes?.[field]);
    if (tokens.length === 0 && previous?.[field] === undefined) {continue;}
    for (const el of surface.querySelectorAll(selector)) {
      const before = added.get(el);
      if (before !== undefined && before.length > 0) {el.classList.remove(...before);}
      if (tokens.length > 0) {el.classList.add(...tokens);}
      added.set(el, tokens);
    }
  }
};
