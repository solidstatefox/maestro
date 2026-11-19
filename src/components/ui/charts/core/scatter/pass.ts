import { motion } from "@tanstack/charts/motion";
import type { ChildTable } from "../carriers/table";
import { referenceAreasKey, referenceAreasOfKey, timeScale } from "../cartesian/context";
import type { RowPixel } from "../cartesian/context";
import { OWN_PILL_NAMES, pillTickStaticCss } from "../cartesian/date-pill";
import { focusEmptyHiddenCss } from "../cartesian/gate-css";
import type { Row } from "../cartesian/series";
import { erase } from "../erased-types";
import { shortDateByDay } from "../format";
import { memoCell } from "../memo";
import { parseEasing } from "../motion/easing";
import { toEaseFn } from "../motion/enter-transition";
import type { EnterTransition } from "../motion/phase";
import type { RevealClock } from "../size/reveal-clock";
import type { StyleObject } from "../style";
import { bklitSurfaceStyle, DEFAULT_ANIMATION_MS, DEFAULT_MARGIN, parseAspectRatio } from "../theme";
import type { ChartMargin } from "../theme";
import type { ScatterChartProps } from "../types/cartesian";
import type { LineConfig, ReferenceAreaConfig } from "../types/context";
import { buildScatterDefinition, SCATTER_HOVER_CSS } from "./definition";
import { onCanvas } from "../canvas/renderer";
import { resolveScatterJitter } from "./jitter";
import type { ResolvedScatterJitter } from "./jitter";
import type { ScatterBuild, SizeStore } from "./definition";

/** The props a pass reads (the controller reads `onPhaseChange` itself; the framework keeps `className`, `style`, `children` and `revealSignature`). */
export type ScatterPassProps = Pick<
  ScatterChartProps<unknown, unknown>,
  "data" | "xDataKey" | "animationDuration" | "enterTransition" | "margin" | "aspectRatio" | "animationEasing" | "ariaLabel" | "ariaDescription" | "jitter" | "formatXLabel"
>;

interface ScatterPassInput {
  readonly props: ScatterPassProps;
  readonly table: ChildTable;
  /** False on the mounting pass: grid + axes only, the dots then enter as new data (buildScatterDefinition `revealed`). */
  readonly revealed: boolean;
  /** bklit's reveal timer clock, stamped in the pass that reveals (core/size/reveal-clock.ts). */
  readonly revealClock: RevealClock;
}

export interface ScatterPass {
  /** The reveal span (ms): `enterTransition.duration` (seconds) when set, else `animationDuration`. */
  readonly animationDuration: number;
  readonly margin: ChartMargin;
  readonly built: ScatterBuild;
  /** The renderer, one per chart: `initial: "always"` replays the entrance on hydrated (server-rendered) SVG too. */
  readonly renderer: ReturnType<typeof motion>;
  readonly aspectRatio: number;
  readonly ariaLabel: string;
  readonly ariaDescription: string | undefined;
  readonly rows: readonly Row[];
  /** Each row's index in `rows`: a focused datum's row. */
  readonly rowIndex: ReadonlyMap<Row, number>;
  readonly xAccessor: (d: Row) => Date;
  readonly dateLabels: string[];
  /** The series as the public context's `lines`. */
  readonly lines: LineConfig[];
  /** `ReferenceArea` bands in tree order (bklit `extractReferenceAreaConfigs`), stable per content. */
  readonly referenceAreas: ReferenceAreaConfig[];
  /** Host-relative pixel of data row `index` at the size TanStack measured last (the context's setters focus through it). */
  readonly pixelOf: RowPixel;
  /** The host's attributes beside the framework's `class` and hydration marker (`data-bkm-chart` keys SCATTER_HOVER_CSS). */
  readonly hostAttrs: Readonly<Record<string, string | undefined>>;
  /** The host's style before the reader's `style`: the hover emphasis vars (SCATTER_HOVER_CSS) and the tooltip surface vars. */
  readonly hostStyle: StyleObject;
  /** Some series dims on hover (`fadeOnHover`): a focus raises `data-bkm-hover`. */
  readonly dimOn: boolean;
  /** The owned <style>'s text: the hover rules, the date pill's tick blanking and the empty-focus rule, scoped to the chart. */
  readonly ownedCss: string;
}

