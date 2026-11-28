import { FCT_VIEW_TYPES, isFctViewType, MAX_PREDICATE_ANALYSIS_CANDIDATES, DEFAULT_PREDICATE_ANALYSIS_CANDIDATES, MAX_PREDICATE_ANALYSIS_INCIDENCE_ROWS, DEFAULT_PREDICATE_ANALYSIS_INCIDENCE_ROWS, type FctViewType, predicateRankAlgorithm, type PredicateRankAlgorithm, predicateSynsetAlgorithm, type PredicateSynsetAlgorithm, parseFctViewTimeout } from "./fct-view-types";
import { isBlankNodeTerm, bnodeDescribeBounds, RDF_REST_IRI } from "./bnode";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizeFctValue } from "./fct-value-policy";
import { NUMERIC_LEXICAL_PATTERN } from "./virtuoso-numeric-coercion";
import { buildVirtuosoFullTextExpression } from "./virtuoso-full-text";
import { ALL_GRAPHS } from "./graph-address-mode";
import { getPath, indexFctPaths, type FctPathHop } from "./fct-get-path";
import { inspectFctValueReferences, type ReferenceNode } from "./fct-value-references";
import { effectiveMaestroLanguage, validMaestroLanguage } from "./maestro-language";

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlNode[];
};

/** Internal compiler pass; never supplied in FCT XML or exposed as another view. */
/** Structural ranking and clustering use the original incidence stream.
 * FUR has independent population, coverage and value-frequency projections.
 * No projection serializes discovered predicate IRIs into VALUES. */
export type PredicateAnalysisStage = { kind: "incidence" | "coverage" | "value-counts"; offset: number; limit: number }
  | { kind: "population" };

export type FctSparqlView = FctViewType;
export type CompiledFctQuery = {
  query: string;
  view: FctSparqlView;
  limit: number;
  offset: number;
  timeoutMs: number;
  maxPredicateCandidates?: number;
  maxPredicateIncidenceRows?: number;
  predicateRankAlgorithm?: PredicateRankAlgorithm;
  predicateSynset?: { algorithm: PredicateSynsetAlgorithm; carrier: string; confidenceN: number; budgetQuery: string; ruleBudgetQuery?: string };
  target: string;
  focusRelationship?: { predicate: string; direction: "forward" | "reverse" };
  graphOnly: boolean;
  countOnly: boolean;
  /** A discovery GRAPH ?g query has a data-binding pattern, not an empty body. */
  graphDiscoveryHasSourcePattern?: boolean;
  /** Scoped personal-status constraints, resolved against session graphs on the server. */
  statusBindings: Array<{ variable: string; uri: string; addr?: string }>;
  /** Unpaginated datatype distribution over exactly the same facet-value scope.
   * Its existence, unlike paginated LIST/LIST_COUNT rows, is SHACL evidence. */
  datatypeEvidenceQuery?: string;
  /** Cheap population-scoped ASK; omit aggregate for resource-only properties. */
  datatypeLiteralProbeQuery?: string;
  /** A literal-focused DESCRIBE projects incoming Roles as SPARQL SELECT triples. */
  describeLiteral?: boolean;
  /** Opt-in bnode closure uses typed SELECT triples in a single response. */
  describeExpanded?: boolean;
  describeMaxTriples?: number;
  badgeColumns?: Array<{ colName: string; property: string; direction: "forward" | "reverse" }>;
  /** XML projection columns identified by query-tree IDs (anchor IDs for multihop). */
  listValueProjections?: Array<{ id: string; property: string; direction: "forward" | "reverse"; path?: string[]; hops?: FctPathHop[]; boundValues?: SparqlBindingTerm[] }>;
  /** Explicit resource page order; merge-values cannot reorder or omit it. */
  resourcePage?: SparqlBindingTerm[];
};

/*
 * Deliberately small SPARQL AST. This is the supported SPARQL subset used by
 * the FCT translator, including Virtuoso's DEFINE, bif:contains and quad-map
 * forms. Query generation must go through serializeSparqlQuery(); compiler
 * code must not assemble SPARQL text fragments itself.
 */
type SparqlTerm =
  | { kind: "variable"; name: string }
  | { kind: "iri"; value: string }
  | { kind: "literal"; value: string; language?: string; datatype?: SparqlTerm }
  | { kind: "raw-term"; value: string };

type SparqlExpression =
  | { kind: "term"; term: SparqlTerm }
  | { kind: "binary"; operator: string; left: SparqlExpression; right: SparqlExpression }
  | { kind: "function"; name: string; args: SparqlExpression[] }
  | { kind: "aggregate"; name: "COUNT" | "SAMPLE" | "MAX"; distinct: boolean; expression: SparqlExpression }
  | { kind: "in"; value: SparqlExpression; options: SparqlTerm[] };

type SparqlPattern =
  | { kind: "triple"; subject: SparqlTerm; predicate: SparqlTerm; object: SparqlTerm; options?: SparqlDirective[] }
  | { kind: "path"; subject: SparqlTerm; predicate: SparqlTerm; modifier: "*"; object: SparqlTerm }
  | { kind: "bind"; expression: SparqlExpression; as: SparqlTerm }
  | { kind: "full-text"; value: SparqlTerm; search: SparqlTerm }
  | { kind: "filter"; expression: SparqlExpression }
  | { kind: "values"; variable: SparqlTerm; values: SparqlTerm[] }
  | { kind: "group"; patterns: SparqlPattern[] }
  | { kind: "union"; branches: SparqlPattern[][] }
  | { kind: "not-exists"; patterns: SparqlPattern[] }
  | { kind: "optional"; patterns: SparqlPattern[] }
  | { kind: "graph"; graph: SparqlTerm; patterns: SparqlPattern[] }
  | { kind: "service"; endpoint: SparqlTerm; patterns: SparqlPattern[] }
  | { kind: "subquery"; query: SparqlSelectQuery }
  | { kind: "quad-map"; map: SparqlTerm; graph: SparqlTerm; patterns: SparqlPattern[] };

type FctValueReferenceResolver = {
  subjects: ReadonlyMap<string, string>;
  rootId: string;
  buildPopulation: (targetId: string, valueId: string, ancestors: ReadonlySet<string> | undefined, member: SparqlTerm) => SparqlSelectQuery;
  ancestors?: ReadonlySet<string>;
};

type SparqlProjection = { expression: SparqlExpression; as?: SparqlTerm };
type SparqlOrder = { expression: SparqlExpression; direction: "ASC" | "DESC" };
type SparqlDirective = { name: "input:inference" | "input:same-as"; value: string };
type SparqlSelectQuery = {
  kind: "select" | "describe" | "ask";
  describe?: SparqlTerm;
  directives: SparqlDirective[];
  distinct?: boolean;
  projections: SparqlProjection[];
  where: SparqlPattern[];
  groupBy?: SparqlExpression[];
  orderBy?: SparqlOrder[];
  limit?: number;
  offset?: number;
};

type SparqlDocument = { kind: "document"; query: SparqlSelectQuery; toString(): string };

class SparqlQueryDocument implements SparqlDocument {
  readonly kind = "document" as const;

  constructor(readonly query: SparqlSelectQuery) {}

  toString(): string {
    return serializeSparqlQuery(this);
  }
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  // Preserve source text here; FCT value normalization is explicit and shared.
  trimValues: false,
});

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";


const variable = (name: string): SparqlTerm => ({ kind: "variable", name: name.replace(/^\?/, "") });
const iriTerm = (value: string): SparqlTerm => ({ kind: "iri", value });
const literalTerm = (value: string, language?: string, datatype?: SparqlTerm): SparqlTerm => ({ kind: "literal", value, ...(language ? { language } : {}), ...(datatype ? { datatype } : {}) });
const termExpr = (term: SparqlTerm): SparqlExpression => ({ kind: "term", term });
const binary = (operator: string, left: SparqlExpression, right: SparqlExpression): SparqlExpression => ({ kind: "binary", operator, left, right });

/** Parse the bounded, read-only expression fragment carried by kindFilter.
 * This grammar is generic: no Kind identifiers, registry or runtime state.
 * Only the reserved operand is substituted; literals and IRIs remain intact.
 * Reject anything outside the expression grammar before serialization. */
