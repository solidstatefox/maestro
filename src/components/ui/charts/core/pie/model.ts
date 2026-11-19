import { pie as d3Pie } from "d3-shape";
import type { ChartGradient, DomChartDefinition } from "@tanstack/charts";
import { FADE_OPACITY } from "../design-tokens";
import { memoCell } from "../memo";
import { CHART_PALETTE } from "../palette";
import { buildPieCss, createPieHoverSprings, pieHoverVars } from "../polar/polar-dim";
import { polarBoxStyle, polarHostStyle } from "../polar/layout";
import { scopePaintUrl } from "../resource-ids";
import type { StyleObject } from "../style";
import type { PieArcData, PieData, PieEnterTransition, PieSliceHoverEffect, PieSliceProps } from "../types/pie";
import { pieArcPath } from "./arc";
import type { PieArcRow } from "./arc";
import { buildPieDefinition } from "./definition";

/** Default distance in pixels a hovered slice moves out, used when `hoverOffset` is not set. */
export const DEFAULT_HOVER_OFFSET = 10;
export const FULL_SWEEP_END_ANGLE = (3 * Math.PI) / 2;
export const MIN_PIE_SIZE_PX = 10;

// 5-entry palette: a 6-cycle would desync after index 5.
/** Default slice colours, applied in order and repeated: `--chart-1` to `--chart-5`. */
export const defaultPieColors: string[] = /* @__PURE__ */ ((): string[] => [...CHART_PALETTE])();

interface PieSliceConfig {
  readonly index: number;
  readonly color?: string;
  readonly fill?: string;
  readonly animate: boolean;
  readonly showGlow: boolean;
  readonly hoverEffect: PieSliceHoverEffect;
  readonly hoverOffset?: number;
}

const pieSliceConfig = (props: Readonly<PieSliceProps>, idPrefix: string): PieSliceConfig => ({
  animate: props.animate !== false,
  color: props.color,
  fill: props.fill === undefined ? undefined : scopePaintUrl(props.fill, idPrefix),
  hoverEffect: props.hoverEffect ?? "translate",
  hoverOffset: props.hoverOffset,
  index: props.index,
  showGlow: props.showGlow === true,
});

interface PieModelInput {
  readonly data: PieData[];
  /** The `size` prop: the host's box (undefined or 0: fluid). */
  readonly fixedSize: number | undefined;
  /** The chart's side in px: `fixedSize`, or the measured width. */
  readonly size: number;
  readonly innerRadius: number;
  readonly padAngle: number;
  readonly cornerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly hoverOffset: number;
  readonly enterTransition: PieEnterTransition | undefined;
  readonly enterStaggerScale: number;
  readonly geometryScrubbing: boolean;
  /** The chart's svg id prefix: a `url(#id)` paint is scoped to it. */
  readonly idPrefix: string;
  /** The PieSlice carriers' props, in tree order: a new array when the carriers change. */
  readonly slices: readonly PieSliceProps[];
  /** The reader's gradients (LinearGradient / RadialGradient children): a new array when the carriers change. */
  readonly gradients: readonly ChartGradient[];
}

export interface PieModel {
  readonly totalValue: number;
  readonly getColor: (index: number) => string;
  readonly getFill: (index: number) => string;
  readonly arcs: PieArcData[];
  /** The owned `<style>`: the dim and pop rules keyed on the host's `data-hover`. */
  readonly dimCss: string;
  /** Retargets the hover springs on a hover change (polar/hover.ts `watchHostHover`'s `onChange`). */
  readonly hoverSprings: (host: HTMLElement, previous: number | null, next: number | null) => void;
  readonly definition: DomChartDefinition<PieArcRow, number, number>;
  /** The host's `data-bkm-grow`: the slices whose grown donut outline the CSS swaps in (undefined: none). */
  readonly grow: string | undefined;
  /** The host's box (also the collapsed host's whole style), before a reader's `style`. */
  readonly boxStyle: StyleObject;
  /** The mounted host's style, before a reader's `style`: centred, the hover geometry vars, the box. */
  readonly hostStyle: StyleObject;
  /** Under 10 px: the host renders empty, without the chart. */
  readonly collapsed: boolean;
}

