import { createMark } from "@tanstack/charts";
import type { ChartGradient, ChartMark, ChartMotionContext, ChartPoint, ResolvedScale, SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { joinClasses } from "../cn";
import type { BarDepthProviderProps, BarDepthBackProps, BarDepthFrontProps, BarPulseProps } from "../types/bar";
import { REVEAL_EASING } from "../motion/easing";
import { STAGGER_SPREAD } from "./easing";
import { registerDepth } from "./depth-feature";
import { enterOrResume } from "./enter-timing";
import type { EnterTiming } from "./enter-timing";
import { barIndexClass } from "./hover";
import { scaleAt } from "./marks";
import type { HoverTarget } from "./hover";
import { DEFAULT_GROUND_SHADOW, depthEntry, GLASS_TIP_OPACITY, lidPoints, sidePoints } from "./geometry";
import type { DepthEntry } from "./geometry";
import type { BarDatum, BarSeries } from "./model";

export interface DepthMarkInput {
  readonly table: ChildTable;
  readonly datums: readonly BarDatum[];
  readonly series: readonly BarSeries[];
  readonly categories: readonly string[];
  readonly animationDuration: number;
  readonly groupGap: number;
  readonly uid: string;
  readonly faded: number;
  /** First paint of an entrance: every face collapsed onto the baseline so the next build tweens them up. */
  readonly seed: boolean;
  /** Entrance clock shared across builds (the seed build and the one after it): later updates resume it, then snap. */
  readonly clock: { at: number | null };
}

interface EntryInput {
  readonly datum: BarDatum;
  readonly series: readonly BarSeries[];
  readonly categories: readonly string[];
  readonly groupGap: number;
  readonly scales: { readonly x: ResolvedScale; readonly y: ResolvedScale };
  readonly innerLeft: number;
  readonly innerWidth: number;
  readonly minBar: number;
}

function entryFor(input: EntryInput): DepthEntry | undefined {
  const { datum: d, series, categories, groupGap, innerLeft, innerWidth, minBar } = input;
  const { x: sx, y: sy } = input.scales;
  const bw = sx.bandwidth || 0;
  const slots = Math.max(1, series.length);
  const slot = bw / slots;
  const i = series.findIndex((s) => s.key === d.series);
  const centre = sx.map(d.category);
  // Band step (bandwidth + gap) as d3's step(): the scale does not expose it, so read it off two adjacent categories.
  const next = categories.length > 1 ? Math.abs(sx.map(categories[1]) - sx.map(categories[0])) : 0;
  const step = next > 0 ? next : bw;
  if (!Number.isFinite(centre)) {
    return undefined;
  }
  const width = Math.max(0, slot - groupGap);
  const bandX = centre - bw / 2 + i * slot + groupGap / 2;
  return depthEntry({
    index: 0,
    label: d.category,
    value: d.value,
    bandX,
    bandWidth: width,
    step: step / slots,
    innerWidth,
    plotLeft: innerLeft,
    baselineY: sy.map(0),
    valueY: sy.map(d.value),
    minBarHeight: minBar,
  });
}

// bklit bar-depth.tsx:88-106: wave height ratio, minimum height (px) and the gradient's peak opacity.
const PULSE_WAVE_HEIGHT_RATIO = 0.55;
const PULSE_WAVE_HEIGHT_MIN_PX = 36;
const PULSE_WAVE_PEAK_OPACITY = 0.85;
// bklit bar-depth.tsx:967-1010: [offset, share of the peak] of the wave's bell-curve stops.
const PULSE_STOPS: readonly (readonly [number, number])[] = [[0, 0], [0.1, 0], [0.22, 0.18], [0.34, 0.5], [0.44, 0.85], [0.5, 1], [0.56, 0.85], [0.66, 0.5], [0.78, 0.18], [0.9, 0], [1, 0]];

export interface DepthMarks {
  readonly marks: ChartMark<BarDatum, string, number>[];
  readonly gradients: ChartGradient[];
  readonly hover: HoverTarget[];
}

export function buildDepthMarks(input: DepthMarkInput): DepthMarks {
  // Depth faces span the full band slot like the bar itself, which is uninset whenever depth is on (bklit: bandX = barScale(label)).
  const { table, datums, series, animationDuration } = input;
  const provider = propsFor<BarDepthProviderProps>(table, "barDepthProvider").at(0);
  const backs = propsFor<BarDepthBackProps>(table, "barDepthBack");
  const fronts = propsFor<BarDepthFrontProps>(table, "barDepthFront");
  const pulses = propsFor<BarPulseProps>(table, "barPulse");
  if (backs.length + fronts.length + pulses.length === 0) {
    return { marks: [], gradients: [], hover: [] };
  }
  const groundShadow = provider?.groundShadow ?? DEFAULT_GROUND_SHADOW;
  const minBar = provider?.minBarHeight ?? 0;
  const stagger = (animationDuration * 0.4) / Math.max(1, input.categories.length);
  const motion = (ctx: ChartMotionContext<BarDatum>): EnterTiming | undefined => {
    if (ctx.phase === "exit") {
      return { transition: { type: "tween", duration: 200 } };
    }
    const plan = { delay: ctx.datumIndex * stagger, duration: animationDuration, easing: REVEAL_EASING };
    return enterOrResume(input.clock, ctx.phase, plan);
  };
  const fillOf = (key: string): string => series.find((s) => s.key === key)?.fill ?? "var(--chart-line-primary)";
  // bklit glass: per-bar objectBoundingBox ramp, bright catch at the tip, contact shadow at the base.
  const glassId = `${input.uid}-glass`;
  const sideRtl = `${input.uid}-side-rtl`;
  const sideLtr = `${input.uid}-side-ltr`;
  const topShade = `${input.uid}-top-shade`;
  const pulseId = `${input.uid}-pulse`;
  const gradients: ChartGradient[] = [
    // bklit side shade: diagonal black ramp 0.05 -> 0.55 (right-of-centre bars have the side on the left).
    { id: sideRtl, x1: 1, y1: 0, x2: 0, y2: 1, stops: [{ offset: 0, color: "black", opacity: 0.05 }, { offset: 1, color: "black", opacity: 0.55 }] },
    { id: sideLtr, x1: 0, y1: 0, x2: 1, y2: 1, stops: [{ offset: 0, color: "black", opacity: 0.05 }, { offset: 1, color: "black", opacity: 0.55 }] },
    // Lid shade: front lip clear, back edge picks up 0.18 black.
    { id: topShade, x1: 0, y1: 1, x2: 0, y2: 0, stops: [{ offset: 0, color: "black", opacity: 0 }, { offset: 1, color: "black", opacity: 0.18 }] },
    {
      id: glassId,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1,
      stops: [
        { offset: 0, color: "white", opacity: GLASS_TIP_OPACITY },
        { offset: 0.03, color: "white", opacity: 0.09 },
        { offset: 0.08, color: "white", opacity: 0.02 },
        { offset: 0.55, color: "white", opacity: 0 },
        { offset: 1, color: "black", opacity: groundShadow },
      ],
    },
    // bklit BarPulse gradient (bar-depth.tsx:967-1010): a soft bell curve of white, peak 0.85 at the middle, clear at both ends.
    { id: pulseId, x1: 0, y1: 1, x2: 0, y2: 0, stops: PULSE_STOPS.map(([offset, weight]) => ({ offset, color: "white", opacity: PULSE_WAVE_PEAK_OPACITY * weight })) },
  ];
  const out: ChartMark<BarDatum, string, number>[] = [];
  const hover: HoverTarget[] = [];

  // Our own nodes carry a documented `className` (reference/runtime-and-scene.md "Scene nodes") that the hover CSS selects:
  // `bkm-bd-<family>-s<series index>` per mark and `bkm-bi<category index>` per bar, so no selector touches the key encoding.
  const make = (id: string, family: string, key: string, dimTo: number, draw: (d: BarDatum, e: DepthEntry, index: number) => SceneNode[]): ChartMark<BarDatum, string, number> => {
    const rows = datums.filter((d) => d.series === key);
    const seriesIndex = series.find((s) => s.key === key)?.index;
    const familyClass = `bkm-bd-${family}-s${seriesIndex}`;
    // Each draw returns one top-level node per bar (the faces group dims as one composited opacity, like bklit's wrapping motion.g).
    hover.push({
      select: `.${familyClass}`,
      keep: (index) => `.${barIndexClass(index)}`,
      dim: dimTo,
      seriesIndex,
    });
    return createMark<BarDatum, string, number>(() => ({
      id,
      channels: {
        x: { scale: "x", values: rows.map((d) => d.category) },
        y: { scale: "y", includeZero: true, values: rows.map((d) => d.value) },
      },
      motion,
      render: ({ scales, chart, color }) => {
        const nodes: SceneNode[] = [];
        const points: ChartPoint<BarDatum, string, number>[] = [];
        const sx = scaleAt(scales, "x");
        const sy = scaleAt(scales, "y");
        if (sx === undefined || sy === undefined) {
          return { nodes, points };
        }
        for (const [index, d] of rows.entries()) {
          const full = entryFor({ datum: d, series, categories: input.categories, groupGap: 0, scales: { x: sx, y: sy }, innerLeft: chart.x, innerWidth: chart.width, minBar });
          if (full) {
            // First paint collapses every face onto the baseline (the flip tweens them up). The rise stays: bklit's lid is a
            // full-size parallelogram translating up from the baseline, while the side collapses to a line like its growing clip.
            const e: DepthEntry = input.seed ? { ...full, topY: full.baselineY, bottomY: full.baselineY, barHeight: 0 } : full;
            points.push({
              key: `${id}:${d.index}`,
              markId: id,
              group: d.series,
              groupLabel: d.series,
              datum: d,
              datumIndex: index,
              xValue: d.category,
              yValue: d.value,
              x: e.bandX + e.bandWidth / 2,
              y: e.topY,
              color: color(d.series),
            });
            for (const node of draw(d, e, index)) {
              nodes.push({ ...node, className: joinClasses(node.className, familyClass, barIndexClass(d.index)) });
            }
          }
        }
        return { nodes, points };
      },
    }));
  };

  for (const back of backs) {
    out.push(
      make(`depth-back:${back.dataKey}`, "back", back.dataKey, input.faded, (d, e, i) => {
        const color = back.colorAccessor?.(d.source, i) ?? back.color ?? fillOf(back.dataKey);
        const k = `depth-back:${back.dataKey}:${d.index}`;
        const nodes: SceneNode[] = [];
        if (e.depth > 0) {
          nodes.push({
            kind: "group",
            key: `${k}:faces`,
            ariaHidden: true,
            children: [
              // bklit paints the solid colour, then the diagonal shade and the per-bar glass over the side;
              // the lid is solid + a flat tip-bright white + the back-edge shade.
              { kind: "area", key: `${k}:side`, ariaHidden: true, points: sidePoints(e, e.topY, e.bottomY), style: { fill: color } },
              { kind: "area", key: `${k}:side-shade`, ariaHidden: true, points: sidePoints(e, e.topY, e.bottomY), style: { fill: `url(#${e.isRightOfCenter ? sideRtl : sideLtr})` } },
              { kind: "area", key: `${k}:side-glass`, ariaHidden: true, points: sidePoints(e, e.topY, e.bottomY), style: { fill: `url(#${glassId})` } },
              { kind: "area", key: `${k}:lid`, ariaHidden: true, points: lidPoints(e), style: { fill: color } },
              { kind: "area", key: `${k}:lid-tip`, ariaHidden: true, points: lidPoints(e), style: { fill: "white", opacity: GLASS_TIP_OPACITY } },
              { kind: "area", key: `${k}:lid-shade`, ariaHidden: true, points: lidPoints(e), style: { fill: `url(#${topShade})` } },
            ],
          });
        }
        return nodes;
      }),
    );
  }

  for (const front of fronts) {
    out.push(
      make(`depth-front:${front.dataKey}`, "front", front.dataKey, input.faded, (d, e) => [
        {
          kind: "rect",
          key: `depth-front:${front.dataKey}:${d.index}:glass`,
          ariaHidden: true,
          x: e.bandX,
          y: e.topY,
          width: e.bandWidth,
          height: e.barHeight,
          style: { fill: `url(#${glassId})` },
        },
      ]),
    );
  }

  for (const pulse of pulses) {
    if (pulse.pulsePaused !== true) {
      out.push(
        make(`bar-pulse:${pulse.dataKey}`, "pulse", pulse.dataKey, input.faded, (d, e, i) => {
          const active = pulse.activeIndex ?? input.categories.length - 1;
          if (i !== active || Number.isNaN(e.barHeight) || e.barHeight <= 0) {
            return [];
          }
          const k = `bar-pulse:${pulse.dataKey}:${d.index}`;
          // bklit bar-depth.tsx:88-106 (constants), :996-1011 (wave geometry): the wave is max(barHeight * 0.55, 36) tall and travels
          // from the floor (rect top at bottomY) to above the lid (top at topY - perspectiveRise - height) on a 2.4s ease-in-out loop.
          const waveHeight = Math.max(e.barHeight * PULSE_WAVE_HEIGHT_RATIO, PULSE_WAVE_HEIGHT_MIN_PX);
          const travelTop = e.topY - e.perspectiveRise - waveHeight;
          return [
            {
              kind: "group",
              key: k,
              ariaHidden: true,
              // UPSTREAM-GAPS #49: group clip is rect-only, so the wave cannot follow bklit's 3D silhouette clipPath (bar-depth.tsx:964-966).
              clip: { x: e.bandX, y: e.topY, width: e.bandWidth, height: e.barHeight },
              children: [
                // The CSS sweep moves this group by its own box height (transform-box: fill-box, translateY(-100%)); the
                // transparent spacer stretches the box from the wave's travel end so the box height equals the travel distance.
                {
                  kind: "group",
                  key: `${k}:sweep`,
                  className: "ts-bkm-bar-pulse-wave",
                  ariaHidden: true,
                  children: [
                    { kind: "rect", key: `${k}:wave`, ariaHidden: true, x: e.bandX, y: e.bottomY, width: e.bandWidth, height: waveHeight, style: { fill: `url(#${pulseId})` } },
                    { kind: "rect", key: `${k}:span`, ariaHidden: true, x: e.bandX, y: travelTop + waveHeight, width: 1, height: 1, style: { fill: "none" } },
                  ],
                },
              ],
            },
          ];
        }),
      );
    }
  }
  return { marks: out, gradients, hover };
}

export interface DepthBarInput {
  readonly datums: readonly BarDatum[];
  readonly series: readonly BarSeries[];
  readonly categories: readonly string[];
  readonly minBar: number;
  readonly animationDuration: number;
  /** Seeded first paint: every front face collapsed onto the baseline so the next build tweens it up with the depth faces. */
  readonly seed: boolean;
  /** Entrance clock shared with the depth faces, so the front face, lid and side rise on one schedule. */
  readonly clock: { at: number | null };
  readonly fill: (series: string) => string;
}

/** The front face of a depth bar: bklit's `<Bar>` trimmed by the perspective rise so the lid never overlaps it (bklit bar.tsx:358-381, same `depthEntry` geometry).
 * Custom mark (guides/custom-marks-and-renderers.md): the trim is a pixel quantity and `barY` has no per-datum pixel extent (charts-core/src/bar.ts:59-82). */
export function depthBarMark(input: DepthBarInput): ChartMark<BarDatum, string, number> {
  const { series, categories, minBar, animationDuration, clock } = input;
  const barSeries = series.filter((s) => s.kind === "bar");
  const keys = new Set(barSeries.map((s) => s.key));
  const rows = input.datums.filter((d) => keys.has(d.series));
  const seriesCount = Math.max(1, series.length);
  const stagger = (animationDuration * STAGGER_SPREAD) / Math.max(1, categories.length);
  // Same stagger as the native bars had (definition.ts `enter`), on the clock the depth faces share.
  const motion = (ctx: ChartMotionContext<BarDatum>): EnterTiming | undefined => {
    if (ctx.phase === "exit") {
      return undefined;
    }
    const plan = { delay: Math.floor(ctx.datumIndex / seriesCount) * stagger, duration: animationDuration, easing: REVEAL_EASING };
    return enterOrResume(clock, ctx.phase, plan);
  };
  const seriesIndex = new Map(barSeries.map((s, i) => [s.key, i]));
  return createMark<BarDatum, string, number>(() => ({
    id: "bars",
    channels: {
      x: { scale: "x", values: rows.map((d) => d.category) },
      y: { scale: "y", includeZero: true, values: rows.flatMap((d) => (Number.isFinite(d.value) ? [d.value] : [])) },
      color: { scale: "color", values: barSeries.map((s) => s.key) },
    },
    motion,
    render: ({ scales, chart }) => {
      const nodes: SceneNode[] = [];
      const points: ChartPoint<BarDatum, string, number>[] = [];
      const sx = scaleAt(scales, "x");
      const sy = scaleAt(scales, "y");
      if (sx === undefined || sy === undefined) {
        return { nodes, points };
      }
      const bandwidth = sx.bandwidth || 0;
      const slot = bandwidth / Math.max(1, barSeries.length);
      for (const [datumIndex, d] of rows.entries()) {
        const centre = Number.isFinite(d.value) ? sx.map(d.category) : Number.NaN;
        if (Number.isFinite(centre)) {
          const e = entryFor({ datum: d, series: barSeries, categories, groupGap: 0, scales: { x: sx, y: sy }, innerLeft: chart.x, innerWidth: chart.width, minBar });
          const x = centre - bandwidth / 2 + (seriesIndex.get(d.series) ?? -1) * slot;
          const base = sy.map(0);
          const valueY = sy.map(d.value);
          // Untrimmed extent (negative and floored bars keep it, as bklit skips their trim); positive bars start at the trimmed top.
          let y = Math.min(base, valueY);
          let height = Math.abs(base - valueY);
          if (e && !e.isNegative && e.topY > y) {
            y = e.topY;
            height = e.barHeight;
          }
          if (input.seed) {
            y = base;
            height = 0;
          }
          const key = `bars:${d.index}:${d.series}`;
          const point: ChartPoint<BarDatum, string, number> = {
            key,
            markId: "bars",
            group: d.series,
            groupLabel: d.series,
            datum: d,
            datumIndex,
            xValue: d.category,
            yValue: d.value,
            y1Value: 0,
            y2Value: d.value,
            yInterval: "difference",
            x: x + slot / 2,
            y: valueY,
            color: input.fill(d.series),
          };
          points.push(point);
          nodes.push({ kind: "rect", key, x, y, width: slot, height, interaction: { point, affinity: "x" }, style: { fill: input.fill(d.series) } });
        }
      }
      return { nodes: [{ kind: "group", key: "bars", ariaHidden: true, children: nodes }], points };
    },
  }));
}

/** Hands the depth builders to the bar definition (depth-feature.ts): a framework's BarDepth* carriers call it as the chart reads or
 * registers them, so using one of them is what bundles the depth marks. */
export const enableBarDepth = (): void => {
  registerDepth({ marks: buildDepthMarks, bar: depthBarMark });
};
