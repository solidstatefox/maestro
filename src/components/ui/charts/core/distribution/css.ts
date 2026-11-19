import { REVEAL_CSS_EASE } from "../motion/easing";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import { MASK_MIRROR_ATTR } from "../surface/svg-css-mask";
import { CONCEAL_CLASS } from "./conceal";
import { SKELETON_CLASS } from "./skeleton";

/** Index rules past this many items are left out: no stagger and no hover dim beyond it (the hovered item is still told by the tooltip). */
export const MAX_ITEM_RULES = 400;

/** The item class of index `k` (a bin, a category, an observation): the hover dims key on it. */
export const itemClass = (k: number): string => `bkm-d-i${k}`;
/** The stagger class of index `k`: its entrance starts `k` steps in. */
export const staggerClass = (k: number): string => `bkm-d-k${k}`;
/** The series class of index `n`. */
export const seriesClass = (n: number): string => `bkm-d-s${n}`;

export type EnterKind = "grow" | "growx" | "pop" | "wipe" | "rise" | "fade" | "unfoldy" | "unfoldx";

/** A group's classes: its item and series, and its entrance when it animates. */
export const groupClass = (item: number | null, series: number | null, enter: EnterKind | null): string =>
  ["bkm-d-g", item === null ? "" : `bkm-d-i ${itemClass(item)}`, series === null ? "" : `bkm-d-s ${seriesClass(series)}`, enter === null ? "" : `bkm-d-enter bkm-d-${enter}${item === null ? "" : ` ${staggerClass(item)}`}`]
    .filter((part) => part !== "")
    .join(" ");

const KEYFRAMES = /* @__PURE__ */ (() => [
  "@keyframes bkm-d-grow{from{transform:scaleY(0)}}",
  "@keyframes bkm-d-growx{from{transform:scaleX(0)}}",
  "@keyframes bkm-d-pop{from{transform:scale(0);opacity:0}}",
  "@keyframes bkm-d-wipe{from{clip-path:inset(-20px 100% -20px -20px)}to{clip-path:inset(-20px 0 -20px -20px)}}",
  "@keyframes bkm-d-rise{from{transform:translateY(12px) scaleY(0.2);opacity:0}}",
  "@keyframes bkm-d-fade{from{opacity:0}}",
  "@keyframes bkm-d-unfoldy{from{transform:scaleY(0);opacity:0}}",
  "@keyframes bkm-d-unfoldx{from{transform:scaleX(0);opacity:0}}",
  "@keyframes bkm-d-sk{from{-webkit-mask-position:100% 0;mask-position:100% 0}to{-webkit-mask-position:0 0;mask-position:0 0}}",
].join(""))();

/** The skeleton's shimmer band: the shapes rest at a third of their ink and light up as it passes, on a slight slant. */
const SKELETON_MASK = "linear-gradient(105deg,rgba(0,0,0,.34) 0 38%,#000 50%,rgba(0,0,0,.34) 62% 100%)";
/** One pass of the band, as the loading grid's (styles.css `--bkm-loading-shimmer-duration`). */
const SKELETON_SWEEP_S = 2.2;

export interface DistributionCssInput {
  readonly uid: string;
  /** How many items the marks drew (bins, categories, observations). */
  readonly items: number;
  /** Each series' faded opacity, in order. */
  readonly faded: readonly number[];
  /** The entrance's duration (ms) and the delay between consecutive items (ms). */
  readonly enterMs: number;
  readonly staggerMs: number;
  /**
   * While an item is hovered: `"index"` dims the others by one rule per item (`data-hover` is the item's index), `"all"` dims every item
   * by one rule and the overlay redraws the hovered one on top (`data-hover` keeps one value: moving between items restyles nothing; for
   * hundreds of items, where per-item rules cost a style pass each move), `false` leaves them.
   */
  readonly dimItems: "index" | "all" | false;
  /** The items are the drawn shapes themselves (a beeswarm's dots), not groups: they dim and transition themselves. */
  readonly dimSelf?: boolean;
}

