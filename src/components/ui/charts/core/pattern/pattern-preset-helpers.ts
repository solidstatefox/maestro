type PatternPresetFamily = "lines" | "grids" | "dashed" | "dots" | "circles" | "tiles";

interface PatternPresetDef {
  readonly label: string;
  readonly family: PatternPresetFamily;
  /** Cell size in user units: the pattern repeats every `size × scale` px. */
  readonly size: number;
  /** Filled artwork. */
  readonly fill?: string;
  /** 1-unit stroked artwork (its width follows `strokeWidth`). */
  readonly stroke?: string;
}

const PATTERN_PRESET_DEFS = {
  vertical: { label: "Vertical", family: "lines", size: 6, stroke: "M5.5 0V6M-0.5 0V6" },
  "vertical-dense": { label: "Vertical dense", family: "lines", size: 3, stroke: "M2.5 0V3M-0.5 0V3" },
  horizontal: { label: "Horizontal", family: "lines", size: 6, stroke: "M0 5.5H6M0 -0.5H6" },
  "horizontal-dense": { label: "Horizontal dense", family: "lines", size: 3, stroke: "M0 2.5H3M0 -0.5H3" },
  "diagonal-up": { label: "Diagonal up", family: "lines", size: 6, stroke: "M-2 1L1 -2M-1 6L6 -1M4 7L7 4" },
  "diagonal-up-sparse": { label: "Diagonal up sparse", family: "lines", size: 12, stroke: "M-2 1L1 -2M-1 12L12 -1M10 13L13 10" },
  "diagonal-down": { label: "Diagonal down", family: "lines", size: 6, stroke: "M-1 -1L7 7M-2 4L2 8M4 -2L8 2" },
  "diagonal-down-sparse": { label: "Diagonal down sparse", family: "lines", size: 12, stroke: "M-1 -1L13 13M-2 10L2 14M10 -2L14 2" },
  grid: { label: "Grid", family: "grids", size: 6, stroke: "M5.5 0V6M-0.5 0V6M0 5.5H6M0 -0.5H6" },
  "vertical-dashed": { label: "Vertical dashed", family: "dashed", size: 6, fill: "M6 1V4H5V1H6Z" },
  "horizontal-dashed": { label: "Horizontal dashed", family: "dashed", size: 6, fill: "M4 6L1 6L1 5L4 5L4 6Z" },
  "horizontal-dashed-dense": { label: "Horizontal dashed dense", family: "dashed", size: 6, fill: "M4 6L1 6L1 5L4 5L4 6ZM4 3L1 3L1 2L4 2L4 3Z" },
  "grid-dashed": { label: "Grid dashed", family: "dashed", size: 6, fill: "M6 1V4H5V1H6ZM4 6L1 6L1 5L4 5L4 6Z" },
  "grid-dotted": { label: "Grid dotted", family: "dashed", size: 6, fill: "M1 6V5H2V6H1ZM3 6V5H4V6H3ZM5 6V5H6V6H5ZM6 4H5V3H6V4ZM6 2H5V1H6V2Z" },
  dots: { label: "Dots", family: "dots", size: 6, fill: "M6 5H5V6H6V5Z" },
  "dots-sparse": { label: "Dots sparse", family: "dots", size: 12, fill: "M12 11H11V12H12V11ZM6 5H5V6H6V5Z" },
  "diagonal-dots-up": { label: "Diagonal dots up", family: "dots", size: 6, fill: "M5 5h1v1h-1zM3 1h1v1h-1zM1 3h1v1h-1z" },
  "diagonal-dots-up-sparse": { label: "Diagonal dots up sparse", family: "dots", size: 12, fill: "M5 5h1v1h-1zM11 11h1v1h-1zM3 7h1v1h-1zM1 9h1v1h-1zM7 3h1v1h-1zM9 1h1v1h-1z" },
  "diagonal-dots-down": { label: "Diagonal dots down", family: "dots", size: 6, fill: "M5 5h1v1h-1zM3 3h1v1h-1zM1 1h1v1h-1z" },
  "diagonal-dots-down-sparse": { label: "Diagonal dots down sparse", family: "dots", size: 12, fill: "M11 11h1v1h-1zM9 9h1v1h-1zM7 7h1v1h-1zM5 5h1v1h-1zM3 3h1v1h-1zM1 1h1v1h-1z" },
  "circles-dense": { label: "Circles dense", family: "circles", size: 6, fill: "M1 2.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z" },
  circles: { label: "Circles", family: "circles", size: 12, fill: "M4 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z" },
  "circles-sparse": { label: "Circles sparse", family: "circles", size: 24, fill: "M4 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0zM16 17.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z" },
  blocks: { label: "Blocks", family: "tiles", size: 6, fill: "M1 1h3v3h-3z" },
  "checkerboard-xs": { label: "Checkerboard XS", family: "tiles", size: 6, fill: "M0 0h3v3h-3zM3 3h3v3h-3z" },
  "checkerboard-sm": { label: "Checkerboard SM", family: "tiles", size: 8, fill: "M0 0h4v4h-4zM4 4h4v4h-4z" },
  checkerboard: { label: "Checkerboard", family: "tiles", size: 12, fill: "M0 0h6v6h-6zM6 6h6v6h-6z" },
  "checkerboard-lg": { label: "Checkerboard LG", family: "tiles", size: 24, fill: "M12 0H0V12H12V0ZM24 12H12V24H24V12Z" },
  "checkerboard-inset": { label: "Checkerboard inset", family: "tiles", size: 12, fill: "M0 0h5v5h-5zM6 6h5v5h-5z" },
} as const satisfies Readonly<Record<string, PatternPresetDef>>;

