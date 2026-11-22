/** Schema-aware FCT node-reference validation. No SPARQL execution or URI
 * dereferencing: references are stable XML node IDs in the SAME query. */
export type ReferenceNode = {
  name: string;
  id?: string;
  attributes: Record<string, string>;
  text?: string;
  children: ReferenceNode[];
};
export type ValueReference = {
  valueId: string;
  sourceId: string;
  targetId: string;
  kind: "from" | "fromView";
};

const nodeId = (node: ReferenceNode): string => node.attributes.id || node.id || "";
const isRelationship = (node: ReferenceNode) => node.name === "property" || node.name === "property-of";

export function inspectFctValueReferences<T extends ReferenceNode>(root: T): {
  byId: Map<string, ReferenceNode>;
  references: ValueReference[];
  referencedSubjects: Map<string, string>;
} {
  const byId = new Map<string, ReferenceNode>();
  const references: ValueReference[] = [];
  const visit = (node: ReferenceNode, parent: ReferenceNode | null): void => {
    const id = nodeId(node);
    if (id) {
      if (byId.has(id)) throw new Error(`Malformed FCT Query: duplicate node ID "${id}".`);
      byId.set(id, node);
    }
    const from = node.attributes.from;
    const fromView = node.attributes.fromView;
    if (node.name === "value" && (from !== undefined || fromView !== undefined)) {
      if (from !== undefined && fromView !== undefined)
        throw new Error("Malformed FCT Query: a <value> cannot use both from and fromView.");
      const kind = from !== undefined ? "from" : "fromView";
      const targetId = (from ?? fromView ?? "").trim();
      if (!targetId || !id || !parent || (!isRelationship(parent) && parent.name !== "query"))
        throw new Error("Malformed FCT Query: referenced <value> needs a valid ID and relationship/root scope.");
      if ((node.text ?? "").trim() || node.attributes.rangeStart !== undefined || node.attributes.rangeEnd !== undefined ||
          node.attributes.datatype !== undefined || node.attributes["xml:lang"] !== undefined ||
          (node.attributes.op !== undefined && !["=", "eq"].includes(node.attributes.op)))
        throw new Error(`Malformed FCT Query: referenced <value id="${id}"> cannot also specify a constant, range, datatype, language, or non-equality operator.`);
      references.push({valueId:id, sourceId:nodeId(parent), targetId, kind});
    }
    for (const child of node.children) visit(child, node);
  };
  visit(root, null);
  for (const reference of references) {
    const target = byId.get(reference.targetId);
    if (!target || !(target.name === "query" || isRelationship(target)))
      throw new Error(`Malformed FCT Query: ${reference.kind} references missing or unsupported node ID "${reference.targetId}".`);
    if (target.attributes.exclude === "yes" || target.attributes.exclude === "true")
      throw new Error(`Malformed FCT Query: ${reference.kind} cannot refer to an excluded relationship.`);
  }
  // fromView dependencies describe a directed graph between the scope of the
  // referencing value and the referenced view carrier. Detect A -> B -> A
  // BEFORE attempting to expand either population's SPARQL.
  const edges = new Map<string, string[]>();
  for (const ref of references.filter(ref => ref.kind === "fromView"))
    edges.set(ref.sourceId, [...(edges.get(ref.sourceId) ?? []), ref.targetId]);
  const visiting = new Set<string>(), visited = new Set<string>();
  const dfs = (id:string): void => {
    if (visiting.has(id)) throw new Error(`Malformed FCT Query: cyclic fromView references involving node "${id}".`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of edges.get(id) ?? []) dfs(target);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) dfs(id);
  const referencedSubjects = new Map<string, string>();
  for (const ref of references.filter(ref => ref.kind === "from"))
    if (!referencedSubjects.has(ref.targetId)) referencedSubjects.set(ref.targetId, `maestroRefSubject${referencedSubjects.size + 1}`);
  return {byId, references, referencedSubjects};
}

/** XPath-equivalent dependency lookup over the existing FCT tree; no history
 * or duplicate reference schema. A deletion is blocked only for references
 * outside the removed subtree, as internal references disappear together. */
export function dependentFctValueReferences<T extends ReferenceNode>(root: T, removeId: string): ValueReference[] {
  const {byId, references} = inspectFctValueReferences(root);
  const removed = byId.get(removeId);
  if (!removed) return [];
  const ids = new Set<string>();
  const gather = (node: ReferenceNode): void => {
    ids.add(nodeId(node));
    for (const child of node.children) gather(child);
  };
  gather(removed);
  return references.filter(ref => ids.has(ref.targetId) && !ids.has(ref.valueId));
}
