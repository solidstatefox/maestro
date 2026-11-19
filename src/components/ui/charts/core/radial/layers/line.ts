import { curveCatmullRom, curveCatmullRomClosed, lineRadial } from "d3-shape";
import { radialDot, radialLine } from "@tanstack/charts/polar";
import type { RadialLineProps } from "../../types/radial";
import { createRadialEdgeLookup } from "../edge";
import { createRadialScale } from "../geometry";
import { radialNumberAt, radialSeriesColor } from "../series";
import { animate, childrenOf, dimClass, dimCss, markId, resourceId } from "./common";
import type { AnyPolarMark, LayerContext, LayerEnterEnv, RadialLayer } from "./types";

const DRAW_MS = 1200;
const DRAW_EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
const NOW_FADE_MS = 300;
const MS = 1000;
const SVG_NS = "http://www.w3.org/2000/svg";

interface LineRow {
  readonly bin: number;
  readonly angle: number;
  readonly radius: number;
  /** The run (contiguous bins with a value) the point belongs to: each run is its own path. */
  readonly run: number;
}

/** A dash pattern: `true` is `strokeWidth` dashes with 3× gaps. */
const resolveDashArray = (dash: boolean | string | undefined, strokeWidth: number): string | undefined => {
  if (dash === true) {
    return `${strokeWidth} ${strokeWidth * 3}`;
  }
  return typeof dash === "string" ? dash : undefined;
};

