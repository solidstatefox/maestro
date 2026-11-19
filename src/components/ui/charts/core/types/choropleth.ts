import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeoPermissibleObjects } from "d3-geo";
import type { ReadyStore } from "../entrance/ready-gate";
import type { EnterTransition } from "../motion/phase";
import type { PatternPresetId, PatternPresetOptions } from "../pattern/pattern-preset-helpers";

/** Zoom and pan state of the map, in the shape of a 2D affine matrix. */
export interface TransformMatrix {
  /** Horizontal scale; the zoom level. */
  readonly scaleX: number;
  /** Vertical scale; keep it equal to `scaleX`. */
  readonly scaleY: number;
  /** Horizontal pan in pixels. */
  readonly translateX: number;
  /** Vertical pan in pixels. */
  readonly translateY: number;
  /** Horizontal skew; unused, keep at 0. */
  readonly skewX: number;
  /** Vertical skew; unused, keep at 0. */
  readonly skewY: number;
}

/** Properties of a GeoJSON feature. Other keys are allowed and passed through to your callbacks. */
export interface ChoroplethFeatureProperties {
  /** Display name of the feature, used by the default tooltip. */
  readonly name?: string;
  /** Optional identifier of the feature. */
  readonly id?: string | number;
  readonly [key: string]: unknown;
}

/** A GeoJSON feature of the map, with `name` and `id` properties. */
export type ChoroplethFeature = Feature<Geometry, ChoroplethFeatureProperties | null>;

export interface Margin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Props of `ChoroplethChart`. */
export interface ChoroplethChartProps<Node> {
  /** GeoJSON `FeatureCollection` to draw, with one feature per region. Pass GeoJSON objects: TopoJSON is not read, so convert it first (for example with `topojson-client`'s `feature()`). */
  readonly data: FeatureCollection<Geometry, ChoroplethFeatureProperties>;
  /**
   * Chart margins in pixels. Any side you omit keeps its default.
   * @default { top: 0, right: 0, bottom: 0, left: 0 }
   */
  readonly margin?: Partial<Margin>;
  /**
   * Duration of the enter animation in milliseconds.
   * @default 800
   */
  readonly animationDuration?: number;
  /**
   * Enter transition (a spring or a cubic-bezier tween), in seconds.
   * @default a tween of `animationDuration` on the reveal curve
   */
  readonly enterTransition?: EnterTransition;
  /**
   * Changing this value replays the enter animation.
   * @default ""
   */
  readonly revealSignature?: string;
  /**
   * Aspect ratio of the chart as "width / height".
   * @default "16 / 9"
   */
  readonly aspectRatio?: string;
  /** Projection scale of the Mercator projection. When omitted it follows the chart width. */
  readonly scale?: number;
  /**
   * Geographic center of the map as `[longitude, latitude]`.
   * @default [0, 20]
   */
  readonly center?: [number, number];
  /** Pixel offset of the projection center as `[x, y]`. When omitted the map is centered in the chart. */
  readonly translate?: [number, number];
  /**
   * Enable zoom and pan with the mouse wheel, pinch, and drag.
   * @default false
   */
  readonly zoomEnabled?: boolean;
  /**
   * Minimum zoom scale.
   * @default 0.5
   */
  readonly zoomMin?: number;
  /**
   * Maximum zoom scale.
   * @default 4
   */
  readonly zoomMax?: number;
  /**
   * Initial zoom transform.
   * @default the identity transform (no zoom, no pan)
   */
  readonly initialZoom?: TransformMatrix;
  /**
   * Additional class name for the chart container.
   * @default ""
   */
  readonly className?: string;
  /**
   * Click a region or a marker to fly the camera to it; click it again, the empty map, or press Escape to fly back.
   * @default false
   */
  readonly clickToZoom?: boolean;
  /**
   * Largest camera scale when it frames a region.
   * @default 6
   */
  readonly focusMaxZoom?: number;
  /**
   * Duration and easing of the click-to-zoom flight and of the camera's angle changes.
   * @default { duration: 700, ease: [0.83, 0, 0.17, 1] }
   */
  readonly zoomTransition?: ChoroplethZoomTransition;
  /** A 3D camera: one view for the zoomed-out map and one for a focused region (for example flat, swinging to look from the east once you zoom in). */
  readonly perspective?: ChoroplethPerspective;
  /** `ChoroplethFeatureComponent` or `ChoroplethDotGrid`, `ChoroplethGraticule`, `ChoroplethMarker`, `ChoroplethBackground` and `ChoroplethTooltip` to configure the map, plus any elements that call `useChoropleth()`, `useChoroplethZoom()` or `useChoroplethCamera()`. */
  readonly children: Node;
  /**
   * Accessible label of the chart.
   * @default "Choropleth chart"
   */
  readonly ariaLabel?: string;
  /** Longer accessible description of the chart. */
  readonly ariaDescription?: string;
}

