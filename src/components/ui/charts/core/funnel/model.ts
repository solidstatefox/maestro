import type { DomChartDefinition } from "@tanstack/charts";
import { motion } from "@tanstack/charts/motion";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { defineChart } from "@tanstack/charts/scene";
import type { EntranceOrigin } from "../entrance/entrance-origin";
import { memoCell } from "../memo";
import { enterCssCurve } from "../motion/enter-transition";
import type { StyleObject } from "../style";
import type { FunnelStage } from "../types/funnel";
import { createFunnelFocus } from "./focus";
import type { FunnelDatum } from "./focus";
import { funnelEntranceVars, funnelHoverVars } from "./host-vars";
import { buildFunnelGradients, createFunnelMark, popExtra, stageColor } from "./marks";
import type { FunnelMarkConfig } from "./marks";
import type { ResolvedFunnelProps } from "./props";

/** The CSS entrances the chart aligns to motion's clock (entrance-origin.ts): the stage grow and the label fade. */
export const FUNNEL_ENTRANCE_ORIGINS = { "bkm-funnel-grow": "motion", "bkm-funnel-label-in": "frame" } as const satisfies Readonly<Record<string, EntranceOrigin>>;

// `initial: "always"` replays the entrance on mount; updates (hover pop-out) use the marks' own spring motion.
export const FUNNEL_RENDERER = /* @__PURE__ */ motion({ initial: "always", respectReducedMotion: true, transition: { duration: 200, easing: "ease-out", type: "tween" } });

/** The renderer surface's style. */
export const FUNNEL_SURFACE_STYLE: StyleObject = { overflow: "visible", width: "100%" };

const ASPECT_HORIZONTAL = 2.2;
const ASPECT_VERTICAL = 1 / 1.8;

type ResolvedGrid = NonNullable<FunnelMarkConfig["grid"]>;

const resolveGrid = (grid: ResolvedFunnelProps<unknown, unknown>["grid"]): ResolvedGrid | null => {
  if (grid === false || grid === undefined) {return null;}
  const options = grid === true ? {} : grid;
  const lines = options.lines ?? true;
  const bands = options.bands ?? true;
  return {
    bandColor: options.bandColor ?? "var(--bkm-muted)",
    bands,
    lineColor: options.lineColor ?? "var(--chart-grid)",
    lineOpacity: options.lineOpacity ?? 1,
    lines,
    lineWidth: options.lineWidth ?? 1,
  };
};

export interface FunnelModel {
  readonly horizontal: boolean;
  /** The halo rings per stage (at least 1). */
  readonly layers: number;
  /** A stage's entrance in seconds (a tween's `enterTransition.duration`, default 1.1; a spring's settle time). */
  readonly enterDurationSec: number;
  /** The plot's width / height: the renderer lays the funnel out at it. */
  readonly aspect: number;
  /** The resource host's id prefix of the stage patterns (`<prefix>-<stage>`). */
  readonly patternPrefix: string;
  readonly definition: DomChartDefinition<FunnelDatum, number, number>;
  /** The host's style before the reader's own: its box, the hover pop-out and the entrance variables. */
  readonly hostStyle: StyleObject;
  readonly ariaLabel: string;
}

export interface FunnelModelInput {
  readonly resolved: ResolvedFunnelProps<unknown, unknown>;
  /** The mount's id (server and client stable). */
  readonly idPrefix: string;
  /** True on the server and while hydrating. */
  readonly hydrating: boolean;
}

