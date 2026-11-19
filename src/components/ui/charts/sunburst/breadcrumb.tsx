"use client";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { breadcrumbItemsOf } from "../core/sunburst/context";
import { useSunburstStable } from "./context";
import type { SunburstBreadcrumbItem, SunburstBreadcrumbProps as CoreSunburstBreadcrumbProps } from "../core/types/sunburst";

/** Props of `SunburstBreadcrumb`. */
export interface SunburstBreadcrumbProps extends CoreSunburstBreadcrumbProps<ReactNode> {}

/** Slot above the chart for drill-down navigation. Render your own trail inside it using `useSunburstBreadcrumbItems`. */
export const SunburstBreadcrumb = /* @__PURE__ */ Object.assign(function SunburstBreadcrumb({ className, children }: Readonly<SunburstBreadcrumbProps>): ReactNode {
  return (
  <nav aria-label="Drill-down path" className={className ?? "bk-sb-crumbs"}>
    {children}
  </nav>
);
}, { displayName: "SunburstBreadcrumb" });

interface SunburstBreadcrumbItems {
  items: SunburstBreadcrumbItem[];
  zoomTo: (id: string) => void;
}

/** Returns the drill-down trail (`items`, root first) and `zoomTo` to jump to a node by id. Call it inside `SunburstChart`; it throws otherwise. */
export const useSunburstBreadcrumbItems = (): SunburstBreadcrumbItems => {
  const { data, focus, focusById, rootId, zoomTo } = useSunburstStable();
  const { name: rootName } = data;
  const items = useMemo(() => breadcrumbItemsOf(focus, focusById, rootId, rootName), [rootName, focus, focusById, rootId]);
  return { items, zoomTo };
};