/** Props of `ChoroplethFeatureComponent`. */
export interface ChoroplethFeatureProps<Node = unknown> {
  /**
   * Solid fill color for every feature. Takes precedence over `getFeatureColor`.
   * @default a cycle of the `--chart-scale-01` to `--chart-scale-05` variables, by feature index
   */
  readonly fill?: string;
  /**
   * Border color of the features.
   * @default "var(--bkm-background)"
   */
  readonly stroke?: string;
  /**
   * Border width of the features in pixels.
   * @default 0.5
   */
  readonly strokeWidth?: number;
  /**
   * Opacity of the other features while one is hovered or focused.
   * @default 0.4
   */
  readonly fadedOpacity?: number;
  /** Returns a fill color per feature. Used when `fill` is not set. */
  readonly getFeatureColor?: (feature: ChoroplethFeature, index: number) => string;
  /** Pattern definitions (SVG `<pattern>` elements) that features can reference by id through `getFeaturePattern`. */
  readonly patterns?: Node;
  /** Returns the id of a pattern to fill a feature with, or `null`/`undefined` to use the color. A pattern wins over `fill` and `getFeatureColor`. */
  readonly getFeaturePattern?: (feature: ChoroplethFeature, index: number) => string | null | undefined;
}

/** Props of `ChoroplethTooltip`. */
export interface ChoroplethTooltipProps<Node = unknown, Style = unknown> {
  /** Custom tooltip content for a feature. Replaces the default name and value. */
  readonly content?: (props: { feature: ChoroplethFeature; index: number }) => Node;
  /**
   * Formats the value in the default tooltip.
   * @default integer formatting
   */
  readonly formatValue?: (value: number) => string;
  /**
   * Returns the tooltip title of a feature.
   * @default the feature's `properties.name`, or "Feature <index>"
   */
  readonly getFeatureName?: (feature: ChoroplethFeature, index: number) => string;
  /** Returns the value shown for a feature. When it returns `undefined` the value row is hidden. */
  readonly getFeatureValue?: (feature: ChoroplethFeature, index: number) => number | undefined;
  /**
   * Label of the value row.
   * @default "Value"
   */
  readonly valueLabel?: string;
  /** Additional class name for the tooltip panel. */
  readonly className?: string;
  /** Inline styles for the tooltip panel, for example a blur or border. */
  readonly panelStyle?: Style;
  /** Background color of the tooltip panel (a CSS variable or a color). */
  readonly backgroundColor?: string;
  /**
   * Grace period in milliseconds before the tooltip hides when the pointer leaves a feature for the sea or a border gap: a move onto the
   * next feature within it carries the panel over instead of fading it out and back in.
   * @default 120
   */
  readonly hideDelay?: number;
}

/** Props of `ChoroplethGraticule`. */
export interface ChoroplethGraticuleProps {
  /**
   * Color of the graticule lines.
   * @default "var(--chart-graticule)", the theme's `--border`
   */
  readonly stroke?: string;
  /**
   * Width of the graticule lines in pixels.
   * @default 0.5
   */
  readonly strokeWidth?: number;
  /**
   * Spacing of the lines as `[longitude, latitude]` in degrees.
   * @default [10, 10]
   */
  readonly step?: [number, number];
  /**
   * Fade the lines out while the camera is focused on a region or a marker.
   * @default true
   */
  readonly hideOnFocus?: boolean;
}

/** The side the camera looks from. `"flat"` is a straight-down view. */
export type ChoroplethViewSide = "west" | "flat" | "east";

