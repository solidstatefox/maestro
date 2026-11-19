import { isValidElement } from "react";
import type { ReactNode } from "react";
import type { ChildTable } from "../core/carriers/table";
import { SANKEY_ROLES } from "../core/sankey/controller";
import { displayNameOf } from "../kit/read-children";
import { DATA_TABLE_ROLE } from "../core/a11y/data-table";

/** The config carriers a SankeyChart reads from its direct children, by displayName, under their table roles. */
const ROLE_OF: ReadonlyMap<string, string> = /* @__PURE__ */ ((): ReadonlyMap<string, string> =>
  new Map([["SankeyLink", SANKEY_ROLES.link], ["SankeyNode", SANKEY_ROLES.node], ["SankeyTooltip", SANKEY_ROLES.tooltip], ["ChartDataTable", DATA_TABLE_ROLE]]))();

const roleOf = (child: ReactNode): string | undefined => ROLE_OF.get((isValidElement(child) ? displayNameOf(child.type) : undefined) ?? "");

const lastProps = (list: readonly ReactNode[], role: string): Readonly<Record<string, unknown>> | undefined => {
  const match = list.findLast((child) => roleOf(child) === role);
  return isValidElement<Readonly<Record<string, unknown>>>(match) ? match.props : undefined;
};

/** The controller's carrier table (core/sankey/controller.ts): the last SankeyLink and SankeyNode (`{}` when absent) and SankeyTooltip of the
 * direct children, each the element's own props. */
export const sankeyTable = (children: ReactNode): ChildTable => {
  const list: readonly ReactNode[] = Array.isArray(children) ? children : [children];
  const tooltip = lastProps(list, SANKEY_ROLES.tooltip);
  const dataTable = lastProps(list, DATA_TABLE_ROLE);
  return new Map([
    ...(dataTable === undefined ? [] : [[DATA_TABLE_ROLE, [dataTable]] as const]),
    [SANKEY_ROLES.link, [lastProps(list, SANKEY_ROLES.link) ?? {}]],
    [SANKEY_ROLES.node, [lastProps(list, SANKEY_ROLES.node) ?? {}]],
    ...(tooltip === undefined ? [] : [[SANKEY_ROLES.tooltip, [tooltip]] as const]),
  ]);
};

/** Whether a child is one of the config carriers (never rendered), as opposed to a `useSankey()` consumer. */
export const isConfigCarrier = (child: ReactNode): boolean => roleOf(child) !== undefined;
