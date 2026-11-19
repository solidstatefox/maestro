import { radialDot, radialText } from "@tanstack/charts/polar";
import type { RadialDotBarProps, RadialDotPattern, RadialPatternPresetId, RadialSeries } from "../../types/radial";
import { computeRadialDotGrid, createRadialRowScale, radialDotRowRadius, stackRadialRows } from "../dot-layout";
import type { RadialDotSlot } from "../dot-layout";
import { radialLabelFontSize } from "../geometry";
import { radialPatternMarkup, radialPatternTileSize, resolveRadialPattern } from "../patterns";
import { radialNumberAt, radialSeriesColor } from "../series";
import { animate, childrenOf, dimClass, dimCss, markId, resourceId } from "./common";
import type { AnyPolarMark, LayerContext, LayerEnterEnv, RadialLayer } from "./types";
import { seriesTextColor } from "../../theme";

const ENTER_SPREAD_MS = 750;
const ENTER_ROW_STEP_MS = 30;
const ENTER_DURATION_MS = 360;
const ENTER_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const ANNOTATION_FADE_MS = 400;

interface ResolvedFill {
  readonly fill: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  /** The ring's inset, so its outer edge matches the dot size. */
  readonly inset: number;
  readonly defs: string;
}

interface DotRow {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly radius: number;
  readonly bin: number;
  readonly row: number;
}

/** The fewest tiles (≥ 1) that keep the tile near the preset's size across a dot. */
const fitTileCount = (diameter: number, tile: number): number => Math.max(1, Math.round(diameter / Math.max(0.5, tile)));

const resolveDotFill = ({ pattern, color, id, diameter }: { pattern: RadialPatternPresetId | RadialDotPattern | undefined; color: string; id: string; diameter: number }): ResolvedFill => {
  if (pattern === undefined || pattern === "none") {
    return { fill: color, inset: 0, defs: "" };
  }
  const spec: RadialDotPattern = typeof pattern === "string" ? { preset: pattern } : pattern;
  const patternColor = spec.color ?? color;
  const stroke = spec.stroke ?? patternColor;
  const ringWidth = stroke === "none" ? 0 : (spec.ringWidth ?? 1);
  const ring = { stroke: ringWidth > 0 ? stroke : undefined, strokeWidth: ringWidth > 0 ? ringWidth : undefined, inset: ringWidth / 2 };
  if (spec.fill) {
    return { fill: spec.fill, defs: "", ...ring };
  }
  const preset = resolveRadialPattern(spec.preset ?? "diagonal-up");
  if (preset === null) {
    return { fill: patternColor, defs: "", ...ring };
  }
  const baseScale = spec.scale ?? 1;
  const options = { color: patternColor, strokeWidth: spec.strokeWidth, background: spec.background };
  if ((spec.units ?? "dot") === "chart" || diameter <= 0) {
    return { fill: `url(#${id})`, defs: radialPatternMarkup(preset, id, { ...options, scale: baseScale }), ...ring };
  }
  // A whole number of tiles across the dot, re-anchored to each dot's bounding box: every dot shows the same, centred stripes.
  const tile = radialPatternTileSize(preset, baseScale);
  const count = fitTileCount(diameter, tile);
  const scale = (baseScale * diameter) / (count * tile);
  const baseId = `${id}-base`;
  return {
    fill: `url(#${id})`,
    defs: `${radialPatternMarkup(preset, baseId, { ...options, scale })}<pattern id="${id}" href="#${baseId}" patternUnits="objectBoundingBox" x="0" y="0" width="${1 / count}" height="${1 / count}"/>`,
    ...ring,
  };
};

/** An annotation's default colour: the first `emphasize` series, else the topmost series with dots in the bin. */
const annotationSeriesColor = (series: readonly RadialSeries[], ends: readonly number[] | undefined): string => {
  let index = series.findIndex((s) => s.emphasize);
  if (index < 0 && ends) {
    for (let i = ends.length - 1; i >= 0; i--) {
      if ((ends[i] ?? 0) > (i > 0 ? (ends[i - 1] ?? 0) : 0)) {
        index = i;
        break;
      }
    }
  }
  return radialSeriesColor(series[index], Math.max(0, index));
};

