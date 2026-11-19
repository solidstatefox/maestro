import type { ChartPoint, ChartRendererRenderContext, ChartScene } from "@tanstack/charts";
import { erase } from "../erase";
import { clearAttribute, clearVar, raiseAttribute, writeVar } from "../host-write";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { createInteractionHandle } from "../interaction/touch-focus";
import { liveRowOf } from "./definition";
import type { LiveRow } from "./definition";
import { createEdgeHold } from "./live-edge";
import type { Frame, RollClock, RowLayout } from "./live-frame";
import { createCrosshairGlide } from "./live-glide";
import type { GlideView } from "./live-glide";
import { hostPointerMove } from "../interaction/host-pointer";

interface HoverBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** What the focus reads of the chart, fed on every render. */
export interface LiveFocusInput {
  readonly frame: Frame | null;
  /** The frame builder's rolling state (its `roll` is the path's clock). */
  readonly state: { readonly roll: RollClock | null };
  readonly hoverBounds: HoverBounds;
  readonly left: number;
  readonly top: number;
  readonly innerHeight: number;
  readonly pxPerMs: number;
}

export interface LiveFocus {
  /** The latest frame and plot geometry (React: every render). */
  readonly update: (input: LiveFocusInput) => void;
  /** Stable; the renderer's `onRender`: captures the interaction controller and the scene, and reports the scene's width. */
  readonly onRender: (context: ChartRendererRenderContext<never, never, never>) => void;
  /** Stable; the renderer's `onFocusChange`. */
  readonly onFocusChange: (point: { x: number; datum?: unknown } | null) => void;
  /** In the commit that shows a new frame (React: a layout effect): a held row's resting x moves with every tick. */
  readonly rolled: () => void;
  /** The keyboard hold's host listeners (React: a passive effect at mount); returns their removal. */
  readonly attachKeyboard: (host: HTMLElement) => () => void;
  /** The pointer listeners that refine a pointer-owned focus (React: a passive effect, again once the chart is built); returns their removal. */
  readonly attachPointer: (host: HTMLElement) => () => void;
  /** Stops the glide and edge loops and clears their host writes (unmount). */
  readonly dispose: () => void;
}

/** The focus of the chart on `host`. `setSceneWidth` takes an updater of the width the chart lays out on (the scene's, once it has one).
 * `surface` is the element the line's renderer draws in: the pointer's per-move vars (`--bkm-fx`, the glide's `--bkm-pgx` / `--bkm-pgy`)
 * go on it, so a write restyles the line's chain down to its readers (registered `inherits: false`, live-tick-fade.ts) and not the host's
 * other children (the pulse ring, the pill filter, the y labels' layer): 59 elements a write, not 69. The host takes them while there is no surface. */
