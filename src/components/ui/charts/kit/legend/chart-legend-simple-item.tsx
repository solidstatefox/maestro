"use client";

import type { CSSProperties, ReactElement } from "react";
import { useMemo } from "react";
import { cn } from "../../core/cn";
import type { LegendItem } from "../../core/types/legend";

// Simple legend row split out so chart-legend holds only the ChartLegend component.
interface SimpleItemProps {
  readonly item: LegendItem;
  readonly showMarker: boolean;
  readonly showValue: boolean;
  readonly formatValue: (value: number) => string;
  readonly labelClassName: string;
  readonly valueClassName: string;
}

const SimpleItem = ({
  item,
  showMarker,
  showValue,
  formatValue,
  labelClassName,
  valueClassName,
}: Readonly<SimpleItemProps>): ReactElement => {
  const markerStyle = useMemo((): CSSProperties => ({ backgroundColor: item.color }), [item.color]);
  return (
    <div className="bk-legend-row" data-slot="legend-item">
      {showMarker && (
        <div
          className="bk-marker-size bk-legend-marker"
          style={markerStyle}
        />
      )}

      <span className={cn("bk-legend-grow bk-legend-fg", labelClassName)}>
        {item.label}
      </span>

      {showValue && (
        <span className={cn("bk-legend-muted-fg", valueClassName)}>
          {formatValue(item.value)}
        </span>
      )}
    </div>
  );
};

export { SimpleItem };
;
