"use client";
// bklit LineChart on native TanStack Charts: children are config carriers,
// compiled by the shared cartesian kit into one defineChart definition.
import { useEffect } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { CartesianChart } from "./kit/cartesian/cartesian-chart";
import type { LineChartProps as CoreLineChartProps } from "./core/types/cartesian";

/** Props of {@link LineChart}. */
export interface LineChartProps extends CoreLineChartProps<ReactNode, CSSProperties> {}

/**
 * Time-series line chart. Compose it from children: `Grid`, one or more `Line`, `XAxis`, `YAxis`, `ChartTooltip` and the other layers.
 * It draws the lines with an entrance reveal and reports hover and keyboard focus through the tooltip.
 */
export const LineChart = ({
  status = "ready",
  onPhaseChange,
  loadingLabel,
  margin,
  aspectRatio,
  className,
  ariaLabel,
  revealSignature = "",
  ...rest
}: Readonly<LineChartProps>): ReactElement => {
  useEffect(() => {
    onPhaseChange?.(status === "loading" ? "loading" : "ready");
  }, [status, onPhaseChange]);
  return (
    <CartesianChart
      key={revealSignature}
      {...rest}
      status={status}
      loadingLabel={loadingLabel}
      margin={margin}
      aspectRatio={aspectRatio}
      className={className}
      ariaLabel={status === "loading" ? "Loading chart" : ariaLabel}
      defaultAriaLabel={status === "loading" ? "Loading chart" : "Line chart"}
    />
  );
};
