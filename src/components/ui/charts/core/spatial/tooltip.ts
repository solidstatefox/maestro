import { TOOLTIP_MOTION, TOOLTIP_OFFSET } from "../theme";
import { bklitTooltip } from "../tooltip/bklit-tooltip";
import { sizedTooltipPlacement } from "../tooltip/sized-tooltip-placement";

/** The definition's `tooltip`: beside the focused point, right of it or left when it would overflow, gliding on the hover spring. */
export const spatialTooltipOption = (enabled: boolean): object | false =>
  enabled
    ? { use: bklitTooltip, className: "bkm-sp-tooltip", motion: TOOLTIP_MOTION, offset: TOOLTIP_OFFSET, placement: ["right", "left"], portal: sizedTooltipPlacement(), sticky: false }
    : false;

const numberFormat = /* @__PURE__ */ new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** The default value format: thousands separators, at most two decimals. */
export const formatSpatialValue = (value: number): string => numberFormat.format(value);
