import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type {
  ChoroplethChartProps as CoreChoroplethChartProps,
  ChoroplethContextValue as CoreChoroplethContextValue,
  ChoroplethFeatureProps as CoreChoroplethFeatureProps,
  ChoroplethTooltipData,
  ChoroplethTooltipProps as CoreChoroplethTooltipProps,
} from "../core/types/choropleth";

/** Props of `ChoroplethChart`. */
interface ChoroplethChartProps extends CoreChoroplethChartProps<ReactNode> {}

/** Props of `ChoroplethFeatureComponent`. */
interface ChoroplethFeatureProps extends CoreChoroplethFeatureProps<ReactNode> {}

/** Props of `ChoroplethTooltip`. */
interface ChoroplethTooltipProps extends CoreChoroplethTooltipProps<ReactNode, CSSProperties> {}

/** Value returned by `useChoropleth()`. */
interface ChoroplethContextValue extends CoreChoroplethContextValue<RefObject<HTMLDivElement | null>, Dispatch<SetStateAction<ChoroplethTooltipData | null>>> {}

export type { ChoroplethChartProps, ChoroplethContextValue, ChoroplethFeatureProps, ChoroplethTooltipProps };
