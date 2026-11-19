import { areaRadial, curveBasis, curveBasisClosed, curveCatmullRom, curveCatmullRomClosed, curveLinear, curveLinearClosed, lineRadial } from "d3-shape";
import type { CurveFactory } from "d3-shape";
import { radialArea, radialLine } from "@tanstack/charts/polar";
import type { RadialAreaCurve, RadialAreaProps, RadialAreaStroke } from "../../types/radial";
import { createRadialEdgeLookup } from "../edge";
import { createRadialScale, radialWedgePath } from "../geometry";
import { radialNumberAt, radialSeriesColor } from "../series";
import { onFrames } from "../spring";
import { childrenOf, dimClass, dimCss, markId, resourceId } from "./common";
import type { AnyPolarMark, HoverDotSpec, LayerContext, LayerEnterEnv, RadialLayer } from "./types";

const CURVES: Readonly<Record<RadialAreaCurve, { readonly open: CurveFactory; readonly closed: CurveFactory }>> = {
  catmullRom: { open: curveCatmullRom, closed: curveCatmullRomClosed },
  basis: { open: curveBasis, closed: curveBasisClosed },
  linear: { open: curveLinear, closed: curveLinearClosed },
};

/** The clockwise sweep (RadialDotBar's cascade) and each bin's rise from the base. */
const ENTER_SPREAD_MS = 750;
const ENTER_DURATION_MS = 500;
const ENTER_TOTAL_MS = ENTER_SPREAD_MS + ENTER_DURATION_MS;
const SVG_NS = "http://www.w3.org/2000/svg";

interface AreaPoint {
  readonly angle: number;
  /** The bin (it drives the enter delay). */
  readonly index: number;
  readonly inner: number;
  readonly outer: number;
}

interface Run {
  readonly points: readonly AreaPoint[];
  readonly closed: boolean;
}

interface AreaLayer {
  readonly key: string;
  /** The series index, -1 when not a series, -2 for the ghost. */
  readonly seriesIndex: number;
  readonly color: string;
  readonly fill: boolean;
  readonly fillOpacity: number;
  readonly rampFrom: number;
  readonly stroke: RadialAreaStroke;
  readonly strokeOpacity: number;
  readonly strokeDasharray: string | undefined;
  readonly runs: readonly Run[];
  /** The runs the edge strokes follow (stacked series skip zero-height bins). */
  readonly strokeRuns: readonly Run[];
  /** The stroked point per bin (null where there is no edge), for the active dot. */
  readonly byBin: readonly (AreaPoint | null)[];
}

type Range = { readonly lo: number; readonly hi: number } | null;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Per-bin points split into runs; open runs extended to their bins' edges. */
const toRuns = (points: readonly (AreaPoint | null)[], binStartAngle: (index: number) => number, isFullCircle: boolean): Run[] => {
  if (isFullCircle && points.length > 0 && points.every((p) => p !== null)) {
    return [{ points: points as AreaPoint[], closed: true }];
  }
  const runs: Run[] = [];
  let current: AreaPoint[] = [];
  const flush = (): void => {
    const first = current[0];
    const last = current.at(-1);
    if (first && last) {
      runs.push({ closed: false, points: [{ ...first, angle: binStartAngle(first.index) }, ...current, { ...last, angle: binStartAngle(last.index + 1) }] });
    }
    current = [];
  };
  for (const p of points) {
    if (p) {
      current.push(p);
    } else {
      flush();
    }
  }
  flush();
  return runs;
};

/** The points at enter progress `p` (0–1): each bin rises from the base after a clockwise delay. */
const grow = (points: readonly AreaPoint[], p: number, base: number, binCount: number): readonly AreaPoint[] => {
  if (p >= 1) {
    return points;
  }
  const t = p * ENTER_TOTAL_MS;
  return points.map((point) => {
    const delay = (point.index / Math.max(1, binCount)) * ENTER_SPREAD_MS;
    const e = easeOutCubic(Math.min(1, Math.max(0, (t - delay) / ENTER_DURATION_MS)));
    return { ...point, inner: base + (point.inner - base) * e, outer: base + (point.outer - base) * e };
  });
};

