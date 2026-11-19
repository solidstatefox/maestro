"use client";

import { curveNatural } from "d3-shape";
import { useMemo } from "react";
import type { ReactElement } from "react";
import { AreaChart } from "./area-chart";
import { generateChartSkeletonData } from "./core/loading/generate-chart-skeleton-data";
import { Area, Grid } from "./kit/cartesian/carriers";
import { DEFAULT_LOADING_GRID_SHIMMER_STROKE, DEFAULT_LOADING_GRID_STROKE, DEFAULT_LOADING_STROKE, DEFAULT_LOADING_STROKE_OPACITY } from "./core/cartesian/loading";
import type { AreaChartLoadingProps } from "./core/types/cartesian";

const LOADING_DATA_KEY = "value";

/** Ready-made loading placeholder for a area chart: a skeleton area that pulses over a shimmering grid. Use it while data is fetching instead of building a `status="loading"` chart yourself. */
const AreaChartLoading = ({
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
}: Readonly<AreaChartLoadingProps>): ReactElement => {
  const data = useMemo(() => generateChartSkeletonData({ dataKey: LOADING_DATA_KEY }), []);
  return (
    <AreaChart animationDuration={0} aspectRatio={aspectRatio} className={className} data={data} loadingLabel={label} margin={margin} status="loading">
      <Grid
        horizontal
        shimmer={loadingStyle === "sweep" ? false : gridShimmer}
        shimmerLength={gridShimmerLength}
        shimmerSpeed={gridShimmerSpeed}
        shimmerStroke={gridShimmerStroke}
        shimmerSync={gridShimmerSync}
        stroke={gridStroke}
      />
      <Area
        curve={curveNatural}
        dataKey={LOADING_DATA_KEY}
        fadeEdges={false}
        fill="transparent"
        fillOpacity={0}
        loading
        loadingStroke={stroke}
        loadingStrokeOpacity={strokeOpacity}
        loadingStyle={loadingStyle}
        showHighlight={false}
        showLine
        stroke="transparent"
        strokeWidth={2}
      />
    </AreaChart>
  );
};

export { AreaChartLoading };
