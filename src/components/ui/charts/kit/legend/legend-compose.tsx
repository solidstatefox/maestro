"use client";

// bklit composable legend (legend/*.tsx): <Legend items> maps ONE <LegendItem> child per item, with
// LegendMarker / LegendLabel / LegendValue / LegendProgress reading item context. Plain HTML by design.
import { Progress } from "@base-ui/react/progress";
import { createContext, isValidElement, useCallback, useContext, useMemo, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { cn } from "../../core/cn";
import { intFmt } from "../../core/format";
import { formatWholePercent, hasLegendMax } from "../../core/legend/items";
import type { LegendContextValue, LegendItemContextValue, LegendLabelProps, LegendMarkerProps, LegendProgressProps, LegendValueProps, LegendProps as CoreLegendProps, LegendItemProps as CoreLegendItemProps } from "../../core/types/legend";

export { legendCssVars } from "../../core/legend/items";

/** Props of `Legend`. */
export interface LegendProps extends CoreLegendProps<ReactElement> {}

/** Props of `LegendItemComponent`. */
export interface LegendItemProps extends CoreLegendItemProps<ReactNode> {}

const LegendContext = /* @__PURE__ */ createContext<LegendContextValue | null>(null);
const LegendItemContext = /* @__PURE__ */ createContext<LegendItemContextValue | null>(null);

/** Reads the legend state (items and hovered index). Throws outside a `Legend`. */
export const useLegend = (): LegendContextValue => {
  const context = useContext(LegendContext);
  if (!context) {
    throw new Error("useLegend must be used within a <Legend> component.");
  }
  return context;
};

/** Reads the state of the legend item being rendered. Throws outside a `Legend` item. */
export const useLegendItem = (): LegendItemContextValue => {
  const context = useContext(LegendItemContext);
  if (!context) {
    throw new Error("useLegendItem must be used within a <LegendItem> component.");
  }
  return context;
};

/**
 * A composable legend. Pass `items` and one child, a `LegendItemComponent`; the child is rendered once per item with its marker, label, value and progress bar.
 */
export const Legend = /* @__PURE__ */ Object.assign(function Legend({
  items,
  hoveredIndex: controlledHoveredIndex,
  onHoverChange,
  title,
  titleClassName = "bk-text-sm bk-font-semibold",
  className = "",
  children,
}: LegendProps): ReactElement {
  const [internalHoveredIndex, setInternalHoveredIndex] = useState<number | null>(null);
  const isControlled = controlledHoveredIndex !== undefined;
  const hoveredIndex = isControlled ? controlledHoveredIndex : internalHoveredIndex;
  const setHoveredIndex = useCallback(
    (index: number | null): void => {
      if (isControlled) {
        onHoverChange?.(index);
      } else {
        setInternalHoveredIndex(index);
      }
    },
    [isControlled, onHoverChange],
  );
  const contextValue = useMemo<LegendContextValue>(() => ({ items, hoveredIndex, setHoveredIndex }), [items, hoveredIndex, setHoveredIndex]);
  const itemContexts = useMemo<LegendItemContextValue[]>(
    () =>
      items.map((item, index) => ({
        item,
        index,
        isHovered: hoveredIndex === index,
        isFaded: hoveredIndex !== null && hoveredIndex !== index,
        percentage: hasLegendMax(item.maxValue) ? (item.value / item.maxValue) * 100 : 0,
      })),
    [items, hoveredIndex],
  );

  return (
    <LegendContext.Provider value={contextValue}>
      <div className={cn("legend-container bk-legend", className)} data-hovered-any={hoveredIndex === null ? undefined : ""}>
        {title !== undefined && title !== "" && <h3 className={cn("bk-legend-title", titleClassName)}>{title}</h3>}
        {items.map((item, index) =>
          isValidElement(children) ? (
            <LegendItemContext.Provider key={item.label} value={itemContexts[index]}>
              {children}
            </LegendItemContext.Provider>
          ) : null,
        )}
      </div>
    </LegendContext.Provider>
  );
}, { displayName: "Legend" });

/**
 * One legend row. It sets the hovered item when the pointer enters it and highlights itself while hovered. Use it as the single child of `Legend`.
 */
export const LegendItemComponent = /* @__PURE__ */ Object.assign(function LegendItemComponent({ className = "", children }: LegendItemProps): ReactElement {
  const { setHoveredIndex } = useLegend();
  const { index, isHovered } = useLegendItem();
  const onEnter = useCallback((): void => {
    setHoveredIndex(index);
  }, [setHoveredIndex, index]);
  const onLeave = useCallback((): void => {
    setHoveredIndex(null);
  }, [setHoveredIndex]);
  return (
    <div
      className={cn("bk-legend-item", isHovered && "bk-legend-item-hovered", className)}
      data-hovered={isHovered ? "" : undefined}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  );
}, { displayName: "LegendItem" });

/** A colored dot in the item's color. */
export const LegendMarker = /* @__PURE__ */ Object.assign(function LegendMarker({ className = "bk-marker-size" }: LegendMarkerProps): ReactElement {
  const { item } = useLegendItem();
  const style = useMemo<CSSProperties>(() => ({ backgroundColor: item.color }), [item.color]);
  return <div className={cn("bk-legend-marker", className)} style={style} />;
}, { displayName: "LegendMarker" });

/** The item's label text. */
export const LegendLabel = /* @__PURE__ */ Object.assign(function LegendLabel({ className = "bk-text-sm bk-font-medium" }: LegendLabelProps): ReactElement {
  const { item } = useLegendItem();
  return <span className={cn("bk-legend-fg", className)}>{item.label}</span>;
}, { displayName: "LegendLabel" });

/** The item's value, optionally followed by its percentage of `maxValue`. */
export const LegendValue = /* @__PURE__ */ Object.assign(function LegendValue({
  className = "bk-text-sm bk-tabular-nums",
  showPercentage = false,
  percentageClassName = "bk-text-xs bk-tabular-nums",
  formatValue = intFmt,
  formatPercentage = formatWholePercent,
}: LegendValueProps): ReactElement {
  const { item, percentage } = useLegendItem();
  return (
    <span className={cn("bk-legend-value", className)}>
      <span>{formatValue(item.value)}</span>
      {showPercentage && hasLegendMax(item.maxValue) && <span className={percentageClassName}>{formatPercentage(percentage)}</span>}
    </span>
  );
}, { displayName: "LegendValue" });

/** A progress bar filled to `value / maxValue` in the item's color. Renders nothing when the item has no `maxValue`. */
export const LegendProgress = /* @__PURE__ */ Object.assign(function LegendProgress({ trackClassName = "", indicatorClassName = "", height = "bk-h-1-5" }: LegendProgressProps): ReactElement | null {
  const { item } = useLegendItem();
  const indicatorStyle = useMemo<CSSProperties>(() => ({ backgroundColor: item.color }), [item.color]);
  if (!hasLegendMax(item.maxValue)) {
    return null;
  }
  return (
    <Progress.Root max={item.maxValue} value={item.value}>
      <Progress.Track className={cn("bk-legend-track", height, trackClassName)}>
        <Progress.Indicator className={cn("bk-legend-indicator", indicatorClassName)} style={indicatorStyle} />
      </Progress.Track>
    </Progress.Root>
  );
}, { displayName: "LegendProgress" });
