import type { ChartMargin } from "../theme";
import { clearVar, writeVar } from "../host-write";
import type { StyleObject } from "../style";
import type { CartesianBuild } from "./definition";
import type { PlotSnapshot } from "./plot-size";
import { hoverStaticCss } from "./definition";
import { pillTickStaticCss } from "./date-pill";
import { loadingCss } from "./loading-css";
import type { ResolvedSeries } from "./series";
import { interactiveGateCss } from "./gate-css";
import { typedAttr } from "../css-hooks";
import { MARKER_BUCKETS } from "./series-marks";
import { CLS, keyEnds, keyHas } from "../renderer-dom";

/** Scoped CSS of the host: loading, pre-ready hiding, marker blur, pill tick blanking, hover visuals and brush extent. */
export function cartesianStaticCss(uid: string, built: CartesianBuild, hasBrush: boolean, series: readonly ResolvedSeries[]): string {
  const scope = `[data-bkm-kit="${uid}"]`;
  // Its inputs (the pill's live x, the focus x without an overlay pill) are written on the x tick labels (date-pill.ts `writeTickVar`).
  const pill = built.pillTicks.active ? pillTickStaticCss(scope, built.pillTicks.times, built.pillTicks.reachPx) : null;
  // bklit draws the brush hatch and pills from visx's committed extent, widened by SAFE_PIXEL (2px) per side by getDomainFromExtent and clamped to [0, innerWidth]; the controlled range stays raw and the native rects widen from their plot-local x/width.
  // Fixed text here because the stylesheet pipeline drops attr(type()); Chromium-only (133+), under `@supports` (unguarded, the var() invalidates at computed time: `x:0` / `width:auto` pin both handles to the plot's left edge), other browsers skip the widening.
  const brushExtent = hasBrush
    ? typedAttr(`${scope} [data-chart-brush-selection]{x:max(var(--bkm-brush-ml),calc(attr(x type(<number>))*1px - 2px));width:calc(min(calc(var(--bkm-brush-ml) + var(--bkm-brush-w)),calc(attr(x type(<number>))*1px + attr(width type(<number>))*1px + 2px)) - max(var(--bkm-brush-ml),calc(attr(x type(<number>))*1px - 2px)))}` +
      `${scope} [data-chart-brush-handle=start]{x:max(calc(var(--bkm-brush-ml) - 3px),calc(attr(x type(<number>))*1px - 2px))}` +
      `${scope} [data-chart-brush-handle=end]{x:min(calc(var(--bkm-brush-ml) + var(--bkm-brush-w) - 3px),calc(attr(x type(<number>))*1px + 2px))}`)
    : "";
  // bklit SeriesPointMarker tweens `blur(enterBlur)` -> 0 with the opacity (enterBlur 2px, `--bkm-enter-blur`): the renderer writes the in-flight fade as an opacity attribute, so a fading marker is blurred in proportion; markers are matched by mark id (kit/renderer-dom.ts).
  // Here because the stylesheet pipeline drops attr(type()); typed attr() is Chromium-only (133+), under `@supports` (unguarded, the var() invalidates at computed time: `filter:none`), other browsers enter without the blur.
  const markerBlur = (sel: string, attr: string): string => `${scope} ${CLS.dot}${keyHas(sel)} circle[${attr}]:not([${attr}="1"]){filter:blur(calc((1 - attr(${attr} type(<number>), 1)) * var(--bkm-enter-blur, 2) * 1px))}`;
  const markerFade = [":marker:", ":marker-ring:", ":marker-out:"].flatMap((sel) => ["fill-opacity", "stroke-opacity", "opacity"].map((a) => markerBlur(sel, a))).concat([":marker:", ":marker-ring:", ":marker-out:"].map((sel) => `${scope} ${CLS.dot}${keyHas(sel)}[opacity]:not([opacity="1"]){filter:blur(calc((1 - attr(opacity type(<number>), 1)) * var(--bkm-enter-blur, 2) * 1px))}`)).join("");
  // Bucket ids run 0..MARKER_BUCKETS-1 (series-marks.ts), so one generated rule per bucket covers every id the marks can carry.
  const markerStagger = Array.from({ length: MARKER_BUCKETS }, (_, i) => `${scope} ${CLS.marks}>:is(${keyEnds(`:marker:${i}`)},${keyEnds(`:marker-ring:${i}`)},${keyEnds(`:marker-out:${i}`)}){--bkm-mk:${(i / MARKER_BUCKETS).toFixed(4)}}`).join("");
  return [loadingCss(scope, series), markerStagger, interactiveGateCss(scope, true), typedAttr(markerFade), pill, hoverStaticCss(scope, built.hover), brushExtent, built.backgroundCss(scope)].filter(Boolean).join("");
}

