import { useCallback, useMemo } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ChartTooltipBodyRenderContext } from "@tanstack/charts/react/tooltip";
import { TooltipBox, TooltipContent } from "../kit/tooltip/tooltip-primitives";
import { featureTitle, featureValueRows, markerRows, tooltipFeatureOf, tooltipMarkerOf } from "../core/choropleth/tooltip-body";
import type { TooltipCardConfig } from "../core/choropleth/tooltip-body";
import { erase } from "../core/erased-types";
import type { ChoroplethFeature } from "../core/types/choropleth";

const TooltipCard = ({ cfg, feature, index }: { readonly cfg: TooltipCardConfig<ReactNode, CSSProperties>; readonly feature: ChoroplethFeature; readonly index: number }): ReactElement => {
  const { props } = cfg;
  const { backgroundColor, className, content, getFeatureValue, panelStyle } = props;
  const name = featureTitle(props, feature, index);
  const value = getFeatureValue?.(feature, index);
  const { formatValue, valueLabel } = cfg;
  const rows = useMemo(() => featureValueRows(value, valueLabel, formatValue), [value, valueLabel, formatValue]);
  if (content) {
    return <TooltipBox backgroundColor={backgroundColor} className={className} panelStyle={panelStyle}>{content({ feature, index })}</TooltipBox>;
  }
  return (
    <TooltipBox backgroundColor={backgroundColor} className={className} panelStyle={panelStyle}>
      <TooltipContent rows={rows} title={name} />
    </TooltipBox>
  );
};

/** Tooltip body (bklit panel markup inside the native tooltip shell) for the `ChoroplethTooltip` the controller read (its view's `tooltip`; its
 * content: core/choropleth/tooltip-body.ts). */
export const useTooltipBody = (cardConfig: TooltipCardConfig<ReactNode, CSSProperties> | undefined): ((ctx: ChartTooltipBodyRenderContext) => ReactNode) =>
  useCallback((ctx: ChartTooltipBodyRenderContext): ReactNode => {
    // A marker's point names the marker (bklit's marker tooltip); any other is a feature's.
    const marker = tooltipMarkerOf(erase(ctx.points));
    if (cardConfig && marker !== undefined) {
      const { backgroundColor, className, panelStyle } = cardConfig.props;
      return <TooltipBox backgroundColor={backgroundColor} className={className} panelStyle={panelStyle}><TooltipContent rows={markerRows(marker)} title={marker.label} /></TooltipBox>;
    }
    const shown = tooltipFeatureOf(erase(ctx.points));
    if (!cardConfig || shown === undefined) {return ctx.defaultBody;}
    return <TooltipCard cfg={cardConfig} feature={shown.feature} index={shown.index} />;
  }, [cardConfig]);
