import type { RadialAreaProps, RadialAxisProps, RadialBarProps, RadialDotBarProps, RadialLineProps, RadialRingBarProps, RadialScrubberProps } from "../types/radial";
import { areaLayer } from "./layers/area";
import { axisLayer } from "./layers/axis";
import { barLayer } from "./layers/bar";
import { dotBarLayer } from "./layers/dot-bar";
import { lineLayer } from "./layers/line";
import { ringBarLayer } from "./layers/ring-bar";
import { scrubberLayer } from "./layers/scrubber";
import { RADIAL_ROLES, registerRadialLayer } from "./roles";

// SAFETY (every builder below): the table holds one prop shape per role, the carrier's own.
// oxlint-disable typescript/no-unsafe-type-assertion -- see SAFETY above
export const enableRadialArea = (): void => { registerRadialLayer(RADIAL_ROLES.area, (props, context) => areaLayer(props as RadialAreaProps, context)); };
export const enableRadialAxis = (): void => { registerRadialLayer(RADIAL_ROLES.axis, (props, context) => axisLayer(props as RadialAxisProps, context)); };
export const enableRadialBar = (): void => { registerRadialLayer(RADIAL_ROLES.bar, (props, context) => barLayer(props as RadialBarProps, context)); };
export const enableRadialDotBar = (): void => { registerRadialLayer(RADIAL_ROLES.dotBar, (props, context) => dotBarLayer(props as RadialDotBarProps, context)); };
export const enableRadialLine = (): void => { registerRadialLayer(RADIAL_ROLES.line, (props, context) => lineLayer(props as unknown as RadialLineProps, context)); };
export const enableRadialRingBar = (): void => { registerRadialLayer(RADIAL_ROLES.ringBar, (props, context) => ringBarLayer(props as RadialRingBarProps, context)); };
export const enableRadialScrubber = (): void => { registerRadialLayer(RADIAL_ROLES.scrubber, (props, context) => scrubberLayer(props as RadialScrubberProps, context)); };
// oxlint-enable typescript/no-unsafe-type-assertion
