import {
  DEFAULT_CIRCLE_RADIUS,
  DEFAULT_HEXAGON_SIZE,
  EIGHTH_DIVISOR,
  HALF_DIVISOR,
  HEXAGON_TILE_SPAN,
  QUARTER_DIVISOR,
  TILE_ORIGIN,
  WAVE_CONTROL_NUMERATOR,
} from "../pattern/pattern-geometry";
import { cx, pathForOrientation, VERTICAL_ORIENTATION } from "../pattern/pattern-line-utils";
import type { PatternOrientationType } from "../pattern/pattern-line-utils";
import { patternPresetDef } from "../pattern/pattern-preset-helpers";
import type { PatternPresetId, PatternPresetOptions } from "../pattern/pattern-preset-helpers";
import { el } from "./node";
import type { MarkupChild, MarkupNode } from "./node";

/** Line cap of a pattern stroke: `"square"`, `"butt"`, `"round"` or `"inherit"`. */
type PatternLinecap = "square" | "butt" | "round" | "inherit";

/** Props of `PatternCircles`. */
// Circle-tile pattern (visx port); corner complements mirror bklit's tile.
interface PatternCirclesProps {
  /** Id of the pattern, referenced as `url(#id)` in a fill. */
  readonly id: string;
  /** Width of the pattern tile in px. */
  readonly width: number;
  /** Height of the pattern tile in px. */
  readonly height: number;
  /**
   * Radius of the circle in px.
   * @default 2
   */
  readonly radius?: number;
  /** Fill color of the circle. */
  readonly fill?: string;
  /** Class name added to the drawn shapes. */
  readonly className?: string;
  /** Stroke color of the circle. */
  readonly stroke?: string;
  /** Stroke width of the circle. */
  readonly strokeWidth?: number | string;
  /** SVG dash pattern of the stroke. */
  readonly strokeDasharray?: number | string;
  /**
   * Also draw circles at the four tile corners.
   * @default false
   */
  readonly complement?: boolean;
  /** Background color of the tile. No background is drawn when omitted. */
  readonly background?: string;
}

/** Props of `PatternLines`. */
interface PatternLinesProps {
  /** Id of the pattern, referenced as `url(#id)` in a fill. */
  readonly id: string;
  /** Width of the pattern tile in px. */
  readonly width: number;
  /** Height of the pattern tile in px. */
  readonly height: number;
  /** Class name added to the drawn shapes. */
  readonly className?: string;
  /** Background color of the tile. No background is drawn when omitted. */
  readonly background?: string;
  /** Stroke color of the shapes. */
  readonly stroke?: string;
  /** Stroke width of the shapes. */
  readonly strokeWidth?: number | string;
  /** SVG dash pattern of the stroke. */
  readonly strokeDasharray?: string | number;
  /**
   * Line cap of the stroke: `"square"`, `"butt"`, `"round"` or `"inherit"`.
   * @default "square"
   */
  readonly strokeLinecap?: PatternLinecap;
  /**
   * SVG `shape-rendering` of the shapes.
   * @default "auto"
   */
  readonly shapeRendering?: string | number;
  /**
   * Directions of the lines: any of `"vertical"`, `"horizontal"`, `"diagonal"` and `"diagonalRightToLeft"`.
   * @default ["vertical"]
   */
  readonly orientation?: PatternOrientationType[];
}

