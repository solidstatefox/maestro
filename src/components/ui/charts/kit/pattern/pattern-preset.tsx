import type { ReactNode } from "react";
import { MARKUP_SLOT } from "../../core/markup/node";
import { patternTileTree } from "../../core/markup/patterns";
import type { PatternPresetProps, PatternTileProps as CorePatternTileProps } from "../../core/types/pattern";
import { renderMarkup } from "../../runtime/markup";
import { renderPatternPreset } from "./pattern-preset-render";

/** Props of `PatternTile`. */
interface PatternTileProps extends CorePatternTileProps<ReactNode> {}

const SLOT = [MARKUP_SLOT] as const;

/**
 * A pattern definition for any preset. Put it in a chart's children (or an `<svg>`) and point a fill at its `id`: `fill="url(#id)"`.
 * @example <PatternPreset id="stripes" preset="diagonal-up" color="var(--chart-2)" />
 */
const PatternPreset = /* @__PURE__ */ Object.assign(function PatternPreset({ id, preset = "diagonal-up", ...options }: Readonly<PatternPresetProps>): ReactNode {
  return renderPatternPreset(preset, id, options);
}, { displayName: "PatternPreset" });

/**
 * A square pattern around your own artwork, drawn in a `size × size` viewBox and painted with `currentColor` (which `color` sets). Put it
 * in a chart's children (or an `<svg>`) and point a fill at its `id`.
 */
const PatternTile = /* @__PURE__ */ Object.assign(function PatternTile({ children, ...tile }: Readonly<PatternTileProps>): ReactNode {
  return renderMarkup(patternTileTree(tile, SLOT), children);
}, { displayName: "PatternTile" });

export { PatternPreset, PatternTile };
export type { PatternTileProps };
