/**
 * MAESTRO BLANK-NODE API — FCT-DERIVED RECORD IDENTITY
 * ===================================================
 *
 * This module is the application-programming interface shared by Results,
 * Records, FCT/SPARQL execution, SHACL, and RDF import. It is NOT an HTTP API.
 * DOM/FCT XML editing is in `bnode/dom.ts`; this module remains usable in both
 * browser and server code. Do not reimplement these rules at call sites.
 *
 * WHY AN FCT IDENTITY IS NECESSARY
 * -------------------------------
 * SPARQL returns blank nodes with labels such as `_:b17`, but that label has
 * identity only within the response/dataset's blank-node scope. A later
 * request must NOT bind `_:b17` expecting the same RDF resource. In Maestro,
 * a blank-node Record is reconstructed by re-evaluating the FCT path that
 * produced the Result, anchored at a *URI* bound in that same Results query.
 *
 * THE RESULT-TO-RECORD CONTRACT
 * -----------------------------
 * 1. The ordinary Results pipeline already decodes each term's RDF kind.
 *    Only a selected term with kind "bnode" activates the XState Record gate.
 *    There is NO population preflight, extra SELECT, or ancestry projection
 *    added to normal URI/literal FCT queries.
 * 2. Use a known immediate URI parent when available from the live FCT path
 *    or the selected original Result row. Never treat a distant ancestor,
 *    a later enrichment response, or a blank-node label as that parent.
 * 3. Recompile the FCT path as a bounded seed window. The inverse focus edge
 *    identifies actual immediate parents without expanding sibling groups.
 *    Outgoing Properties and incoming Roles share the same response identity.
 * 4. Restore the original automatic Record presentation: prefer a matching
 *    label, otherwise open the first reconstructed node. This is not proof
 *    of cross-request identity. Show only same-response sibling tabs.
 * 5. XState guards begin, candidate receipt, and selection; query identity,
 *    cancellation, and Record session isolation use the existing workflows.
 *
 * RDF DIRECTION IS NOT THE SAME AS RECORD IDENTITY
 * ------------------------------------------------
 * Forward: `:curator mui:widget _:head` makes `_:head` the object of a
 * <property iri="mui:widget"> and `:curator` its URI ancestor. The b-node
 * still acts as the subject when showing its outgoing Properties; the curator
 * appears among its incoming Roles.
 * Reverse: `_:node :pointsTo :parent` can be reached through
 * <property-of iri=":pointsTo">. Here the b-node is the subject of the
 * identifying triple, and the URI is its object. Both FCT directions must
 * reconstruct an equivalent structural path without altering its meaning.
 *
 * NESTED EXAMPLE
 * --------------
 * `:owner :outer _:middle . _:middle :inner _:leaf .`
 * For <property iri=":outer"><property iri=":inner"><view/></property>
 * </property>, the immediate parent of `_:leaf` is another b-node. Select
 * `:owner` (depth 0) as the stable URI anchor when it is already explicitly
 * bound in the FCT query, then re-run both steps. A URI at an intermediate
 * scope can instead be used at its own depth.
 *
 * IMPORTANT LIMITS AND NON-GUARANTEES
 * -----------------------------------
 * A URI anchor plus path may match multiple sibling blank nodes; it is a
 * reproducible *selection*, not necessarily a globally unique b-node ID.
 * Maestro groups candidate nodes returned in ONE response and does not
 * claim that their local labels survive later queries. Unanchored Results
 * paths retain the original page. The automatic choice is best-effort; the
 * Record header identifies the actual returned node. No URI is invented.
 *
 * DISTINCT FROM RDF SOURCE EXPANSION
 * ----------------------------------
 * `describe expand="bnodes"` traverses a bounded RDF subgraph for source
 * inspection (e.g., RDF lists and SHACL structures); it is not the identity
 * algorithm for opening an individual blank-node Record.
 */
export type RdfTermKind = "uri" | "literal" | "bnode";
/** An ancestor URI on the structural FCT property path. Depth zero is the query root. */
export type BNodeRecordAnchor = {
  parent: string;
  predicate: string;
  direction?: "forward" | "reverse";
  depth?: number;
};
export type RecordValueTerm = {
  property: string;
  value: string;
  direction: "property" | "property-of";
  termType: RdfTermKind;
  datatype?: string;
  lang?: string;
};
export type BlankNodeRecord = { id: string; rows: RecordValueTerm[]; parents: string[]; candidate: boolean };
/** Parent keys are meaningful only within this exact response. Graph-scoped
 * edges also carry the graph IRI. Never merge distinct parent groups. */
