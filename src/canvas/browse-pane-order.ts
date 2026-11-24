/** Browser-local presentation only; never serialized into a share URL or FCT. */
export const DEFAULT_BROWSE_PANE_ORDER = ["filters", "results", "record"] as const;
export type BrowsePane = (typeof DEFAULT_BROWSE_PANE_ORDER)[number];
export type BrowsePaneOrder = readonly BrowsePane[];
export const BROWSE_PANE_ORDER_STORAGE_KEY = "maestro-browse-pane-order";
export const BROWSE_PANE_LABELS: Record<BrowsePane, string> = { filters: "Filters", results: "Results", record: "Record" };

export function isBrowsePaneOrder(value: unknown): value is BrowsePaneOrder {
  return Array.isArray(value) && value.length === 3 && new Set(value).size === 3 &&
    DEFAULT_BROWSE_PANE_ORDER.every(pane => value.includes(pane));
}
export function readBrowsePaneOrder(raw: string | null): BrowsePaneOrder {
  if (raw !== null) {
    try { const value: unknown = JSON.parse(raw); if (isBrowsePaneOrder(value)) return value; } catch { /* invalid preference */ }
  }
  return DEFAULT_BROWSE_PANE_ORDER;
}
/** Move one pane into the destination index, shifting the intervening panes. */
export function moveBrowsePane(order: BrowsePaneOrder, source: BrowsePane, targetIndex: number): BrowsePaneOrder {
  const from = order.indexOf(source);
  if (!isBrowsePaneOrder(order) || from === -1 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= order.length || from === targetIndex) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(targetIndex, 0, source);
  return next;
}
/** View/Analyze keep their original two-panel composition. */
const NON_BROWSE_ORDER: BrowsePaneOrder = ["filters", "results"];
export function activeBrowsePaneOrder(order: BrowsePaneOrder, browse: boolean): BrowsePaneOrder {
  return browse ? order : NON_BROWSE_ORDER;
}

export const BROWSE_PANE_SIZES_STORAGE_KEY = "maestro-browse-pane-sizes";
export type BrowsePaneSizes = readonly [number, number, number];
export const DEFAULT_BROWSE_PANE_SIZES: BrowsePaneSizes = [25, 45, 30];
export const MIN_BROWSE_PANE_SIZES: BrowsePaneSizes = [16, 25, 18];
function isBrowsePaneSizes(value: unknown): value is BrowsePaneSizes {
  return Array.isArray(value) && value.length === 3 && value.every((size, index) =>
    typeof size === "number" && Number.isFinite(size) && size >= MIN_BROWSE_PANE_SIZES[index]) &&
    Math.abs(value.reduce((sum, size) => sum + size, 0) - 100) < 0.1;
}
export function readBrowsePaneSizes(raw: string | null): BrowsePaneSizes {
  try { const value: unknown = JSON.parse(raw ?? "null"); if (isBrowsePaneSizes(value)) return value; }
  catch { /* invalid preference */ }
  return DEFAULT_BROWSE_PANE_SIZES;
}
export function browseSizesInOrder(sizes: BrowsePaneSizes, order: BrowsePaneOrder): number[] {
  return isBrowsePaneOrder(order) ? [...sizes] : [];
}
export function browseSizesFromLayout(order: BrowsePaneOrder, layout: number[]): BrowsePaneSizes | null {
  return isBrowsePaneOrder(order) && isBrowsePaneSizes(layout) ? [layout[0], layout[1], layout[2]] : null;
}
