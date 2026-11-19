import type { DomChartDefinition } from "@tanstack/charts";
import { motion } from "@tanstack/charts/motion";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { memoCell } from "../memo";
import { px } from "../style";
import type { StyleObject } from "../style";
import { radarAreaColor } from "./area";
import type { RadarAreaProps } from "./area";
import type { RadarAxisProps } from "./axis";
import { buildDefinition, GRID_STAGGER_MS, LABEL_OFFSET, MS_BASE_DURATION, SERIES_BASE_MS, SERIES_STAGGER_MS } from "./definition";
import type { ResolvedArea } from "./definition";
import { RADAR_ENTRANCE_CSS, radarEntranceVars } from "./entrance";
import type { RadarGridProps } from "./grid";
import { RADAR_HOVER_CSS } from "./hover-css";
import type { RadarLabelsProps } from "./labels";
import type { RadarData, RadarMetric, RadarRow } from "./rows";
import type { RadarEnterTransition } from "./transition";

export const DEFAULT_LEVELS = 5;
export const DEFAULT_MARGIN = 60;
export const DEFAULT_ENTER_MS = 1100;
const MIN_SIZE = 10;
const DEFAULT_VIEWBOX = 400;

export const RADAR_RENDERER = /* @__PURE__ */ motion({ initial: "always", respectReducedMotion: true });

/** The owned `<style>`: the hover rules (hover-css.ts) and the entrance rules (entrance.ts). */
export const RADAR_CSS = RADAR_HOVER_CSS + RADAR_ENTRANCE_CSS;

/** The carriers' props, from the chart's carrier table (`radarParts`). */
export interface RadarParts {
  readonly grid: RadarGridProps | undefined;
  readonly axis: RadarAxisProps | undefined;
  readonly labels: RadarLabelsProps | undefined;
  readonly areas: readonly RadarAreaProps[];
}

/** The carriers' roles in the chart's table: React reads them from its children (react/radar/extract.ts), a port's carriers register under them. */
export const RADAR_ROLES = { area: "radarArea", axis: "radarAxis", grid: "radarGrid", labels: "radarLabels" } as const;

/** The table's carriers as the chart reads them: the last RadarGrid, RadarAxis and RadarLabels (a later one replaces an earlier one), every RadarArea in order. */
export const radarParts = (table: ChildTable): RadarParts => ({
  areas: propsFor<RadarAreaProps>(table, RADAR_ROLES.area),
  axis: propsFor<RadarAxisProps>(table, RADAR_ROLES.axis).at(-1),
  grid: propsFor<RadarGridProps>(table, RADAR_ROLES.grid).at(-1),
  labels: propsFor<RadarLabelsProps>(table, RADAR_ROLES.labels).at(-1),
});

// SAFETY: these keys are JSON.stringify of the same-typed prop (or null), made in createRadarModel for the memo dependency lists.
const parseTransitionKey = (key: string): RadarEnterTransition | null => JSON.parse(key) as RadarEnterTransition | null;
// SAFETY: as parseTransitionKey, for the labels config.
const parseLabelsKey = (key: string): RadarLabelsProps | null => JSON.parse(key) as RadarLabelsProps | null;

interface RadarModelInput {
  readonly data: RadarData[];
  readonly metrics: RadarMetric[];
  readonly size: number | undefined;
  readonly levels: number;
  readonly margin: number;
  readonly animate: boolean;
  readonly enterDurationMs: number;
  readonly staggerScale: number;
  readonly enterTransition: RadarEnterTransition | undefined;
  readonly parts: RadarParts;
}

interface RadarModel {
  /** `undefined` without metrics. */
  readonly definition: DomChartDefinition<RadarRow, string | number, number> | undefined;
  /** The chart renders nothing: no metrics, or a `size` under 10 px. */
  readonly hidden: boolean;
  /** The host's classes, before a reader's `className`. */
  readonly hostClass: string;
  /** The host's style, before a reader's `style`: its size when fixed, the entrance vars when animating. */
  readonly hostStyle: StyleObject;
}

/** The radar's model: one builder per chart, fed on every input. */
export function createRadarModel(): (input: Readonly<RadarModelInput>) => RadarModel {
  const definitionCell = memoCell<RadarModel["definition"]>();
  const varsCell = memoCell<StyleObject>();
  const hostCell = memoCell<StyleObject>();
  return (input) => {
    const { data, metrics, size, levels, margin, animate, enterDurationMs, staggerScale, enterTransition, parts } = input;
    const { grid, axis, labels } = parts;
    const areasKey = JSON.stringify(parts.areas);
    const gridKey = JSON.stringify(grid ?? null);
    const axisKey = JSON.stringify(axis ?? null);
    const labelsKey = JSON.stringify(labels ?? null);
    const transitionKey = JSON.stringify(enterTransition ?? null);
    // Children props are keyed by value so hover re-renders never rebuild the definition.
    const definition = definitionCell([animate, areasKey, axisKey, data, enterDurationMs, transitionKey, gridKey, labelsKey, levels, margin, metrics, size, staggerScale], () => {
      const resolved: ResolvedArea[] = [];
      for (const a of parts.areas) {
        if (Number.isInteger(a.index) && a.index >= 0 && a.index < data.length) {
          resolved.push({
            className: a.className,
            color: radarAreaColor(a, data),
            index: a.index,
            showGlow: a.showGlow === true,
            showPoints: a.showPoints ?? true,
            showStroke: a.showStroke ?? true,
          });
        }
      }
      if (metrics.length === 0) { return undefined; }
      return buildDefinition({ animate, areas: resolved, axis, data, enterDurationMs, enterTransition, grid, labels, levels, margin, metrics, radius: Math.max(1, ((size ?? DEFAULT_VIEWBOX) - margin * 2) / 2), staggerScale });
    });
    // Entrance pieces 1.0 text/dot motion cannot express: fixed-text CSS (entrance.ts) driven by host vars.
    const entranceVars = varsCell([enterDurationMs, labelsKey, levels, margin, metrics.length, size, staggerScale, transitionKey], () => {
      const df = enterDurationMs / MS_BASE_DURATION;
      return radarEntranceVars({
        enterDurationMs,
        enterTransition: parseTransitionKey(transitionKey) ?? undefined,
        labelOffset: parseLabelsKey(labelsKey)?.offset ?? LABEL_OFFSET,
        levels,
        margin,
        metricCount: metrics.length,
        seriesBaseMs: (levels * GRID_STAGGER_MS * staggerScale * df + SERIES_BASE_MS) * df,
        seriesStepMs: SERIES_STAGGER_MS * staggerScale * df,
        size: size ?? DEFAULT_VIEWBOX,
        staggerScale,
      });
    });
    const hasSize = size !== undefined && size > 0;
    const hostStyle = hostCell([animate, entranceVars, hasSize, size], () => ({
      ...(size !== undefined && size > 0 ? { height: px(size), width: px(size) } : {}),
      ...(animate ? entranceVars : {}),
    }));
    return {
      definition,
      hidden: definition === undefined || (size !== undefined && size < MIN_SIZE),
      hostClass: hasSize ? "bk-radar bk-radar-fixed" : "bk-radar bk-radar-fluid",
      hostStyle,
    };
  };
}
