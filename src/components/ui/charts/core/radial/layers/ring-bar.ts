import { arc as d3Arc } from "d3-shape";
import type { Arc } from "d3-shape";
import { radialArc } from "@tanstack/charts/polar";
import { REVEAL_EASING } from "../../motion/easing";
import type { RadialRingBarProps } from "../../types/radial";
import { radialNumberAt, radialSeriesColor } from "../series";
import { onFrames } from "../spring";
import { ENTER_EASE, ENTER_MS, animate, binOfElement, childrenOf, dimClass, dimCss, hotClass, hotCss, markId } from "./common";
import type { AnyPolarMark, LayerContext, LayerEnterEnv, RadialLayer } from "./types";

const EXPAND_STAGGER_MS = 80;
const SWEEP_DELAY_MS = 600;
const SWEEP_STAGGER_MS = 100;

interface RingRow {
  readonly key: string;
  readonly ring: number;
  readonly inner: number;
  readonly outer: number;
  readonly start: number;
  readonly end: number;
  readonly pad: number;
}

interface Segment {
  readonly ring: number;
  readonly y0: number;
  readonly y1: number;
  /** Extend the start / end by half a pad so the outer edges stay flush. */
  readonly padStart: boolean;
  readonly padEnd: boolean;
  readonly inner: number;
  readonly outer: number;
  readonly pad: number;
}

