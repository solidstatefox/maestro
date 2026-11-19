import type { DomChartDefinition } from "@tanstack/charts";
import type { EntranceOrigin } from "../entrance/entrance-origin";
import { memoCell } from "../memo";
import { CHART_PALETTE } from "../palette";
import type { HoverSource } from "../polar/hover";
import { polarBoxStyle, polarHostStyle } from "../polar/layout";
import type { StyleObject } from "../style";
import type { EnterTransition } from "../motion/phase";
import type { RingData, RingGridProps, RingLabelsProps, RingLineCap, RingProps } from "../types/ring";
import type { RingArcRow } from "./arc";
import type { RingGridLayout, RingLabelRow } from "./decor";
import { RING_DECOR_ORIGINS, RING_GRID_PADDING, RING_PADDING } from "./decor-roles";
import { ringDecor } from "./features";
import { buildRingDefinition } from "./definition";
import { ringEntranceVars } from "./entrance-css";
import { springRings } from "./ring-springs";

// The track scale is a CSS animation; bklit's is a JS-driven motion value, so it takes motion's `motion` origin (entrance/entrance-origin.ts).
export const RING_ENTRANCE_ORIGINS = { "bkm-ring-in": "motion", ...RING_DECOR_ORIGINS } as const satisfies Readonly<Record<string, EntranceOrigin>>;

export const MIN_RING_SIZE_PX = 10;
const RING_BACKGROUND = "var(--bkm-border)";
const MIN_PROGRESS = 0.001;

// Default per-ring colors, in bklit order.
/** Default ring colours, applied in order and repeated: `--chart-1` to `--chart-5`. */
export const defaultRingColors: string[] = /* @__PURE__ */ ((): string[] => [...CHART_PALETTE])();

interface RingConfig {
  readonly index: number;
  readonly color?: string;
  readonly animate: boolean;
  readonly lineCap: RingLineCap;
}

const ringConfig = (props: Readonly<RingProps>): RingConfig => ({ animate: props.animate !== false, color: props.color, index: props.index, lineCap: props.lineCap ?? "round" });

interface RingModelInput {
  readonly data: RingData[];
  /** The `size` prop: the host's box (undefined or 0: fluid). */
  readonly fixedSize: number | undefined;
  /** The chart's side in px: `fixedSize`, or the measured width. */
  readonly size: number;
  readonly strokeWidth: number;
  readonly ringGap: number;
  readonly baseInnerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly enterTransition: EnterTransition | undefined;
  readonly enterStaggerScale: number;
  readonly geometryScrubbing: boolean;
  /** The Ring carriers' props, in tree order: a new array when the carriers change. */
  readonly rings: readonly RingProps[];
  /** The `padding` prop: the room kept around the outermost ring (8, or 32 with a grid, when unset). */
  readonly padding: number | undefined;
  /** The first `RingGrid` carrier's props, or undefined without one. */
  readonly grid: RingGridProps | undefined;
  /** The first `RingLabels` carrier's props, or undefined without one. */
  readonly labels: RingLabelsProps | undefined;
  /** The chart's host (read at pointer time by the hit test's live scale). */
  readonly hostRef: { readonly current: HTMLElement | null };
  readonly hoverSource: HoverSource;
  /** `performance.now()` at the start of the commit that mounts the entrance: motion's creation clock for the progress sweep. */
  readonly renderStart: { readonly current: number | null };
}

interface RingModel {
  /** Scale that fits the rings' design radius into `size` (at most 1). */
  readonly fit: number;
  readonly totalValue: number;
  readonly getColor: (index: number) => string;
  /** The inner and outer radius in px of ring `index`, after the fit. */
  readonly getRingRadii: (index: number) => { innerRadius: number; outerRadius: number };
  /** Retargets the hover springs on a hover change (polar/hover.ts `watchHostHover`'s `onChange`). */
  readonly ringSprings: (host: HTMLElement, previous: number | null, next: number | null) => void;
  readonly definition: DomChartDefinition<RingArcRow, number, number>;
  /** The host's box with the entrance vars (also the collapsed host's whole style), before a reader's `style`. */
  readonly boxStyle: StyleObject;
  /** The mounted host's style, before a reader's `style`: centred, then the box. */
  readonly hostStyle: StyleObject;
  /** Under 10 px: the host renders empty, without the chart. */
  readonly collapsed: boolean;
}

