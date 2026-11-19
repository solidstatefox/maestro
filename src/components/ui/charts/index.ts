export { LineChart } from "./line-chart";
export type { LineChartProps } from "./line-chart";
export { LineChartLoading } from "./line-chart-loading";
export type { LineChartLoadingProps } from "./line-chart-loading";
// Area
export { AreaChart } from "./area-chart";
export type { AreaChartProps } from "./area-chart";
export { AreaChartLoading } from "./area-chart-loading";
export type { AreaChartLoadingProps } from "./core/types/cartesian";
// Scatter
export { ScatterChart } from "./scatter-chart";
export type { ScatterChartProps } from "./scatter-chart";
export type { ScatterInactiveMode, ScatterJitter } from "./core/types/cartesian";
// Bar
export { BarChart } from "./bar-chart";
export type { BarChartProps } from "./bar-chart";
export type { BarOrientation } from "./core/types/bar";
export { BarChartLoading } from "./bar-chart-loading";
export type { BarChartLoadingProps } from "./core/types/bar";
export { BarYAxis } from "./bar/carriers";
export { useBarDepthEntries } from "./bar/depth-entries";
export type { BarDepthEntry } from "./core/types/bar";
export type { SquareColumnLayout } from "./core/bar/geometry";
export { computeSquareColumn, topSquareCenterY } from "./core/bar/geometry";
export type { BarProps, BarAnimationType, BarLineCap, BarDepthBackProps, BarDepthFrontProps, BarDepthSegment, BarPulseProps, BarColumnTrackProps, BarSquaresProps, BarXAxisProps, BarYAxisProps } from "./core/types/bar";
export type { BarDepthProviderProps } from "./bar/carriers";
// Candlestick
export { CandlestickChart } from "./candlestick-chart";
export type { CandlestickChartProps } from "./candlestick-chart";
export type { OHLCDataPoint } from "./core/types/candlestick";
export type { CandlestickProps } from "./core/types/candlestick";
// Composed
export { ComposedChart } from "./composed-chart";
export type { ComposedChartProps } from "./composed-chart";
export type { SeriesBarProps } from "./core/types/composed";
// Live line
export { LiveLineChart } from "./live-line-chart";
export { detectMomentum } from "./core/live-line/momentum";
export type { LiveLineChartProps } from "./live-line-chart";
export type { LiveLinePoint } from "./core/types/live-line";
export type { Momentum } from "./core/live-line/momentum";
export type { LiveLineConfig as LiveLineProps, LiveXAxisConfig as LiveXAxisProps, LiveYAxisConfig as LiveYAxisProps, MomentumColors } from "./core/types/live-line";

