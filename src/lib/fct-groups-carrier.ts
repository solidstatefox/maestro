"use client";

import type { FctQueryNode, FctQueryTree } from "./fct-query";
import { cloneFctQueryTree } from "./fct-query-clone";

const VIEW_KEY = "query-view";
const GROUP_PREFIX = "maestro-group-carrier-";
export const GROUP_PREVIOUS_SESSION_KEY = "maestro:groupby:previous";
export type GroupCarrier = {
  view: FctQueryNode;
  carrier: FctQueryNode | null;
  parentOfCarrier: FctQueryNode | null;
  siblings: FctQueryNode[];
};

const isView = (node: FctQueryNode) => node.id === VIEW_KEY || node.uiKey === VIEW_KEY || node.name === "view";

export function findGroupCarrier(tree: FctQueryTree): GroupCarrier | null {
  const seek = (nodes: FctQueryNode[], parents: FctQueryNode[]): FctQueryNode[] | null => {
    for (const node of nodes) {
      if (isView(node)) return [...parents, node];
      const found = seek(node.children, [...parents, node]);
      if (found) return found;
    }
    return null;
  };
  const path = seek(tree.children, []);
  if (!path) return null;
  const view = path[path.length - 1];
  const carrier = path[path.length - 2] ?? null;
  const parentOfCarrier = path[path.length - 3] ?? null;
  // The authoritative <view> never moves for grouping. The scope is the
  // immediate sibling array containing <view> (or its carrier).
  const siblings = carrier?.children ?? tree.children;
  return { view, carrier: null, parentOfCarrier: carrier, siblings };

}

export function groupKeyFromCarrier(tree: FctQueryTree): string {
  const scope = findGroupCarrier(tree);
  const selected = scope?.siblings.find((node) =>
    (node.name === "property" || node.name === "property-of") && node.attributes.group === "true");
  if (!selected?.attributes.iri) return "";
  return `${selected.name === "property-of" ? "reverse" : "forward"}:${selected.attributes.iri}`;
}

/** Grouping is a sibling relationship marker, never a relocated <view>. */
export function withoutFctGrouping(tree: FctQueryTree): FctQueryTree {
  return cloneFctQueryTree(tree, "data");
}

/** Set exactly one group marker in the focus scope. Null disables grouping.
 * The existing view node and all breadcrumb IDs stay in place.
 */
export function markFctGroup(tree: FctQueryTree, target: { id?: string; name: "property" | "property-of"; iri: string } | null): FctQueryTree {
  const scope = findGroupCarrier(tree);
  if (!scope) return tree;
  const focusParentId = scope.parentOfCarrier?.id ?? null;
  let found = false;
  const rewrite = (nodes: FctQueryNode[], parentId: string | null): FctQueryNode[] => {
    if (parentId === focusParentId) {
      const updated = nodes.map((node) => {
        const attributes = { ...node.attributes };
        delete attributes.group;
        if (target && (node.name === target.name) && (node.id === target.id || (!target.id && attributes.iri === target.iri))) {
          attributes.group = "true";
          found = true;
        }
        return { ...node, attributes };
      });
      if (target && !found) {
        updated.push({ id: target.id || groupSyntheticId(target.iri, target.name === "property" ? "forward" : "reverse"),
          name: target.name, attributes: { iri: target.iri, group: "true" }, children: [] });
      }
      return updated;
    }
    return nodes.map((node) => ({ ...node, children: rewrite(node.children, node.id) }));
  };
  return { ...tree, children: rewrite(tree.children, null) };
}

export function moveFctView(tree: FctQueryTree, targetId: string | null, attributes: Record<string, string>,
  synthetic?: { id: string; name: "property" | "property-of"; iri: string; parentId: string | null },
): FctQueryTree {
  const current = findGroupCarrier(tree);
  if (!current) return tree;
  const moved: FctQueryNode = { ...current.view, attributes, children: [] };
  const withoutView = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap((node) =>
    isView(node) ? [] : [{ ...node, children: withoutView(node.children) }]);
  let children = withoutView(tree.children);
  if (synthetic) {
    const append = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map((node) =>
      node.id === synthetic.parentId
        ? { ...node, children: [...node.children, { id: synthetic.id, name: synthetic.name, attributes: { iri: synthetic.iri }, children: [] }] }
        : { ...node, children: append(node.children) });
    if (synthetic.parentId) children = append(children);
    else children = [...children, { id: synthetic.id, name: synthetic.name, attributes: { iri: synthetic.iri }, children: [] }];
  }
  if (!targetId) return { ...tree, children: [...children, moved] };
  let attached = false;
  const attach = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map((node) => {
    if (node.id === targetId && (node.name === "property" || node.name === "property-of")) {
      attached = true;
      return { ...node, children: [...node.children, moved] };
    }
    return { ...node, children: attach(node.children) };
  });
  const result = attach(children);
  return attached ? { ...tree, children: result } : tree;
}

/** Member and facet requests must return the original focus resources. */
export function ungroupForMembers(tree: FctQueryTree): FctQueryTree {
  const clean = withoutFctGrouping(tree);
  const stripView = (node: FctQueryNode): FctQueryNode => {
    const attributes = { ...node.attributes };
    if (node.name === "view") {
      delete attributes.by;
      delete attributes.bucket;
      delete attributes.lexical;
      delete attributes.previousType;
      delete attributes.previousLimit;
      delete attributes.previousOffset;
    }
    return { ...node, attributes, children: node.children.map(stripView) };
  };
  return { ...clean, children: clean.children.map(stripView) };
}

export function groupSyntheticId(uri: string, direction: "forward" | "reverse"): string {
  return `${GROUP_PREFIX}${direction}-${encodeURIComponent(uri)}`;
}
