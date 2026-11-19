import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import type { ProjectionLineConfig, ProjectionPoint } from "../types/cartesian";
import { axisId } from "./series";

/** The ProjectionLine props a config is read from. */
export interface ProjectionLike {
  readonly data?: readonly ProjectionPoint[];
  readonly yAxisId?: string | number;
}

const isTable = (source: ChildTable | Iterable<ProjectionLike>): source is ChildTable => source instanceof Map;

/** The configs of the ProjectionLines with at least two points, their dates as `Date`s. */
export function projectionLineConfigsOf(source: ChildTable | Iterable<ProjectionLike>): ProjectionLineConfig[] {
  const list: Iterable<ProjectionLike> = isTable(source) ? propsFor<ProjectionLike>(source, "projectionLine") : source;
  const out: ProjectionLineConfig[] = [];
  for (const props of list) {
    const data = (props.data ?? []).map((point) => ({ date: point.date instanceof Date ? point.date : new Date(point.date), value: point.value }));
    if (data.length >= 2) {
      out.push({ yAxisId: axisId(props.yAxisId), data });
    }
  }
  return out;
}
