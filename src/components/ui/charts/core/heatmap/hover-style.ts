interface HeatmapHoverStyleParams {
  readonly inactiveOpacity: number;
  readonly inactiveScale: number;
  readonly activeScale: number;
}

/** Whether hover styling runs (disabled when all scale/opacity props are 1). */
export const isHeatmapHoverEffectEnabled = (params: Readonly<HeatmapHoverStyleParams>): boolean => params.inactiveOpacity !== 1 || params.inactiveScale !== 1 || params.activeScale !== 1;


interface HeatmapHoverStyle {
  readonly opacity: number;
  readonly scale: number;
}

/** Opacity and scale for highlighted vs dimmed cells and legend swatches. */
export const resolveHeatmapHoverStyle = (isHighlighted: boolean, isDimmed: boolean, params: Readonly<HeatmapHoverStyleParams>): HeatmapHoverStyle => {
  if (isHighlighted && params.activeScale !== 1) {return { opacity: 1, scale: params.activeScale };}
  if (isDimmed) {return { opacity: params.inactiveOpacity, scale: params.inactiveScale };}
  return { opacity: 1, scale: 1 };
}

/** `Array.isArray` narrows `readonly number[] | X` to `any[]` (a known TS gap); this predicate narrows soundly: true is the array member, false keeps the rest. */
const isReadonlyNumberArray = <Other,>(value: Other): value is Extract<Other, readonly number[]> => Array.isArray(value);

/** Per-row opacity multiplier for display rows (default 1); a single opacity or a per-row array. */
export const resolveHeatmapRowOpacity = (row: number, rowOpacity: number | readonly number[] = 1): number => {
  if (isReadonlyNumberArray(rowOpacity)) {return rowOpacity[row] ?? 1;}
  return rowOpacity;
}

const DEFAULT_FADED_OPACITY = 0.35;
const DEFAULT_ACTIVE_OPACITY = 1;
const DEFAULT_ROW_COUNT = 7;

/**
 * Builds a per-row opacity map for HeatmapCells/HeatmapYAxis from explicit row indices or a predicate.
 * @internal
 */
export const buildHeatmapRowOpacity = (match: readonly number[] | ((row: number) => boolean), fadedOpacity: number = DEFAULT_FADED_OPACITY, activeOpacity: number = DEFAULT_ACTIVE_OPACITY, rowCount: number = DEFAULT_ROW_COUNT): number[] => {
  if (isReadonlyNumberArray(match)) {
    const opacity = Array.from({ length: rowCount }, () => activeOpacity);
    for (const row of match) {
      if (row >= 0 && row < rowCount) {opacity[row] = fadedOpacity;}
    }
    return opacity;
  }

  return Array.from({ length: rowCount }, (_unused, row) => (match(row) ? fadedOpacity : activeOpacity));
}