export function ringBarLayer(props: Readonly<RadialRingBarProps>, { shell, index: L, uid }: Readonly<LayerContext>): RadialLayer {
  const {
    maxValue: maxValueProp, cornerRadius = 0, segmentGap = 0, track = true, trackColor = "var(--foreground)", trackOpacity = 0.06, fadedOpacity = 0.35,
    seriesFadedOpacity = 0.2,
  } = props;
  const { data, series, binCount, startAngle, endAngle, isFullCircle, valueDomain, valueToAngle, ringBand } = shell;
  if (binCount === 0) {
    return { marks: [], defs: "", css: "" };
  }
  const direction = endAngle >= startAngle ? 1 : -1;
  const lo = valueDomain[0];
  const span = endAngle - startAngle;
  const toAngle = maxValueProp === undefined
    ? valueToAngle
    : (value: number): number => startAngle + Math.min(1, Math.max(0, maxValueProp > lo ? (value - lo) / (maxValueProp - lo) : 0)) * span;
  // d3 pads by a constant linear width (padRadius × padAngle) on both edges, so segment gaps stay parallel and rounded corners intact.
  const generator = d3Arc<RingRow>()
    .innerRadius((d) => d.inner)
    .outerRadius((d) => d.outer)
    .startAngle((d) => d.start)
    .endAngle((d) => d.end)
    .padAngle((d) => d.pad)
    .cornerRadius((d) => (cornerRadius === "round" ? (d.outer - d.inner) / 2 : cornerRadius));
  const pathOf = (d: RingRow): string => (Math.abs(d.end - d.start) <= d.pad + 1e-4 ? "" : (generator(d) ?? ""));
  const drawn = generatorWith(pathOf, generator);
  const segmentRow = (segment: Segment, p: number): RingRow => {
    const half = (segment.pad / 2) * direction;
    return {
      key: `r${segment.ring}`, ring: segment.ring, inner: segment.inner, outer: segment.outer, pad: segment.pad,
      start: toAngle(segment.y0 * p) - (segment.padStart ? half : 0), end: toAngle(segment.y1 * p) + (segment.padEnd ? half : 0),
    };
  };

  const bySeries: Segment[][] = series.map(() => []);
  const tracks: RingRow[] = [];
  data.forEach((d, ring) => {
    const band = ringBand(ring);
    const values = series.map((s) => Math.max(0, radialNumberAt(d, s.dataKey) ?? 0));
    const present = values.flatMap((v, k) => (v > 0 ? [k] : []));
    // d3's default pad radius: √(inner² + outer²).
    const padRadius = Math.sqrt(band.inner ** 2 + band.outer ** 2);
    const pad = segmentGap > 0 && present.length > 0 && padRadius > 0 ? segmentGap / padRadius : 0;
    let y0 = 0;
    for (const k of present) {
      const value = values[k] ?? 0;
      // Gaps only between segments: the first keeps its start on the start angle and the last its true end (a full circle keeps a seam gap).
      bySeries[k]?.push({
        ring, y0, y1: y0 + value, inner: band.inner, outer: band.outer, pad,
        padStart: !isFullCircle && k === present[0], padEnd: !isFullCircle && k === present.at(-1),
      });
      y0 += value;
    }
    if (track) {
      tracks.push({ key: `r${ring}`, ring, inner: band.inner, outer: band.outer, start: startAngle, end: endAngle, pad: 0 });
    }
  });

  const marks: AnyPolarMark[] = [];
  const ids: string[] = [];
  const segmentsById = new Map<string, readonly Segment[]>();
  let css = hotCss(uid, L, fadedOpacity);
  const arcMark = (id: string, rows: readonly RingRow[], fill: string, opacity: number | undefined, dim: number | "track"): void => {
    ids.push(id);
    marks.push(radialArc<RingRow>(rows, {
      className: `bkm-rd-l bkm-rd-ringbar ${dim === "track" ? "" : dimClass(L, dim)} ${hotClass(L)}`, fill, fillOpacity: opacity, generator: () => drawn,
      id, key: (r) => r.key, motion: false,
    }));
  };
  if (tracks.length > 0) {
    arcMark(markId(L, "track"), tracks, trackColor, trackOpacity, "track");
  }
  series.forEach((s, k) => {
    const segments = bySeries[k] ?? [];
    if (segments.length > 0) {
      const id = markId(L, `s${k}`);
      segmentsById.set(id, segments);
      arcMark(id, segments.map((segment) => segmentRow(segment, 1)), radialSeriesColor(s, k), s.opacity === undefined || s.opacity === 1 ? undefined : s.opacity, k);
    }
    css += dimCss(uid, L, k, seriesFadedOpacity);
  });

  const enter = (env: LayerEnterEnv): void => {
    // Each ring's track and values scale out of the centre…
    for (const id of ids) {
      for (const element of childrenOf(env, id)) {
        const ring = binOfElement(element) ?? 0;
        animate(env, element, [{ scale: "0" }], { delay: ring * EXPAND_STAGGER_MS, duration: ENTER_MS, easing: ENTER_EASE });
      }
    }
    // …then the values sweep along the arc from the start angle.
    const targets = [...segmentsById].flatMap(([id, segments]) => {
      const byRing = new Map(segments.map((segment) => [segment.ring, segment]));
      return childrenOf(env, id).flatMap((element) => {
        const segment = byRing.get(binOfElement(element) ?? -1);
        return segment ? [{ element, segment }] : [];
      });
    });
    const draw = (now: number): boolean => {
      const elapsed = Number.isFinite(now) ? now - env.start : Number.POSITIVE_INFINITY;
      for (const { element, segment } of targets) {
        const t = (elapsed - SWEEP_DELAY_MS - segment.ring * SWEEP_STAGGER_MS) / ENTER_MS;
        element.setAttribute("d", pathOf(segmentRow(segment, REVEAL_EASING(Math.min(1, Math.max(0, t))))) || "M0,0");
      }
      return elapsed < SWEEP_DELAY_MS + binCount * SWEEP_STAGGER_MS + ENTER_MS;
    };
    draw(env.start);
    const stop = onFrames(draw);
    env.onCancel(() => {
      stop();
      draw(Number.POSITIVE_INFINITY);
    });
  };

  return { marks, defs: "", css, hotMarks: ids, enter };
}

/** A generator that draws like `generator` but returns `pathOf`'s path (an empty one for a sliver within its pad, which radialArc skips). */
const generatorWith = <Row>(pathOf: (row: Row) => string, generator: Arc<unknown, Row>): Arc<unknown, Row> => {
  // d3's accessors are closures (no `this`): copying them keeps them working, and TanStack's boundary trace draws into the shared context.
  const wrapped = Object.assign((row: Row) => (generator.context() === null ? pathOf(row) : generator(row)), generator);
  // SAFETY: the wrapper carries every member of the d3 generator radialArc reads.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  return wrapped as unknown as Arc<unknown, Row>;
};
