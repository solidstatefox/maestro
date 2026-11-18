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

/** Jump past numeric-leading base-36 blocks using the highest positional digit.
 * A modulo test fails for values such as 46 (1a); no candidate-by-candidate loop. */
export function nextLetterLeadingFctCounter(n: number): number {
  if (!Number.isSafeInteger(n) || n < 10) throw new RangeError("Invalid FCT ID counter.");
  let p = 36 ** Math.floor(Math.log(n) / Math.log(36)); if (p > n) p /= 36; else if (n >= 36 * p) p *= 36;
  const next = n < 10 * p ? 10 * p : n; if (!Number.isSafeInteger(next)) throw new RangeError("FCT ID counter exhausted the safe integer range."); return next;
}

/** A canonical base-36 FCT ID must begin with a letter (a-z). The initial
 * digit is checked arithmetically, not by looking at the final digit. */
export function isValidFctNodeId(id: string | undefined): id is string {
  if (!id || !/^[0-9a-z]+$/.test(id)) return false;
  const n = Number.parseInt(id, 36);
  return Number.isSafeInteger(n) && n >= 10 && n.toString(36) === id && nextLetterLeadingFctCounter(n) === n;
}

/** All FCT-generated identifiers share one allocator. Counter *storage* remains
 * compatible: ctr is decimal, uctr/rctr are base-36 next-to-allocate offsets. */
export type FctCounterEncoding = "decimal" | "base36";
export function parseFctIdCounter(value: string | undefined, encoding: FctCounterEncoding): number {
  if (!value || !(encoding === "decimal" ? /^\d+$/ : /^[0-9a-z]+$/).test(value)) return 10;
  const n = Number.parseInt(value, encoding === "decimal" ? 10 : 36);
  return Number.isSafeInteger(n) && n >= 10 ? nextLetterLeadingFctCounter(n) : 10;
}
export function serializeFctIdCounter(n: number, encoding: FctCounterEncoding): string {
  return nextLetterLeadingFctCounter(n).toString(encoding === "decimal" ? 10 : 36);
}
export function allocateLetterLeadingFctId(
  counter: string | undefined, encoding: FctCounterEncoding,
  reserved: ReadonlySet<string> = new Set(),
): { id: string; counter: string } {
  let next = parseFctIdCounter(counter, encoding);
  let id: string;
  do { id = next.toString(36); next = nextLetterLeadingFctCounter(next + 1); }
  while (reserved.has(id));
  return { id, counter: serializeFctIdCounter(next, encoding) };
}

function offset(value: string | undefined): number {
  return parseFctIdCounter(value, "decimal");
}

/** XML @id is a base-36 numeral allocated from the monotonic ctr (decimal).
 * Old descriptive identifiers become ephemeral UI lookup keys, not XML IDs.
 */
export function ensureFctQueryIds<T extends IdentifiedQueryNode>(tree: IdentifiedQueryTree<T>): IdentifiedQueryTree<T> {
  const compact = isValidFctNodeId;
  const reserved = new Set<string>();
  let highestId = 9;
  const reserve = (id: string | undefined) => {
    if (compact(id)) { reserved.add(id); highestId = Math.max(highestId, Number.parseInt(id, 36)); }
  };
  const collect = (node: T): void => {
    reserve(node.id || node.attributes.id);
    node.children.forEach(child => collect(child as T));
  };
  reserve(tree.attributes.id);
  tree.children.forEach(collect);
  let counter = nextLetterLeadingFctCounter(Math.max(offset(tree.attributes.ctr), highestId + 1));
  const used = new Set<string>();
  const allocate = (): string => {
    const allocated = allocateLetterLeadingFctId(String(counter), "decimal", new Set([...reserved, ...used]));
    counter = parseFctIdCounter(allocated.counter, "decimal");
    used.add(allocated.id);
    return allocated.id;
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

  // A UID identifies a shared OR group (several nodes may carry the same UID),
  // while an RID identifies one relationship occurrence. Both are independent
  // of @id and share its letter-leading base-36 allocation policy.
  const groupMapping = new Map<string, string>();
  const allGroupIds = new Set<string>();
  const allRids = new Set<string>();
  let nextGroup = parseFctIdCounter(tree.attributes.uctr, "base36");
  let nextRelation = parseFctIdCounter(tree.attributes.rctr, "base36");
  const reserveExisting = (nodes: T[]): void => {
    for (const node of nodes) {
      if (isValidFctNodeId(node.attributes.uid)) {
        allGroupIds.add(node.attributes.uid);
        nextGroup = Math.max(nextGroup, Number.parseInt(node.attributes.uid, 36) + 1);
      }
      if ((node.name === "property" || node.name === "property-of") && isValidFctNodeId(node.attributes.rid)) {
        allRids.add(node.attributes.rid);
        nextRelation = Math.max(nextRelation, Number.parseInt(node.attributes.rid, 36) + 1);
      }
      reserveExisting(node.children as T[]);
    }
  };
  reserveExisting(children);
  nextGroup = nextLetterLeadingFctCounter(nextGroup);
  nextRelation = nextLetterLeadingFctCounter(nextRelation);
  const assignedRids = new Set<string>();
  const ensureRelations = (nodes: T[]): T[] => nodes.map((node) => {
    const attributes = { ...node.attributes };
    if (node.name === "property" || node.name === "property-of") {
      if (!isValidFctNodeId(attributes.rid) || assignedRids.has(attributes.rid)) {
        const next = allocateLetterLeadingFctId(serializeFctIdCounter(nextRelation, "base36"), "base36", new Set([...allRids, ...assignedRids]));
        attributes.rid = next.id;
        nextRelation = parseFctIdCounter(next.counter, "base36");
      }
      assignedRids.add(attributes.rid);
    }
    // Numeric-leading legacy group identities are migrated *as groups*, not
    // separately per member; preserve valid existing group IDs unchanged.
    if (attributes.uid && !isValidFctNodeId(attributes.uid)) {
      const legacy = attributes.uid;
      if (!groupMapping.has(legacy)) {
        const next = allocateLetterLeadingFctId(serializeFctIdCounter(nextGroup, "base36"), "base36", allGroupIds);
        groupMapping.set(legacy, next.id);
        allGroupIds.add(next.id);
        nextGroup = parseFctIdCounter(next.counter, "base36");
      }
      attributes.uid = groupMapping.get(legacy)!;
    }
    return { ...node, attributes, children: ensureRelations(node.children as T[]) };
  });
  const relatedChildren = ensureRelations(children);
  return { ...tree, attributes: { ...tree.attributes, id: rootId,
    ctr: String(counter), uctr: serializeFctIdCounter(nextGroup, "base36"),
    rctr: serializeFctIdCounter(nextRelation, "base36") }, children: relatedChildren };
}

/** Allocate a compact ID when building a new FCT node. Returns a new tree
 * so callers can commit it through the existing subscriber pipeline. */
export function nextFctQueryId<T extends IdentifiedQueryNode>(tree: IdentifiedQueryTree<T>): { id: string; ctr: string } {
  const normalized = ensureFctQueryIds(tree);
  const ids = new Set<string>([normalized.attributes.id]);
  const visit = (node: T): void => { ids.add(node.id); node.children.forEach(child => visit(child as T)); };
  normalized.children.forEach(visit);
  const allocated = allocateLetterLeadingFctId(normalized.attributes.ctr, "decimal", ids);
  return { id: allocated.id, ctr: allocated.counter };
}