const DEFAULT_ARIA_LABEL = "Scatter chart";
const DEFAULT_ASPECT_RATIO = "2 / 1";

/** The plot's inner box at a measured size. */
export const innerSize = (size: { readonly width: number; readonly height: number }, margin: ChartMargin): { readonly innerWidth: number; readonly innerHeight: number } => ({
  innerWidth: Math.max(0, size.width - margin.left - margin.right),
  innerHeight: Math.max(0, size.height - margin.top - margin.bottom),
});

/** One chart's pass builder: `uid` scopes its owned CSS, `size` is the store its definition writes TanStack's measure into. */
export function createScatterPass(uid: string, size: SizeStore): (input: ScatterPassInput) => ScatterPass {
  const scope = `[data-bkm-kit="${uid}"]`;
  // Hides the tooltip / focus layers at once while the pointer is in the chart but nothing is focused (bklit unmounts them).
  const emptyFocusCss = focusEmptyHiddenCss(scope);
  const renderer = motion(erase({ initial: "always", transition: { type: "tween", duration: 500 } }));
  const marginCell = memoCell<ChartMargin>();
  const easingCell = memoCell<(t: number) => number>();
  const builtCell = memoCell<ScatterBuild>();
  const rowIndexCell = memoCell<ReadonlyMap<Row, number>>();
  const xAccessorCell = memoCell<(d: Row) => Date>();
  const dateLabelsCell = memoCell<string[]>();
  const linesCell = memoCell<LineConfig[]>();
  const referenceAreasCell = memoCell<ReferenceAreaConfig[]>();
  const pixelOfCell = memoCell<RowPixel>();
  const hostVarsCell = memoCell<StyleObject>();
  const hostStyleCell = memoCell<StyleObject>();
  const hostAttrsCell = memoCell<ScatterPass["hostAttrs"]>();
  const pillCssCell = memoCell<string>();
  const passCell = memoCell<ScatterPass>();
  const jitterCell = memoCell<ResolvedScatterJitter | null>();
  return ({ props, table, revealed, revealClock }) => {
    const { data, xDataKey = "date", enterTransition, animationEasing, formatXLabel } = props;
    // Held on its numbers, so an inline `jitter={{ x: 0.6 }}` keeps the definition (bklit memoises it on the primitives too).
    const resolvedJitter = resolveScatterJitter(props.jitter);
    const jitter = jitterCell([resolvedJitter?.x, resolvedJitter?.y, resolvedJitter?.seed], () => resolvedJitter);
    const margin = marginCell([props.margin], () => ({ ...DEFAULT_MARGIN, ...props.margin }));
    // bklit: `enterTransition.duration` (seconds) replaces the reveal span; its `ease` array replaces the default easing.
    const enterSeconds = enterTransition?.duration;
    const animationDuration = typeof enterSeconds === "number" ? enterSeconds * 1000 : (props.animationDuration ?? DEFAULT_ANIMATION_MS);
    const enterEase = enterTransition?.ease;
    const easing = easingCell(
      [enterEase, animationEasing],
      // SAFETY: bklit's `ease` is a Transition easing (name or bezier array); toEaseFn narrows it itself.
      () => (animationEasing === undefined || animationEasing === "" ? toEaseFn(enterEase as EnterTransition["ease"]) : parseEasing(animationEasing)),
    );
    const built = builtCell(
      [data, xDataKey, table, margin, animationDuration, easing, revealed, revealClock, jitter, formatXLabel],
      () => buildScatterDefinition({ data, xKey: xDataKey, table, margin, uid: "scatter", animationDuration, easing, revealed, revealClock, sizeStore: size, jitter, formatXLabel }),
    );
    const rows = data;
    const rowIndex = rowIndexCell([rows], () => new Map(rows.map((row, i) => [row, i] as const)));
    // SAFETY: the x column holds a Date, epoch number or date string, as toDate expects.
    const xAccessor = xAccessorCell([xDataKey], () => (d: Row): Date => new Date(d[xDataKey] as string | number | Date));
    const dateLabels = dateLabelsCell([rows, xAccessor, formatXLabel], () => {
      const format = formatXLabel ?? shortDateByDay();
      return rows.map((row) => format(xAccessor(row)));
    });
    const lines = linesCell(
      [built.series],
      () => built.series.map((s) => ({ dataKey: s.dataKey, ...(s.label === undefined ? null : { label: s.label }), stroke: s.tooltipColor, strokeWidth: 0, yAxisId: s.yAxisId })),
    );
    const bandsKey = referenceAreasKey(table);
    const referenceAreas = referenceAreasCell([bandsKey], () => referenceAreasOfKey(bandsKey));
    // Rows are focused at their data x on the plot's middle line; group-x snaps like a pointer move.
    const pixelOf = pixelOfCell([rows, margin, built.domains, xAccessor], () => (index: number) => {
      const measured = size.get();
      const { innerWidth, innerHeight } = innerSize(measured, margin);
      const row = rows.at(index);
      return index >= 0 && row ? { x: margin.left + timeScale(built.domains.x(measured.width), innerWidth)(xAccessor(row)), y: margin.top + innerHeight / 2 } : null;
    });
    // Hover emphasis is static CSS (SCATTER_HOVER_CSS) keyed on the host.
    const dimSeries = built.series.find((s) => s.dim);
    const enterBlur = built.series[0]?.enterBlur;
    // Dots on a canvas (`Scatter renderer={canvasRenderer}`) are one element: they dim together, unless one of them is `fadeOnHover={false}`, and
    // their entrance is the canvas sweep in SCATTER_HOVER_CSS, over the reveal from the plot's left edge.
    const canvasSeries = built.series.filter((s) => onCanvas(s.renderer));
    const canvasDim = canvasSeries.length > 0 && canvasSeries.every((s) => s.dim);
    const canvasEnter = canvasSeries.some((s) => s.animate) ? `${animationDuration}ms` : undefined;
    const hostVars = hostVarsCell(
      [dimSeries, enterBlur, canvasEnter, margin.left],
      (): StyleObject => ({
        "--bkm-inactive": dimSeries?.inactiveOpacity ?? 1,
        "--bkm-blur": dimSeries?.inactiveBlur ?? 0,
        "--bkm-enter-blur": enterBlur ?? 2,
        ...(canvasEnter === undefined ? null : { "--bkm-enter-ms": canvasEnter, "--bkm-wipe-l": `${margin.left}px` }),
      }),
    );
    const hostStyle = hostStyleCell([hostVars], () => ({ width: "100%", position: "relative", ...hostVars, ...bklitSurfaceStyle }));
    // `inactiveMode: "blur"` raises `data-bkm-dim-blur`: only then does the dim layer take a filter (a blur(0px) one still costs a
    // filter pass per hover).
    const dimBlur = (dimSeries?.inactiveBlur ?? 0) > 0;
    const hostAttrs = hostAttrsCell([built.gridAttrs, dimBlur, canvasDim, canvasEnter], () => ({
      "data-bkm-chart": "scatter",
      "data-bkm-kit": uid,
      ...built.gridAttrs,
      ...(dimBlur ? { "data-bkm-dim-blur": "" } : null),
      ...(canvasDim ? { "data-bkm-cv-dim": "" } : null),
      ...(canvasEnter === undefined ? null : { "data-bkm-cv-in": "" }),
    }));
    const pillCss = pillCssCell(
      [built],
      // The rule text holds no width-dependent value (tick times only gate it on), so one nominal width serves.
      () => {
        const pill = built.pillTicks(1);
        return pill ? (pillTickStaticCss(scope, pill.times, pill.reachPx, OWN_PILL_NAMES) ?? "") : "";
      },
    );
    const aspectRatio = parseAspectRatio(props.aspectRatio ?? DEFAULT_ASPECT_RATIO);
    const ariaLabel = props.ariaLabel ?? DEFAULT_ARIA_LABEL;
    const { ariaDescription } = props;
    const dimOn = dimSeries !== undefined;
    const ownedCss = `${SCATTER_HOVER_CSS}${pillCss}${emptyFocusCss}`;
    return passCell(
      [animationDuration, margin, built, aspectRatio, ariaLabel, ariaDescription, rows, rowIndex, xAccessor, dateLabels, lines, referenceAreas, pixelOf, hostAttrs, hostStyle, dimOn, ownedCss],
      () => ({ animationDuration, margin, built, renderer, aspectRatio, ariaLabel, ariaDescription, rows, rowIndex, xAccessor, dateLabels, lines, referenceAreas, pixelOf, hostAttrs, hostStyle, dimOn, ownedCss }),
    );
  };
}
