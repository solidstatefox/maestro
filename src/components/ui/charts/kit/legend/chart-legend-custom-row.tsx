import { useCallback } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { ChartLegendProps } from "./chart-legend";
import type { LegendItem } from "../../core/types/legend";

interface CustomLegendRowProps {
  readonly index: number;
  readonly isFaded: boolean;
  readonly isHovered: boolean;
  readonly item: LegendItem;
  readonly onHover: ChartLegendProps["onHover"];
  readonly percentage: number;
  readonly renderItem: NonNullable<ChartLegendProps["renderItem"]>;
}

// Button reset (inline): full UA-chrome neutralization; the bare div had no padding/margin/color/cursor.
const LEGEND_BUTTON_RESET: CSSProperties = {
  border: "none",
  color: "inherit",
  cursor: "inherit",
  font: "inherit",
  margin: 0,
  padding: 0,
  textAlign: "left",
};

const CustomLegendRow = ({
  index,
  isFaded,
  isHovered,
  item,
  onHover,
  percentage,
  renderItem,
}: Readonly<CustomLegendRowProps>): ReactElement => {
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
      data-hovered={isHovered ? "" : undefined}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={LEGEND_BUTTON_RESET}
      type="button"
    >
      {renderItem({ index, isFaded, isHovered, item, percentage })}
    </button>
  );
};

export { CustomLegendRow };
;