/** The enter clip: a wedge sweeping from the start angle to the end angle, then the whole disc. */
const wedgePath = (p: number, r: number, startAngle: number, endAngle: number): string => {
  const t = Math.min(1, (p * ENTER_TOTAL_MS) / ENTER_SPREAD_MS);
  if (t >= 1 - 1e-4) {
    return `M0,${-r}A${r},${r},0,1,1,0,${r}A${r},${r},0,1,1,0,${-r}Z`;
  }
  return radialWedgePath(r, startAngle, startAngle + (endAngle - startAngle) * t);
};

interface RunRow {
  readonly key: string;
  readonly run: number;
  readonly angle: number;
  readonly inner: number;
  readonly outer: number;
}

const runRows = (runs: readonly Run[]): RunRow[] =>
  runs.flatMap((run, r) => run.points.map((point, i) => ({ key: `${r}-${i}`, run: r, angle: point.angle, inner: point.inner, outer: point.outer })));

export function areaLayer(props: Readonly<RadialAreaProps>, { shell, index: L, uid }: Readonly<LayerContext>): RadialLayer {
  const {
    dataKey, baseDataKey, stacked = true, color, fill = true, fillOpacity = 0.32, rampFrom, stroke = "outer", strokeWidth = 1.5, strokeOpacity = 1, strokeDasharray,
    curve = "catmullRom", ghostDataKey, ghostColor = "var(--foreground)", ghostOpacity = 0.1, maxValue: maxValueProp, activeDot = true,
    activeDotMotion = "crosshair", activeDotSpring, fadedOpacity = 0.2,
  } = props;
  const { data, series, binCount, radius, innerRadius, outerRadius, futureBins, binAngle, binStartAngle, isFullCircle, startAngle, endAngle, sharedValueScale, valueScale } = shell;
  if (binCount === 0 || outerRadius <= innerRadius) {
    return { marks: [], defs: "", css: "" };
  }

  // Raw values per layer (before scaling).
  const raws: { key: string; seriesIndex: number; values: Range[] }[] = [];
  if (dataKey) {
    raws.push({
      key: `a-${dataKey}`, seriesIndex: series.findIndex((s) => s.dataKey === dataKey),
      values: data.map((d) => {
        const hi = radialNumberAt(d, dataKey);
        if (hi === null) {
          return null;
        }
        const lo = baseDataKey ? (radialNumberAt(d, baseDataKey) ?? 0) : 0;
        return { lo: Math.max(0, lo), hi: Math.max(0, hi) };
      }),
    });
  } else {
    const cumulative = data.map(() => 0);
    series.forEach((s, seriesIndex) => {
      raws.push({
        key: `s-${seriesIndex}`, seriesIndex,
        values: data.map((d, i) => {
          const v = radialNumberAt(d, s.dataKey);
          if (v === null) {
            return null;
          }
          const lo = stacked ? (cumulative[i] ?? 0) : 0;
          const hi = lo + Math.max(0, v);
          if (stacked) {
            cumulative[i] = hi;
          }
          return { lo, hi };
        }),
      });
    });
  }
  const ghost: Range[] | null = ghostDataKey
    ? data.map((d, i) => {
      if (!futureBins[i]) {
        return null;
      }
      const v = radialNumberAt(d, ghostDataKey);
      return v === null ? null : { lo: 0, hi: Math.max(0, v) };
    })
    : null;
  let maxValue = maxValueProp ?? 0;
  if (maxValueProp === undefined) {
    for (const raw of raws) {
      for (const v of raw.values) {
        maxValue = Math.max(maxValue, v?.hi ?? 0);
      }
    }
    for (const v of ghost ?? []) {
      maxValue = Math.max(maxValue, v?.hi ?? 0);
    }
  }
  const own = createRadialScale({ maxValue, innerRadius, outerRadius });
  const scale = maxValueProp === undefined && sharedValueScale ? valueScale : (value: number): number => own(value) ?? innerRadius;
  const toPoints = (values: readonly Range[]): (AreaPoint | null)[] =>
    values.map((v, index) => (v ? { index, angle: binAngle(index), inner: scale(v.lo), outer: scale(v.hi) } : null));

  const layers: AreaLayer[] = [];
  if (ghost) {
    const byBin = toPoints(ghost);
    const runs = toRuns(byBin, binStartAngle, isFullCircle);
    layers.push({
      key: "ghost", seriesIndex: -2, color: ghostColor, fill: true, fillOpacity: ghostOpacity, rampFrom: 0.4, stroke: "outer", strokeOpacity: Math.min(1, ghostOpacity * 2.5),
      strokeDasharray: "3 4", runs, strokeRuns: runs, byBin,
    });
  }
  for (const raw of raws) {
    const s = series[raw.seriesIndex];
    const points = toPoints(raw.values);
    // A zero-height stacked series would trace the stack top it sits on.
    const byBin = dataKey || !stacked ? points : points.map((p) => (p && p.outer > p.inner ? p : null));
    layers.push({
      key: raw.key, seriesIndex: raw.seriesIndex, color: (dataKey ? color : undefined) ?? radialSeriesColor(s, raw.seriesIndex), fill, fillOpacity: fillOpacity * (s?.opacity ?? 1),
      rampFrom: rampFrom ?? s?.rampFrom ?? 0.25, stroke, strokeOpacity: strokeOpacity * (s?.opacity ?? 1), strokeDasharray, runs: toRuns(points, binStartAngle, isFullCircle),
      strokeRuns: toRuns(byBin, binStartAngle, isFullCircle), byBin,
    });
  }

  const factories = CURVES[curve];
  const curveOf = (runs: readonly Run[]): CurveFactory => (runs[0]?.closed === true ? factories.closed : factories.open);
  const marks: AnyPolarMark[] = [];
  const dots: HoverDotSpec[] = [];
  let defs = "";
  let css = "";
  const dimsDone = new Set<string>();
  /** The paths each layer's marks draw, for the entrance: which runs they follow and which edge. */
  const drawn: { id: string; runs: readonly Run[]; kind: "area" | "outer" | "inner" }[] = [];
  layers.forEach((layer, j) => {
    const dim = layer.seriesIndex >= 0 ? layer.seriesIndex : "x";
    const dimmed = dimClass(L, dim);
    if (!dimsDone.has(dimmed)) {
      dimsDone.add(dimmed);
      css += dimCss(uid, L, dim, fadedOpacity);
    }
    if (layer.fill && layer.runs.length > 0) {
      const gradient = resourceId(uid, L, `fill${j}`);
      defs += `<radialGradient id="${gradient}" cx="0" cy="0" r="${outerRadius}" gradientUnits="userSpaceOnUse"><stop offset="${innerRadius / outerRadius}" stop-color="${layer.color}" stop-opacity="${layer.fillOpacity * layer.rampFrom}"/><stop offset="1" stop-color="${layer.color}" stop-opacity="${layer.fillOpacity}"/></radialGradient>`;
      const id = markId(L, `area${j}`);
      drawn.push({ id, runs: layer.runs, kind: "area" });
      marks.push(radialArea<RunRow>(runRows(layer.runs), {
        angle: (r) => r.angle, className: `bkm-rd-l bkm-rd-area ${dimmed}`, curve: curveOf(layer.runs), fill: `url(#${gradient})`, fillOpacity: 1, id,
        key: (r) => r.key, motion: false, radius: (r) => r.outer, radius1: (r) => r.inner, z: (r) => `run${r.run}`,
      }));
    }
    if (layer.stroke !== "none" && layer.strokeRuns.length > 0) {
      for (const edge of layer.stroke === "both" ? (["outer", "inner"] as const) : (["outer"] as const)) {
        const id = markId(L, `${edge}${j}`);
        drawn.push({ id, runs: layer.strokeRuns, kind: edge });
        marks.push(radialLine<RunRow>(runRows(layer.strokeRuns), {
          angle: (r) => r.angle, className: `bkm-rd-l bkm-rd-edge ${dimmed}`, curve: curveOf(layer.strokeRuns), id, key: (r) => r.key, motion: false,
          radius: (r) => (edge === "outer" ? r.outer : r.inner), stroke: layer.color, strokeDasharray: layer.strokeDasharray,
          strokeOpacity: layer.strokeOpacity === 1 ? undefined : layer.strokeOpacity, strokeWidth, z: (r) => `run${r.run}`,
        }));
      }
      if (activeDot) {
        const lookup = createRadialEdgeLookup((context) => {
          for (const run of layer.strokeRuns) {
            lineRadial<AreaPoint>().angle((d) => d.angle).radius((d) => d.outer).curve(run.closed ? factories.closed : factories.open).context(context)(run.points);
          }
        });
        dots.push({
          key: `rd${L}-dot${j}`, lookup, showsAt: (bin) => layer.byBin[bin] !== null && layer.byBin[bin] !== undefined, motion: activeDotMotion, spring: activeDotSpring,
          r: Math.max(2.5, radius * 0.009), fill: layer.color, fillOpacity: undefined, stroke: "var(--background)", strokeWidth: 1.5, dimClass: dimmed,
        });
      }
    }
  });

  const enter = (env: LayerEnterEnv): void => {
    const doc = env.defs.ownerDocument;
    const clip = doc.createElementNS(SVG_NS, "clipPath");
    const clipId = resourceId(uid, L, "enter");
    clip.setAttribute("id", clipId);
    const wedge = doc.createElementNS(SVG_NS, "path");
    clip.append(wedge);
    env.defs.append(clip);
    const groups = drawn.flatMap(({ id }) => {
      const group = env.group(id);
      return group ? [group] : [];
    });
    for (const group of groups) {
      group.setAttribute("clip-path", `url(#${clipId})`);
    }
    const targets = drawn.flatMap(({ id, runs, kind }) => childrenOf(env, id).flatMap((element, r) => {
      const run = runs[r];
      return run ? [{ element, run, kind }] : [];
    }));
    const pathOf = (run: Run, kind: "area" | "outer" | "inner", p: number): string => {
      const factory = run.closed ? factories.closed : factories.open;
      const points = grow(run.points, p, innerRadius, binCount);
      if (kind === "area") {
        return areaRadial<AreaPoint>().angle((d) => d.angle).innerRadius((d) => d.inner).outerRadius((d) => d.outer).curve(factory)(points) ?? "";
      }
      return lineRadial<AreaPoint>().angle((d) => d.angle).radius((d) => (kind === "outer" ? d.outer : d.inner)).curve(factory)(points) ?? "";
    };
    const draw = (now: number): boolean => {
      const p = Number.isFinite(now) ? Math.min(1, Math.max(0, (now - env.start) / ENTER_TOTAL_MS)) : 1;
      wedge.setAttribute("d", wedgePath(p, radius * 1.2, startAngle, endAngle));
      for (const { element, run, kind } of targets) {
        element.setAttribute("d", pathOf(run, kind, p));
      }
      return p < 1;
    };
    draw(env.start);
    const stop = onFrames((now) => {
      if (draw(now)) {
        return true;
      }
      finish();
      return false;
    });
    const finish = (): void => {
      for (const group of groups) {
        group.removeAttribute("clip-path");
      }
      clip.remove();
    };
    env.onCancel(() => {
      stop();
      draw(Number.POSITIVE_INFINITY);
      finish();
    });
  };

  return { marks, defs, css, dots, enter };
}
