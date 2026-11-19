import { arc as d3Arc } from "d3-shape";
import { radialArc } from "@tanstack/charts/polar";
import { cubicBezier } from "../../motion/easing";
import type { RadialBarProps } from "../../types/radial";
import { createRadialScale } from "../geometry";
import { radialNumberAt, radialSeriesColor } from "../series";
import { onFrames } from "../spring";
import { binOfElement, childrenOf, dimClass, dimCss, hotClass, hotCss, markId, resourceId } from "./common";
import type { AnyPolarMark, LayerContext, LayerEnterEnv, RadialLayer } from "./types";

const ENTER_SPREAD_MS = 600;
const ENTER_DURATION_MS = 600;
const ENTER_EASE = /* @__PURE__ */ cubicBezier(0.2, 0.8, 0.2, 1);

/** One segment of a column: its bin, its stack bounds in value space and its arc. */
interface BarRow {
  readonly key: string;
  readonly bin: number;
  readonly y0: number;
  readonly y1: number;
  readonly isTop: boolean;
  readonly start: number;
  readonly end: number;
  readonly inner: number;
  readonly outer: number;
  readonly corner: number;
}

interface ArcInput {
  readonly inner: number;
  readonly outer: number;
  readonly start: number;
  readonly end: number;
  readonly corner: number;
}