// Cartesian layers, composed as children of the cartesian charts above.
export { Line, Area, PatternArea, Background, Scatter, Bar, BarSquares, BarColumnTrack, BarDepthProvider, BarDepthBack, BarDepthFront, BarPulse, SeriesBar, BarXAxis, Grid, XAxis, ChartTooltip, Candlestick, YAxis, LiveLine, LiveXAxis, LiveYAxis, ProjectionLine, ProjectionLineEndMarker, LineSeriesTerminalMarker, ChartMarkers, ProfitLossLine } from "./children";
export type { ProjectionLineProps, ProjectionLineEndMarkerProps, LineSeriesTerminalMarkerProps, ProfitLossLineProps } from "./children";
export type {
  AreaConfig as AreaProps,
  BackgroundConfig as BackgroundProps,
  GridProps,
  LineConfig as LineProps,
  PatternAreaConfig as PatternAreaProps,
  ScatterConfig as ScatterProps,
  XAxisConfig as XAxisProps,
  YAxisConfig as YAxisProps,
} from "./core/types/cartesian";
export type {
  ChartMarker,
  ChartMarkersProps,
} from "./kit/types";
export { SeriesMarkers, MarkerGroup } from "./children";
// Series styling and analytics: the line's backdrop, glow, colour ramp and highlight, trend lines and bands
export { LineBackdrop, TrendLine } from "./kit/cartesian/series-layer-carriers";
export type { LineBackdropProps, LineBackdropStop, LineGlow, LineHighlight, StrokeGradient, StrokeGradientStop, TrendLineProps, TrendLineStrokeStyle } from "./core/types/cartesian";
export { computeLinearRegression, computeTrendSegment, interpolateTrendSegment } from "./core/analytics/trend";
export type { LinearRegression, TrendPoint, TrendSegment } from "./core/analytics/trend";
export { withBollingerBands } from "./core/analytics/bollinger";
export { useAnimatedYDomains } from "./kit/cartesian/use-animated-y-domains";
export type { UseAnimatedYDomainsOptions } from "./core/cartesian/animated-y-domains";
export type { BollingerBandsOptions } from "./core/analytics/bollinger";
export type { SeriesMarkersProps, MarkerGroupProps } from "./children";
export { SeriesPointMarker } from "./series-point-marker";
export type { SeriesPointMarkerProps } from "./core/types/cartesian";
export type { SeriesPointMarkerStyle } from "./core/types/cartesian";
export { ReferenceArea } from "./reference-area";
export type { ReferenceAreaProps, ReferenceAreaStrokeStyle, ReferenceAreaIfOverflow, ReferenceAreaRect } from "./core/types/reference-area";
export { SegmentBackground, SegmentLineFrom, SegmentLineTo } from "./segment";
export type { SegmentBackgroundProps, SegmentLineProps, SegmentLineVariant } from "./core/types/cartesian";
export type { IndicatorFadeEdges, ProjectionPoint, ProjectionStrokeStyle, ProjectionLineConfig } from "./core/types/cartesian";
export type { ReferenceAreaConfig } from "./core/types/context";
export { useActiveMarkers } from "./kit/tooltip/use-active-markers";
export { ProfitLossLegend } from "./profit-loss-legend";
export type { ProfitLossLegendProps } from "./core/types/legend";
export type { ProfitLossSegment } from "./core/profit-loss";
export { ProfitLossLegendHoverProvider, useProfitLossLegendHover } from "./kit/legend/legend";
// Curves for the `curve` prop of Line, Area, PatternArea and ProfitLossLine (d3-shape's factories), so a chart needs no d3 import.
export { curveBasis, curveBumpX, curveCardinal, curveCatmullRom, curveLinear, curveMonotoneX, curveNatural, curveStep, curveStepAfter, curveStepBefore } from "d3-shape";
export type { CurveFactory } from "d3-shape";

// Range overlays: Band, Deadline, Weekends and the finance-style ChartCrosshair, composed as children of the time-series charts above.
export { Band, ChartCrosshair, CHART_CLIP_PASSTHROUGH, Deadline, extractBandConfigs, extractProjectionLineConfigs, Weekends } from "./range-overlays";
export type { BandConfig, BandFadeEdges, BandFillType, BandProps, BandStrokeProps, BackgroundPatternLayerProps, ChartCrosshairProps, DeadlineDate, DeadlineFillType, DeadlineProps, WeekendsFillType, WeekendsProps } from "./core/types/range-overlays";
export { computeWeekendIndexRuns, computeWeekendRanges, DEFAULT_WEEKEND_DAYS, isWeekendDate } from "./core/cartesian/date-ranges";
export type { DateRange, DateRangeAlign, WeekdayIndex } from "./core/cartesian/date-ranges";
export { BackgroundPatternLayer, TooltipHeader, useChartInteraction } from "./overlay-views";
export type { TooltipHeaderProps } from "./overlay-views";

// Selection and brush
export type { ChartSelection } from "./core/types/cartesian";
export { ChartBrush, BrushLayout as ChartBrushLayout } from "./kit/brush";
export type {
  ChartBrushLayoutProps,
  ChartBrushProps,
} from "./kit/brush";
export type {
  ChartBrushLayoutState,
  ChartBrushPatternPreset,
  ChartBrushSelection,
  ChartBrushSelectionPattern,
  ChartBrushTrackOverlayStyle,
} from "./core/types/brush";
export { ChartBrushSelectionOverlay, ChartBrushTrackOverlay } from "./kit/brush";
export type { ChartBrushSelectionOverlayProps, ChartBrushTrackOverlayProps } from "./core/types/brush";

