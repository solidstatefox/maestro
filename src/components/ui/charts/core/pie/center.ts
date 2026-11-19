import type { PieArcData, PieData, PieStableValue } from "../types/pie";
import { defaultPieColors } from "./model";

const SHELL_HOVER_OFFSET = 10;

interface PieCenterState {
  /** The hovered slice's data, `undefined` when none is hovered. */
  readonly hoveredData: PieData | undefined;
  readonly innerRadius: number;
  readonly totalValue: number;
}

/** What PieCenter shows for `hoveredIndex`: `null` without an inner radius (nothing to size the box to). Scrub mode never shows hover state in the centre. */
export const pieCenterOf = <Ref>(stable: PieStableValue<Ref>, hoveredIndex: number | null): PieCenterState | null => {
  if (stable.innerRadius <= 0) { return null; }
  const hoveredData = stable.geometryScrubbing || hoveredIndex === null ? undefined : stable.data[hoveredIndex];
  return { hoveredData, innerRadius: stable.innerRadius, totalValue: stable.totalValue };
};

/** The datum PieCenter's render child gets at rest (bklit #264): the total under `defaultLabel`, no colour or fill. */
export const pieCenterRest = (defaultLabel: string, totalValue: number): PieData => ({ label: defaultLabel, value: totalValue });

/** PieCenterShell's context: a one-slice pie of `value` (negative shows as 0) in a `contextSize` square with an `innerRadiusPx` hole. */
export const pieCenterShellContext = (value: number, contextSize: number, innerRadiusPx: number): PieStableValue<{ current: HTMLDivElement | null }> => {
  const data: PieData[] = [{ label: "_pieCenterShell", value: Math.max(value, 0) }];
  const arcs: PieArcData[] = [{ data: data[0], endAngle: (3 * Math.PI) / 2, index: 0, padAngle: 0, startAngle: -Math.PI / 2, value: Math.max(value, 0) }];
  const center = contextSize / 2;
  const getColor = (index: number): string => defaultPieColors[index % defaultPieColors.length];
  return {
    animationKey: 0, arcs, center, containerRef: { current: null }, cornerRadius: 0, data, enterStaggerScale: 1,
    geometryScrubbing: false, getColor, getFill: getColor, hoverOffset: SHELL_HOVER_OFFSET, innerRadius: innerRadiusPx,
    outerRadius: center - SHELL_HOVER_OFFSET, isLoaded: true, padAngle: 0, scrubSlicePaths: null, size: contextSize, totalValue: value,
  };
};
