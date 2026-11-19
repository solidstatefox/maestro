import type { ReactNode } from "react";
import { patternPresetTree } from "../../core/markup/patterns";
import type { PatternPresetId, PatternPresetOptions } from "../../core/pattern/pattern-preset-helpers";
import { renderMarkup } from "../../runtime/markup";

/** The `<pattern>` element of a preset, for a render prop that takes a node (`FunnelChart`'s `renderPattern`); nothing for `"none"`. */
const renderPatternPreset = (preset: PatternPresetId, id: string, options: Readonly<PatternPresetOptions> = {}): ReactNode => {
  const tile = patternPresetTree(preset, id, options);
  return tile === undefined ? undefined : renderMarkup(tile);
};

export { renderPatternPreset };