// Response arrays are immutable after parsing. Weak ownership permits collection
// when the Record session releases its response; no durable bnode cache.
const EMPTY_BNODE_INDICES: number[] = [];
const responseIndexes = new WeakMap<readonly BlankNodeRecord[], { candidates: number[]; parents: Map<string, number[]> }>();
function blankNodeResponseIndex(records: readonly BlankNodeRecord[]) {
  const existing = responseIndexes.get(records);
  if (existing) return existing;
  const candidates: number[] = [], parents = new Map<string, number[]>();
  records.forEach((record, index) => {
    if (record.candidate) candidates.push(index);
    for (const parent of record.parents) {
      let indices = parents.get(parent);
      if (!indices) { indices = []; parents.set(parent, indices); }
      indices.push(index);
    }
  });
  const result = { candidates, parents };
  responseIndexes.set(records, result);
  return result;
}
export function blankNodeCandidateIndices(records: readonly BlankNodeRecord[]): number[] {
  return blankNodeResponseIndex(records).candidates;
}
export function blankNodeSiblingIndices(records: readonly BlankNodeRecord[], parent: string): number[] {
  return parent ? blankNodeResponseIndex(records).parents.get(parent) ?? EMPTY_BNODE_INDICES : EMPTY_BNODE_INDICES;
}
/** Restore the original automatic Record selection. A label comparison is
 * a presentation preference, never proof of identity across responses. Only
 * membership from this exact response determines the sibling tab population.
 * Do not include unrelated reconstructed nodes as siblings. */
export function initialBlankNodeFamily(records: readonly BlankNodeRecord[], requestedLabel: string): {
  records: BlankNodeRecord[]; index: number;
} {
  const label = blankNodeDisplayLabel(requestedLabel);
  const seed = records.find(record => record.candidate && record.id === label) ?? records.find(record => record.candidate);
  if (!seed) return { records: [], index: -1 };
  const parents = new Set(seed.parents);
  const family = records.filter(record => record === seed || record.parents.some(parent => parents.has(parent)));
  return { records: family, index: family.indexOf(seed) };
}
/** Only a URI parent may be carried into a later request. A nonportable
 * parent causes a fresh structural reconstruction and explicit reselection. */
export type BlankNodeExpansion = ({ kind: "uri"; parent: string; graph?: string } | { kind: "reconstruct" }) & { page?: number };
export function blankNodeExpansionForParent(key: string): BlankNodeExpansion {
  const [kind, parent, , , graph] = JSON.parse(key) as string[];
  return kind === "uri" && safeBlankNodeIri(parent) && !isBlankNodeLabel(parent)
    ? { kind: "uri", parent, ...(graph && safeBlankNodeIri(graph) ? { graph } : {}) }
    : { kind: "reconstruct" };
}
function safeBlankNodeIri(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\]+$/.test(value);
}
export function blankNodeParentLabel(key: string): string {
  const [, value, datatype, lang, graph] = JSON.parse(key) as string[];
  return `${value}${lang ? ` @${lang}` : datatype ? ` (${datatype})` : ""}${graph ? ` · ${graph}` : ""}`;
}
export type BNodeScope = {
  queryXml: string;
  graphAddress: string;
  parent?: string;
  predicate?: string;
};

/** Preserve the precise URI/bnode/literal distinction in RDF projections. */
export function rdfBindingKind(type: string | undefined | null): RdfTermKind {
  return type === "uri" || type === "url" ? "uri" : isBlankNodeTerm(type) ? "bnode" : "literal";
}

export function isBlankNodeTerm(type: string | undefined | null): boolean {
  const normalized = type?.toLowerCase();
  return normalized === "bnode" || normalized === "blank-node";
}

export function isBlankNodeLabel(label: string): boolean {
  return /^(?:nodeID:\/\/|_:)/i.test(label);
}

/** Convert only a response-local label to the standard _: display notation. */
export function blankNodeDisplayLabel(label: string): string {
  return label.startsWith("_:") ? label : `_:${label}`;
}

/** Match a structural reverse relationship by predicate. The retired
 * `project` attribute is no longer part of Maestro's FCT grammar. */
export function isStructuralReverseRole(
  node: { localName: string; getAttribute(name: string): string | null }, predicate: string,
): boolean {
  return node.localName === "property-of" &&
    node.getAttribute("iri") === predicate;
}

type ScopeValueLike = {
  property: string;
  direction: "forward" | "reverse";
  values: ReadonlyArray<{ value: string; type?: string }>;
};

