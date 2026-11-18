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
 * 2. For a selected blank node, reuse an existing exact URI binding from the
 *    live FCT property path as an anchor when available. No URI is guessed
 *    from badges, labels, or sample projections.
 * 3. Recompile the same FCT path as a list-values query. The SPARQL Record
 *    builder binds the blank-node focus within ONE SPARQL response and gathers
 *    outgoing Properties/incoming Roles in that same response; bnode labels
 *    never cross request boundaries as purported stable identifiers.
 * 4. If the path is not URI-anchored, use its existing Results scope/page as
 *    a set of candidates and require explicit user choice. Never silently
 *    select a first match or claim cross-request identity.
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
 * paths retain the original page, but candidate choice is explicitly needed
 * even if that page returns only one blank node. No URI or label is invented.
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
export type BlankNodeRecord = { id: string; rows: RecordValueTerm[]; xml: string };
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
  graphs: readonly string[];
  preferredLanguage: string;
  limit: number;
};

/**
 * Compose the URI-anchored FCT-derived Record SELECT with outgoing Properties
 * and incoming Roles. All three branches share ?node from ONE SPARQL request.
 * The caller validates its FCT query/IRI inputs before invoking this builder.
 */
export function buildBlankNodeRecordSparql({
  compiledSelect, graphs, preferredLanguage, limit,
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
  return `${preamble}SELECT ?node ?direction ?predicate ?object WHERE {
        { ${innerSelect} }
        BIND(?c1 AS ?node)
        FILTER(isBlank(?node))
        OPTIONAL {
          {
            ${outgoingPattern}
            FILTER(${languageFilter})
            BIND("property" AS ?direction)
          }
          UNION
          {
            ${incomingPattern}
            BIND("property-of" AS ?direction)
          }
        }
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
export function parseBlankNodeRecordBindings(
  bindings: readonly BNodeRecordBinding[], incomplete: boolean,
): BlankNodeRecord[] {
  const siblings = new Map<string, { rows: RecordValueTerm[]; triples: string[] }>();
  for (const binding of bindings) {
    const { node, predicate, object } = binding;
    if (!node || node.type !== "bnode" || !node.value) continue;
    const id = blankNodeDisplayLabel(node.value);
    const group = siblings.get(id) ?? { rows: [], triples: [] };
    if (!predicate?.value || !object) { siblings.set(id, group); continue; }
    const direction: RecordValueTerm["direction"] = binding.direction?.value === "property-of" ? "property-of" : "property";
    const termType: RdfTermKind = object.type === "uri" ? "uri" : object.type === "bnode" ? "bnode" : "literal";
    const value = termType === "bnode" ? blankNodeDisplayLabel(object.value) : object.value;
    group.rows.push({ property: predicate.value, value, direction, termType,
      ...(object.datatype ? { datatype: object.datatype } : {}),
      ...(object["xml:lang"] ? { lang: object["xml:lang"] } : {}) });
    const attrs = ` termType="${termType}"${object.datatype ? ` datatype="${xmlEscape(object.datatype)}"` : ""}${object["xml:lang"] ? ` xml:lang="${xmlEscape(object["xml:lang"])}"` : ""}`;
    group.triples.push(`<fct:row direction="${direction}"><fct:column termType="bnode">${xmlEscape(id)}</fct:column><fct:column termType="uri">${xmlEscape(predicate.value)}</fct:column><fct:column${attrs}>${xmlEscape(value)}</fct:column></fct:row>`);
    siblings.set(id, group);
  }
  const ns = "http://openlinksw.com/services/facets/1.0/";
  return Array.from(siblings, ([id, group]) => ({
    id,
    rows: [...new Map(group.rows.map((row) => [
      [row.direction, row.property, row.value, row.termType, row.datatype ?? "", row.lang ?? ""].join("\u0000"), row,
    ])).values()],
    xml: `<fct:facets xmlns:fct="${ns}"><fct:complete>${incomplete ? "no" : "yes"}</fct:complete><fct:result type="describe">${group.triples.join("")}</fct:result></fct:facets>`,
  }));
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