/** Every preset id, `"none"` (draws nothing) first, then the presets in display order. */
const PATTERN_PRESET_IDS = [
  "none",
  "vertical",
  "vertical-dense",
  "horizontal",
  "horizontal-dense",
  "diagonal-up",
  "diagonal-up-sparse",
  "diagonal-down",
  "diagonal-down-sparse",
  "grid",
  "vertical-dashed",
  "horizontal-dashed",
  "horizontal-dashed-dense",
  "grid-dashed",
  "grid-dotted",
  "dots",
  "dots-sparse",
  "diagonal-dots-up",
  "diagonal-dots-up-sparse",
  "diagonal-dots-down",
  "diagonal-dots-down-sparse",
  "circles-dense",
  "circles",
  "circles-sparse",
  "blocks",
  "checkerboard-xs",
  "checkerboard-sm",
  "checkerboard",
  "checkerboard-lg",
  "checkerboard-inset",
] as const;

/** A current preset id: one of `PATTERN_PRESET_IDS` (`"none"` draws nothing). */
type PatternPresetKey = (typeof PATTERN_PRESET_IDS)[number];

/** An id from the earlier preset set, still accepted and mapped forward: `"diagonal"` and `"accent"` to `"diagonal-up"`, `"cross"` to `"grid"`. */
type LegacyPatternPresetId = "diagonal" | "cross" | "accent";

/**
 * Name of a ready-made pattern: a current id (`"diagonal-up"`, `"grid"`, `"dots"`, `"checkerboard"`…, see `PATTERN_PRESET_IDS`) or a
 * legacy one (`"diagonal"`, `"cross"`, `"accent"`). `"none"` draws nothing.
 */
type PatternPresetId = PatternPresetKey | LegacyPatternPresetId;

const LEGACY_PATTERN_PRESETS: Readonly<Record<LegacyPatternPresetId, PatternPresetKey>> = { accent: "diagonal-up", cross: "grid", diagonal: "diagonal-up" };

const isLegacyPatternPresetId = (preset: string): preset is LegacyPatternPresetId => Object.hasOwn(LEGACY_PATTERN_PRESETS, preset);
const PRESET_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set<string>(PATTERN_PRESET_IDS);
const isPatternPresetKey = (preset: string): preset is PatternPresetKey => PRESET_KEYS.has(preset);

