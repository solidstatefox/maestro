import type { ChartCursorController, ChartPoint } from "@tanstack/charts";
import { erase } from "../erase";
import { clearAttribute, raiseAttribute, writeAttribute } from "../host-write";
import type { KeyboardFocusHold } from "../interaction/keyboard-hold";
import { memoCell } from "../memo";
import type { ArcDatum } from "./arcs";
import { createSunburstHoverStore } from "./context";
import type { SunburstHoverStore } from "./context";
import { isHub } from "./hub";
import type { SunburstDatum } from "./hub";
import { reapplyPush, setFlag, writePush } from "./push";
import type { SectorPush } from "./push";
import type { SectorFeed } from "./sunburst-layer";
import type { SunburstNativeNode } from "./sunburst-mark";

interface HoverProps {
  readonly arcs: readonly ArcDatum[];
  /** The chart's `hoveredIndex` prop: defined makes the hover controlled. */
  readonly hoveredIndex: number | null | undefined;
  readonly onHoverChange: ((index: number | null) => void) | undefined;
}

export interface SunburstHoverFrame {
  readonly isHoverControlled: boolean;
  /** The controlled hover's arc (null when uncontrolled: the store holds that hover). */
  readonly hoveredArc: ArcDatum | null;
  /** The hover request: a controlled chart asks its parent (`onHoverChange`), else the store commits. Same function until the props it closes over change. */
  readonly setHoveredArcIndex: (index: number | null) => void;
}

export interface SunburstHover {
  readonly store: SunburstHoverStore;
  /** The latest arcs and hover props (each controller pass); the store's commit path reads them. */
  update(props: HoverProps): SunburstHoverFrame;
  /** Commits a controlled `hoveredIndex` into the store (the controller's passive work, on its change); an uncontrolled chart's store is left alone. */
  syncControlled(hoveredIndex: number | null | undefined): void;
}

export const createSunburstHover = (): SunburstHover => {
  const store = createSunburstHoverStore();
  const setterCell = memoCell<(index: number | null) => void>();
  return {
    store,
    update({ arcs, hoveredIndex, onHoverChange }) {
      const isHoverControlled = hoveredIndex !== undefined;
      store.arcs.current = arcs;
      const setHoveredArcIndex = setterCell([store, isHoverControlled, onHoverChange], () => (index: number | null): void => {
        if (isHoverControlled) {
          onHoverChange?.(index);
        } else {
          store.commit(index);
        }
      });
      store.request.current = setHoveredArcIndex;
      const hoveredArc = hoveredIndex === undefined || hoveredIndex === null ? null : (arcs[hoveredIndex] ?? null);
      return { hoveredArc, isHoverControlled, setHoveredArcIndex };
    },
    syncControlled(hoveredIndex) {
      if (hoveredIndex !== undefined) {
        store.commit(hoveredIndex);
      }
    },
  };
};

/** The arc index of a focused datum (null for the hub or none). */
export const hoveredIndexOf = (datum: SunburstDatum | undefined, arcById: ReadonlyMap<string, ArcDatum>): number | null =>
  datum === undefined || isHub(datum) ? null : (arcById.get(datum.id)?.arcIndex ?? null);

interface FocusReport {
  readonly host: HTMLElement | null;
  readonly holdFocus: KeyboardFocusHold;
  readonly arcById: ReadonlyMap<string, ArcDatum>;
  readonly setHoveredArcIndex: (index: number | null) => void;
}

/** The native `onFocusChange` report: the keyboard hold sees it, the host flags a focused hub (`data-bk-hub`, the keyboard ring), the hover follows the sector. */
export const reportSunburstFocus = (point: ChartPoint<SunburstDatum, number, number> | null, { host, holdFocus, arcById, setHoveredArcIndex }: FocusReport): void => {
  holdFocus(erase(point));
  if (host !== null) {
    if (isHub(point?.datum)) {
      raiseAttribute(host, "data-bk-hub");
    } else {
      clearAttribute(host, "data-bk-hub");
    }
  }
  setHoveredArcIndex(hoveredIndexOf(point?.datum, arcById));
};