/** The pie's model: one builder per chart, fed on every input. */
export function createPieModel(): (input: Readonly<PieModelInput>) => PieModel {
  const totalCell = memoCell<number>();
  const colorCell = memoCell<(index: number) => string>();
  const fillCell = memoCell<(index: number) => string>();
  const arcsCell = memoCell<PieArcData[]>();
  const configsCell = memoCell<ReadonlyMap<number, PieSliceConfig>>();
  const rowsCell = memoCell<readonly PieArcRow[]>();
  const growCell = memoCell<{ readonly isDonut: boolean; readonly outerRadius: number; readonly pathAt: (row: Readonly<PieArcRow>, radius: number) => string }>();
  const cssCell = memoCell<string>();
  const varsCell = memoCell<ReturnType<typeof pieHoverVars>>();
  const springsCell = memoCell<PieModel["hoverSprings"]>();
  const definitionCell = memoCell<PieModel["definition"]>();
  const gradientsCell = memoCell<readonly ChartGradient[]>();
  const boxCell = memoCell<StyleObject>();
  const hostCell = memoCell<StyleObject>();
  return (input) => {
    const { data, fixedSize, size, innerRadius, padAngle, cornerRadius, startAngle, endAngle, hoverOffset, enterTransition, enterStaggerScale, geometryScrubbing, idPrefix, slices } = input;
    // Kept by value: a parent's render hands the chart new carrier props, the same gradients.
    const gradients = gradientsCell([JSON.stringify(input.gradients)], () => input.gradients);
    const totalValue = totalCell([data], () => data.reduce((sum, datum: Readonly<PieData>) => sum + datum.value, 0));
    const getColor = colorCell([data], () => (index: number): string => {
      const custom = data[index]?.color;
      return custom !== undefined && custom !== "" ? custom : defaultPieColors[index % defaultPieColors.length];
    });
    const getFill = fillCell([data, getColor, idPrefix], () => (index: number): string => {
      const custom = data[index]?.fill;
      return custom !== undefined && custom !== "" ? scopePaintUrl(custom, idPrefix) : getColor(index);
    });
    const arcs = arcsCell([data, startAngle, endAngle, padAngle], () => d3Pie<PieData>()
      .value((datum: Readonly<PieData>) => datum.value)
      .startAngle(startAngle).endAngle(endAngle).padAngle(padAngle).sort(null)(data)
      .map((arc, index) => ({ data: arc.data, endAngle: arc.endAngle, index, padAngle: arc.padAngle, startAngle: arc.startAngle, value: arc.value })));
    // Scrub mode drops every PieSlice override.
    const configByIndex = configsCell([slices, geometryScrubbing, idPrefix], () => new Map(geometryScrubbing ? [] : slices.map((props) => {
      const config = pieSliceConfig(props, idPrefix);
      return [config.index, config] as const;
    })));
    const rows = rowsCell([arcs, configByIndex, getColor, getFill, hoverOffset], () => arcs.map((arc) => {
      const config = configByIndex.get(arc.index);
      const effect = config?.hoverEffect ?? "translate";
      return {
        animate: config?.animate ?? true,
        effect,
        endAngle: arc.endAngle,
        fill: config?.fill !== undefined && config.fill !== "" ? config.fill : getFill(arc.index),
        // bklit pie-slice.tsx: the glow is the slice's `color` (PieSlice's, else its data colour or the palette's), never its fill.
        glow: config?.showGlow === true ? (config.color !== undefined && config.color !== "" ? config.color : getColor(arc.index)) : undefined,
        offset: effect === "none" ? 0 : (config?.hoverOffset ?? hoverOffset),
        padAngle: arc.padAngle,
        sliceIndex: arc.index,
        startAngle: arc.startAngle,
      };
    }));
    // Hover is host attribute + fixed CSS for every effect, so no hover state reaches the definition. Grow is a uniform scale on a pie and a
    // precomputed grown outline on a donut (geometry vars set once on the host).
    const growGeometry = growCell([cornerRadius, hoverOffset, innerRadius, size], () => ({
      isDonut: innerRadius >= 1,
      outerRadius: size / 2 - hoverOffset,
      pathAt: (row: Readonly<PieArcRow>, radius: number): string => pieArcPath({ cornerRadius, innerRadius }, radius, row),
    }));
    // `showGlow` (bklit pie-slice.tsx): a drop-shadow of the slice colour on the hovered slice, a host var per glowing slice (polar-dim.ts).
    // bklit puts it in a motion.path `style` framer-motion reads once at the element's mount, so there a slice hovered after the entrance
    // shows none (measured in Chrome); here it shows on every hover, as its docs ("Show glow effect on hover") describe.
    const dimCss = cssCell([arcs.length], () => buildPieCss(FADE_OPACITY, arcs.length));
    const hoverGeometry = varsCell([rows, growGeometry], () => pieHoverVars(rows, growGeometry));
    const hoverSprings = springsCell([rows, growGeometry], () => createPieHoverSprings(rows, growGeometry));
    const definition = definitionCell(
      [rows, innerRadius, cornerRadius, hoverOffset, enterTransition, enterStaggerScale, size, gradients],
      () => buildPieDefinition({ cornerRadius, enterStaggerScale, enterTransition, gradients, hoverOffset, innerRadius, rows, size }),
    );
    const boxStyle = boxCell([fixedSize], () => polarBoxStyle(fixedSize));
    const hostStyle = hostCell([hoverGeometry.vars, boxStyle], () => polarHostStyle(hoverGeometry.vars, boxStyle));
    return {
      arcs, boxStyle, collapsed: size < MIN_PIE_SIZE_PX, definition, dimCss, getColor, getFill,
      grow: hoverGeometry.grow === "" ? undefined : hoverGeometry.grow, hostStyle, hoverSprings, totalValue,
    };
  };
}
