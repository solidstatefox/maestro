import { INTERACTIVE_ATTR } from "../entrance/ready-gate";
import { attachTouchFocus, createInteractionHandle } from "./touch-focus";
import type { InteractionHandle } from "./touch-focus";
import { hostPointerMove } from "./host-pointer";

/** Plot geometry (svg px) the drag listeners read; the owner assigns it every draw. */
export interface DragGeom {
  left: number;
  top: number;
  innerWidth: number;
  innerHeight: number;
}

/** Where the drag's visuals go: the selection's svg px edges (null on release) and the press that hides the hover chrome. */
export interface DragHost {
  readonly drag: (edges: readonly [number, number] | null) => void;
  readonly press: (on: boolean) => void;
}

interface DragSelectOptions {
  /** The latest plot geometry, read at event time. */
  readonly geom: () => DragGeom;
  readonly host: DragHost;
  /** Plot-space edges of each drag step, or null on release. */
  readonly onSelect?: (edges: { startX: number; endX: number } | null) => void;
}

/** bklit's drag selection (use-chart-interaction handleMouseDown/Move/Up): a press clears tooltip, crosshair and pill (:207-218); the first drag move re-shows them at the press x
 * (re-anchor :315-325, line-chart.tsx:183). Native pointermove is swallowed while dragging; visuals are host attrs / CSS vars from `host.drag`. `onSelect` gets plot-space edges, or null on release. */
export interface DragSelect extends InteractionHandle {
  /** Ends any drag and clears the selection. */
  readonly clear: () => void;
}

/** `attach(host)` installs the drag listeners, then the touch focus (two fingers also drag the range), on the chart's host and returns their removal. */
export function createDragSelect(options: DragSelectOptions): DragSelect & { readonly attach: (host: HTMLElement) => () => void } {
  const { geom, host, onSelect } = options;
  const { interaction, onRender } = createInteractionHandle();
  let dragStartX: number | null = null;
  let swallowClick = false;
  // Press point (client px) whose chrome the first drag move re-shows; null once re-shown or when nothing is pending.
  let reanchor: { x: number; y: number } | null = null;
  const publish = (startX: number, endX: number): void => {
    host.drag([geom().left + startX, geom().left + endX]);
    onSelect?.({ startX, endX });
  };
  const end = (): void => {
    host.drag(null);
    onSelect?.(null);
  };
  const attachDrag = (el: HTMLElement): (() => void) => {
    const plotX = (event: PointerEvent): number | null => {
      // Scene coordinates from the public controller (dom-types.ts:83-87, interactions-and-selections.md:385).
      const scene = interaction.current?.clientToScene(event.clientX, event.clientY);
      if (!scene) {
        return null;
      }
      const g = geom();
      const x = scene.x - g.left;
      const y = scene.y - g.top;
      return x >= 0 && x <= g.innerWidth && y >= 0 && y <= g.innerHeight ? x : null;
    };
    // A mousedown would focus the chart surface, whose focus handler lands the keyboard focus on the first point.
    const mouseDown = (event: MouseEvent): void => {
      if (event.button === 0 && dragStartX !== null) {
        event.preventDefault();
      }
    };
    el.addEventListener("mousedown", mouseDown, true);
    const down = (event: PointerEvent): void => {
      swallowClick = false;
      const x = event.button === 0 && event.pointerType !== "touch" && el.hasAttribute(INTERACTIVE_ATTR) ? plotX(event) : null;
      if (x !== null) {
        dragStartX = x;
        swallowClick = true;
        end();
        // bklit handleMouseDown clears the tooltip at once; the renderer's own pointerdown must not re-focus the hover under the
        // pointer, so the press hides the chrome (`data-bkm-press`, instant like clearTooltip) and nulls the native focus.
        host.press(true);
        interaction.current?.setControlledFocus(null, { source: "pointer" });
        reanchor = { x: event.clientX, y: event.clientY };
        event.stopPropagation();
      }
    };
    const move = (event: PointerEvent): void => {
      const anchor = dragStartX;
      if (event.pointerType === "touch" || anchor === null) {
        return;
      }
      event.stopPropagation();
      const x = plotX(event);
      if (x === null) {
        return;
      }
      const pending = reanchor;
      if (pending) {
        // The first selection update re-anchors the hover at the last hovered x (the press point): a fresh native show, so the
        // tooltip fades and springs in like bklit's remounted TooltipBox.
        reanchor = null;
        interaction.current?.setControlledFocus(interaction.current.resolvePointer(pending.x, pending.y), { source: "pointer" });
      }
      publish(Math.min(anchor, x), Math.max(anchor, x));
    };
    const stop = (): void => {
      dragStartX = null;
      reanchor = null;
      end();
    };
    // The click that ends a press must not re-focus the chart at the pointer: bklit keeps the tooltip at the press-start x until
    // the next move, drag or not (a press without a move included), so the renderer never sees it.
    const click = (event: MouseEvent): void => {
      if (swallowClick) {
        swallowClick = false;
        event.stopPropagation();
      }
    };
    el.addEventListener("click", click, true);
    el.addEventListener("pointerdown", down, true);
    el.addEventListener(hostPointerMove(el), move, true);
    // bklit handleMouseLeave clears the tooltip and ends the drag (use-chart-interaction.ts:198-205). The renderer never saw this
    // press's moves (swallowed above), so it has no pointer to leave: a leave during a press clears the native focus itself.
    const leave = (): void => {
      if (dragStartX !== null) {
        interaction.current?.setControlledFocus(null, { source: "pointer" });
      }
      stop();
    };
    el.addEventListener("pointerleave", leave);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return (): void => {
      el.removeEventListener("click", click, true);
      el.removeEventListener("mousedown", mouseDown, true);
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener(hostPointerMove(el), move, true);
      el.removeEventListener("pointerleave", leave);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  };
  // bklit use-chart-interaction touch handling (touch-focus.ts); two fingers also drag the range.
  const onFingers = (clientXs: number[] | null): void => {
    const scenes = clientXs?.map((clientX) => interaction.current?.clientToScene(clientX, 0)?.x);
    const known = scenes?.filter((x): x is number => x !== undefined);
    if (!scenes || !known || known.length !== scenes.length) {
      end();
      host.press(true);
      return;
    }
    const xs = known.map((x) => x - geom().left);
    host.press(true);
    publish(Math.min(...xs), Math.max(...xs));
  };
  const attach = (el: HTMLElement): (() => void) => {
    const detachDrag = attachDrag(el);
    const detachTouch = attachTouchFocus(el, () => interaction.current, onFingers);
    return (): void => {
      detachDrag();
      detachTouch();
    };
  };
  const clear = (): void => {
    dragStartX = null;
    reanchor = null;
    end();
  };
  return { attach, clear, interaction, onRender };
}
