import type { ReactNode } from "react";
import { hexagonsPattern } from "../../core/markup/patterns";
import type { PatternHexagonsProps } from "../../core/markup/patterns";
import { renderMarkup } from "../../runtime/markup";

/** A pattern tile with a hexagonal grid. Render it as a child of a chart and point a fill at its `id`. */
const PatternHexagons = /* @__PURE__ */ Object.assign(function PatternHexagons(props: Readonly<PatternHexagonsProps>): ReactNode {
  return renderMarkup(hexagonsPattern(props));
}, { displayName: "PatternHexagons" });

export { PatternHexagons };
