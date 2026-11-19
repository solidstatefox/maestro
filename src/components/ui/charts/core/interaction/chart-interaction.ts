import type { ChartSelection } from "../types/cartesian";
import type { BandConfig } from "../types/range-overlays";
import type { LineConfig, Margin, TooltipData } from "../types/context";
import { axisId } from "../cartesian/series";

/** A y scale as the handlers use it: a value to px. */
type YScale = (value: number) => number | undefined;

export interface ChartInteractionParams {
  readonly xScale: { (value: Date): number | undefined; invert(px: number): Date };
  readonly yScale: YScale;
  readonly yScales: Readonly<Record<string, YScale>>;
  readonly data: readonly Record<string, unknown>[];
  readonly lines: readonly LineConfig[];
  /** `Band` configs: their edges get tooltip dot positions (a line's key wins). */
  readonly bands?: readonly BandConfig[];
  readonly margin: Margin;
  readonly xAccessor: (datum: Record<string, unknown>) => Date;
  /** d3 `bisector(xAccessor).left`: the index the date would be inserted at, searching from `lo`. */
  readonly bisectDate: (data: readonly Record<string, unknown>[], date: Date, lo: number) => number;
  readonly canInteract: boolean;
}

/** The hover state: the hovered row and the drag selection, subscribed to outside any framework. */
export interface ChartHoverState {
  readonly tooltipData: TooltipData | null;
  readonly selection: ChartSelection | null;
}

export interface ChartHoverStore {
  getSnapshot(): ChartHoverState;
  subscribe(listener: () => void): () => void;
  setTooltipData(next: TooltipData | null): void;
  setSelection(next: ChartSelection | null): void;
  clearSelection(): void;
}

export function createChartHoverStore(): ChartHoverStore {
  const listeners = new Set<() => void>();
  let snapshot: ChartHoverState = { tooltipData: null, selection: null };
  const emit = (next: ChartHoverState): void => {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const store: ChartHoverStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setTooltipData(next) {
      if (next !== snapshot.tooltipData) {
        emit({ ...snapshot, tooltipData: next });
      }
    },
    setSelection(next) {
      if (next !== snapshot.selection) {
        emit({ ...snapshot, selection: next });
      }
    },
    clearSelection: () => {
      store.setSelection(null);
    },
  };
  return store;
}

/** A pointer or touch event as the handlers read it: the DOM's, or a framework's wrapper with the same fields. */
export interface InteractionEvent {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly touches?: ArrayLike<{ readonly clientX: number; readonly clientY: number }>;
  readonly currentTarget: EventTarget | null;
  preventDefault(): void;
}

/** The handlers of a plot group (bklit's `interactionHandlers`), empty functions while the chart can't interact. */
export interface ChartInteractionHandlers {
  readonly mousemove: (event: InteractionEvent) => void;
  readonly mouseleave: () => void;
  readonly mousedown: (event: InteractionEvent) => void;
  readonly mouseup: () => void;
  readonly touchstart: (event: InteractionEvent) => void;
  readonly touchmove: (event: InteractionEvent) => void;
  readonly touchend: () => void;
}

export interface ChartInteraction {
  readonly hoverStore: ChartHoverStore;
  readonly handlers: ChartInteractionHandlers;
  /** bklit's `interactionStyle`: a crosshair cursor while interactive, and no touch panning. */
  style(): { readonly cursor: string; readonly "touch-action": string };
  /** After the scales or data change: re-anchor the tooltip on the last hovered x (a brush zoom moves the rows under the pointer). */
  reanchor(): void;
  /** Cancels a pending frame. */
  dispose(): void;
}

/** Pixel y per line key, plus band edge keys (line keys win on a shared key). */
function yPositionsOf(d: Record<string, unknown>, p: ChartInteractionParams): Record<string, number> {
  const out: Record<string, number> = {};
  const place = (key: string, id: string | number | undefined): void => {
    const value = d[key];
    if (typeof value === "number") {
      out[key] = (p.yScales[axisId(id)] ?? p.yScale)(value) ?? 0;
    }
  };
  for (const band of p.bands ?? []) {
    if (band.showInTooltip) {
      place(band.upperKey, band.yAxisId);
      place(band.lowerKey, band.yAxisId);
    }
  }
  for (const line of p.lines) {
    place(line.dataKey, line.yAxisId);
  }
  return out;
}

/** The nearer of the two rows around plot x `px` (bklit: the lower one on a tie). */
function nearestIndex(px: number, p: ChartInteractionParams): number {
  const x0 = p.xScale.invert(px);
  const index = p.bisectDate(p.data, x0, 1);
  const d0 = p.data[index - 1];
  const d1 = p.data[index];
  if (!d0) {
    return -1;
  }
  if (d1 && x0.getTime() - p.xAccessor(d0).getTime() > p.xAccessor(d1).getTime() - x0.getTime()) {
    return index;
  }
  return index - 1;
}

