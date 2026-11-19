import { createMark } from "@tanstack/charts";
import type { ChartBounds, ChartGradient, ChartMotionDefinition, ResolvedScale } from "@tanstack/charts";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import { shortDateFmt } from "../format";
import { fontContext, textWidth } from "../text-width";
import { typedAttr } from "../css-hooks";
import { HOVER_TRANSITION_CSS } from "../motion/springs";
import { CROSSHAIR_CLASS, NOT_MOTION, keyStarts } from "../renderer-dom";
import { clearAttribute, raiseAttribute } from "../host-write";

type Scales = Readonly<Record<string, ResolvedScale>>;
type CentreOf = (scales: Scales) => ((xValue: unknown) => number) | undefined;

// Null without a document or canvas (SSR): callers keep their own fallback, so text-width.ts's length-ratio `textWidth` fallback is not used.
const measurePill = (text: string): number | null =>
  typeof document === "undefined" ? null : (fontContext(14, 500, getComputedStyle(document.body).fontFamily)?.measureText(text).width ?? null);

/** Fixed pill layout measured once per definition (bklit's stacked date ticker): box width and the text centre offsets from the pill centre. */
export interface PillLayout {
  readonly width: number;
  /** Month text centre minus pill centre (px): the month is centred in a column as wide as the widest month. */
  readonly month?: number;
  /** Day text centre minus pill centre (px): the day is centred in a column as wide as the widest day. */
  readonly day?: number;
  /** One entry per run of consecutive equal month words (bklit's `monthSegments`): the rows of the month stack. */
  readonly months: readonly string[];
  /** Per label: the index of its month run (the month stack only moves when the run changes). */
  readonly monthOf: readonly number[];
  /** Per label: the day word (the rows of the day stack). */
  readonly days: readonly string[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** bklit's date ticker: 16px padding, a month column (widest month), a 4px gap, a day column (widest day), each text centred in its column.
 * Above 60 labels bklit uses a compact text-sized pill (null: one native label). The native box is widened to `width` by pillTickStaticCss. */
export function pillLayout(labels: readonly string[]): PillLayout | null {
  if (labels.length === 0 || labels.length > 60) {
    return null;
  }
  let month = 0;
  let day = 0;
  const months: string[] = [];
  const monthOf: number[] = [];
  const days: string[] = [];
  for (const label of labels) {
    const [m = "", d = ""] = label.split(" ");
    const mw = measurePill(m);
    const dw = measurePill(d);
    if (mw === null || dw === null) {
      return null;
    }
    month = Math.max(month, mw);
    day = Math.max(day, dw);
    if (months.length === 0 || months.at(-1) !== m) {
      months.push(m);
    }
    monthOf.push(months.length - 1);
    days.push(d);
  }
  return { width: Math.round((32 + month + 4 + day) * 10) / 10, month: round2(-2 - day / 2), day: round2(2 + month / 2), months, monthOf, days };
}

/** bklit's pill capsule: 16px padding each side of its text (date-ticker.tsx). */
const PILL_PADDING_X = 32;

/** The half-width (px) of the zone around the pill's centre where x tick labels are hidden, the `reachPx` of `pillTickStaticCss` minus its 12px: bklit's `tickerHalfWidth`,
 * widened to the pill's half-width plus the widest tick label's. Accepted divergence: bklit hides within a fixed `tickerHalfWidth` (x-axis.tsx), so a pill wider than about
 * 60px left a label it had not hidden half under its edge (an 80px "Oct 16" pill beside a 36px "Oct 18"). Without a canvas (SSR) it stays `tickerHalfWidth`. */
export function pillTickReach(tickerHalfWidth: number, layout: PillLayout | null, pillLabels: readonly string[], tickLabels: readonly string[]): number {
  if (typeof document === "undefined" || tickLabels.length === 0) {
    return tickerHalfWidth;
  }
  const family = getComputedStyle(document.body).fontFamily;
  let pillWidth = layout?.width ?? 0;
  if (!layout) {
    // Each distinct label once: a day's rows share one.
    for (const label of new Set(pillLabels)) {
      pillWidth = Math.max(pillWidth, (measurePill(label) ?? 0) + PILL_PADDING_X);
    }
  }
  let tickWidth = 0;
  for (const label of tickLabels) {
    tickWidth = Math.max(tickWidth, textWidth(label, 12, 400, family, 0.6));
  }
  return Math.max(tickerHalfWidth, Math.ceil(pillWidth / 2 + tickWidth / 2));
}

/** A focus-guide-only mark: `node` builds the guide's scene node at the focused x (`centre` swaps in a scale-derived x, e.g. a bar band's centre),
 * so hover never re-resolves the definition and the node glides with the guide motion. */
export function guideMark(options: {
  readonly id: string;
  readonly motion: unknown;
  readonly yScale?: string;
  readonly centre?: CentreOf;
  /** Which focused value the guide follows (default "x"). `centre` maps it to the position `node` receives as its first argument. */
  readonly by?: "x" | "y";
  readonly node: (x: number, chart: ChartBounds, xValue: unknown, scales: Scales) => unknown;
}): AnyMark {
  const { id } = options;
  const motion = erase(options.motion);
  return erase(
    createMark<unknown>(
      () => ({
        id,
        focusGuideOnly: true,
        channels: { x: { scale: "x", values: [] }, y: { scale: options.yScale ?? "y", values: [] } },
        render: ({ chart, surface, scales, layout: sceneLayout }) => {
          const centreOf = options.centre?.(scales);
          return {
            nodes: [],
            focusGuides: [
              {
                key: id,
                markId: id,
                chart,
                surface,
                motion,
                measureText: sceneLayout.measureText,
                direction: sceneLayout.typography?.direction,
                resolve: ({ focus, cursor }) => {
                  const value = options.by === "y" ? focus?.primary.yValue : focus?.primary.xValue;
                  const c = focus && centreOf ? centreOf(value) : undefined;
                  const fallback = options.by === "y" ? (focus?.primary.y ?? cursor?.y?.position) : (focus?.primary.x ?? cursor?.x?.position);
                  const x = c !== undefined && Number.isFinite(c) ? c : fallback;
                  if (x === undefined || !Number.isFinite(x)) {
                    return undefined;
                  }
                  // Callers build the node loosely typed; the scene compiler consumes it as a SceneNode.
                  return erase(options.node(x, chart, value, scales));
                },
              },
            ],
          };
        },
      }),
      motion,
    ),
  );
}

/** bklit's TooltipIndicator for time charts: a `width`-px rect filled with the vertical fade gradient (`paint` is its scoped url; focus-guide nodes are not paint-resolved).
 * A native crosshair rule is a zero-width line, which an objectBoundingBox gradient cannot paint; a rect antialiases like bklit's. */
export function crosshairGradient(id: string, color: string): ChartGradient {
  return { id, x1: 0, y1: 0, x2: 0, y2: 1, stops: [0, 0.1, 0.9, 1].map((offset) => ({ offset, color, opacity: offset === 0 || offset === 1 ? 0 : 1 })) };
}

export function crosshairRuleMark(options: { readonly id: string; readonly paint: string; readonly width: number; readonly motion: ChartMotionDefinition<never>; readonly yScale?: string; readonly centre?: CentreOf; readonly by?: "x" | "y"; readonly className?: string }): AnyMark {
  const { id, paint, width, className } = options;
  return guideMark({
    id,
    motion: options.motion,
    yScale: options.yScale,
    centre: options.centre,
    by: options.by,
    node: (x, chart) => ({
      kind: "group" as const,
      key: id,
      className: className === undefined ? CROSSHAIR_CLASS : `${CROSSHAIR_CLASS} ${className}`,
      ariaHidden: true,
      translateX: x,
      children: [{ kind: "rect" as const, key: `${id}:rule`, x: -width / 2, y: chart.y, width, height: chart.height, style: { fill: paint } }],
    }),
  });
}

/** Host attribute / CSS var the static pill rule is keyed on (charts with their own hover attribute pass distinct names). */
interface PillHostNames {
  readonly active: string;
  readonly fx: string;
  /** Prefix of the `0..PILL_SAME_MAX-1` vars holding the x of ticks that read like the focused date (bklit hides those too). */
  readonly same: string;
}
const DEFAULT_PILL_NAMES: PillHostNames = { active: "data-bkm-hover", fx: "--bkm-hx", same: "--bkm-same" };
/** For charts that already use `data-bkm-hover` / `--bkm-hx` for their own emphasis. */
export const OWN_PILL_NAMES: PillHostNames = { active: "data-bkm-pill", fx: "--bkm-pfx", same: "--bkm-psame" };

const PILL_SAME_MAX = 4;

/** Var holding the date pill's live x (svg px) while it springs (hover-overlay.ts writes it as it moves). The tick fade keys on it, so labels hide where the pill is,
 * not at the focused x the pill is still gliding to; charts whose pill is not drawn by the overlay fall back to the focus x.
 * Accepted divergence: bklit keys the fade on the focused row's x (x-axis.tsx:639, `tooltipData.x`); on a fast sweep that hid labels ahead of the pill, under the cursor. */
export const PILL_LIVE_X = "--bkm-pill-x";

/** The x tick labels `pillTickStaticCss` fades (gap #36: addressed by key prefix). */
const PILL_TICK_KEY = "x-tick-label:";

/** The pill tick fade's inputs per chart host (the pill's live x, the focus x, the same-label xs): what the x tick labels hold, or will once the next render lands. */
const tickVars = /* @__PURE__ */ new WeakMap<HTMLElement, Map<string, string>>();

const tickLabels = (host: HTMLElement): NodeListOf<SVGElement> => host.querySelectorAll<SVGElement>(`text${keyStarts(PILL_TICK_KEY)}`);

const writeLabelVar = (label: SVGElement, name: string, value: string | null): void => {
  const held = label.style.getPropertyValue(name);
  if (value === null) {
    if (held !== "") { label.style.removeProperty(name); }
  } else if (held !== value) {
    label.style.setProperty(name, value);
  }
};

/** Writes the pill tick fade's input `name` (null clears it) onto the x tick labels, the only elements that read it. On the host, each write restyled the host and the
 * whole re-inherit path down to the labels (styles.css) with every child of it: line-default 16 elements a move, where the labels take one each. `only` (a label's `x`)
 * narrows a write to the labels whose opacity it can change; the rest keep a value that gives them the same opacity. The labels are renderer-owned: a draw re-creates
 * them or strips their inline style (reconcile.ts `syncAttributes`), so each chart calls `refreshTickVars` once its render lands. */
export function writeTickVar(host: HTMLElement, name: string, value: string | null, only?: (x: number) => boolean): void {
  let held = tickVars.get(host);
  if (value === null) {
    if (!held?.delete(name)) {
      return;
    }
  } else {
    if (!held) {
      held = new Map();
      tickVars.set(host, held);
    }
    held.set(name, value);
  }
  for (const label of tickLabels(host)) {
    if (!only || only(Number(label.getAttribute("x")))) {
      writeLabelVar(label, name, value);
    }
  }
}

/** The value of the pill tick fade's input `name` last written for `host` (`writeTickVar`), "" when none is. */
export const readTickVar = (host: HTMLElement, name: string): string => tickVars.get(host)?.get(name) ?? "";

/** Re-writes every input the pill tick fade holds for `host` onto its x tick labels: after a render, which re-creates them or strips their inline style. */
export function refreshTickVars(host: HTMLElement | null | undefined): void {
  const held = host ? tickVars.get(host) : undefined;
  if (!host || !held || held.size === 0) {
    return;
  }
  for (const label of tickLabels(host)) {
    for (const [name, value] of held) {
      writeLabelVar(label, name, value);
    }
  }
}

/** bklit's XAxisLabel hides every tick whose label text equals the hovered row's label, whatever its distance. CSS cannot compare text,
 * so the labels carry the x (svg px) of those ticks and the static rule below zeroes the tick sitting on one. */
export function writePillSameLabel(host: HTMLElement, tickTimes: readonly number[], time: number, px: (t: number) => number, names: PillHostNames = DEFAULT_PILL_NAMES): void {
  const label = shortDateFmt.format(time);
  let n = 0;
  for (const t of tickTimes) {
    if (n < PILL_SAME_MAX && t !== time && shortDateFmt.format(t) === label) {
      writeTickVar(host, `${names.same}${n}`, px(t).toFixed(2));
      n += 1;
    }
  }
  for (; n < PILL_SAME_MAX; n += 1) {
    writeTickVar(host, `${names.same}${n}`, null);
  }
}

/** The focus x for a pill tick rule (`names.fx`), written only while no overlay pill holds its live x (`PILL_LIVE_X`, which the rule reads first): the overlay writes that
 * from the first focus on, so after it the focus x would be a write nothing reads. */
export function writePillFocusX(host: HTMLElement, name: string, x: number): void {
  if (readTickVar(host, PILL_LIVE_X) === "") {
    writeTickVar(host, name, x.toFixed(2));
  }
}

/** What `syncPillHost` last wrote per host: an identical focus (same time, ticks and geometry) has nothing left to write. */
interface PillApplied {
  readonly time: number;
  readonly ticks: PillTicks;
  readonly spanMs: number;
  readonly plotWidth: number;
}
const pillApplied = /* @__PURE__ */ new WeakMap<HTMLElement, PillApplied>();
const samePillFocus = (a: PillApplied | undefined, b: PillApplied): boolean =>
  a?.time === b.time && a.ticks === b.ticks && a.spanMs === b.spanMs && a.plotWidth === b.plotWidth;

/** Writes the focus x (svg px, from the ticks' `pillGeometry`) for `pillTickStaticCss` onto the x tick labels and its active attribute onto the host. */
export function syncPillHost(host: HTMLElement, tickTimes: PillTicks, spanMs: number, plotWidth: number, time: number | null, names: PillHostNames = OWN_PILL_NAMES): void {
  const geo = tickTimes.pillGeometry;
  if (time === null || !geo || spanMs <= 0) {
    pillApplied.delete(host);
    clearAttribute(host, names.active);
    return;
  }
  const next: PillApplied = { plotWidth, spanMs, ticks: tickTimes, time };
  // Pointer moves inside one point re-emit the same focus; the entry (`active` absent) always writes.
  if (samePillFocus(pillApplied.get(host), next) && host.hasAttribute(names.active)) {
    return;
  }
  pillApplied.set(host, next);
  const px = (t: number): number => geo.plotLeft + ((t - geo.domainStart) / spanMs) * plotWidth;
  writePillFocusX(host, names.fx, px(time));
  writePillSameLabel(host, tickTimes, time, px, names);
  raiseAttribute(host, names.active);
}

/** bklit x-axis.tsx: a tick's opacity ramps linearly over this many px past the hidden zone. */
const PILL_FADE_RAMP = 20;

/** Half-width (px) of the zone around the pill's live x where `pillTickStaticCss` hides a tick, before its ramp. */
export const pillFadeHalf = (reachPx: number): number => reachPx - 12;

/** Whether the pill's live x moving from `from` to `to` (svg px, as written to `--bkm-pill-x`) can change the opacity `pillTickStaticCss` gives the tick at `x` (its label's
 * `x` attribute, the rule's own input), with fade half-width `half`: the `only` of a `writeTickVar`. A tick at or past the ramp's far end (opacity 1) or at or inside its near
 * end (0) on both sides of the move keeps its opacity, whatever the same-label terms: the min() and clamp() saturate. */
export const pillMoveFadesAt = (half: number, from: number, to: number) => (x: number): boolean => {
  // Margin for the CSS calc's float arithmetic at a zone edge.
  const EDGE = 0.05;
  const zone = (distance: number): number => (distance >= half + PILL_FADE_RAMP + EDGE ? 1 : distance <= half - EDGE ? 0 : -1);
  if (!Number.isFinite(x)) {
    return true;
  }
  const before = zone(Math.abs(x - from));
  return before < 0 || before !== zone(Math.abs(x - to));
};

/** Fixed-text pill tick rule: pill size is per-definition, the pill's live x is `--bkm-pill-x` (the focus x `names.fx` before it is written) on the x tick labels themselves
 * (`writeTickVar`), the fade is keyed on `data-bkm-hover`. Null without geometry.
 * Tick text and pill nodes are addressed through the key prefix / suffix (gap #36: no documented class or id hook). */
export function pillTickStaticCss(
  scope: string,
  tickTimes: PillTicks,
  reachPx: number,
  names: PillHostNames = DEFAULT_PILL_NAMES,
  keyPrefix = PILL_TICK_KEY,
): string | null {
  const geo = tickTimes.pillGeometry;
  if (!geo) {
    return null;
  }
  // bklit x-axis.tsx: opacity ramps linearly from tickerHalfWidth to +20px from the pointer, 0.4s ease-in-out (the snappy variant: the hover profile).
  const sel = `${scope} text${keyStarts(keyPrefix)}`;
  const half = pillFadeHalf(reachPx);
  const fx = `var(${PILL_LIVE_X}, var(${names.fx},-9999))`;
  const same = Array.from({ length: PILL_SAME_MAX }, (_, i) => `calc((abs(attr(x type(<number>)) - var(${names.same}${i},-9999)) - .5) * 1000)`).join(", ");
  return [
    // Both ways, like bklit: the overlay pill paints above the axis (hover-overlay.ts), so a tick it sweeps past stays under the capsule and barely dips, with no trail of hidden ticks behind it.
    `${sel}${NOT_MOTION}{transition:opacity ${HOVER_TRANSITION_CSS}}`,
    // Typed attr() is Chromium-only (133+), so the rule sits under `@supports` (unguarded, the var() keeps it past parsing and it is invalid at computed time: `opacity:1!important`) and other browsers keep every tick visible.
    // A tick within 0.5px of a same-label x is hidden outright (min with a 0 step), like bklit's `label === hoveredLabel` branch.
    typedAttr(`${scope}[${names.active}] text${keyStarts(keyPrefix)}{opacity:clamp(0, min(calc((abs(attr(x type(<number>)) - ${fx}) - ${half}) / ${PILL_FADE_RAMP}), ${same}), 1)!important}`),
  ].join("");
}

/** Tick times optionally carrying the x layout (plot left in svg px, domain start ms) for the CSS distance ramp. */
export type PillTicks = readonly number[] & { pillGeometry?: { plotLeft: number; domainStart: number } };

/** Attaches the x layout to the tick times (in place) so the pill's tick-opacity ramp can read it back. */
export function withPillGeometry(times: number[], geometry: NonNullable<PillTicks["pillGeometry"]>): number[] & PillTicks {
  return Object.assign(times, { pillGeometry: geometry });
}
