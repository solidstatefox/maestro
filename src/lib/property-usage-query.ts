import { FCT_VIEW_TYPES } from "./fct-view-types";
import { setQueryViewAttributes } from "./fct-query-derived";
import type { FctQueryTree, FctQueryNode, FctValue } from "./fct-query";

export const RDF_PROPERTY_CLASS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property";
export type PropertyUsageDirection = "subject" | "object";

/** The view-bearing scope, not any unrelated class filter elsewhere in the tree. */
export function propertyUsageScope(tree: FctQueryTree): { parentId: string | null; nodes: FctQueryNode[] } | null {
  function visit(nodes: FctQueryNode[], parentId: string | null): { parentId: string | null; nodes: FctQueryNode[] } | null {
    if (nodes.some(node => (node.uiKey === "query-view" || node.id === "query-view")))
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
  selectedPredicateUri?: string,
): FctQueryTree {
  const scope = propertyUsageScope(tree);
  if (!scope) return tree;
  // Results selection is authoritative for the predicate pivot. A URI
  // explicitly bound in the breadcrumb remains a fallback for callers that
  // have no selected Results item.
  const candidate = selectedPredicateUri?.trim() || fixedPropertyUri(scope) || "";
  const fixedUri = /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(candidate) ? candidate : null;
  if (fixedUri) {
    const originalView = scope.nodes.find(node => (node.uiKey === "query-view" || node.id === "query-view"));
    if (!originalView) return tree;
    const relationName = direction === "subject" ? "property-of" : "property";
    const selectedKey = selection && JSON.stringify([selection.value.text, selection.value.datatype ?? "", selection.value.lang ?? ""]);
    const valueNodes: FctQueryNode[] = selection?.checked ? [{
      id: `property-usage-pivot-value-${direction}-${encodeURIComponent(selectedKey ?? "")}`, name: "value", text: selection.value.text,
      attributes: {
        ...(selection.value.datatype ? { datatype: selection.value.datatype } : {}),
        ...(selection.value.lang ? { "xml:lang": selection.value.lang } : {}),
      }, children: [],
    }] : [];
    const existing = scope.nodes.find(node => node.name === relationName && node.attributes.iri === fixedUri);
    const relation = existing ? cloneNode(existing) : {
      id: `property-usage-pivot-${direction}-${encodeURIComponent(fixedUri)}`,
      name: relationName, attributes: { iri: fixedUri }, children: [],
    } as FctQueryNode;
    if (selection) {
      relation.children = relation.children.filter(node => node.name !== "value" ||
        JSON.stringify([node.text ?? "", node.attributes.datatype ?? "", node.attributes["xml:lang"] ?? ""]) !== selectedKey);
      if (selection.checked) relation.children.push(...valueNodes);
    }
    relation.children = relation.children.filter(node => (node.uiKey !== "query-view" && node.id !== "query-view"));
    relation.children.push({ ...cloneNode(originalView),
      attributes: { ...originalView.attributes, type: FCT_VIEW_TYPES.LIST, offset: "0", sort: "" }, children: [] });
    const replaceAtScope = (nodes: FctQueryNode[], parentId: string | null): FctQueryNode[] => {
      if (parentId === scope.parentId) {
        // Remove *only* the class that classified the predicate as rdf:Property,
        // the predicate-resource's URI binding, and the old view. A generic
        // class or an unrelated ancestor remains in place.
        return [
          ...nodes.filter(node => (node.uiKey !== "query-view" && node.id !== "query-view")
            && node !== existing
            && node.name !== "text"
            && !(node.name === "class" && node.attributes.iri === RDF_PROPERTY_CLASS)
            && !(node.name === "value" && node.attributes.datatype === "uri" &&
              (node.text ?? "").replace(/^\[|\]$/g, "") === fixedUri)).map(cloneNode),
          relation,
        ];
      }
      return nodes.map(node => ({ ...cloneNode(node), children: replaceAtScope(node.children, node.id) }));
    };
    return { ...tree, attributes: { ...tree.attributes }, children: replaceAtScope(tree.children, null) };
  }
  // Neither Results nor the breadcrumb has a valid predicate IRI. Do not
  // invent one or emit an invalid relationship in the live query.
  return tree;
}

export function selectedPropertyUsageValues(tree: FctQueryTree, direction: PropertyUsageDirection): FctValue[] {
  return (propertyUsageScope(tree)?.nodes.find(node => node.name === direction)?.children ?? [])
    .filter(node => node.name === "value").map(node => ({ text: node.text ?? "", datatype: node.attributes.datatype, lang: node.attributes["xml:lang"] }));
}
