import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { displayNameOf, readChildren } from "../kit/read-children";
import type { ChildTable } from "../core/carriers/table";
import { SUNBURST_ROLES } from "../core/sunburst/view";
import type { SunburstCenterProps, SunburstLabelsProps, SunburstSegmentProps } from "../core/types/sunburst";

// Carriers: rendered nowhere, read by SunburstChart through displayName.
/** Customizes the color, fill or opacity of one segment. Renders nothing itself; `SunburstChart` reads its props. */
export const SunburstSegment = /* @__PURE__ */ Object.assign(function SunburstSegment(_props: Readonly<SunburstSegmentProps>): null {
  return null;
}, { displayName: "SunburstSegment" });
/** Enables the center hub: after zooming in, click it (or press Enter on it) to zoom back out. Renders nothing itself; `SunburstChart` reads its presence. */
export const SunburstCenter = /* @__PURE__ */ Object.assign(function SunburstCenter(_props: Readonly<SunburstCenterProps>): null {
  return null;
}, { displayName: "SunburstCenter" });
/** Shows the segment names at the segment centers, fading in once the enter sweep has played. Renders nothing itself; `SunburstChart` reads its props. */
export const SunburstLabels = /* @__PURE__ */ Object.assign(function SunburstLabels(_props: Readonly<SunburstLabelsProps>): null {
  return null;
}, { displayName: "SunburstLabels" });

interface ParsedChildren {
  /** The carriers' props by role (core/sunburst/view.ts `SUNBURST_ROLES`, and the gradients'), in JSX order: the controller reads them. */
  readonly table: ChildTable;
  readonly breadcrumbs: ReactElement[];
  readonly hints: ReactElement[];
  /** Pattern tiles (`PatternLines`…, or a `<pattern>` written by hand): the chart's defs host draws them, a segment paints with `url(#id)`. */
  readonly defs: ReactElement[];
}

/** Resource elements written by hand that go in the defs host as they are. */
const RESOURCE_TAGS: ReadonlySet<string> = /* @__PURE__ */ new Set(["clipPath", "filter", "linearGradient", "mask", "pattern", "radialGradient"]);

/** The carriers' roles by display name; `SunburstBreadcrumb` and `SunburstHint` render, placed by the chart around its stage. */
const ROLE_OF: ReadonlyMap<string, string> = /* @__PURE__ */ ((): ReadonlyMap<string, string> => new Map([["SunburstCenter", SUNBURST_ROLES.center], ["SunburstLabels", SUNBURST_ROLES.labels], ["SunburstSegment", SUNBURST_ROLES.segment]]))();

export const parseChildren = (children: ReactNode): ParsedChildren => {
  // The config carriers React's other charts read (LinearGradient, RadialGradient, the presets): the controller draws the gradients.
  const table = new Map<string, Record<string, unknown>[]>();
  for (const [role, list] of readChildren(children)) { table.set(role, [...list]); }
  const breadcrumbs: ReactElement[] = [];
  const hints: ReactElement[] = [];
  const defs: ReactElement[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement<Record<string, unknown>>(child)) {
      continue;
    }
    if (typeof child.type === "string") {
      if (RESOURCE_TAGS.has(child.type)) { defs.push(child); }
      continue;
    }
    // The carrier's displayName selects which props shape the child holds.
    const name = displayNameOf(child.type) ?? "";
    const role = ROLE_OF.get(name);
    if (role !== undefined) {
      const list = table.get(role);
      if (list === undefined) {
        table.set(role, [child.props]);
      } else {
        list.push(child.props);
      }
    } else if (name === "SunburstBreadcrumb") {
      breadcrumbs.push(child);
    } else if (name === "SunburstHint") {
      hints.push(child);
    } else if (name.includes("Pattern")) {
      // bklit puts a child named like a pattern or gradient in the svg's <defs> (sunburst-chart.tsx `isDefsComponent`); the gradients are
      // config carriers here, read above.
      defs.push(child);
    }
  }
  return { breadcrumbs, defs, hints, table };
};
