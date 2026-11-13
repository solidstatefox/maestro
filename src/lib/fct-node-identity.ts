/** Persistent, document-local identities for Maestro's FCT query tree.
 * `ctr` is the next decimal allocation offset; IDs are written in base 36.
 * The internal FctQueryNode.id is the only authority for its XML @id.
 */
export type IdentifiedQueryNode = {
  id: string;
  /** Legacy UI lookup key, never serialized as XML @id. */
  uiKey?: string;
  name: string;
  attributes: Record<string, string>;
  children: IdentifiedQueryNode[];
  text?: string;
};
export type IdentifiedQueryTree<T extends IdentifiedQueryNode = IdentifiedQueryNode> = {
  name: "query";
  attributes: Record<string, string>;
  children: T[];
};

function offset(value: string | undefined): number {
  const n = Number(value);
  return value !== undefined && Number.isSafeInteger(n) && n >= 10 ? n : 10;
}

/** XML @id is a base-36 numeral allocated from the monotonic ctr (decimal).
 * Old descriptive identifiers become ephemeral UI lookup keys, not XML IDs.
 */
export function ensureFctQueryIds<T extends IdentifiedQueryNode>(tree: IdentifiedQueryTree<T>): IdentifiedQueryTree<T> {
  const compact = (id: string | undefined): id is string =>
    Boolean(id && /^[0-9a-z]+$/.test(id) && parseInt(id, 36) >= 10);
  const reserved = new Set<string>();
  const collect = (node: T): void => {
    const current = node.id || node.attributes.id;
    if (compact(current)) reserved.add(current);
    node.children.forEach(child => collect(child as T));
  };
  if (compact(tree.attributes.id)) reserved.add(tree.attributes.id);
  tree.children.forEach(collect);
  let counter = offset(tree.attributes.ctr);
  const used = new Set<string>();
  const allocate = (): string => {
    let candidate: string;
    do { candidate = (counter++).toString(36); } while (reserved.has(candidate) || used.has(candidate));
    used.add(candidate);
    return candidate;
  };
  const take = (requested?: string): string => {
    if (compact(requested) && !used.has(requested)) {
      used.add(requested);
      return requested;
    }
    return allocate();
  };
  const rootId = take(tree.attributes.id);
  const update = (node: T): T => {
    const original = node.id || node.attributes.id;
    const id = take(original);
    const attributes = { ...node.attributes };
    delete attributes.id;
    const uiKey = node.uiKey || (!compact(original) && original ? original : undefined);
    return { ...node, id, ...(uiKey ? { uiKey } : {}), attributes, children: node.children.map(child => update(child as T)) };
  };
  const children = tree.children.map(update);
  return { ...tree, attributes: { ...tree.attributes, id: rootId, ctr: String(counter) }, children };
}

/** Allocate a compact ID when building a new FCT node. Returns a new tree
 * so callers can commit it through the existing subscriber pipeline. */
export function nextFctQueryId<T extends IdentifiedQueryNode>(tree: IdentifiedQueryTree<T>): { id: string; ctr: string } {
  const normalized = ensureFctQueryIds(tree);
  const ids = new Set<string>([normalized.attributes.id]);
  const visit = (node: T): void => { ids.add(node.id); node.children.forEach(child => visit(child as T)); };
  normalized.children.forEach(visit);
  let counter = offset(normalized.attributes.ctr);
  let id: string;
  do { id = (counter++).toString(36); } while (ids.has(id));
  return { id, ctr: String(counter) };
}
