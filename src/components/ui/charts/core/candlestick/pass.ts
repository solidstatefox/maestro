import { motion } from "@tanstack/charts/motion";
import type { ScaleLinear, ScaleTime } from "d3-scale";
import { referenceAreasKey, referenceAreasOfKey, timeScale, valueScale } from "../cartesian/context";
import type { RowPixel } from "../cartesian/context";
import { pillFadeHalf } from "../cartesian/date-pill";
import type { HoverOverlayModel, OverlayPlot } from "../cartesian/hover-overlay";
import { DEFAULT_Y_AXIS_ID, toDate } from "../cartesian/series";
import type { ChildTable } from "../carriers/table";
import { overlayResourcesFor } from "../cartesian/features";
import { shortDateFmt } from "../format";
import type { MarkupNode } from "../markup/node";
import { memoCell } from "../memo";
import type { StyleObject } from "../style";
import { DEFAULT_ANIMATION_MS, DEFAULT_MARGIN, parseAspectRatio } from "../theme";
import type { ChartMargin } from "../theme";
import type { CandlestickChartProps } from "../types/candlestick";
import type { LineConfig, ReferenceAreaConfig } from "../types/context";
import { buildCandlestickDefinition, candlestickDomains, windowRows } from "./definition";
import type { Candle, CandlestickBuild, CandlestickDomains } from "./definition";
import { CANDLESTICK_TOOLTIP_BASE, candlestickCss, candlestickHostAttrs, candlestickHostStyle, candlestickLines, candlestickSurfaceStyle } from "./view";
import type { CandlestickView } from "./view";

/** The props a pass reads: a CandlestickChart's own, its `children`, `className` and `revealSignature` (controller.ts reads it) aside. */
export interface CandlestickPassProps extends Omit<CandlestickChartProps<unknown, unknown>, "children" | "className" | "style" | "revealSignature"> {
  /** The reader's style, read for one thing: an explicit `height` or `aspectRatio: "unset"` makes the surface fill the host's height. */
  readonly style?: { readonly aspectRatio?: unknown; readonly height?: unknown };
}

interface CandlestickPassInput {
  readonly props: CandlestickPassProps;
  readonly table: ChildTable;
  /** The chart's id: the `data-bkm-kit` scope of its owned CSS and the prefix of its svg ids. */
  readonly uid: string;
  /** The host's content box (whole px), zero before the first measure. */
  readonly size: { readonly width: number; readonly height: number };
  /** The ready gate's flag: false plays bklit's centre-split entrance marks, true swaps in the static candles. */
  readonly loaded: boolean;
}

/** Where the hover indicator sits: its model and the plot it places by (hover.ts `place`); a new object only when the draw would move it. */
export interface CandlestickPlacement {
  readonly model: HoverOverlayModel | null;
  readonly plot: OverlayPlot;
  readonly margin: ChartMargin;
  /** What reads the pill's live x (hover-overlay.ts `update`): the tick fade of `candlestickCss`, when its pill ticks are active. */
  readonly pillFade: number | null;
}

/** What a focus report reads (hover.ts `focusChange`); a new object only when one of them changes. */
export interface CandlestickFocusInput {
  readonly rows: readonly Candle[];
  readonly rowIndex: ReadonlyMap<unknown, number>;
  readonly xDataKey: string;
  readonly pillTicks: CandlestickBuild["pillTicks"];
  readonly innerWidth: number;
  /** The hover dim is on (`showHoverFade`). */
  readonly fadeOn: boolean;
}

export interface CandlestickPass {
  readonly data: readonly Candle[];
  readonly animationDuration: number;
  readonly margin: ChartMargin;
  /** The host's box the pass was derived at. */
  readonly size: { readonly width: number; readonly height: number };
  readonly built: CandlestickBuild;
  readonly renderer: ReturnType<typeof motion>;
  readonly placement: CandlestickPlacement;
  readonly focus: CandlestickFocusInput;
  /** The public context's fields (context.ts). */
  readonly xScale: ScaleTime<number, number>;
  readonly yScales: Record<string, ScaleLinear<number, number>>;
  readonly lines: LineConfig[];
  readonly xAccessor: (d: Candle) => Date;
  readonly dateLabels: string[];
  readonly referenceAreas: ReferenceAreaConfig[];
  /** Host-relative pixel of data row `index`, for the context's focus setters. */
  readonly pixelOf: RowPixel;
  /** The slot one row takes and the candle body's width (px). */
  readonly slots: { readonly columnWidth: number; readonly bandWidth: number };
  /** The surface's aspect ratio (none when the host's height sizes it) and label: the renderer's options. */
  readonly aspectRatio: number | undefined;
  readonly ariaLabel: string;
  readonly ariaDescription: string | undefined;
  /** The host's owned <style> (view.ts `candlestickCss`). */
  readonly css: string;
  readonly view: CandlestickView;
}

