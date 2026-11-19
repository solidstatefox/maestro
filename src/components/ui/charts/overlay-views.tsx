"use client";
// bklit-ui's cartesian building blocks that render or hook on React: TooltipHeader (a custom tooltip body's header row), BackgroundPatternLayer
// (a pattern fill with edge fades at an explicit size, for any svg) and useChartInteraction (the hover and drag handlers of a custom chart
// shell). Their logic and markup are the core's (core/tooltip/header.ts, core/markup/background-layer.ts, core/interaction/chart-interaction.ts).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement, ReactNode, TouchEvent as ReactTouchEvent } from "react";
import { createChartInteraction } from "./core/interaction/chart-interaction";
import type { ChartHoverStore, ChartInteractionParams } from "./core/interaction/chart-interaction";
import { backgroundPatternLayerTree } from "./core/markup/background-layer";
import { toCamel } from "./core/style";
import { TOOLTIP_HEADER_STYLE, tooltipHeaderClass } from "./core/tooltip/header";
import type { BackgroundPatternLayerProps, TooltipHeaderProps as CoreTooltipHeaderProps } from "./core/types/range-overlays";
import { renderMarkup } from "./runtime/markup";

/** Props of `TooltipHeader`. */
export interface TooltipHeaderProps extends CoreTooltipHeaderProps<ReactNode> {}

const HEADER_STYLE: CSSProperties = /* @__PURE__ */ toCamel(TOOLTIP_HEADER_STYLE);

/**
 * The popover-style header row of a custom tooltip body: a medium-weight label over a full-width border. Put it at the top of `ChartTooltip`'s
 * `content`, above your rows.
 */
export const TooltipHeader = /* @__PURE__ */ Object.assign(
  ({ children, className }: Readonly<TooltipHeaderProps>): ReactElement => (
    <div className={tooltipHeaderClass(className)} style={HEADER_STYLE}>
      {children}
    </div>
  ),
  { displayName: "TooltipHeader" },
);

/**
 * A pattern fill with edge fades at an explicit `width` and `height`, faded in once `isLoaded`: the cartesian `Background` without its chart,
 * for any svg (a custom chart, a map). Place it inside an `<svg>`.
 */
export const BackgroundPatternLayer = /* @__PURE__ */ Object.assign(
  (props: Readonly<BackgroundPatternLayerProps>): ReactNode => {
    const id = useId().replaceAll(":", "");
    const tree = useMemo(() => backgroundPatternLayerTree(props, id), [props, id]);
    return tree === null ? null : renderMarkup(tree);
  },
  { displayName: "BackgroundPatternLayer" },
);

/** The handlers `useChartInteraction` returns, for a plot `<g>` or `<rect>`. */
export interface ChartInteractionHandlers {
  onMouseMove?: (event: ReactMouseEvent<SVGElement>) => void;
  onMouseLeave?: () => void;
  onMouseDown?: (event: ReactMouseEvent<SVGElement>) => void;
  onMouseUp?: () => void;
  onTouchStart?: (event: ReactTouchEvent<SVGElement>) => void;
  onTouchMove?: (event: ReactTouchEvent<SVGElement>) => void;
  onTouchEnd?: () => void;
}

/** What `useChartInteraction` returns. */
export interface ChartInteractionResult {
  /** The hovered row and drag selection, outside React state: a move re-renders only what subscribes (`useSyncExternalStore`). */
  hoverStore: ChartHoverStore;
  interactionHandlers: ChartInteractionHandlers;
  interactionStyle: CSSProperties;
}

/**
 * The hover and drag handling of a custom time-series chart (bklit's chart shells use it): spread `interactionHandlers` and
 * `interactionStyle` on the plot group, read the hovered row and the selection from `hoverStore`. Tooltip updates are coalesced to one per
 * frame and skipped while the row is unchanged.
 */
export function useChartInteraction(params: ChartInteractionParams): ChartInteractionResult {
  const latest = useRef(params);
  latest.current = params;
  const [interaction] = useState(() => createChartInteraction(() => latest.current));
  const { xScale, data, lines, bands, canInteract } = params;
  // A brush zoom moves the rows under a still pointer: re-anchor the tooltip on the last hovered x.
  useEffect(() => {
    interaction.reanchor();
  }, [interaction, xScale, data, lines, bands, canInteract]);
  useEffect(() => () => { interaction.dispose(); }, [interaction]);
  const { handlers } = interaction;
  const interactionHandlers = useMemo<ChartInteractionHandlers>(
    () =>
      canInteract
        ? {
            onMouseMove: handlers.mousemove,
            onMouseLeave: handlers.mouseleave,
            onMouseDown: handlers.mousedown,
            onMouseUp: handlers.mouseup,
            onTouchStart: handlers.touchstart,
            onTouchMove: handlers.touchmove,
            onTouchEnd: handlers.touchend,
          }
        : {},
    [canInteract, handlers],
  );
  const interactionStyle = useMemo<CSSProperties>(() => ({ cursor: canInteract ? "crosshair" : "default", touchAction: "none" }), [canInteract]);
  return { hoverStore: interaction.hoverStore, interactionHandlers, interactionStyle };
}
