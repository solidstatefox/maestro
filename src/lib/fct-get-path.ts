/** One parent-indexed FCT path resolver for the query tree and XML compiler.
 * Node identity is an FCT query ID, never a positional SPARQL alias.
 * Index once, then follow parents from the referenced node to the focus.
 */
export type FctPathNode<T> = { children: T[]; name?: string; id?: string; attributes: Record<string, string> };
export type FctPathHop = { id: string; iri: string; direction: "forward" | "reverse" };
export type FctPathIndex<T extends FctPathNode<T>> = {
  byId: Map<string, T>;
  parents: Map<T, T | null>;
};
export function indexFctPaths<T extends FctPathNode<T>>(root: T): FctPathIndex<T> {
  const byId = new Map<string, T>();
  const parents = new Map<T, T | null>();
  const visit = (node: T, parent: T | null) => {
    if (parents.has(node)) throw new Error("FCT query graph is not a tree.");
    parents.set(node, parent);
    const id = node.id || node.attributes.id;
    if (id) {
      if (byId.has(id)) throw new Error(`Duplicate FCT query-tree ID: ${id}`);
      byId.set(id, node);
    }
    for (const child of node.children) visit(child, node);
  };
  visit(root, null);
  return { byId, parents };
}
/** Resolve href by walking *up* from its target to its focus (O(depth)).
 * The returned path is focus-to-target and includes per-hop direction.
 */
export function getPath<T extends FctPathNode<T>>(
  index: FctPathIndex<T>, focus: T, href: string,
): { target: T; path: FctPathHop[] } | null {
  const target = index.byId.get(href);
  if (!target) return null;
  const reversed: FctPathHop[] = [];
  let node: T | null | undefined = target;
  while (node && node !== focus) {
    if (node.name !== "property" && node.name !== "property-of") return null;
    const iri = node.attributes.iri ?? "";
    if (!iri) return null;
    reversed.push({ id: node.id || node.attributes.id || "", iri,
      direction: node.name === "property" ? "forward" : "reverse" });
    node = index.parents.get(node);
  }
  return node === focus && reversed.length ? { target, path: reversed.reverse() } : null;
}
