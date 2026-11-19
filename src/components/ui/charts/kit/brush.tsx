"use client";

// ChartBrush carries `initialSelection` / `onSelectionChange` for the native brushX (cartesian/definition.ts).
// BrushLayout owns the zoom state: a main chart plus an optional brush strip.
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, NamedExoticComponent, ReactElement, ReactNode, SVGProps } from "react";
import { createPortal } from "react-dom";
import { cn } from "../core/cn";
import { defineCarrier } from "./role";
import { isNumber } from "../core/guards";
import { enableBrush } from "../core/cartesian/enable-brush";
import { useChartStable } from "./cartesian/chart-context";
import { renderPatternPreset } from "./pattern/pattern-preset-render";
import { useSanitizedId } from "./use-sanitized-id";
import type { ChartBrushLayoutState, ChartBrushSelection, ChartBrushSelectionOverlayProps, ChartBrushTrackOverlayProps, ChartBrushLayoutProps as CoreChartBrushLayoutProps, ChartBrushProps as CoreChartBrushProps } from "../core/types/brush";

/** Props of `ChartBrush`. */
export interface ChartBrushProps extends CoreChartBrushProps<SVGProps<SVGRectElement>> {}

/** Props of `ChartBrushLayout`. */
export interface ChartBrushLayoutProps extends CoreChartBrushLayoutProps<ReactNode> {}

/**
 * A range selector. Put it inside a second, small chart (the brush strip) next to a main chart; dragging or resizing the window reports the selected time range through `onSelectionChange`. Combine it with `ChartBrushLayout` to zoom the main chart.
 */
export const ChartBrush = /* @__PURE__ */ defineCarrier<Readonly<ChartBrushProps>>("brush", "ChartBrush", undefined, enableBrush);

// bklit chart-brush-track-overlay.tsx: outer panes fade over the first 15%.
const TRACK_OUTER_FADE = "15%";
const OVERLAY_LAYER: CSSProperties = { position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" };

const outsidePaneStyle = (edge: "left" | "right", blurPx: number, fadeOuterEdges: boolean): CSSProperties => {
  const fadeTo = edge === "left" ? "right" : "left";
  const mask = fadeOuterEdges ? `linear-gradient(to ${fadeTo}, transparent 0%, black ${TRACK_OUTER_FADE}, black 100%)` : undefined;
  const blur = blurPx > 0 ? `blur(${blurPx}px)` : undefined;
  return { position: "absolute", pointerEvents: "none", backdropFilter: blur, WebkitBackdropFilter: blur, maskImage: mask, WebkitMaskImage: mask };
};

const useMounted = (): boolean => {
  const [mounted, setMounted] = useState(false);
  // The post-commit re-render is the point: it is what makes `containerRef.current` readable.
  // oxlint-disable-next-line react/set-state-in-effect, react-doctor/rendering-hydration-no-flicker, react-doctor/no-initialize-state -- see above
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
};

/**
 * Dims the parts of a chart outside the brushed window, with an optional blur and faded outer edges. `ChartBrush` draws it for you; use it directly to build your own brush.
 */
export const ChartBrushTrackOverlay = ({ innerWidth, innerHeight, selectionX0, selectionX1, blurPx = 1.5, fadeOuterEdges = true }: Readonly<ChartBrushTrackOverlayProps>): ReactElement | null => {
  const { containerRef, margin } = useChartStable();
  const mounted = useMounted();
  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }
  const x0 = Math.max(0, Math.min(selectionX0, selectionX1, innerWidth));
  const x1 = Math.max(x0, Math.min(Math.max(selectionX0, selectionX1), innerWidth));
  const rightWidth = Math.max(0, innerWidth - x1);
  if (x0 <= 0 && rightWidth <= 0) {
    return null;
  }
  const blur = Math.min(5, Math.max(0, blurPx));
  const leftStyle: CSSProperties = { ...outsidePaneStyle("left", blur, fadeOuterEdges), top: margin.top, left: margin.left, width: x0, height: innerHeight };
  const rightStyle: CSSProperties = { ...outsidePaneStyle("right", blur, fadeOuterEdges), top: margin.top, left: margin.left + x1, width: rightWidth, height: innerHeight };
  return createPortal(
    <div aria-hidden="true" style={OVERLAY_LAYER}>
      {x0 > 0 ? <div style={leftStyle} /> : null}
      {rightWidth > 0 ? <div style={rightStyle} /> : null}
    </div>,
    container,
  );
};

