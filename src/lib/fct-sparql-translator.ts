import { XMLParser, XMLValidator } from "fast-xml-parser";

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlNode[];
};

export type FctSparqlView = "text" | "properties" | "properties-in" | "classes" | "list" | "list-count" | "alphabet" | "geo" | "years" | "months" | "weeks" | "describe" | "graphs";
export type CompiledFctQuery = {
  query: string;
  view: FctSparqlView;
  limit: number;
  offset: number;
  timeoutMs: number;
  target: string;
  graphOnly: boolean;
  countOnly: boolean;
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
  | { kind: "aggregate"; name: "COUNT"; distinct: boolean; expression: SparqlExpression }
  | { kind: "in"; value: SparqlExpression; options: SparqlTerm[] };

type SparqlPattern =
  | { kind: "triple"; subject: SparqlTerm; predicate: SparqlTerm; object: SparqlTerm; options?: SparqlDirective[] }
  | { kind: "full-text"; value: SparqlTerm; search: SparqlTerm }
  | { kind: "filter"; expression: SparqlExpression }
  | { kind: "group"; patterns: SparqlPattern[] }
  | { kind: "graph"; graph: SparqlTerm; patterns: SparqlPattern[] }
  | { kind: "quad-map"; map: SparqlTerm; graph: SparqlTerm; patterns: SparqlPattern[] };

type SparqlProjection = { expression: SparqlExpression; as?: SparqlTerm };
type SparqlOrder = { expression: SparqlExpression; direction: "ASC" | "DESC" };
type SparqlDirective = { name: "input:inference" | "input:same-as"; value: string };
type SparqlSelectQuery = {
  kind: "select" | "describe";
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
  trimValues: true,
});

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";


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
    case "full-text": return `${indent}${serializeTerm(pattern.value)} bif:contains ${serializeTerm(pattern.search)} .`;
    case "filter": return `${indent}FILTER ${serializeExpression(pattern.expression)}`;
    case "group": return `${indent}{\n${pattern.patterns.map((item) => serializePattern(item, depth + 1)).join("\n")}\n${indent}}`;
    case "graph": return `${indent}GRAPH ${serializeTerm(pattern.graph)} {\n${pattern.patterns.map((item) => serializePattern(item, depth + 1)).join("\n")}\n${indent}}`;
    case "quad-map": return `${indent}quad map ${serializeTerm(pattern.map)} { graph ${serializeTerm(pattern.graph)} {\n${pattern.patterns.map((item) => serializePattern(item, depth + 2)).join("\n")}\n${indent}  } }`;
  }
}

