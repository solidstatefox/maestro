import { focusEmptyHiddenCss } from "./gate-css";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import { FOCUS_LAYERS, keyStarts } from "../renderer-dom";
import { NOT_MOTION } from "../renderer-dom";
import { bandClipId } from "../markup/band-clip";

/** Hover dim of every series (bklit SeriesHoverDim). */
export interface HoverDimRule {
  readonly select: string;
  readonly opacity: number;
  /** Series index (legend row) this rule belongs to, and the opacity it takes while another legend row is hovered. */
  readonly series?: number;
  readonly legendOpacity?: number;
  /** Point-marker rule (bklit SeriesMarkersDimWrapper): `opacity` and `blur` (px) apply on chart hover and on legend dim; `enterBlur` is the entrance blur, `animate` false drops the entrance. */
  readonly marker?: { readonly opacity: number; readonly blur: number; readonly enterBlur: number; readonly animate: boolean };
}
/** ProfitLossLine legend emphasis: a single-sign line dims by group opacity, a mixed line fades the other sign's gradient stops. */
export type ProfitLossRule =
  | { readonly kind: "dim"; readonly select: string; readonly sign: 0 | 1 }
  | { readonly kind: "stops"; readonly gradient: string };
export interface HoverHighlight {
  readonly select: string;
  /** Rows either side of the focus the band covers (`highlight.span`, default 1): a wider span has its own band. */
  readonly span?: number;
  /** Soft ends, % of the band per side (`highlight.fadeLength`): masked instead of clipped. */
  readonly fade?: number;
}
/** A static rule for one mark, emitted as `${scope} ${select}{${css}}`. */
export interface ScopedStyle {
  readonly select: string;
  readonly css: string;
}
export interface HoverVisuals {
  readonly dim: readonly HoverDimRule[];
  readonly highlights: readonly HoverHighlight[];
  readonly pl: readonly ProfitLossRule[];
  /** Row x values (ms) the highlight band is cut from (one row either side of the focus). */
  readonly times: readonly number[];
  /** Per row (aligned with `times`): the ProfitLossLine sign at that row, 0 profit / 1 loss, null without one. bklit dims the other sign on chart hover too. */
  readonly plSigns: readonly (0 | 1 | null)[];
  /** Segment* children present: the left plot margin the drag rules are translated from (px), else null. */
  readonly segmentLeft: number | null;
  /** Id of the owned `<clipPath>` (core/markup/band-clip.ts `highlightBandClip`) the highlight paths are clipped by. */
  readonly bandClip: string;
  /** Static per-mark rules (series-marks.ts: a glow's blur, an area's own fade mask). */
  readonly styles?: readonly ScopedStyle[];
  /** The highlights' wider spans (> 1), each a band the hover springs (core/hover/host-sync.ts `spans`). */
  readonly spans?: readonly number[];
}