export function lineLayer(props: Readonly<RadialLineProps>, { shell, index: L, uid }: Readonly<LayerContext>): RadialLayer {
  const {
    dataKey, stroke: strokeProp, strokeWidth = 2, strokeOpacity: strokeOpacityProp, dash, curve: curveProp, closed: closedProp, maxValue: maxValueProp,
    showMarkers = true, markerMotion = "crosshair", markerSpring, showNowMarker: showNowMarkerProp, pulse = true, markerRadius: markerRadiusProp,
    fadedOpacity = 0.2, enterDelay = 0,
  } = props;
  const { data, series, binCount, radius, innerRadius, outerRadius, reducedMotion, binAngle, isFullCircle, sharedValueScale, valueScale } = shell;
  if (binCount === 0 || outerRadius <= 0) {
    return { marks: [], defs: "", css: "" };
  }
  const seriesIndex = series.findIndex((s) => s.dataKey === dataKey);
  const seriesConfig = seriesIndex >= 0 ? series[seriesIndex] : undefined;
  const stroke = strokeProp ?? radialSeriesColor(seriesConfig, seriesIndex);
  const strokeOpacity = strokeOpacityProp ?? seriesConfig?.opacity ?? 1;
  const values = data.map((d) => radialNumberAt(d, dataKey));
  let maxValue = maxValueProp ?? 0;
  if (maxValueProp === undefined) {
    for (const d of data) {
      for (const key of [dataKey, ...series.map((s) => s.dataKey)]) {
        maxValue = Math.max(maxValue, radialNumberAt(d, key) ?? 0);
      }
    }
  }
  const own = createRadialScale({ maxValue, innerRadius, outerRadius });
  const scale = maxValueProp === undefined && sharedValueScale ? valueScale : (value: number): number => own(value) ?? innerRadius;
  const closed = closedProp ?? (isFullCircle && values.every((v) => v !== null));
  const curve = curveProp ?? (closed ? curveCatmullRomClosed : curveCatmullRom);

  const rows: LineRow[] = [];
  let run = 0;
  values.forEach((value, bin) => {
    if (value === null) {
      run += 1;
      return;
    }
    rows.push({ bin, angle: binAngle(bin), radius: scale(value), run });
  });
  if (rows.length === 0) {
    return { marks: [], defs: "", css: "" };
  }
  const indices = values.map((_, i) => i);
  const generator = lineRadial<number>()
    .angle((i) => binAngle(i))
    .radius((i) => scale(values[i] ?? 0))
    .defined((i) => values[i] !== null)
    .curve(curve);
  const dim = seriesIndex >= 0 ? seriesIndex : "x";
  const dimmed = dimClass(L, dim);
  const lineId = markId(L, "line");
  const marks: AnyPolarMark[] = [
    radialLine<LineRow>(rows, {
      angle: (r) => r.angle, className: `bkm-rd-l bkm-rd-line ${dimmed}`, curve, id: lineId, key: (r) => `b${r.bin}`, motion: false, radius: (r) => r.radius,
      stroke, strokeDasharray: resolveDashArray(dash, strokeWidth), strokeOpacity: strokeOpacity === 1 ? undefined : strokeOpacity, strokeWidth,
      z: (r) => `run${r.run}`,
    }),
  ];

  // The "now" marker at the line's last value: a pulse (CSS), a halo and the dot.
  const markerRadius = markerRadiusProp ?? Math.max(3.5, radius * 0.016);
  const showNowMarker = showNowMarkerProp ?? !closed;
  const last = rows.at(-1);
  const nowIds: string[] = [];
  if (showNowMarker && last) {
    const point = [last];
    const dot = (name: string, options: { r: number; fillOpacity?: number; stroke?: string; strokeWidth?: number; className: string }): void => {
      const id = markId(L, name);
      nowIds.push(id);
      marks.push(radialDot<LineRow>(point, {
        angle: (r) => r.angle, className: `bkm-rd-l ${options.className} ${dimmed}`, fill: stroke, fillOpacity: options.fillOpacity, id, key: () => "now", motion: false,
        r: options.r, radius: (r) => r.radius, stroke: options.stroke, strokeWidth: options.strokeWidth,
      }));
    };
    if (pulse && !reducedMotion) {
      dot("now-pulse", { r: markerRadius, className: "bkm-rd-pulse" });
    }
    dot("now-halo", { r: markerRadius * 2, fillOpacity: 0.16, className: "bkm-rd-now" });
    dot("now", { r: markerRadius, stroke: "var(--background)", strokeWidth: Math.max(1.5, markerRadius * 0.5), className: "bkm-rd-now" });
  }

  const lookup = showMarkers ? createRadialEdgeLookup((context) => { generator.context(context)(indices); generator.context(null); }) : null;
  const pathD = generator(indices) ?? "";

  const enter = (env: LayerEnterEnv): void => {
    const lines = childrenOf(env, lineId);
    const doc = env.defs.ownerDocument;
    if (lines.length > 0 && pathD !== "") {
      // The clockwise draw: the line seen through its own path, stroked wider in white and dashed to its length (bklit-ui's mask).
      const mask = doc.createElementNS(SVG_NS, "mask");
      const id = resourceId(uid, L, "draw");
      mask.setAttribute("id", id);
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      for (const [name, value] of [["x", -radius * 1.2], ["y", -radius * 1.2], ["width", radius * 2.4], ["height", radius * 2.4]] as const) {
        mask.setAttribute(name, String(value));
      }
      const path = doc.createElementNS(SVG_NS, "path");
      for (const [name, value] of [["d", pathD], ["fill", "none"], ["pathLength", "1"], ["stroke", "white"], ["stroke-dasharray", "1 1"], ["stroke-linecap", "butt"], ["stroke-width", String(strokeWidth + 6)]]) {
        path.setAttribute(name, value);
      }
      mask.append(path);
      env.defs.append(mask);
      for (const line of lines) {
        line.setAttribute("mask", `url(#${id})`);
      }
      const done = (): void => {
        for (const line of lines) {
          line.removeAttribute("mask");
        }
        mask.remove();
      };
      const drawing = animate(env, path, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { delay: enterDelay * MS, duration: DRAW_MS, easing: DRAW_EASE, fill: "both" });
      if (drawing) {
        drawing.finished.then(done, () => undefined);
        env.onCancel(done);
      } else {
        done();
      }
    }
    for (const id of nowIds) {
      const group = env.group(id);
      if (group) {
        animate(env, group, [{ opacity: 0 }], { delay: (enterDelay * MS) + DRAW_MS, duration: NOW_FADE_MS, easing: "ease-out" });
      }
    }
  };

  return {
    marks,
    defs: "",
    css: dimCss(uid, L, dim, fadedOpacity),
    dots: lookup === null ? [] : [{
      key: `rd${L}-marker`, lookup, showsAt: (bin) => values[bin] !== null && values[bin] !== undefined, motion: markerMotion, spring: markerSpring, r: markerRadius,
      fill: stroke, fillOpacity: Math.max(strokeOpacity, 0.5), stroke: "var(--background)", strokeWidth: Math.max(1.5, markerRadius * 0.5), dimClass: dimmed,
    }],
    enter,
  };
}
