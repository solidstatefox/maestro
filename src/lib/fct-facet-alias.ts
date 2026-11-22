"use client";

import { fctQueryTreeApi, type FctQueryTree, type FctQueryNode } from "./fct-query-api";
import { createGroupValuesQuery } from "./fct-query-derived";
import { getPath, indexFctPaths } from "./fct-get-path";

export type TransportedFacet = {
  /** Stable identity of this <a>, independent of repeated predicate IRIs. */
  id: string;
  /** Exact descendant relationship being transported. */
  href: string;
  /** The selected strict ancestor owning <a>, including the query root. */
  parentId: string;
  target: FctQueryNode;
  /** The original getPath relationship chain, not a new synthetic predicate. */
  path: Array<{ id: string; iri: string; direction: "forward" | "reverse" }>;
};

const isRelationship = (node: FctQueryNode) => node.name === "property" || node.name === "property-of";
const hasView = (node: FctQueryNode) => node.name === "view" || node.children.some(hasView);

/** An FCT focus is the immediate parent of the authoritative <view>. */
function activeCarrier(tree: FctQueryTree): FctQueryTree | FctQueryNode | null {
  const find = (parent: FctQueryTree | FctQueryNode): FctQueryTree | FctQueryNode | null => {
    if (parent.children.some(node => node.name === "view")) return parent;
    for (const child of parent.children) {
      if (!hasView(child)) continue;
      const located = find(child);
      if (located) return located;
    }
    return null;
  };
  return find(tree);
}

/** A valid preview runs only from a strict ancestor to the live focus.
 * Ancestor and focus IDs come from getPath, so the Query Tree and breadcrumb
 * highlight precisely the same path even with repeated predicate IRIs. */
export function transportedAnchorPath(tree: FctQueryTree, ancestorId: string):
  { ids: string[]; path: TransportedFacet["path"] } | null {
  const focus = activeCarrier(tree);
  if (!focus || focus === tree || !isRelationship(focus as FctQueryNode)) return null;
  const index = indexFctPaths<FctQueryTree | FctQueryNode>(tree);
  const ancestor = ancestorId === tree.attributes.id ? tree : index.byId.get(ancestorId);
  if (!ancestor || ancestor === focus || (ancestor !== tree && !isRelationship(ancestor as FctQueryNode))) return null;
  const resolved = getPath(index, ancestor, (focus as FctQueryNode).id);
  if (!resolved) return null;
  return { ids: [ancestorId, ...resolved.path.map(step => step.id)], path: resolved.path };
}

/** An alias is a viewer-plane <a> child of the selected *ancestor*, with href
 * pointing to the *descendant focus*. Legacy sibling anchors are readable. */
export function resolveTransportedFacets(tree: FctQueryTree): TransportedFacet[] {
  const index = indexFctPaths<FctQueryTree | FctQueryNode>(tree);
  const results: TransportedFacet[] = [];
  const visit = (parent: FctQueryTree | FctQueryNode) => {
    for (const child of parent.children) {
      if (child.name === "a") {
        const href = child.attributes.href;
        if (!href) continue;
        const parentId = "id" in parent ? parent.id : parent.attributes.id;
        // A transported facet is attached to an ancestor *scope*, not to
        // whichever descendant happens to carry <view> at this moment.
        // Resolve it regardless of the active focus so Return, History,
        // Perspectives, Analyze and query restoration share one identity.
        const resolved = getPath(index, parent, href);
        if (resolved && isRelationship(resolved.target as FctQueryNode))
          results.push({ id: child.id, href, parentId, target: resolved.target as FctQueryNode, path: resolved.path });
      } else if (isRelationship(child)) visit(child);
    }
  };
  visit(tree);
  return results;
}

/** Toggle exactly this ancestor's alias, not a same-IRI neighbor. */
export function toggleTransportedAnchor(tree: FctQueryTree, ancestorId: string): FctQueryTree {
  if (!transportedAnchorPath(tree, ancestorId)) return tree;
  const focus = activeCarrier(tree) as FctQueryNode;
  const existing = resolveTransportedFacets(tree).find(item => item.parentId === ancestorId && item.href === focus.id);
  if (existing) {
    const prune = (nodes: FctQueryNode[]): FctQueryNode[] => nodes
      .filter(node => node.id !== existing.id)
      .map(node => ({ ...node, children: prune(node.children) }));
    return { ...tree, children: prune(tree.children) };
  }
  const anchor: FctQueryNode = {
    id: `transported-anchor-${ancestorId}-${focus.id}`,
    name: "a", attributes: { href: focus.id }, children: [],
  };
  if (ancestorId === tree.attributes.id) return { ...tree, children: [...tree.children, anchor] };
  const add = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map(node =>
    node.id === ancestorId && isRelationship(node)
      ? { ...node, children: [...node.children, anchor] }
      : { ...node, children: add(node.children) });
  return { ...tree, children: add(tree.children) };
}

/** An alias's values travel through the ordinary Personal facet values query,
 * selecting the original descendant property (by ID), not a synthetic alias
 * property. The viewer-only <a> remains excluded from every derived query. */
export function createTransportedFacetQuery(source: FctQueryTree, alias: TransportedFacet): FctQueryTree {
  // A transported facet must count its *ancestor* population, grouped by
  // the full descendant path. Enumerating the terminal predicate at its own
  // focus would count DOI values instead of the Projects owning those DOIs.
  return createGroupValuesQuery(fctQueryTreeApi.getDataTree(source), {
    key: `alias:${alias.id}`, uri: alias.target.attributes.iri ?? "",
    direction: alias.target.name === "property-of" ? "reverse" : "forward",
    label: alias.path.map(step => step.iri).join(" › "),
    nodeId: alias.href, anchorId: alias.id, parentId: alias.parentId,
  }, { limit: 1000, offset: 0 });
}

/** The scope of an alias is the node which owns <a>, not the terminal value. */
export function activeTransportedFacets(tree: FctQueryTree): TransportedFacet[] {
  const carrier = activeCarrier(tree);
  if (!carrier) return [];
  const id = "id" in carrier ? carrier.id : carrier.attributes.id;
  return resolveTransportedFacets(tree).filter(alias => alias.parentId === id);
}
