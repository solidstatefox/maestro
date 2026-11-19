import { createBackdrop } from "./backdrop";
import { createDotGrid } from "./dots";
import { registerChoroplethBackdrop, registerChoroplethDots, registerChoroplethMarkers } from "./features";
import { createMarkers } from "./markers";

export const enableChoroplethDots = (): void => { registerChoroplethDots(createDotGrid); };
export const enableChoroplethMarkers = (): void => { registerChoroplethMarkers(createMarkers); };
export const enableChoroplethBackdrop = (): void => { registerChoroplethBackdrop(createBackdrop); };
