"use client";
// bklit AreaChart on native TanStack Charts (shares the cartesian kit with LineChart).
import { useEffect } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { CartesianChart } from "./kit/cartesian/cartesian-chart";
import type { AreaChartProps as CoreAreaChartProps } from "./core/types/cartesian";

/** Props of {@link AreaChart}. */
interface AreaChartProps extends CoreAreaChartProps<ReactNode, CSSProperties> {}

/**
 * Time-series area chart. Compose it from children: `Grid`, one or more `Area` (or `PatternArea`), `XAxis`, `YAxis`, `ChartTooltip` and the other layers.
 * It draws the filled areas with an entrance reveal and reports hover and keyboard focus through the tooltip.
 */
const AreaChart = ({
  status = "ready",
  onPhaseChange,
  loadingLabel,
  margin,
  aspectRatio,
  className,
  ariaLabel = "Area chart",
  revealSignature = "",
  ...rest
}: Readonly<AreaChartProps>): ReactElement => {
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
      defaultAriaLabel={status === "loading" ? "Loading chart" : "Area chart"}
    />
  );
};

export { AreaChart };
export type { AreaChartProps };