/** Maps any preset id, current or legacy, to a current one; an unknown id (or none) resolves to `"none"`. */
const resolvePatternPresetId = (preset: string | null | undefined): PatternPresetKey => {
  if (preset === null || preset === undefined || preset === "") {
    return "none";
  }
  if (isLegacyPatternPresetId(preset)) {
    return LEGACY_PATTERN_PRESETS[preset];
  }
  return isPatternPresetKey(preset) ? preset : "none";
};

/** A drawn preset's definition, or undefined for `"none"`. */
const patternPresetDef = (preset: PatternPresetId | string | null | undefined): PatternPresetDef | undefined => {
  const id = resolvePatternPresetId(preset);
  return id === "none" ? undefined : PATTERN_PRESET_DEFS[id];
};

/** One entry of `PATTERN_PRESETS`: a preset's id, display label, family and cell size. */
interface PatternPresetMeta {
  readonly id: Exclude<PatternPresetKey, "none">;
  readonly label: string;
  readonly family: PatternPresetFamily;
  /** Cell size in px at scale 1. */
  readonly size: number;
}

/** Every preset but `"none"`, in display order, with its label, family and cell size: what a pattern picker lists. */
const PATTERN_PRESETS: readonly PatternPresetMeta[] = /* @__PURE__ */ (() =>
  PATTERN_PRESET_IDS.flatMap((id): PatternPresetMeta[] => {
    if (id === "none") {
      return [];
    }
    const { family, label, size }: PatternPresetDef = PATTERN_PRESET_DEFS[id];
    return [{ family, id, label, size }];
  }))();

/**
 * Options that tune a pattern preset. Unset options use the preset's own values.
 */
interface PatternPresetOptions {
  /**
   * Colour of the pattern (its `currentColor`).
   * @default "var(--chart-1)"
   */
  readonly color?: string;
  /**
   * Multiplies the tile size; the line width scales with it. `2` doubles it.
   * @default 1
   */
  readonly scale?: number;
  /**
   * Line width of the line presets, in tile units (multiplied by `scale`).
   * @default 1
   */
  readonly strokeWidth?: number;
  /**
   * Opacity of the pattern, not of the tile background.
   * @default 1
   */
  readonly opacity?: number;
  /** Solid colour painted under the pattern in each tile. */
  readonly tileBackground?: string;
  /** @deprecated No effect: only the earlier circle presets read it. */
  readonly radius?: number;
  /** @deprecated No effect: only the earlier circle presets read it. */
  readonly complement?: boolean;
  /** @deprecated No effect: only the earlier circle presets read it. */
  readonly fill?: string;
  /** @deprecated No effect: only the earlier dot preset read it. */
  readonly dotFill?: boolean;
}

/** True for the presets drawn as circles (the `circles` family). */
const isCirclePattern = (preset: PatternPresetId): boolean => patternPresetDef(preset)?.family === "circles";

/** @deprecated Use `isCirclePattern`. */
const isCirclesPattern = (preset: PatternPresetId): boolean => isCirclePattern(preset);

interface PatternTileSize {
  readonly width: number;
  readonly height: number;
  readonly strokeWidth: number;
}

/** A preset's rendered tile at `scale`: its side in px and, for a line preset, its line width (0 for a filled one). */
const patternPresetTileSize = (preset: PatternPresetId, scale = 1): PatternTileSize => {
  const def = patternPresetDef(preset);
  const size = (def?.size ?? 6) * scale;
  return { height: size, strokeWidth: def?.stroke === undefined ? 0 : scale, width: size };
};

export {
  PATTERN_PRESET_IDS,
  PATTERN_PRESETS,
  isCirclePattern,
  isCirclesPattern,
  patternPresetDef,
  patternPresetTileSize,
  resolvePatternPresetId,
};
export type { LegacyPatternPresetId, PatternPresetDef, PatternPresetFamily, PatternPresetId, PatternPresetKey, PatternPresetMeta, PatternPresetOptions };
