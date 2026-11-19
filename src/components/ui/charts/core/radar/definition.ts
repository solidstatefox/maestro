import { joinClasses } from "../cn";
import { curveLinearClosed } from "d3-shape";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { defineChart } from "@tanstack/charts/scene";
import { polar, radialArea, radialDot, radialLine, radialText } from "@tanstack/charts/polar";
import type { ChartMotionContext, ChartMotionDefinition, ChartMotionTransition, ChartPoint, DomChartDefinition } from "@tanstack/charts";
import type { RadarAxisProps } from "./axis";
import { createRadarFocus } from "./focus";
import type { RadarGridProps } from "./grid";
import type { RadarLabelsProps } from "./labels";
import { metricRows, ringRows, seriesRows, RADAR_VALUE_MAX } from "./rows";
import type { RadarData, RadarMetric, RadarRow } from "./rows";
import { toChartTransition } from "./transition";
import type { RadarEnterTransition } from "./transition";

export const MS_BASE_DURATION = 1100;
export const GRID_STAGGER_MS = 80;
const SPOKE_STAGGER_MS = 50;
export const SERIES_STAGGER_MS = 150;
export const SERIES_BASE_MS = 200;
const LABEL_FADE_EXTRA_MS = 300;
const LEVEL_LABEL_STAGGER_MS = 60;

// The native engine springs a unit progress, so bklit's px rest thresholds (0.5 px, 2 px/s on a spoke's x2/y2) are divided by the radius;
// unscaled they stop the spring at ~85% (~280 ms in instead of ~1.1 s). Rings animate `scale` 0 -> 1 (the native defaults).
const GRID_SPRING = { damping: 15, mass: 1, stiffness: 100, type: "spring" } as const;
const MOTION_REST_PX = { delta: 0.5, speed: 2 } as const;
const spokeSpring = (radius: number) => ({ damping: 15, mass: 1, restDelta: MOTION_REST_PX.delta / radius, restSpeed: MOTION_REST_PX.speed / radius, stiffness: 80, type: "spring" }) as const;
const LABEL_TWEEN = { duration: 500, type: "tween" } as const;
const INSTANT = { duration: 0, type: "tween" } as const;
export const LABEL_FILL = "var(--chart-label, oklch(0.65 0.01 260))";
export const LABEL_MARK_ID = "radar:axis-labels";

const FILL_REST = 0.15;
const STROKE_REST = 2;
const DOT_REST = 4;
export const LABEL_OFFSET = 24;
const LABEL_FONT = 11;
const LEVEL_FONT = 9;

type Motion = ChartMotionDefinition<RadarRow>;


// Entrance with a fixed delay; every later phase (hover, data change) stays instant like bklit.
const enterMotion = (animate: boolean, delayMs: number, transition: ChartMotionTransition, perDatumMs = 0): Motion => {
  if (!animate) { return false; }
  return (ctx: Readonly<ChartMotionContext<RadarRow>>) =>
    ctx.phase === "enter"
      ? { delay: delayMs + ctx.datumIndex * perDatumMs, transition }
      : { transition: INSTANT };
};

// The series entrance runs once; every later phase is left to the chart (no motion).
const seriesEnter = (animate: boolean, delay: number, transition: ChartMotionTransition): Motion => {
  if (!animate) { return false; }
  return (ctx: Readonly<ChartMotionContext<RadarRow>>) => (ctx.phase === "enter" ? { delay, transition } : false);
};

export interface ResolvedArea {
  readonly index: number;
  readonly color: string;
  readonly showPoints: boolean;
  readonly showStroke: boolean;
  readonly showGlow: boolean;
  readonly className?: string;
}

interface BuildOptions {
  readonly data: readonly RadarData[];
  readonly metrics: readonly RadarMetric[];
  readonly areas: readonly ResolvedArea[];
  readonly grid?: RadarGridProps;
  readonly axis?: RadarAxisProps;
  readonly labels?: RadarLabelsProps;
  readonly levels: number;
  readonly margin: number;
  /** Plot radius in the chart's own units (the span a spoke grows over). */
  readonly radius: number;
  readonly animate: boolean;
  readonly enterDurationMs: number;
  readonly staggerScale: number;
  readonly enterTransition?: RadarEnterTransition;
}

