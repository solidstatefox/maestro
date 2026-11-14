"use client";

import { fctQueryTreeApi, type FctQueryTree, type FctQueryNode } from "./fct-query-api";

export type RecordTrailEdge = { predicate: string; direction: "property" | "property-of" };
export type WandedRecordEdge = { recordIndex: number; predicate: string; direction: "property" | "property-of" };

/** Build a detached query through Maestro's public query API. Never mutate a live tree. */
export function buildWandQuery(source: FctQueryTree, trail: readonly RecordTrailEdge[], marked: readonly WandedRecordEdge[]): FctQueryTree {
  let draft = fctQueryTreeApi.resetQuery(fctQueryTreeApi.getDataTree(source));
  // A wand query always starts with an empty text search, independent of the original search.
  draft = fctQueryTreeApi.setSearchText(draft, "");
  const relationshipName = (direction: RecordTrailEdge["direction"]) => direction === "property" ? "property" : "property-of";
  // Relationship paths are assembled as a union tree: the same ancestor is reused.
  const attach = (path: readonly RecordTrailEdge[]) => {
    let parentId: string | null = null;
    for (const edge of path) {
      const siblings: FctQueryNode[] = parentId
        ? (locate(draft.children, parentId)?.children ?? []) : draft.children;
      const old = siblings.find((node) => node.name === relationshipName(edge.direction) && node.attributes.iri === edge.predicate);
      if (old) { parentId = old.id; continue; }
      const id = allocateId(draft);
      draft = fctQueryTreeApi.insertNode(draft, parentId, {
        id, name: relationshipName(edge.direction), attributes: { iri: edge.predicate }, children: [],
      });
      parentId = id;
    }
  };
  for (const item of marked) {
    if (item.recordIndex < 0 || item.recordIndex > trail.length) continue;
    attach([...trail.slice(0, item.recordIndex), { predicate: item.predicate, direction: item.direction }]);
  }
  return draft;
}

function locate(nodes: FctQueryNode[], id: string): FctQueryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = locate(node.children, id);
    if (child) return child;
  }
  return null;
}
function allocateId(tree: FctQueryTree): string {
  const reserved = new Set<string>();
  const visit = (nodes: FctQueryNode[]) => nodes.forEach(node => { reserved.add(node.id); visit(node.children); });
  visit(tree.children);
  let n = Math.max(10, Number.parseInt(tree.attributes.ctr || "10", 10) || 10);
  while (reserved.has(n.toString(36))) n++;
  return n.toString(36);
}

export type RecordValueKind = "web-url" | "string" | "numeric" | "date" | "email" | "phone";
export const RECORD_VALUE_KINDS: readonly RecordValueKind[] = ["web-url", "string", "numeric", "date", "email", "phone"];
export function classifyRecordValue(value: string, termType: string, datatype?: string): RecordValueKind {
  if (termType === "uri" && /^https?:\/\//i.test(value)) return "web-url";
  const dt = (datatype || "").toLowerCase();
  if (/(?:integer|decimal|double|float|long|short|int|nonnegativeinteger|positiveinteger|byte|unsigned)/.test(dt) || (termType !== "uri" && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value))) return "numeric";
  if (/(?:date|time|gyear)/.test(dt) || /^\d{4}-\d\d-\d\d(?:t|$)/i.test(value)) return "date";
  if (/^(?:mailto:)?[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) return "email";
  if (/^(?:tel:)?\+?[\d().\s-]{7,}$/.test(value) && /\d/.test(value)) return "phone";
  return "string";
}