export function createLiveFocus(host: { readonly current: HTMLElement | null }, setSceneWidth: (update: (current: number) => number) => void, surface: { readonly current: HTMLElement | null }): LiveFocus {
  let scene: ChartScene<never, never, never> | null = null;
  const pointerVars = { get current(): HTMLElement | null { return surface.current ?? host.current; } };
  /** Clears a pointer var wherever it was written (the host, before there was a surface). */
  const clearPointerVar = (name: string): void => {
    clearVar(pointerVars.current, name);
    clearVar(host.current, name);
  };
  // bklit's tick fade sits at the crosshair, here the renderer's focus. Core defers focus-state label opacity while the roll runs,
  // so the focus x goes into CSS vars (the surface's for the pointer, the host's for a key) and TICK_FADE_CSS fades against it; the pointer only refines a pointer-owned focus.
  const boundsRef: { current: HoverBounds } = { current: { left: 0, right: 0, top: 0, bottom: 0 } };
  const layoutRef: { current: RowLayout } = { current: { left: 0, x0: 0, pxPerMs: 0 } };
  const stateRef: { current: { readonly roll: RollClock | null } } = { current: { roll: null } };
  /** Focused row time (plot clock ms) while focus is keyboard-held, else null; `pointerFocus` while the pointer owns it. */
  const focusRef: { current: { row: number | null; pointer: boolean } } = { current: { row: null, pointer: false } };
  const writeRowFx = (): void => {
    const el = host.current;
    const t = focusRef.current.row;
    if (!el || t === null) {
      return;
    }
    const g = layoutRef.current;
    writeVar(el, "--bkm-kx", (g.left + (t - g.x0) * g.pxPerMs).toFixed(2));
    writeVar(el, "--bkm-pl", boundsRef.current.left.toFixed(2));
  };
  /** performance.now() of the commit that last restarted the roll, so a hold raised mid-roll joins the slide at its elapsed time. */
  let tickAt = 0;
  const { interaction: liveInteraction, onRender: onInteractionRender } = createInteractionHandle();
  const onRender = (context: ChartRendererRenderContext<never, never, never>): void => {
    onInteractionRender(context);
    scene = context.scene;
    setSceneWidth((current) => (context.scene.width > 0 && Math.round(context.scene.width) !== current ? Math.round(context.scene.width) : current));
  };
  // The hold is keyed by the held row's time (`t<ms>`, smoothed rows `t<ms>~j`; charts-core interaction.ts:97 restoreChartFocusPoint), checked by base key.
  // A row the roll or data dropped clamps to the row at or left of the plot's left edge (from `scene.points`), handed to `setControlledFocus`, which applies `group`.
  let frameRows: readonly LiveRow[] = [];
  const holdInteraction = (): typeof liveInteraction.current => {
    const i = liveInteraction.current;
    if (!i) {
      return null;
    }
    // The row at or left of the plot's left edge, from the scene's own points; core's `group` (liveFocus) then pins it at the edge.
    const atPlotLeft = (): ChartPoint<never, never, never> | null => {
      const rows = (scene?.points ?? [])
        .filter((p) => p.markId === "live:line" && liveRowOf(p)?.key !== "live:cursor" && liveRowOf(p)?.pad !== true)
        .sort((x, y) => x.x - y.x);
      const { left: plotLeft } = boundsRef.current;
      return rows.findLast((p) => p.x <= plotLeft) ?? rows.at(0) ?? null;
    };
    // SAFETY: the wrapper keeps every method of the interaction controller and only intercepts setControlledFocus.
    return {
      ...i,
      resolvePointer: i.resolvePointer.bind(i),
      setControlledFocus: (point: Parameters<typeof i.setControlledFocus>[0], options: Parameters<typeof i.setControlledFocus>[1]) => {
        // SAFETY: the focus point is a scene point or a pointer resolution; both carry the row as their datum.
        const held = liveRowOf(point as { datum?: unknown } | null);
        // The pointer's interpolated row (a blur handing the focus back to a resting pointer) is not a held row.
        if (point === null || !held || held.key === "live:cursor") {
          i.setControlledFocus(point, options);
          return;
        }
        const base = held.key.split("~")[0];
        if (frameRows.some((r) => r.key === base && !r.pad)) {
          i.setControlledFocus(point, options);
          return;
        }
        const edge = atPlotLeft();
        if (edge !== null) {
          i.setControlledFocus(edge, options);
        }
      },
    } as typeof i;
  };
  const holdFocus = createKeyboardFocusHold(holdInteraction);
  const glideFrameRef: { current: GlideView } = { current: { frame: null, top: 0, height: 0 } };
  const { glideTo, stopGlide } = createCrosshairGlide({ host, vars: pointerVars, view: glideFrameRef, state: stateRef, layout: layoutRef });
  const { holdEdge, stopEdge, edgeAt } = createEdgeHold({ host, focus: focusRef, view: glideFrameRef, layout: layoutRef, bounds: boundsRef });
  const onFocusChange = (point: { x: number; datum?: unknown } | null): void => {
    const el = host.current;
    // The pointer's interpolated `live:cursor` row is not a keyboard row: the hold only sees real rows (null for the cursor).
    holdFocus(erase(liveRowOf(point)?.key === "live:cursor" ? null : point));
    if (!el) {
      return;
    }
    const row = liveRowOf(point);
    // bklit dims the live dot and badge to 0.25 while its tooltip shows (live-line.tsx:112,245): any focus here shows one.
    if (!point || !row) {
      stopGlide();
      stopEdge();
      edgeAt.current = false;
      focusRef.current = { row: null, pointer: false };
      clearPointerVar("--bkm-fx");
      clearVar(el, "--bkm-kx");
      clearVar(el, "--bkm-pl");
      clearAttribute(el, "data-bkm-kfx");
      clearAttribute(el, "data-bkm-live-scrubbing");
      return;
    }
    if (row.key === "live:cursor") {
      // liveFocus resolves a pointer focus at the pointer x itself.
      if (!focusRef.current.pointer) {
        stopGlide();
        glideTo(point.x);
      }
      stopEdge();
      edgeAt.current = false;
      focusRef.current = { row: null, pointer: true };
      raiseAttribute(el, "data-bkm-live-scrubbing");
      clearAttribute(el, "data-bkm-kfx");
      clearVar(el, "--bkm-kx");
      const vars = pointerVars.current;
      if (vars) { writeVar(vars, "--bkm-fx", point.x.toFixed(1)); }
      return;
    }
    stopGlide();
    focusRef.current = { row: row.t, pointer: false };
    // The keyboard's x is the host's own rule (live-tick-fade.ts, from --bkm-kx); the surface inherits it once the pointer's is gone.
    clearPointerVar("--bkm-fx");
    writeRowFx();
    writeVar(el, "--bkm-fxd", `${-Math.round(performance.now() - tickAt)}ms`);
    raiseAttribute(el, "data-bkm-kfx");
    raiseAttribute(el, "data-bkm-live-scrubbing");
    holdEdge();
  };
  return {
    update: ({ frame, state, hoverBounds, left, top, innerHeight, pxPerMs }) => {
      boundsRef.current = hoverBounds;
      layoutRef.current = { left, x0: frame?.xDomain[0] ?? 0, pxPerMs };
      stateRef.current = state;
      frameRows = frame?.rows ?? [];
      glideFrameRef.current = { frame, top, height: innerHeight };
    },
    onRender,
    onFocusChange,
    // A held row's resting x moves with every tick: re-laid out in the commit that restarts the roll's --bkm-fxr.
    rolled: () => {
      tickAt = performance.now();
      if (host.current && focusRef.current.row !== null) {
        writeVar(host.current, "--bkm-fxd", "0ms");
      }
      writeRowFx();
      holdEdge();
    },
    attachKeyboard: (el) => holdFocus.attach(el),
    // Gap #45: `updateFocus` drops `onFocusChange` while the focus identity is unchanged (`sameChartPointIdentity`, charts-core interaction.ts:71-86),
    // so a pointer move refines the x of a pointer-owned focus; leaving needs no handler (the renderer drops that focus).
    attachPointer: (el) => {
      // Host box cached until scroll/resize: a per-move read after the --bkm-fx / --bkm-pgx writes forces layout
      // every pointermove (UPSTREAM-GAPS #21).
      let box: DOMRect | null = null;
      const drop = (): void => {
        box = null;
      };
      const resized = new ResizeObserver(drop);
      resized.observe(el);
      const move = (e: PointerEvent): void => {
        const b = boundsRef.current;
        box ??= el.getBoundingClientRect();
        const x = e.clientX - box.left;
        const y = e.clientY - box.top;
        if (focusRef.current.pointer && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) {
          writeVar(pointerVars.current ?? el, "--bkm-fx", x.toFixed(1));
          glideTo(x);
        }
      };
      el.addEventListener(hostPointerMove(el), move);
      el.addEventListener("pointerenter", drop);
      window.addEventListener("scroll", drop, { capture: true, passive: true });
      window.addEventListener("resize", drop);
      return (): void => {
        el.removeEventListener(hostPointerMove(el), move);
        el.removeEventListener("pointerenter", drop);
        window.removeEventListener("scroll", drop, { capture: true });
        window.removeEventListener("resize", drop);
        resized.disconnect();
      };
    },
    dispose: () => {
      stopGlide();
      stopEdge();
    },
  };
}