// Linked charts (syncId, syncY, activeIndex) and zoom
export { ChartZoom, TooltipDetail } from "./kit/link";
export type { TooltipDetailProps } from "./kit/link";
export type { ChartLinkProps, ChartWindow, ChartZoomProps } from "./core/types/link";

// ---------------------------------------------------------------------------
// Polar and other chart families
// ---------------------------------------------------------------------------

// Pie
export { PieChart, DEFAULT_HOVER_OFFSET } from "./pie-chart";
export { PieSlice, defaultPieColors, usePieStable, PieProvider, usePie, usePieHover } from "./pie/model";
export type { PieChartProps, PieSliceHoverEffect } from "./pie-chart";
export type { PieSliceProps, PieData, PieArcData } from "./core/types/pie";
export type { PieContextValue } from "./pie/model";
export { PieCenter, PieCenterShell } from "./pie/center";
export type { PieCenterProps, PieCenterShellProps } from "./pie/center";
// Ring
export { RingChart, Ring, RingGrid, RingLabels } from "./ring-chart";
export { defaultRingColors, useRingStable, useRing, useRingHover, RingProvider } from "./ring/model";
export type { RingChartProps, RingProps, RingData, RingGridProps, RingLabelsProps, RingLineCap, RingContextValue } from "./ring-chart";
export { RingCenter } from "./ring/center";
export type { RingCenterProps } from "./ring/center";
// Radar
export { RadarChart, RadarGrid, RadarAxis, RadarLabels, RadarArea, DEFAULT_RADAR_COLORS as defaultRadarColors } from "./radar-chart";
export type { RadarChartProps, RadarGridProps, RadarAxisProps, RadarLabelsProps, RadarAreaProps, RadarData, RadarMetric } from "./radar-chart";
export { RadarProvider, radarCssVars, useRadar, useRadarHover, useRadarStable } from "./radar/context";
export type { RadarContextValue } from "./core/types/radar";
// Radial (24h clocks, categories and time series around a circle or a partial arc, angular ring bars): its barrel.
export * from "./radial";
// Gauge
export { Gauge } from "./gauge";
export type { GaugeProps, GaugeArcStyle, GaugeCenterDiscOptions, GaugeDotsOptions, GaugeGlowOptions, GaugeLabelAlign, GaugeLabelPlacement, GaugeNeedleOptions, GaugeNeedleVariant, GaugeOrientation, GaugeProgressRingOptions, GaugeRulerLabelOptions, GaugeRulerOptions, GaugeRulerPosition, GaugeSectorOptions, GaugeZone, GaugeZoneDisplay } from "./gauge";
// Funnel
export { FunnelChart } from "./funnel-chart";
export type { FunnelChartProps } from "./funnel-chart";
export type { FunnelStage, FunnelGradientStop } from "./core/types/funnel";
// TanStack Charts catalog families on the mark chart (core/mark-chart): treemap, waffle, marimekko, stream, diverging bars, tree, network
export * from "./treemap";
export * from "./waffle";
export * from "./marimekko";
export * from "./stream";
export * from "./diverging";
export * from "./tree";
export * from "./network";
// Heatmap
export { HeatmapChart, HeatmapChartLoading, HeatmapCells, HeatmapXAxis, HeatmapYAxis, HeatmapTooltip, HeatmapLegend, HeatmapSeparator, HeatmapInteractionProvider, HeatmapInteractionBoundary, useHeatmap, HEATMAP_LEGEND_LEVELS, HEATMAP_DEFAULT_LEVEL_COLORS, HEATMAP_DEFAULT_LEVEL_STYLES, HEATMAP_DAY_LABELS } from "./heatmap-chart";
export type { HeatmapChartProps, HeatmapChartLoadingProps, HeatmapCellsProps, HeatmapXAxisProps, HeatmapYAxisProps, HeatmapTooltipProps, HeatmapLegendProps, HeatmapLegendVariant, HeatmapSeparatorProps, HeatmapContextValue, HeatmapLayout, HeatmapBin, HeatmapColumn, HeatmapWeekStartDay, HeatmapYAxisLabelFormat, HeatmapYAxisTickFilter, HeatmapLevelColors, HeatmapLevelStyle, HeatmapLevelStyles, HeatmapLevelFillMode } from "./heatmap-chart";
export { HEATMAP_MONTHS_ONE_YEAR, HEATMAP_MONTHS_SIX, HEATMAP_WEEKS_ONE_YEAR, getHeatmapCalendarRangeStart, getHeatmapWeekCount, getHeatmapWeekStartAlignedToRange, getHeatmapWeekStartSunday, getHeatmapYearStartMonth, resolveHeatmapWeekRange } from "./core/heatmap/calendar";
export { filterHeatmapColumns, getHeatmapColumnMonthAnchor, getHeatmapTimeExtent, inferHeatmapCalendarRangeStart } from "./core/heatmap/columns";
export { formatHeatmapYAxisLabel, getHeatmapDayLabels, shouldShowHeatmapYAxisTick } from "./core/heatmap/day-labels";
export { formatHeatmapContributionLabel, formatHeatmapTooltipDate, formatHeatmapTooltipWeekday } from "./core/heatmap/format";
export { getHeatmapContributionLevel } from "./core/heatmap/contribution-level";
export { buildHeatmapRowOpacity } from "./core/heatmap/hover-style";
export { buildHeatmapLegendGradient } from "./core/heatmap/legend-gradient";
export { getHeatmapSeparatorColumnIndices } from "./core/heatmap/separators";
export type { HeatmapWeekRange } from "./core/heatmap/calendar";
export { buildHeatmapColorScale, buildHeatmapColorScaleFromStyles, buildHeatmapFillScale, defaultHeatmapColorScale, defaultHeatmapFillScale, heatmapLevelPatternId, isHeatmapLevelPattern, levelStylesFromColors, resolveHeatmapLevelStyles } from "./core/heatmap/colors";
export { HeatmapProvider } from "./heatmap/context";
export { heatmapCssVars, levelColorsFromStyles } from "./core/heatmap/css-vars";
// Sunburst
export { SunburstChart, SunburstSegment, SunburstCenter, SunburstLabels, SunburstHint, SunburstBreadcrumb } from "./sunburst-chart";
export type { SunburstChartProps, SunburstSegmentProps, SunburstCenterProps, SunburstLabelsProps, SunburstHintContext, SunburstHintProps, SunburstBreadcrumbItem, SunburstBreadcrumbProps } from "./sunburst-chart";
export type { SunburstEnterTransition } from "./core/types/sunburst";
export { sumValues, buildArcs, ringOptions, clockwiseFraction, defaultSunburstGrowPadding, useSunburstBreadcrumbItems } from "./sunburst-chart";
export type { SunburstNode, ArcDatum, Focus } from "./sunburst-chart";
export { sunburstCssVars, defaultSunburstColors, opacityForRelativeDepth } from "./sunburst-chart";
export { useSunburstHover, useSunburstStable } from "./sunburst-chart";
export { geometryFor, lerpGeometry, transitionGeometry, arcPath, centroidAngle, geomCentroidAngle, geomCentroidRadius, localProgress, buildSunburstEnterTiming, buildRevealSchedule, segmentRevealFromRingSweep, buildRevealDelays } from "./core/helpers";
export type { ArcGeometry, SunburstEnterTiming, SunburstRevealSchedule, SunburstSegmentEnterDelays } from "./core/helpers";
// Sankey
export { SankeyChart, SankeyLink, SankeyNode, SankeyTooltip } from "./sankey-chart";
export type { SankeyChartProps, SankeyData, SankeyLabelOrientation, SankeyLinkProps, SankeyNodeProps, SankeyTooltipProps } from "./sankey-chart";
export { SankeyProvider, useSankey } from "./sankey/context";
export type { SankeyContextValue } from "./sankey/context";
export type { SankeyTooltipData } from "./core/types/sankey";
export type { SankeyLinkDatum, SankeyNodeDatum } from "./core/sankey/types";
// Choropleth
export { ChoroplethChart, ChoroplethFeatureComponent, ChoroplethTooltip, ChoroplethGraticule, ChoroplethDotGrid, ChoroplethMarker, ChoroplethBackground, useChoroplethZoom, useChoroplethCamera, useChoropleth, ChoroplethProvider } from "./choropleth-chart";
export type { ChoroplethChartProps, ChoroplethFeatureProps, ChoroplethTooltipProps, ChoroplethGraticuleProps, ChoroplethContextValue, ChoroplethFeature, ChoroplethFeatureProperties, ChoroplethTooltipData } from "./choropleth-chart";
export type { TransformMatrix, ChoroplethBackgroundProps, ChoroplethCameraApi, ChoroplethDotGridProps, ChoroplethDotLattice, ChoroplethFocusView, ChoroplethMarkerProps, ChoroplethMarkerPulse, ChoroplethMarkerShape, ChoroplethMarkerTooltipData, ChoroplethOverviewView, ChoroplethPerspective, ChoroplethViewSide, ChoroplethZoomTransition } from "./core/types/choropleth";
export { choroplethCssVars, defaultChoroplethColors, pieCssVars, ringCssVars, sankeyCssVars } from "./core/css-vars";