/** Recover a URI parent ONLY from a matching structural role in this result. */
export function resolveBlankNodeAnchor(
  termType: string | undefined,
  scopeValues: ReadonlyArray<ScopeValueLike> | undefined,
  focusPredicate?: string,
): BNodeRecordAnchor | null {
  if (!isBlankNodeTerm(termType)) return null;
  const role = scopeValues?.find((scope) => scope.direction === "reverse" &&
    (!focusPredicate || scope.property === focusPredicate) &&
    scope.values.some((value) => value.type === "uri" && Boolean(value.value)));
  const parent = role?.values.find((value) => value.type === "uri" && Boolean(value.value))?.value;
  return parent && role ? { parent, predicate: role.property } : null;
}

/** Restore the old URI-parent shortcut only when an ORIGINAL Result row
 * contains a typed URI on the exact inverse focus edge. Cached/enriched
 * badge values are deliberately not inputs. A valid parent anchors a family,
 * not a unique blank-node identity. No new Results projection is required. */
export function blankNodeParentFromResultColumns(
  columns: readonly { value: string; termType?: string; attributes?: Record<string, string> }[] | undefined,
  focus: { predicate: string; direction: "forward" | "reverse"; depth: number },
): BNodeRecordAnchor | undefined {
  const inverse = focus.direction === "forward" ? "reverse" : "forward";
  const parents = new Set((columns ?? []).filter(column =>
    column.attributes?.property === focus.predicate &&
    (column.attributes?.direction === "reverse" ? "reverse" : "forward") === inverse &&
    column.termType === "uri" && safeBlankNodeIri(column.value) && !isBlankNodeLabel(column.value)
  ).map(column => column.value));
  if (parents.size !== 1) return undefined;
  return { parent: [...parents][0], predicate: focus.predicate, direction: focus.direction, depth: focus.depth };
}

/** The persisted key needs FCT scope; the label is deliberately excluded. */
export function blankNodeContextKey(scope: BNodeScope): string {
  return JSON.stringify([scope.queryXml, scope.graphAddress, scope.parent ?? "", scope.predicate ?? ""]);
}

/** Allocate collision-free, response-local RDF blank-node IDs. */
export function createBlankNodeLabelAllocator(prefix: string): (label: string) => string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(prefix)) throw new Error("Invalid RDF blank-node prefix.");
  const names = new Map<string, string>();
  return (label) => {
    const key = label.startsWith("_:") ? label.slice(2) : label;
    let name = names.get(key);
    if (!name) {
      name = `${prefix}${names.size.toString(36)}`;
      names.set(key, name);
    }
    return name;
  };
}

export type SparqlBlankNodeRecordOptions = {
  compiledSelect: string;
  focusRelationship?: { predicate: string; direction: "forward" | "reverse" };
  graphs: readonly string[];
  immediateParent?: string;
  expansion?: BlankNodeExpansion;
  windowLimit: number;
  preferredLanguage: string;
  limit: number;
};

/**
 * Compose the URI-anchored FCT-derived Record SELECT with outgoing Properties
 * and incoming Roles. All three branches share ?node from ONE SPARQL request.
 * The caller validates its FCT query/IRI inputs before invoking this builder.
 */
