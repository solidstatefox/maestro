import type { ReactNode } from "react";
import { circlesPattern } from "../../core/markup/patterns";
import type { PatternCirclesProps } from "../../core/markup/patterns";
import { renderMarkup } from "../../runtime/markup";

/**
 * A pattern tile with one circle (exported as `PatternCircles`). Render it as a child of a chart and point a fill at its `id`, for example `fill="url(#my-dots)"`.
 */
const CirclesImpl = /* @__PURE__ */ Object.assign(function CirclesImpl(props: Readonly<PatternCirclesProps>): ReactNode {
  return renderMarkup(circlesPattern(props));
}, { displayName: "PatternCircles" });

export { CirclesImpl };