/** Props of `PatternHexagons`. */
// Hexagon-tile pattern (visx port, quirks included: width ignored by design).
interface PatternHexagonsProps {
  /** Id of the pattern, referenced as `url(#id)` in a fill. */
  readonly id: string;
  /** Height of the pattern tile in px. The tile width is derived from `size`. */
  readonly height: number;
  /**
   * Relative size of the hexagon cell.
   * @default 3
   */
  readonly size?: number;
  /**
   * Fill color of the hexagon path.
   * @default "transparent"
   */
  readonly fill?: string;
  /** Class name added to the drawn shapes. */
  readonly className?: string;
  /** Background color of the tile. No background is drawn when omitted. */
  readonly background?: string;
  /** Stroke color of the shapes. */
  readonly stroke?: string;
  /** Stroke width of the shapes. */
  readonly strokeWidth?: number | string;
  /** SVG dash pattern of the stroke. */
  readonly strokeDasharray?: string | number;
  /**
   * Line cap of the stroke: `"square"`, `"butt"`, `"round"` or `"inherit"`.
   * @default "square"
   */
  readonly strokeLinecap?: PatternLinecap;
  /**
   * SVG `shape-rendering` of the shapes.
   * @default "auto"
   */
  readonly shapeRendering?: string | number;
}

/** Props of `PatternWaves`. */
// Wave-tile pattern (visx port).
interface PatternWavesProps {
  /** Id of the pattern, referenced as `url(#id)` in a fill. */
  readonly id: string;
  /** Width of the pattern tile in px. */
  readonly width: number;
  /** Height of the pattern tile in px. */
  readonly height: number;
  /**
   * Fill color of the wave path.
   * @default "transparent"
   */
  readonly fill?: string;
  /** Class name added to the drawn shapes. */
  readonly className?: string;
  /** Background color of the tile. No background is drawn when omitted. */
  readonly background?: string;
  /** Stroke color of the shapes. */
  readonly stroke?: string;
  /** Stroke width of the shapes. */
  readonly strokeWidth?: number | string;
  /** SVG dash pattern of the stroke. */
  readonly strokeDasharray?: string | number;
  /**
   * Line cap of the stroke: `"square"`, `"butt"`, `"round"` or `"inherit"`.
   * @default "square"
   */
  readonly strokeLinecap?: PatternLinecap;
  /**
   * SVG `shape-rendering` of the shapes.
   * @default "auto"
   */
  readonly shapeRendering?: string | number;
}

// The bare <pattern> tile.
const tile = (id: string, width: number, height: number, children: readonly MarkupChild[]): MarkupNode =>
  el("pattern", { id, width, height, patternUnits: "userSpaceOnUse" }, children);

/** A tile with one circle, and with `complement` one at each corner. */
const circlesPattern = ({
  id,
  width,
  height,
  radius = DEFAULT_CIRCLE_RADIUS,
  fill,
  stroke,
  strokeWidth,
  strokeDasharray,
  background,
  complement = false,
  className,
}: Readonly<PatternCirclesProps>): MarkupNode => {
  const circle = (classes: string, cornerX: number, cornerY: number): MarkupNode =>
    el("circle", { class: cx(classes, className), cx: cornerX, cy: cornerY, r: radius, fill, stroke, "stroke-width": strokeWidth, "stroke-dasharray": strokeDasharray });
  const corners: readonly (readonly [number, number])[] = complement
    ? [
        [TILE_ORIGIN, TILE_ORIGIN],
        [TILE_ORIGIN, height],
        [width, TILE_ORIGIN],
        [width, height],
      ]
    : [];
  return tile(id, width, height, [
    background ? el("rect", { width, height, fill: background }) : null,
    circle("visx-pattern-circle", width / HALF_DIVISOR, height / HALF_DIVISOR),
    ...corners.map(([cornerX, cornerY]) => ({ ...circle("visx-pattern-circle visx-pattern-circle-complement", cornerX, cornerY), key: `${id}-complement-${cornerX}-${cornerY}` })),
  ]);
};

// Array.isArray narrows to any[], which would make the mapped items any.
// This guard keeps the same runtime check with a precise element type.
type OrientationInput = readonly PatternOrientationType[] | PatternOrientationType;
const isOrientationList = (value: OrientationInput): value is readonly PatternOrientationType[] => Array.isArray(value);