/** A controlled hoveredIndex addresses the sector through the native cursor controller, so dimming/pop follow it. Call it when the hovered
 * arc or the definition changes (the registry is refilled by each render). */
export const applyControlledCursor = (
  controller: ChartCursorController<number, number>,
  registry: ReadonlyMap<string, ChartPoint<SunburstNativeNode, number, number>>,
  hoveredArcId: string | null,
): void => {
  const point = hoveredArcId === null ? undefined : registry.get(hoveredArcId);
  if (point === undefined) {
    controller.setState(null);
    return;
  }
  controller.setState({
    anchor: "value",
    origin: { datumIndex: point.datumIndex, key: point.key, markId: point.markId },
    pinned: false,
    source: "pointer",
    value: { x: point.xValue, y: point.yValue },
  });
};

const FLAGS = [["a", "data-bk-d"], ["a", "data-bk-p"], ["p", "data-bk-p"], ["l", "data-bk-r"]] as const;

interface HoverGrowInput {
  readonly host: () => HTMLElement | null;
  readonly hoverStore: SunburstHoverStore;
  readonly arcs: readonly ArcDatum[];
  readonly maxDepth: number;
  readonly focusDepth: number;
  readonly hoverPop: number;
  readonly pushes: ReadonlyMap<string, SectorPush>;
  /** Written with the arcs on the hovered path, for the zoom's snap (zoom.ts). */
  readonly hoverPath: { current: readonly number[] };
}

/** bklit drops unrelated sectors' labels the instant one is hovered: the host carries `data-bk-hov` and flags the related labels (sunburst.css rules are fixed),
 * and the same pass publishes the hover push (push.ts) as per-arc CSS vars. No render, no rebuild. Applies now and on every hover change; returns the
 * unsubscribe. Watch again when the scene is rebuilt (a new definition), so the hover is re-applied to the new sectors. */
export const watchHoverGrow = ({ host, hoverStore, arcs, maxDepth, focusDepth, hoverPop, pushes, hoverPath }: Readonly<HoverGrowInput>): (() => void) => {
  const apply = (): void => {
    const el = host();
    if (el === null) {
      return;
    }
    const index = hoverStore.get();
    const arc = index === null ? null : (arcs[index] ?? null);
    writePush(el, { arcs, focusDepth, hovered: arc, maxDepth, popOut: hoverPop, sectors: pushes });
    if (arc === null) {
      for (const [kind, name] of FLAGS) { setFlag(el, kind, name, []); }
      clearAttribute(el, "data-bk-pop");
      clearAttribute(el, "data-bk-path");
      clearAttribute(el, "data-bk-hov");
      return;
    }
    const path: number[] = [];
    const below: number[] = [];
    for (const other of arcs) {
      if (other.id === arc.id || arc.id.startsWith(`${other.id} / `)) {
        path.push(other.arcIndex);
      } else if (other.id.startsWith(`${arc.id} / `)) {
        below.push(other.arcIndex);
      }
    }
    hoverPath.current = path;
    clearAttribute(el, "data-bk-snap");
    setFlag(el, "a", "data-bk-s", []);
    setFlag(el, "a", "data-bk-d", below);
    setFlag(el, "a", "data-bk-p", path);
    setFlag(el, "p", "data-bk-p", path);
    setFlag(el, "l", "data-bk-r", [...path, ...below]);
    writeAttribute(el, "data-bk-pop", String(arc.arcIndex));
    writeAttribute(el, "data-bk-path", path.join(" "));
    raiseAttribute(el, "data-bk-hov");
  };
  apply();
  return hoverStore.subscribe(apply);
};

/** The push vars and flags live on the sector layer's own elements, which each paint may recreate: put them back after every paint of `feed`. Returns the undo. */
export const reapplyPushOnPaint = (feed: SectorFeed, host: () => HTMLElement | null): (() => void) => {
  feed.onPainted = (): void => { reapplyPush(host()); };
  return (): void => { feed.onPainted = null; };
};
