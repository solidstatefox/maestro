import { activeBackground, BACKGROUND_PATTERN_ID } from "../cartesian/background";
import { referencePatternId, usesReferencePattern } from "../cartesian/reference-pattern";
import type { ReferencePatternProps } from "../cartesian/reference-pattern";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { isLocalRef, isNonEmptyString, scopedResourceId, scopedResourceRef } from "../resource-ids";
import type { StyleObject } from "../style";
import { el } from "./node";
import type { MarkupChild, MarkupNode } from "./node";
import { patternPresetTree } from "./patterns";

/** A zero-size svg that holds defs without taking room. */
export const HIDDEN_DEFS_STYLE: StyleObject = { height: 0, overflow: "hidden", position: "absolute", width: 0 };

/** The defs host of a mount: `resources` (a framework's own children through `MARKUP_SLOT`) in its one <defs>. */
export const resourceHost = (idPrefix: string, resources: readonly MarkupChild[]): MarkupNode =>
  el("svg", { "aria-hidden": "true", focusable: "false", height: 0, id: `${idPrefix}-resources`, width: 0 }, [el("defs", {}, resources)], { style: HIDDEN_DEFS_STYLE, styleBefore: "width" });

const scopeChild = (child: MarkupChild, idPrefix: string): MarkupChild => {
  if (child === null || typeof child === "string" || !("tag" in child)) {
    return child;
  }
  const { id, href } = child.attrs;
  const xlinkHref = child.attrs["xlink:href"];
  return {
    ...child,
    attrs: {
      ...child.attrs,
      ...(isNonEmptyString(id) ? { id: scopedResourceId(idPrefix, id) } : undefined),
      ...(isLocalRef(href) ? { href: scopedResourceRef(idPrefix, href) } : undefined),
      ...(isLocalRef(xlinkHref) ? { "xlink:href": scopedResourceRef(idPrefix, xlinkHref) } : undefined),
    },
    children: scopeMarkupIds(child.children, idPrefix),
  };
};

/** Scopes a resources tree to the mount: every id, and every local `href` / `xlink:href` (the definitions reference the scoped ids). */
export const scopeMarkupIds = (nodes: readonly MarkupChild[], idPrefix: string): MarkupChild[] => nodes.map((node) => scopeChild(node, idPrefix));

/** bklit background.tsx:91-100: the Background preset's tile, with the Background's own color, scale and tile options; null when none paints. */
export const backgroundResources = (table: ChildTable, uid: string): MarkupNode | null => {
  const props = activeBackground(table);
  if (!props) {
    return null;
  }
  const { color = "var(--chart-grid)", complement, dotFill, fill, pattern = "diagonal", radius, scale = 1, strokeWidth, tileBackground } = props;
  const tile = patternPresetTree(pattern, BACKGROUND_PATTERN_ID, { color, complement, dotFill, fill, radius, scale, strokeWidth, tileBackground });
  return tile === undefined ? null : resourceHost(uid, scopeMarkupIds([tile], uid));
};

/**
 * The ReferenceAreas' pattern fills (bklit reference-area.tsx:152-168), the i-th area's tile as `referencePatternId(i)`; null when none uses one.
 * Accepted divergence, kept from phase 1 so React draws what it drew: bklit's tiles start at the plot origin (its pattern lives in the
 * margin-translated plot group) and the native rect is in svg space, so bklit's tiles sit a margin further right and down; phase 1's shift
 * never reached the preset tiles, which start at the svg origin.
 */
export const referenceAreaResources = (table: ChildTable, uid: string): MarkupNode | null => {
  const tiles = propsFor<ReferencePatternProps>(table, "referenceArea").flatMap((r, i) => {
    const tile = usesReferencePattern(r) && r.pattern !== undefined
      ? patternPresetTree(r.pattern, referencePatternId(i), {
          color: r.patternColor ?? "var(--chart-foreground-muted)",
          scale: r.patternScale ?? 1,
          strokeWidth: r.patternStrokeWidth,
          radius: r.patternRadius,
          complement: r.patternComplement,
          fill: r.patternFill,
          dotFill: r.patternDotFill,
          tileBackground: r.patternTileBackground,
        })
      : undefined;
    return tile === undefined ? [] : [tile];
  });
  return tiles.length === 0 ? null : resourceHost(uid, scopeMarkupIds(tiles, uid));
};
