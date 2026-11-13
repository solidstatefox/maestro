import { ensureFctQueryIds, nextFctQueryId } from "./fct-node-identity";
import type { FctQueryNode, FctQueryTree } from "./fct-query-api";

/** Follow a forward predicate from the *current* view carrier. This is an FCT
 * breadcrumb transition, not a new root search or a view-only projection.
 * Unlike a global path lookup, the same predicate may occur earlier in the
 * breadcrumb (rdf:type of an rdf:type resource, for example).
 *
 * An already selected sibling predicate is promoted without losing its
 * value/class constraints, and the single existing view keeps its identity.
 */
export function navigateFacetHeaderQuery(tree: FctQueryTree, predicate: string): FctQueryTree {
  if (!/^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(predicate)) return tree;
  const normalized = ensureFctQueryIds(tree) as FctQueryTree;
  const isView = (node: FctQueryNode) => node.name === "view";
  function locate(nodes: FctQueryNode[], parentId: string | null = null): { parentId: string | null; view: FctQueryNode } | null {
    for (const node of nodes) {
      if (isView(node)) return { parentId, view: node };
      const nested = locate(node.children, node.id);
      if (nested) return nested;
    }
    return null;
  }
  const focus = locate(normalized.children);
  if (!focus) return tree;
  const clean = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap(node =>
    isView(node) ? [] : [{ ...node, children: clean(node.children) }]);
  const { id, ctr } = nextFctQueryId(normalized);
  const putView = (nodes: FctQueryNode[]): FctQueryNode[] => {
    const existing = nodes.find(node => node.name === "property" && node.attributes.iri === predicate);
    if (existing) return nodes.map(node => node === existing
      ? { ...node, children: [...node.children, { ...focus.view, children: [] }] }
      : node);
    return [...nodes, { id, name: "property", attributes: { iri: predicate }, children: [{ ...focus.view, children: [] }] }];
  };
  const insert = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map(node =>
    node.id === focus.parentId ? { ...node, children: putView(node.children) }
      : { ...node, children: insert(node.children) });
  const withoutView = clean(normalized.children);
  return { ...normalized, attributes: { ...normalized.attributes, ctr },
    children: focus.parentId ? insert(withoutView) : putView(withoutView) };
}
