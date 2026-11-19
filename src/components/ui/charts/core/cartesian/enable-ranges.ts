import { registerRanges } from "./features";
import { buildRangeOverlays, rangeDots, rangeResources, rangeTooltipBase } from "./range-overlays";

export const enableRanges = (): void => {
  registerRanges({ build: buildRangeOverlays, tooltipBase: rangeTooltipBase, dots: rangeDots, resources: rangeResources });
};
