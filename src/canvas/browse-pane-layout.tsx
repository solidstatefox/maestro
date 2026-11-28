"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { initializeMaestroStorage, maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";
import { BROWSE_PANE_ORDER_STORAGE_KEY, DEFAULT_BROWSE_PANE_ORDER, isBrowsePaneOrder, readBrowsePaneOrder, type BrowsePane, type BrowsePaneOrder, BROWSE_PANE_SIZES_STORAGE_KEY, DEFAULT_BROWSE_PANE_SIZES, MIN_BROWSE_PANE_SIZES, readBrowsePaneSizes, type BrowsePaneSizes } from "@/canvas/browse-pane-order";

export function useBrowsePanePreference() {
  const [order, setOrder] = useState<BrowsePaneOrder>(DEFAULT_BROWSE_PANE_ORDER);
  const [sizes, setSizes] = useState<BrowsePaneSizes>(DEFAULT_BROWSE_PANE_SIZES);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void initializeMaestroStorage().then(() => {
      if (!active) return;
      setOrder(readBrowsePaneOrder(maestroStorageGet(BROWSE_PANE_ORDER_STORAGE_KEY)));
      setSizes(readBrowsePaneSizes(maestroStorageGet(BROWSE_PANE_SIZES_STORAGE_KEY)));
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);
  const changeOrder = useCallback((next: BrowsePaneOrder) => {
    if (!loaded || !isBrowsePaneOrder(next)) return;
    setOrder(next);
    maestroStorageSet(BROWSE_PANE_ORDER_STORAGE_KEY, JSON.stringify(next));
  }, [loaded]);
  const changeSizes = useCallback((next: BrowsePaneSizes) => {
    if (!loaded) return;
    setSizes(next);
    maestroStorageSet(BROWSE_PANE_SIZES_STORAGE_KEY, JSON.stringify(next));
  }, [loaded]);
  return useMemo(() => ({ order, loaded, changeOrder, sizes, changeSizes }), [order, loaded, changeOrder, sizes, changeSizes]);
}
export const BrowsePanePreferenceContext = createContext<ReturnType<typeof useBrowsePanePreference>>({
  order: DEFAULT_BROWSE_PANE_ORDER, loaded: false, changeOrder: () => {}, sizes: DEFAULT_BROWSE_PANE_SIZES, changeSizes: () => {},
});
export const BrowsePanePositionContext = createContext<BrowsePaneOrder>(DEFAULT_BROWSE_PANE_ORDER);
export function useBrowsePanePosition(pane: BrowsePane): number {
  const order = useContext(BrowsePanePositionContext);
  const position = order.indexOf(pane);
  return position < 0 ? DEFAULT_BROWSE_PANE_ORDER.indexOf(pane) : position;
}

export function useBrowsePaneDefaultSize(pane: BrowsePane, fallback: number): number {
  const order = useContext(BrowsePanePositionContext);
  const preference = useContext(BrowsePanePreferenceContext);
  const index = order.indexOf(pane);
  const widths = preference.loaded ? preference.sizes : DEFAULT_BROWSE_PANE_SIZES;
  if (order.length === 2 && index >= 0) {
    const filterIndex = preference.order.indexOf("filters");
    return pane === "filters" ? widths[filterIndex] : 100 - widths[filterIndex];
  }
  return order.length === 3 && index >= 0 ? widths[index] : fallback;
}

export function useBrowsePaneMinSize(pane: BrowsePane, fallback: number): number {
  const order = useContext(BrowsePanePositionContext);
  const index = order.indexOf(pane);
  const preference = useContext(BrowsePanePreferenceContext);
  if (order.length === 2 && index >= 0) {
    return pane === "filters" ? MIN_BROWSE_PANE_SIZES[preference.order.indexOf("filters")] : 25;
  }
  return order.length === 3 && index >= 0 ? MIN_BROWSE_PANE_SIZES[index] : fallback;
}
