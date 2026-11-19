import type { ReactNode } from "react";
import { linesPattern } from "../../core/markup/patterns";
import type { PatternLinesProps } from "../../core/markup/patterns";
import { renderMarkup } from "../../runtime/markup";

/** A pattern tile with straight lines in one or more directions. Render it as a child of a chart and point a fill at its `id`. */
const PatternLines = /* @__PURE__ */ Object.assign(function PatternLines(props: Readonly<PatternLinesProps>): ReactNode {
  return renderMarkup(linesPattern(props));
}, { displayName: "PatternLines" });

export { PatternLines };
