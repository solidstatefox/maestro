import { userGradients } from "../gradients";
import type { installMarkerSprings } from "../motion/marker-springs";
import type { ChildTable } from "../carriers/table";
import type { ChartMarker } from "../types/cartesian";
import type { AnyMark } from "../erased-types";
import type { MarkupNode } from "../markup/node";
import type { buildOverlays } from "./overlays";
import type { ChartCrosshairProps } from "../types/range-overlays";
import { propsFor } from "../carriers/table";
import type { ChartCrosshairView, CrosshairPlot } from "./crosshair";
import type { buildRangeOverlays, RangeBuild, RangeBuildInput, rangeDots, rangeResources, rangeTooltipBase } from "./range-overlays";
import type { SeriesLayerContext } from "./series-layers";
import type { valueLabelsMark } from "./value-labels";

interface OverlayFeature {
  readonly build: typeof buildOverlays;
  readonly markerLists: (table: ChildTable) => readonly (readonly ChartMarker[])[];
  readonly installSprings: typeof installMarkerSprings;
  /** The ReferenceArea pattern fills (core/markup/resources.ts `referenceAreaResources`). */
  readonly resources: (table: ChildTable, uid: string) => MarkupNode | null;
}

interface BackgroundFeature {
  readonly marks: (table: ChildTable, uid: string) => AnyMark[];
  readonly css: (scope: string, table: ChildTable) => string;
  /** The Background preset's tile (core/markup/resources.ts `backgroundResources`). */
  readonly resources: (table: ChildTable, uid: string) => MarkupNode | null;
}

/** Band, Deadline and Weekends (enable-ranges.ts). */
interface RangeFeature {
  readonly build: typeof buildRangeOverlays;
  readonly tooltipBase: typeof rangeTooltipBase;
  readonly dots: typeof rangeDots;
  readonly resources: typeof rangeResources;
}

/** ChartCrosshair (enable-crosshair.ts): one view per chart. */
interface CrosshairFeature {
  readonly create: () => ChartCrosshairView;
}

/** LineBackdrop (under the series) and TrendLine (over them): series-layers.ts, registered by their carriers (enable-series-layers.ts). */
interface SeriesLayerFeature {
  readonly marks: (ctx: SeriesLayerContext) => AnyMark[];
}

let overlayFeature: OverlayFeature | undefined;
let crosshairFeature: CrosshairFeature | undefined;
let rangeFeature: RangeFeature | undefined;
let backdropFeature: SeriesLayerFeature | undefined;
let trendFeature: SeriesLayerFeature | undefined;
let valueLabelsFeature: typeof valueLabelsMark | undefined;
let backgroundFeature: BackgroundFeature | undefined;

export const registerOverlays = (feature: OverlayFeature): void => {
  overlayFeature = feature;
};
export const registerBackground = (feature: BackgroundFeature): void => {
  backgroundFeature = feature;
};
export const registerRanges = (feature: RangeFeature): void => {
  rangeFeature = feature;
};
export const registerCrosshair = (feature: CrosshairFeature): void => {
  crosshairFeature = feature;
};

/** A chart's ChartCrosshair slot: the view exists once the chart has a ChartCrosshair child (and the feature, which that child registers). */
export interface CrosshairSlot {
  attach(host: HTMLElement): void;
  detach(): void;
  /** After each draw: the carrier's props (or none) and the plot. */
  update(table: ChildTable, plot: CrosshairPlot): void;
  /** On each focus change: the focused row's x within the plot, or null. */
  snap(x: number | null): void;
}

export function createCrosshairSlot(): CrosshairSlot {
  let view: ChartCrosshairView | undefined;
  let host: HTMLElement | null = null;
  return {
    attach(el) {
      host = el;
      view?.attach(el);
    },
    detach() {
      view?.detach();
      host = null;
    },
    update(table, plot) {
      const props = propsFor<ChartCrosshairProps>(table, "chartCrosshair").at(0) ?? null;
      if (props && !view && crosshairFeature && typeof document !== "undefined") {
        view = crosshairFeature.create();
        if (host) {
          view.attach(host);
        }
      }
      view?.update(props, plot);
    },
    snap(x) {
      view?.snap(x);
    },
  };
}

/** The Band / Deadline / Weekends marks and what they add; without the feature (none used), nothing. */
export const rangesFor = (input: RangeBuildInput): RangeBuild | undefined => (rangeFeature && input.table.size > 0 ? rangeFeature.build(input) : undefined);

/** The bands' tooltip rows (group keys, labels, colors, edge keys); undefined without the feature. */
export const rangeTooltipFor = (table: ChildTable): ReturnType<typeof rangeTooltipBase> | undefined => rangeFeature?.tooltipBase(table);

/** The bands' edge dots for the hover overlay. */
export const rangeDotsFor = (...args: Parameters<typeof rangeDots>): ReturnType<typeof rangeDots> => rangeFeature?.dots(...args) ?? [];

/** The overlays' pattern tiles' defs host; null without the feature or a pattern fill. */
export const rangeResourcesFor = (table: ChildTable, uid: string): MarkupNode | null => rangeFeature?.resources(table, uid) ?? null;

export const registerBackdrop = (feature: SeriesLayerFeature): void => {
  backdropFeature = feature;
};
export const registerTrend = (feature: SeriesLayerFeature): void => {
  trendFeature = feature;
};

/** The LineBackdrop marks (under the series); none without the feature. */
export const backdropMarksFor = (ctx: SeriesLayerContext): AnyMark[] => backdropFeature?.marks(ctx) ?? [];

/** The TrendLine marks (over the series); none without the feature. */
export const trendMarksFor = (ctx: SeriesLayerContext): AnyMark[] => trendFeature?.marks(ctx) ?? [];

/** The overlay marks and the extents they widen; without the feature, only the user's gradients remain. */
export const overlaysFor = (...args: Parameters<typeof buildOverlays>): ReturnType<typeof buildOverlays> =>
  overlayFeature?.build(...args) ?? { xValues: [], yValues: [], projectionYValues: new Map(), gradients: [...userGradients(args[0])], marks: () => [] };

export const markerListsFor = (table: ChildTable): readonly (readonly ChartMarker[])[] => overlayFeature?.markerLists(table) ?? [];

export const installMarkers = (...args: Parameters<typeof installMarkerSprings>): ReturnType<typeof installMarkerSprings> | undefined => overlayFeature?.installSprings(...args);

export const backgroundMarksFor = (table: ChildTable, uid: string): AnyMark[] => backgroundFeature?.marks(table, uid) ?? [];

export const backgroundCssFor = (scope: string, table: ChildTable): string => backgroundFeature?.css(scope, table) ?? "";

/** The overlays' hidden defs host (ReferenceArea patterns); null without the feature or a pattern fill. */
export const overlayResourcesFor = (table: ChildTable, uid: string): MarkupNode | null => overlayFeature?.resources(table, uid) ?? null;

/** The Background's hidden defs host; null without the feature or a preset pattern. */
export const backgroundResourcesFor = (table: ChildTable, uid: string): MarkupNode | null => backgroundFeature?.resources(table, uid) ?? null;

/** Registered by the Area carrier (enable-value-labels.ts): a chart without an Area never bundles the value labels' layout. */
export const registerValueLabels = (feature: typeof valueLabelsMark): void => {
  valueLabelsFeature = feature;
};

/** The `showValue` labels' mark; none without the feature or a series that shows them. */
export const valueLabelsMarkFor = (...args: Parameters<typeof valueLabelsMark>): ReturnType<typeof valueLabelsMark> => valueLabelsFeature?.(...args);