export function barLayer(props: Readonly<RadialBarProps>, { shell, index: L, uid }: Readonly<LayerContext>): RadialLayer {
  const {
    ghostDataKey, ghostColor = "var(--foreground)", ghostOpacity = 0.12, maxValue: maxValueProp, padAngle: padAngleProp, cornerRadius = 0, stackGap = 0,
    rampExtent = 0.6, fadedOpacity = 0.35, seriesFadedOpacity = 0.2,
  } = props;
  const { data, series, binCount, innerRadius, outerRadius, futureBins, binStartAngle, binWidth, sharedValueScale, valueScale } = shell;
  if (binCount === 0 || outerRadius <= innerRadius) {
    return { marks: [], defs: "", css: "" };
  }
  let maxValue = maxValueProp ?? 0;
  if (maxValueProp === undefined) {
    data.forEach((d, i) => {
      const value = futureBins[i]
        ? ((ghostDataKey ? radialNumberAt(d, ghostDataKey) : 0) ?? 0)
        : series.reduce((sum, s) => sum + Math.max(0, radialNumberAt(d, s.dataKey) ?? 0), 0);
      maxValue = Math.max(maxValue, value);
    });
  }
  const own = createRadialScale({ maxValue, innerRadius, outerRadius });
  const toRadius = maxValueProp === undefined && sharedValueScale ? (value: number) => valueScale(Math.max(0, value)) : (value: number) => own(Math.max(0, value)) ?? innerRadius;
  const padAngle = padAngleProp ?? Math.abs(binWidth) * 0.18;
  const arcOf = d3Arc<ArcInput>()
    .innerRadius((a) => a.inner)
    .outerRadius((a) => a.outer)
    .startAngle((a) => a.start)
    .endAngle((a) => a.end)
    .cornerRadius((a) => a.corner)
    .padAngle(padAngle)
    .padRadius(innerRadius);
  const pathOf = (a: ArcInput): string => arcOf(a) ?? "";
  // A column of several segments with rounded corners is clipped by its rounded outline (bklit-ui's clip path); one segment rounds itself.
  const clipColumns = cornerRadius > 0 && stackGap <= 0;
  const segmentGeometry = (row: Pick<BarRow, "y0" | "y1" | "isTop" | "start" | "end">, single: boolean, p: number): ArcInput => {
    const inner = toRadius(row.y0 * p);
    const outer = Math.max(inner, toRadius(row.y1 * p) - (row.isTop ? 0 : stackGap));
    return { inner, outer, start: row.start, end: row.end, corner: stackGap > 0 || (clipColumns && single) ? cornerRadius : 0 };
  };

  // The columns: one list of segments per series (and the ghost), each keyed by its bin.
  const bySeries: BarRow[][] = series.map(() => []);
  const ghost: BarRow[] = [];
  const columnTops = new Map<number, { top: number; count: number; start: number; end: number }>();
  data.forEach((d, bin) => {
    const start = binStartAngle(bin);
    const end = start + binWidth;
    if (futureBins[bin]) {
      const value = ghostDataKey ? (radialNumberAt(d, ghostDataKey) ?? 0) : 0;
      if (value > 0) {
        const base = { y0: 0, y1: value, isTop: true, start, end };
        ghost.push({ key: `b${bin}`, bin, ...base, ...segmentGeometry(base, true, 1) });
      }
      return;
    }
    const values = series.map((s) => Math.max(0, radialNumberAt(d, s.dataKey) ?? 0));
    const lastIndex = values.findLastIndex((v) => v > 0);
    const count = values.filter((v) => v > 0).length;
    let y0 = 0;
    values.forEach((value, k) => {
      if (value <= 0) {
        return;
      }
      const base = { y0, y1: y0 + value, isTop: k === lastIndex, start, end };
      bySeries[k]?.push({ key: `b${bin}`, bin, ...base, ...segmentGeometry(base, count === 1, 1) });
      y0 += value;
    });
    if (count > 1 && clipColumns) {
      columnTops.set(bin, { top: y0, count, start, end });
    }
  });
  const outlineOf = (column: { top: number; start: number; end: number }, p: number): string =>
    pathOf({ inner: toRadius(0), outer: toRadius(column.top * p), start: column.start, end: column.end, corner: cornerRadius });
  const clipId = (bin: number): string => resourceId(uid, L, `c${bin}`);

  // Ramp gradients for `rampFrom` series.
  const rampStart = innerRadius / outerRadius;
  const rampEnd = (innerRadius + (outerRadius - innerRadius) * rampExtent) / outerRadius;
  let defs = "";
  const fills = series.map((s, k) => {
    const color = radialSeriesColor(s, k);
    if ((s.rampFrom ?? 1) >= 1) {
      return color;
    }
    const id = resourceId(uid, L, `ramp${k}`);
    defs += `<radialGradient id="${id}" cx="0" cy="0" r="${outerRadius}" gradientUnits="userSpaceOnUse"><stop offset="${rampStart}" stop-color="${color}" stop-opacity="${s.rampFrom ?? 1}"/><stop offset="${rampEnd}" stop-color="${color}" stop-opacity="1"/></radialGradient>`;
    return `url(#${id})`;
  });
  for (const [bin, column] of columnTops) {
    defs += `<clipPath id="${clipId(bin)}"><path d="${outlineOf(column, 1)}"/></clipPath>`;
  }

  const generator = d3Arc<BarRow>()
    .innerRadius((r) => r.inner)
    .outerRadius((r) => r.outer)
    .startAngle((r) => r.start)
    .endAngle((r) => r.end)
    .cornerRadius((r) => r.corner)
    .padAngle(padAngle)
    .padRadius(innerRadius);
  const ids: string[] = [];
  const marks: AnyPolarMark[] = [];
  let css = hotCss(uid, L, fadedOpacity);
  const push = (id: string, rows: readonly BarRow[], fill: string, opacity: number, dim: number | "x"): void => {
    if (rows.length === 0) {
      return;
    }
    ids.push(id);
    marks.push(radialArc<BarRow>(rows, {
      className: `bkm-rd-l ${dimClass(L, dim)} ${hotClass(L)}`, fill, fillOpacity: opacity === 1 ? undefined : opacity, generator: () => generator, id,
      key: (r) => r.key, motion: false,
    }));
  };
  if (ghost.length > 0) {
    push(markId(L, "ghost"), ghost, ghostColor, ghostOpacity, "x");
    css += dimCss(uid, L, "x", seriesFadedOpacity);
  }
  series.forEach((s, k) => {
    push(markId(L, `s${k}`), bySeries[k] ?? [], fills[k] ?? radialSeriesColor(s, k), s.opacity ?? 1, k);
    css += dimCss(uid, L, k, seriesFadedOpacity);
  });

  const rowsById = new Map<string, readonly BarRow[]>([[markId(L, "ghost"), ghost], ...series.map((_, k): [string, readonly BarRow[]] => [markId(L, `s${k}`), bySeries[k] ?? []])]);

  /** Clips each multi-segment column's segments to its outline (after every draw: the renderer may have made new paths). */
  const clip = (env: LayerEnterEnv): void => {
    if (columnTops.size === 0) {
      return;
    }
    for (const id of ids) {
      for (const element of childrenOf(env, id)) {
        const bin = binOfElement(element);
        if (bin !== null && columnTops.has(bin)) {
          element.setAttribute("clip-path", `url(#${clipId(bin)})`);
        }
      }
    }
  };

  const enter = (env: LayerEnterEnv): void => {
    const targets: { element: Element; row: BarRow; single: boolean; delay: number }[] = [];
    for (const id of ids) {
      const rows = rowsById.get(id) ?? [];
      const byKey = new Map(rows.map((row) => [row.bin, row]));
      for (const element of childrenOf(env, id)) {
        const bin = binOfElement(element);
        const row = bin === null ? undefined : byKey.get(bin);
        if (row) {
          targets.push({ element, row, single: !columnTops.has(row.bin), delay: (row.bin / Math.max(1, binCount)) * ENTER_SPREAD_MS });
        }
      }
    }
    const clips = [...columnTops].flatMap(([bin, column]) => {
      const path = env.defs.querySelector(`#${CSS.escape(clipId(bin))} > path`);
      return path ? [{ path, column, delay: (bin / Math.max(1, binCount)) * ENTER_SPREAD_MS }] : [];
    });
    const draw = (now: number): boolean => {
      const elapsed = Number.isFinite(now) ? now - env.start : Number.POSITIVE_INFINITY;
      const progress = (delay: number): number => ENTER_EASE(Math.min(1, Math.max(0, (elapsed - delay) / ENTER_DURATION_MS)));
      for (const target of targets) {
        target.element.setAttribute("d", pathOf(segmentGeometry(target.row, target.single, progress(target.delay))));
      }
      for (const target of clips) {
        target.path.setAttribute("d", outlineOf(target.column, progress(target.delay)));
      }
      return elapsed < ENTER_SPREAD_MS + ENTER_DURATION_MS;
    };
    draw(env.start);
    const stop = onFrames(draw);
    // A redraw or an unmount mid-entrance: the paths take their final shape (the renderer only rewrites a path whose shape changed).
    env.onCancel(() => {
      stop();
      draw(Number.POSITIVE_INFINITY);
    });
  };

  return { marks, defs, css, hotMarks: ids, enter, decorate: clip };
}