/** The camera while the map is zoomed out. */
export interface ChoroplethOverviewView {
  /**
   * Where the camera looks from. `"pointer"` swings between a west and an east view as the pointer crosses the map.
   * @default "flat"
   */
  readonly view?: ChoroplethViewSide | "pointer";
  /**
   * Side-to-side rotation in degrees.
   * @default 18
   */
  readonly yaw?: number;
  /**
   * Lean back in degrees (0 is top-down).
   * @default 0
   */
  readonly tilt?: number;
}

/** The camera once a region or a marker is clicked. */
export interface ChoroplethFocusView {
  /**
   * Where the camera looks from. `"auto"` looks from the side of the map the focused target is on.
   * @default the overview's side
   */
  readonly view?: ChoroplethViewSide | "auto";
  /**
   * Side-to-side rotation in degrees.
   * @default the overview's yaw
   */
  readonly yaw?: number;
  /**
   * Lean back in degrees.
   * @default the overview's tilt
   */
  readonly tilt?: number;
}

/** The 3D camera of `ChoroplethChart`'s `perspective`. */
export interface ChoroplethPerspective {
  /** The camera while zoomed out. */
  readonly overview?: ChoroplethOverviewView;
  /** The camera on a focused region or marker. */
  readonly focus?: ChoroplethFocusView;
  /**
   * CSS perspective distance in pixels: lower is more dramatic.
   * @default 1600
   */
  readonly depth?: number;
  /**
   * Fade the map into the chart's edges, as a percent of its width and height per side (0 to 45).
   * @default 0
   */
  readonly edgeFade?: number;
}

/** Duration and easing of `ChoroplethChart`'s camera flight. */
export interface ChoroplethZoomTransition {
  /**
   * Duration in milliseconds.
   * @default 700
   */
  readonly duration?: number;
  /**
   * Cubic-bezier control points.
   * @default [0.83, 0, 0.17, 1], an ease-in-out quint
   */
  readonly ease?: readonly [number, number, number, number];
}

/** What `useChoroplethCamera()` returns: the click-to-zoom camera's state and controls. */
export interface ChoroplethCameraApi {
  /** Whether `clickToZoom` is on. */
  readonly enabled: boolean;
  /** Key of the focused region (`feature:<index>`) or marker (`point:<label>`), or `null`. */
  readonly focusedKey: string | null;
  /** Index of the focused region, or `null` (nothing, or a marker, is focused). */
  readonly focusedFeatureIndex: number | null;
  /** The camera's scale cap (`focusMaxZoom`). */
  readonly maxZoom: number;
  /** Whether hovering `key` (`feature:<index>` or `point:<label>`) reacts: while zoomed in, only the focused target does (the rest stay clickable). */
  readonly isHoverable: (key: string) => boolean;
  /** Flies to the feature at `index` (its largest landmass); calling it on the focused one flies back. */
  readonly focusFeature: (index: number) => void;
  /** Flies to `[longitude, latitude]`, focused under `key`; calling it on the focused key flies back. */
  readonly focusPoint: (coordinates: [number, number], key: string) => void;
  /** Flies back to the overview. */
  readonly reset: () => void;
  /** Whether the last pointer press moved far enough to count as a drag. */
  readonly wasDrag: () => boolean;
}

/** How a dot grid lays its dots: `"hex"` offsets every other row, `"square"` is a plain grid. */
export type ChoroplethDotLattice = "hex" | "square";