export const buildDefinition = (o: BuildOptions): DomChartDefinition<RadarRow, string | number, number> => {
  const keys = o.metrics.map((m) => m.key);
  const df = o.enterDurationMs / MS_BASE_DURATION;
  const gridStagger = GRID_STAGGER_MS * o.staggerScale * df;
  const seriesBase = (o.levels * gridStagger + SERIES_BASE_MS) * df;
  const seriesTransition = toChartTransition(o.enterTransition);

  const marks = [];

  if (o.grid) {
    for (let level = 0; level < o.levels; level += 1) {
      marks.push(radialLine(ringRows(level, o.levels, o.metrics), {
        angle: "angle",
        angleScale: "ring",
        className: o.grid.className,
        curve: curveLinearClosed,
        id: `radar:ring-${level}`,
        key: "metric",
        motion: enterMotion(o.animate, level * gridStagger, GRID_SPRING),
        radius: "value",
        states: [],
        stroke: o.grid.stroke ?? "var(--bkm-border)",
        strokeOpacity: o.grid.strokeOpacity ?? 0.6,
        strokeWidth: 1,
        z: "series",
      }));
    }
    if (o.grid.showLabels ?? true) {
      const levelRows = Array.from({ length: o.levels }, (_, level): RadarRow => ({
        // bklit prints the raw quotient (33.333333333333336 for 3 levels), so no rounding here.
        label: String(((level + 1) * RADAR_VALUE_MAX) / o.levels),
        metric: keys[0] ?? "",
        series: -1,
        value: ((level + 1) * RADAR_VALUE_MAX) / o.levels,
      }));
      marks.push(radialText(levelRows, {
        angle: "metric",
        anchor: "start",
        baseline: "middle",
        className: "bkm-radar-levels",
        dx: 4,
        // The scale's numbers: `--chart-label` on a halo of the card (styles/radar.css), as they sit over the polygons.
        fill: "var(--chart-label)",
        fontSize: LEVEL_FONT,
        id: "radar:level-labels",
        key: "value",
        motion: enterMotion(o.animate, o.levels * gridStagger * 0.5, LABEL_TWEEN, LEVEL_LABEL_STAGGER_MS * df),
        radius: "value",
        states: [],
        text: "label",
      }));
    }
  }

  if (o.axis) {
    // One two-point radial line per spoke so each grows from the centre on its own spring (bklit: x2/y2 from 0, 80/15, i*0.05).
    const spoke = spokeSpring(o.radius);
    for (const [i, key] of keys.entries()) {
      marks.push(radialLine([{ label: "", metric: key, series: -1, value: 0 }, { label: "", metric: key, series: -1, value: RADAR_VALUE_MAX }], {
        angle: "metric",
        className: o.axis.className,
        id: `radar:spoke-${i}`,
        key: "value",
        motion: enterMotion(o.animate, i * SPOKE_STAGGER_MS, spoke),
        radius: "value",
        states: [],
        stroke: o.axis.stroke ?? "var(--bkm-border)",
        strokeOpacity: o.axis.strokeOpacity ?? 0.6,
        strokeWidth: 1,
        z: "series",
      }));
    }
  }

  if (o.labels) {
    marks.push(radialText(metricRows(o.metrics, RADAR_VALUE_MAX), {
      angle: "metric",
      anchor: "middle",
      baseline: "middle",
      className: joinClasses("bkm-radar-axis-labels", o.labels.interactive === true && "bkm-radar-label-i", o.labels.className),
      // Interactive labels rest at the full label colour (bklit's 80% read 3.2:1 on a light card) and the hovered one takes the foreground.
      fill: LABEL_FILL,
      fontSize: o.labels.fontSize ?? LABEL_FONT,
      fontWeight: 500,
      id: LABEL_MARK_ID,
      key: "metric",
      motion: enterMotion(o.animate, o.levels * gridStagger * 0.5 + LABEL_FADE_EXTRA_MS * df, LABEL_TWEEN, SPOKE_STAGGER_MS * o.staggerScale * df),
      radius: RADAR_VALUE_MAX,
      radiusOffset: o.labels.offset ?? LABEL_OFFSET,
      // bklit `interactive`: labels rest at 0.8 and the one under the pointer brightens. That is the host's `data-bkm-label` (hover.ts) and
      // static CSS (hover-css.ts), not a native state: a mark with `states` re-reconciles the whole scene on every focus change.
      states: [],
      text: "label",
    }));
  }

  const drawn = o.areas.flatMap((area) => {
    const datum = o.data.at(area.index);
    return datum === undefined ? [] : [{ area, datum }];
  });
  for (const { area, datum } of drawn) {
    const rows = seriesRows(datum, area.index, o.metrics);
    const delay = seriesBase + area.index * SERIES_STAGGER_MS * o.staggerScale * df;
    const seriesMotion = seriesEnter(o.animate, delay, seriesTransition);
    // Hover (1.05 spring scale, fill/stroke/dot emphasis, glow, dim) is static CSS keyed on the host's data-hover (radar/hover-css.ts).
    marks.push(radialArea(rows, {
      angle: "metric",
      className: joinClasses(`bkm-radar-area bkm-radar-s${area.index}`, area.className),
      color: "series",
      curve: curveLinearClosed,
      fill: area.color,
      fillOpacity: FILL_REST,
      id: `radar:area-${area.index}`,
      key: "metric",
      motion: seriesMotion,
      radius: "value",
      stroke: area.showStroke ? area.color : "none",
      strokeWidth: STROKE_REST,
      z: "series",
    }));

    if (area.showPoints) {
      marks.push(radialDot(rows, {
        angle: "metric",
        className: `bkm-radar-dot bkm-radar-s${area.index}`,
        color: "series",
        fill: area.color,
        id: `radar:dot-${area.index}`,
        key: "metric",
        motion: seriesMotion,
        r: DOT_REST,
        radius: "value",
        stroke: "var(--chart-background)",
        strokeWidth: 2,
      }));
    }
  }

  const shapes = new Map(o.areas.map((a) => [a.index, { showPoints: a.showPoints, showStroke: a.showStroke }]));
  return defineChart({
    focus: createRadarFocus(keys, shapes),
    focusRing: false,
    margin: o.margin,
    motion: (ctx: Readonly<ChartMotionContext<RadarRow>>) => (ctx.phase === "update" ? false : undefined),
    marks: [
      polar({
        id: "radar",
        marks,
        scales: {
          angle: { scale: scalePoint().domain(keys) },
          radius: { scale: scaleLinear().domain([0, RADAR_VALUE_MAX]) },
          // bklit offsets the grid rings by half a step (and runs them counter-clockwise); a degree scale reproduces it.
          ring: { channel: "angle", scale: scaleLinear().domain([0, 360]) },
        },
      }),
    ],
    scales: { x: null, y: null },
    tooltip: false,
  });
};


export const isAreaPoint = (point: ChartPoint<RadarRow, string | number, number>): boolean => point.datum.series >= 0 && /^radar:(area|glow|dot)-/u.test(point.markId);
