import { useSyncExternalStore } from "react";
import type { PlotSnapshot, PlotStore } from "../../core/cartesian/plot-size";

const noSnapshot = (): null => null;

/** The latest published plot (null before the first draw); only the leaves that draw from the size mount this. */
export const usePlotSnapshot = (store: PlotStore): PlotSnapshot | null => useSyncExternalStore(store.subscribe, store.get, noSnapshot);
