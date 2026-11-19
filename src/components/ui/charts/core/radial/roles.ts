import type { LayerContext, RadialLayer } from "./layers/types";

/** The carriers' roles in the chart's table. */
export const RADIAL_ROLES = {
  area: "radialArea",
  axis: "radialAxis",
  bar: "radialBar",
  dotBar: "radialDotBar",
  line: "radialLine",
  ringBar: "radialRingBar",
  scrubber: "radialScrubber",
} as const;

/** A layer's builder: its carrier's props over the chart's shell. */
export type RadialLayerBuilder = (props: Readonly<Record<string, unknown>>, context: Readonly<LayerContext>) => RadialLayer;

const builders = /* @__PURE__ */ new Map<string, RadialLayerBuilder>();

/** What a carrier's `enable` calls: its role's builder, for every radial chart. */
export const registerRadialLayer = (role: string, builder: RadialLayerBuilder): void => {
  builders.set(role, builder);
};

/** The builder of `role`, if its carrier has been enabled. */
export const radialLayerBuilder = (role: string): RadialLayerBuilder | undefined => builders.get(role);
