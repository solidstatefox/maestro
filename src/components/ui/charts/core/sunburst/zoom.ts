import type { ChartPoint, ChartScene } from "@tanstack/charts";
import { erase } from "../erase";
import { raiseAttribute } from "../host-write";
import type { KeyboardFocusHold } from "../interaction/keyboard-hold";
import type { ArcDatum, Focus, SunburstModel } from "./arcs";
import { isHub } from "./hub";
import type { SunburstDatum } from "./hub";
import { setFlag } from "./push";

interface ZoomToInput {
  /** The focused node now: zooming to it does nothing. */
  readonly focusId: string;
  readonly focusById: ReadonlyMap<string, Focus>;
  readonly host: HTMLElement | null;
  /** Arcs on the last hovered path (hover-grow.ts), for the snap. */
  readonly hoverPath: readonly number[];
  readonly setHoveredArcIndex: (index: number | null) => void;
  readonly isFocusControlled: boolean;
  readonly onFocusChange: ((focusId: string) => void) | undefined;
  readonly setInternalFocusId: (id: string) => void;
}

/** bklit's `zoomTo(nextId)`: drops the hover and moves the focus (a controlled chart asks its parent through `onFocusChange`). */
export const zoomToNode = (input: Readonly<ZoomToInput>, nextId: string): void => {
  const { focusId, focusById, host, hoverPath, setHoveredArcIndex, isFocusControlled, onFocusChange, setInternalFocusId } = input;
  if (nextId === focusId || !focusById.has(nextId)) {
    return;
  }
  // bklit's zoomTo drops the hover and resets the grow at once (sunburst-chart.tsx:231-234), so only the dim eases (0.16s). The host keeps the dropped path in
  // `data-bk-snap` until the next hover (sunburst.css turns those transitions off); a hub click drops the hover (onFocusChange) earlier in the same click task.
  if (host) {
    raiseAttribute(host, "data-bk-snap");
    setFlag(host, "a", "data-bk-s", hoverPath);
  }
  setHoveredArcIndex(null);
  if (isFocusControlled) {
    onFocusChange?.(nextId);
  } else {
    setInternalFocusId(nextId);
  }
};

type SunburstPoint = ChartPoint<SunburstDatum, number, number>;

interface ZoomInput {
  readonly model: SunburstModel;
  readonly focus: Focus | undefined;
  readonly arcById: ReadonlyMap<string, ArcDatum>;
  readonly holdFocus: KeyboardFocusHold;
  /** The chart's `zoomTo` (`zoomToNode` over its latest focus and props). */
  readonly zoomTo: (nextId: string) => void;
}

export interface SunburstZoom {
  /** The latest focus, model and `zoomTo` (each controller pass); every handler reads them at call time. */
  update(input: Readonly<ZoomInput>): void;
  /** Whether a click on `datum` zooms: a branch sector, or the hub once drilled in. */
  readonly zoomable: (datum: SunburstDatum) => boolean;
  /** The definition's selection `change`: whether the select about to zoom came from a key. */
  readonly noteSource: (source: "pointer" | "keyboard") => void;
  /** From the chart's `onRender`: a keyboard zoom hands the focus over once the new view rendered. */
  readonly handFocusOver: (scene: ChartScene<SunburstDatum, number, number>) => void;
  /** The chart's `onSelect`. */
  readonly selectZoom: (point: SunburstPoint | null) => void;
  /** Installs the Escape listener on the chart's host; returns its removal. */
  readonly attach: (host: HTMLElement) => () => void;
}