/** Splits a selector list on its top-level commas (commas inside `:not(...)` / `[...]` stay). */
function splitTopLevel(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < select.length; i += 1) {
    const ch = select[i];
    if (ch === "(" || ch === "[") {
      depth += 1;
    }
    if (ch === ")" || ch === "]") {
      depth -= 1;
    }
    if (ch === "," && depth === 0) {
      parts.push(select.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(select.slice(start).trim());
  return parts.filter(Boolean);
}

const bandOf = (v0: string, v1: string): string => `polygon(calc(var(${v0},0) * 1px) -100%,calc(var(${v1},0) * 1px) -100%,calc(var(${v1},0) * 1px) 200%,calc(var(${v0},0) * 1px) 200%) view-box`;

// Pointer inside the chart but focus resolved to nothing (margins, axes): bklit unmounts the crosshair and dots at once while the native focus layers play their exit; the tooltip hides at once natively
// (kit/tooltip/bklit-tooltip.ts); leaving the chart fades in styles.css. Only renderer classes reach the layers (gap #36).
const focusHiddenRule = (scope: string): string =>
  focusEmptyHiddenCss(scope, ":not([data-bkm-hover]):not([data-bkm-drag])", FOCUS_LAYERS);

type MarkerDimRule = HoverDimRule & { readonly marker: NonNullable<HoverDimRule["marker"]> };

// Unlike the series dim: no transition here (styles.css owns the marker one), and it is off while a press or a ChartMarkers disc clears the hover.
function markerDimRules(scope: string, { select, marker }: MarkerDimRule): string[] {
  const filter = marker.blur > 0 ? `blur(${marker.blur}px)` : "none";
  const dimmed = `opacity:${marker.opacity};filter:${filter}`;
  const noAnimation = marker.animate ? "" : ";animation:none";
  return [
    `${scope}[data-bkm-hover]:not([data-bkm-evt], .bkm-evt:hover) ${select}{${dimmed}}`,
    `${scope}[data-bkm-hover][data-bkm-evt]:not(:has(.bkm-evt:hover)) ${select}{${dimmed}}`,
    `${scope} ${select}{--bkm-enter-blur:${marker.enterBlur}${noAnimation}}`,
  ];
}

function seriesDimRules(scope: string, on: string, dim: readonly HoverDimRule[]): string[] {
  return dim.flatMap((rule) => {
    if (rule.marker) {
      return markerDimRules(scope, { ...rule, marker: rule.marker });
    }
    // No fade on nodes with a live native track (it would chase the per-frame opacity writes); gap #36 (no class hook).
    const live = splitTopLevel(rule.select).map((part) => `${scope} ${part}${NOT_MOTION}`).join(",");
    // bklit fades over 0.4s easeInOut; the snappy variant on the hover profile.
    return [`${live}{transition:opacity ${HOVER_TRANSITION_CSS}}`, `${on} ${rule.select}{opacity:${rule.opacity}}`];
  });
}

// Legend dim: more specific than the chart-hover rule, so a legend-dimmed series keeps its legend opacity under hover.
function legendDimRules(scope: string, dim: readonly HoverDimRule[]): string[] {
  return dim.flatMap(({ series, legendOpacity, marker, select }) => {
    if (series === undefined || legendOpacity === undefined) {
      return [];
    }
    const blur = marker && marker.blur > 0 ? `;filter:blur(${marker.blur}px)` : "";
    return [`${scope}[data-bkm-legend]:not([data-bkm-legend="${series}"]) ${select}{opacity:${legendOpacity}${blur}}`];
  });
}

// bklit HighlightSegment: opacity 0 -> 1 over 0.4s easeInOut; its clip band is a velocity-keeping spring (HIGHLIGHT_SPRING: the snappy hover spring, bklit 180/28) that jumps on inactive -> active (use-highlight-segment.ts:48-57),
// driven by kit/motion/band-spring.ts through the owned clipPath rect (no host var: a per-frame var restyles the whole re-inherit chain). `--bkm-hl0/1` are written by the drag only, for the Segment* marks.
function highlightRules(scope: string, on: string, highlights: readonly HoverHighlight[], bandClip: string): string[] {
  // bklit unmounts the highlight on leave (no AnimatePresence): the fade (bklit 0.4s; the snappy variant's hover profile) is enter-only, so the transition lives on the active state.
  return highlights.flatMap((hl) => [
    `${scope} ${hl.select}{opacity:0;${(hl.fade ?? 0) > 0 ? "mask" : "clip-path"}:url(#${bandClipId(bandClip, hl.span ?? 1, hl.fade ?? 0)})}`,
    `${on} ${hl.select}{opacity:1}`,
    `${on} ${hl.select}${NOT_MOTION}{transition:opacity ${HOVER_TRANSITION_CSS}}`,
  ]);
}

const SEGMENT_EDGES = /* @__PURE__ */ keyStarts("segment-edge-");
const segmentKey = (id: string): string => keyStarts(`${id}:`);

// Segment* (bklit SegmentBackground / SegmentLineFrom / SegmentLineTo, drawn past 5px of drag) span the plot and sit still: the drag sync clips the band to --bkm-hl0/1 and translates each rule there,
// `data-bkm-segon` shows them; the band fades (bklit's motion.rect opacity over 0.15s; the snappy variant's hover profile), the rules mount and unmount with no transition.
function segmentRules(scope: string, segmentLeft: number): string[] {
  const band = bandOf("--bkm-hl0", "--bkm-hl1");
  const bandKey = segmentKey("segment-band");
  const shift = (v: string): string => `translateX(calc((var(${v},0) - ${segmentLeft}) * 1px))`;
  return [
    `${scope} ${bandKey}{opacity:0;clip-path:${band}}`,
    `${scope} ${bandKey}${NOT_MOTION}{transition:opacity ${HOVER_TRANSITION_CSS}}`,
    `${scope}[data-bkm-segon] ${bandKey}{opacity:1}`,
    `${scope} ${SEGMENT_EDGES}{opacity:0}`,
    `${scope}[data-bkm-segon] ${SEGMENT_EDGES}{opacity:1}`,
    `${scope} ${segmentKey("segment-edge-0")}{transform:${shift("--bkm-hl0")}}`,
    `${scope} ${segmentKey("segment-edge-1")}{transform:${shift("--bkm-hl1")}}`,
  ];
}

// ProfitLossLine: bklit fades the other sign to 0.25 over 0.2s easeInOut (the snappy variant: the hover profile), driven by the legend hover (data-bkm-pl) and,
// without one, by the sign of the focused point (data-bkm-plf, written by the focus sync).
const within = (roots: readonly string[], tail: string): string => roots.map((root) => `${root} ${tail}`).join(",");

function profitLossRules(scope: string, pl: readonly ProfitLossRule[]): string[] {
  const hovering = (sign: 0 | 1): string[] => [`${scope}[data-bkm-pl="${sign}"]`, `${scope}[data-bkm-plf="${sign}"]:not([data-bkm-pl])`];
  return pl.flatMap((rule) => {
    if (rule.kind === "dim") {
      const off = hovering(rule.sign === 0 ? 1 : 0);
      const live = `${rule.select}${NOT_MOTION}`;
      return [`${within(off, live)}{transition:opacity ${HOVER_TRANSITION_CSS}}`, `${within(off, rule.select)}{opacity:.25}`];
    }
    // Mixed-sign line: one gradient (stops 1-2 positive, 3-4 negative). The renderer prefixes ids, so match the suffix.
    // `stop-opacity` is a CSS property, so the fade bklit plays between the two signs' paths runs on the stops.
    const g = `linearGradient[id$="${rule.gradient}"] stop`;
    const positiveStops = `${g}:nth-child(n+3)`;
    const negativeStops = `${g}:nth-child(-n+2)`;
    return [
      `${scope} ${g}{transition:stop-opacity ${HOVER_TRANSITION_CSS}}`,
      `${within(hovering(0), positiveStops)}{stop-opacity:.25}`,
      `${within(hovering(1), negativeStops)}{stop-opacity:.25}`,
    ];
  });
}

/** Fixed-text CSS for the cartesian hover visuals, keyed on host attributes (`data-bkm-hover/-drag/-settle/-legend/-pl`) and `--bkm-hl0/1`; it changes only with the definition.
 * Selectors from kit/renderer-dom.ts address marks by mark id. Reads only. */
export function hoverStaticCss(scope: string, hover: HoverVisuals): string {
  // bklit SeriesHoverDim / HighlightSegment run on `tooltipData !== null || selection.active`: a hovered or a dragged chart.
  const on = `${scope}:is([data-bkm-hover],[data-bkm-drag])`;
  return [
    focusHiddenRule(scope),
    ...seriesDimRules(scope, on, hover.dim),
    ...legendDimRules(scope, hover.dim),
    ...highlightRules(scope, on, hover.highlights, hover.bandClip),
    ...(hover.segmentLeft === null ? [] : segmentRules(scope, hover.segmentLeft)),
    ...profitLossRules(scope, hover.pl),
    ...(hover.styles ?? []).map(({ select, css }) => `${scope} ${select}{${css}}`),
  ].join("");
}