/** A tile with straight lines in one or more directions. */
const linesPattern = ({
  id,
  width,
  height,
  stroke,
  strokeWidth,
  strokeDasharray,
  strokeLinecap = "square",
  shapeRendering = "auto",
  orientation = VERTICAL_ORIENTATION,
  background,
  className,
}: Readonly<PatternLinesProps>): MarkupNode => {
  const orientations = isOrientationList(orientation) ? orientation : [orientation];
  return tile(id, width, height, [
    background ? el("rect", { class: cx("visx-pattern-line-background"), width, height, fill: background }) : null,
    ...orientations.map((orientationItem) =>
      el(
        "path",
        {
          class: cx("visx-pattern-line", className),
          d: pathForOrientation({ height, orientation: orientationItem }),
          stroke,
          "stroke-width": strokeWidth,
          "stroke-dasharray": strokeDasharray,
          "stroke-linecap": strokeLinecap,
          "shape-rendering": shapeRendering,
        },
        [],
        { key: `visx-${id}-line-${orientationItem}` },
      ),
    ),
  ]);
};

interface PathTileArgs {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly path: string;
  readonly fill?: string;
  readonly pathClassName: string;
  readonly background?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number | string;
  readonly strokeDasharray?: string | number;
  readonly strokeLinecap?: PatternLinecap;
  readonly shapeRendering?: string | number;
}

// Base path tile (visx port); hexagons and waves build on it.
const pathTile = ({
  id,
  width,
  height,
  path,
  fill = "transparent",
  stroke,
  strokeWidth,
  strokeDasharray,
  strokeLinecap = "square",
  shapeRendering = "auto",
  background,
  pathClassName,
}: Readonly<PathTileArgs>): MarkupNode =>
  tile(id, width, height, [
    background ? el("rect", { width, height, fill: background }) : null,
    el("path", {
      class: cx("visx-pattern-path", pathClassName),
      d: path,
      fill,
      stroke,
      "stroke-width": strokeWidth,
      "stroke-dasharray": strokeDasharray,
      "stroke-linecap": strokeLinecap,
      "shape-rendering": shapeRendering,
    }),
  ]);

/** A tile with a hexagonal grid. */
const hexagonsPattern = ({ id, height, fill, stroke, strokeWidth, strokeDasharray, strokeLinecap, shapeRendering, background, className, size = DEFAULT_HEXAGON_SIZE }: Readonly<PatternHexagonsProps>): MarkupNode => {
  const sqrtSize = Math.sqrt(size);
  return pathTile({
    pathClassName: cx("visx-pattern-hexagon", className),
    path: `M ${height},0 l ${height},0 l ${height / HALF_DIVISOR},${(height * sqrtSize) / HALF_DIVISOR} l ${-height / HALF_DIVISOR},${(height * sqrtSize) / HALF_DIVISOR} l ${-height},0 l ${-height / HALF_DIVISOR},${(-height * sqrtSize) / HALF_DIVISOR} Z M 0,${(height * sqrtSize) / HALF_DIVISOR} l ${height / HALF_DIVISOR},0 M ${HEXAGON_TILE_SPAN * height},${(height * sqrtSize) / HALF_DIVISOR} l ${-height / HALF_DIVISOR},0`,
    id,
    width: size,
    height: sqrtSize,
    fill,
    stroke,
    strokeWidth,
    strokeDasharray,
    strokeLinecap,
    shapeRendering,
    background,
  });
};

