import { px } from "../style";
import type { StyleObject } from "../style";

/** The host's box: `fixedSize` px square, or the parent's width at 1:1 (no `size`, or 0). */
export const polarBoxStyle = (fixedSize: number | undefined): StyleObject =>
  fixedSize !== undefined && fixedSize !== 0 ? { height: px(fixedSize), width: px(fixedSize) } : { "aspect-ratio": "1 / 1", width: "100%" };

/** The mounted host's style: the chart centred, the overlay's containing block, then `vars` (custom properties) and the box. */
export const polarHostStyle = (vars: StyleObject, box: StyleObject): StyleObject => ({
  "align-items": "center", display: "flex", "justify-content": "center", position: "relative", ...vars, ...box,
});

/** The centre overlay: the whole host, its content centred, never hit. */
export const CENTER_OVERLAY_STYLE: StyleObject = {
  "align-items": "center", display: "flex", inset: 0, "justify-content": "center", "pointer-events": "none", position: "absolute",
};
