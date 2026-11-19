"use client";
import { Children, isValidElement } from "react";
import type { ReactNode } from "react";
import { defineCarrier } from "../kit/role";
import { CHOROPLETH_ROLES, isChoroplethRole } from "../core/choropleth/carriers";
import { enableChoroplethBackdrop, enableChoroplethDots, enableChoroplethMarkers } from "../core/choropleth/enable-layers";
import { CARRIER_ENABLE } from "../core/carriers/roles";
import { isFunction, isRecord } from "../core/guards";
import type { ChildTable } from "../core/carriers/table";
import { roleOf } from "../core/choropleth/role-of";
import type { ChoroplethFeatureProps, ChoroplethTooltipProps } from "./types";
import type { ChoroplethBackgroundProps, ChoroplethDotGridProps, ChoroplethGraticuleProps, ChoroplethMarkerProps } from "../core/types/choropleth";

// Carrier components: configuration is read from the element props by the chart (roleOf), they render nothing.
/** Configures how features are filled, stroked and dimmed. Renders nothing itself; `ChoroplethChart` reads its props. */
const ChoroplethFeatureComponent = /* @__PURE__ */ (() => defineCarrier<Readonly<ChoroplethFeatureProps>>(CHOROPLETH_ROLES.feature, "ChoroplethFeature"))();
/** Adds graticule (latitude and longitude) lines behind the features. Renders nothing itself; `ChoroplethChart` reads its props. */
const ChoroplethGraticule = /* @__PURE__ */ (() => defineCarrier<Readonly<ChoroplethGraticuleProps>>(CHOROPLETH_ROLES.graticule, "ChoroplethGraticule"))();
/** Enables and configures the tooltip shown on hover or keyboard focus. Without it no tooltip appears. Renders nothing itself; `ChoroplethChart` reads its props. */
const ChoroplethTooltip = /* @__PURE__ */ (() => defineCarrier<Readonly<ChoroplethTooltipProps>>(CHOROPLETH_ROLES.tooltip, "ChoroplethTooltip"))();

/** Draws the map as one dot lattice instead of filled regions; use it in place of `ChoroplethFeatureComponent`. Renders nothing itself; `ChoroplethChart` reads its props. */
const ChoroplethDotGrid = /* @__PURE__ */ (() => defineCarrier<Readonly<ChoroplethDotGridProps>>(CHOROPLETH_ROLES.dotGrid, "ChoroplethDotGrid", undefined, enableChoroplethDots))();
/** A point on the map at `[longitude, latitude]` that keeps its size while the map zooms, names itself in `ChoroplethTooltip` and, with
 * `clickToZoom`, flies the camera to itself. Renders nothing itself; `ChoroplethChart` reads its props. */
const ChoroplethMarker = /* @__PURE__ */ (() => defineCarrier<Readonly<ChoroplethMarkerProps>>(CHOROPLETH_ROLES.marker, "ChoroplethMarker", undefined, enableChoroplethMarkers))();
/** A pattern behind the map that doesn't zoom, pan or tilt: the cartesian `Background`'s options plus `hideOnFocus`. Renders nothing itself; `ChoroplethChart` reads its props. */
const ChoroplethBackground = /* @__PURE__ */ (() => defineCarrier<Readonly<ChoroplethBackgroundProps>>(CHOROPLETH_ROLES.background, "ChoroplethBackground", undefined, enableChoroplethBackdrop))();

import { DATA_TABLE_ROLE } from "../core/a11y/data-table";

interface ExtractedChildren {
  /** The carriers' props by role (the controller reads the configuration from it, core/choropleth/carriers.ts). */
  readonly table: ChildTable;
  readonly overlayChildren: readonly ReactNode[];
}

/** The direct children: the carriers' props by role, every other child an overlay. */
const extractChildren = (children: ReactNode): ExtractedChildren => {
  const table = new Map<string, Readonly<Record<string, unknown>>[]>();
  const overlayChildren: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    const role = isValidElement(child) ? roleOf(child.type) : undefined;
    if (role === DATA_TABLE_ROLE && isValidElement<Readonly<Record<string, unknown>>>(child)) {
      table.set(role, [child.props]);
    } else if (isChoroplethRole(role) && isValidElement<Readonly<Record<string, unknown>>>(child)) {
      // A layer carrier hands the core its layer as the chart reads it (core/carriers/roles.ts `CARRIER_ENABLE`).
      const type: unknown = child.type;
      const enable: unknown = (isFunction(type) || isRecord(type)) && CARRIER_ENABLE in type ? type[CARRIER_ENABLE] : undefined;
      if (isFunction(enable)) {enable();}
      table.set(role, [...(table.get(role) ?? []), child.props]);
    } else {
      overlayChildren.push(child);
    }
  }
  return { overlayChildren, table };
};

export { ChoroplethBackground, ChoroplethDotGrid, ChoroplethFeatureComponent, ChoroplethGraticule, ChoroplethMarker, ChoroplethTooltip, extractChildren };
