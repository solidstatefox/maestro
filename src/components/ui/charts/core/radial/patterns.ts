import type { RadialPatternPresetId } from "../types/radial";

interface PresetDef {
  /** Cell size in user units (the pattern repeats every `size × scale` px). */
  readonly size: number;
  /** Filled artwork. */
  readonly fill?: string;
  /** 1px-stroked artwork (its width follows `strokeWidth`). */
  readonly stroke?: string;
}

type PresetKey = Exclude<RadialPatternPresetId, "none" | "diagonal" | "cross" | "accent">;

const DEFS: Readonly<Record<PresetKey, PresetDef>> = {
  vertical: { size: 6, stroke: "M5.5 0V6M-0.5 0V6" },
  "vertical-dense": { size: 3, stroke: "M2.5 0V3M-0.5 0V3" },
  horizontal: { size: 6, stroke: "M0 5.5H6M0 -0.5H6" },
  "horizontal-dense": { size: 3, stroke: "M0 2.5H3M0 -0.5H3" },
  "diagonal-up": { size: 6, stroke: "M-2 1L1 -2M-1 6L6 -1M4 7L7 4" },
  "diagonal-up-sparse": { size: 12, stroke: "M-2 1L1 -2M-1 12L12 -1M10 13L13 10" },
  "diagonal-down": { size: 6, stroke: "M-1 -1L7 7M-2 4L2 8M4 -2L8 2" },
  "diagonal-down-sparse": { size: 12, stroke: "M-1 -1L13 13M-2 10L2 14M10 -2L14 2" },
  grid: { size: 6, stroke: "M5.5 0V6M-0.5 0V6M0 5.5H6M0 -0.5H6" },
  "vertical-dashed": { size: 6, fill: "M6 1V4H5V1H6Z" },
  "horizontal-dashed": { size: 6, fill: "M4 6L1 6L1 5L4 5L4 6Z" },
  "horizontal-dashed-dense": { size: 6, fill: "M4 6L1 6L1 5L4 5L4 6ZM4 3L1 3L1 2L4 2L4 3Z" },
  "grid-dashed": { size: 6, fill: "M6 1V4H5V1H6ZM4 6L1 6L1 5L4 5L4 6Z" },
  "grid-dotted": { size: 6, fill: "M1 6V5H2V6H1ZM3 6V5H4V6H3ZM5 6V5H6V6H5ZM6 4H5V3H6V4ZM6 2H5V1H6V2Z" },
  dots: { size: 6, fill: "M6 5H5V6H6V5Z" },
  "dots-sparse": { size: 12, fill: "M12 11H11V12H12V11ZM6 5H5V6H6V5Z" },
  "diagonal-dots-up": { size: 6, fill: "M5 5h1v1h-1zM3 1h1v1h-1zM1 3h1v1h-1z" },
  "diagonal-dots-up-sparse": { size: 12, fill: "M5 5h1v1h-1zM11 11h1v1h-1zM3 7h1v1h-1zM1 9h1v1h-1zM7 3h1v1h-1zM9 1h1v1h-1z" },
  "diagonal-dots-down": { size: 6, fill: "M5 5h1v1h-1zM3 3h1v1h-1zM1 1h1v1h-1z" },
  "diagonal-dots-down-sparse": { size: 12, fill: "M11 11h1v1h-1zM9 9h1v1h-1zM7 7h1v1h-1zM5 5h1v1h-1zM3 3h1v1h-1zM1 1h1v1h-1z" },
  "circles-dense": { size: 6, fill: "M1 2.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z" },
  circles: { size: 12, fill: "M4 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z" },
  "circles-sparse": { size: 24, fill: "M4 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0zM16 17.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z" },
  blocks: { size: 6, fill: "M1 1h3v3h-3z" },
  "checkerboard-xs": { size: 6, fill: "M0 0h3v3h-3zM3 3h3v3h-3z" },
  "checkerboard-sm": { size: 8, fill: "M0 0h4v4h-4zM4 4h4v4h-4z" },
  checkerboard: { size: 12, fill: "M0 0h6v6h-6zM6 6h6v6h-6z" },
  "checkerboard-lg": { size: 24, fill: "M12 0H0V12H12V0ZM24 12H12V24H24V12Z" },
  "checkerboard-inset": { size: 12, fill: "M0 0h5v5h-5zM6 6h5v5h-5z" },
};

/** The pre-Nucleo ids, still accepted and mapped forward. */
const LEGACY: Readonly<Record<string, PresetKey>> = { diagonal: "diagonal-up", cross: "grid", accent: "diagonal-up" };

/** Any accepted id → a current one (unknown → `null`, a solid fill). */
export const resolveRadialPattern = (preset: RadialPatternPresetId | undefined): PresetKey | null => {
  if (preset === undefined || preset === "none") {
    return null;
  }
  const key = LEGACY[preset] ?? preset;
  return key in DEFS ? (key as PresetKey) : null;
};

/** The rendered tile size of a preset at `scale`. */
export const radialPatternTileSize = (preset: PresetKey, scale = 1): number => DEFS[preset].size * scale;

const attr = (value: string): string => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** A preset's `<pattern>` (userSpaceOnUse tiles of `size × scale` px), its artwork in `color`. */
export const radialPatternMarkup = (preset: PresetKey, id: string, options: { readonly color: string; readonly scale: number; readonly strokeWidth?: number; readonly background?: string }): string => {
  const def = DEFS[preset];
  const tile = def.size * options.scale;
  const background = options.background ? `<rect fill="${attr(options.background)}" width="${def.size}" height="${def.size}"/>` : "";
  const fill = def.fill ? `<path d="${def.fill}" fill="currentColor"/>` : "";
  const stroke = def.stroke ? `<path d="${def.stroke}" fill="none" stroke="currentColor" stroke-width="${options.strokeWidth ?? 1}"/>` : "";
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile}" height="${tile}" viewBox="0 0 ${def.size} ${def.size}">${background}<g style="color:${attr(options.color)}">${fill}${stroke}</g></pattern>`;
};

/** Escapes a value for an SVG attribute. */
export const svgAttr = attr;
