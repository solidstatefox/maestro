import { FCT_VIEW_TYPES, isFctViewType, type FctViewType } from "./fct-view-types";
import { isBlankNodeTerm, bnodeDescribeBounds, RDF_REST_IRI } from "./bnode";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizeFctValue } from "./fct-value-policy";
import { NUMERIC_LEXICAL_PATTERN } from "./virtuoso-numeric-coercion";
import { buildVirtuosoFullTextExpression } from "./virtuoso-full-text";
import { ALL_GRAPHS } from "./graph-address-mode";

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlNode[];
};

export type FctSparqlView = FctViewType;
export type CompiledFctQuery = {
  query: string;
  view: FctSparqlView;
  limit: number;
  offset: number;
  timeoutMs: number;
  target: string;
  graphOnly: boolean;
  countOnly: boolean;
  /** Scoped personal-status constraints, resolved against session graphs on the server. */
  statusBindings: Array<{ variable: string; uri: string; addr?: string }>;
  /** Unpaginated datatype distribution over exactly the same facet-value scope.
   * Its existence, unlike paginated LIST/LIST_COUNT rows, is SHACL evidence. */
  datatypeEvidenceQuery?: string;
  /** A literal-focused DESCRIBE projects incoming Roles as SPARQL SELECT triples. */
  describeLiteral?: boolean;
  /** Opt-in bnode closure uses typed SELECT triples in a single response. */
  describeExpanded?: boolean;
  describeMaxTriples?: number;
  badgeColumns?: Array<{ colName: string; property: string; direction: "forward" | "reverse" }>;
  /** URI parent of a focused relationship, projected in the same Results SELECT. */
  recordParent?: { colName: string; predicate: string; direction: "forward" | "reverse" };
  /** Project all structural ancestors in the same SELECT, nearest URI wins. */
  recordAncestors?: Array<{ colName: string; predicate: string; direction: "forward" | "reverse"; depth: number }>;
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
  | { kind: "group"; patterns: SparqlPattern[] }
  | { kind: "union"; branches: SparqlPattern[][] }
  | { kind: "not-exists"; patterns: SparqlPattern[] }
  | { kind: "optional"; patterns: SparqlPattern[] }
  | { kind: "graph"; graph: SparqlTerm; patterns: SparqlPattern[] }
  | { kind: "service"; endpoint: SparqlTerm; patterns: SparqlPattern[] }
  | { kind: "subquery"; query: SparqlSelectQuery }
  | { kind: "quad-map"; map: SparqlTerm; graph: SparqlTerm; patterns: SparqlPattern[] };

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
  // In particular, SAMPLE(...) AS ?recordParent must remain valid inside
  // the FCT-derived blank-node Record subquery.
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

function valueTerm(node: XmlNode): SparqlTerm | null {
  const datatype = (node.attributes.datatype ?? "").trim();
  const language = (node.attributes["xml:lang"] ?? node.attributes.lang ?? "").trim();
  const value = normalizeFctValue(node.text);
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
  state: { next: number; target: SparqlTerm | null; targetParent: SparqlTerm | null; focusParent?: { term: SparqlTerm; predicate: string; direction: "forward" | "reverse" }; focusAncestors?: SparqlTerm[]; statusBindings: Array<{ variable: string; uri: string; addr?: string }>; badgeColumns?: Array<{ colName: string; property: string; direction: "forward" | "reverse"; variable: SparqlTerm }> },
  isViewScope = true,
  ancestors: SparqlTerm[] = [variable("s1")],
): void {
  for (const node of nodes) {
    if (node.name === "view") {
      state.target = subject;
      state.focusAncestors = ancestors;
      compileConstraints(node.children, subject, patterns, errors, state, false, ancestors);
    } else if (node.name === "text") {
      continue;
    } else if (node.name === "property" || node.name === "property-of") {
      // Every relationship is an FCT constraint, regardless of who added it.
      const predicate = iri(node.attributes.iri ?? "");
      if (!predicate) {
        errors.push(`The FCT <${node.name}> node has a missing or invalid IRI.`);
        continue;
      }
      const related = variable(`s${state.next++}`);
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
      // Every bound value is an independent existential match of the same
      // predicate. Two values on one relationship mean A AND B, not that one
      // ?value variable must simultaneously equal two different terms.
      // Preserve the first binding as the view-bearing/badge variable.
      const valueChildren = node.children.filter((child) => child.name === "value");
      const primaryValue = valueChildren[0];
      const primaryChildren = valueChildren.length < 2 ? node.children : node.children.filter(
        (child) => child.name !== "value" || child === primaryValue);
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
// Language is a view-level attribute so shared URLs and server-side queries
// use the same alphabet semantics as the preferred-language Sheet setting.
function indexLanguage(view: XmlNode | null): string {
  const language = (view?.attributes.indexLang || "en").toLowerCase();
  if (language !== "all" && !/^[a-z]{2,3}$/.test(language)) throw new Error("Invalid alphabet language code.");
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
function preferredValueLanguageFilter(value: SparqlTerm, view: XmlNode | null, viewParent: XmlNode | null): SparqlPattern[] {
  const language = indexLanguage(view);
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
};

export function compileFctXmlToSparql(xml: string, requestedView?: string, graphOnly = false, countOnly = false, discoverGraph = false, countFreeFacet = false, federation?: FctFederationContext): CompiledFctQuery {
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
  // Find the scope carrying the single authoritative FCT <view>.
  // Display-only value columns are declared by the caller's separate
  // list-values transport request; they are never hidden XML attributes.
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
  const timeoutRaw = Number(root.attributes.timeout ?? 0);
  const timeoutMs = Number.isSafeInteger(timeoutRaw) && timeoutRaw >= 0 ? timeoutRaw : 0;
  const orderAttr = (root.attributes.order ?? root.attributes["order-results"] ?? viewNode?.attributes.order ?? "").trim().toLowerCase();
  const shouldOrder = ["yes", "true", "1", "on"].includes(orderAttr);
  const badgesAttr = (viewNode?.attributes.badges ?? root.attributes.badges ?? "").trim().toLowerCase();
  const badgesEnabled = ["yes", "true", "1", "on"].includes(badgesAttr);
  const textNode = root.children.find((node) => node.name === "text");
  const searchText = textNode?.text.trim() ?? "";
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
  } = {
    next: 2,
    target: null,
    targetParent: null,
    statusBindings: [],
    badgeColumns: badgesEnabled ? [] : undefined,
  };
  compileConstraints(root.children, variable("s1"), constraints, errors, state);
  if (errors.length) throw new Error(errors.join(" "));
  const target = state.target ?? variable("s1");
  // A blank node returned from <property><view/> needs its structural URI
  // parent. Project it in this same FCT SELECT, not via optional badges or a
  // second query (a response-local _: label cannot be rebound independently).
  const recordParent = state.focusParent && (view === FCT_VIEW_TYPES.LIST || view === FCT_VIEW_TYPES.TEXT)
    ? state.focusParent : undefined;
  // Every ancestor is part of the original FCT path. When the immediate
  // parent is a blank node, a higher URI ancestor can still anchor its Record.
  // Never reuse a response-local blank-node label in a second query.
  const recordAncestors = recordParent && state.focusAncestors
    ? state.focusAncestors.slice(0, -1).map((term, depth, candidates) => ({
        colName: depth === candidates.length - 1 ? "recordParent" : `recordAncestor${depth}`,
        term, depth, predicate: recordParent.predicate, direction: recordParent.direction,
      }))
    : [];
  const recordParentProjection: SparqlProjection[] = recordAncestors.map(({ term, colName }) => ({
    expression: { kind: "aggregate", name: "SAMPLE", distinct: false, expression: termExpr(term) },
    as: variable(colName),
  }));
  const rootLiteralNode = root.children.find((node) => node.name === "value" &&
    node.attributes.datatype !== "uri" && !isBlankNodeTerm(node.attributes.datatype));
  const describeBounds = view === FCT_VIEW_TYPES.DESCRIBE ? bnodeDescribeBounds(viewNode?.attributes ?? {}) : null;
  const describeExpanded = describeBounds !== null;
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
  view === FCT_VIEW_TYPES.CLASSES;

if (!hasBindingPattern && !viewSuppliesTriple) {
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
      const branches: SparqlPattern[][] = uris.map(uri => [{kind:"graph", graph: iriTerm(address.graph),
        patterns:[{kind:"triple",subject:focus,predicate,object:uri ? iriTerm(uri === "gttp://ggg.maestro.ecosys/ns/ui#New" ? "gttp://ggg.maestro.ecosys/ns/ui#Unseen" : uri) : variable(`status${ordinal++}`)}]}]);
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
          indexLanguageFilter(name, indexLanguage(viewNode)),
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
        ? [{ kind: "graph", graph: graphTerm, patterns: [...indexedPatterns, ...preferredValueLanguageFilter(target, viewNode, viewParent)] }]
        : [...indexedPatterns, ...preferredValueLanguageFilter(target, viewNode, viewParent)];
    return indexedWhere;
  };
  let query: string;
  let datatypeEvidenceQuery: string | undefined;
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
      patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)] } satisfies SparqlPattern]
      : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)];
    datatypeEvidenceQuery = buildStatusSelect({ directives,
      projections: [
        { expression: inferred, as: variable("datatype") },
        { expression: original, as: variable("originalDatatype") },
        { expression: { kind: "aggregate", name: "COUNT", distinct: false, expression: termExpr({ kind: "raw-term", value: "*" }) }, as: variable("ct") },
      ], where: scopedValues, groupBy: [inferred, original] });
  }
  if (discoverGraph) {
    // Rank the *actual focus results* of the live view, then project the named
    // graph that supplies each result. Never rank graph IRIs or preselect an
    // unscoped focus resource whose matching triples are elsewhere.
    const discoveryWhere = view === FCT_VIEW_TYPES.TEXT ? buildIndexedTextWhere() :
      [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)];
    if (view === FCT_VIEW_TYPES.PROPERTIES) {
      discoveryWhere.push({ kind: "triple", subject: target, predicate: variable("p"), object: variable("o") });
      discoveryWhere.push({ kind: "filter", expression: binary("!=", termExpr(variable("p")), termExpr(iriTerm(RDF_TYPE))) });
    } else if (view === FCT_VIEW_TYPES.PROPERTIES_IN) {
      discoveryWhere.push({ kind: "triple", subject: variable("related"), predicate: variable("p"), object: target });
    } else if (view === FCT_VIEW_TYPES.CLASSES) {
      discoveryWhere.push({ kind: "triple", subject: target, predicate: iriTerm(RDF_TYPE), object: variable("c") });
    }
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
    if (!Number.isSafeInteger(candidatesRaw) || candidatesRaw < 1 || candidatesRaw > 10000 || offset !== 0 || limit > 500)
      throw new Error("Record graph projection requires candidates=1–10000, offset=0 and limit<=500.");
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
      limit, offset: 0,
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
        ...preferredValueLanguageFilter(variable("o"), viewNode, viewParent)]);
    } else if (view === FCT_VIEW_TYPES.CLASSES) {
      counted = variable("c");
      countWhere = scopeWith([{ kind: "triple", subject: target, predicate: iriTerm(RDF_TYPE), object: variable("c") }]);
    } else if (view === FCT_VIEW_TYPES.PROPERTIES_IN) {
      counted = variable("p");
      countWhere = scopeWith([{ kind: "triple", subject: variable("related"), predicate: variable("p"), object: target }]);
    } else {
      counted = target;
      countWhere = view === FCT_VIEW_TYPES.COUNT_DISTINCT && viewNode?.attributes.index
        ? buildIndexedTextWhere()
        : graphTerm
          ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)] }]
          : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)];
    }
    query = buildStatusSelect({ directives, projections: [countProjection(counted)], where: countWhere });
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
              ...preferredValueLanguageFilter(variable("o"), viewNode, viewParent),
            ] : []),
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
    const valueLanguageWhere = graphTerm ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)] } satisfies SparqlPattern] : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)];
    query = buildStatusSelect({ directives, projections: [
      { expression: termExpr(target), as: variable("c1") },
      { expression: { kind: "aggregate", name: "COUNT", distinct: false, expression: { kind: "term", term: { kind: "raw-term", value: "*" } } }, as: variable("n") },
    ], where: valueLanguageWhere, groupBy: [termExpr(target)], orderBy: shouldOrder ? [{ expression: termExpr(variable("n")), direction: "DESC" }] : undefined, limit, offset });
  } else if (view === FCT_VIEW_TYPES.ALPHABET) {
    // The large DBpedia Virtuoso graph fails with SR319 for UCASE(SUBSTR(...))
    // grouping, and 26 VALUES prefix tests are much slower. Use the empirically
    // faster expression-based grouping without UCASE or ORDER BY; the client
    // normalizes letters and displays A-Z in a fixed sequence.
    // Use rdfs:label alone to avoid expensive predicate-variable joins.
    // Both grouped counts and active-letter results honor indexLang and include
    // language-neutral labels so their populations stay consistent.
    const name = variable("maestroLabel");
    const labelPredicate = iriTerm(DEFAULT_INDEX_LABEL);
    const letter: SparqlExpression = { kind: "function", name: "SUBSTR", args: [
      { kind: "function", name: "STR", args: [termExpr(name)] },
      termExpr({ kind: "raw-term", value: "1" }),
      termExpr({ kind: "raw-term", value: "1" }),
    ] };
    const labelPatterns: SparqlPattern[] = [
      { kind: "triple", subject: target, predicate: labelPredicate, object: name },
      indexLanguageFilter(name, indexLanguage(viewNode)),
      { kind: "filter", expression: { kind: "function", name: "REGEX", args: [
        letter, termExpr(literalTerm("^[A-Za-z]$")),
      ] } },
    ];
    const alphabetWhere: SparqlPattern[] = graphTerm
      ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...labelPatterns] }]
      : [...where, ...labelPatterns];
    query = buildStatusSelect({ directives, projections: [
      { expression: letter, as: variable("c1") },
      { expression: { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(target) }, as: variable("n") },
    ], where: alphabetWhere, groupBy: [letter], limit: 256, offset: 0 });
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
      ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)] }]
      : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)], groupBy: [bucket], orderBy: shouldOrder ? [{ expression: bucket, direction: "ASC" }] : undefined, limit, offset });
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
    if (describeExpanded && describeBounds) {
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
    }
    // The parent is identity metadata, not a Results badge. SAMPLE keeps
    // one row per focus without multiplying paginated blank-node results.
    projections.push(...recordParentProjection);
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
      ...((recordParent || (badgesEnabled && state.badgeColumns?.length)) ? { groupBy: [termExpr(target),
        ...(searchText && textPatterns ? [termExpr(variable("txt1"))] : [])] } : {}),
      limit, offset });
  } else if (view === FCT_VIEW_TYPES.LIST_STATUS) {
    const focusWhere = graphTerm
      ? [{kind:"graph" as const,graph:graphTerm,patterns:[...where,...preferredValueLanguageFilter(target,viewNode,viewParent)]}]
      : [...where,...preferredValueLanguageFilter(target,viewNode,viewParent)];
    if (federation) {
      // The derived Status view groups the VERIFIED bookmarked selection. Its
      // source status assertion is represented by the configured status graph.
      // No SELECT/WHERE fragments are extracted from generated SPARQL.
      const statusVariable = variable("status0");
      const source = canonical(federation.liveEndpoint) === canonical(federation.executionEndpoint)
        ? focusWhere : [{kind:"service" as const,endpoint:iriTerm(federation.liveEndpoint),patterns:focusWhere}];
      const address = parseStatusAddress(federation.defaultStatusAddr);
      const statusTriples: SparqlPattern[] = [{kind:"graph",graph:iriTerm(address.graph),patterns:[{
        kind:"triple",subject:target,predicate:iriTerm("gttp://ggg.maestro.ecosys/ns/ui#status"),object:statusVariable,
      }]}];
      const statusPatterns = canonical(address.endpoint) === canonical(federation.executionEndpoint)
        ? statusTriples : [{kind:"service" as const,endpoint:iriTerm(address.endpoint),patterns:statusTriples}];
      query = buildSelectQuery({directives, projections:[
        {expression:termExpr(statusVariable),as:variable("status")},
        {expression:{kind:"aggregate",name:"COUNT",distinct:true,expression:termExpr(target)},as:variable("count")},
      ],where:[...source,...statusPatterns,{kind:"filter",expression:{kind:"function",name:"isIRI",args:[termExpr(target)]}}],
      groupBy:[termExpr(statusVariable)]});
    } else {
      query = buildSelectQuery({directives,distinct:true,
        projections:[{expression:termExpr(target),as:variable("c1")}],where:focusWhere});
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
      const terms = bindings.map(valueTerm).filter((term): term is SparqlTerm => term !== null);
      if (terms.length) traversal.push({ kind: "filter", expression: {
        kind: "in", value: termExpr(direction === "subject" ? usageSubject : usageObject), options: terms,
      } });
    }
    // The facet widgets request sort="count": counts are the number of
    // distinct counterpart terms, not a misleading count of property IRIs.
    const countSorted = viewNode?.attributes.sort === "count";
    const counterpart = view === FCT_VIEW_TYPES.LIST_SUBJECTS ? usageObject : usageSubject;
    const usageWhere = scopeWith([...traversal, ...preferredValueLanguageFilter(projected, viewNode, viewParent)]);
    const countExpression: SparqlExpression = { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(counterpart) };
    const sorted: SparqlOrder[] | undefined = countSorted && shouldOrder
      ? [{ expression: countExpression, direction: "DESC" }, { expression: { kind: "function", name: "STR", args: [termExpr(projected)] }, direction: "ASC" }]
      : shouldOrder ? [{ expression: { kind: "function", name: "STR", args: [termExpr(projected)] }, direction: "ASC" }] : undefined;
    query = buildStatusSelect({ directives, distinct: !countSorted,
      projections: [{ expression: termExpr(projected), as: variable("c1") },
        ...(countSorted ? [{ expression: countExpression, as: variable("ct") }] : [])],
      where: usageWhere, ...(countSorted ? { groupBy: [termExpr(projected)] } : {}),
      orderBy: sorted, limit, offset });
  } else if (view === FCT_VIEW_TYPES.LIST || view === FCT_VIEW_TYPES.LIST_VALUES) {
    const valueLanguageWhere = graphTerm ? [{ kind: "graph", graph: graphTerm, patterns: [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)] } satisfies SparqlPattern] : [...where, ...preferredValueLanguageFilter(target, viewNode, viewParent)];
    // Virtuoso FCT list view selects the RDF term. Its SQL/XML response
    // wrapper resolves the human-readable label; do not call the SQL-only
    // fct_label procedure from inside SPARQL. For an explicitly count-sorted
    const isCountSorted = viewNode?.attributes.sort === "count";
    const subjectTerm = state.targetParent ?? variable("s1");
    query = buildStatusSelect({
      directives,
      distinct: !isCountSorted,
      projections: [
        { expression: termExpr(target), as: variable("c1") },
        ...(isCountSorted ? [{ expression: { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(subjectTerm) }, as: variable("ct") } as SparqlProjection] : []),
        ...recordParentProjection,
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
        : recordParent
          ? { groupBy: [termExpr(target)], ...(shouldOrder ? { orderBy: [entityRankOrder(target)] } : {}) }
          : shouldOrder
            ? { orderBy: [entityRankOrder(target)] }
            : {}),
      limit,
      offset,
    });
  } else {
    query = buildStatusSelect({ directives, distinct: true, projections: [{ expression: termExpr(target), as: variable("c1") }], where: scopedWhere, orderBy: shouldOrder ? [{ expression: { kind: "function", name: "STR", args: [termExpr(target)] }, direction: "ASC" }] : undefined, limit, offset });
  }
  return {
    query,
    view,
    limit,
    offset,
    timeoutMs,
    target: serializeTerm(target),
    graphOnly,
    countOnly,
    statusBindings: state.statusBindings,
    datatypeEvidenceQuery,
    describeLiteral,
    describeExpanded,
    ...(describeBounds ? { describeMaxTriples: describeBounds.maxTriples } : {}),
    badgeColumns: state.badgeColumns?.map(({ colName, property, direction }) => ({ colName, property, direction })),
    ...(recordParent ? { recordParent: { colName: "recordParent", predicate: recordParent.predicate, direction: recordParent.direction } } : {}),
    ...(recordAncestors.length ? { recordAncestors: recordAncestors.map(({ colName, depth, predicate, direction }) => ({ colName, depth, predicate, direction })) } : {}),
  };
}

export type SparqlBindingTerm = { type: string; value: string; datatype?: string; "xml:lang"?: string };
export type SparqlJsonResults = { head?: { vars?: string[] }; results?: { bindings?: Record<string, SparqlBindingTerm>[] } };