/** A tile with wavy lines. */
const wavesPattern = ({ id, width, height, fill, stroke, strokeWidth, strokeDasharray, strokeLinecap, shapeRendering, background, className }: Readonly<PatternWavesProps>): MarkupNode =>
  pathTile({
    pathClassName: cx("visx-pattern-wave", className),
    path: `M 0 ${height / HALF_DIVISOR} c ${height / EIGHTH_DIVISOR} ${-height / QUARTER_DIVISOR} , ${(height * WAVE_CONTROL_NUMERATOR) / EIGHTH_DIVISOR} ${-height / QUARTER_DIVISOR} , ${height / HALF_DIVISOR} 0
             c ${height / EIGHTH_DIVISOR} ${height / QUARTER_DIVISOR} , ${(height * WAVE_CONTROL_NUMERATOR) / EIGHTH_DIVISOR} ${height / QUARTER_DIVISOR} , ${height / HALF_DIVISOR} 0 M ${-height / HALF_DIVISOR} ${height / HALF_DIVISOR}
             c ${height / EIGHTH_DIVISOR} ${height / QUARTER_DIVISOR} , ${(height * WAVE_CONTROL_NUMERATOR) / EIGHTH_DIVISOR} ${height / QUARTER_DIVISOR} , ${height / HALF_DIVISOR} 0 M ${height} ${height / HALF_DIVISOR}
             c ${height / EIGHTH_DIVISOR} ${-height / QUARTER_DIVISOR} , ${(height * WAVE_CONTROL_NUMERATOR) / EIGHTH_DIVISOR} ${-height / QUARTER_DIVISOR} , ${height / HALF_DIVISOR} 0`,
    id,
    width,
    height,
    fill,
    stroke,
    strokeWidth,
    strokeDasharray,
    strokeLinecap,
    shapeRendering,
    background,
  });

/** Props of `PatternTile`, without its artwork (the framework's children). */
interface PatternTileProps {
  /** Id of the pattern, referenced as `url(#id)` in a fill. */
  readonly id: string;
  /**
   * Side of the artwork's square viewBox, in its own units.
   * @default 48
   */
  readonly size?: number;
  /**
   * Multiplies the rendered tile size.
   * @default 1
   */
  readonly scale?: number;
  /**
   * Colour of the artwork, as its `currentColor`.
   * @default "var(--chart-1)"
   */
  readonly color?: string;
  /**
   * Opacity of the artwork, not of the background.
   * @default 1
   */
  readonly opacity?: number;
  /** Solid colour painted under the artwork. */
  readonly background?: string;
}

/**
 * A square tile (bklit pattern-tile.tsx) around `artwork` drawn in a `size × size` viewBox, repeated every `size × scale` px; the artwork
 * paints with `currentColor`, which `color` sets. The bare `<pattern>`: a resource host or the reader's `<svg>` owns the `<defs>`.
 */
const patternTileTree = ({ id, size = 48, scale = 1, color = "var(--chart-1)", opacity = 1, background }: Readonly<PatternTileProps>, artwork: readonly MarkupChild[]): MarkupNode => {
  const side = size * scale;
  return el("pattern", { height: side, id, patternUnits: "userSpaceOnUse", viewBox: `0 0 ${size} ${size}`, width: side }, [
    background === undefined || background === "" ? null : el("rect", { fill: background, height: size, width: size }),
    el("g", { opacity }, artwork, { style: { color } }),
  ]);
};

/** The colour bklit's legacy `"accent"` preset falls back to: a theme token where bklit hard-codes `#e879f9`, so it follows the theme. */
const ACCENT_PATTERN_COLOR = "var(--chart-1)";

/** A preset's tile as a tree (bklit pattern-preset.tsx `renderPatternPreset`), or undefined for `"none"` (and an unknown id). */
const patternPresetTree = (preset: PatternPresetId, id: string, options: Readonly<PatternPresetOptions> = {}): MarkupNode | undefined => {
  const def = patternPresetDef(preset);
  if (def === undefined) {
    return undefined;
  }
  const color = options.color ?? (preset === "accent" ? ACCENT_PATTERN_COLOR : "var(--chart-1)");
  return patternTileTree({ background: options.tileBackground, color, id, opacity: options.opacity, scale: options.scale, size: def.size }, [
    def.fill === undefined ? null : el("path", { d: def.fill, fill: "currentColor" }),
    def.stroke === undefined ? null : el("path", { d: def.stroke, fill: "none", stroke: "currentColor", "stroke-width": options.strokeWidth ?? 1 }),
  ]);
};

export type { PatternCirclesProps, PatternHexagonsProps, PatternLinesProps, PatternTileProps, PatternWavesProps };
export { circlesPattern, hexagonsPattern, linesPattern, patternPresetTree, patternTileTree, wavesPattern };
