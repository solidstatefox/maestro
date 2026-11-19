import { useCallback } from "react";
import type { CSSProperties, ReactElement } from "react";
import { cn } from "../../core/cn";
import { ProgressItem } from "./chart-legend-progress-item";
import { SimpleItem } from "./chart-legend-simple-item";
import type { ChartLegendProps } from "./chart-legend";
import type { LegendItem } from "../../core/types/legend";

// A missing or zero maximum means the item has no progress scale to draw.
const EMPTY_PROGRESS_MAXIMUM = 0;

// Button reset (inline): only the UA chrome the div never had; padding/cursor/background come from classes (an inline background would defeat the hovered bk-legend-item-hovered).
const LEGEND_BUTTON_RESET: CSSProperties = {
  border: "none",
  color: "inherit",
  font: "inherit",
  margin: 0,
  textAlign: "left",
};

interface DefaultLegendRowProps {
  readonly displayPercentage: boolean;
  readonly formatValue: (value: number) => string;
  readonly index: number;
  readonly isFaded: boolean;
  readonly isHovered: boolean;
  readonly item: LegendItem;
  readonly itemClassName: string;
  readonly labelClassName: string;
  readonly onHover: ChartLegendProps["onHover"];
  readonly showMarker: boolean;
  readonly showProgress: boolean;
  readonly showValue: boolean;
  readonly valueClassName: string;
}

interface DefaultLegendBodyOptions {
  readonly displayPercentage: boolean;
  readonly formatValue: (value: number) => string;
  readonly item: LegendItem;
  readonly labelClassName: string;
  readonly showMarker: boolean;
  readonly showProgress: boolean;
  readonly showValue: boolean;
  readonly valueClassName: string;
}

const renderDefaultLegendBody = (options: Readonly<DefaultLegendBodyOptions>): ReactElement => {
  const { displayPercentage, formatValue, item, labelClassName, showMarker, showProgress, showValue, valueClassName } = options;
  if (showProgress && (item.maxValue ?? EMPTY_PROGRESS_MAXIMUM) !== EMPTY_PROGRESS_MAXIMUM) {
    return (
      <ProgressItem
        formatValue={formatValue}
        item={item}
        labelClassName={labelClassName}
        showMarker={showMarker}
        showPercentage={displayPercentage}
        showValue={showValue}
        valueClassName={valueClassName}
      />
    );
  }
  return (
    <SimpleItem
      formatValue={formatValue}
      item={item}
      labelClassName={labelClassName}
      showMarker={showMarker}
      showValue={showValue}
      valueClassName={valueClassName}
    />
  );
};

const DefaultLegendRow = ({
  displayPercentage,
  formatValue,
  index,
  isFaded,
  isHovered,
  item,
  itemClassName,
  labelClassName,
  onHover,
  showMarker,
  showProgress,
  showValue,
  valueClassName,
}: Readonly<DefaultLegendRowProps>): ReactElement => {
  const handleMouseEnter = useCallback((): void => {
    onHover?.(index);
  }, [index, onHover]);
  const handleMouseLeave = useCallback((): void => {
    onHover?.(null);
  }, [onHover]);
  const handleFocus = useCallback((): void => {
    onHover?.(index);
  }, [index, onHover]);
  const handleBlur = useCallback((): void => {
    onHover?.(null);
  }, [onHover]);
  return (
    <button
      className={cn(
        "bk-legend-item",
        isHovered && "bk-legend-item-hovered",
        isFaded && "bk-faded",
        itemClassName
      )}
      data-hovered={isHovered ? "" : undefined}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={LEGEND_BUTTON_RESET}
      type="button"
    >
      {renderDefaultLegendBody({
        displayPercentage,
        formatValue,
        item,
        labelClassName,
        showMarker,
        showProgress,
        showValue,
        valueClassName,
      })}
    </button>
  );
};

export { DefaultLegendRow };
;