/** The ring chart's model: one builder per chart, fed on every input. */
export function createRingModel(): (input: Readonly<RingModelInput>) => RingModel {
  const totalCell = memoCell<number>();
  const colorCell = memoCell<(index: number) => string>();
  const configsCell = memoCell<ReadonlyMap<number, RingConfig>>();
  const rowsCell = memoCell<readonly RingArcRow[]>();
  const springsCell = memoCell<RingModel["ringSprings"]>();
  const definitionCell = memoCell<RingModel["definition"]>();
  const radiiCell = memoCell<RingModel["getRingRadii"]>();
  const varsCell = memoCell<StyleObject>();
  const boxCell = memoCell<StyleObject>();
  const hostCell = memoCell<StyleObject>();
  const gridCell = memoCell<RingGridLayout | null>();
  const labelsCell = memoCell<{ readonly rows: readonly RingLabelRow[]; readonly fontSize: number } | null>();
  const decorVarsCell = memoCell<StyleObject>();
  // The first definition's progress layer owns the entrance sweep; a rebuilt definition (resize, data) snaps.
  const sweepClaim: { current: object | null } = { current: null };
  return (input) => {
    const { data, fixedSize, size, strokeWidth, ringGap, baseInnerRadius, startAngle, endAngle, enterTransition, enterStaggerScale, geometryScrubbing, rings, hostRef, hoverSource, renderStart, grid, labels } = input;
    const ringCount = data.length;
    const designOuter = baseInnerRadius + ringCount * strokeWidth + Math.max(0, ringCount - 1) * ringGap;
    // bklit ring-chart.tsx: the outermost ring keeps `padding` from the edge (32 with a RingGrid, for its labels).
    const padding = input.padding ?? (grid === undefined ? RING_PADDING : RING_GRID_PADDING);
    const availableRadius = size / 2 - padding;
    const fit = designOuter > 0 ? Math.min(1, availableRadius / designOuter) : 1;

    const totalValue = totalCell([data], () => data.reduce((sum, ring: Readonly<RingData>) => sum + ring.value, 0));
    const getColor = colorCell([data], () => (index: number): string => {
      const custom = data[index]?.color;
      return custom !== undefined && custom !== "" ? custom : defaultRingColors[index % defaultRingColors.length];
    });
    // Scrub mode drops every Ring override.
    const configByIndex = configsCell([rings, geometryScrubbing], () => new Map(geometryScrubbing ? [] : rings.map((props) => {
      const config = ringConfig(props);
      return [config.index, config] as const;
    })));

    const rows = rowsCell([data, configByIndex, baseInnerRadius, strokeWidth, ringGap, startAngle, endAngle, getColor], () => {
      const sweep = endAngle - startAngle;
      return data.flatMap((ring: Readonly<RingData>, index: number): RingArcRow[] => {
        const config = configByIndex.get(index);
        const innerRadius = baseInnerRadius + index * (strokeWidth + ringGap);
        const cornerRadius = config?.lineCap === "butt" ? 0 : strokeWidth / 2;
        const animate = config?.animate ?? true;
        const ratio = ring.value / ring.maxValue;
        const progress = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
        const color = config?.color !== undefined && config.color !== "" ? config.color : getColor(index);
        const common = { animate, cornerRadius, innerRadius, outerRadius: innerRadius + strokeWidth, ringIndex: index, startAngle };
        const track: RingArcRow = { ...common, endAngle, fill: RING_BACKGROUND, key: `ring-${index}-track`, kind: "track" };
        if (progress <= MIN_PROGRESS ) { return [track]; }
        return [track, { ...common, endAngle: startAngle + sweep * progress, fill: color, key: `ring-${index}-progress`, kind: "progress" }];
      });
    });

    const ringSprings = springsCell([data.length], () => springRings(data.length));
    const getRingRadii = radiiCell([baseInnerRadius, strokeWidth, ringGap, fit], () => (index: number) => {
      const inner = baseInnerRadius * fit + index * (strokeWidth + ringGap) * fit;
      return { innerRadius: inner, outerRadius: inner + strokeWidth * fit };
    });
    const decorGeometry = { data, endAngle, getColor, getRingRadii, ringGap: ringGap * fit, size, startAngle, strokeWidth: strokeWidth * fit };
    // The decor draws once its carriers have registered it (features.ts); a chart without either never reaches it.
    const decor = ringDecor();
    const gridLayout = gridCell([grid, data, size, startAngle, endAngle, getRingRadii, decor], () => (grid === undefined || decor === undefined ? null : decor.gridLayout(grid, decorGeometry)));
    const labelLayout = labelsCell([labels, data, startAngle, endAngle, getRingRadii, getColor, strokeWidth, ringGap, fit, decor], () => (labels === undefined || decor === undefined ? null : decor.labelRows(labels, decorGeometry)));
    const definition = definitionCell(
      [rows, fit, size, hoverSource, enterStaggerScale, enterTransition, renderStart, sweepClaim, gridLayout, labelLayout],
      () => buildRingDefinition({ decor: { grid: gridLayout, labels: labelLayout }, fit, hostRef, hoverSource, rows, size, sweep: { claim: sweepClaim, enterStaggerScale, enterTransition, renderStart } }),
    );
    const decorVars = decorVarsCell(
      [gridLayout, labelLayout, data.length, enterTransition, enterStaggerScale, geometryScrubbing, decor],
      () => decor?.vars({ enterStaggerScale, enterTransition, grid: gridLayout, labels: labelLayout !== null, ringCount: data.length, still: geometryScrubbing }) ?? {},
    );
    const entranceVars = varsCell(
      [data.length, configByIndex, enterStaggerScale, enterTransition],
      () => ringEntranceVars({ animate: Array.from({ length: data.length }, (_unused, index) => configByIndex.get(index)?.animate ?? true), enterStaggerScale, enterTransition }),
    );
    // bklit's `showGlow` (ring.tsx:174) is a drop-shadow in a motion.g style framer-motion never writes to the DOM, so no glow shows (the hovered ring's `g` has computed filter none in bklit's DOM); the prop is accepted and ignored, which matches bklit's look.
    const boxStyle = boxCell([entranceVars, decorVars, fixedSize], () => ({ ...entranceVars, ...decorVars, ...polarBoxStyle(fixedSize) }));
    const hostStyle = hostCell([boxStyle], () => polarHostStyle({}, boxStyle));
    return { boxStyle, collapsed: size < MIN_RING_SIZE_PX, definition, fit, getColor, getRingRadii, hostStyle, ringSprings, totalValue };
  };
}
