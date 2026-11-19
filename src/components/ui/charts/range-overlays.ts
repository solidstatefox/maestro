"use client";
// bklit-ui's cartesian range overlays on React: Band, Deadline, Weekends and ChartCrosshair are config carriers (they render nothing; the
// chart compiles them into its definition and its hover, core/cartesian/range-overlays.ts and crosshair.ts), and the children helpers
// bklit's chart shells read them with (`extractBandConfigs`, `extractProjectionLineConfigs`).
import { Children, Fragment, isValidElement } from "react";
import type { ReactNode } from "react";
import { CHART_ROLE } from "./core/carriers/roles";
import { CHART_CLIP_PASSTHROUGH } from "./core/carriers/passthrough";
import { bandConfigsOf } from "./core/cartesian/band-config";
import { enableCrosshair } from "./core/cartesian/enable-crosshair";
import { enableRanges } from "./core/cartesian/enable-ranges";
import { projectionLineConfigsOf } from "./core/cartesian/projection-config";
import type { ProjectionLike } from "./core/cartesian/projection-config";
import type { BandConfig, BandProps, ChartCrosshairProps, DeadlineProps, WeekendsProps } from "./core/types/range-overlays";
import type { ProjectionLineConfig } from "./core/types/cartesian";
import { defineCarrier } from "./kit/role";

/**
 * The shaded range between two data keys of every row (a min / max range, a forecast interval, Bollinger bands). It reveals and morphs with
 * the lines, widens the y domain, and adds a `low – high` row and edge dots to `ChartTooltip`. It renders nothing itself; place it as a child
 * of `LineChart`, `AreaChart` or `ComposedChart`, before the `Line`s it sits under.
 */
export const Band = /* @__PURE__ */ defineCarrier<Readonly<BandProps>>("band", "Band", undefined, enableRanges);

/**
 * A due-date marker: a vertical line at `date` and a region to its right (to `endDate` or the plot's edge) that fades out, striped, gradient
 * or solid. It renders nothing itself; place it as a child of a time-series chart (it paints beneath the series).
 */
export const Deadline = /* @__PURE__ */ defineCarrier<Readonly<DeadlineProps>>("deadline", "Deadline", undefined, enableRanges);

/**
 * Shades the weekend spans of a date x axis behind the series, striped or solid; only the spans in view are drawn, so a zoomed window stays
 * cheap. It renders nothing itself; place it as a child of a time-series chart.
 */
export const Weekends = /* @__PURE__ */ defineCarrier<Readonly<WeekendsProps>>("weekends", "Weekends", undefined, enableRanges);

/**
 * A finance-style crosshair: a horizontal line at the pointer's y with the axis value in a pill (the `YAxis` on that axis fades the ticks the
 * pill covers), and a vertical line on the hovered column. Pair it with `<ChartTooltip showCrosshair={false} />`. It renders nothing itself;
 * place it as a child of a time-series chart.
 */
export const ChartCrosshair = /* @__PURE__ */ defineCarrier<Readonly<ChartCrosshairProps>>("chartCrosshair", "ChartCrosshair", undefined, enableCrosshair);

type ElementProps = Record<string, unknown> & { readonly children?: ReactNode };

/** The props of every element of `role` among `children`, fragments, `CHART_CLIP_PASSTHROUGH` wrappers and nested children walked (bklit's visit). */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the role's prop shape
function carrierProps<Props>(children: ReactNode, role: string): Props[] {
  const out: Props[] = [];
  const visit = (nodes: ReactNode): void => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement<ElementProps>(child)) {
        return;
      }
      const { type } = child;
      // SAFETY: the role and the passthrough flag are plain own-property markers on a component.
      const marks = (typeof type === "function" || (typeof type === "object" && type !== null) ? type : {}) as { readonly [CHART_ROLE]?: unknown; readonly [CHART_CLIP_PASSTHROUGH]?: unknown };
      if (type !== Fragment && marks[CHART_ROLE] === role) {
        // SAFETY: carriers of one role share one prop shape (core/carriers/table.ts `propsFor`).
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
        out.push(child.props as Props);
        return;
      }
      if (child.props.children !== undefined) {
        visit(child.props.children);
      }
    });
  };
  visit(children);
  return out;
}

/** The `Band` children of a chart, as the chart reads them (the keys that widen the y domain, the tooltip's label and color). */
export const extractBandConfigs = (children: ReactNode): BandConfig[] => bandConfigsOf(carrierProps<Partial<BandProps>>(children, "band"));

/** The `ProjectionLine` children of a chart with two or more points, as the chart reads them (they widen the x and y domains). */
export const extractProjectionLineConfigs = (children: ReactNode): ProjectionLineConfig[] => projectionLineConfigsOf(carrierProps<ProjectionLike>(children, "projectionLine"));

export { CHART_CLIP_PASSTHROUGH };