/** Props of `ChoroplethDotGrid`. */
export interface ChoroplethDotGridProps {
  /**
   * Distance between dot centres in pixels.
   * @default 7
   */
  readonly gap?: number;
  /**
   * Dot diameter as a fraction of `gap` (0 to 1).
   * @default 0.7
   */
  readonly dotSize?: number;
  /**
   * Dot diameter (a fraction of `gap`) at the camera's largest zoom: the dots grow toward it as the camera zooms in.
   * @default 0.9
   */
  readonly zoomDotSize?: number;
  /**
   * Fade the ocean dots out while the camera is focused on a region.
   * @default true
   */
  readonly hideOceanOnFocus?: boolean;
  /**
   * The lattice: `"hex"` offsets every other row, `"square"` is a plain grid.
   * @default "hex"
   */
  readonly lattice?: ChoroplethDotLattice;
  /**
   * Draw the grid over the oceans too, so the whole map is one dot field.
   * @default true
   */
  readonly showOcean?: boolean;
  /**
   * Color of the ocean dots.
   * @default "var(--chart-scale-01)"
   */
  readonly oceanColor?: string;
  /**
   * Opacity of the ocean dots.
   * @default 0.55
   */
  readonly oceanOpacity?: number;
  /**
   * Size of the ocean dots relative to the land dots.
   * @default 0.55
   */
  readonly oceanDotScale?: number;
  /**
   * Fade the grid out toward the map's edges, as a percent of its width and height per side; `0` keeps hard edges.
   * @default 12
   */
  readonly edgeFade?: number;
  /** One color for every region's dots. Takes precedence over `getFeatureColor`. */
  readonly fill?: string;
  /** Returns the dot color of a region. */
  readonly getFeatureColor?: (feature: ChoroplethFeature, index: number) => string;
  /**
   * Opacity of the other regions while one is hovered.
   * @default 0.4
   */
  readonly fadedOpacity?: number;
}

/** The shape of a `ChoroplethMarker`; a `"pin"` puts its tip on the coordinate. */
export type ChoroplethMarkerShape = "circle" | "triangle" | "square" | "diamond" | "pin";

/** When a marker's ripple ring plays: never, while hovered or focused, or always. */
export type ChoroplethMarkerPulse = "none" | "hover" | "always";

/** Props of `ChoroplethMarker`. */
export interface ChoroplethMarkerProps {
  /** Where the marker sits, as `[longitude, latitude]`. */
  readonly coordinates: [number, number];
  /** Name shown in the tooltip (and beside the marker with `showLabel`). */
  readonly label: string;
  /**
   * The marker's shape.
   * @default "circle"
   */
  readonly shape?: ChoroplethMarkerShape;
  /**
   * Size in pixels; it stays this size while the map zooms.
   * @default 9
   */
  readonly size?: number;
  /**
   * Fill color.
   * @default "var(--foreground)"
   */
  readonly color?: string;
  /** Outline color; without it the marker has no outline. */
  readonly stroke?: string;
  /**
   * Outline width in pixels (with `stroke`).
   * @default 1.5
   */
  readonly strokeWidth?: number;
  /**
   * The ripple ring: off, while hovered or focused, or always. Reduced motion turns it off.
   * @default "hover"
   */
  readonly pulse?: ChoroplethMarkerPulse;
  /**
   * Blur of a soft outer glow, in pixels; `0` turns it off.
   * @default 0
   */
  readonly glow?: number;
  /**
   * Always draw the label beside the marker.
   * @default false
   */
  readonly showLabel?: boolean;
  /** Additional class name for the marker's group. */
  readonly className?: string;
}

/** `ChoroplethMarker`'s props on Vue, Svelte and Solid: `class` in place of `className`. */
export interface ChoroplethMarkerPortProps extends Omit<ChoroplethMarkerProps, "className"> {
  /** Additional class name for the marker's group. */
  readonly class?: string;
}

/** Props of `ChoroplethBackground`: the cartesian `Background`'s, plus `hideOnFocus`. */
export interface ChoroplethBackgroundProps extends PatternPresetOptions {
  /**
   * Pattern preset. `"none"` draws nothing.
   * @default "diagonal"
   */
  readonly pattern?: PatternPresetId;
  /**
   * Color of the pattern strokes.
   * @default "var(--chart-grid)"
   */
  readonly color?: string;
  /**
   * Draw the pattern.
   * @default true
   */
  readonly showFill?: boolean;
  /**
   * Opacity of the pattern.
   * @default 1
   */
  readonly opacity?: number;
  /**
   * Fade the pattern out at the left and right edges.
   * @default true
   */
  readonly fadeHorizontal?: boolean;
  /**
   * Fade the pattern out at the top and bottom edges.
   * @default true
   */
  readonly fadeVertical?: boolean;
  /**
   * Width of the horizontal fade zone, as a percent of the chart's width per edge (0 to 45).
   * @default 10
   */
  readonly fadeHorizontalLength?: number;
  /**
   * Height of the vertical fade zone, as a percent of the chart's height per edge (0 to 45).
   * @default 10
   */
  readonly fadeVerticalLength?: number;
  /**
   * Fade the pattern out while the camera is focused.
   * @default false
   */
  readonly hideOnFocus?: boolean;
}

