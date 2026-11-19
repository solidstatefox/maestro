import { writable } from "../store";
import type { Readable } from "../store";
import type { SunburstBreadcrumbItem } from "../types/sunburst";
import type { ArcDatum, Focus, SunburstModel, SunburstNode } from "./arcs";

export interface SunburstHoverContextValue {
  hoveredArcIndex: number | null;
  setHoveredArcIndex: (index: number | null) => void;
  hoveredArc: ArcDatum | null;
  setHoveredArc: (arc: ArcDatum | null) => void;
}

/** Hover lives outside framework state, so the root never re-renders on hover: leaves subscribe (`useSunburstHover`), the root mirrors
 * it onto the DOM imperatively (hover-grow.ts). Its value is the hovered arc index; `set` is `commit`. */
export interface SunburstHoverStore extends Readable<number | null> {
  /** Commits a new hovered index and notifies subscribers (no-op if unchanged). */
  readonly commit: (index: number | null) => void;
  /** Latest arcs, written by the root. */
  readonly arcs: { current: readonly ArcDatum[] };
  /** Latest hover request handler (controlled: parent callback; uncontrolled: commit), written by the root. */
  readonly request: { current: (index: number | null) => void };
}

export const createSunburstHoverStore = (): SunburstHoverStore => {
  const index = writable<number | null>(null);
  return {
    arcs: { current: [] },
    commit: index.set,
    get: index.get,
    request: { current: () => undefined },
    subscribe: index.subscribe,
  };
};

/** Id of the arc the store holds, if any. */
export const hoveredArcId = (store: SunburstHoverStore): string | null => {
  const index = store.get();
  return index === null ? null : (store.arcs.current[index]?.id ?? null);
};

/** `useSunburstHover()` for the store's `hoveredArcIndex`: the setters go through the root's latest request handler. */
export const sunburstHoverValue = (store: SunburstHoverStore, hoveredArcIndex: number | null): SunburstHoverContextValue => {
  const hoveredArc = hoveredArcIndex === null ? null : (store.arcs.current[hoveredArcIndex] ?? null);
  return {
    hoveredArc,
    hoveredArcIndex,
    setHoveredArc: (arc) => { store.request.current(arc === null ? null : arc.arcIndex); },
    setHoveredArcIndex: (index) => { store.request.current(index); },
  };
};

export interface SunburstStableContextValue {
  data: SunburstNode;
  arcs: ArcDatum[];
  focusById: Map<string, Focus>;
  rootId: string;
  maxDepth: number;
  size: number;
  focus: Focus;
  focusId: string;
  zoomTo: (nextId: string) => void;
}

interface StableInput {
  readonly data: SunburstNode;
  readonly model: SunburstModel;
  /** The resolved focus: undefined only for a tree the model could not focus, which renders nothing. */
  readonly focus: Focus | undefined;
  readonly focusId: string;
  readonly size: number;
  readonly zoomTo: (nextId: string) => void;
}

/** `useSunburstStable()`, or null when there is no focus (the chart renders nothing). */
export const sunburstStableValue = ({ data, model, focus, focusId, size, zoomTo }: StableInput): SunburstStableContextValue | null =>
  focus === undefined ? null : { arcs: model.arcs, data, focus, focusById: model.focusById, focusId, maxDepth: model.maxDepth, rootId: model.rootId, size, zoomTo };

/** The drill-down trail, root first (`useSunburstBreadcrumbItems`): the root crumb is labelled with the root's name. */
export const breadcrumbItemsOf = (focus: Focus, focusById: ReadonlyMap<string, Focus>, rootId: string, rootName: string): SunburstBreadcrumbItem[] => {
  const crumbs: Focus[] = [];
  let cur: Focus | undefined = focus;
  while (cur) {
    crumbs.unshift(cur);
    cur = cur.parentId === null ? undefined : focusById.get(cur.parentId);
  }
  return crumbs.map((crumb, index) => ({
    id: crumb.id,
    isCurrent: index === crumbs.length - 1,
    label: crumb.id === rootId ? rootName : crumb.name,
  }));
};

/** `SunburstHint`'s default text: the hovered path, or the zoom instructions. */
export const hintTextFor = (hoveredArc: ArcDatum | null, focus: Focus): string => {
  if (hoveredArc) {
    return hoveredArc.trail.join("  ›  ");
  }
  return focus.depth === 0 ? "Click a segment to zoom in · hover to inspect" : "Click the center to zoom out";
};
