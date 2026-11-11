import { FCT_VIEW_TYPES } from "./fct-view-types";
import { setQueryViewAttributes } from "./fct-query-derived";
import type { FctQueryTree, FctQueryNode, FctValue } from "./fct-query";

export const RDF_PROPERTY_CLASS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property";
export type PropertyUsageDirection = "subject" | "object";

/** The view-bearing scope, not any unrelated class filter elsewhere in the tree. */
export function propertyUsageScope(tree: FctQueryTree): { parentId: string | null; nodes: FctQueryNode[] } | null {
  function visit(nodes: FctQueryNode[], parentId: string | null): { parentId: string | null; nodes: FctQueryNode[] } | null {
    if (nodes.some(node => node.id === "query-view"))
      return nodes.some(node => node.name === "class" && node.attributes.iri === RDF_PROPERTY_CLASS)
        ? { parentId, nodes } : null;
    for (const node of nodes) {
      const nested = visit(node.children, node.id);
      if (nested) return nested;
    }
    return null;
  }
  return visit(tree.children, null);
}

/** A URI binding on the property resource enables canonical property/property-of navigation. */
function fixedPropertyUri(scope: ReturnType<typeof propertyUsageScope>): string | null {
  if (!scope) return null;
  const binding = scope.nodes.find(node => node.name === "value" && node.attributes.datatype === "uri");
  const text = (binding?.text ?? "").replace(/^\[|\]$/g, "");
  return /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(text) ? text : null;
}

function cloneNode(node: FctQueryNode): FctQueryNode {
  return { ...node, attributes: { ...node.attributes }, children: node.children.map(cloneNode) };
}

/** A native property-usage view is a variable-predicate traversal, never an XSLT provider. */
export function propertyUsageFacetQuery(tree: FctQueryTree, direction: PropertyUsageDirection, limit: number, offset = 0): FctQueryTree {
  return setQueryViewAttributes({ ...tree, attributes: { ...tree.attributes }, children: tree.children.map(cloneNode) }, {
    type: direction === "subject" ? FCT_VIEW_TYPES.LIST_SUBJECTS : FCT_VIEW_TYPES.LIST_OBJECTS,
    limit: String(limit), offset: String(offset), sort: "count",
  });
}

/** Convert a selected predicate resource into an ordinary FCT relationship.
 *
 * The rdf:Property class applies to the predicate resource, NOT to the
 * subjects/objects reached through that predicate. Retaining that class on
 * pivot would incorrectly restrict those new result resources. The lexical
 * value on the new relationship is the *selected subject or object*, never
 * the URI of the predicate itself; the predicate goes in its `iri` attribute.
 *
 * Preserve all unrelated ancestors and filters in this focus context, and
 * move only the existing <view> onto the new property or property-of.
 */
export function propertyUsageNavigation(
  tree: FctQueryTree,
  direction: PropertyUsageDirection,
  selection?: { value: FctValue; checked: boolean },
): FctQueryTree {
  const scope = propertyUsageScope(tree);
  if (!scope) return tree;
  const fixedUri = fixedPropertyUri(scope);
  if (fixedUri) {
    const originalView = scope.nodes.find(node => node.id === "query-view");
    if (!originalView) return tree;
    const valueNodes: FctQueryNode[] = selection?.checked ? [{
      id: `property-usage-pivot-value-${direction}`, name: "value", text: selection.value.text,
      attributes: {
        ...(selection.value.datatype ? { datatype: selection.value.datatype } : {}),
        ...(selection.value.lang ? { "xml:lang": selection.value.lang } : {}),
      }, children: [],
    }] : [];
    const relationship: FctQueryNode = {
      id: `property-usage-pivot-${direction}-${encodeURIComponent(fixedUri)}`,
      name: direction === "subject" ? "property-of" : "property",
      attributes: { iri: fixedUri },
      children: [...valueNodes, {
        ...cloneNode(originalView), id: "query-view",
        attributes: { ...originalView.attributes, type: FCT_VIEW_TYPES.LIST, offset: "0", sort: "" },
        children: [],
      }],
    };
    const replaceAtScope = (nodes: FctQueryNode[], parentId: string | null): FctQueryNode[] => {
      if (parentId === scope.parentId) {
        // Remove *only* the class that classified the predicate as rdf:Property,
        // the predicate-resource's URI binding, and the old view. A generic
        // class or an unrelated ancestor remains in place.
        return [
          ...nodes.filter(node => node.id !== "query-view"
            && !(node.name === "class" && node.attributes.iri === RDF_PROPERTY_CLASS)
            && !(node.name === "value" && node.attributes.datatype === "uri" &&
              (node.text ?? "").replace(/^\[|\]$/g, "") === fixedUri)).map(cloneNode),
          relationship,
        ];
      }
      return nodes.map(node => ({ ...cloneNode(node), children: replaceAtScope(node.children, node.id) }));
    };
    return { ...tree, attributes: { ...tree.attributes }, children: replaceAtScope(tree.children, null) };
  }
  // The focus can represent multiple rdf:Property resources. Until it has a
  // single URI binding we cannot manufacture a fixed-IRI <property> element.
  // Keep the variable-predicate view while the user browses the alternatives.
  const next = setQueryViewAttributes(propertyUsageFacetQuery(tree, direction, 30), { sort: "" });
  if (!selection) return next;
  const selectedKey = JSON.stringify([selection.value.text, selection.value.datatype ?? "", selection.value.lang ?? ""]);
  const valueNode: FctQueryNode = { id: `usage-${direction}-${encodeURIComponent(selectedKey)}`,
    name: "value", text: selection.value.text, attributes: {
      ...(selection.value.datatype ? { datatype: selection.value.datatype } : {}),
      ...(selection.value.lang ? { "xml:lang": selection.value.lang } : {}),
    }, children: [] };
  const updateScope = (nodes: FctQueryNode[]): FctQueryNode[] => {
    if (nodes.some(node => node.id === "query-view")) {
      const existing = nodes.find(node => node.name === direction);
      const candidates = existing?.children.filter(node => node.name === "value") ?? [];
      const remaining = candidates.filter(node => JSON.stringify([node.text ?? "", node.attributes.datatype ?? "", node.attributes["xml:lang"] ?? ""]) !== selectedKey);
      const replacements = selection.checked ? [...remaining, valueNode] : remaining;
      return [...nodes.filter(node => node.name !== direction),
        ...(replacements.length ? [{ id: `usage-${direction}`, name: direction, attributes: {}, children: replacements }] as FctQueryNode[] : [])];
    }
    return nodes.map(node => ({ ...node, children: updateScope(node.children) }));
  };
  return { ...next, children: updateScope(next.children) };
}

export function selectedPropertyUsageValues(tree: FctQueryTree, direction: PropertyUsageDirection): FctValue[] {
  return (propertyUsageScope(tree)?.nodes.find(node => node.name === direction)?.children ?? [])
    .filter(node => node.name === "value").map(node => ({ text: node.text ?? "", datatype: node.attributes.datatype, lang: node.attributes["xml:lang"] }));
}
