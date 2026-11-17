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

function offset(value: string | undefined): number {
  const n = Number(value);
  return nextLetterLeadingFctCounter(value !== undefined && Number.isSafeInteger(n) && n >= 10 ? n : 10);
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
    let candidate: string;
    do {
      counter = nextLetterLeadingFctCounter(counter);
      candidate = counter.toString(36);
      counter = nextLetterLeadingFctCounter(counter + 1);
    } while (reserved.has(candidate) || used.has(candidate));
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
  return { ...tree, attributes: { ...tree.attributes, id: rootId, ctr: String(counter), uctr: /^[0-9a-z]+$/.test(tree.attributes.uctr ?? "") && parseInt(tree.attributes.uctr, 36) >= 10 ? tree.attributes.uctr : "a" }, children };
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
  do {
    counter = nextLetterLeadingFctCounter(counter);
    id = counter.toString(36);
    counter = nextLetterLeadingFctCounter(counter + 1);
  } while (ids.has(id));
  return { id, ctr: String(counter) };
}