export function buildBlankNodeRecordSparql({
  compiledSelect, focusRelationship, graphs, immediateParent, expansion, windowLimit, preferredLanguage, limit,
}: SparqlBlankNodeRecordOptions): string {
  const compiledText = compiledSelect.trim();
  const preambleMatch = compiledText.match(/^((?:(?:DEFINE|PREFIX|BASE)\s+[^\n]*\n)*)/i);
  const preamble = preambleMatch?.[1] ?? "";
  const innerSelect = compiledText.slice(preamble.length).trim();
  if (!/^SELECT\b/i.test(innerSelect)) {
    throw new Error("The FCT list-values compiler did not generate a SELECT query.");
  }
  const graphValues = graphs.length ? `VALUES ?recordGraph { ${graphs.map((graph) => `<${graph}>`).join(" ")} } ` : "";
  const outgoingPattern = graphs.length
    ? `${graphValues}GRAPH ?recordGraph { ?node ?predicate ?object . }`
    : "?node ?predicate ?object .";
  const incomingPattern = graphs.length
    ? `${graphValues}GRAPH ?recordGraph { ?object ?predicate ?node . }`
    : "?object ?predicate ?node .";
  const languageFilter = preferredLanguage === "all"
    ? "true"
    : `!isLiteral(?object) || DATATYPE(?object) != <http://www.w3.org/1999/02/22-rdf-syntax-ns#langString> || LANGMATCHES(LANG(?object), ${JSON.stringify(preferredLanguage)})`;
  const edge = focusRelationship && safeBlankNodeIri(focusRelationship.predicate) ? focusRelationship : undefined;
  if (immediateParent && (!edge || !safeBlankNodeIri(immediateParent) || isBlankNodeLabel(immediateParent))) {
    throw new Error("Invalid immediate blank-node parent binding.");
  }
  if (expansion && !edge) throw new Error("Sibling exploration requires a focus relationship.");
  if (expansion?.kind === "uri" && (!safeBlankNodeIri(expansion.parent) || isBlankNodeLabel(expansion.parent) ||
    (expansion.graph && !safeBlankNodeIri(expansion.graph)))) throw new Error("Invalid sibling parent binding.");
  if (!Number.isSafeInteger(windowLimit) || windowLimit < 1 ||
      !Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid blank-node response bounds.");
  const page = expansion?.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000 || !Number.isSafeInteger(page * windowLimit)) throw new Error("Invalid sibling window page.");
  if (graphs.some(graph => !safeBlankNodeIri(graph))) throw new Error("Invalid blank-node graph scope.");
  const p = edge ? `<${edge.predicate}>` : "";
  const relation = (child: string) => edge?.direction === "forward" ? `?parent ${p} ${child} .` : `${child} ${p} ?parent .`;
  const parentGraphs = expansion?.kind === "uri" && expansion.graph ? [expansion.graph] : graphs;
  const scoped = (pattern: string) => parentGraphs.length
    ? `VALUES ?parentGraph { ${parentGraphs.map(graph => `<${graph}>`).join(" ")} } GRAPH ?parentGraph { ${pattern} }`
    : pattern;
  const boundParent = expansion?.kind === "uri" ? expansion.parent : immediateParent;
  const parentValues = boundParent ? `VALUES ?parent { <${boundParent}> } ` : "";
  const seed = `{ ${innerSelect} } BIND(?c1 AS ?node) FILTER(isBlank(?node))`;
  // Initial candidate request only identifies parents. A UNION branch keeps
  // membership rows separate from description rows (no parent × triple join).
  // Descriptions remain in the same response as the candidate IDs because
  // SPARQL supplies no portable identity for a later individual-node fetch.
  const description = `{ ${outgoingPattern} FILTER(${languageFilter}) BIND("property" AS ?direction) }
    UNION { ${incomingPattern} BIND("property-of" AS ?direction) }`;
  let population = seed;
  let branches = description;
  if (!expansion && edge) branches += ` UNION { ${parentValues}${scoped(relation("?node"))} }`;
  if (expansion?.kind === "uri") {
    // Do not re-run the potentially expensive original FCT population for a
    // selected portable immediate parent. Bound the sibling window upstream.
    population = `{ SELECT DISTINCT ?node ?parent ?parentGraph WHERE {
      ${parentValues}${scoped(relation("?node"))} FILTER(isBlank(?node))
    } LIMIT ${windowLimit} OFFSET ${page * windowLimit} }`;
  } else if (expansion?.kind === "reconstruct") {
    // A bnode parent cannot be carried across requests. Reconstruct a fresh
    // bounded set of actual parent groups and require a new explicit choice.
    // Limit parent/node pairs BEFORE retrieving any Properties or Roles.
    population = `{ SELECT DISTINCT ?node ?parent ?parentGraph WHERE {
      { SELECT DISTINCT ?parent ?parentGraph WHERE {
        { ${innerSelect} } BIND(?c1 AS ?seed) FILTER(isBlank(?seed))
        ${parentValues}${scoped(relation("?seed"))}
      } LIMIT ${windowLimit} }
      ${scoped(relation("?node"))} FILTER(isBlank(?node))
    } LIMIT ${windowLimit} OFFSET ${page * windowLimit} }`;
  }
  return `${preamble}SELECT ?node ?direction ?predicate ?object ?parent ?parentGraph ?candidate WHERE {
    ${population}
    BIND(1 AS ?candidate)
    OPTIONAL { ${branches} }
  } LIMIT ${limit}`;

}

export type SparqlBinding = {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
};
export type BNodeRecordBinding = {
  node?: SparqlBinding;
  parent?: SparqlBinding;
  parentGraph?: SparqlBinding;
  candidate?: SparqlBinding;
  direction?: SparqlBinding;
  predicate?: SparqlBinding;
  object?: SparqlBinding;
};

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Keep sibling tabs and normalized XML snapshots within the SAME SELECT
 * response. Never run another query using the returned _: labels.
 */
