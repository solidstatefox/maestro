import { px } from "../style";
import type { StyleObject } from "../style";

/** The plot area inside the host: the surface inset by the chart's margins. The label's text centres in it. */
export const loadingLabelBox = (margin: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }): StyleObject => ({
  position: "absolute",
  top: px(margin.top),
  right: px(margin.right),
  bottom: px(margin.bottom),
  left: px(margin.left),
  "pointer-events": "none",
});
