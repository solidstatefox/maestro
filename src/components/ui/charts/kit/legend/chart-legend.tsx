"use client";

import type { ReactElement, ReactNode } from "react";
import { cn } from "../../core/cn";
import { intFmt } from "../../core/format";
import { LEGEND_PERCENT_SCALE } from "./chart-legend-progress-item";
import { CustomLegendRow } from "./chart-legend-custom-row";
import { DefaultLegendRow } from "./chart-legend-default-row";
import type { LegendItem, ChartLegendProps as CoreChartLegendProps } from "../../core/types/legend";

/** Props of `ChartLegend`. */
interface ChartLegendProps extends CoreChartLegendProps<ReactNode> {}

interface LegendRowOptions {
  readonly displayPercentage: boolean;
  readonly formatValue: (value: number) => string;
  readonly hoveredIndex: number | null;
  readonly index: number;
  readonly item: LegendItem;
  readonly itemClassName: string;
  readonly labelClassName: string;
  readonly onHover: ChartLegendProps["onHover"];
  readonly renderItem: ChartLegendProps["renderItem"];
  readonly showMarker: boolean;
  readonly showProgress: boolean;
  readonly showValue: boolean;
  readonly valueClassName: string;
}

const renderChartLegendRow = (options: Readonly<LegendRowOptions>): ReactElement => {
  const { item, index, hoveredIndex, renderItem, onHover: handleHover } = options;
  const maxValue = item.maxValue ?? 0;
  const percentage = maxValue === 0
    ? 0
    : (item.value / maxValue) * LEGEND_PERCENT_SCALE;
  const isHovered = hoveredIndex === index;
  const isFaded = hoveredIndex !== null && hoveredIndex !== index;
  if (renderItem) {
    return (
      <CustomLegendRow
        index={index}
        isFaded={isFaded}
        isHovered={isHovered}
        item={item}
        key={`legend-${item.label}-${item.value}`}
        onHover={handleHover}
        percentage={percentage}
        renderItem={renderItem}
      />
    );
  }
  return (
    <DefaultLegendRow
      displayPercentage={options.displayPercentage}
      formatValue={options.formatValue}
      index={index}
      isFaded={isFaded}
      isHovered={isHovered}
      item={item}
      itemClassName={options.itemClassName}
      key={`legend-${item.label}-${item.value}`}
      labelClassName={options.labelClassName}
      onHover={handleHover}
      showMarker={options.showMarker}
      showProgress={options.showProgress}
      showValue={options.showValue}
      valueClassName={options.valueClassName}
    />
  );
};

/**
 * A ready-made legend list with a marker, label, value and optional progress bar per item, driven by props. Use `Legend` instead when you need to compose the rows yourself.
 */
const ChartLegend = /* @__PURE__ */ Object.assign(function ChartLegend({
  items,
  hoveredIndex = null,
  onHover,
  showProgress = false,
  showMarker = true,
  showValue = true,
  showPercentage,
  formatValue = intFmt,
  title,
  className = "",
  titleClassName = "bk-text-sm bk-font-semibold",
  itemClassName = "",
  labelClassName = "bk-text-sm bk-font-medium",
  valueClassName = "bk-text-sm bk-tabular-nums",
  renderItem,
}: Readonly<ChartLegendProps>): ReactElement {
  const displayPercentage = showPercentage ?? showProgress;

  return (
    <div className={cn("legend-container bk-legend", className)} data-hovered-any={hoveredIndex === null ? undefined : ""} data-slot="legend">
      {(title ?? "").length > 0 && (
        <h3 className={cn("bk-legend-title", titleClassName)}>
          {title}
        </h3>
      )}
      {items.map((item, i) => renderChartLegendRow({
        displayPercentage,
        formatValue,
        hoveredIndex,
        index: i,
        item,
        itemClassName,
        labelClassName,
        onHover,
        renderItem,
        showMarker,
        showProgress,
        showValue,
        valueClassName,
      }))}
    </div>
  );
}, { displayName: "ChartLegend" })

export { ChartLegend };
export type { ChartLegendProps };
