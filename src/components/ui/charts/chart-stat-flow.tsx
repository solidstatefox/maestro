"use client";

// bklit ChartStatFlow: NumberFlow value + label stack. NumberFlow is an HTML overlay in bklit too.
import NumberFlow from "@number-flow/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./core/cn";
import type { ChartStatFlowFormat, ChartStatFlowProps as CoreChartStatFlowProps } from "./core/types/stat-flow";

/** Props of `ChartStatFlow`. */
export interface ChartStatFlowProps extends CoreChartStatFlowProps<ReactNode> {}

/** The default `formatOptions` of `ChartStatFlow`: standard notation, no decimals. */
export const defaultChartStatFlowFormat: ChartStatFlowFormat = {
  notation: "standard",
  maximumFractionDigits: 0,
};

// Fluid typography for pie / ring / gauge center labels (container query units).
/** @internal */
export const chartCenterContainerClassName = "bk-center";
/** @internal */
export const chartCenterValueClassName = "bk-center-value";
/** @internal */
export const chartCenterLabelClassName = "bk-center-label";

/** Whether a ChartStatFlow's number rolls to a new value (default true). A centre that follows a sweeping hover (RadialCenter) turns it off
 * while the hover sweeps, so each value shows at once instead of starting a roll per bin. @internal */
export const StatFlowRollContext = /* @__PURE__ */ createContext(true);

function formatStatValue(value: number, formatOptions: ChartStatFlowFormat, prefix?: string, suffix?: string): string {
  const formatted = new Intl.NumberFormat(undefined, formatOptions).format(value);
  return `${prefix ?? ""}${formatted}${suffix ?? ""}`;
}

function useNumberFlowElementReady(): boolean {
  const [ready, setReady] = useState(() => typeof customElements !== "undefined" && Boolean(customElements.get("number-flow-react")));
  useEffect(() => {
    let cancelled = false;
    const waitForElement = async (): Promise<void> => {
      await customElements.whenDefined("number-flow-react");
      if (!cancelled) {
        setReady(true);
      }
    };
    if (!ready) {
      void waitForElement();
    }
    return (): void => {
      cancelled = true;
    };
  }, [ready]);
  return ready;
}

/**
 * A big number with a label below it, for the center of a pie, ring or gauge chart. The number animates between values once its web component has loaded and is plain text before that.
 */
export const ChartStatFlow = /* @__PURE__ */ Object.assign(function ChartStatFlow({
  value,
  label,
  formatOptions = defaultChartStatFlowFormat,
  prefix,
  suffix,
  valueClassName = "bk-text-2xl bk-font-bold",
  labelClassName = "bk-text-xs",
  icon,
}: ChartStatFlowProps): ReactElement {
  const numberFlowReady = useNumberFlowElementReady();
  const rolls = useContext(StatFlowRollContext);
  const staticValue = useMemo(() => formatStatValue(value, formatOptions, prefix, suffix), [value, formatOptions, prefix, suffix]);
  return (
    <>
      {icon ? <div className="bk-stat-icon">{icon}</div> : null}
      <span className={cn("bk-stat-value", valueClassName)}>
        {numberFlowReady ? <NumberFlow animated={rolls} format={formatOptions} isolate prefix={prefix} suffix={suffix} value={value} willChange /> : staticValue}
      </span>
      <span className={cn("bk-stat-label", labelClassName)}>{label}</span>
    </>
  );
}, { displayName: "ChartStatFlow" });