// Sparklines: tiny line, area and bar charts for tables and stat cards (no chart engine: core/sparkline/controller.ts)
export * from "./sparkline";

// ---------------------------------------------------------------------------
// Spatial charts (TanStack Charts' spatial and geo marks, on core/spatial/controller.ts): each family's barrel, its names listed
// ---------------------------------------------------------------------------

export { HexbinCells, HexbinChart, HexbinChartLoading, HexbinGrid, HexbinLegend, HexbinTooltip, HexbinXAxis, HexbinYAxis } from "./hexbin";
export type { HexbinAxisProps, HexbinBin, HexbinCellsProps, HexbinChartLoadingProps, HexbinChartProps, HexbinGridProps, HexbinLegendProps, HexbinReduce, HexbinTooltipArgs, HexbinTooltipProps } from "./hexbin";
export { DensityChart, DensityChartLoading, DensityContours, DensityGrid, DensityLegend, DensityPoints, DensityTooltip, DensityXAxis, DensityYAxis } from "./density";
export type { DensityAxisProps, DensityChartLoadingProps, DensityChartProps, DensityContoursProps, DensityGridProps, DensityLegendProps, DensityPointsProps, DensityTooltipArgs, DensityTooltipProps } from "./density";
export { BubbleMapBubbles, BubbleMapChart, BubbleMapChartLoading, BubbleMapGraticule, BubbleMapLand, BubbleMapLegend, BubbleMapTooltip } from "./bubble-map";
export type { BubbleMapBubblesProps, BubbleMapChartLoadingProps, BubbleMapChartProps, BubbleMapGraticuleProps, BubbleMapLandProps, BubbleMapLegendProps, BubbleMapTooltipArgs, BubbleMapTooltipProps, SpatialProjection } from "./bubble-map";
export { RouteMapChart, RouteMapChartLoading, RouteMapGraticule, RouteMapLand, RouteMapLegend, RouteMapPlaces, RouteMapRoutes, RouteMapTooltip } from "./route-map";
export type { RouteMapChartLoadingProps, RouteMapChartProps, RouteMapData, RouteMapGraticuleProps, RouteMapLandProps, RouteMapLegendProps, RouteMapPlace, RouteMapPlacesProps, RouteMapRoute, RouteMapRoutesProps, RouteMapTooltipArgs, RouteMapTooltipProps } from "./route-map";
export { GlobeChart, GlobeChartLoading, GlobeGraticule, GlobeLand, GlobeMarkers, GlobeSphere, GlobeTooltip } from "./globe";
export type { GlobeChartLoadingProps, GlobeChartProps, GlobeGraticuleProps, GlobeLandProps, GlobeMarkersProps, GlobeSphereProps, GlobeTooltipArgs, GlobeTooltipProps } from "./globe";
export { VectorFieldArrows, VectorFieldChart, VectorFieldChartLoading, VectorFieldGrid, VectorFieldLegend, VectorFieldTooltip, VectorFieldXAxis, VectorFieldYAxis } from "./vector-field";
export type { VectorFieldArrowsProps, VectorFieldAxisProps, VectorFieldChartLoadingProps, VectorFieldChartProps, VectorFieldGridProps, VectorFieldLegendProps, VectorFieldTooltipArgs, VectorFieldTooltipProps, VectorFieldVector } from "./vector-field";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

