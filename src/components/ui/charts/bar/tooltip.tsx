import type { ReactNode } from "react";
import { TooltipContent } from "../kit/tooltip/tooltip-primitives";
import { tooltipRows } from "../kit/tooltip/tooltip-body";
import type { TooltipBodyOptions } from "../kit/tooltip/tooltip-body";
import type { AnyPoint } from "../core/erased-types";
import { barTooltipPoints } from "../core/bar/tooltip";

export interface BarTooltipOptions extends TooltipBodyOptions {
  /** Horizontal bars carry the value on x and the category on y. */
  readonly horizontal?: boolean;
}

export const BarTooltipBody = ({ points, options }: { readonly points: readonly AnyPoint[]; readonly options: BarTooltipOptions }): ReactNode => {
  if (points.length === 0) {
    return null;
  }
  const oriented = barTooltipPoints(points, options.horizontal === true);
  const [primary] = oriented;
  const sorted = tooltipRows(oriented, options.format, options.colors, options.labels, options.order);
  const rows = options.rows === undefined ? sorted : options.rows(sorted, primary);
  if (options.content !== undefined) {
    return options.content({ point: primary, rows });
  }
  return (
    <TooltipContent className={options.className} rows={rows} title={String(primary.xValue)}>
      {options.footer}
    </TooltipContent>
  );
};
