import { MAESTRO_KIND_IDS, classifyMaestroKind, type MaestroKind } from "./maestro-kinds";
import { nextFctQueryId } from "./fct-node-identity";


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
  return nextFctQueryId(tree).id;
}

export type RecordValueKind = MaestroKind;
export const RECORD_VALUE_KINDS: readonly RecordValueKind[] = MAESTRO_KIND_IDS;
export function classifyRecordValue(value:string,termType:string,datatype?:string):RecordValueKind {
  return classifyMaestroKind(value,termType,datatype);
}
