import { Children, Fragment, isValidElement } from "react";
import type { ReactNode } from "react";
import type { ChildTable } from "../core/carriers/table";
import { RadarArea } from "../core/radar/area";
import { RadarAxis } from "../core/radar/axis";
import { RadarGrid } from "../core/radar/grid";
import { RadarLabels } from "../core/radar/labels";
import { RADAR_ROLES } from "../core/radar/model";
import { DATA_TABLE_ROLE } from "../core/a11y/data-table";
import { ChartDataTable } from "../kit/data-table";

interface FragmentProps { readonly children?: ReactNode }

const ROLE_OF = /* @__PURE__ */ (() => new Map<unknown, string>([
  [RadarGrid, RADAR_ROLES.grid],
  [RadarAxis, RADAR_ROLES.axis],
  [RadarLabels, RADAR_ROLES.labels],
  [RadarArea, RADAR_ROLES.area],
  [ChartDataTable, DATA_TABLE_ROLE],
]))();

export const extract = (children: ReactNode): ChildTable => {
  const table = new Map<string, Readonly<Record<string, unknown>>[]>();
  const visit = (node: ReactNode): void => {
    for (const child of Children.toArray(node)) {
      if (isValidElement<FragmentProps>(child) && child.type === Fragment) {
        visit(child.props.children);
      } else if (isValidElement<Readonly<Record<string, unknown>>>(child)) {
        const role = ROLE_OF.get(child.type);
        if (role !== undefined) { table.set(role, [...(table.get(role) ?? []), child.props]); }
      }
    }
  };
  visit(children);
  return table;
};
