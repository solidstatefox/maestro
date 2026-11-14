"use client";

import { fctQueryTreeApi, type FctQueryTree, type FctQueryNode } from "./fct-query-api";

export type TransportedFacet = {
  id: string;
  href: string;
  target: FctQueryNode;
  /** Predicate path from the active view carrier to the referenced descendant. */
  path: Array<{ id: string; iri: string; direction: "forward" | "reverse" }>;
};

const isRelationship = (node: FctQueryNode) => node.name === "property" || node.name === "property-of";
const hasView = (node: FctQueryNode) => node.name === "view" || node.children.some(hasView);

/** Resolve only aliases at the active view scope. The target MUST be a descendant
 * of the alias's containing scope; aliases never introduce new query edges. */
export function resolveTransportedFacets(tree: FctQueryTree): TransportedFacet[] {
  function activeScope(nodes: FctQueryNode[]): FctQueryNode[] | null {
    if (nodes.some(node => node.name === "view")) return nodes;
    for (const node of nodes) {
      if (!hasView(node)) continue;
      const nested = activeScope(node.children);
      if (nested) return nested;
    }
    return null;
  }
  const scope = activeScope(tree.children);
  if (!scope) return [];
  const find = (nodes: FctQueryNode[], id: string, ancestors: FctQueryNode[] = []): FctQueryNode[] | null => {
    for (const node of nodes) {
      if (node.id === id) return [...ancestors, node];
      const nested = find(node.children, id, [...ancestors, node]);
      if (nested) return nested;
    }
    return null;
  };
  return scope.filter(node => node.name === "a").flatMap(alias => {
    const href = alias.attributes.href;
    if (!href) return [];
    const path = find(scope, href);
    if (!path || path.some(node => node.name === "view" || node.name === "a")) return [];
    const target = path[path.length - 1];
    if (!isRelationship(target)) return [];
    return [{id:alias.id,href,target,path:path.filter(isRelationship).map(node => ({
      id:node.id, iri:node.attributes.iri ?? "", direction:node.name === "property" ? "forward" as const : "reverse" as const,
    }))}];
  });
}

/** An FCT values/counts projection built entirely from a data-plane query API
 * snapshot. The original live <view> and all live node identities are untouched. */
export function createTransportedFacetQuery(source: FctQueryTree, targetId: string): FctQueryTree {
  const tree = fctQueryTreeApi.getDataTree(source);
  let carriedView: FctQueryNode | null = null;
  const stripView = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap(node => {
    if (node.name === "view") { carriedView = node; return []; }
    return [{...node, children:stripView(node.children)}];
  });
  const base = stripView(tree.children);
  if (!carriedView) throw new Error("Cannot project a transported facet without a view.");
  let found = false;
  const place = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map(node => {
    if (node.id === targetId && isRelationship(node)) {
      found = true;
      return { ...node, children: [
        ...node.children.filter(child => child.name !== "value"),
        {...carriedView!, attributes:{...carriedView!.attributes,type:"list-count",limit:"300",offset:"0",kind:"",group:""},children:[]},
      ] };
    }
    return {...node,children:place(node.children)};
  });
  const children = place(base);
  if (!found) throw new Error(`The transported Personal facet target ${targetId} is not a relationship in the FCT query.`);
  return {...tree,children};
}
