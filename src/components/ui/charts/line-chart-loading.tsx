"use client";

import { curveNatural } from "d3-shape";
import { useMemo } from "react";
import type { CSSProperties, ReactElement } from "react";
import { generateChartSkeletonData } from "./core/loading/generate-chart-skeleton-data";
import { Grid, Line } from "./kit/cartesian/carriers";
import { DEFAULT_LOADING_GRID_SHIMMER_STROKE, DEFAULT_LOADING_GRID_STROKE, DEFAULT_LOADING_STROKE, DEFAULT_LOADING_STROKE_OPACITY } from "./core/cartesian/loading";
import { LineChart } from "./line-chart";
import type { LineChartLoadingProps as CoreLineChartLoadingProps } from "./core/types/cartesian";

const LOADING_DATA_KEY = "value";

/** Props of `LineChartLoading`. */
interface LineChartLoadingProps extends CoreLineChartLoadingProps<CSSProperties> {}

/** Ready-made loading placeholder for a line chart: a skeleton line that pulses over a shimmering grid. Use it while data is fetching instead of building a `status="loading"` chart yourself. */
const LineChartLoading = ({
  margin,
  stroke = DEFAULT_LOADING_STROKE,
  strokeOpacity = DEFAULT_LOADING_STROKE_OPACITY,
  gridStroke = DEFAULT_LOADING_GRID_STROKE,
  gridShimmerStroke = DEFAULT_LOADING_GRID_SHIMMER_STROKE,
  gridShimmer = true,
  gridShimmerLength,
  gridShimmerSpeed,
  gridShimmerSync = false,
  loadingStyle = "pulse",
  label = "Loading",
  aspectRatio = "2 / 1",
  className = "",
  style,
}: Readonly<LineChartLoadingProps>): ReactElement => {
  const data = useMemo(() => generateChartSkeletonData({ dataKey: LOADING_DATA_KEY }), []);
  return (
    <LineChart animationDuration={0} aspectRatio={aspectRatio} className={className} data={data} loadingLabel={label} margin={margin} status="loading" style={style}>
      <Grid
        horizontal
        shimmer={loadingStyle === "sweep" ? false : gridShimmer}
        shimmerLength={gridShimmerLength}
        shimmerSpeed={gridShimmerSpeed}
        shimmerStroke={gridShimmerStroke}
        shimmerSync={gridShimmerSync}
        stroke={gridStroke}
      />
      <Line
        curve={curveNatural}
        dataKey={LOADING_DATA_KEY}
        fadeEdges={false}
        loadingStroke={stroke}
        loadingStrokeOpacity={strokeOpacity}
        loadingStyle={loadingStyle}
        showHighlight={false}
        stroke="transparent"
        strokeWidth={2.5}
      />
    </LineChart>
  );
};

export { LineChartLoading };
export type { LineChartLoadingProps };