export function dotBarLayer(props: Readonly<RadialDotBarProps>, { shell, index: L, uid }: Readonly<LayerContext>): RadialLayer {
  const {
    ghostDataKey, ghostColor = "var(--foreground)", ghostOpacity = 0.22, maxValue: maxValueProp, rows = 14, layout = "grid", dotSize = 0.44,
    ghostDotSize = 0.26, rampExtent = 0.5, annotations, fadedOpacity = 0.2, patterns,
  } = props;
  const { data, series, binCount, radius, layout: ringLayout, innerRadius, outerRadius, futureBins, binAngle } = shell;
  const spacing = rows > 0 ? (outerRadius - innerRadius) / rows : 0;
  if (binCount === 0 || spacing <= 0) {
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
  const grid = computeRadialDotGrid({ binCount, baseRadius: innerRadius, spacing, rows, layout });
  const toRows = createRadialRowScale({ maxValue, baseRadius: innerRadius, spacing, rows });
  // The exclusive end row of each series per bin (future bins: the ghost's).
  const stackEnds = data.map((d, i) => {
    if (futureBins[i]) {
      return stackRadialRows([ghostDataKey ? (radialNumberAt(d, ghostDataKey) ?? 0) : 0], toRows, rows);
    }
    return stackRadialRows(series.map((s) => radialNumberAt(d, s.dataKey) ?? 0), toRows, rows);
  });
  const seriesFills = series.map((s, k) => resolveDotFill({ pattern: patterns?.[s.dataKey], color: radialSeriesColor(s, k), id: resourceId(uid, L, `p${k}`), diameter: spacing * dotSize }));
  const ghostFill = resolveDotFill({ pattern: patterns?.ghost, color: ghostColor, id: resourceId(uid, L, "pg"), diameter: spacing * ghostDotSize });
  const seriesR = series.map((_, k) => Math.max(0, (spacing * dotSize) / 2 - (seriesFills[k]?.inset ?? 0)));
  const ghostR = Math.max(0, (spacing * ghostDotSize) / 2 - ghostFill.inset);
  const rampRows = Math.max(1, rows * rampExtent);

  // The dots, grouped by series and opacity step (a ramped series' opacity rises by row).
  interface Group { readonly key: string; readonly series: number; readonly opacity: number; readonly dots: DotRow[] }
  const groups = new Map<string, Group>();
  const groupFor = (k: number, row: number): Group => {
    const s = series[k];
    const rampFrom = s?.rampFrom ?? 1;
    const ramped = rampFrom < 1;
    const key = ramped ? `s${k}r${Math.min(row, Math.ceil(rampRows))}` : `s${k}`;
    let group = groups.get(key);
    if (group === undefined) {
      const ramp = ramped ? rampFrom + (1 - rampFrom) * Math.min(1, row / rampRows) : 1;
      group = { key, series: k, opacity: (s?.opacity ?? 1) * ramp, dots: [] };
      groups.set(key, group);
    }
    return group;
  };
  const ghostDots: DotRow[] = [];
  const dotOf = (slot: RadialDotSlot, j: number): DotRow => ({ key: `d${slot.bin}_${slot.row}_${j}`, x: slot.x, y: slot.y, angle: slot.angle, radius: slot.radius, bin: slot.bin, row: slot.row });
  grid.forEach((slots, bin) => {
    const ends = stackEnds[bin] ?? [];
    slots.forEach((slot, j) => {
      if (futureBins[bin]) {
        if ((ends[0] ?? 0) > slot.row) {
          ghostDots.push(dotOf(slot, j));
        }
        return;
      }
      const k = ends.findIndex((end) => slot.row < end);
      if (k >= 0 && series[k]) {
        groupFor(k, slot.row).dots.push(dotOf(slot, j));
      }
    });
  });

  const marks: AnyPolarMark[] = [];
  const dotMarks: { id: string; dots: readonly DotRow[] }[] = [];
  let css = "";
  const dotMark = (id: string, dots: readonly DotRow[], fill: ResolvedFill, r: number, opacity: number, dim: number | "x"): void => {
    if (dots.length === 0) {
      return;
    }
    dotMarks.push({ id, dots });
    marks.push(radialDot<DotRow>(dots, {
      angle: (d) => d.angle, className: `bkm-rd-l bkm-rd-dots ${dimClass(L, dim)}`, fill: fill.fill, id, key: (d) => d.key, motion: false,
      opacity: opacity === 1 ? undefined : opacity, r, radius: (d) => d.radius, stroke: fill.stroke, strokeWidth: fill.strokeWidth,
    }));
  };
  dotMark(markId(L, "ghost"), ghostDots, ghostFill, ghostR, ghostOpacity, "x");
  if (ghostDots.length > 0) {
    css += dimCss(uid, L, "x", fadedOpacity);
  }
  for (const group of [...groups.values()].sort((a, b) => a.series - b.series || a.key.localeCompare(b.key))) {
    dotMark(markId(L, group.key), group.dots, seriesFills[group.series] ?? { fill: "currentColor", inset: 0, defs: "" }, seriesR[group.series] ?? 0, group.opacity, group.series);
  }
  series.forEach((_, k) => {
    css += dimCss(uid, L, k, fadedOpacity);
  });

  // Callout annotations outside a bin's tip.
  const fontSize = radialLabelFontSize(radius);
  const annotationRows = (annotations ?? []).map((annotation, i) => {
    const ends = stackEnds[annotation.index];
    const tipRow = Math.max(0, (ends?.at(-1) ?? 1) - 1);
    const tipRadius = radialDotRowRadius(innerRadius, spacing, tipRow);
    const angle = binAngle(annotation.index);
    const sin = Math.sin(angle);
    let anchor: "start" | "middle" | "end" = "middle";
    if (sin > 0.25) {
      anchor = "start";
    } else if (sin < -0.25) {
      anchor = "end";
    }
    return {
      key: `a${i}`, angle, radius: Math.max(tipRadius + spacing * 2.5, radius * ringLayout.axisLabel * 1.02), anchor, text: annotation.label,
      color: annotation.color ?? annotationSeriesColor(series, ends),
    };
  });
  const annotationId = markId(L, "annotations");
  if (annotationRows.length > 0) {
    marks.push(radialText(annotationRows, {
      anchor: (row) => row.anchor, angle: (row) => row.angle, baseline: "middle", className: "bkm-rd-label bkm-rd-annotation", fill: (row) => seriesTextColor(row.color),
      fontSize, id: annotationId, key: (row) => row.key, motion: false, radius: (row) => row.radius, text: (row) => row.text,
    }));
  }

  const defs = ghostFill.defs + seriesFills.map((f) => f.defs).join("");

  const enter = (env: LayerEnterEnv): void => {
    for (const { id, dots } of dotMarks) {
      childrenOf(env, id).forEach((element, i) => {
        const dot = dots[i];
        if (dot) {
          const delay = (dot.bin / Math.max(1, binCount)) * ENTER_SPREAD_MS + dot.row * ENTER_ROW_STEP_MS;
          animate(env, element, [{ opacity: 0, scale: "0" }], { delay, duration: ENTER_DURATION_MS, easing: ENTER_EASE });
        }
      });
    }
    const labels = env.group(annotationId);
    if (labels) {
      animate(env, labels, [{ opacity: 0 }], { delay: ENTER_SPREAD_MS, duration: ANNOTATION_FADE_MS, easing: "ease-out" });
    }
  };

  return { marks, defs, css, enter };
}
