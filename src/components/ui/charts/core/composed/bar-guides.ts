import { pillLayout } from "../cartesian/date-pill";
import type { CartesianBuild } from "../cartesian/definition";
import type { HoverOverlayModel } from "../cartesian/hover-overlay";
import { shortDateFmt } from "../format";
import { resolveIndicatorWidth } from "../tooltip/tooltip-carriers";
import { dateValue } from "./narrow";

interface GuideInput {
  readonly built: Pick<CartesianBuild, "overlay" | "tooltipProps" | "pillTicks">;
  readonly hasBars: boolean;
  readonly rows: readonly Record<string, unknown>[];
  readonly xKey: string;
}

const withGuides = /* @__PURE__ */ new WeakMap<HoverOverlayModel, HoverOverlayModel>();

/** bklit's composed tooltip draws its crosshair and date pill from the chart's rows, bars included (the chart context lists the bars as lines). The cartesian
 * overlay only draws them over a Line or Area (hover-guides.ts), so a bars-only chart showed neither while the tick under the hovered day still faded for the
 * pill. Adds them here, by the same ChartTooltip props; a chart with a Line or Area already has them, or turned both off. */
export function withBarGuides({ built, hasBars, rows, xKey }: GuideInput): HoverOverlayModel | null {
  const model = built.overlay;
  if (model === null || !hasBars || model.crosshair !== null || model.pill !== null) {
    return model;
  }
  const cached = withGuides.get(model);
  if (cached) {
    return cached;
  }
  const tip = built.tooltipProps;
  const labels = rows.map((row) => shortDateFmt.format(dateValue(row[xKey])));
  const out: HoverOverlayModel = {
    ...model,
    crosshair: tip.showCrosshair === false
      ? null
      : { color: typeof tip.indicatorColor === "string" ? tip.indicatorColor : "var(--chart-crosshair)", dash: tip.indicatorDasharray, width: resolveIndicatorWidth(tip.indicatorWidth) },
    pill: built.pillTicks.active ? { labels, layout: pillLayout(labels) } : null,
  };
  withGuides.set(model, out);
  return out;
}