// Tooltip
export type { ChartTooltipProps } from "./kit/types";
export type { IndicatorWidth } from "./core/types/cartesian";
export { DateTicker, MarkerTooltipContent, TooltipBox, TooltipContent } from "./kit/tooltip/tooltip-primitives";
export type { DateTickerProps, TooltipRow } from "./core/types/tooltip";
export type { MarkerTooltipContentProps, MarkerTooltipItem, TooltipBoxProps, TooltipContentProps } from "./kit/tooltip/tooltip-primitives";
export { TooltipDot, TooltipIndicator } from "./kit/tooltip/tooltip-carriers";
export type { TooltipDotProps, TooltipIndicatorProps } from "./core/types/tooltip";
// Legend
export { ChartLegend } from "./kit/legend/chart-legend";
// Accessibility: any chart's data as an HTML table (visually hidden, or behind a "View as table" toggle)
export { ChartDataTable } from "./kit/data-table";
export type { ChartDataTableProps } from "./core/a11y/data-table";
export type { ChartDescription, DescribedColumn, DescribedRow } from "./core/a11y/describe";
export type { ChartLegendProps } from "./kit/legend/chart-legend";
export type { LegendItem } from "./core/types/legend";
export { ChartLegendHoverProvider, useChartLegendHover } from "./kit/legend/legend";
export {
  Legend,
  LegendItemComponent,
  LegendLabel,
  LegendMarker,
  LegendProgress,
  LegendValue,
  legendCssVars,
  useLegend,
  useLegendItem,
} from "./kit/legend/legend-compose";
export type {
  LegendContextValue,
  LegendItemContextValue,
  LegendItemData,
  LegendLabelProps,
  LegendMarkerProps,
  LegendProgressProps,
  LegendValueProps,
} from "./core/types/legend";
export type {
  LegendItemProps,
  LegendProps,
} from "./kit/legend/legend-compose";
// Fills: gradients and patterns
export {
  GradientDarkgreenGreen,
  GradientLightgreenGreen,
  GradientOrangeRed,
  GradientPinkBlue,
  GradientPinkRed,
  GradientPurpleOrange,
  GradientPurpleTeal,
  GradientSteelPurple,
  GradientTealBlue,
  LinearGradient,
  RadialGradient,
} from "./kit/gradients";
export type { GradientStop } from "./core/types/gradients";
export type { LinearGradientProps, RadialGradientProps } from "./kit/gradients";
export { CirclesImpl as PatternCircles } from "./kit/pattern/pattern-circles";
export { PatternHexagons } from "./kit/pattern/pattern-public-hexagons";
export { PatternLines } from "./kit/pattern/pattern-lines-view";
export { WavesImpl as PatternWaves } from "./kit/pattern/pattern-waves";
export { isCirclePattern, isCirclesPattern, patternPresetTileSize, PATTERN_PRESET_IDS, PATTERN_PRESETS, resolvePatternPresetId } from "./core/pattern/pattern-preset-helpers";
export { renderPatternPreset } from "./kit/pattern/pattern-preset-render";
export { PatternPreset, PatternTile } from "./kit/pattern/pattern-preset";
export type { PatternTileProps } from "./kit/pattern/pattern-preset";
export type { PatternPresetProps } from "./core/types/pattern";
export type {
  LegacyPatternPresetId,
  PatternPresetFamily,
  PatternPresetId,
  PatternPresetKey,
  PatternPresetMeta,
  PatternPresetOptions,
} from "./core/pattern/pattern-preset-helpers";
// Centre statistic
export {
  ChartStatFlow,
  chartCenterContainerClassName,
  chartCenterLabelClassName,
  chartCenterValueClassName,
  defaultChartStatFlowFormat,
} from "./chart-stat-flow";
export type { ChartStatFlowFormat } from "./core/types/stat-flow";
export type { ChartStatFlowProps } from "./chart-stat-flow";
// Loading and entrance
export { LineLoadingSweep, BarLoadingSkeleton } from "./loading-sweep";
export type { LineLoadingSweepProps, BarLoadingSkeletonProps } from "./loading-sweep";
export { LineLoadingPulseStroke } from "./line-loading-pulse";
export type { LineLoadingPulseStrokeProps, LineLoadingPulseMode } from "./line-loading-pulse";
export { ChartLoadingLabel } from "./chart-loading-label";
export type { ChartLoadingLabelProps } from "./core/types/loading";
export { ChartRevealClip } from "./chart-reveal-clip";
export type { ChartRevealClipProps } from "./chart-reveal-clip";
export { generateChartSkeletonData } from "./core/loading/generate-chart-skeleton-data";
export type { GenerateChartSkeletonDataOptions } from "./core/loading/generate-chart-skeleton-data";
// Export: a chart as a PNG or a standalone SVG file (core/export/*)
export { ChartExportButton, createChartExporter, useChartExport } from "./export";
export type { ChartExportButtonProps } from "./export";
export type { ChartDownloadOptions, ChartExporter, ChartExportFormat, ChartExportOptions } from "./core/types/export";
// The dense marks' canvas renderer (`renderer={canvasRenderer}` on Line, Area, Scatter and HeatmapCells, core/canvas/): bundled only when imported
export { canvasRenderer } from "./core/canvas/mark-renderer";
export type { ChartCanvasRenderer, ChartMarkRenderer } from "./core/canvas/renderer";
// Configuration and lifecycle
export {
  ChartConfigProvider,
  StaticChartPreviewProvider,
  useChartConfig,
  useStaticChartPreview,
} from "./kit/cartesian/chart-config";
export { DEFAULT_CHART_CONFIG } from "./core/cartesian/chart-config";
export type { ChartConfigProviderProps } from "./kit/cartesian/chart-config";
export type { ChartConfigValue } from "./core/types/context";
export type { SpringConfig } from "./core/types/cartesian";
export {
  DEFAULT_ANIMATION_DURATION_MS,
  DEFAULT_ANIMATION_EASING,
  DEFAULT_CHART_ENTER_TRANSITION,
  DEFAULT_CHART_STATUS,
  DEFAULT_Y_DOMAIN_TWEEN_MS,
  Y_AXIS_DEFAULT_TICK_COUNT,
  Y_AXIS_MAX_TICK_COUNT,
  Y_AXIS_MIN_TICK_COUNT,
  isChartInteractionPhase,
  resolveRestingChartPhase,
  resolveYAxisTickCount,
} from "./core/motion/phase";
export type { ChartPhase, ChartStatus, LoadingStyle, YAxisOrientation } from "./core/motion/phase";