export const createSunburstZoom = (): SunburstZoom => {
  let latest: Readonly<ZoomInput> | null = null;
  // The node a keyboard zoom hands the focus to once the new view renders (null for a pointer zoom), and whether the last input was a key.
  let pendingFocus: string | null = null;
  let keyZoom = false;
  // The host `attach` installed Escape on: a keyboard zoom puts the DOM focus back inside it (`refocus`).
  let attached: HTMLElement | null = null;

  const zoomable = (datum: SunburstDatum): boolean =>
    isHub(datum) ? (latest?.focus?.parentId ?? null) !== null : latest?.arcById.get(datum.id)?.hasChildren === true;

  /** `change` runs before `onSelect` for both pointer and keyboard selects (renderer.ts:830,868). */
  const noteSource = (source: "pointer" | "keyboard"): void => {
    keyZoom = source === "keyboard";
  };

  /** A keyboard zoom leaves the focus on the old view's point; hand it to the node chosen in `selectZoom` so it is visible at once. */
  const handFocusOver = (scene: ChartScene<SunburstDatum, number, number>): void => {
    const pendingId = pendingFocus;
    if (pendingId === null) {
      return;
    }
    pendingFocus = null;
    const target = scene.points.find((point) => !isHub(point.datum) && point.datum.id === pendingId) ?? scene.points.find((point) => isHub(point.datum));
    if (target !== undefined) {
      // Through the hold, so a blur clears it: a controller-set focus is skipped by the renderer's keyboard blur clear (renderer.ts:738).
      latest?.holdFocus.setKeyboardFocus(erase(target));
    }
    refocus();
  };

  /** A zoom rebuilds the sector layer (controller.ts `layerCell`, keyed on the feed), so the renderer remounts the surface's root
   * (renderer.ts:111-118) and the DOM focus that root held falls to <body>: the next arrow or Escape would reach nothing, though the
   * description promises both. After a keyboard zoom's hand-over, the new root takes the focus back; the hand-over came first, so the
   * renderer's focusin finds its focus set and keeps it (renderer.ts:683). Focus that went anywhere else is left there. */
  const refocus = (): void => {
    const host = attached;
    const doc = host?.ownerDocument;
    if (!host || !doc) {
      return;
    }
    const active = doc.activeElement;
    if (active !== null && active !== doc.body && active !== doc.documentElement) {
      return;
    }
    host.querySelector<HTMLElement>(".ts-chart-surface > [tabindex]")?.focus({ preventScroll: true });
  };

  const selectZoom = (point: SunburstPoint | null): void => {
    const datum = point?.datum;
    const input = latest;
    const focus = input?.focus;
    if (datum === undefined || input === null || focus === undefined) {
      return;
    }
    const { model, arcById, zoomTo } = input;
    const byKey = keyZoom;
    if (isHub(datum)) {
      if (focus.parentId !== null) {
        // Zooming out lands on the node just left, which is drawn one level up.
        pendingFocus = byKey ? focus.id : null;
        zoomTo(focus.parentId);
      }
      return;
    }
    if (arcById.get(datum.id)?.hasChildren === true) {
      // Zooming in lands on the first drawn child (lowest arc index, as the keyboard order goes).
      const first = model.arcs.find((arc) => arc.parentId === datum.id);
      pendingFocus = byKey ? (first?.id ?? null) : null;
      zoomTo(datum.id);
    }
  };

  // No native drill-out exists (TanStack's Escape handling covers pinned tooltips, cursors, brushes and the continuous zoom only), so Escape
  // within the host takes the hub click's path, landing on the node just left. At the root it is left alone for the page.
  const zoomOut = (): boolean => {
    const input = latest;
    const focus = input?.focus;
    const parentId = focus?.parentId ?? null;
    if (input === null || focus === undefined || parentId === null) {
      return false;
    }
    pendingFocus = focus.id;
    input.zoomTo(parentId);
    return true;
  };

  const attach = (host: HTMLElement): (() => void) => {
    attached = host;
    const escape = (event: KeyboardEvent): void => {
      const plain = !(event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented);
      if (event.key === "Escape" && plain && zoomOut()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    host.addEventListener("keydown", escape);
    return (): void => {
      host.removeEventListener("keydown", escape);
      if (attached === host) {
        attached = null;
      }
    };
  };

  return {
    attach,
    handFocusOver,
    noteSource,
    selectZoom,
    update(input) {
      latest = input;
    },
    zoomable,
  };
};