export interface BrushVars {
  readonly shownStart: number;
  readonly shownEnd: number;
  readonly blurPx: number | undefined;
}

interface HostVarsInput {
  readonly animationDuration: number;
  readonly margin: ChartMargin;
  readonly clipped: boolean;
}

/** The host's `--bkm-*` custom properties the scoped CSS reads that do not depend on the plot size. */
export function cartesianHostVars({ animationDuration, margin, clipped }: HostVarsInput): StyleObject {
  return {
    "--bkm-enter-ms": `${animationDuration}ms`,
    // bklit clips the series group (point markers included) to the plot rect plus 20px below (time-series-chart-shell.tsx:658, innerHeight + 20).
    // Accepted divergence: the point markers' clip spans the host's width, so the first and last markers overflow into the side margins whole; bklit's
    // plot-rect clip cut them in half at the plot edges, which in a card reads as a clipping bug. Vertically it is bklit's.
    "--bkm-plot-clip": `inset(${margin.top}px 0px ${margin.bottom - 20}px 0px)`,
    ...(clipped
      ? {
          "--bkm-clip": `inset(${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px)`,
          "--bkm-clip-t": `${margin.top}px`,
          "--bkm-clip-r": `${margin.right}px`,
          "--bkm-clip-b": `${margin.bottom}px`,
          "--bkm-clip-l": `${margin.left}px`,
        }
      : null),
  };
}

const BRUSH_VARS = ["--bkm-brush-ml", "--bkm-brush-mt", "--bkm-brush-h", "--bkm-brush-w", "--bkm-brush-x0", "--bkm-brush-x1", "--bkm-brush-blur"] as const;

/** The host vars that follow the plot size (written from the draw, the host's React style never holds them): the wipe width and, with a Brush child and a non-empty x span, the brush extent. */
export function writeSizeVars(host: HTMLElement, snapshot: PlotSnapshot, margin: ChartMargin, brush: BrushVars | undefined): void {
  const { innerWidth, innerHeight } = snapshot.size;
  writeVar(host, "--bkm-wipe-w", `${innerWidth}px`);
  // Where a canvas series' reveal starts (styles/cartesian.css `bkm-wipe-cv`).
  writeVar(host, "--bkm-wipe-l", `${margin.left}px`);
  const xStart = snapshot.built.domains.x[0].getTime();
  const xSpanMs = snapshot.built.domains.x[1].getTime() - xStart;
  if (!brush || xSpanMs <= 0) {
    for (const name of BRUSH_VARS) { clearVar(host, name); }
    return;
  }
  const h = Math.max(0, innerHeight);
  writeVar(host, "--bkm-brush-ml", `${margin.left}px`);
  writeVar(host, "--bkm-brush-mt", `${margin.top}px`);
  writeVar(host, "--bkm-brush-h", `${h}px`);
  writeVar(host, "--bkm-brush-w", `${innerWidth}px`);
  // bklit's track overlay reads the same 2px-widened (SAFE_PIXEL), plot-clamped extent as the pills and hatch.
  writeVar(host, "--bkm-brush-x0", `${Math.max(0, Math.min(innerWidth, ((brush.shownStart - xStart) / xSpanMs) * innerWidth - 2))}px`);
  writeVar(host, "--bkm-brush-x1", `${Math.max(0, Math.min(innerWidth, ((brush.shownEnd - xStart) / xSpanMs) * innerWidth + 2))}px`);
  writeVar(host, "--bkm-brush-blur", `${Math.min(5, Math.max(0, brush.blurPx ?? 1.5))}px`);
}
