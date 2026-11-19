import type { PatternPresetId } from "../pattern/pattern-preset-helpers";

export interface ReferencePatternProps {
  readonly pattern?: PatternPresetId;
  readonly patternColor?: string;
  readonly patternScale?: number;
  readonly patternStrokeWidth?: number;
  readonly patternRadius?: number;
  readonly patternComplement?: boolean;
  readonly patternFill?: string;
  readonly patternDotFill?: boolean;
  readonly patternTileBackground?: string;
}

/** The unscoped pattern id of the i-th ReferenceArea; the host scopes it to the chart (`scopeMarkupIds`). */
export const referencePatternId = (index: number): string => `refarea-pattern-${index}`;

/** bklit `usesPattern` (reference-area.tsx:152): a pattern other than "none" replaces the solid fill. */
export const usesReferencePattern = (props: ReferencePatternProps): boolean => props.pattern !== undefined && props.pattern !== "none";
