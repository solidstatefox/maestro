import type { ReactNode } from "react";
import { wavesPattern } from "../../core/markup/patterns";
import type { PatternWavesProps } from "../../core/markup/patterns";
import { renderMarkup } from "../../runtime/markup";

/** A pattern tile with wavy lines (exported as `PatternWaves`). Render it as a child of a chart and point a fill at its `id`. */
const WavesImpl = /* @__PURE__ */ Object.assign(function WavesImpl(props: Readonly<PatternWavesProps>): ReactNode {
  return renderMarkup(wavesPattern(props));
}, { displayName: "PatternWaves" });

export { WavesImpl };