// ---------------------------------------------------------------------------
// Hooks and context
// ---------------------------------------------------------------------------

export {
  ChartProvider,
  useChart,
  useChartHover,
  useChartStable,
  useYScale,
} from "./kit/cartesian/chart-context";
export {
  chartCssVars,
  defaultScatterColors,
} from "./core/cartesian/chart-context";
export type {
  ChartContextValue,
  ChartHoverContextValue,
  ChartStableContextValue,
} from "./kit/cartesian/chart-context";
export type {
  LineConfig,
  Margin,
  TooltipData,
} from "./core/types/context";

// ---------------------------------------------------------------------------
// Utilities (scales, projections, bklit-ui helper functions)
// ---------------------------------------------------------------------------

export {
  CHART_SCALE_VARS,
  chartScaleCssVars,
} from "./core/css-vars";
export type { ChartScaleVars } from "./core/css-vars";
export {
  applyYDomainOverride,
  computeYDomainsByAxis,
  getPrimaryYScale,
  isLoadingChromePhase,
  isYDomainTweenPhase,
  mergeYDomainRecords,
  niceYDomain,
  resolveFloatingYDomain,
  shouldTweenYDomain,
} from "./core/cartesian/y-domain-utils";
export type { YDomain, YDomainOverride } from "./core/cartesian/y-domain-utils";
export { DEFAULT_Y_AXIS_ID } from "./core/cartesian/series";
export { buildProjectionPath, computeProjectionAnchorTangentSlope, buildHorizontalTangentBezierPath, projectionValueExtents, projectionDateExtents } from "./core/projection-utils";
export type { ProjectionMode, ProjectionAutoMethod, ProjectionCurveKind, ProjectionPathDensity, BuildProjectionPathOptions } from "./core/projection-utils";
export {
  PROFIT_LOSS_LEGEND_ITEMS,
  PROFIT_LOSS_NEGATIVE_COLOR,
  PROFIT_LOSS_POSITIVE_COLOR,
  PROFIT_LOSS_TOOLTIP_LABEL_FALLBACK,
  profitLossColor,
  resolveProfitLossTooltipLabel,
} from "./core/profit-loss";
export {
  DEFAULT_CHART_LIFECYCLE,
  computeReferenceAreaRect,
  getSeriesMarkerVisualExtent,
  indicatorFadeGradientStops,
  mergeProjectionXDomainMax,
  mergeProjectionYDomain,
  resolveLineLoadingPulseMode,
  resolveTooltipBoxMotion,
  resolveVerticalFadeSides,
  splitProfitLossSegments,
} from "./core/helpers";
export type { ComputeReferenceAreaRectOptions, IndicatorFadeGradientStop, VerticalFadeSides } from "./core/helpers";
export { getSkeletonHeights } from "./core/markup/loading";