export function parseBlankNodeRecordBindings(bindings: readonly BNodeRecordBinding[]): BlankNodeRecord[] {
  const groups = new Map<string, { rows: Map<string, RecordValueTerm>; parents: Set<string>; candidate: boolean }>();
  for (const binding of bindings) {
    const { node, predicate, object, parent } = binding;
    if (!node || node.type !== "bnode" || !node.value) continue;
    const id = blankNodeDisplayLabel(node.value);
    let group = groups.get(id);
    if (!group) { group = { rows: new Map(), parents: new Set(), candidate: false }; groups.set(id, group); }
    if (binding.candidate?.value === "1") group.candidate = true;
    if (parent) group.parents.add(JSON.stringify([rdfBindingKind(parent.type), parent.type === "bnode" ? blankNodeDisplayLabel(parent.value) : parent.value, parent.datatype ?? "", parent["xml:lang"] ?? "", binding.parentGraph?.value ?? ""]));
    if (!predicate?.value || !object) continue;
    const direction = binding.direction?.value === "property-of" ? "property-of" : "property";
    const termType = rdfBindingKind(object.type);
    const value = termType === "bnode" ? blankNodeDisplayLabel(object.value) : object.value;
    const key = JSON.stringify([direction, predicate.value, termType, value, object.datatype ?? "", object["xml:lang"] ?? ""]);
    if (!group.rows.has(key)) group.rows.set(key, { property: predicate.value, value, direction, termType,
      ...(object.datatype ? { datatype: object.datatype } : {}), ...(object["xml:lang"] ? { lang: object["xml:lang"] } : {}) });
  }
  return Array.from(groups, ([id, group]) => ({ id, parents: [...group.parents], candidate: group.candidate, rows: [...group.rows.values()] }));
}

/** Serialize only the Record explicitly chosen from this exact response. */
export function materializeBlankNodeRecord(record: BlankNodeRecord, incomplete: boolean): string {
  const ns = "http://openlinksw.com/services/facets/1.0/";
  const subject = xmlEscape(record.id);
  const triples = record.rows.map(row => {
    const attrs = ` termType="${row.termType}"${row.datatype ? ` datatype="${xmlEscape(row.datatype)}"` : ""}${row.lang ? ` xml:lang="${xmlEscape(row.lang)}"` : ""}`;
    return `<fct:row direction="${row.direction}"><fct:column termType="bnode">${subject}</fct:column><fct:column termType="uri">${xmlEscape(row.property)}</fct:column><fct:column${attrs}>${xmlEscape(row.value)}</fct:column></fct:row>`;
  });
  return `<fct:facets xmlns:fct="${ns}"><fct:complete>${incomplete ? "no" : "yes"}</fct:complete><fct:result type="describe">${triples.join("")}</fct:result></fct:facets>`;
}


/**
 * FCT describe/@expand="bnodes" is an opt-in, bounded source-document
 * traversal. Ordinary Record DESCRIBE remains unchanged. This is a single
 * SPARQL SELECT, so bnode labels remain meaningful for the entire response.
 */
export const BNODE_DESCRIBE_MAX_TRIPLES = 5000;
export const BNODE_DESCRIBE_MAX_DEPTH = 5;
export const RDF_REST_IRI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";

export function bnodeDescribeBounds(attributes: Record<string, string>): { maxTriples: number; depth: number; incoming: boolean } | null {
  if (!attributes.expand) return null;
  if (attributes.expand !== "bnodes") throw new Error('FCT describe/@expand must be "bnodes".');
  const requestedLimit = Number(attributes.limit ?? BNODE_DESCRIBE_MAX_TRIPLES);
  const depth = Number(attributes.depth ?? 3);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > BNODE_DESCRIBE_MAX_TRIPLES)
    throw new Error(`Expanded FCT describe/@limit must be between 1 and ${BNODE_DESCRIBE_MAX_TRIPLES}.`);
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > BNODE_DESCRIBE_MAX_DEPTH)
    throw new Error(`Expanded FCT describe/@depth must be between 1 and ${BNODE_DESCRIBE_MAX_DEPTH}.`);
  const incoming = attributes.incoming ?? "no";
  if (incoming !== "no" && incoming !== "yes") throw new Error('Expanded FCT describe/@incoming must be "yes" or "no".');
  return { maxTriples: requestedLimit, depth, incoming: incoming === "yes" };
}

// XState is the only authority for activating blank-node Record/ancestry flows.
export * from "./lifecycle";