/** A chart's pass builder: one per chart, called on every render (or reactive run) with the latest input. */
export function createCandlestickPass(): (input: CandlestickPassInput) => CandlestickPass {
  const lines = candlestickLines();
  const marginCell = memoCell<ChartMargin>();
  const visibleCell = memoCell<number>();
  const builtCell = memoCell<CandlestickBuild>();
  const rendererCell = memoCell<ReturnType<typeof motion>>();
  const domainsCell = memoCell<CandlestickDomains>();
  const xScaleCell = memoCell<ScaleTime<number, number>>();
  const yScalesCell = memoCell<Record<string, ScaleLinear<number, number>>>();
  const placementCell = memoCell<CandlestickPlacement>();
  const rowIndexCell = memoCell<ReadonlyMap<unknown, number>>();
  const xAccessorCell = memoCell<(d: Candle) => Date>();
  const dateLabelsCell = memoCell<string[]>();
  const slotsCell = memoCell<CandlestickPass["slots"]>();
  const referenceAreasCell = memoCell<ReferenceAreaConfig[]>();
  const pixelOfCell = memoCell<RowPixel>();
  const focusCell = memoCell<CandlestickFocusInput>();
  const cssCell = memoCell<string>();
  const attrsCell = memoCell<CandlestickView["hostAttrs"]>();
  const hostStyleCell = memoCell<StyleObject>();
  const surfaceStyleCell = memoCell<StyleObject>();
  const resourcesCell = memoCell<MarkupNode | null>();
  const viewCell = memoCell<CandlestickView>();
  return ({ props, table, uid, size, loaded }) => {
    const {
      data,
      xDataKey = "date",
      margin: marginProp,
      animationDuration = DEFAULT_ANIMATION_MS,
      enterTransition,
      aspectRatio = "2 / 1",
      candleWidth,
      candleGap = 0.2,
      xDomain,
      xDomainSlotCount,
      style,
      ariaLabel = "Candlestick chart",
      ariaDescription,
    } = props;
    const margin = marginCell([marginProp], () => ({ ...DEFAULT_MARGIN, ...marginProp }));
    const innerWidth = Math.max(0, size.width - margin.left - margin.right);
    // The candles an `xDomain` window draws (all without one): their count is the slot count unless `xDomainSlotCount` sets it.
    const visibleCount = visibleCell([data, xDataKey, xDomain], () => windowRows(data, xDataKey, xDomain).length);
    const slotWidth = innerWidth / Math.max(xDomainSlotCount ?? visibleCount, 1);
    // bklit's body is `min(candleWidth ?? slot * (1 - candleGap), slot)` (candlestick-chart.tsx:182, candlestick.tsx:321). Native
    // bars on a time scale are already 80% of the closest spacing (one slot), which is bklit's default gap, so only a wider gap
    // needs a cap. A gap below 0.2 cannot widen them: `resolveBarThickness` only shrinks (UPSTREAM-GAPS #24), accepted.
    const bodyWidth = candleWidth ?? (candleGap > 0.2 && slotWidth > 0 ? slotWidth * (1 - candleGap) : undefined);
    const built = builtCell(
      [data, xDataKey, table, margin, uid, animationDuration, enterTransition, xDomain, xDomainSlotCount, bodyWidth, loaded],
      () =>
        buildCandlestickDefinition({
          data,
          xKey: xDataKey,
          table,
          margin,
          uid,
          animationDuration,
          enterTransition,
          xDomain,
          xDomainSlotCount,
          candleWidth: bodyWidth,
          entrance: !loaded,
        }),
    );
    // `initial: "always"` replays the entrance on hydrated (server-rendered) SVG too.
    const renderer = rendererCell([animationDuration], () => motion({ initial: "always", transition: { type: "tween", duration: animationDuration } }));
    const innerHeight = Math.max(0, size.height - margin.top - margin.bottom);
    const domains = domainsCell([data, xDataKey, xDomain, xDomainSlotCount], () => candlestickDomains(data, xDataKey, xDomain, xDomainSlotCount));
    const xScale = xScaleCell([domains.x, innerWidth], () => timeScale(domains.x, innerWidth));
    const yScales = yScalesCell([domains.y, innerHeight], () => ({ left: valueScale(domains.y, innerHeight) }));
    const placement = placementCell([built, size.height, innerWidth, innerHeight, margin], () => ({
      model: built.overlay,
      plot: { height: size.height, innerWidth, innerHeight, xDomain: built.plotDomains.x, yDomains: { [DEFAULT_Y_AXIS_ID]: built.plotDomains.y } },
      margin,
      pillFade: built.pillTicks.active ? pillFadeHalf(built.pillTicks.reachPx) : null,
    }));
    const rowIndex = rowIndexCell([data], () => new Map<unknown, number>(data.map((row, i) => [row, i] as const)));
    const xAccessor = xAccessorCell([xDataKey], () => (d: Candle): Date => toDate(d[xDataKey]));
    const dateLabels = dateLabelsCell([data, xAccessor], () => data.map((row) => shortDateFmt.format(xAccessor(row))));
    const slots = slotsCell([xDomainSlotCount, visibleCount, innerWidth, candleWidth, candleGap], () => {
      const count = xDomainSlotCount ?? visibleCount;
      const columnWidth = count > 0 ? innerWidth / count : 0;
      return { columnWidth, bandWidth: candleWidth ?? columnWidth * (1 - candleGap) };
    });
    const bandsKey = referenceAreasKey(table);
    const referenceAreas = referenceAreasCell([bandsKey], () => referenceAreasOfKey(bandsKey));
    // Rows are focused at their data x on the plot's middle line; nearest-x snaps like a pointer move.
    const pixelOf = pixelOfCell([data, margin, xScale, xAccessor, innerHeight], () => (index: number) => {
      const row: Candle | undefined = data[index];
      return row === undefined ? null : { x: margin.left + xScale(xAccessor(row)), y: margin.top + innerHeight / 2 };
    });
    const fadeOn = built.hoverFadeOpacity !== null;
    const focus = focusCell([rowIndex, data, fadeOn, built.pillTicks, innerWidth, xDataKey], () => ({ rows: data, rowIndex, xDataKey, pillTicks: built.pillTicks, innerWidth, fadeOn }));
    // bklit: an explicit height (or aspectRatio: unset) wins over the aspect ratio.
    const fillHeight = style?.aspectRatio === "unset" || style?.height !== undefined;
    const surfaceAspect = fillHeight ? undefined : parseAspectRatio(aspectRatio);
    const css = cssCell([uid, built.pillTicks], () => candlestickCss(uid, built.pillTicks));
    // A ready flip or a slot-width change rebuilds the definition, not what the host shows: the view keeps its object while its content holds.
    const hostAttrs = attrsCell([uid, JSON.stringify(built.gridAttrs)], () => candlestickHostAttrs(uid, built));
    const hostStyle = hostStyleCell([built.fadedOpacity], () => candlestickHostStyle(built.fadedOpacity));
    const surfaceStyle = surfaceStyleCell([surfaceAspect, fillHeight], () => candlestickSurfaceStyle(surfaceAspect, fillHeight));
    const resources = resourcesCell([table, uid], () => overlayResourcesFor(table, uid));
    const view = viewCell([hostAttrs, hostStyle, surfaceStyle, resources, table, data], () => ({ hostAttrs, hostStyle, surfaceStyle, resources, table, data, tooltipBase: CANDLESTICK_TOOLTIP_BASE }));
    return { data, animationDuration, margin, size, built, renderer, placement, focus, xScale, yScales, lines, xAccessor, dateLabels, referenceAreas, pixelOf, slots, aspectRatio: surfaceAspect, ariaLabel, ariaDescription, css, view };
  };
}
