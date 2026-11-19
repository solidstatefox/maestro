import { referenceAreaResources } from "../markup/resources";
import { installMarkerSprings } from "../motion/marker-springs";
import { registerOverlays } from "./features";
import { buildOverlays, chartMarkerProps } from "./overlays";

export const enableOverlays = (): void => {
  registerOverlays({ build: buildOverlays, markerLists: (table) => chartMarkerProps(table).map((m) => m.items), installSprings: installMarkerSprings, resources: referenceAreaResources });
};