// ---------------------------------------------------------------------------
// Distribution charts (core/distribution/), one barrel per family
// ---------------------------------------------------------------------------

// Histogram
export { Histogram, HistogramChart, HistogramChartLoading, HistogramTooltip, HistogramXAxis, HistogramYAxis } from "./histogram";
export type { HistogramAxisProps, HistogramChartLoadingProps, HistogramChartProps, HistogramPoint, HistogramPointSeries, HistogramProps, HistogramTooltipProps } from "./histogram";
// BoxPlot
export { BoxPlot, BoxPlotChart, BoxPlotChartLoading, BoxPlotTooltip, BoxPlotXAxis, BoxPlotYAxis } from "./box-plot";
export type { BoxPlotAxisProps, BoxPlotChartLoadingProps, BoxPlotChartProps, BoxPlotPoint, BoxPlotProps, BoxPlotSummary, BoxPlotTooltipProps } from "./box-plot";
// Violin
export { Violin, ViolinChart, ViolinChartLoading, ViolinTooltip, ViolinXAxis, ViolinYAxis } from "./violin";
export type { ViolinAxisProps, ViolinChartLoadingProps, ViolinChartProps, ViolinPoint, ViolinProps, ViolinSummary, ViolinTooltipProps } from "./violin";
// Beeswarm
export { Beeswarm, BeeswarmChart, BeeswarmChartLoading, BeeswarmTooltip, BeeswarmXAxis, BeeswarmYAxis } from "./beeswarm";
export type { BeeswarmAxisProps, BeeswarmChartLoadingProps, BeeswarmChartProps, BeeswarmPoint, BeeswarmProps, BeeswarmTooltipProps } from "./beeswarm";
// Ecdf
export { Ecdf, EcdfChart, EcdfChartLoading, EcdfTooltip, EcdfXAxis, EcdfYAxis } from "./ecdf";
export type { EcdfAxisProps, EcdfChartLoadingProps, EcdfChartProps, EcdfPoint, EcdfPointSeries, EcdfProps, EcdfTooltipProps } from "./ecdf";
// Ridgeline
export { Ridgeline, RidgelineChart, RidgelineChartLoading, RidgelineTooltip, RidgelineXAxis, RidgelineYAxis } from "./ridgeline";
export type { RidgelineAxisProps, RidgelineChartLoadingProps, RidgelineChartProps, RidgelinePoint, RidgelineProps, RidgelineTooltipProps } from "./ridgeline";
// The plot families (core/plot): one barrel each.
export * from "./gantt";
export * from "./slope";
export * from "./bump";
export * from "./ribbon";
export * from "./error-bar";
export * from "./dumbbell";
export * from "./lollipop";
export * from "./waterfall";
