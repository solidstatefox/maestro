"use client";
// RadialCenter and RadialLegend in React: HTML views over the radial controller's stores (core/radial/context.ts). The centre sits over the
// chart's hole (its box from the controller's view), the legend below the chart; a hover re-renders only them.
import { useMemo } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { cn } from "../core/cn";
import { RADIAL_LEGEND_CLASS, radialCenterValue } from "../core/radial/context";
import { toCamel } from "../core/style";
import type { RadialCenterProps as CoreRadialCenterProps, RadialCenterState, RadialLegendProps } from "../core/types/radial";
import { ChartStatFlow, StatFlowRollContext, chartCenterLabelClassName, chartCenterValueClassName } from "../chart-stat-flow";
import { useRadialController, useReadable } from "./context";

/** Props of `RadialCenter`. */
interface RadialCenterProps extends Omit<CoreRadialCenterProps<ReactNode>, "children"> {
  /** Full control over the centre content (at rest and while hovering). */
  readonly children?: (state: RadialCenterState) => ReactNode;
}

/**
 * The centre of a `RadialChart`, drawn as HTML over the hole: the sum of every series' total at rest and the hovered bin's sum while
 * scrubbing. Pass a `children` render function for custom content; it gets the hovered bin, its datum and label, whether it is a future
 * bin, the totals and the bin's values.
 */
const RadialCenter = /* @__PURE__ */ Object.assign(function RadialCenter({
  defaultLabel = "Total", formatOptions, prefix, suffix, className, valueClassName = chartCenterValueClassName, labelClassName = chartCenterLabelClassName, children,
}: Readonly<RadialCenterProps>): ReactElement | null {
  const controller = useRadialController();
  const { centerStyle } = useReadable(controller.view);
  const state = useReadable(controller.center);
  const rolls = useReadable(controller.centerRolls);
  const style = useMemo((): CSSProperties | null => (centerStyle === null ? null : toCamel(centerStyle)), [centerStyle]);
  if (style === null) {
    return null;
  }
  return (
    <div className="bkm-rd-center" style={style}>
      <div className={cn("bk-center bkm-rd-center-box", className)}>
        <StatFlowRollContext.Provider value={rolls}>
          {children ? children(state) : (
            <ChartStatFlow formatOptions={formatOptions} label={state.label ?? defaultLabel} labelClassName={labelClassName} prefix={prefix} suffix={suffix} value={radialCenterValue(state)} valueClassName={valueClassName} />
          )}
        </StatFlowRollContext.Provider>
      </div>
    </div>
  );
}, { displayName: "RadialCenter" });

/**
 * The legend of a `RadialChart`, below it: a dot, the muted label and the series total (tinted for `emphasize` series) per series.
 * Hovering an item dims the other series in every layer.
 */
const RadialLegend = /* @__PURE__ */ Object.assign(function RadialLegend({ className, formatValue, showValues = true }: Readonly<RadialLegendProps>): ReactElement {
  const controller = useRadialController();
  const store = useMemo(() => controller.legend(() => ({ formatValue, showValues })), [controller, formatValue, showValues]);
  const { items, hoveredSeries } = useReadable(store);
  return (
    <div className={cn(RADIAL_LEGEND_CLASS, className)} data-hovered-any={hoveredSeries === null ? undefined : ""}>
      {items.map((item, index) => (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a hover highlight, as bklit-ui's legend item
        <div
          className={cn("bk-legend-item bkm-rd-legend-item", hoveredSeries === index && "bk-legend-item-hovered")}
          data-hovered={hoveredSeries === index ? "" : undefined}
          key={`${item.label}-${index}`}
          onMouseEnter={() => { controller.setHoveredSeries(index); }}
          onMouseLeave={() => { controller.setHoveredSeries(null); }}
        >
          <div className="bk-legend-marker bkm-rd-legend-marker" style={{ backgroundColor: item.color }} />
          <span className="bkm-rd-legend-label">{item.label}</span>
          {showValues ? <span className="bkm-rd-legend-value" style={item.emphasize ? { color: item.textColor } : undefined}>{item.text}</span> : null}
        </div>
      ))}
    </div>
  );
}, { displayName: "RadialLegend" });

export { RadialCenter, RadialLegend };
export type { RadialCenterProps };