/** The chart's owned stylesheet. */
export function distributionCss({ uid, items, faded, enterMs, staggerMs, dimItems, dimSelf = false }: DistributionCssInput): string {
  const s = `[data-bkm-d="${uid}"]`;
  // A group's dimmed parts are its series' shapes (`.bkm-d-s`): a keyed rightmost compound keeps the rules off every other element.
  const inner = dimSelf ? "" : ">.bkm-d-s";
  const rules: string[] = [
    KEYFRAMES,
    `${s}{--bkm-d-ms:${Math.max(0, enterMs)}ms;--bkm-d-stagger:${Math.max(0, staggerMs)}ms}`,
    `${s} .bkm-d-g${inner}{transition:opacity ${HOVER_TRANSITION_CSS}}`,
    `${s} .bkm-d-enter{transform-box:fill-box;animation:var(--bkm-d-kf) var(--bkm-d-ms) ${REVEAL_CSS_EASE} backwards;animation-delay:calc(var(--bkm-d-k,0) * var(--bkm-d-stagger))}`,
    `${s} .bkm-d-grow{--bkm-d-kf:bkm-d-grow;transform-origin:50% 100%}`,
    `${s} .bkm-d-growx{--bkm-d-kf:bkm-d-growx;transform-origin:0 50%}`,
    `${s} .bkm-d-pop{--bkm-d-kf:bkm-d-pop;transform-origin:50% 50%}`,
    `${s} .bkm-d-wipe{--bkm-d-kf:bkm-d-wipe}`,
    `${s} .bkm-d-rise{--bkm-d-kf:bkm-d-rise;transform-origin:50% 100%}`,
    `${s} .bkm-d-fade{--bkm-d-kf:bkm-d-fade}`,
    `${s} .bkm-d-unfoldy{--bkm-d-kf:bkm-d-unfoldy;transform-origin:50% 50%}`,
    `${s} .bkm-d-unfoldx{--bkm-d-kf:bkm-d-unfoldx;transform-origin:50% 50%}`,
    `${s}[data-bkm-static] .bkm-d-enter{animation:none}`,
    // The crosshair overlay (overlay.ts): bklit's 1px rule and TooltipDots, shown while a point is focused.
    `${s} .bkm-d-ov{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;visibility:hidden}`,
    `${s} .bkm-d-ov[data-on]{visibility:visible}`,
    `${s} .bkm-d-ov-rule{stroke:var(--chart-crosshair);stroke-width:1}`,
    `${s} .bkm-d-ov-dot{stroke:var(--chart-background);stroke-width:2}`,
    `@media (prefers-reduced-motion:reduce){${s} .bkm-d-enter{animation:none}}`,
    // Loading: no hover, the skeleton's shimmer, the conceal layer over the plot.
    `${s}[data-bkm-status="loading"] .ts-chart-host{pointer-events:none}`,
    `${s} .${SKELETON_CLASS}{-webkit-mask-image:${SKELETON_MASK};mask-image:${SKELETON_MASK};-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:300% 100%;mask-size:300% 100%;animation:bkm-d-sk ${SKELETON_SWEEP_S}s linear infinite}`,
    `${s}[data-bkm-static] .${SKELETON_CLASS}{animation:none}`,
    // An engine whose CSS masks on SVG content the surface mirrors (surface/svg-css-mask.ts) can't run the band: the skeleton rests, as reduced motion has it.
    `${s} [${MASK_MIRROR_ATTR}] .${SKELETON_CLASS}{animation:none;-webkit-mask-image:none;mask-image:none;opacity:.55}`,
    `@media (prefers-reduced-motion:reduce){${s} .${SKELETON_CLASS}{animation:none;-webkit-mask-image:none;mask-image:none;opacity:.55}}`,
    `${s} .${CONCEAL_CLASS}{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}`,
  ];
  for (const [n, opacity] of faded.entries()) {
    rules.push(`${s} .${seriesClass(n)}{--bkm-d-faded:${opacity}}`);
    // A legend row (ChartLegendHoverProvider) dims the other series.
    rules.push(`${s}[data-bkm-legend="${n}"] .bkm-d-s:not(.${seriesClass(n)}){opacity:var(--bkm-d-faded,0.3)}`);
  }
  if (dimItems === "all") {
    rules.push(`${s}[data-hover] .bkm-d-i${inner}{opacity:var(--bkm-d-faded,0.3)}`);
  }
  const count = Math.min(items, MAX_ITEM_RULES);
  for (let k = 0; k < count; k += 1) {
    const item = itemClass(k);
    rules.push(k === 0 ? "" : `${s} .${staggerClass(k)}{--bkm-d-k:${k}}`);
    if (dimItems === "index") {
      rules.push(`${s}[data-hover="${k}"] .bkm-d-i:not(.${item})${inner}{opacity:var(--bkm-d-faded,0.3)}`);
    }
  }
  return rules.join("");
}