function serializeSparqlQuery(document: SparqlDocument): string {
  const query = document.query;
  const lines = query.directives.map((directive) => `DEFINE ${directive.name} ${serializeTerm(literalTerm(directive.value))}`);
  const projection = query.projections.map((item) => item.as
    ? `${serializeExpression(item.expression)} AS ${serializeTerm(item.as)}`
    : serializeExpression(item.expression)).join("\n       ");
  if (query.kind === "describe") {
    if (!query.describe) throw new Error("A DESCRIBE query requires a target term.");
    lines.push(`DESCRIBE ${serializeTerm(query.describe)}`);
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
  if (datatype.toLowerCase() === "uri" || datatype.toLowerCase() === "url") return iri(node.text);
  if (datatype.toLowerCase() === "bnode" || datatype.toLowerCase() === "blank-node") return null;
  if (language && !/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(language)) return null;
  if (language) return literalTerm(node.text, language);
  if (!datatype || ["string", "literal", "plainstring", "http://www.openlinksw.com/schemas/facets/dtp/plainstring"].includes(datatype.toLowerCase())) return literalTerm(node.text);
  const datatypeIri = iri(datatype);
  return datatypeIri ? literalTerm(node.text, undefined, datatypeIri) : null;
}

function searchTerms(searchText: string): SparqlTerm | null {
  const terms = searchText.match(/[\p{L}\p{N}_]+\*?/gu) ?? [];
  if (!terms.length) return null;
  // Match Virtuoso FCT's documented convention: quote a single token (keeping
  // a trailing * as a prefix wildcard), and AND together multiple tokens.
  if (terms.length === 1) {
    const token = terms[0].replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return literalTerm(`"${token}"`);
  }
  return literalTerm(`(${terms.map((term) => term.toUpperCase()).join(" AND ")})`);
}

function fullTextPatterns(searchText: string, textProperty?: string): SparqlPattern[] | null {
  const search = searchTerms(searchText);
  if (!search) return null;
  const patterns: SparqlPattern[] = [
    { kind: "triple", subject: variable("s1"), predicate: variable("txtp1"), object: variable("txt1") },
    { kind: "full-text", value: variable("txt1"), search },
  ];
  const property = (textProperty ?? "").trim();
  // Per the FCT XML protocol, an omitted text/@property (or property="none")
  // searches any property. When property is specified, restrict text matching
  // to that one predicate.
  if (property && property.toLowerCase() !== "none") {
    const propertyTerm = iri(property);
    if (!propertyTerm) throw new Error("The FCT <text> property attribute must be an IRI or 'none'.");
    patterns.push({ kind: "filter", expression: { kind: "in", value: termExpr(variable("txtp1")), options: [propertyTerm] } });
  }
  return patterns;
}

function compileConstraints(nodes: XmlNode[], subject: SparqlTerm, patterns: SparqlPattern[], errors: string[], state: { next: number; target: SparqlTerm | null }): void {
  for (const node of nodes) {
    if (node.name === "view") {
      state.target = subject;
      compileConstraints(node.children, subject, patterns, errors, state);
    } else if (node.name === "text") {
      continue;
    } else if (node.name === "property" || node.name === "property-of") {
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
      patterns.push(node.name === "property"
        ? { kind: "triple", subject, predicate, object: related, ...(options.length ? { options } : {}) }
        : { kind: "triple", subject: related, predicate, object: subject, ...(options.length ? { options } : {}) });
      compileConstraints(node.children, related, patterns, errors, state);
    } else if (node.name === "class") {
      const classIri = iri(node.attributes.iri ?? "");
      if (!classIri) errors.push("The FCT <class> node has a missing or invalid IRI.");
      else {
        const inference = node.attributes.inference?.trim();
        patterns.push({ kind: "triple", subject, predicate: iriTerm(RDF_TYPE), object: classIri, ...(inference ? { options: [{ name: "input:inference", value: inference }] } : {}) });
      }
      compileConstraints(node.children, subject, patterns, errors, state);
    } else if (node.name === "value") {
      const term = valueTerm(node);
      if (!term) {
        errors.push("An FCT value cannot be represented safely as a SPARQL term.");
        continue;
      }
      const op = (node.attributes.op ?? "=").trim().toLowerCase();
      const operators: Record<string, string> = { "": "=", "=": "=", eq: "=", equal: "=", "!=": "!=", ne: "!=", "<>": "!=", ">": ">", gt: ">", ">=": ">=", gte: ">=", "<": "<", lt: "<", "<=": "<=", lte: "<=" };
      if (operators[op]) patterns.push({ kind: "filter", expression: binary(operators[op], termExpr(subject), termExpr(term)) });
      else if (["contains", "starts-with", "starts_with", "ends-with", "ends_with"].includes(op)) {
        const fn = op === "contains" ? "CONTAINS" : op.startsWith("starts") ? "STRSTARTS" : "STRENDS";
        patterns.push({ kind: "filter", expression: { kind: "function", name: fn, args: [
          { kind: "function", name: "LCASE", args: [{ kind: "function", name: "STR", args: [termExpr(subject)] }] },
          { kind: "function", name: "LCASE", args: [{ kind: "function", name: "STR", args: [termExpr(term)] }] },
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

export function compileFctXmlToSparql(xml: string, requestedView?: string, graphOnly = false, countOnly = false): CompiledFctQuery {
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
  const rawView = requestedView || viewNode?.attributes.type || "text";
  graphOnly = graphOnly || rawView === "graphs";
  if (!["text", "properties", "properties-in", "classes", "list", "list-count", "alphabet", "geo", "years", "months", "weeks", "describe", "graphs"].includes(rawView)) {
    throw new Error(`The '${rawView}' view is not supported by the SPARQL translator.`);
  }
  const view = rawView as FctSparqlView;
  const parsePage = (raw: string | undefined, fallback: number, max: number) => {
    const value = Number(raw ?? fallback);
    return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
  };
  const limit = parsePage(viewNode?.attributes.limit, 30, Number.MAX_SAFE_INTEGER) || 30;
  const offset = parsePage(viewNode?.attributes.offset, 0, Number.MAX_SAFE_INTEGER);
  const timeoutRaw = Number(root.attributes.timeout ?? 0);
  const timeoutMs = Number.isSafeInteger(timeoutRaw) && timeoutRaw >= 0 ? timeoutRaw : 0;
  const textNode = root.children.find((node) => node.name === "text");
  const searchText = textNode?.text.trim() ?? "";
  const constraints: SparqlPattern[] = [];
  const errors: string[] = [];
  const state = { next: 2, target: null as SparqlTerm | null };
  compileConstraints(root.children, variable("s1"), constraints, errors, state);
  if (errors.length) throw new Error(errors.join(" "));
  const target = state.target ?? variable("s1");
  const textNodeProperty = textNode?.attributes.property;
  const textPatterns = searchText ? fullTextPatterns(searchText, textNodeProperty) : null;
  if (searchText && !textPatterns) throw new Error("The text search contains no searchable terms.");
  const where: SparqlPattern[] = [...(textPatterns ?? []), ...constraints];
  // A fixed subject expressed by a top-level <value> still needs a triple
  // pattern to bind it, particularly for list/text/DESCRIBE views.
  const hasBindingPattern = where.some((pattern) => pattern.kind === "triple" || pattern.kind === "full-text" || pattern.kind === "graph" || pattern.kind === "quad-map");
  if (!hasBindingPattern) where.unshift({ kind: "triple", subject: variable("s1"), predicate: variable("p0"), object: variable("o0") });
  const graph = root.attributes.graph?.trim();
  const graphTerm = graph ? iri(graph) : null;
  if (graph && !graphTerm) throw new Error("The query graph attribute is not a valid IRI.");
  const scopedWhere = graphTerm ? [{ kind: "graph", graph: graphTerm, patterns: where } satisfies SparqlPattern] : where;
  const directives = queryDirectives(root);
  const countProjection = (term: SparqlTerm): SparqlProjection => ({ expression: { kind: "aggregate", name: "COUNT", distinct: true, expression: termExpr(term) }, as: variable("n") });
  let query: string;
  if (graphOnly) {
    let graphWhere: SparqlPattern[];
    if (searchText && textPatterns) {
      // Match the documented Virtuoso default-quad-map pattern for text search
      // while retaining the predicate restriction as an ordinary FILTER.
      const textTriple = textPatterns[0];
      const fullTextMatch = textPatterns[1];
      graphWhere = [{ kind: "quad-map", map: { kind: "raw-term", value: "virtrdf:DefaultQuadMap" }, graph: variable("g"), patterns: [textTriple, fullTextMatch] }, ...textPatterns.slice(2), ...constraints];
    } else {
      graphWhere = [{ kind: "graph", graph: variable("g"), patterns: constraints.length ? constraints : [{ kind: "triple", subject: variable("s1"), predicate: variable("p0"), object: variable("o0") }] }];
    }
    if (graphTerm) graphWhere.push({ kind: "filter", expression: binary("=", termExpr(variable("g")), termExpr(graphTerm)) });
    query = buildSelectQuery({ directives, distinct: true, projections: [{ expression: termExpr(variable("g")), as: variable("c1") }], where: graphWhere, orderBy: [{ expression: { kind: "function", name: "STR", args: [termExpr(variable("g"))] }, direction: "ASC" }], limit, offset });
  } else if (countOnly) {
    let counted: SparqlTerm;
    let countWhere = scopedWhere;
    if (view === "properties") {
      counted = variable("p");
      countWhere = [...scopedWhere, { kind: "triple", subject: target, predicate: variable("p"), object: variable("o") }];
    } else if (view === "classes") {
      counted = variable("c");
      countWhere = [...scopedWhere, { kind: "triple", subject: target, predicate: iriTerm(RDF_TYPE), object: variable("c") }];
    } else if (view === "properties-in") {
      counted = variable("p");
      countWhere = [...scopedWhere, { kind: "triple", subject: variable("related"), predicate: variable("p"), object: target }];
    } else counted = target;
    query = buildSelectQuery({ directives, projections: [countProjection(counted)], where: countWhere });
  } else if (view === "properties" || view === "classes" || view === "properties-in") {
    const facet = variable(view === "classes" ? "c" : "p");
    const subject = view === "properties-in" ? variable("related") : target;
    const predicate = view === "classes" ? iriTerm(RDF_TYPE) : view === "properties-in" ? facet : facet;
    const object = view === "properties-in" ? target : view === "classes" ? facet : variable("o");
    const facetWhere = [...scopedWhere, { kind: "triple", subject, predicate, object } satisfies SparqlPattern];
    query = buildSelectQuery({
      directives,
      projections: [
        { expression: termExpr(facet), as: variable("c1") },
        countProjection(view === "properties-in" ? variable("related") : target),
      ],
      where: facetWhere,
      groupBy: [termExpr(facet)],
      orderBy: [{ expression: termExpr(variable("n")), direction: "DESC" }],
      limit,
      offset,
    });
  } else if (view === "list-count") {
    query = buildSelectQuery({ directives, projections: [
      { expression: termExpr(target), as: variable("c1") },
      { expression: { kind: "aggregate", name: "COUNT", distinct: false, expression: { kind: "term", term: { kind: "raw-term", value: "*" } } }, as: variable("n") },
    ], where: scopedWhere, groupBy: [termExpr(target)], orderBy: [{ expression: termExpr(variable("n")), direction: "DESC" }], limit, offset });
  } else if (view === "alphabet") {
    const firstLetter: SparqlExpression = { kind: "function", name: "sql:subseq", args: [termExpr(target), termExpr({ kind: "raw-term", value: "0" }), termExpr({ kind: "raw-term", value: "1" })] };
    query = buildSelectQuery({ directives, projections: [
      { expression: firstLetter, as: variable("c1") },
      { expression: { kind: "aggregate", name: "COUNT", distinct: false, expression: { kind: "term", term: { kind: "raw-term", value: "*" } } }, as: variable("n") },
    ], where: scopedWhere, groupBy: [firstLetter], orderBy: [{ expression: firstLetter, direction: "ASC" }], limit, offset });
  } else if (view === "years" || view === "months" || view === "weeks") {
    const functionName = view === "years" ? "sql::year" : view === "months" ? "sql::round_month" : "sql::round_week";
    const bucket: SparqlExpression = { kind: "function", name: functionName, args: [termExpr(target)] };
    query = buildSelectQuery({ directives, projections: [
      { expression: bucket, as: variable("c1") },
      { expression: { kind: "aggregate", name: "COUNT", distinct: false, expression: { kind: "term", term: { kind: "raw-term", value: "*" } } }, as: variable("n") },
    ], where: scopedWhere, groupBy: [bucket], orderBy: [{ expression: bucket, direction: "ASC" }], limit, offset });
  } else if (view === "geo") {
    const lat = variable("lat"); const long = variable("long");
    const geoWhere: SparqlPattern[] = [...scopedWhere,
      { kind: "triple", subject: target, predicate: iriTerm("http://www.w3.org/2003/01/geo/wgs84_pos#lat"), object: lat },
      { kind: "triple", subject: target, predicate: iriTerm("http://www.w3.org/2003/01/geo/wgs84_pos#long"), object: long },
    ];
    query = buildSelectQuery({ directives, distinct: true, projections: [
      { expression: termExpr(lat), as: variable("c1") },
      { expression: termExpr(long), as: variable("c2") },
      { expression: termExpr(target), as: variable("c3") },
    ], where: geoWhere, limit, offset });
  } else if (view === "describe") {
    const document = new SparqlQueryDocument({ kind: "describe", describe: target, directives, projections: [], where: scopedWhere, limit, offset });
    query = document.toString();
  } else if (view === "text") {
    const projections: SparqlProjection[] = [{ expression: termExpr(target), as: variable("c1") }];
    if (searchText && textPatterns) {
      const tokens = searchText.match(/[\p{L}\p{N}_]+/gu) ?? [];
      const vector: SparqlExpression = { kind: "function", name: "bif:vector", args: tokens.map((token) => termExpr(literalTerm(token.toUpperCase()))) };
      projections.push({ expression: { kind: "function", name: "bif:search_excerpt", args: [vector, termExpr(variable("txt1"))] }, as: variable("c2") });
    }
    query = buildSelectQuery({ directives, distinct: true, projections, where: scopedWhere, orderBy: searchText ? [] : [{ expression: { kind: "function", name: "STR", args: [termExpr(target)] }, direction: "ASC" }], limit, offset });
  } else if (view === "list") {
    // Virtuoso's FCT list view selects the RDF term. Its SQL/XML response
    // wrapper resolves the human-readable label; do not call the SQL-only
    // fct_label procedure from inside SPARQL.
    query = buildSelectQuery({ directives, distinct: true, projections: [
      { expression: termExpr(target), as: variable("c1") },
    ], where: scopedWhere, orderBy: [{ expression: { kind: "function", name: "STR", args: [termExpr(target)] }, direction: "ASC" }], limit, offset });
  } else {
    query = buildSelectQuery({ directives, distinct: true, projections: [{ expression: termExpr(target), as: variable("c1") }], where: scopedWhere, orderBy: [{ expression: { kind: "function", name: "STR", args: [termExpr(target)] }, direction: "ASC" }], limit, offset });
  }
  return { query, view, limit, offset, timeoutMs, target: serializeTerm(target), graphOnly, countOnly };
}

export type SparqlBindingTerm = { type: string; value: string; datatype?: string; "xml:lang"?: string };
export type SparqlJsonResults = { head?: { vars?: string[] }; results?: { bindings?: Record<string, SparqlBindingTerm>[] } };