export function bindFctFilterExpression(raw:string, operand:string):string {
  const fail=():never=>{throw new Error("Malformed FCT Query: invalid kindFilter expression.");};
  if(raw.length>32768 || !raw.trim())return fail();
  const lexer=/\s*(\?value\b|&&|\|\||!=|!|[(),]|"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"|<[A-Za-z][A-Za-z0-9+.-]*:[^<>"{}|^`\\\s]*>|[A-Za-z][A-Za-z0-9_:]*)/gy;
  const tokens:string[]=[];
  for(let pos=0;pos<raw.length;) {
    if(!raw.slice(pos).trim())break;
    lexer.lastIndex=pos;
    const match=lexer.exec(raw);
    if(!match || tokens.length>=2048)return fail();
    tokens.push(match[1]);pos=lexer.lastIndex;
  }
  let cursor=0, depth=0;
  const take=(expected?:string):string=>{
    const token=tokens[cursor++];
    if(token===undefined || (expected!==undefined && token!==expected))return fail();
    return token;
  };
  const peek=()=>tokens[cursor];
  const functions:Readonly<Record<string,number>>={isIRI:1,isLiteral:1,isBlank:1,isNumeric:1,"bif:isstring":1,STR:1,DATATYPE:1,REGEX:3};
  function primary():string {
    if(++depth>64)return fail();
    const token=take();let result:string;
    if(token==="("){result=`(${expression()})`;take(")");}
    else if(token==="?value")result=operand;
    else if(token.startsWith('"')){
      const value=JSON.parse(token) as string;
      // Canonicalize escapes, so e.g. a Unicode escape cannot introduce
      // syntax when the endpoint parses the generated SPARQL.
      if(/[\x00-\x07\x0b\x0e-\x1f]/.test(value))return fail();
      result=JSON.stringify(value);
    }
    else if(token.startsWith("<"))result=token;
    else if(Object.prototype.hasOwnProperty.call(functions,token)) {
      take("(");const args:string[]=[];
      for(let i=0;i<functions[token];i++){if(i)take(",");args.push(expression());}
      take(")");result=`${token}(${args.join(", ")})`;
    }else return fail();
    --depth;return result;
  }
  function unary():string {
    if(peek()==="!"){take("!");if(++depth>64)return fail();const child=unary();--depth;return `!${child}`;}
    let value=primary();
    if(peek()==="!="){take("!=");value+=` != ${primary()}`;}
    if(peek()==="IN"){
      take("IN");take("(");const items:string[]=[];
      do {const iri=take();if(!iri.startsWith("<"))return fail();items.push(iri);if(peek()!==",")break;take(",");}while(true);
      take(")");value+=` IN (${items.join(", ")})`;
    }
    return value;
  }
  function conjunction():string {let value=unary();while(peek()==="&&"){take();value+=` && ${unary()}`;}return value;}
  function expression():string {let value=conjunction();while(peek()==="||"){take();value+=` || ${conjunction()}`;}return value;}
  const result=expression();if(cursor!==tokens.length || !tokens.includes("?value"))return fail();
  return result;
}
function viewValueFilter(attributes:Record<string,string>|undefined, term:SparqlTerm):SparqlPattern[] {
  const raw=attributes?.kindFilter?.trim();
  if(!raw){
    if(attributes?.kind && attributes.kind!=="all")throw new Error("Malformed FCT Query: selected view kind requires kindFilter.");
    return [];
  }
  return [{kind:"filter",expression:termExpr({kind:"raw-term",value:`(${bindFctFilterExpression(raw,serializeTerm(term))})`})}];
}

function serializeTerm(term: SparqlTerm): string {
  switch (term.kind) {
    case "variable": return `?${term.name}`;
    case "iri": return `<${term.value}>`;
    case "raw-term": return term.value;
    case "literal": {
      // Prefer single-quoted syntax when it preserves Virtuoso's documented
      // full-text form, e.g. '"Glossary*"'. Otherwise use escaped double quotes.
      const quote = term.value.includes('"') && !term.value.includes("'") ? "'" : '"';
      const escaped = term.value
        .replace(/\\/g, "\\\\")
        .replace(new RegExp(quote, "g"), `\\${quote}`)
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t");
      const value = `${quote}${escaped}${quote}`;
      if (term.language) return `${value}@${term.language}`;
      if (term.datatype) return `${value}^^${serializeTerm(term.datatype)}`;
      return value;
    }
  }
}

function serializeExpression(expression: SparqlExpression): string {
  switch (expression.kind) {
    case "term": return serializeTerm(expression.term);
    case "binary": return `(${serializeExpression(expression.left)} ${expression.operator} ${serializeExpression(expression.right)})`;
    case "function": return `${expression.name}(${expression.args.map(serializeExpression).join(", ")})`;
    case "aggregate": return `${expression.name}(${expression.distinct ? "DISTINCT " : ""}${serializeExpression(expression.expression)})`;
    case "in": return `(${serializeExpression(expression.value)} IN (${expression.options.map(serializeTerm).join(", ")}))`;
  }
}

function serializePattern(pattern: SparqlPattern, depth = 0): string {
  const indent = "  ".repeat(depth);
  switch (pattern.kind) {
    case "triple": {
      const options = pattern.options?.length
        ? ` OPTION (${pattern.options.map((option) => `${option.name} ${serializeTerm(literalTerm(option.value))}`).join(", ")})`
        : "";
      return `${indent}${serializeTerm(pattern.subject)} ${serializeTerm(pattern.predicate)} ${serializeTerm(pattern.object)}${options} .`;
    }
    case "path": return `${indent}${serializeTerm(pattern.subject)} ${serializeTerm(pattern.predicate)}${pattern.modifier} ${serializeTerm(pattern.object)} .`;
    case "bind": return `${indent}BIND(${serializeExpression(pattern.expression)} AS ${serializeTerm(pattern.as)})`;
    case "full-text": return `${indent}${serializeTerm(pattern.value)} bif:contains ${serializeTerm(pattern.search)} .`;
    case "filter": return `${indent}FILTER ${serializeExpression(pattern.expression)}`;
    case "values": return `${indent}VALUES ${serializeTerm(pattern.variable)} { ${pattern.values.map(serializeTerm).join(" ")} }`;
    case "group": return `${indent}{\n${pattern.patterns.map((item) => serializePattern(item, depth + 1)).join("\n")}\n${indent}}`;
    case "union": return pattern.branches.map((branch) => `${indent}{\n${branch.map((item) => serializePattern(item, depth + 1)).join("\n")}\n${indent}}`).join("\n" + indent + "UNION\n");
    case "not-exists": return `${indent}FILTER NOT EXISTS {\n${pattern.patterns.map((item) => serializePattern(item, depth + 1)).join("\n")}\n${indent}}`;
    case "optional": return `${indent}OPTIONAL {\n${pattern.patterns.map((item) => serializePattern(item, depth + 1)).join("\n")}\n${indent}}`;
    case "service": return `${indent}SERVICE ${serializeTerm(pattern.endpoint)} {\n${pattern.patterns.map((item) => serializePattern(item, depth + 1)).join("\n")}\n${indent}}`;
    case "graph": return `${indent}GRAPH ${serializeTerm(pattern.graph)} {\n${pattern.patterns.map((item) => serializePattern(item, depth + 1)).join("\n")}\n${indent}}`;
    case "subquery": return `${indent}{\n${serializeSparqlQuery(new SparqlQueryDocument(pattern.query)).split("\n").map((line) => `${indent}  ${line}`).join("\n")}\n${indent}}`;
    case "quad-map": return `${indent}quad map ${serializeTerm(pattern.map)} { graph ${serializeTerm(pattern.graph)} {\n${pattern.patterns.map((item) => serializePattern(item, depth + 2)).join("\n")}\n${indent}  } }`;
  }
}

function serializeSparqlQuery(document: SparqlDocument): string {
  const query = document.query;
  const lines = query.directives.map((directive) => `DEFINE ${directive.name} ${serializeTerm(literalTerm(directive.value))}`);
  // SPARQL 1.1 requires parenthesized SELECT expressions with AS aliases.
  // SAMPLE(...) aggregates remain supported for explicit badge projections;
  // ordinary FCT lists no longer add ancestry aggregation.
  const projection = query.projections.map((item) => item.as
    ? `(${serializeExpression(item.expression)} AS ${serializeTerm(item.as)})`
    : serializeExpression(item.expression)).join("\n       ");
  if (query.kind === "describe") {
    if (!query.describe) throw new Error("A DESCRIBE query requires a target term.");
    lines.push(`DESCRIBE ${serializeTerm(query.describe)}`);
  } else if (query.kind === "ask") {
    lines.push("ASK");
  } else {
    lines.push(`SELECT${query.distinct ? " DISTINCT" : ""} ${projection}`);
  }
  lines.push("WHERE {");
  lines.push(query.where.map((pattern) => serializePattern(pattern, 1)).join("\n"));
  lines.push("}");
  if (query.groupBy?.length) lines.push(`GROUP BY ${query.groupBy.map(serializeExpression).join(" ")}`);
  if (query.orderBy?.length) lines.push(`ORDER BY ${query.orderBy.map((item) => `${item.direction} (${serializeExpression(item.expression)})`).join(" ")}`);
  if (query.limit !== undefined) lines.push(`LIMIT ${query.limit}`);
  if (query.offset !== undefined) lines.push(`OFFSET ${query.offset}`);
  return lines.join("\n");
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return String((value as Record<string, unknown>)["#text"] ?? "");
  return "";
}

function toNode(name: string, value: unknown): XmlNode {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const attributes = Object.fromEntries(Object.entries(record)
    .filter(([key, item]) => key.startsWith("@_") && item !== undefined && item !== null)
    .map(([key, item]) => [key.slice(2), String(item)]));
  const children: XmlNode[] = [];
  for (const [childName, childValue] of Object.entries(record)) {
    if (childName.startsWith("@_") || childName === "#text") continue;
    for (const child of asArray(childValue)) children.push(toNode(childName, child));
  }
  return { name, attributes, text: nodeText(record["#text"] ?? (typeof value === "string" ? value : "")), children };
}

function iri(value: string): SparqlTerm | null {
  const trimmed = value.trim();
  return /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\\u0000-\u0020]*$/.test(trimmed) ? iriTerm(trimmed) : null;
}

function valueTerm(node: XmlNode, preserveLexicalForm = false): SparqlTerm | null {
  const datatype = (node.attributes.datatype ?? "").trim();
  const language = (node.attributes["xml:lang"] ?? node.attributes.lang ?? "").trim();
  const value = preserveLexicalForm ? node.text : normalizeFctValue(node.text);
  if (datatype.toLowerCase() === "uri" || datatype.toLowerCase() === "url") return iri(value);
  if (isBlankNodeTerm(datatype)) return null;
  if (language && !/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(language)) return null;
  if (language) return literalTerm(value, language);
  if (!datatype || ["string", "literal", "plainstring", "http://www.openlinksw.com/schemas/facets/dtp/plainstring"].includes(datatype.toLowerCase())) return literalTerm(value);
  // Native FCT datatype shortcuts are XSD types, not absolute IRIs.
  const xsdLocalTypes = new Set(["string", "boolean", "decimal", "integer", "int", "long", "short", "byte", "double", "float", "date", "dateTime", "time", "gYear", "gYearMonth", "nonNegativeInteger", "positiveInteger", "unsignedLong", "unsignedInt"]);
  const datatypeIri = xsdLocalTypes.has(datatype) ? iri(`http://www.w3.org/2001/XMLSchema#${datatype}`) : iri(datatype);
  return datatypeIri ? literalTerm(value, undefined, datatypeIri) : null;
}

function searchTerms(searchText: string): SparqlTerm | null {
  const expression = buildVirtuosoFullTextExpression(searchText);
  return expression === null ? null : literalTerm(expression);
}

/** Entity-rank ordering from the Virtuoso faceted-views documentation: ORDER BY DESC ( <LONG::IRI_RANK> (?s) ). Requires the Facet (fct) VAD. */
function entityRankOrder(term: SparqlTerm): SparqlOrder {
  return { expression: { kind: "function", name: "<LONG::IRI_RANK>", args: [termExpr(term)] }, direction: "DESC" };
}

function fullTextPatterns(searchText: string, textProperty?: string, exact = false, typeFilter = ""): SparqlPattern[] | null {
  const search = searchTerms(searchText);
  if (!search) return null;
  const patterns: SparqlPattern[] = [
    { kind: "triple", subject: variable("s1"), predicate: variable("txtp1"), object: variable("txt1") },
    // Keep Virtuoso's full-text index as the candidate generator for both name modes.
    { kind: "full-text", value: variable("txt1"), search },
    ...(exact ? [{ kind: "filter", expression: binary("=",
      { kind: "function", name: "LCASE", args: [{ kind: "function", name: "STR", args: [termExpr(variable("txt1"))] }] },
      termExpr(literalTerm(searchText.toLowerCase()))) } satisfies SparqlPattern] : []),
  ];
  // Resource-type restriction is part of the authoritative FCT <text> node,
  // not a post-processing filter. Keep it independent of selected label predicates.
  const types = typeFilter.split(/[\s,]+/).filter(Boolean);
  if (types.length) {
    if (types.some((type) => type !== "class" && type !== "property")) throw new Error("Unsupported text type value.");
    const classTypes = ["http://www.w3.org/2000/01/rdf-schema#Class", "http://www.w3.org/2002/07/owl#Class"];
    const propertyTypes = ["http://www.w3.org/1999/02/22-rdf-syntax-ns#Property", "http://www.w3.org/2002/07/owl#ObjectProperty", "http://www.w3.org/2002/07/owl#DatatypeProperty", "http://www.w3.org/2002/07/owl#AnnotationProperty"];
    const eligible = [...new Set(types.flatMap((type) => type === "class" ? classTypes : propertyTypes))];
    patterns.push({ kind: "triple", subject: variable("s1"), predicate: iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")!, object: variable("searchResourceType") });
    patterns.push({ kind: "filter", expression: { kind: "in", value: termExpr(variable("searchResourceType")), options: eligible.map((uri) => iri(uri)!) } });
  }
  const property = (textProperty ?? "").trim();
  // An omitted text/@property (or property="none") searches any property.
  // Otherwise accept a whitespace- or comma-separated list of predicate IRIs.
  if (property && property.toLowerCase() !== "none") {
    const propertyTerms = property.split(/[\s,]+/).filter(Boolean).map(iri);
    if (!propertyTerms.length || propertyTerms.some((term) => !term)) {
      throw new Error("The FCT <text> property attribute must contain one or more IRIs, or 'none'.");
    }
    patterns.push({ kind: "filter", expression: { kind: "in", value: termExpr(variable("txtp1")), options: propertyTerms as SparqlTerm[] } });
  }
  return patterns;
}

function compileConstraints(
  nodes: XmlNode[],
  subject: SparqlTerm,
  patterns: SparqlPattern[],
  errors: string[],
  state: { next: number; target: SparqlTerm | null; targetParent: SparqlTerm | null; focusParent?: { term: SparqlTerm; predicate: string; direction: "forward" | "reverse" }; focusAncestors?: SparqlTerm[]; statusBindings: Array<{ variable: string; uri: string; addr?: string }>; badgeColumns?: Array<{ colName: string; property: string; direction: "forward" | "reverse"; variable: SparqlTerm }>; grouping: Array<{ subject: SparqlTerm; predicate: SparqlTerm; direction: "forward" | "reverse" }>; relationBindings: Map<string, SparqlTerm>; mergeProjectionNodes?: ReadonlySet<XmlNode>; references?: FctValueReferenceResolver },
  isViewScope = true,
  ancestors: SparqlTerm[] = [variable("s1")],
): void {
  // A @uid groups sibling relationships into one logical OR. Preserve one
  // common related variable across alternatives: the view carrier may be in
  // one branch while another branch supplies the same focus binding.
  const orGroups = new Map<string, XmlNode[]>();
  for (const item of nodes) {
    if ((item.name !== "property" && item.name !== "property-of") || state.mergeProjectionNodes?.has(item) || !item.attributes.uid) continue;
    const uid = item.attributes.uid;
    if (!/^[a-z0-9]+$/.test(uid)) { errors.push(`Invalid FCT OR identifier: ${uid}`); continue; }
    orGroups.set(uid, [...(orGroups.get(uid) ?? []), item]);
  }
  const handledOr = new Set<string>();
  for (const node of nodes) {
    const uid = (node.name === "property" || node.name === "property-of") && !state.mergeProjectionNodes?.has(node) ? node.attributes.uid : undefined;
    const alternatives = uid ? orGroups.get(uid) : undefined;
    if (uid && alternatives && alternatives.length > 1) {
      if (handledOr.has(uid)) continue;
      handledOr.add(uid);
      const branches: SparqlPattern[][] = [];
      const next = state.next;
      let largestNext = next;
      for (const alternative of alternatives) {
        const branch: SparqlPattern[] = [];
        const branchState = { ...state, next,
          statusBindings: [...state.statusBindings],
          grouping: [...state.grouping],
          relationBindings: new Map(state.relationBindings),
          ...(state.badgeColumns ? { badgeColumns: [...state.badgeColumns] } : {}) };
        compileConstraints([{ ...alternative, attributes: Object.fromEntries(Object.entries(alternative.attributes).filter(([key]) => key !== "uid")) }],
          subject, branch, errors, branchState, isViewScope, ancestors);
        largestNext = Math.max(largestNext, branchState.next);
        if (branchState.target) state.target = branchState.target;
        if (branchState.targetParent) state.targetParent = branchState.targetParent;
        if (branchState.focusParent) state.focusParent = branchState.focusParent;
        if (branchState.focusAncestors) state.focusAncestors = branchState.focusAncestors;
        state.statusBindings.push(...branchState.statusBindings.slice(state.statusBindings.length));
        branches.push(branch);
      }
      state.next = largestNext;
      patterns.push({ kind: "union", branches });
      continue;
    }
    if (node.name === "view") {
      state.target = subject;
      state.focusAncestors = ancestors;
      compileConstraints(node.children, subject, patterns, errors, state, false, ancestors);
    } else if (node.name === "text") {
      continue;
    } else if (node.name === "property" || node.name === "property-of") {
      // Provider-generated facets compute a binding from an already bound
      // sibling, never an invented RDF predicate. pid references the spawning
      // relationship's rid; the structure determines the shared query scope.
      if (node.attributes.derive === "split") {
        const correlatedSubject = state.references?.subjects.get(node.attributes.id ?? "");
        if (correlatedSubject) patterns.push({kind:"bind",expression:termExpr(subject),as:variable(correlatedSubject)});
        const source = state.relationBindings.get(node.attributes.pid || "");
        const delimiter = node.attributes.splitPattern || "";
        if (!source || !delimiter || delimiter.length > 2000) {
          errors.push("Malformed derived split facet: source rid and delimiter pattern are required.");
          continue;
        }
        const sourceValuePredicate = node.attributes.sourceValuePredicate || "";
        const predicate = sourceValuePredicate ? iri(sourceValuePredicate) : null;
        if (sourceValuePredicate && !predicate) {
          errors.push("Malformed derived split facet: invalid source-value predicate.");
          continue;
        }
        const lex = predicate ? variable(`s${state.next++}`) : source;
        if (predicate) patterns.push({kind:"triple",subject:source,predicate,object:lex});
        patterns.push({kind:"filter",expression:{kind:"function",name:"isLiteral",args:[termExpr(lex)]}});
        const normalized = variable(`s${state.next++}`);
        patterns.push({kind:"bind",as:normalized,expression:{kind:"function",name:"REPLACE",args:[
          {kind:"function",name:"STR",args:[termExpr(lex)]},termExpr(literalTerm(delimiter)),termExpr(literalTerm(";")),termExpr(literalTerm("i"))]}});
        const index = variable(`s${state.next++}`);
        patterns.push({kind:"values",variable:index,values:Array.from({length:64},(_,i)=>({kind:"raw-term",value:String(i)} as SparqlTerm))});
        const tokenPattern = {kind:"function",name:"CONCAT",args:[termExpr(literalTerm("^(?:[^;]*;){")),
          {kind:"function",name:"STR",args:[termExpr(index)]},termExpr(literalTerm("}([^;]+)(?:;.*)?$"))]} as SparqlExpression;
        patterns.push({kind:"filter",expression:{kind:"function",name:"REGEX",args:[termExpr(normalized),tokenPattern]}});
        const extracted = variable(`s${state.next++}`);
        patterns.push({kind:"bind",as:extracted,expression:{kind:"function",name:"REPLACE",args:[
          termExpr(normalized),tokenPattern,termExpr(literalTerm("$1"))]}});
        const related = variable(`s${state.next++}`);
        patterns.push({kind:"bind",as:related,expression:{kind:"function",name:"REPLACE",args:[
          termExpr(extracted),termExpr(literalTerm("^\\s+|\\s+$")),termExpr(literalTerm(""))]}});
        patterns.push({kind:"filter",expression:binary(">",{kind:"function",name:"STRLEN",args:[termExpr(related)]},termExpr({kind:"raw-term",value:"0"}))});
        if (node.attributes.rid) state.relationBindings.set(node.attributes.rid, related);
        if (node.children.some(child=>child.name==="view")) {
          state.targetParent=subject;
          state.focusParent={term:subject,predicate:node.attributes.iri || "",direction:"forward"};
        }
        compileConstraints(node.children,related,patterns,errors,state,
          node.children.some(child=>child.name==="view"),[...ancestors,related]);
        continue;
      }
      if (node.attributes.derive === "regex") {
        const correlatedSubject = state.references?.subjects.get(node.attributes.id ?? "");
        if (correlatedSubject) patterns.push({kind:"bind",expression:termExpr(subject),as:variable(correlatedSubject)});
        const parentId = node.attributes.pid || "";
        const source = state.relationBindings.get(parentId);
        const pattern = node.attributes.pattern || "";
        const capture = node.attributes.capture || "";
        if (!source || !pattern || pattern.length > 2000 ||
          !/^[1-9]$/.test(capture)) {
          errors.push("Malformed derived regex facet: a preceding source rid, pattern, and capture group (1–9) are required.");
          continue;
        }
        const sourceValuePredicate = node.attributes.sourceValuePredicate || "";
        const predicate = sourceValuePredicate ? iri(sourceValuePredicate) : null;
        if (sourceValuePredicate && !predicate) {
          errors.push("Malformed derived regex facet: sourceValuePredicate must be a valid RDF predicate IRI.");
          continue;
        }
        const sourceLexical = predicate ? variable(`s${state.next++}`) : source;
        if (predicate) {
          patterns.push({ kind: "triple", subject: source, predicate, object: sourceLexical });
          patterns.push({ kind: "filter", expression: { kind: "function", name: "isLiteral", args: [termExpr(sourceLexical)] } });
        }
        const related = variable(`s${state.next++}`);
        const lexical: SparqlExpression = { kind: "function", name: "STR", args: [termExpr(sourceLexical)] };
        patterns.push({kind: "filter", expression: {kind: "function", name: "REGEX", args: [lexical, termExpr(literalTerm(pattern))]}});
        patterns.push({kind: "bind", expression: {kind: "function", name: "REPLACE", args: [lexical, termExpr(literalTerm(pattern)), termExpr(literalTerm(`$${capture}`))]}, as: related});
        if (node.attributes.rid) state.relationBindings.set(node.attributes.rid, related);
        if (node.children.some(child => child.name === "view")) {
          state.targetParent = subject;
          state.focusParent = {term: subject, predicate: node.attributes.iri || "", direction: "forward"};
        }
        compileConstraints(node.children, related, patterns, errors, state,
          node.children.some(child => child.name === "view"), [...ancestors, related]);
        continue;
      }
      // merge-values is an explicit population-preserving enrichment view.
      // Its added columns are never FCT WHERE constraints. list-values has
      // no such exception and retains ordinary AND/uid selection.
      if (state.mergeProjectionNodes?.has(node)) continue;
      // Every relationship is an FCT constraint, regardless of who added it.
      const predicate = iri(node.attributes.iri ?? "");
      if (!predicate) {
        errors.push(`The FCT <${node.name}> node has a missing or invalid IRI.`);
        continue;
      }
      // Group markers are resolved in the same compilation walk as the normal
      // relationship. Immediate siblings of <view>, or its carrier, are the
      // only legal grouping scope. Do not perform a separate XML validation pass.
      const grouped = (node.attributes.group ?? "").trim().toLowerCase() === "true";
      if (grouped) {
        const viewNearby = nodes.some((sibling) => sibling.name === "view" ||
          ((sibling.name === "property" || sibling.name === "property-of") && sibling.children.some((child) => child.name === "view")));
        if (!viewNearby) {
          throw new Error(`Malformed FCT Query: group="true" on <${node.name} iri="${node.attributes.iri ?? ""}">` +
            ` id="${node.attributes.id ?? ""}" has no <view> in its immediate scope.`);
        }
        state.grouping.push({ subject, predicate, direction: node.name === "property" ? "forward" : "reverse" });
      }
      const related = variable(`s${state.next++}`);
      // from="id" compares against the *subject at the referenced path*.
      // BIND is in the same OR branch as the referenced relationship, so an
      // absent branch never lends a binding to an unrelated solution.
      const subjectReference = state.references?.subjects.get(node.attributes.id ?? "");
      if (node.attributes.rid) state.relationBindings.set(node.attributes.rid, related);
      const options: SparqlDirective[] = [];
      const inference = node.attributes.inference?.trim();
      if (inference) options.push({ name: "input:inference", value: inference });
      if (["yes", "true", "1"].includes((node.attributes.same_as ?? "").trim().toLowerCase())) {
        options.push({ name: "input:same-as", value: "yes" });
      }
      const relationshipPattern: SparqlPattern = node.name === "property"
        ? { kind: "triple", subject, predicate, object: related, ...(options.length ? { options } : {}) }
        : { kind: "triple", subject: related, predicate, object: subject, ...(options.length ? { options } : {}) };
      const isExcluded = ["yes", "true", "1"].includes((node.attributes.exclude ?? "").trim().toLowerCase());
      // An unbound grouping dimension is NOT an ordinary required filter.
      // Its triple is added only by the grouped LIST compilation below.
      if (grouped && node.children.length === 0 && !isExcluded) continue;
      // Every bound value is an independent existential match of the same
      // predicate. Two values on one relationship mean A AND B, not that one
      // ?value variable must simultaneously equal two different terms.
      // Preserve the first binding as the view-bearing/badge variable.
      const valueChildren = node.children.filter((child) => child.name === "value" && child.attributes.enabled !== "false");
      const primaryValue = valueChildren[0];
      const primaryChildren = valueChildren.length < 2
        ? node.children.filter(child => child.name !== "value" || child.attributes.enabled !== "false")
        : node.children.filter(child => child.name !== "value" || child === primaryValue);
      const appendOtherValueMatches = (destination: SparqlPattern[], innerState: typeof state) => {
        for (const otherValue of valueChildren.slice(1)) {
          const otherRelated = variable(`s${innerState.next++}`);
          destination.push(node.name === "property"
            ? { kind: "triple", subject, predicate, object: otherRelated, ...(options.length ? { options } : {}) }
            : { kind: "triple", subject: otherRelated, predicate, object: subject, ...(options.length ? { options } : {}) });
          compileConstraints([otherValue], otherRelated, destination, errors, innerState, false, [...ancestors, otherRelated]);
        }
      };
      // An excluded predicate without any bound values means that this
      // relationship must not exist (e.g., Not rdf:type). With bound values,
      // exclude only the specific property/value combination.
      if (isExcluded && !node.children.some((child) => child.name === "view")) {
        // Negate the relationship and its bound-value constraints together.
        // This means "no matching property/role with this value", rather than
        // merely negating the value comparison after a positive triple match.
        const excludedPatterns: SparqlPattern[] = [relationshipPattern];
        const nestedState = { ...state };
        compileConstraints(primaryChildren, related, excludedPatterns, errors, nestedState, false, [...ancestors, related]);
        appendOtherValueMatches(excludedPatterns, nestedState);
        state.next = nestedState.next;
        patterns.push({ kind: "not-exists", patterns: excludedPatterns });
      } else {
        patterns.push(relationshipPattern);
        // A forward relation's RDF subject is the parent; a reverse
        // relation's RDF subject is the incoming resource (related).
        // Bind only after the relationship exists, never from a missing path.
        if (subjectReference) patterns.push({kind:"bind",expression:termExpr(node.name === "property-of" ? related : subject),as:variable(subjectReference)});
        // Badge projections belong only to relationships directly beside the active <view>.
        // isViewScope can also be true at the root while traversing the
        // breadcrumb path; that must not project ancestor predicates as badges.
        if (isViewScope && nodes.some((sibling) => sibling.name === "view") && state.badgeColumns && node.attributes.iri) {
          state.badgeColumns.push({
            colName: `badge_${state.badgeColumns.length + 1}`,
            property: node.attributes.iri,
            direction: node.name === "property" ? "forward" : "reverse",
            variable: related,
          });
        }
        // A facet widget's list view is nested directly under its relationship.
        // Retain the outer focus so COUNT(DISTINCT outer focus) measures how
        // many records have each facet value.
        if (node.children.some((child) => child.name === "view")) {
          state.targetParent = subject;
          state.focusParent = { term: subject, predicate: node.attributes.iri, direction: node.name === "property" ? "forward" : "reverse" };
        }
        // The children immediately beside <view> are the focus-scope roles
        // and properties. Their bound terms may be projected as Record
        // identity columns without projecting the outer breadcrumb path.
        compileConstraints(primaryChildren, related, patterns, errors, state,
          node.children.some((child) => child.name === "view"), [...ancestors, related]);
        appendOtherValueMatches(patterns, state);
      }
    } else if (node.name === "a") {
      // Viewer-plane Personal facet alias; no selection semantics.
      continue;
    } else if (node.name === "subject" || node.name === "object") {
      // Property-usage bindings are projected by list-subjects/list-objects.
      // Do not confuse them with normal <property>/<property-of> relationships.
      continue;
    } else if (node.name === "status") {
      const uri = node.text.trim();
      if (uri && (node.attributes.type !== "uri" || !iri(uri))) errors.push("A bound FCT <status> requires type=\"uri\" and an IRI.");
      else if (subject.kind !== "variable") errors.push("FCT <status> needs a bound resource variable.");
      else state.statusBindings.push({ variable: serializeTerm(subject), uri, addr: node.attributes.addr?.trim() });
    } else if (node.name === "class") {
      const classIri = iri(node.attributes.iri ?? "");
      if (!classIri && node.attributes.iri?.trim()) errors.push("The FCT <class> IRI is invalid.");
      else {
        const inference = node.attributes.inference?.trim();
        patterns.push({ kind: "triple", subject, predicate: iriTerm(RDF_TYPE), object: classIri ?? variable(`anyClass${state.next++}`), ...(inference ? { options: [{ name: "input:inference", value: inference }] } : {}) });
      }
      compileConstraints(node.children, subject, patterns, errors, state, true, ancestors);
    } else if (node.name === "value") {
      // Keep named saved regexes in FCT XML without filtering until checked.
      if (node.attributes.enabled === "false") continue;
      if (state.references?.ancestors?.has(node.attributes.id ?? "")) continue;
      const from = node.attributes.from;
      const fromView = node.attributes.fromView;
      if (from !== undefined || fromView !== undefined) {
        if (from !== undefined) {
          const name = state.references?.subjects.get(from);
          const reference = from === state.references?.rootId ? variable("s1") : name ? variable(name) : null;
          if (!reference) { errors.push(`Malformed FCT Query: unknown from reference "${from}".`); continue; }
          patterns.push({kind:"filter",expression:binary("&&",
            {kind:"function",name:"BOUND",args:[termExpr(reference)]},
            {kind:"function",name:"sameTerm",args:[termExpr(subject),termExpr(reference)]})});
        } else {
          if (!state.references) {errors.push("Missing fromView compiler context."); continue;}
          const member = variable(`maestroPopulation${state.next++}`);
          patterns.push({kind:"subquery",query:state.references.buildPopulation(fromView!, node.attributes.id ?? "", state.references.ancestors, member)});
          patterns.push({kind:"filter",expression:{kind:"function",name:"sameTerm",args:[termExpr(subject),termExpr(member)]}});
        }
        continue;
      }
      const op = (node.attributes.op ?? "=").trim().toLowerCase();
      const start = node.attributes.rangeStart?.trim();
      const end = node.attributes.rangeEnd?.trim();
      if (start !== undefined || end !== undefined) {
        const datatype = (node.attributes.datatype ?? "").trim();
        const allowed = new Set(["decimal", "integer", "int", "long", "short", "byte", "double", "float", "date", "dateTime", "time", "gYear", "gYearMonth", "nonNegativeInteger", "positiveInteger", "unsignedLong", "unsignedInt"]);
        if (!allowed.has(datatype)) { errors.push("FCT value ranges require an XSD numeric or date datatype."); continue; }
        const isNumeric = !["date", "dateTime", "time", "gYear", "gYearMonth"].includes(datatype);
        if (isNumeric && [start, end].some((value) => value !== undefined && (value === "" || !Number.isFinite(Number(value))))) {
          errors.push("Numeric FCT range bounds must be finite numbers."); continue;
        }
        if (start !== undefined && end !== undefined && (isNumeric ? Number(start) > Number(end) : start > end)) {
          errors.push("The FCT rangeStart must not exceed rangeEnd."); continue;
        }
        if (node.attributes.coerce && node.attributes.coerce !== "numeric") {
          errors.push("Unsupported FCT range coercion policy."); continue;
        }
        if (node.attributes.coerce === "numeric" && !isNumeric) {
          errors.push("Numeric coercion requires a numeric FCT datatype."); continue;
        }
        for (const [bound, symbol] of [[start, ">="], [end, "<="]] as const) {
          if (bound === undefined) continue;
          if (!bound) { errors.push("Range bounds cannot be blank."); continue; }
          const typedBound = valueTerm({ ...node, text: bound });
          if (!typedBound) { errors.push("Invalid range bound."); continue; }
          if (node.attributes.coerce === "numeric") {
            const lexical: SparqlExpression = { kind: "function", name: "bif:trim", args: [
              { kind: "function", name: "STR", args: [termExpr(subject)] },
            ] };
            // IF guards bif:number against malformed public literals.
            const valid: SparqlExpression = { kind: "function", name: "REGEX", args: [
              lexical, termExpr(literalTerm(NUMERIC_LEXICAL_PATTERN)),
            ] };
            const number: SparqlExpression = { kind: "function", name: "bif:number", args: [lexical] };
            const comparison = binary(symbol, number, termExpr(typedBound));
            patterns.push({ kind: "filter", expression: binary("&&",
              { kind: "function", name: "isLiteral", args: [termExpr(subject)] },
              { kind: "function", name: "IF", args: [valid, comparison, termExpr({ kind: "raw-term", value: "false" })] }) });
          } else {
            patterns.push({ kind: "filter", expression: binary(symbol, termExpr(subject), termExpr(typedBound)) });
          }
        }
        continue;
      }
      const term = valueTerm(node);
      if (!term) {
        errors.push("An FCT value cannot be represented safely as a SPARQL term.");
        continue;
      }
      const operators: Record<string, string> = { "": "=", "=": "=", eq: "=", equal: "=", "!=": "!=", ne: "!=", "<>": "!=", ">": ">", gt: ">", ">=": ">=", gte: ">=", "<": "<", lt: "<", "<=": "<=", lte: "<=" };
      if (operators[op]) patterns.push({ kind: "filter", expression: binary(operators[op], termExpr(subject), termExpr(term)) });
      else if (["contains", "starts-with", "starts_with", "ends-with", "ends_with"].includes(op)) {
        const fn = op === "contains" ? "CONTAINS" : op.startsWith("starts") ? "STRSTARTS" : "STRENDS";
        patterns.push({ kind: "filter", expression: { kind: "function", name: fn, args: [
          { kind: "function", name: "LCASE", args: [{ kind: "function", name: "STR", args: [termExpr(subject)] }] },
          { kind: "function", name: "LCASE", args: [{ kind: "function", name: "STR", args: [termExpr(term)] }] },
        ] } });
      } else if (op === "regex") {
        patterns.push({ kind: "filter", expression: { kind: "function", name: "REGEX", args: [
          { kind: "function", name: "STR", args: [termExpr(subject)] },
          termExpr(literalTerm(node.text)),
        ] } });
      } else errors.push(`The FCT value operator '${op}' is not supported.`);
    } else {
      errors.push(`The FCT <${node.name}> node is not supported by the SPARQL translator yet.`);
    }
  }
}

function queryDirectives(root: XmlNode): SparqlDirective[] {
  const result: SparqlDirective[] = [];
  const inference = root.attributes.inference?.trim();
  if (inference) result.push({ name: "input:inference", value: inference });
  const sameAs = (root.attributes["same-as"] ?? "").trim().toLowerCase();
  if (["yes", "true", "1"].includes(sameAs)) result.push({ name: "input:same-as", value: "yes" });
  return result;
}

function buildAskQuery(directives: SparqlDirective[], where: SparqlPattern[]): string {
  return new SparqlQueryDocument({ kind: "ask", directives, projections: [], where }).toString();
}

/** Server-side synset plans. No rules or RDF instance bindings are returned to
 * Maestro. Every nested projection carries the original FCT scope. The finite
 * rule language is one- and two-edge closed paths, in either direction. */
function compilePredicateSynset(input: {
  algorithm: PredicateSynsetAlgorithm; carrier: string; forward: boolean; parent: SparqlTerm;
  directives: SparqlDirective[]; scope: (patterns: SparqlPattern[]) => SparqlPattern[];
  maxCandidates: number; attributes: Record<string,string>;
}) {
  const {algorithm,carrier,forward,parent,directives,scope,maxCandidates,attributes}=input;
  const numeric=(key:string,fallback:number,min:number,max:number,integer=false)=>{
    const n=Number(attributes[key]??fallback);
    if (!Number.isFinite(n)||n<min||n>max||integer&&!Number.isSafeInteger(n)) throw new Error(`Invalid properties-synset ${key}.`);
    return n;
  };
  const confidenceN=numeric("confidence-n",15,1,1000,true);
  const minSupport=numeric("min-support",2,1,500000,true);
  const minHeadCoverage=numeric("min-head-coverage",0.005,0,1);
  const minConfidence=numeric("min-confidence",0.05,0,1);
  const ruleLength=numeric("max-rule-length",2,1,2,true);
  const c1=variable("synHead"), y=variable("synObject"), z=variable("synIntermediate");
  const ref=iriTerm(carrier), p1=variable("synBodyP1"), p2=variable("synBodyP2"), key=variable("synBodyKey");
  const v=variable, e=termExpr;
  const num=(n:number):SparqlExpression=>e({kind:"raw-term",value:String(n)});
  const fn=(name:string,...args:SparqlExpression[]):SparqlExpression=>({kind:"function",name,args});
  const triple=(subject:SparqlTerm,predicate:SparqlTerm,object:SparqlTerm):SparqlPattern=>({kind:"triple",subject,predicate,object});
  const edge=(p:SparqlTerm,o=y)=>forward?triple(parent,p,o):triple(o,p,parent);
  const filter=(expression:SparqlExpression):SparqlPattern=>({kind:"filter",expression});
  const not=(a:SparqlTerm,b:SparqlTerm)=>filter(binary("!=",e(a),e(b)));
  const bind=(expression:SparqlExpression,as:SparqlTerm):SparqlPattern=>({kind:"bind",expression,as});
  const project=(term:SparqlTerm):SparqlProjection=>({expression:e(term)});
  const as=(expression:SparqlExpression,name:string):SparqlProjection=>({expression,as:v(name)});
  const count=(name:string,term?:SparqlTerm):SparqlProjection=>as({kind:"aggregate",name:"COUNT",distinct:!!term,expression:term?e(term):e({kind:"raw-term",value:"*"})},name);
  const sub=(projections:SparqlProjection[],where:SparqlPattern[],groupBy?:SparqlExpression[],distinct=false):SparqlPattern=>({kind:"subquery",query:{kind:"select",directives:[],projections,where,groupBy,distinct}});
  const distinct=(terms:SparqlTerm[],where:SparqlPattern[])=>sub(terms.map(project),where,undefined,true);
  const headPairs=(p:SparqlTerm,extra:SparqlPattern[]=[],restrict:SparqlPattern[]=[])=>distinct([...(p.kind==="variable"?[p]:[]),parent,y],[...restrict,...scope([edge(p),...extra])]);
  const headSizes=(p:SparqlTerm,pairs:string,subjects?:string,restrict:SparqlPattern[]=[])=>sub([
    ...(p.kind==="variable"?[project(p)]:[]),count(pairs),...(subjects?[count(subjects,parent)]:[])],
    [headPairs(p,[],restrict)],p.kind==="variable"?[e(p)]:undefined);
  // Candidate counts exclude the carrier. The pair budget includes complete
  // argument-pair sets of the carrier and every qualifying candidate, not
  // only their overlap. No LIMIT/sample is used for the budget evidence.
  const budgetFor=(candidates:SparqlPattern)=>buildSelectQuery({directives,
    projections:[project(v("candidates")),as(binary("+",e(v("candidatePairs")),e(v("referencePairs"))),"pairs")],
    where:[sub([count("candidatePairs"),count("candidates",c1)],[headPairs(c1,[],[candidates])]),headSizes(ref,"referencePairs")]});
  const resultProjection=[{expression:e(c1),as:v("c1")}];
  if (algorithm==="relation-agreement") {
    // Only predicates with a shared ordered argument pair can score > 0.
    const commonPairs=headPairs(c1,[edge(ref),not(c1,ref)]);
    const candidates=distinct([c1],[commonPairs]);
    const budgetQuery=budgetFor(candidates);
    const common=sub([project(c1),count("common"),count("agreeingSubjects",parent)],
      [commonPairs],[e(c1)]);
    const refSubjects=distinct([parent],scope([edge(ref)]));
    const candidateSubjects=distinct([c1,parent],[candidates,...scope([edge(c1)])]);
    const intersectSubjects=sub([project(c1),count("sharedSubjects",parent)],
      [refSubjects,candidateSubjects],[e(c1)]);
    const query=buildSelectQuery({directives,projections:[...resultProjection,...["reference","candidate","common","agreeingSubjects"].map(n=>project(v(n))),
      as(binary("-",binary("+",e(v("refSubjects")),e(v("candidateSubjects"))),e(v("sharedSubjects"))),"subjectsUnion")],
      where:[common,headSizes(ref,"reference","refSubjects"),headSizes(c1,"candidate","candidateSubjects",[candidates]),intersectSubjects],
      orderBy:[{direction:"ASC",expression:e(c1)}],limit:maxCandidates+1});
    return {query,budgetQuery,algorithm,carrier,confidenceN};
  }
  // Keys encode the oriented predicate sequence injectively, not labels or
  // arbitrary intermediate node IDs. Every body denotes the same ordered
  // head arguments. Exclude head recursion in both one- and two-hop paths.
  const bodyBranches=():SparqlPattern[][]=>{
    const makeEdge=(a:SparqlTerm,p:SparqlTerm,b:SparqlTerm,reverse:boolean)=>reverse?triple(b,p,a):triple(a,p,b);
    const component=(p:SparqlTerm)=>fn("ENCODE_FOR_URI",fn("STR",e(p)));
    const marker=(s:string)=>e(literalTerm(s));
    const branches:SparqlPattern[][]=[];
    for (const reverse of [false,true]) branches.push([makeEdge(parent,p1,y,reverse),
      bind(fn("CONCAT",marker(reverse?"r:":"f:"),component(p1)),key)]);
    if (ruleLength===2) for (const a of [false,true]) for (const b of [false,true]) branches.push([
      makeEdge(parent,p1,z,a),makeEdge(z,p2,y,b),
      bind(fn("CONCAT",marker(a?"r:":"f:"),component(p1),marker(b?"|r:":"|f:"),component(p2)),key)]);
    return branches;
  };
  const supports=(head:SparqlTerm,restrict:SparqlPattern[]=[])=>{
    const terms=[...(head.kind==="variable"?[head]:[]),key];
    return sub([...terms.map(project),count("support")],
      [distinct([...terms,parent,y],[...restrict,...scope([edge(head),{kind:"union",branches:bodyBranches()},not(p1,head),
        filter(binary("||",fn("!BOUND",e(p2)),binary("!=",e(p2),e(head))))])])],terms.map(e));
  };
  const bodies=(restrict:SparqlPattern[]=[])=>sub([project(key),count("bodySize")],[distinct([key,parent,y],[...restrict,...scope([{kind:"union",branches:bodyBranches()}])])],[e(key)]);
  const definitions=(head:SparqlTerm,headRestriction:SparqlPattern[]=[],keyRestriction:SparqlPattern[]=[])=>{
    const terms=[...(head.kind==="variable"?[head]:[]),key];
    return distinct(terms,[supports(head,[...headRestriction,...keyRestriction]),headSizes(head,"headSize",undefined,headRestriction),bodies(keyRestriction),
      filter(binary(">=",e(v("support")),num(minSupport))),
      filter(binary(">=",binary("/",e(v("support")),e(v("headSize"))),num(minHeadCoverage))),
      filter(binary(">=",binary("/",e(v("support")),e(v("bodySize"))),num(minConfidence)))]);
  };
  // A candidate must have at least one qualifying definition of the carrier.
  // This is a join on canonical rule keys, not on the head argument pairs.
  // Do not restrict the candidate's final definition set to those shared keys:
  // all its qualifying rules are required for the exact Jaccard denominator.
  const referenceRules=definitions(ref);
  const sharedRules=definitions(c1,[],[referenceRules]);
  const candidates=distinct([c1],[sharedRules,not(c1,ref)]);
  const budgetQuery=budgetFor(candidates);
  const ruleBudgetQuery=buildSelectQuery({directives,projections:[as(binary("+",e(v("referenceRules")),e(v("candidateRules"))),"rules")],where:[
    sub([count("referenceRules")],[supports(ref)]),sub([count("candidateRules")],[supports(c1,[candidates])])]});
  const referenceDefinitions=sub([count("referenceDefinitions")],[referenceRules]);
  const candidateDefinitions=sub([project(c1),count("candidateDefinitions")],[definitions(c1,[candidates])],[e(c1)]);
  const commonDefinitions=sub([project(c1),count("commonDefinitions")],[sharedRules,not(c1,ref)],[e(c1)]);
  const similarity=binary("/",fn("<http://www.w3.org/2001/XMLSchema#double>",e(v("commonDefinitions"))),binary("-",binary("+",e(v("referenceDefinitions")),e(v("candidateDefinitions"))),e(v("commonDefinitions"))));
  const query=buildSelectQuery({directives,projections:[...resultProjection,as(similarity,"similarity")],
    where:[commonDefinitions,referenceDefinitions,candidateDefinitions],
    orderBy:[{direction:"DESC",expression:e(v("similarity"))},{direction:"ASC",expression:e(c1)}],limit:maxCandidates+1});
  return {query,budgetQuery,ruleBudgetQuery,algorithm,carrier,confidenceN};
}

function buildSelectQuery(args: {
  directives: SparqlDirective[];
  projections: SparqlProjection[];
  where: SparqlPattern[];
  distinct?: boolean;
  groupBy?: SparqlExpression[];
  orderBy?: SparqlOrder[];
  limit?: number;
  offset?: number;
}): string {
  const document = new SparqlQueryDocument({ kind: "select", ...args });
  return document.toString();
}

const DEFAULT_INDEX_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
// The Sheet (or temporary URL override) is the sole language setting.
// A restored <view> never carries a language preference.
function indexLanguage(_view: XmlNode | null, effectiveLanguage = effectiveMaestroLanguage()): string {
  const language = validMaestroLanguage(effectiveLanguage);
  if (!language) throw new Error("Invalid preferred language code.");
  return language;
}
/** Maestro RDF language policy (all list, facet, alphabet, and count views):
 * 1. Resource terms and language-neutral literals ALWAYS pass, including
 *    xsd:string, numeric, boolean, and temporal literals.
 * 2. Only rdf:langString literals are restricted to the Sheet's preferred
 *    language; LANGMATCHES accepts regional variants (en-US under en).
 * 3. "all" emits NO filter. An explicit xml:lang on the view's bound value
 *    takes precedence over the Sheet preference.
 * 4. Filtering is server-side, before grouping, counts and pagination.
 *
 * Test case: a plain xsd:string "demo" must survive English filtering.
 * Do not interrogate LANG() on language-neutral values: Virtuoso has produced
 * empty result sets for that condition. RDF 1.1 DATATYPE distinguishes
 * language-tagged rdf:langString from neutral typed literals directly.
 */
function rdfLanguageExpression(value: SparqlTerm, language: string): SparqlExpression {
  const term = termExpr(value);
  return binary("||",
    { kind: "function", name: "!isLiteral", args: [term] },
    binary("||",
      binary("!=", { kind: "function", name: "DATATYPE", args: [term] },
        termExpr(iriTerm("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"))),
      { kind: "function", name: "LANGMATCHES", args: [{kind:"function",name:"LANG",args:[term]}, termExpr(literalTerm(language))] },
    ),
  );
}

function indexLanguageFilter(value: SparqlTerm, language: string): Extract<SparqlPattern, { kind: "filter" }> {
  return { kind: "filter", expression: language === "all"
    ? binary("=", termExpr(literalTerm("all")), termExpr(literalTerm("all")))
    : rdfLanguageExpression(value, language) };
}

/**
 * FCT's explicit xml:lang on the focused value wins over the Sheet preference.
 * A neutral literal, an IRI, or a blank node is always eligible.
 * These FILTERs run in SPARQL before ORDER BY, LIMIT, aggregation and counts.
 */
function preferredValueLanguageFilter(value: SparqlTerm, view: XmlNode | null, viewParent: XmlNode | null, effectiveLanguage: string): SparqlPattern[] {
  const language = indexLanguage(view, effectiveLanguage);
  if (language === "all" || viewParent?.children.some((child) =>
    child.name === "value" && !!(child.attributes["xml:lang"] || child.attributes.lang))) return [];
  // Only rdf:langString is language-filtered; typed neutral literals survive.
  const expr = rdfLanguageExpression(value, language);
  // The serializer prints !isLiteral(...) as a normal SPARQL function-style
  // unary expression; use its standard function spelling below.
  return [{ kind: "filter", expression: expr }];
}
function indexLabelPredicates(view: XmlNode | null): string[] {
  const list = (view?.attributes.indexLabels || DEFAULT_INDEX_LABEL).split(/[\s,]+/).filter(Boolean);
  const values = [...new Set(list)];
  if (!values.length || values.length > 20 || values.some((value) => !iri(value)))
    throw new Error("Alphabet label selectors must contain 1–20 valid predicate IRIs.");
  return values;
}

export type FctFederationContext = {
  /** Actual selected source endpoint, not a registry host-only shortcut. */
  liveEndpoint: string;
  /** Endpoint on which the compiled query will run. */
  executionEndpoint: string;
  /** Default personal status graph@server for legacy unqualified <status>. */
  defaultStatusAddr: string;
  /** Named graph containing W3C SHACL shapes on the execution endpoint. */
  validateShapesGraph?: string;
  /** OTC transcoders may be seeded into a distinct personal named graph. */
  providerOtcGraph?: string;
};

export function compileFctXmlToSparql(xml: string, requestedView?: string, graphOnly = false, countOnly = false, discoverGraph: boolean | "first" = false, countFreeFacet = false, federation?: FctFederationContext, preferredLanguage = effectiveMaestroLanguage(), statusCandidateIris?: readonly string[], predicateAnalysisStage?: PredicateAnalysisStage): CompiledFctQuery {
  if (!xml.trim()) throw new Error("The FCT query XML is empty.");
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const details = validation && typeof validation === "object" && "err" in validation
      ? String((validation as { err?: { msg?: string; line?: number; col?: number } }).err?.msg ?? "Invalid XML")
      : "Invalid XML";
    throw new Error(`Invalid FCT query XML: ${details}`);
  }
  const parsed = parser.parse(xml) as Record<string, unknown>;
  if (!parsed.query || typeof parsed.query !== "object" || Array.isArray(parsed.query)) throw new Error("The XML must have a query root element.");
  const root = toNode("query", parsed.query);
  const findView = (nodes: XmlNode[]): XmlNode | null => {
    for (const node of nodes) {
      if (node.name === "view") return node;
      const nested = findView(node.children);
      if (nested) return nested;
    }
    return null;
  };
  const viewNode = findView(root.children);
  // Find the exact scope carrying the authoritative <view>; list-values
  // columns live alongside that view, never in a JSON request.
  const findViewParent = (node: XmlNode): XmlNode | null => {
    if (node.children.includes(viewNode as XmlNode)) return node;
    for (const child of node.children) {
      const found = findViewParent(child);
      if (found) return found;
    }
    return null;
  };
  const viewParent = viewNode ? findViewParent(root) : null;
  const rawView = requestedView || viewNode?.attributes.type || FCT_VIEW_TYPES.TEXT;
  graphOnly = graphOnly || rawView === FCT_VIEW_TYPES.GRAPHS;
  // A count-distinct view is declarative FCT, never a post-compiled SPARQL rewrite.
  countOnly = countOnly || rawView === FCT_VIEW_TYPES.COUNT_DISTINCT;
  if (!isFctViewType(rawView)) {
    throw new Error(`The '${rawView}' view is not supported by the SPARQL translator.`);
  }
  const view: FctSparqlView = rawView;
  const predicateAnalysisView = view === FCT_VIEW_TYPES.PROPERTIES_RANK ||
    view === FCT_VIEW_TYPES.PROPERTIES_CLUSTER || view === FCT_VIEW_TYPES.CLUSTERS;
  const synset = view === FCT_VIEW_TYPES.PROPERTIES_SYNSET;
  const synsetAlgorithm = synset ? predicateSynsetAlgorithm(viewNode?.attributes.algorithm) : undefined;
  let synsetDetached = false;
  if (synset) {
    if (graphOnly || countOnly || discoverGraph || !viewNode || !viewParent ||
        !["property", "property-of"].includes(viewParent.name) || !iri(viewParent.attributes.iri ?? "") || viewParent.attributes.derive)
      throw new Error("properties-synset requires a concrete property or property-of view carrier.");
    const views = (node: XmlNode): number => Number(node.name === "view") + node.children.reduce((n,c)=>n+views(c),0);
    if (views(root)!==1) throw new Error("properties-synset requires exactly one view.");
    if (viewNode.children.length || viewNode.attributes.kindFilter || viewNode.attributes.kind && viewNode.attributes.kind!=="all")
      throw new Error("properties-synset does not support view-local value projections or Kind filters; express constraints in the FCT tree.");
    // The carrier is a projection, not an implicit existential constraint.
    // If it carries explicit constraints, OR membership or references, retain
    // its original semantics and project its parent instead.
    const refs = inspectFctValueReferences(root as ReferenceNode);
    const id = viewParent.attributes.id ?? "";
    const rid = viewParent.attributes.rid;
    const usesRelation = (node:XmlNode):boolean => Boolean(rid && node.attributes.pid === rid) || node.children.some(usesRelation);
    const referenced = refs.references.some(edge => edge.targetId === id) || usesRelation(root);
    const canDetach = viewParent.children.every(c=>c===viewNode) && !viewParent.attributes.uid &&
      !viewParent.attributes.exclude && !viewParent.attributes.group && !viewParent.attributes.inference && !viewParent.attributes.same_as && !referenced;
    if (canDetach) {
      const relocate = (node:XmlNode):boolean => {
        const at=node.children.indexOf(viewParent);
        if (at>=0) {node.children.splice(at,1,viewNode);return true;}
        return node.children.some(relocate);
      };
      synsetDetached=relocate(root);
    }
  }
  const rankingAlgorithm = view === FCT_VIEW_TYPES.PROPERTIES_RANK
    ? predicateRankAlgorithm(viewNode?.attributes.algorithm) : undefined;
  if (predicateAnalysisStage && !predicateAnalysisView)
    throw new Error("Predicate analytical stages require one of the three predicate analytics views.");
  if (predicateAnalysisStage && predicateAnalysisStage.kind !== "incidence" && rankingAlgorithm !== "fur")
    throw new Error("Facet Utility statistics require the FUR ranking algorithm.");
  // Column selection reads view-plane <a> references alongside the view.
  // Only merge-values omits those focus-scope facets from population WHERE;
  // list-values retains every relationship as an ordinary FCT selector.
  const valueView = view === FCT_VIEW_TYPES.LIST_VALUES || view === FCT_VIEW_TYPES.MERGE_VALUES;
  const mergeProjectionNodes = new Set<XmlNode>();
  const listValueProjections: NonNullable<CompiledFctQuery["listValueProjections"]> = [];
  if (valueView && viewParent) {
    const index = indexFctPaths(root);
    const boundTerms = (target: XmlNode): SparqlBindingTerm[] => target.children.flatMap(child => {
      if (child.name !== "value" || child.attributes.enabled === "false") return [];
      const bound = valueTerm(child, true);
      if (bound?.kind === "iri") return [{ type: "uri", value: bound.value }];
      if (bound?.kind === "literal") return [{ type: "literal", value: bound.value,
        ...(bound.language ? { "xml:lang": bound.language } : {}),
        ...(bound.datatype?.kind === "iri" ? { datatype: bound.datatype.value } : {}) }];
      return [];
    });
    const addColumn = (id: string, hops: FctPathHop[], target: XmlNode) => {
      if (!id || listValueProjections.some(column => column.id === id))
        throw new Error(`FCT projected column ID is missing or duplicated: ${id}`);
      if (hops.length < 1 || hops.length > 16 || hops.some(hop => !iri(hop.iri)))
        throw new Error(`Malformed FCT projected relationship path for ${id}.`);
      const boundValues = boundTerms(target);
      listValueProjections.push({ id, property: hops[hops.length - 1].iri, direction: hops[0].direction,
        path: hops.map(hop => hop.iri), hops,
        ...(boundValues.length ? { boundValues } : {}) });
      if (listValueProjections.length > 24) throw new Error("FCT value views support at most 24 columns.");
    };
    // Single-hop columns need no anchor. A descendant is addressed explicitly
    // through <a id=... href=...>, not inferred from predicate shape.
    for (const node of viewParent.children) {
      if (node.name !== "property" && node.name !== "property-of") continue;
      mergeProjectionNodes.add(node);
      const id = node.attributes.id;
      if (!id) throw new Error("FCT projected property/role requires an ID.");
      if (node.attributes.column !== "false") addColumn(id, [{id, iri: node.attributes.iri ?? "", direction: node.name === "property" ? "forward" : "reverse"}], node);
    }
    // Anchors can live beside <view> (legacy) or directly inside their
    // successor relationship (current UI). In either form getPath is resolved
    // from the *same* active view carrier, never from the anchor's parent.
    const projectAnchors = (parent: XmlNode): void => {
      for (const child of parent.children) {
        if (child.name === "a") {
          const href = child.attributes.href ?? "";
          if (parent !== viewParent && (parent.name !== "property" && parent.name !== "property-of" || parent.attributes.id !== href))
            throw new Error(`Invalid nested FCT anchor ${child.attributes.id ?? ""}: anchor must belong to its target relationship.`);
          const resolved = getPath(index, viewParent, href);
          if (!resolved) throw new Error(`Invalid FCT projection anchor ${child.attributes.id ?? ""}: target must descend from view focus.`);
          addColumn(child.attributes.id ?? "", resolved.path, resolved.target);
        } else if (child.name === "property" || child.name === "property-of") {
          projectAnchors(child);
        }
      }
    };
    projectAnchors(viewParent);
  }
  const propertyUsageView = view === FCT_VIEW_TYPES.LIST_SUBJECTS || view === FCT_VIEW_TYPES.LIST_OBJECTS;
  // A property-usage projection is meaningful only when rdf:Property is bound
  // in the exact scope carrying <view>. A class on an unrelated sibling path
  // must not grant access to list-subjects/list-objects.
  if (propertyUsageView) {
    const propertyClass = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property";
    const scope = viewParent ?? root;
    if (!scope.children.some((node) => node.name === "class" && node.attributes.iri === propertyClass))
      throw new Error(`FCT view '${view}' requires <class iri="${propertyClass}"> in its own focus context.`);
  }
  const parsePage = (raw: string | undefined, fallback: number, max: number) => {
    const value = Number(raw ?? fallback);
    return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
  };
  const limit = parsePage(viewNode?.attributes.limit, 30, Number.MAX_SAFE_INTEGER) || 30;
  const offset = parsePage(viewNode?.attributes.offset, 0, Number.MAX_SAFE_INTEGER);
  // The view's candidate ceiling is independent of output paging and is
  // supplied by its provider through FCT XML, never by a server IndexedDB read.
  const requestedCandidateLimit = viewNode?.attributes["max-candidates"];
  const maxPredicateCandidates = predicateAnalysisView || synset
    ? Number(requestedCandidateLimit ?? DEFAULT_PREDICATE_ANALYSIS_CANDIDATES)
    : undefined;
  if ((predicateAnalysisView || synset) && (!Number.isSafeInteger(maxPredicateCandidates) ||
    maxPredicateCandidates! < 1 || maxPredicateCandidates! > MAX_PREDICATE_ANALYSIS_CANDIDATES))
    throw new Error(`Predicate analytics max-candidates must be an integer from 1 to ${MAX_PREDICATE_ANALYSIS_CANDIDATES}.`);
  const maxPredicateIncidenceRows = predicateAnalysisView || synset
    ? Number(viewNode?.attributes["max-incidence-rows"] ?? DEFAULT_PREDICATE_ANALYSIS_INCIDENCE_ROWS)
    : undefined;
  if ((predicateAnalysisView || synset) && (!Number.isSafeInteger(maxPredicateIncidenceRows) ||
    maxPredicateIncidenceRows! < 1 || maxPredicateIncidenceRows! > MAX_PREDICATE_ANALYSIS_INCIDENCE_ROWS))
    throw new Error(`Predicate analytics max-incidence-rows must be an integer from 1 to ${MAX_PREDICATE_ANALYSIS_INCIDENCE_ROWS}.`);
  const timeoutRaw = parseFctViewTimeout(viewNode?.attributes.timeout) ?? Number(root.attributes.timeout ?? 0);
  const timeoutMs = Number.isSafeInteger(timeoutRaw) && timeoutRaw >= 0 ? timeoutRaw : 0;
  if (synset && (timeoutRaw !== timeoutMs || timeoutMs > 2147483647)) throw new Error("Invalid property synset timeout.");
  const orderAttr = (root.attributes.order ?? root.attributes["order-results"] ?? viewNode?.attributes.order ?? "").trim().toLowerCase();
  const shouldOrder = ["yes", "true", "1", "on"].includes(orderAttr);
  const badgesAttr = (viewNode?.attributes.badges ?? root.attributes.badges ?? "").trim().toLowerCase();
  const badgesEnabled = ["yes", "true", "1", "on"].includes(badgesAttr);
  const textNode = root.children.find((node) => node.name === "text");
  const searchText = textNode?.text.trim() ?? "";
  const {byId: referenceNodes, references: referenceEdges, referencedSubjects} =
    inspectFctValueReferences(root as ReferenceNode);
  const rootId = root.attributes.id ?? "";
  const buildPopulation: FctValueReferenceResolver["buildPopulation"] = (targetId, valueId, ancestors, member) => {
    if ((ancestors?.size ?? 0) > 20 || ancestors?.has(valueId))
      throw new Error(`Malformed FCT Query: cyclic fromView reference at ${valueId}.`);
    const targetNode = referenceNodes.get(targetId);
    if (!targetNode) throw new Error(`Malformed FCT Query: unknown fromView target ${targetId}.`);
    const omitted = new Set([...(ancestors ?? []), valueId]);
    // Relocate only the synthetic view; the real Browse query is immutable.
    const cloned = structuredClone(root);
    const movedView = structuredClone(viewNode ?? {name:"view",attributes:{type:"list"},text:"",children:[]});
    movedView.attributes = {...movedView.attributes,type:"list",offset:"0"};
    const reposition = (node: XmlNode): void => {
      node.children = node.children.filter(child => child.name !== "view");
      for (const child of node.children) reposition(child);
      if (node.attributes.id === targetId) node.children.push(structuredClone(movedView));
    };
    reposition(cloned);
    const innerErrors:string[] = [];
    const innerWhere:SparqlPattern[] = [];
    const innerState = {next:2,target:null as SparqlTerm|null,targetParent:null as SparqlTerm|null,
      statusBindings:[] as Array<{variable:string;uri:string;addr?:string}>,
      grouping:[] as Array<{subject:SparqlTerm;predicate:SparqlTerm;direction:"forward"|"reverse"}>,
      relationBindings:new Map<string,SparqlTerm>(),
      references:{rootId,subjects:referencedSubjects,buildPopulation,ancestors:omitted}};
    compileConstraints(cloned.children,variable("s1"),innerWhere,innerErrors,innerState);
    if (innerErrors.length) throw new Error(innerErrors.join(" "));
    const subText = cloned.children.find(child => child.name === "text");
    const search = subText?.text.trim() ?? "";
    if (search) innerWhere.unshift(...(fullTextPatterns(search,subText?.attributes.property,subText?.attributes.exact === "true",subText?.attributes.type ?? "") ?? []));
    if (!innerWhere.some(pattern=>["triple","full-text","graph","quad-map","union"].includes(pattern.kind)))
      innerWhere.unshift({kind:"triple",subject:variable("s1"),predicate:variable("maestroAnyPredicate"),object:variable("maestroAnyValue")});
    return {kind:"select",directives:[],distinct:true,
      projections:[{expression:termExpr(innerState.target ?? variable("s1")),as:member}],where:innerWhere};
  };
  const referenceResolver: FctValueReferenceResolver = {rootId,subjects:referencedSubjects,buildPopulation};
  const constraints: SparqlPattern[] = [];
  const errors: string[] = [];
  const state: {
    next: number;
    target: SparqlTerm | null;
    targetParent: SparqlTerm | null;
    focusParent?: { term: SparqlTerm; predicate: string; direction: "forward" | "reverse" };
    focusAncestors?: SparqlTerm[];
    statusBindings: Array<{ variable: string; uri: string; addr?: string }>;
    badgeColumns?: Array<{ colName: string; property: string; direction: "forward" | "reverse"; variable: SparqlTerm }>;
    grouping: Array<{ subject: SparqlTerm; predicate: SparqlTerm; direction: "forward" | "reverse" }>;
    relationBindings: Map<string, SparqlTerm>;
    mergeProjectionNodes?: ReadonlySet<XmlNode>;
    references?: FctValueReferenceResolver;
  } = {
    next: 2,
    target: null,
    targetParent: null,
    statusBindings: [],
    grouping: [],
    relationBindings: new Map(),
    references: referenceResolver,
    mergeProjectionNodes: view === FCT_VIEW_TYPES.MERGE_VALUES ? mergeProjectionNodes : undefined,
    badgeColumns: badgesEnabled ? [] : undefined,
  };
  // A generated FCT resource-set query may carry several root URI values.
  // They are alternatives (OR); relationship-local multiple values remain AND.
  const rootUriMembers = root.children.filter(node => node.name === "value" && node.attributes.datatype === "uri");
  const rootValues = root.children.filter(node => node.name === "value");
  const xmlValuePage = valueView && rootValues.length > 0 &&
    rootValues.every(node => node.attributes.from === undefined && node.attributes.fromView === undefined) &&
    root.children.every(node => node.name === "value" || node.name === "view" || mergeProjectionNodes.has(node) || node.name === "a");
  const multipleRootMembers = !xmlValuePage && rootUriMembers.length > 1;
  if (multipleRootMembers && (rootUriMembers.length > 120 || rootValues.length !== rootUriMembers.length))
    throw new Error("FCT resource sets require 2–120 root URI values only.");
  const rootMemberTerms = multipleRootMembers ? rootUriMembers.map(node => valueTerm(node)) : [];
  if (rootMemberTerms.some(term => !term || term.kind !== "iri")) throw new Error("FCT resource set contains an invalid URI.");
  if (xmlValuePage) {
    if (rootValues.length > 100) throw new Error("FCT XML resource pages are limited to 100 RDF terms.");
    const terms = rootValues.map(node => valueTerm(node, true));
    if (terms.some(term => !term)) throw new Error("Invalid RDF term in list-values resource page.");
    constraints.push({ kind: "values", variable: variable("s1"), values: terms as SparqlTerm[] });
  } else if (multipleRootMembers) constraints.push({kind:"union",branches:rootMemberTerms.map(term=>[{kind:"bind",expression:termExpr(term!),as:variable("s1")}])});
  compileConstraints((multipleRootMembers || xmlValuePage) ? root.children.filter(node=>node.name!=="value") : root.children,
    variable("s1"), constraints, errors, state);
  if (errors.length) throw new Error(errors.join(" "));
  const target = state.target ?? variable("s1");
  // Normal FCT results contain only normal value projections. Blank-node
  // Records are handled on demand using the existing RDF term type.
  const rootLiteralNode = root.children.find((node) => node.name === "value" &&
    node.attributes.datatype !== "uri" && !isBlankNodeTerm(node.attributes.datatype));
  const describeBounds = view === FCT_VIEW_TYPES.DESCRIBE ? bnodeDescribeBounds(viewNode?.attributes ?? {}) : null;
  const viewObjectKind = viewNode?.attributes.kind?.trim();
  const kindFilteredDescribe = view === FCT_VIEW_TYPES.DESCRIBE && Boolean(viewNode?.attributes.kindFilter || (viewObjectKind && viewObjectKind !== "all"));
  const describeExpanded = describeBounds !== null || kindFilteredDescribe;
  const describeLiteral = view === FCT_VIEW_TYPES.DESCRIBE && Boolean(rootLiteralNode) &&
    !root.children.some((node) => node.name === "property" || node.name === "property-of");
  const textNodeProperty = textNode?.attributes.property;
  const textPatterns = searchText ? fullTextPatterns(searchText, textNodeProperty, textNode?.attributes.exact === "true", textNode?.attributes.type ?? "") : null;
  if (searchText && !textPatterns) throw new Error("The text search contains no searchable terms.");
  const where: SparqlPattern[] = [...(textPatterns ?? []), ...constraints];
  // A fixed subject expressed by a top-level <value> still needs a triple
  // pattern to bind it, particularly for list/text/DESCRIBE views.
  //const hasBindingPattern = where.some((pattern) => pattern.kind === "triple" || pattern.kind === "full-text" || pattern.kind === "graph" || pattern.kind === "quad-map");
  //if (!hasBindingPattern) where.unshift({ kind: "triple", subject: variable("s1"), predicate: variable("p0"), object: variable("o0") });
  
  
  
  const hasBindingPattern = where.some(
  (pattern) =>
    pattern.kind === "triple" ||
    pattern.kind === "full-text" ||
    pattern.kind === "graph" ||
    pattern.kind === "quad-map"
);

const viewSuppliesTriple =
  view === FCT_VIEW_TYPES.PROPERTIES ||
  view === FCT_VIEW_TYPES.PROPERTIES_IN ||
  view === FCT_VIEW_TYPES.CLASSES ||
  predicateAnalysisView || synset;

if (!hasBindingPattern && !viewSuppliesTriple && !xmlValuePage) {
  // A root-bound URI may have *only incoming* links. A triple pattern in
  // either direction makes a root list valid without inventing a relationship
  // in the authoritative FCT XML. This is Maestro's extension to native FCT.
  const isRootUri = root.children.some((child) =>
    child.name === "value" && child.attributes.datatype === "uri");
  const isRootLiteral = root.children.some((child) =>
    child.name === "value" && child.attributes.datatype !== "uri" && child.attributes.datatype !== "bnode");
  where.unshift(isRootUri
    ? { kind: "union", branches: [
        [{ kind: "triple", subject: variable("s1"), predicate: variable("p0"), object: variable("o0") }],
        [{ kind: "triple", subject: variable("incoming0"), predicate: variable("p1"), object: variable("s1") }],
      ] }
    : isRootLiteral
      ? { kind: "triple", subject: variable("incoming0"), predicate: variable("p0"), object: variable("s1") }
      : { kind: "triple", subject: variable("s1"), predicate: variable("p0"), object: variable("o0") });
}


  
  
  const address = root.attributes.addr ?? "";
  const delimiter = address.indexOf("@");
  if (delimiter < 0 || !address.slice(delimiter + 1).trim()) {
    throw new Error('The query addr attribute must use "graph@graphserver" syntax (graph may be empty).');
  }
  const graph = address.slice(0, delimiter).trim();
  const graphTerm = graph && graph !== ALL_GRAPHS ? iri(graph) : null;
  if (graph && graph !== ALL_GRAPHS && !graphTerm) throw new Error("The graph portion of query addr is not a valid IRI.");
  const scopedWhere = graphTerm ? [{ kind: "graph", graph: graphTerm, patterns: where } satisfies SparqlPattern] : where;
  // Facet patterns must be evaluated in the same named graph as their focus
  // constraints. Otherwise a root URI filter can be evaluated inside GRAPH
  // before the subject is bound by the rdf:type/property triple outside it.
  const scopeWith = (facetPatterns: SparqlPattern[]): SparqlPattern[] => graphTerm
    ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...facetPatterns] }]
    : [...where, ...facetPatterns];
  // Federation is resolved from FCT XML BEFORE serialization. Serialized SPARQL
  // is never scanned or altered. Status addresses select the RDF graph and its
  // graph server independently from the live query's root addr.
  const canonical = (address: string) => {
    const url = new URL(address);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  };
  const parseStatusAddress = (address: string) => {
    const separator = address.indexOf("@");
    if (separator <= 0 || !address.slice(separator + 1)) throw new Error('FCT <status addr> must be "graph@graphserver".');
    const graph = address.slice(0, separator), endpoint = address.slice(separator + 1);
    if (!iri(graph) || !/^https?:\/\//.test(endpoint)) throw new Error("Invalid FCT status federation address.");
    new URL(endpoint);
    return { graph, endpoint };
  };
  // The Status facet is strictly an RDF assertion projection. Effective
  // initial states and curator-derived authority are evaluated separately by
  // the RDF/XState policy runtime; they do not manufacture mui:status triples.
  const statusScope = (patterns: SparqlPattern[], forStatusList = false): SparqlPattern[] => {
    if (!federation) return patterns;
    const remote = canonical(federation.liveEndpoint) === canonical(federation.executionEndpoint)
      ? patterns
      : [{ kind: "service" as const, endpoint: iriTerm(federation.liveEndpoint), patterns }];
    const bindings = forStatusList
      ? [{ variable: serializeTerm(target), uri: "", addr: federation.defaultStatusAddr }]
      : state.statusBindings;
    const groups = new Map<string, { variable: SparqlTerm; address: {graph: string; endpoint: string}; uris: string[] }>();
    for (const binding of bindings) {
      const address = parseStatusAddress(binding.addr || federation.defaultStatusAddr);
      const key = JSON.stringify([binding.variable, address.graph, canonical(address.endpoint)]);
      const current = groups.get(key) ?? { variable: variable(binding.variable.slice(1)), address, uris: [] };
      if (!current.uris.includes(binding.uri)) current.uris.push(binding.uri);
      groups.set(key, current);
    }
    const statusPatterns: SparqlPattern[] = [];
    let ordinal = 0;
    for (const { variable: focus, address, uris } of groups.values()) {
      const predicate = iriTerm("gttp://ggg.maestro.ecosys/ns/ui#status");
      const mui = "gttp://ggg.maestro.ecosys/ns/ui#";
      const branches: SparqlPattern[][] = uris.map(uri => [
        {kind:"graph",graph:iriTerm(address.graph),patterns:[{
          kind:"triple",subject:focus,predicate,
          object:uri ? iriTerm(uri === `${mui}New` ? `${mui}Unseen` : uri) : variable(`status${ordinal++}`),
        }]},
      ]);
      const inside = branches.length === 1 ? branches[0] : [{kind:"union" as const,branches}];
      statusPatterns.push(...(canonical(address.endpoint) === canonical(federation.executionEndpoint)
        ? inside : [{kind:"service",endpoint:iriTerm(address.endpoint),patterns:inside} as SparqlPattern]));
    }
    return [...remote, ...statusPatterns];
  };
  const buildStatusSelect = (args: Parameters<typeof buildSelectQuery>[0], statusList = false): string =>
    buildSelectQuery({ ...args, where: statusScope(args.where, statusList) });
  const buildStatusAsk = (directives: SparqlDirective[], patterns: SparqlPattern[]): string =>
    buildAskQuery(directives, statusScope(patterns));
  const directives = queryDirectives(root);
  const countProjection = (term: SparqlTerm): SparqlProjection => ({ expression: { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(term) }, as: variable("n") });
  const buildIndexedTextWhere = (): SparqlPattern[] => {
      // The view-level alphabet index constrains label values, not URI initials.
      // Every label property selected beside the root search input is eligible.
      // Comma-separated alphabet terms: A,B,!C means A OR B OR NOT EXISTS(C).
      // A single letter retains the legacy semantics of the Browse alphabet.
      const rawIndex = (viewNode?.attributes.index ?? "").trim();
      const selections = rawIndex ? [...new Set(rawIndex.split(",").map((value) => value.trim()).filter(Boolean))] : [];
      if (selections.length > 26 || selections.some((value) => !/^!?[A-Z]$/.test(value)))
        throw new Error("Alphabet index values must be letters A–Z, optionally preceded by !, separated by commas.");
      let indexedWhere: SparqlPattern[] = [...scopedWhere];
      if (selections.length) {
        const predicates = indexLabelPredicates(viewNode);
        const name = variable("maestroIndexLabel");
        const predicate = variable("maestroIndexPredicate");
        const beginsWith = (value: SparqlTerm, letter: string): SparqlExpression => ({
          kind: "function", name: "STRSTARTS", args: [
            { kind: "function", name: "UCASE", args: [{ kind: "function", name: "STR", args: [termExpr(value)] }] },
            termExpr(literalTerm(letter)),
          ],
        });
        const existsLabel = (letter: string): SparqlPattern[] => [
          { kind: "triple", subject: target, predicate, object: name },
          { kind: "filter", expression: { kind: "in", value: termExpr(predicate), options: predicates.map(iriTerm) } },
          { kind: "filter", expression: beginsWith(name, letter) },
          indexLanguageFilter(name, indexLanguage(viewNode, preferredLanguage)),
        ];
        const branches: SparqlPattern[][] = [];
        for (const selected of selections) {
          const excluded = selected.startsWith("!");
          const letter = excluded ? selected.slice(1) : selected;
          if (viewParent?.name !== "property") {
            branches.push(excluded
              ? [{ kind: "not-exists", patterns: existsLabel(letter) }]
              : existsLabel(letter));
          } else if (excluded) {
            // Literal focus values need no label relation. URI values are
            // excluded only when one of their configured label predicates matches.
            branches.push([{ kind: "filter", expression: binary("&&",
              { kind: "function", name: "isLiteral", args: [termExpr(target)] },
              binary("=", beginsWith(target, letter), termExpr({ kind: "raw-term", value: "false" })),
            ) }]);
            branches.push([
              { kind: "filter", expression: { kind: "function", name: "isIRI", args: [termExpr(target)] } },
              { kind: "not-exists", patterns: existsLabel(letter) },
            ]);
          } else {
            branches.push([
              { kind: "filter", expression: binary("&&", { kind: "function", name: "isLiteral", args: [termExpr(target)] }, beginsWith(target, letter)) },
            ]);
            branches.push([
              { kind: "filter", expression: { kind: "function", name: "isIRI", args: [termExpr(target)] } },
              ...existsLabel(letter),
            ]);
          }
        }
        const alphabetPatterns: SparqlPattern[] = branches.length === 1 ? branches[0] : [{ kind: "union", branches }];
        indexedWhere = graphTerm
          ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...alphabetPatterns] }]
          : [...where, ...alphabetPatterns];
      }
      const indexedPatterns = indexedWhere[0]?.kind === "graph" ? indexedWhere[0].patterns : indexedWhere;
      indexedWhere = graphTerm
        ? [{ kind: "graph", graph: graphTerm, patterns: [...indexedPatterns, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)] }]
        : [...indexedPatterns, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)];
    return indexedWhere;
  };
  let synsetPlan: ReturnType<typeof compilePredicateSynset> | undefined;
  let query: string;
  let datatypeEvidenceQuery: string | undefined;
  let datatypeLiteralProbeQuery: string | undefined;
  // A Personal facet's values are enumerated through a view on a relationship.
  // The datatype aggregate examines the ENTIRE scoped value population before
  // the ordinary LIST/LIST_COUNT output window, without copying LIMIT/OFFSET.
  if (!countOnly && !graphOnly && (view === FCT_VIEW_TYPES.LIST_COUNT || view === FCT_VIEW_TYPES.LIST) &&
      (viewParent?.name === "property" || viewParent?.name === "property-of")) {
    const lexical: SparqlExpression = { kind: "function", name: "bif:trim", args: [
      { kind: "function", name: "STR", args: [termExpr(target)] },
    ] };
    const numericLexical: SparqlExpression = { kind: "function", name: "REGEX", args: [
      lexical, termExpr(literalTerm(NUMERIC_LEXICAL_PATTERN)),
    ] };
    const inferred: SparqlExpression = { kind: "function", name: "IF", args: [
      { kind: "binary", operator: "&&", left: { kind: "function", name: "isLiteral", args: [termExpr(target)] }, right: numericLexical },
      termExpr(iriTerm("http://www.w3.org/2001/XMLSchema#double")),
      { kind: "function", name: "IF", args: [
        { kind: "function", name: "isLiteral", args: [termExpr(target)] },
        { kind: "function", name: "DATATYPE", args: [termExpr(target)] },
        termExpr(iriTerm("http://www.w3.org/2001/XMLSchema#anyURI")),
      ] },
    ] };
    const original: SparqlExpression = { kind: "function", name: "IF", args: [
      { kind: "function", name: "isLiteral", args: [termExpr(target)] },
      { kind: "function", name: "DATATYPE", args: [termExpr(target)] },
      termExpr(iriTerm("http://www.w3.org/2001/XMLSchema#anyURI")),
    ] };
    const scopedValues = graphTerm ? [{ kind: "graph", graph: graphTerm,
      patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)] } satisfies SparqlPattern]
      : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)];
    datatypeLiteralProbeQuery = buildStatusAsk(directives, [...scopedValues,
      { kind: "filter", expression: { kind: "function", name: "isLiteral", args: [termExpr(target)] } },
    ]);
    datatypeEvidenceQuery = buildStatusSelect({ directives,
      projections: [
        { expression: inferred, as: variable("datatype") },
        { expression: original, as: variable("originalDatatype") },
        { expression: { kind: "aggregate", name: "COUNT", distinct: false, expression: termExpr({ kind: "raw-term", value: "*" }) }, as: variable("ct") },
      ], where: scopedValues, groupBy: [inferred, original] });
  }
  let graphDiscoveryHasSourcePattern: boolean | undefined;
  if (discoverGraph) {
    // Rank the *actual focus results* of the live view, then project the named
    // graph that supplies each result. Never rank graph IRIs or preselect an
    // unscoped focus resource whose matching triples are elsewhere.
    const discoveryWhere = view === FCT_VIEW_TYPES.TEXT ? buildIndexedTextWhere() :
      [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)];
    if (view === FCT_VIEW_TYPES.PROPERTIES) {
      discoveryWhere.push({ kind: "triple", subject: target, predicate: variable("p"), object: variable("o") });
      discoveryWhere.push({ kind: "filter", expression: binary("!=", termExpr(variable("p")), termExpr(iriTerm(RDF_TYPE))) });
    } else if (view === FCT_VIEW_TYPES.PROPERTIES_IN) {
      discoveryWhere.push({ kind: "triple", subject: variable("related"), predicate: variable("p"), object: target });
    } else if (view === FCT_VIEW_TYPES.CLASSES) {
      discoveryWhere.push({ kind: "triple", subject: target, predicate: iriTerm(RDF_TYPE), object: variable("c") });
    }
    // Empty root queries (and FILTER-only scopes) have no data-bearing pattern
    // from which to select a matching named graph. GRAPH ?g {} may enumerate
    // the server's entire graph catalog and time out while the server is green.
    // The route skips this probe and lets the live default-dataset query run.
    const hasSourcePattern = (patterns: SparqlPattern[]): boolean => patterns.some(pattern => {
      if (pattern.kind === "triple" || pattern.kind === "path" || pattern.kind === "full-text") return true;
      if (pattern.kind === "union") return pattern.branches.some(hasSourcePattern);
      if (pattern.kind === "subquery") return hasSourcePattern(pattern.query.where);
      if (pattern.kind === "group" || pattern.kind === "graph" || pattern.kind === "service" ||
          pattern.kind === "optional" || pattern.kind === "quad-map") return hasSourcePattern(pattern.patterns);
      return false; // FILTER, BIND and NOT EXISTS alone cannot select a named graph.
    });
    graphDiscoveryHasSourcePattern = hasSourcePattern(discoveryWhere);
    // A full-graph GROUP BY and MAX(IRI_RANK) can take minutes on large
    // endpoints (and LONG::IRI_RANK is Virtuoso-specific). The service first
    // attempts the original ranked discovery, then can retry this same FCT
    // scope without aggregation as a bounded first-match fallback.
    if (discoverGraph === "first") {
      query = buildStatusSelect({
        directives,
        projections: [{ expression: termExpr(variable("g")), as: variable("c1") }],
        where: [{ kind: "graph", graph: variable("g"), patterns: discoveryWhere }],
        limit: 1,
        offset: 0,
      });
    } else {
    query = buildStatusSelect({
      directives,
      projections: [
        { expression: termExpr(variable("g")), as: variable("c1") },
        { expression: { kind: "aggregate", name: "MAX", distinct: false,
            expression: { kind: "function", name: "<LONG::IRI_RANK>", args: [termExpr(target)] } },
          as: variable("bestRank") },
      ],
      where: [{ kind: "graph", graph: variable("g"), patterns: discoveryWhere }],
      groupBy: [termExpr(variable("g"))],
      orderBy: [
        { expression: termExpr(variable("bestRank")), direction: "DESC" },
        { expression: termExpr(variable("g")), direction: "ASC" },
      ],
      limit: 1,
      offset: 0,
    });
    }
  } else if (view === FCT_VIEW_TYPES.VALIDATE && !graphOnly && !countOnly) {
    // A standards-oriented SHACL *target-discovery* view, not SHACL validation.
    // The four W3C SHACL Core targets are joined against the exact selected
    // FCT focus, properties, and (inferred) classes. Missing properties must
    // NOT suppress the node's property shapes (e.g. sh:minCount).
    // This is built entirely in the compiler AST; generated SPARQL is opaque.
    const SH = "http://www.w3.org/ns/shacl#";
    const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    const shapeGraph = federation?.validateShapesGraph ?? "urn:maestro:validate:context-required";
    if (!iri(shapeGraph)) throw new Error("The SHACL graph for validate must be an IRI.");
    const graphShape = iriTerm(shapeGraph);
    const shape = variable("maestroShape");
    const cls = variable("maestroTargetClass");
    const observed = variable("maestroObservedClass");
    const predicate = variable("maestroPredicate");
    const value = variable("maestroValue");
    const subject = variable("maestroSubject");
    const propShape = variable("maestroPropertyShape");
    const rawPath = variable("maestroRawPath");
    const path = variable("maestroResolvedPath");
    const direction = variable("maestroDirection");
    const alternative = variable("maestroAlternativePath");
    const rdfSubject = (p: SparqlPattern[]): SparqlPattern[] => graphTerm
      ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...p] }]
      : [...where, ...p];
    // Scope stays on the live graph server. Every branch is compiled from
    // original FCT constraints and contributes bindings to the local SHACL
    // GRAPH join on the authenticated personal graph server.
    const data = (patterns: SparqlPattern[]): SparqlPattern[] =>
      statusScope(rdfSubject(patterns));
    const target = (predicateIri: string, object: SparqlTerm): SparqlPattern => ({
      kind: "graph", graph: graphShape, patterns: [
        { kind: "triple", subject: shape, predicate: iriTerm(`${SH}${predicateIri}`), object },
      ],
    });
    const branchList: SparqlPattern[][] = [
      [...data([]), target("targetNode", state.target ?? variable("s1"))],
      // The W3C RDFS universal class applies even when the source endpoint
      // does not expose a materialized rdf:type rdfs:Resource assertion.
      // This is essential for generic StateMachineProvider policies and
      // is independent of whether Virtuoso has a configured inference set.
      [...data([]), target("targetClass", iriTerm("http://www.w3.org/2000/01/rdf-schema#Resource"))],
      [...data([
        { kind: "triple", subject: state.target ?? variable("s1"), predicate: iriTerm(RDF_TYPE), object: observed },
        { kind: "path", subject: observed, predicate: iriTerm(RDFS_SUBCLASS_OF), modifier: "*", object: cls },
      ]), target("targetClass", cls)],
      [...data([{ kind: "triple", subject: state.target ?? variable("s1"), predicate, object: value }]),
        target("targetSubjectsOf", predicate)],
      [...data([{ kind: "triple", subject, predicate, object: state.target ?? variable("s1") }]),
        target("targetObjectsOf", predicate)],
    ];
    // SHACL property paths are RDF terms, not necessarily predicate IRIs.
    // Expand simple, inverse and alternative paths for the Personal facet UI,
    // retaining the node shape even when no path can be represented as a
    // single FCT property or property-of filter.
    const pathChoices: SparqlPattern = { kind: "union", branches: [
      [
        { kind: "filter", expression: { kind: "function", name: "isIRI", args: [termExpr(rawPath)] } },
        { kind: "bind", expression: termExpr(rawPath), as: path },
        { kind: "bind", expression: termExpr(literalTerm("forward")), as: direction },
      ],
      [
        { kind: "triple", subject: rawPath, predicate: iriTerm(`${SH}inversePath`), object: path },
        { kind: "filter", expression: { kind: "function", name: "isIRI", args: [termExpr(path)] } },
        { kind: "bind", expression: termExpr(literalTerm("reverse")), as: direction },
      ],
      [
        { kind: "triple", subject: rawPath, predicate: iriTerm(`${SH}alternativePath`), object: alternative },
        { kind: "path", subject: alternative, predicate: iriTerm(`${RDF}rest`), modifier: "*", object: variable("maestroListNode") },
        { kind: "triple", subject: variable("maestroListNode"), predicate: iriTerm(`${RDF}first`), object: path },
        { kind: "filter", expression: { kind: "function", name: "isIRI", args: [termExpr(path)] } },
        { kind: "bind", expression: termExpr(literalTerm("forward")), as: direction },
      ],
    ] };
    query = buildSelectQuery({
      directives, distinct: true,
      projections: [
        { expression: termExpr(shape), as: variable("c1") },
        { expression: termExpr(propShape), as: variable("c2") },
        { expression: termExpr(path), as: variable("c3") },
        { expression: termExpr(direction), as: variable("c4") },
      ],
      where: [
        { kind: "union", branches: branchList },
        { kind: "optional", patterns: [{ kind: "graph", graph: graphShape, patterns: [
          { kind: "triple", subject: shape, predicate: iriTerm(`${SH}property`), object: propShape },
          { kind: "triple", subject: propShape, predicate: iriTerm(`${SH}path`), object: rawPath },
          { kind: "optional", patterns: [pathChoices] },
        ] }] },
      ],
      limit: Math.min(limit, 1000), offset,
    });
  } else if (view === FCT_VIEW_TYPES.ASK && !graphOnly && !countOnly) {
    // The ASK query uses the cloned FCT scope unchanged. Clients can add
    // a label relationship as an ordinary <property> condition in that clone.
    query = buildStatusAsk(directives, scopedWhere);
  } else if (graphOnly && viewNode?.attributes.record === "yes") {
    // Record graph marshalling is an ordinary FCT Graphs projection. The
    // original FCT selection binds ?c1 before resolving the physical graphs
    // containing incoming and outgoing Record triples. A blank-node label is
    // never carried across requests. The inner candidate ceiling is separate
    // from the number of distinct graph results.
    const candidatesRaw = Number(viewNode.attributes.candidates ?? 100);
    if (!Number.isSafeInteger(candidatesRaw) || candidatesRaw < 1 || candidatesRaw > 10000 || offset > 1000000 || limit > 500)
      throw new Error("Record graph projection requires candidates=1–10000, offset=0–1000000 and limit<=500.");
    const focus = variable("recordFocus");
    const graphName = variable("recordGraph");
    const candidateOffset = Number(viewNode.attributes.candidateOffset ?? 0);
    if (!Number.isSafeInteger(candidateOffset) || candidateOffset < 0 || candidateOffset > 1000000)
      throw new Error("Record graph projection candidateOffset must be 0–1000000.");
    // The URI Record marshaller supplies a bare root URI value. Binding that
    // IRI directly is both cheaper and more exact than first enumerating its
    // outgoing/incoming triples and then doing that work again in GRAPH ?g.
    const rootValue = root.children.find(node => node.name === "value" && node.attributes.datatype === "uri");
    const directUri = viewParent === root && root.children.every(node => node.name === "view" || node === rootValue)
      && rootValue ? iri(rootValue.text.trim()) : null;
    const focusQuery: SparqlSelectQuery = {
      kind: "select", directives: [], distinct: true,
      projections: [{ expression: termExpr(directUri ?? target), as: focus }],
      where: directUri ? [] : [...scopedWhere, ...(viewNode.attributes.bnode === "yes"
        ? [{ kind: "filter" as const, expression: { kind: "function" as const, name: "isBlank", args: [termExpr(target)] } }]
        : [])],
      limit: candidatesRaw, offset: candidateOffset,
    };
    // Never global-scan RDF graph names when the *compiled focus query*
    // contains an explicit GRAPH binding. It is an execution constraint,
    // not a guess from the selected appbar graph or the previous Record.
    const membership: SparqlPattern[] = graphTerm
      ? [{ kind: "bind", expression: termExpr(graphTerm), as: graphName }]
      : [{ kind: "graph", graph: graphName, patterns: [{
          kind: "union", branches: [
            [{ kind: "triple", subject: focus, predicate: variable("recordPredicate"), object: variable("recordObject") }],
            [{ kind: "triple", subject: variable("recordSubject"), predicate: variable("recordPredicate"), object: focus }],
          ],
        }] }];
    query = buildStatusSelect({
      directives, distinct: true,
      projections: [{ expression: termExpr(graphName), as: variable("c1") }],
      where: [{ kind: "subquery", query: focusQuery }, ...membership],
      limit, offset,
    });
  } else if (graphOnly) {
    // The Graphs view is the live view's result-set WHERE, evaluated per named
    // graph. The projected graph is associated with each matching focus item.
    // Query distinct graph URIs directly, bounded by the Graphs Sheet LIMIT.
    // Client-side paging is independent of the number of rows requested.
    const resultPatterns = buildIndexedTextWhere();
    const graphWhere: SparqlPattern[] = [{
      kind: "graph", graph: variable("g"), patterns: resultPatterns,
    }];
    if (graphTerm) graphWhere.push({ kind: "filter", expression: binary("=", termExpr(variable("g")), termExpr(graphTerm)) });
    if (countOnly) {
      query = buildStatusSelect({ directives, projections: [countProjection(variable("g"))], where: graphWhere });
    } else {
      // Graphs is discovery, not ranking: one URI per matching named graph.
      // Distinct is bounded by the Sheet's Graphs LIMIT; no blocking aggregate.
      // IRI_RANK is reserved for discoverGraph (the auto-fill LIMIT 1 branch).
      query = buildStatusSelect({
        directives,
        distinct: true,
        projections: [{ expression: termExpr(variable("g")), as: variable("c1") }],
        where: graphWhere,
        limit,
        offset,
      });
    }

	} else if (countOnly) {
    let counted: SparqlTerm;
    let countWhere = view === FCT_VIEW_TYPES.COUNT_DISTINCT && viewNode?.attributes.index
      ? buildIndexedTextWhere() : scopedWhere;
    if (view === FCT_VIEW_TYPES.PROPERTIES) {
      counted = variable("p");
      countWhere = scopeWith([{ kind: "triple", subject: target, predicate: variable("p"), object: variable("o") },
        { kind: "filter", expression: binary("!=", termExpr(variable("p")), termExpr(iriTerm(RDF_TYPE))) },
        ...preferredValueLanguageFilter(variable("o"), viewNode, viewParent, preferredLanguage),
        ...viewValueFilter(viewNode?.attributes, variable("o"))]);
    } else if (view === FCT_VIEW_TYPES.CLASSES) {
      counted = variable("c");
      countWhere = scopeWith([{ kind: "triple", subject: target, predicate: iriTerm(RDF_TYPE), object: variable("c") }]);
    } else if (view === FCT_VIEW_TYPES.PROPERTIES_IN) {
      counted = variable("p");
      countWhere = scopeWith([{ kind: "triple", subject: variable("related"), predicate: variable("p"), object: target },
        ...viewValueFilter(viewNode?.attributes, variable("related"))]);
    } else {
      counted = target;
      countWhere = view === FCT_VIEW_TYPES.COUNT_DISTINCT && viewNode?.attributes.index
        ? buildIndexedTextWhere()
        : graphTerm
          ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)] }]
          : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)];
    }
    query = buildStatusSelect({ directives, projections: [countProjection(counted)], where: countWhere });
  } else if (synset) {
    const parent = synsetDetached ? target : state.focusParent?.term;
    if (!parent || !viewParent || !synsetAlgorithm) throw new Error("Cannot resolve the synset carrier's parent population.");
    const carrier = viewParent.attributes.iri;
    const forward = viewParent.name === "property";
    if (state.statusBindings.length && federation && canonical(federation.liveEndpoint)!==canonical(federation.executionEndpoint))
      throw new Error("Property synset requires mining on the selected graph server; cross-server Status constraints are not supported.");
    synsetPlan = compilePredicateSynset({algorithm:synsetAlgorithm,carrier,forward,parent,directives,
      scope: patterns=>statusScope(scopeWith(patterns)), maxCandidates:maxPredicateCandidates!, attributes:viewNode!.attributes});
    query = synsetPlan.query;
  } else if (predicateAnalysisView) {
    // Keep the original incidence projection for structural ranking and AHC.
    // FUR needs the full focus population and exact value-count frequencies.
    const stage = predicateAnalysisStage ?? {kind: rankingAlgorithm === "fur" ? "value-counts" as const : "incidence" as const, offset: 0, limit: 500};
    const property = variable("maestroPredicate");
    const object = variable("maestroPropertyObject");
    const facetWhere = scopeWith([
      {kind:"triple",subject:target,predicate:property,object},
      {kind:"filter",expression:binary("!=",termExpr(property),termExpr(iriTerm(RDF_TYPE)))},
      ...preferredValueLanguageFilter(object,viewNode,viewParent,preferredLanguage),
      ...viewValueFilter(viewNode?.attributes,object),
    ]);
    if (stage.kind === "population") {
      query = buildStatusSelect({ directives, projections: [countProjection(target)], where: scopedWhere });
    } else {
      const { offset: incidenceOffset, limit: incidenceLimit } = stage;
      if (!Number.isSafeInteger(incidenceOffset) || incidenceOffset < 0 ||
          !Number.isSafeInteger(incidenceLimit) || incidenceLimit < 1 || incidenceLimit > 1000 ||
          !Number.isSafeInteger(incidenceOffset + incidenceLimit))
        throw new Error("Invalid predicate incidence page bounds.");
      if (stage.kind === "coverage") {
        query = buildStatusSelect({ directives,
          projections: [{expression:termExpr(property)}, countProjection(target)],
          where: facetWhere, groupBy:[termExpr(property)],
          orderBy:[{expression:termExpr(property),direction:"ASC"}],
          limit:incidenceLimit, offset:incidenceOffset,
        });
      } else if (stage.kind === "value-counts") {
        // Inner grouping preserves RDF value identity at the endpoint. The outer
        // histogram returns only (predicate, facet count, number of values).
        // No lexical values or response-local blank-node labels cross pages.
        const n = variable("n");
        const groupedValues: SparqlSelectQuery = {kind:"select",directives:[],
          projections:[{expression:termExpr(property)},countProjection(target)],
          where:statusScope(facetWhere),groupBy:[termExpr(property),termExpr(object)]};
        query = buildSelectQuery({directives,
          projections:[{expression:termExpr(property)}, {expression:termExpr(n)},
            {expression:{kind:"aggregate",name:"COUNT",distinct:false,expression:termExpr({kind:"raw-term",value:"*"})},as:variable("frequency")}],
          where:[{kind:"subquery",query:groupedValues}],groupBy:[termExpr(property),termExpr(n)],
          orderBy:[{expression:termExpr(property),direction:"ASC"},{expression:termExpr(n),direction:"ASC"}],
          limit:incidenceLimit,offset:incidenceOffset,
        });
      } else {
        query = buildStatusSelect({ directives, distinct: true,
          projections: [{expression:termExpr(target)}, {expression:termExpr(property)}],
          where:facetWhere,
          orderBy:[{expression:termExpr(target),direction:"ASC"},{expression:termExpr(property),direction:"ASC"}],
          limit:incidenceLimit, offset:incidenceOffset,
        });
      }
    }
  } else if (view === FCT_VIEW_TYPES.PROPERTIES || view === FCT_VIEW_TYPES.CLASSES || view === FCT_VIEW_TYPES.PROPERTIES_IN) {
    const facet = variable(view === FCT_VIEW_TYPES.CLASSES ? "c" : "p");
    const sampleClasses = view === FCT_VIEW_TYPES.CLASSES && ["yes", "true", "1"].includes((viewNode?.attributes.sample ?? "").trim().toLowerCase());
    const subject = view === FCT_VIEW_TYPES.PROPERTIES_IN ? variable("related") : target;
    const predicate = view === FCT_VIEW_TYPES.CLASSES ? iriTerm(RDF_TYPE) : view === FCT_VIEW_TYPES.PROPERTIES_IN ? facet : facet;
    const object = view === FCT_VIEW_TYPES.PROPERTIES_IN ? target : view === FCT_VIEW_TYPES.CLASSES ? facet : variable("o");
    // <view type="classes" tree="yes">: list every class of the result set AND all of its superclasses up
    // to the root (rdf:type/rdfs:subClassOf*), one row per (class, immediate parent). A class with several
    // parents therefore appears once per parent; a root has no parent column value. The count is still the
    // number of distinct result resources that are instances of the class (directly or via a subclass).
    const classTree = view === FCT_VIEW_TYPES.CLASSES && ["yes", "true", "1", "on"].includes((viewNode?.attributes.tree ?? "").trim().toLowerCase());
    const parent = variable("parent");
    const treePath: SparqlTerm = { kind: "raw-term", value: `<${RDF_TYPE}>/<${RDFS_SUBCLASS_OF}>*` };
    const facetWhere: SparqlPattern[] = classTree
      ? [
          ...scopeWith([
            { kind: "triple", subject, predicate: treePath, object },
            { kind: "filter", expression: { kind: "function", name: "isIRI", args: [termExpr(facet)] } },
          ]),
          { kind: "optional", patterns: [
            { kind: "triple", subject: facet, predicate: iriTerm(RDFS_SUBCLASS_OF), object: parent },
            { kind: "filter", expression: { kind: "function", name: "isIRI", args: [termExpr(parent)] } },
            { kind: "filter", expression: binary("!=", termExpr(parent), termExpr(facet)) },
          ] },
        ]
      : [
          ...scopeWith([
            { kind: "triple", subject, predicate, object } satisfies SparqlPattern,
            // rdf:type belongs to Categories. It is not an available forward property.
            ...(view === FCT_VIEW_TYPES.PROPERTIES ? [
              { kind: "filter", expression: binary("!=", termExpr(facet), termExpr(iriTerm(RDF_TYPE))) } satisfies SparqlPattern,
              ...preferredValueLanguageFilter(variable("o"), viewNode, viewParent, preferredLanguage),
              ...viewValueFilter(viewNode?.attributes, variable("o")),
            ] : []),
            ...(view === FCT_VIEW_TYPES.PROPERTIES_IN ? viewValueFilter(viewNode?.attributes, variable("related")) : []),
          ]),
        ];
    const projections: SparqlProjection[] = [
      { expression: termExpr(facet), as: variable("c1") },
      countProjection(view === FCT_VIEW_TYPES.PROPERTIES_IN ? variable("related") : target),
    ];
    if (classTree) {
      projections.push({ expression: termExpr(parent) });
    } else if (view === FCT_VIEW_TYPES.PROPERTIES) {
      projections.push({
        expression: { kind: "aggregate", name: "SAMPLE", distinct: false, expression: termExpr(variable("o")) },
        as: variable("sampleVal"),
      });
    } else if (view === FCT_VIEW_TYPES.PROPERTIES_IN) {
      projections.push({
        expression: { kind: "aggregate", name: "SAMPLE", distinct: false, expression: termExpr(variable("related")) },
        as: variable("sampleVal"),
      });
    }
    if (countFreeFacet) {
      // Recovery after a rejected aggregate. Preserve the scoped WHERE patterns,
      // but neither compute counts nor sort by them. The list is not a count.
      query = buildStatusSelect({
        directives, distinct: true,
        projections: [{ expression: termExpr(facet), as: variable("c1") }],
        where: facetWhere,
        limit, offset,
      });
    } else if (sampleClasses) {
      // Recovery path for Anytime queries interrupted before their aggregate
      // emits any class rows. Bound the raw class/resource pairs without
      // GROUP BY or ORDER BY; the client computes sampled frequencies.
      query = buildStatusSelect({
        directives, distinct: true,
        projections: [
          { expression: termExpr(facet), as: variable("c1") },
          { expression: termExpr(target), as: variable("sampleResource") },
        ],
        where: facetWhere,
        limit, offset: 0,
      });
    } else query = buildStatusSelect({
      directives,
      projections,
      where: facetWhere,
      groupBy: classTree ? [termExpr(facet), termExpr(parent)] : [termExpr(facet)],
      // With "Order results" on, every non-count query carries an ORDER BY. Count ordering is
      // used when the active Group By facet requests it; otherwise order by the facet IRI so
      // pages are deterministic. ORDER BY runs before LIMIT/OFFSET, so pages are globally sorted.
      // The class tree is always ordered by parent hierarchy (roots, whose parent is unbound, come first),
      // so a limit truncates deterministically.
      ...(classTree
        ? { orderBy: [{ expression: termExpr(parent), direction: "ASC" as const }, { expression: termExpr(facet), direction: "ASC" as const }] }
        : shouldOrder
        ? {
            orderBy: viewNode?.attributes.sort === "count"
              ? [{ expression: termExpr(variable("n")), direction: "DESC" as const }, { expression: { kind: "function", name: "STR", args: [termExpr(facet)] } as SparqlExpression, direction: "ASC" as const }]
              : [{ expression: { kind: "function", name: "STR", args: [termExpr(facet)] } as SparqlExpression, direction: "ASC" as const }],
          }
        : {}),
      limit,
      offset,
    });
  } else if (view === FCT_VIEW_TYPES.LIST_COUNT) {
    const valueLanguageWhere = graphTerm ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)] } satisfies SparqlPattern] : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)];
    query = buildStatusSelect({ directives, projections: [
      { expression: termExpr(target), as: variable("c1") },
      { expression: { kind: "aggregate", name: "COUNT", distinct: false, expression: { kind: "term", term: { kind: "raw-term", value: "*" } } }, as: variable("n") },
    ], where: valueLanguageWhere, groupBy: [termExpr(target)], orderBy: shouldOrder ? [{ expression: termExpr(variable("n")), direction: "DESC" }] : undefined, limit, offset });
  } else if (view === FCT_VIEW_TYPES.ALPHABET) {
    // Group once per initial, counting distinct resources in the *same* FCT
    // focus and label-language scope as a scalar indexed count. Grouping the
    // raw first character (the former implementation) split "Z" and "z",
    // giving incorrect totals when the UI normalized them to one button.
    // BIND the normalized initial before grouping to avoid grouping directly
    // by UCASE(SUBSTR(...)), which triggers Virtuoso SR319 on some endpoints.
    const name = variable("maestroLabel");
    const letter = variable("maestroLetter");
    const firstUpper: SparqlExpression = { kind: "function", name: "SUBSTR", args: [
      { kind: "function", name: "UCASE", args: [
        { kind: "function", name: "STR", args: [termExpr(name)] },
      ] },
      termExpr({ kind: "raw-term", value: "1" }),
      termExpr({ kind: "raw-term", value: "1" }),
    ] };
    const labelPatterns: SparqlPattern[] = [
      { kind: "triple", subject: target, predicate: iriTerm(DEFAULT_INDEX_LABEL), object: name },
      indexLanguageFilter(name, indexLanguage(viewNode, preferredLanguage)),
      { kind: "bind", expression: firstUpper, as: letter },
      { kind: "filter", expression: { kind: "function", name: "REGEX", args: [
        termExpr(letter), termExpr(literalTerm("^[A-Z]$")),
      ] } },
    ];
    const alphabetWhere: SparqlPattern[] = graphTerm
      ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...labelPatterns] }]
      : [...where, ...labelPatterns];
    query = buildStatusSelect({ directives, projections: [
      { expression: termExpr(letter), as: variable("c1") },
      { expression: { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(target) }, as: variable("n") },
    ], where: alphabetWhere, groupBy: [termExpr(letter)], limit: 26, offset: 0 });
  } else if (view === FCT_VIEW_TYPES.YEARS || view === FCT_VIEW_TYPES.MONTHS || view === FCT_VIEW_TYPES.WEEKS || view === FCT_VIEW_TYPES.DAYS) {
    // Lexical bucketing accepts dateTime/date/gYearMonth/gYear without
    // relying on casts that may fail for partial-date literals. Week needs
    // a full date; use Virtuoso's week rounding for those values.
    const length = view === FCT_VIEW_TYPES.YEARS ? 4 : view === FCT_VIEW_TYPES.MONTHS ? 7 : 10;
    const lexical: SparqlExpression = { kind: "function", name: "STR", args: [termExpr(target)] };
    const bucket: SparqlExpression = view === FCT_VIEW_TYPES.WEEKS
      ? { kind: "function", name: "sql::round_week", args: [termExpr(target)] }
      : { kind: "function", name: "SUBSTR", args: [lexical, termExpr(literalTerm("1", undefined, iriTerm("http://www.w3.org/2001/XMLSchema#integer"))), termExpr(literalTerm(String(length), undefined, iriTerm("http://www.w3.org/2001/XMLSchema#integer")))] };
    query = buildStatusSelect({ directives, projections: [
      { expression: bucket, as: variable("c1") },
      { expression: { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(variable("s1")) }, as: variable("n") },
    ], where: graphTerm
      ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)] }]
      : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)], groupBy: [bucket], orderBy: shouldOrder ? [{ expression: bucket, direction: "ASC" }] : undefined, limit, offset });
  } else if (view === FCT_VIEW_TYPES.GEO) {
    const lat = variable("lat"); const long = variable("long");
    const geoWhere: SparqlPattern[] = [...scopedWhere,
      { kind: "triple", subject: target, predicate: iriTerm("http://www.w3.org/2003/01/geo/wgs84_pos#lat"), object: lat },
      { kind: "triple", subject: target, predicate: iriTerm("http://www.w3.org/2003/01/geo/wgs84_pos#long"), object: long },
    ];
    query = buildStatusSelect({ directives, distinct: true, projections: [
      { expression: termExpr(lat), as: variable("c1") },
      { expression: termExpr(long), as: variable("c2") },
      { expression: termExpr(target), as: variable("c3") },
    ], where: geoWhere, orderBy: shouldOrder ? [entityRankOrder(target)] : undefined, limit, offset });
  } else if (view === FCT_VIEW_TYPES.DESCRIBE) {
    if (kindFilteredDescribe && !describeBounds) {
      const seed: SparqlTerm = target;
      const s = variable("s"), p = variable("p"), o = variable("o");
      const selected: SparqlSelectQuery = {kind:"select",directives:[],distinct:true,
        projections:[{expression:termExpr(seed)}],where:scopedWhere,limit:1};
      const triples: SparqlPattern[] = [{kind:"union",branches:[
        [{kind:"triple",subject:seed,predicate:p,object:o},{kind:"bind",expression:termExpr(seed),as:s}],
        [{kind:"triple",subject:s,predicate:p,object:seed},{kind:"bind",expression:termExpr(seed),as:o}],
      ]}];
      const typed = [...triples,...viewValueFilter(viewNode?.attributes,o)];
      query = buildStatusSelect({directives,distinct:true,
        projections:[{expression:termExpr(s)},{expression:termExpr(p)},{expression:termExpr(o)}],
        where:[{kind:"subquery",query:selected},...(graphTerm ? [{kind:"graph" as const,graph:graphTerm,patterns:typed}] : typed)],limit,offset});
    } else if (describeExpanded && describeBounds) {
      if (describeLiteral || target.kind !== "variable" ||
          !root.children.some((child) => child.name === "value" && child.attributes.datatype === "uri"))
        throw new Error('Expanded FCT describe requires an explicit root <value datatype="uri">.');
      if (offset !== 0) throw new Error("Expanded FCT describe does not support offsets; it must return a complete RDF subgraph.");
      // Bind the authoritative FCT focus once. Any bnode identity is retained
      // only inside this SPARQL request; never feed _: response labels back to
      // the endpoint. Do not walk from a bnode through arbitrary named IRIs.
      const seed = target;
      const subject = variable("s");
      const predicate = variable("p");
      const object = variable("o");
      const seedQuery: SparqlSelectQuery = { kind: "select", directives: [], distinct: true,
        projections: [{ expression: termExpr(target) }], where: scopedWhere, limit: 1 };
      const branches: SparqlPattern[][] = [[{ kind: "bind", expression: termExpr(seed), as: subject }]];
      for (let level = 1; level <= describeBounds.depth; level++) {
        const chain: SparqlPattern[] = [];
        let current: SparqlTerm = seed;
        for (let step = 0; step < level; step++) {
          const next = variable(`fctBn_${level}_${step}`);
          chain.push({ kind: "triple", subject: current, predicate: variable(`fctEdge_${level}_${step}`), object: next });
          chain.push({ kind: "filter", expression: { kind: "function", name: "isBlank", args: [termExpr(next)] } });
          current = next;
        }
        branches.push([...chain, { kind: "bind", expression: termExpr(current), as: subject }]);
        // Arbitrarily long RDF collections are traversed in the same SELECT,
        // not by reusing returned blank-node identifiers in a later request.
        // The requested triple cap and endpoint timeout fail closed.
        branches.push([...chain,
          { kind: "path", subject: current, predicate: iriTerm(RDF_REST_IRI), modifier: "*", object: subject },
          { kind: "filter", expression: { kind: "function", name: "isBlank", args: [termExpr(subject)] } },
        ]);
      }
      const forward: SparqlPattern[] = [
        { kind: "union", branches },
        { kind: "triple", subject, predicate, object },
      ];
      const outgoingAndIncoming: SparqlPattern[] = describeBounds.incoming
        ? [{ kind: "union", branches: [forward, [
          { kind: "triple", subject, predicate, object: seed },
          { kind: "bind", expression: termExpr(seed), as: object },
        ]] }]
        : forward;
      const expansionWhere: SparqlPattern[] = [
        { kind: "subquery", query: seedQuery },
        ...(graphTerm ? [{ kind: "graph" as const, graph: graphTerm, patterns: outgoingAndIncoming }] : outgoingAndIncoming),
      ];
      query = buildStatusSelect({ directives, distinct: true,
        projections: [
          { expression: termExpr(subject) },
          { expression: termExpr(predicate) },
          { expression: termExpr(object) },
        ], where: expansionWhere, limit: describeBounds.maxTriples + 1 });
    } else if (describeLiteral && rootLiteralNode) {
      // RDF literals cannot be triple subjects. A literal Record consists of
      // incoming Roles; return their triples using the FCT describe envelope.
      const literal = valueTerm(rootLiteralNode);
      if (!literal || literal.kind !== "literal") throw new Error("Invalid literal Record value.");
      const rolePatterns: SparqlPattern[] = [{ kind: "triple", subject: variable("subject"), predicate: variable("predicate"), object: literal }];
      query = buildStatusSelect({ directives, projections: [
        { expression: termExpr(variable("subject")), as: variable("s") },
        { expression: termExpr(variable("predicate")), as: variable("p") },
        { expression: termExpr(literal), as: variable("o") },
      ], where: graphTerm ? [{ kind: "graph", graph: graphTerm, patterns: rolePatterns }] : rolePatterns, limit, offset });
    } else {
      const document = new SparqlQueryDocument({ kind: "describe", describe: target, directives, projections: [], where: scopedWhere, limit, offset });
      query = document.toString();
    }
  } else if (view === FCT_VIEW_TYPES.TEXT) {
    const indexedWhere = buildIndexedTextWhere();
    const projections: SparqlProjection[] = [{ expression: termExpr(target), as: variable("c1") }];
    if (searchText && textPatterns) {
      const tokens = searchText.match(/[\p{L}\p{N}_]+/gu) ?? [];
      const vector: SparqlExpression = { kind: "function", name: "bif:vector", args: tokens.map((token) => termExpr(literalTerm(token.toUpperCase()))) };
      projections.push({ expression: textNode?.attributes.exact === "true"
        ? { kind: "function", name: "STR", args: [termExpr(variable("txt1"))] }
        : { kind: "function", name: "bif:search_excerpt", args: [vector, termExpr(variable("txt1"))] }, as: variable("c2") });
      // ?txtp1 is already bound by the indexed text pattern; carry its URI
      // through the existing FCT TEXT row without an extra query.
      projections.push({ expression: termExpr(variable("txtp1")), as: variable("matchPredicate") });
    }
    if (badgesEnabled && state.badgeColumns?.length) {
      for (const badgeCol of state.badgeColumns) {
        // A focus can have several URI parents. SAMPLE chooses one anchor
        // without multiplying the paginated focus/excerpt rows.
        projections.push({ expression: { kind: "aggregate", name: "SAMPLE", distinct: false, expression: termExpr(badgeCol.variable) }, as: variable(badgeCol.colName) });
      }
    }
    const orderByList: SparqlOrder[] | undefined = shouldOrder
      ? [entityRankOrder(target)]
      : undefined;
    query = buildStatusSelect({ directives, distinct: true, projections, where: indexedWhere, orderBy: orderByList,
      ...((badgesEnabled && state.badgeColumns?.length) ? { groupBy: [termExpr(target),
        ...(searchText && textPatterns ? [termExpr(variable("txt1")),termExpr(variable("txtp1"))] : [])] } : {}),
      limit, offset });
  } else if (view === FCT_VIEW_TYPES.LIST_STATUS) {
    const focusWhere = graphTerm
      ? [{kind:"graph" as const,graph:graphTerm,patterns:[...where,...preferredValueLanguageFilter(target,viewNode,viewParent, preferredLanguage)]}]
      : [...where,...preferredValueLanguageFilter(target,viewNode,viewParent, preferredLanguage)];
    if (federation) {
      // The derived Status view groups the VERIFIED bookmarked selection. Its
      // source status assertion is represented by the configured status graph.
      // No SELECT/WHERE fragments are extracted from generated SPARQL.
      const statusVariable = variable("status0");
      const source = canonical(federation.liveEndpoint) === canonical(federation.executionEndpoint)
        ? focusWhere : [{kind:"service" as const,endpoint:iriTerm(federation.liveEndpoint),patterns:focusWhere}];
      const address = parseStatusAddress(federation.defaultStatusAddr);
      const mui = "gttp://ggg.maestro.ecosys/ns/ui#";
      const statusGraphUri = address.graph;
      const statusPredicate = iriTerm(`${mui}status`);
      // No virtual Pending/Unseen/Approved branches: the widget reports only
      // assertions actually present in the user's status graph.
      const statusPatterns: SparqlPattern[] = [
        {kind:"graph",graph:iriTerm(statusGraphUri),patterns:[
          {kind:"triple",subject:target,predicate:statusPredicate,object:statusVariable},
        ]},
      ];
      query = buildSelectQuery({directives, projections:[
        {expression:termExpr(statusVariable),as:variable("status")},
        {expression:{kind:"aggregate",name:"COUNT",distinct:true,expression:termExpr(target)},as:variable("count")},
      ],where:[...source,...statusPatterns,{kind:"filter",expression:{kind:"function",name:"isIRI",args:[termExpr(target)]}}],
      groupBy:[termExpr(statusVariable)]});
    } else {
      // The SPA can intersect personal Status subjects with the complete
      // remote FCT population without Virtuoso SERVICE metadata registration.
      // Keep the VALUES constraint inside the FCT AST so no SPARQL
      // string rewriting or lossy approximation of its scope is required.
      const candidateFilter: SparqlPattern[] = statusCandidateIris === undefined ? [] : [{
        kind: "values", variable: target,
        values: statusCandidateIris.map(uri => {
          if (!iri(uri)) throw new Error("Invalid IRI in the Status candidate batch.");
          return iriTerm(uri);
        }),
      }];
      query = buildSelectQuery({directives,distinct:true,
        projections:[{expression:termExpr(target),as:variable("c1")}],where:[...candidateFilter, ...focusWhere]});
    }
  } else if (propertyUsageView) {
    // The current focus ?target is a *predicate resource*, proven by
    // rdf:type rdf:Property in the same focus context. Search where that
    // resource occurs as a predicate, not where it occurs as an object.
    const usageSubject = variable("maestroUsageSubject");
    const usageObject = variable("maestroUsageObject");
    const projected = view === FCT_VIEW_TYPES.LIST_SUBJECTS ? usageSubject : usageObject;
    const traversal: SparqlPattern[] = [{ kind: "triple", subject: usageSubject, predicate: target, object: usageObject }];
    // Native Subjects/Objects widget bindings use <subject>/<object><value>
    // in the view's class scope. The <view> element stays empty. A selection
    // constrains the corresponding endpoint of the variable-predicate triple.
    // As with other facet widgets, multiple checked terms are alternatives.
    for (const direction of ["subject", "object"] as const) {
      const bindings = (viewParent ?? root).children.filter((node) => node.name === direction)
        .flatMap((node) => node.children.filter((child) => child.name === "value"));
      const terms = bindings.map(node => valueTerm(node)).filter((term): term is SparqlTerm => term !== null);
      if (terms.length) traversal.push({ kind: "filter", expression: {
        kind: "in", value: termExpr(direction === "subject" ? usageSubject : usageObject), options: terms,
      } });
    }
    // The facet widgets request sort="count": counts are the number of
    // distinct counterpart terms, not a misleading count of property IRIs.
    const countSorted = viewNode?.attributes.sort === "count";
    const counterpart = view === FCT_VIEW_TYPES.LIST_SUBJECTS ? usageObject : usageSubject;
    const usageWhere = scopeWith([...traversal, ...preferredValueLanguageFilter(projected, viewNode, viewParent, preferredLanguage)]);
    const countExpression: SparqlExpression = { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(counterpart) };
    const sorted: SparqlOrder[] | undefined = countSorted && shouldOrder
      ? [{ expression: countExpression, direction: "DESC" }, { expression: { kind: "function", name: "STR", args: [termExpr(projected)] }, direction: "ASC" }]
      : shouldOrder ? [{ expression: { kind: "function", name: "STR", args: [termExpr(projected)] }, direction: "ASC" }] : undefined;
    query = buildStatusSelect({ directives, distinct: !countSorted,
      projections: [{ expression: termExpr(projected), as: variable("c1") },
        ...(countSorted ? [{ expression: countExpression, as: variable("ct") }] : [])],
      where: usageWhere, ...(countSorted ? { groupBy: [termExpr(projected)] } : {}),
      orderBy: sorted, limit, offset });
  } else if (view === FCT_VIEW_TYPES.LIST && state.grouping.length > 0) {
    // FCT <view type="list"> remains on the focus. Its immediate-scope
    // <property group="true"> or <property-of group="true"> supplies the
    // grouping predicate and direction. SPARQL is only emitted, never parsed.
    const groupedTerm = variable("groupValue");
    const edges: SparqlPattern[][] = state.grouping.map(({ subject, predicate, direction }) => [
      { kind: "triple", subject: direction === "reverse" ? groupedTerm : subject,
        predicate, object: direction === "reverse" ? subject : groupedTerm },
    ]);
    const groupEdge: SparqlPattern = edges.length === 1 ? edges[0][0] : { kind: "union", branches: edges };
    const groupWhere: SparqlPattern[] = graphTerm
      ? [{ kind: "graph", graph: graphTerm,
          patterns: [...where, groupEdge, ...preferredValueLanguageFilter(groupedTerm, viewNode, viewParent, preferredLanguage)] }]
      : [...where, groupEdge, ...preferredValueLanguageFilter(groupedTerm, viewNode, viewParent, preferredLanguage)];
    const groupCount: SparqlExpression = { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(target) };
    const bucket = (viewNode?.attributes.bucket ?? "").trim();
    const lexical = (viewNode?.attributes.lexical ?? "").trim() === "yes";
    if (bucket && bucket !== "weekday-hour") throw new Error(`Unsupported grouping bucket: ${bucket}`);
    if (bucket && lexical) throw new Error("A list view cannot combine lexical and calendar bucketing.");
    if (bucket === "weekday-hour" && edges.length !== 1)
      throw new Error("A weekday-hour grouping requires one date/time property.");
    if (lexical) groupWhere.push({ kind: "bind",
      expression: { kind: "function", name: "STR", args: [termExpr(groupedTerm)] }, as: variable("groupLabel") });
    const groupKey = lexical ? variable("groupLabel") : groupedTerm;
    if (bucket === "weekday-hour") {
      const datatype: SparqlExpression = { kind: "function", name: "DATATYPE", args: [termExpr(groupedTerm)] };
      groupWhere.push({ kind: "filter", expression: binary("||",
        binary("=", datatype, termExpr(iriTerm("http://www.w3.org/2001/XMLSchema#dateTime"))),
        binary("=", datatype, termExpr(iriTerm("http://www.w3.org/2001/XMLSchema#date"))),
      ) });
      groupWhere.push({ kind: "bind", expression: { kind: "function", name: "bif:dayname", args: [termExpr(groupedTerm)] }, as: variable("weekday") });
      groupWhere.push({ kind: "bind", expression: { kind: "function", name: "bif:hour", args: [termExpr(groupedTerm)] }, as: variable("hour") });
    }
    const projections: SparqlProjection[] = bucket === "weekday-hour" ? [
      { expression: termExpr(variable("weekday")), as: variable("c1") },
      { expression: termExpr(variable("hour")), as: variable("c2") },
      { expression: groupCount, as: variable("ct") },
    ] : [
      { expression: termExpr(groupKey), as: variable("c1") },
      { expression: groupCount, as: variable("ct") },
    ];
    const orderBy: SparqlOrder[] = bucket === "weekday-hour"
      ? [{ expression: termExpr(variable("weekday")), direction: "ASC" }, { expression: termExpr(variable("hour")), direction: "ASC" }]
      : [{ expression: groupCount, direction: "DESC" },
        { expression: { kind: "function", name: "STR", args: [termExpr(groupKey)] }, direction: "ASC" }];
    query = buildStatusSelect({ directives, projections, where: groupWhere,
      groupBy: bucket === "weekday-hour" ? [termExpr(variable("weekday")), termExpr(variable("hour"))] : [termExpr(groupKey)],
      orderBy, limit, offset });
  } else if (view === FCT_VIEW_TYPES.LIST || valueView) {
    const valueLanguageWhere = graphTerm ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)] } satisfies SparqlPattern] : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent, preferredLanguage)];
    // Virtuoso FCT list view selects the RDF term. Its SQL/XML response
    // wrapper resolves the human-readable label; do not call the SQL-only
    // fct_label procedure from inside SPARQL. For an explicitly count-sorted
    const isCountSorted = viewNode?.attributes.sort === "count";
    let subjectTerm = state.targetParent ?? variable("s1");
    if (view === FCT_VIEW_TYPES.LIST && isCountSorted && viewNode?.attributes.countAncestor !== undefined) {
      const lexical = viewNode.attributes.countAncestor;
      const distance = Number(lexical);
      const path = state.focusAncestors ?? [];
      if (!/^\d+$/.test(lexical) || !Number.isSafeInteger(distance) || distance < 1 || distance >= path.length)
        throw new Error("Invalid countAncestor: expected an ancestor of the counted LIST view.");
      subjectTerm = path[path.length - 1 - distance];
    }
    const valueProjection: SparqlProjection = { expression: termExpr(target), as: variable("c1") };
    if (view === FCT_VIEW_TYPES.LIST && isCountSorted) {
      // Start from the same DISTINCT value projection and scoped population as
      // Results, adding only the counted membership term. Deduplicate pairs
      // before aggregation; never alias a grouped RDF term in the aggregate
      // SELECT (the reported Virtuoso response repeated a single label).
      // The counted term is the existing focus/ancestor of the facet path.
      const value = variable("c1");
      const count = variable("ct");
      const population: SparqlSelectQuery = {
        kind: "select", directives: [], distinct: true,
        projections: [valueProjection, { expression: termExpr(subjectTerm) }],
        // Federation and Status constraints belong INSIDE the population.
        where: statusScope(valueLanguageWhere),
      };
      query = buildSelectQuery({
        directives,
        projections: [
          { expression: termExpr(value) },
          { expression: { kind: "aggregate", name: "COUNT", distinct: false,
            expression: termExpr({ kind: "raw-term", value: "*" }) }, as: count },
        ],
        where: [{ kind: "subquery", query: population }],
        groupBy: [termExpr(value)],
        // The root Order results switch still controls sorting, never counting.
        orderBy: shouldOrder ? [
          { expression: termExpr(count), direction: "DESC" },
          { expression: { kind: "function", name: "STR", args: [termExpr(value)] }, direction: "ASC" },
        ] : undefined,
        limit, offset,
      });
    } else {
      query = buildStatusSelect({
        directives,
        distinct: !isCountSorted,
        projections: [
          valueProjection,
          ...(isCountSorted ? [{ expression: { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(subjectTerm) }, as: variable("ct") } as SparqlProjection] : []),
        ],
        where: valueLanguageWhere,
        ...(isCountSorted
          ? {
              groupBy: [termExpr(target)],
              ...(shouldOrder
                ? {
                    orderBy: [
                      { expression: { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(subjectTerm) }, direction: "DESC" as const },
                      { expression: { kind: "function", name: "STR", args: [termExpr(target)] }, direction: "ASC" as const },
                    ],
                  }
                : {}),
            }
          : shouldOrder
              ? { orderBy: [entityRankOrder(target)] }
              : {}),
        limit,
        offset,
      });
    }
  } else {
    query = buildStatusSelect({ directives, distinct: true, projections: [{ expression: termExpr(target), as: variable("c1") }], where: scopedWhere, orderBy: shouldOrder ? [{ expression: { kind: "function", name: "STR", args: [termExpr(target)] }, direction: "ASC" }] : undefined, limit, offset });
  }
  return {
    query,
    view,
    limit,
    offset,
    timeoutMs,
    ...((predicateAnalysisView || synset) ? { maxPredicateCandidates, maxPredicateIncidenceRows } : {}),
    ...(synsetPlan ? { predicateSynset: { algorithm:synsetPlan.algorithm, carrier:synsetPlan.carrier, confidenceN:synsetPlan.confidenceN, budgetQuery:synsetPlan.budgetQuery, ruleBudgetQuery:synsetPlan.ruleBudgetQuery } } : {}),
    ...(rankingAlgorithm ? { predicateRankAlgorithm: rankingAlgorithm } : {}),
    target: serializeTerm(target),
    ...(viewParent && (viewParent.name === "property" || viewParent.name === "property-of") && !viewParent.attributes.derive && iri(viewParent.attributes.iri ?? "") ? {
      focusRelationship: { predicate: viewParent.attributes.iri, direction: viewParent.name === "property" ? "forward" as const : "reverse" as const },
    } : {}),
    graphOnly,
    countOnly,
    ...(discoverGraph ? { graphDiscoveryHasSourcePattern } : {}),
    statusBindings: state.statusBindings,
    datatypeEvidenceQuery,
    datatypeLiteralProbeQuery,
    describeLiteral,
    describeExpanded,
    ...(describeBounds ? { describeMaxTriples: describeBounds.maxTriples } : kindFilteredDescribe ? { describeMaxTriples: limit } : {}),
    badgeColumns: state.badgeColumns?.map(({ colName, property, direction }) => ({ colName, property, direction })),
    ...(valueView ? { listValueProjections } : {}),
    ...(xmlValuePage ? { resourcePage: rootValues.map(node => {
      const term = valueTerm(node, true)!;
      return term.kind === "iri" ? { type: "uri", value: term.value } : term.kind === "literal" ? { type: "literal", value: term.value,
        ...(term.language ? { "xml:lang": term.language } : {}),
        ...(term.datatype?.kind === "iri" ? { datatype: term.datatype.value } : {}) } : (() => { throw new Error("Invalid root RDF value term."); })();
    }) } : {}),
  };
}

export type SparqlBindingTerm = { type: string; value: string; datatype?: string; "xml:lang"?: string };
export type SparqlJsonResults = { head?: { vars?: string[] }; results?: { bindings?: Record<string, SparqlBindingTerm>[] } };