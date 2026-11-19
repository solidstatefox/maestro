import type { ChoroplethTooltipData, HoverStore } from "../types/choropleth";

export const createHoverStore = (): HoverStore => {
  const notify = (): void => {
    store.version += 1;
    for (const listener of store.listeners) {listener();}
  };
  const store: HoverStore = {
    hovered: null,
    listeners: new Set(),
    marker: null,
    set: (hovered, tooltip) => {
      // A feature hover replaces a marker's (bklit's marker enter clears the feature, its leave the marker).
      if (store.hovered === hovered && store.tooltip === tooltip && (hovered === null || store.marker === null)) {return;}
      store.hovered = hovered;
      store.tooltip = tooltip;
      if (hovered !== null) {store.marker = null;}
      notify();
    },
    setMarker: (marker) => {
      if (store.marker === marker) {return;}
      store.marker = marker;
      if (marker !== null) {
        store.hovered = null;
        store.tooltip = null;
      }
      notify();
    },
    subscribe: (listener) => {
      store.listeners.add(listener);
      return (): void => { store.listeners.delete(listener); };
    },
    tooltip: null,
    version: 0,
  };
  return store;
};

/** The context's `setTooltipData`: a value, or an updater of the current one (React's setState shape). */
export type ChoroplethTooltipSetter = (next: ChoroplethTooltipData | null | ((previous: ChoroplethTooltipData | null) => ChoroplethTooltipData | null)) => void;

/** `setTooltipData` over the hover store: the updater is applied to the store's tooltip. */
export const tooltipSetter = (store: HoverStore): ChoroplethTooltipSetter =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- a value-or-updater union, discriminated at its only boundary
  (next): void => { store.set(store.hovered, typeof next === "function" ? next(store.tooltip) : next); };
