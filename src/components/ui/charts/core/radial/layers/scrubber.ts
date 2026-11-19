import type { RadialScrubberProps } from "../../types/radial";
import { RADIAL_CROSSHAIR_SPRING } from "../spring";
import type { LayerContext, RadialLayer } from "./types";

export function scrubberLayer(props: Readonly<RadialScrubberProps>, { shell }: Readonly<LayerContext>): RadialLayer {
  const {
    variant = "solid", dashArray = "4 4", showDot, color = "var(--foreground)", lineOpacity = 0.7, strokeWidth = 1.5, dotRadius, rest, spring = RADIAL_CROSSHAIR_SPRING,
  } = props;
  const { binCount, orientation, trackNow, centerRadius, radius, layout } = shell;
  if (binCount === 0 || orientation === "angular") {
    return { marks: [], defs: "", css: "" };
  }
  return {
    marks: [],
    defs: "",
    css: "",
    scrubber: {
      variant, dashArray, showDot: showDot ?? variant !== "gradient", color, lineOpacity, strokeWidth, dotRadius: dotRadius ?? Math.max(2.5, radius * 0.011),
      rest: rest ?? (trackNow ? "now" : "hidden"), spring, inner: centerRadius + 2, outer: radius * layout.scrubberOuter,
    },
  };
}