/** Plot x of an event (or of its `touch`-th touch) in the svg's user space, the margin taken off (bklit getChartX + visx localPoint). */
function chartX(event: InteractionEvent, margin: Margin, touch?: number): number | null {
  const point = touch === undefined ? event : event.touches?.[touch];
  if (point?.clientX === undefined || point.clientY === undefined) {
    return null;
  }
  const target = event.currentTarget;
  const svg = target instanceof SVGSVGElement ? target : target instanceof SVGElement ? target.ownerSVGElement : null;
  const ctm = svg?.getScreenCTM();
  if (svg && ctm) {
    const local = new DOMPoint(point.clientX, point.clientY).matrixTransform(ctm.inverse());
    return local.x - margin.left;
  }
  if (target instanceof Element) {
    return point.clientX - target.getBoundingClientRect().left - margin.left;
  }
  return null;
}

/** The handlers and store of one custom chart; `params` is read at every event, so the caller hands the latest each render. */
export function createChartInteraction(params: () => ChartInteractionParams): ChartInteraction {
  const hoverStore = createChartHoverStore();
  let dragging = false;
  let dragStart = 0;
  let lastX: number | null = null;
  let lastKey: string | null = null;
  let pending: { readonly tooltip: TooltipData; readonly key: string } | null = null;
  let frame = 0;

  const flush = (): void => {
    frame = 0;
    if (pending && pending.key !== lastKey) {
      lastKey = pending.key;
      hoverStore.setTooltipData(pending.tooltip);
    }
    pending = null;
  };
  const schedule = (tooltip: TooltipData, key = `${tooltip.index}:${Math.round(tooltip.x)}`): void => {
    pending = { tooltip, key };
    if (key === lastKey || frame !== 0) {
      return;
    }
    frame = requestAnimationFrame(flush);
  };
  const clear = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    lastKey = null;
    hoverStore.setTooltipData(null);
  };
  const tooltipAt = (px: number): TooltipData | null => {
    const p = params();
    const index = nearestIndex(px, p);
    const d = p.data[index];
    if (!d) {
      return null;
    }
    return { point: d, index, x: p.xScale(p.xAccessor(d)) ?? 0, yPositions: yPositionsOf(d, p) };
  };
  const select = (a: number, b: number): void => {
    const p = params();
    const startX = Math.min(a, b);
    const endX = Math.max(a, b);
    hoverStore.setSelection({ startX, endX, startIndex: Math.max(0, nearestIndex(startX, p)), endIndex: Math.max(0, nearestIndex(endX, p)), active: true });
  };
  const hover = (px: number): void => {
    lastX = px;
    const tooltip = tooltipAt(px);
    if (tooltip) {
      schedule(tooltip);
    }
  };
  const live = (run: () => void): void => {
    if (params().canInteract) {
      run();
    }
  };

  const handlers: ChartInteractionHandlers = {
    mousemove: (event) => live(() => {
      const x = chartX(event, params().margin);
      if (x === null) {
        return;
      }
      if (dragging) {
        select(dragStart, x);
        return;
      }
      hover(x);
    }),
    mouseleave: () => live(() => {
      lastX = null;
      clear();
      dragging = false;
      hoverStore.setSelection(null);
    }),
    mousedown: (event) => live(() => {
      const x = chartX(event, params().margin);
      if (x === null) {
        return;
      }
      // No native text selection across the page while dragging.
      event.preventDefault();
      dragging = true;
      dragStart = x;
      clear();
      hoverStore.setSelection(null);
    }),
    mouseup: () => live(() => {
      dragging = false;
      hoverStore.setSelection(null);
    }),
    touchstart: (event) => live(() => {
      const count = event.touches?.length ?? 0;
      if (count === 1) {
        event.preventDefault();
        const x = chartX(event, params().margin, 0);
        if (x !== null) {
          hover(x);
        }
      } else if (count === 2) {
        event.preventDefault();
        lastKey = null;
        clear();
        const a = chartX(event, params().margin, 0);
        const b = chartX(event, params().margin, 1);
        if (a !== null && b !== null) {
          select(a, b);
        }
      }
    }),
    touchmove: (event) => live(() => {
      const count = event.touches?.length ?? 0;
      if (count === 1) {
        event.preventDefault();
        const x = chartX(event, params().margin, 0);
        if (x !== null) {
          hover(x);
        }
      } else if (count === 2) {
        event.preventDefault();
        const a = chartX(event, params().margin, 0);
        const b = chartX(event, params().margin, 1);
        if (a !== null && b !== null) {
          select(a, b);
        }
      }
    }),
    touchend: () => live(() => {
      clear();
      hoverStore.setSelection(null);
    }),
  };

  return {
    hoverStore,
    handlers,
    style: () => ({ cursor: params().canInteract ? "crosshair" : "default", "touch-action": "none" }),
    reanchor() {
      if (!params().canInteract || lastX === null) {
        return;
      }
      const tooltip = tooltipAt(lastX);
      if (tooltip) {
        schedule(tooltip, `${tooltip.index}:${Math.round(tooltip.x)}`);
      } else {
        clear();
      }
    },
    dispose() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