/** The funnel's model builder: one per mount, fed on every render. */
export function createFunnelModel(): (input: FunnelModelInput) => FunnelModel {
  const gridCell = memoCell<ResolvedGrid | null>();
  const definitionCell = memoCell<DomChartDefinition<FunnelDatum, number, number>>();
  const hoverVarsCell = memoCell<StyleObject>();
  const entranceVarsCell = memoCell<StyleObject>();
  const curveCell = memoCell<ReturnType<typeof enterCssCurve>>();
  const hostStyleCell = memoCell<StyleObject>();
  return ({ resolved, idPrefix, hydrating }) => {
    const {
      data, orientation, color, layers, showPercentage, showValues, showLabels, formatPercentage, formatValue, staggerDelay, renderPattern,
      enterTransition, gap, edges, labelLayout, labelOrientation, labelAlign, grid, ariaLabel,
    } = resolved;
    // Pattern defs live in a hidden resource host (url(#id) resolves document-wide). The definition keys on whether a pattern exists, never on the
    // render function's identity, so an inline renderPattern cannot rebuild it.
    const patternPrefix = `${idPrefix}-fp`;
    const hasPattern = renderPattern !== undefined;
    const horizontal = orientation === "horizontal";
    const gridConfig = gridCell([grid], () => resolveGrid(grid));
    const definition = definitionCell(
      [color, data, edges, hydrating, patternPrefix, hasPattern, labelAlign, labelLayout, labelOrientation, formatPercentage, formatValue, gap, gridConfig, horizontal, layers, showLabels, showPercentage, showValues],
      () => {
        const stageAxis = scaleLinear().domain(horizontal ? [0, data.length] : [data.length, 0]);
        const crossAxis = scaleLinear().domain([-0.5, 0.5]);
        return defineChart({
          focus: createFunnelFocus(horizontal),
          focusRing: false,
          gradients: buildFunnelGradients(data, horizontal),
          guides: false,
          margin: { bottom: 0, left: 0, right: 0, top: 0 },
          marks: [createFunnelMark({
            color,
            curved: edges === "curved",
            formatPercentage,
            formatValue,
            gapPx: gap,
            grid: gridConfig,
            horizontal,
            labelAlign,
            labelLayout,
            labelOrientation,
            layers: Math.max(1, layers),
            // Accepted divergence (SSR only): the hydrating render repeats the server's fallback label measurements so the markup matches;
            // the next render measures with canvas, so pills and label baselines can shift by up to ~7px after hydration. Client-only mounts measure from the first frame.
            measureText: !hydrating,
            patternPrefix: hasPattern ? patternPrefix : undefined,
            showLabels,
            showPercentage,
            showValues,
            stages: data,
          })],
          scales: horizontal ? { x: { scale: stageAxis }, y: { scale: crossAxis } } : { x: { scale: crossAxis }, y: { scale: stageAxis } },
        });
      },
    );
    const hoverVars = hoverVarsCell([layers, horizontal], () => funnelHoverVars(Math.max(1, layers), horizontal, popExtra));
    // bklit's stages grow on `useMountProgress(enterTransition)`: a tween (default 1.1 s on the reveal curve) or a spring, here as CSS.
    const curve = curveCell([JSON.stringify(enterTransition ?? null)], () => enterCssCurve(enterTransition));
    const enterDurationSec = curve.durationMs / 1000;
    const entranceVars = entranceVarsCell([curve, horizontal, staggerDelay], () => funnelEntranceVars({ curve, horizontal, staggerDelaySec: staggerDelay }));
    return {
      ariaLabel: ariaLabel ?? "Funnel chart",
      aspect: horizontal ? ASPECT_HORIZONTAL : ASPECT_VERTICAL,
      definition,
      enterDurationSec,
      horizontal,
      hostStyle: hostStyleCell([hoverVars, entranceVars], () => ({ position: "relative", "user-select": "none", width: "100%", ...hoverVars, ...entranceVars })),
      layers: Math.max(1, layers),
      patternPrefix,
    };
  };
}

/** One stage's pattern tile: the id and colour `renderPattern` is called with, and the tile's shift. */
export interface FunnelPatternTile {
  readonly key: string;
  readonly id: string;
  readonly color: string;
  readonly dx: number;
  readonly dy: number;
}

interface PatternTilesInput {
  readonly data: readonly FunnelStage[];
  readonly color: string;
  readonly horizontal: boolean;
  readonly aspect: number;
  readonly gap: number;
  readonly patternPrefix: string;
  /** The plot's width the last draw measured (0 before it). */
  readonly plotWidth: number;
}

/** The stages' pattern tiles. bklit paints each stage in its own svg, so a pattern's tile origin is the stage's top-left; here every stage shares the plot's
 * origin, so each stage's pattern is shifted by its stage offset when the resources are rendered. */
export const funnelPatternTiles = ({ data, color, horizontal, aspect, gap, patternPrefix, plotWidth }: PatternTilesInput): FunnelPatternTile[] => {
  const stagePx = ((horizontal ? plotWidth : plotWidth / aspect) + gap) / Math.max(1, data.length);
  return data.map((stage, index) => {
    const offset = index * stagePx;
    return { color: stageColor(stage, color), dx: horizontal ? offset : 0, dy: horizontal ? 0 : offset, id: `${patternPrefix}-${index}`, key: `${stage.label}-${patternPrefix}` };
  });
};
