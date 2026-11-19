"use client";

import { Progress } from "@base-ui/react/progress";
import type { CSSProperties, ReactElement } from "react";
import { cn } from "../../core/cn";
import type { LegendItem } from "../../core/types/legend";

const LEGEND_PERCENT_SCALE = 100;
const LEGEND_EMPTY_VALUE = 0;
const LEGEND_PERCENT_FRACTION_DIGITS = 0;

// Builds the color style for a legend swatch; hoisted so the row stays short.
const buildItemColorStyle = (color: string): CSSProperties => ({
  backgroundColor: color,
});

interface ProgressItemProps {
  readonly item: LegendItem;
  readonly showMarker: boolean;
  readonly showValue: boolean;
  readonly showPercentage: boolean;
  readonly formatValue: (value: number) => string;
  readonly labelClassName: string;
  readonly valueClassName: string;
}

const ProgressItem = ({
  item,
  showMarker,
  showValue,
  showPercentage,
  formatValue,
  labelClassName,
  valueClassName,
}: Readonly<ProgressItemProps>): ReactElement => {
  const maxValue = item.maxValue ?? LEGEND_EMPTY_VALUE;
  const percentage = maxValue === LEGEND_EMPTY_VALUE ? LEGEND_EMPTY_VALUE : (item.value / maxValue) * LEGEND_PERCENT_SCALE;

  return (
    <Progress.Root
      className="bk-legend-progress"
      data-slot="legend-item"
      max={item.maxValue}
      value={item.value}
    >
      {showMarker && (
        <div
          className="bk-marker-size bk-legend-marker"
          style={buildItemColorStyle(item.color)}
        />
      )}

      <Progress.Label className={cn("bk-legend-fg", labelClassName)}>
        {item.label}
      </Progress.Label>

      {showValue && (
        <span className={cn("bk-legend-muted-fg", valueClassName)}>
          {formatValue(item.value)}
        </span>
      )}

      <Progress.Track className="bk-legend-progress-track">
        <Progress.Indicator
          className="bk-legend-indicator"
          style={buildItemColorStyle(item.color)}
        />
      </Progress.Track>

      {showPercentage && (
        <span className="bk-legend-progress-percent">
          {`${percentage.toFixed(LEGEND_PERCENT_FRACTION_DIGITS)}%`}
        </span>
      )}
    </Progress.Root>
  );
}

export { ProgressItem, LEGEND_PERCENT_SCALE };
;
