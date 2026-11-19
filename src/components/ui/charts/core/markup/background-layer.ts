import type { BackgroundPatternLayerProps } from "../types/range-overlays";
import { el } from "./node";
import type { MarkupNode } from "./node";
import { patternPresetTree } from "./patterns";

const clampFade = (length: number): number => Math.min(45, Math.max(0, length));

/** bklit `fadeMaskStops`: transparent at both ends, opaque `length`% in. */
const fadeStops = (length: number): MarkupNode[] => {
  const edge = clampFade(length);
  return [
    ["0%", 0],
    [`${edge}%`, 1],
    [`${100 - edge}%`, 1],
    ["100%", 0],
  ].map(([offset, opacity]) => el("stop", { offset }, [], { key: String(offset), style: { "stop-color": "white", "stop-opacity": opacity } }));
};

/** The layer as a tree, its ids prefixed with `id` (unique per mount); null when it draws nothing (no size, `showFill` off, `"none"`). */
export function backgroundPatternLayerTree(props: BackgroundPatternLayerProps, id: string): MarkupNode | null {
  const { pattern = "diagonal", color = "var(--chart-grid)", scale = 1, showFill = true, opacity = 1, fadeHorizontal = true, fadeVertical = true } = props;
  const { width, height } = props;
  if (pattern === "none" || !showFill || !(width > 0) || !(height > 0)) {
    return null;
  }
  const patternId = `chart-background-${id}`;
  const tile = patternPresetTree(pattern, patternId, {
    color,
    scale,
    strokeWidth: props.strokeWidth,
    radius: props.radius,
    complement: props.complement,
    fill: props.fill,
    dotFill: props.dotFill,
    tileBackground: props.tileBackground,
  });
  if (!tile) {
    return null;
  }
  const hMask = `chart-background-fade-h-${id}`;
  const vMask = `chart-background-fade-v-${id}`;
  const both = `chart-background-fade-${id}`;
  const box = { height, width, x: 0, y: 0 };
  const masks: MarkupNode[] = [];
  if (fadeHorizontal) {
    masks.push(
      el("linearGradient", { id: `${hMask}-gradient`, x1: "0%", x2: "100%", y1: "0%", y2: "0%" }, fadeStops(props.fadeHorizontalLength ?? 10)),
      el("mask", { id: hMask }, [el("rect", { fill: `url(#${hMask}-gradient)`, ...box })]),
    );
  }
  if (fadeVertical) {
    masks.push(
      el("linearGradient", { id: `${vMask}-gradient`, x1: "0%", x2: "0%", y1: "0%", y2: "100%" }, fadeStops(props.fadeVerticalLength ?? 10)),
      el("mask", { id: vMask }, [el("rect", { fill: `url(#${vMask}-gradient)`, ...box })]),
    );
  }
  if (fadeHorizontal && fadeVertical) {
    masks.push(el("mask", { id: both }, [el("g", { mask: `url(#${hMask})` }, [el("rect", { fill: `url(#${vMask}-gradient)`, ...box })])]));
  }
  let mask: string | undefined;
  if (fadeHorizontal && fadeVertical) {
    mask = `url(#${both})`;
  } else if (fadeHorizontal) {
    mask = `url(#${hMask})`;
  } else if (fadeVertical) {
    mask = `url(#${vMask})`;
  }
  const loaded = props.isLoaded !== false;
  return el("g", { "aria-hidden": "true", class: "chart-background" }, [
    masks.length > 0 ? el("defs", {}, masks) : null,
    el("defs", {}, [tile]),
    el("rect", { fill: `url(#${patternId})`, height, mask, width, x: 0, y: 0 }, [], {
      // bklit fades the rect from 0 to `opacity` (420ms easeOut) once loaded, and holds it at 0 until then.
      style: loaded ? { opacity, animation: "bkm-bg-in 420ms ease-out" } : { opacity: 0 },
    }),
  ]);
}
