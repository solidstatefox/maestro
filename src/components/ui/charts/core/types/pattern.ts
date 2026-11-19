import type { PatternTileProps as PatternTileOptions } from "../markup/patterns";
import type { PatternPresetId, PatternPresetOptions } from "../pattern/pattern-preset-helpers";

/** Props of `PatternPreset`. */
export interface PatternPresetProps extends PatternPresetOptions {
  /** Id of the pattern: point a fill at it with `fill="url(#id)"`. */
  readonly id: string;
  /**
   * The preset to draw (see `PATTERN_PRESET_IDS`; the legacy ids still work).
   * @default "diagonal-up"
   */
  readonly preset?: PatternPresetId;
}

/** Props of `PatternTile`. */
export interface PatternTileProps<Node> extends PatternTileOptions {
  /** The tile's artwork, drawn in the `size × size` viewBox. Paint it with `currentColor` so `color` drives it. */
  readonly children: Node;
}