/** Fills the brushed window with a pattern. `ChartBrush` draws it for you when `selectionPattern` is set. */
export const ChartBrushSelectionOverlay = ({ innerWidth, innerHeight, selectionX0, selectionX1, pattern }: Readonly<ChartBrushSelectionOverlayProps>): ReactElement | null => {
  const { containerRef, margin } = useChartStable();
  const mounted = useMounted();
  const patternId = useSanitizedId();
  const container = containerRef.current;
  if (!(mounted && container && pattern && pattern.preset !== "none")) {
    return null;
  }
  const x0 = Math.max(0, Math.min(selectionX0, selectionX1, innerWidth));
  const x1 = Math.max(x0, Math.min(Math.max(selectionX0, selectionX1), innerWidth));
  const patternNode = renderPatternPreset(pattern.preset, patternId, { ...pattern, opacity: undefined });
  if (x1 - x0 <= 0 || patternNode === undefined || patternNode === null) {
    return null;
  }
  return createPortal(
    <svg aria-hidden="true" height="100%" style={OVERLAY_LAYER} width="100%">
      <defs>{patternNode}</defs>
      <rect fill={`url(#${patternId})`} fillOpacity={pattern.opacity ?? 1} height={innerHeight} width={x1 - x0} x={margin.left + x0} y={margin.top} />
    </svg>,
    container,
  );
};

// Kept apart from kit toDate: other inputs (null, objects) go through String(), so they parse to NaN instead of epoch 0.
const toTime = (value: unknown): number => {
  if (value instanceof Date) {return value.getTime();}
  if (isNumber(value)) {return value;}
  return new Date(String(value)).getTime();
};

// Full data extent, optionally stretched to `xExtentMax`.
const resolveExtent = (data: readonly Record<string, unknown>[], xDataKey: string, xExtentMax?: Date): [Date, Date] | null => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of data) {
    const time = toTime(row[xDataKey]);
    if (Number.isFinite(time)) {
      min = Math.min(min, time);
      max = Math.max(max, time);
    }
  }
  if (min === Number.POSITIVE_INFINITY) {return null;}
  const end = xExtentMax && xExtentMax.getTime() > max ? xExtentMax.getTime() : max;
  return [new Date(min), new Date(end)];
};

// No selection (null) shows the full extent: it is the state until the strip reports a range and after a dataset swap, so a strip given
// `layout.brushSelection ?? window` starts at `window` (bklit's docs, brush.md "Start with a window"). A collapsed drag (null) resets to the full extent.
const useBrushSelection = (
  data: readonly Record<string, unknown>[],
  xDataKey: string,
  xExtentMax: Date | undefined,
  enabled: boolean,
): ChartBrushLayoutState => {
  const fullExtent = useMemo(() => resolveExtent(data, xDataKey, xExtentMax), [data, xDataKey, xExtentMax]);
  const [selection, setSelection] = useState<ChartBrushSelection | null>(null);
  const [prevExtent, setPrevExtent] = useState<[Date, Date] | null>(null);
  if (fullExtent !== prevExtent) {
    setPrevExtent(fullExtent);
    setSelection(null);
  }
  const onBrushSelectionChange = useCallback(
    (next: ChartBrushSelection | null): void => {
      const target = next ?? (fullExtent ? { end: fullExtent[1], start: fullExtent[0] } : null);
      if (target) {
        setSelection(target);
      }
    },
    [fullExtent],
  );
  return useMemo(
    () => ({
      brushSelection: selection,
      onBrushSelectionChange,
      xDomain: enabled ? (selection ? [selection.start, selection.end] : (fullExtent ?? undefined)) : undefined,
      xDomainSlotCount: enabled ? data.length : undefined,
    }),
    [selection, fullExtent, onBrushSelectionChange, enabled, data.length],
  );
};

const BrushLayoutContent = ({
  data,
  xDataKey = "date",
  xExtentMax,
  enabled,
  height,
  fitMainContent = false,
  className,
  children,
  brushStrip,
}: Readonly<ChartBrushLayoutProps>): ReactElement => {
  const layout = useBrushSelection(data, xDataKey, xExtentMax, enabled);
  const stripStyle = useMemo(() => ({ height }), [height]);
  return (
    <div className={cn("bk-brush", fitMainContent && "bk-brush-fit", className)}>
      <div className={fitMainContent ? "bk-brush-main bk-brush-main-fit" : "bk-brush-main"}>{children(layout)}</div>
      {enabled && brushStrip && (
        <div className="bk-brush-strip" style={stripStyle}>
          {brushStrip(layout)}
        </div>
      )}
    </div>
  );
};

/**
 * Lays out a main chart above a brush strip and holds the brushed range. Render the main chart in `children` with `layout.xDomain` and `layout.xDomainSlotCount`, and the brush strip in `brushStrip`.
 */
export const BrushLayout: NamedExoticComponent<ChartBrushLayoutProps> = /* @__PURE__ */ Object.assign(/* @__PURE__ */ memo(BrushLayoutContent), { displayName: "BrushLayout" });