/** A hovered or focused `ChoroplethMarker`, as the tooltip shows it. */
export interface ChoroplethMarkerTooltipData {
  /** The marker's label. */
  readonly label: string;
  /** The marker's `[longitude, latitude]`. */
  readonly coordinates: [number, number];
}

/** Tooltip anchor and feature while a tooltip is shown. */
export interface ChoroplethTooltipData {
  /** Index of the hovered feature in `data.features`. */
  readonly featureIndex: number;
  /** Horizontal tooltip anchor, relative to the chart. */
  readonly x: number;
  /** Vertical tooltip anchor, relative to the chart. */
  readonly y: number;
  /** The hovered feature. */
  readonly feature: ChoroplethFeature;
}

// Hover mirror lives in an external store (no chart-level React state): only useChoropleth() consumers re-render on focus.
export interface HoverStore {
  hovered: number | null;
  tooltip: ChoroplethTooltipData | null;
  /** The hovered or focused marker (set apart from the feature hover, which it clears). */
  marker: ChoroplethMarkerTooltipData | null;
  readonly setMarker: (marker: ChoroplethMarkerTooltipData | null) => void;
  version: number;
  readonly listeners: Set<() => void>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly set: (hovered: number | null, tooltip: ChoroplethTooltipData | null) => void;
}

/** Value returned by `useChoropleth()`. */
export interface ChoroplethContextValue<ContainerRef, SetTooltipData> {
  /** The features of `data`. */
  readonly features: ChoroplethFeature[];
  /** The `data` passed to the chart. */
  readonly featureCollection: FeatureCollection<Geometry, ChoroplethFeatureProperties>;
  /** SVG path string per feature index at the current size and zoom (`null` where a feature has no path). */
  readonly featurePaths: readonly (string | null)[];
  /** Returns the SVG path of a feature, or `undefined`. */
  readonly pathGenerator: (feature: ChoroplethFeature) => string | undefined;
  /** Returns the SVG path of any GeoJSON object in the chart's projection, or `null`. */
  readonly rawPathGenerator: (geo: GeoPermissibleObjects) => string | null;
  /** Projects `[longitude, latitude]` to chart pixels, or `null` when it cannot be projected. */
  readonly projectPoint: (coords: [number, number]) => [number, number] | null;
  /** Converts chart pixels back to `[longitude, latitude]`, or `null`. */
  readonly unprojectPoint?: (point: [number, number]) => [number, number] | null;
  /** Chart width in pixels. */
  width: number;
  /** Chart height in pixels. */
  height: number;
  /** Width inside the margins. */
  readonly innerWidth: number;
  /** Height inside the margins. */
  readonly innerHeight: number;
  /** Resolved chart margins. */
  readonly margin: Margin;
  /** Ref to the chart container element. */
  readonly containerRef: ContainerRef;
  /** `true` once the enter animation has finished. */
  readonly isLoaded: boolean;
  /** Enter animation duration in milliseconds. */
  readonly animationDuration: number;
  /** The `enterTransition` prop of the chart, if set. */
  readonly enterTransition?: EnterTransition;
  /** Increments when the enter animation replays. */
  readonly revealEpoch: number;
  /** Index of the hovered or focused feature, or `null`. */
  readonly hoveredFeatureIndex: number | null;
  /** Hovers a feature by index; `null` clears it. */
  readonly setHoveredFeatureIndex: (index: number | null) => void;
  /** Tooltip anchor and feature while one is shown, otherwise `null`. */
  readonly tooltipData: ChoroplethTooltipData | null;
  /** Sets or updates the tooltip data (accepts a value or an updater function). */
  readonly setTooltipData: SetTooltipData;
  /** The hovered or focused `ChoroplethMarker`, or `null`. */
  readonly markerTooltip: ChoroplethMarkerTooltipData | null;
  /** Internal hover store used by `useChoropleth`; do not use it directly. */
  readonly hoverStore?: HoverStore;
  /** Internal store behind `isLoaded`; do not use it directly. */
  readonly readyStore?: ReadyStore;
}
