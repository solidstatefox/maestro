import type { FctQueryNode, FctQueryTree } from "./fct-query";
import { normalizeFctValue } from "./fct-value-policy";

type CompilerState = {
  nextVariable: number;
  patterns: string[];
  errors: string[];
  text: string;
  textValue: string | null;
  textPredicate: string | null;
  textProperty: string;
  viewSubject: string | null;
};

function iriTerm(value: string | undefined): string | null {
  if (!value || !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\]*$/.test(value.trim())) return null;
  return `<${value.trim()}>`;
}

function escapeSparqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function textTerms(value: string): string[] {
  return value.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function valueTerm(node: FctQueryNode): string | null {
  const value = normalizeFctValue(node.text);
  if (!value) return null;
  const datatype = (node.attributes.datatype ?? "").trim().toLowerCase();
  if (datatype === "uri") return iriTerm(value);
  const lexical = `'${escapeSparqlString(value)}'`;
  const language = node.attributes["xml:lang"] ?? node.attributes.lang;
  if (language) return `${lexical}@${language}`;
  if (datatype && datatype !== "string" && datatype !== "plainstring") {
    const datatypeIri = iriTerm(datatype);
    return datatypeIri ? `${lexical}^^${datatypeIri}` : null;
  }
  return lexical;
}

function nextVariable(state: CompilerState): string {
  return `?s${state.nextVariable++}`;
}

/** Restrict a full-text match to one or more predicates listed in <text property="..."/>. */
function buildTextPropertyFilter(propertyAttribute: string, predicateVariable: string): string {
  const property = propertyAttribute.trim();
  if (!property || property.toLowerCase() === "none") return "";
  const terms = property.split(/[\s,]+/).filter(Boolean).map(iriTerm);
  if (!terms.length || terms.some((term) => !term)) return "";
  return `FILTER (${predicateVariable} IN (${terms.join(", ")}))`;
}

function compileNodes(nodes: FctQueryNode[], subject: string, state: CompilerState): void {
  for (const node of nodes) {
    switch (node.name) {
      case "view":
        state.viewSubject = subject;
        compileNodes(node.children, subject, state);
        break;
      case "text": {
        const value = node.text?.trim() ?? "";
        if (!value) break;
        if (state.text) {
          state.errors.push("Only one FCT text-search node is supported in the Results query.");
          break;
        }
        if (!textTerms(value).length) {
          state.errors.push("The text search has no searchable terms.");
          break;
        }
        state.text = value;
        state.textValue = "?o1";
        state.textPredicate = `${subject.replace(/^\?/, "?")}textp`;
        state.textProperty = (node.attributes.property ?? "").trim();
        break;
      }
      case "property":
      case "property-of": {
        const predicate = iriTerm(node.attributes.iri);
        if (!predicate) {
          state.errors.push(`The FCT <${node.name}> node has a missing or invalid IRI.`);
          break;
        }
        const related = nextVariable(state);
        state.patterns.push(node.name === "property"
          ? `${subject} ${predicate} ${related} .`
          : `${related} ${predicate} ${subject} .`);
        compileNodes(node.children, related, state);
        break;
      }
      case "class": {
        const classIri = iriTerm(node.attributes.iri);
        if (!classIri) state.errors.push("The FCT <class> node has a missing or invalid IRI.");
        else state.patterns.push(`${subject} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${classIri} .`);
        compileNodes(node.children, subject, state);
        break;
      }
      case "value": {
        const term = valueTerm(node);
        if (!term) {
          state.errors.push("An FCT value cannot be represented safely as a SPARQL term.");
          break;
        }
        const operators: Record<string, string> = { "": "=", "=": "=", eq: "=", equal: "=", "!=": "!=", ne: "!=", "<>": "!=", ">": ">", gt: ">", ">=": ">=", gte: ">=", "<": "<", lt: "<", "<=": "<=", lte: "<=" };
        const op = (node.attributes.op ?? "=").trim().toLowerCase();
        if (operators[op]) state.patterns.push(`FILTER (${subject} ${operators[op]} ${term})`);
        else if (op === "contains" || op === "starts-with" || op === "starts_with" || op === "ends-with" || op === "ends_with") {
          const lexical = `LCASE(STR(${subject}))`;
          const literal = `LCASE(STR(${term}))`;
          const fn = op === "contains" ? "CONTAINS" : op.startsWith("starts") ? "STRSTARTS" : "STRENDS";
          state.patterns.push(`FILTER (${fn}(${lexical}, ${literal}))`);
        } else state.errors.push(`The FCT value operator '${op}' is not supported in Results queries.`);
        break;
      }
      default:
        state.errors.push(`The FCT <${node.name}> node is not supported in Results queries.`);
    }
  }
}

/** Compile the active FCT query tree to a Virtuoso SPARQL result-set query. */
export function buildFctResultsSparql(tree: FctQueryTree): string | null {
  const state: CompilerState = { nextVariable: 2, patterns: [], errors: [], text: "", textValue: null, textPredicate: null, textProperty: "", viewSubject: null };
  compileNodes(tree.children, "?s1", state);
  if (state.errors.length) return null;

  const viewNode = tree.children.find((node) => node.name === "view");
  const limitValue = Number(viewNode?.attributes.limit ?? 30);
  const offsetValue = Number(viewNode?.attributes.offset ?? 0);
  const limit = Number.isSafeInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 1000) : 30;
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const orderAttr = (tree.attributes.order ?? tree.attributes["order-results"] ?? viewNode?.attributes.order ?? viewNode?.attributes["order-results"] ?? "").trim().toLowerCase();
  const shouldOrder = ["yes", "true", "1", "on"].includes(orderAttr);
  const defines: string[] = [];
  const inference = tree.attributes.inference?.trim();
  if (inference) defines.push(`DEFINE input:inference "${escapeSparqlString(inference)}"`);
  const sameAs = tree.attributes["same-as"]?.trim().toLowerCase();
  if (["yes", "true", "1"].includes(sameAs ?? "")) defines.push('DEFINE input:same-as "yes"');

  const patterns = [...state.patterns];
  let innerSelect: string;
  let outerSelect: string;
  if (state.text && state.textValue && state.textPredicate) {
    const terms = textTerms(state.text);
    const vector = terms.map((term) => `'${escapeSparqlString(term)}'`).join(", ");
    const contains = `'"${terms.map((term) => escapeSparqlString(term.toLowerCase())).join(" ")}"'`;
    const textPattern = `quad map virtrdf:DefaultQuadMap { graph ?g { ?s1 ?s1textp ?o1 . ?o1 bif:contains ${contains} option (score ?sc) . } }`;
    const textPropertyFilter = buildTextPropertyFilter(state.textProperty, "?s1textp");
    if (state.textProperty && state.textProperty.toLowerCase() !== "none" && !textPropertyFilter) return null;
    // The full-text match must be in the Virtuoso quad-map pattern; selected values
    // are equality FILTERs over their related variables, not merely triples.
    const orderClause = shouldOrder ? " ORDER BY DESC (?sc * 3e-1 + sql:rnk_scale (<LONG::IRI_RANK> (?s1)))" : "";
    innerSelect = `SELECT ?s1, (?sc * 3e-1) AS ?sc, ?o1, (sql:rnk_scale (<LONG::IRI_RANK> (?s1))) AS ?rank, ?g WHERE { ${textPattern} ${textPropertyFilter} ${patterns.join(" ")} }${orderClause} LIMIT ${limit} OFFSET ${offset}`;
    outerSelect = `SELECT ?s1 AS ?c1, (bif:search_excerpt (bif:vector (${vector}), ?o1)) AS ?c2, ?sc, ?rank, ?g WHERE {{{ ${innerSelect} }}}`;
  } else {
    if (!patterns.length) patterns.push("?s1 ?p1 ?o2 .");
    const graph = tree.attributes.graph?.trim();
    const graphTerm = graph ? iriTerm(graph) : null;
    if (graph && !graphTerm) return null;
    const body = graphTerm ? `GRAPH ${graphTerm} { ${patterns.join(" ")} }` : patterns.join(" ");
    const orderClause = shouldOrder ? " ORDER BY STR(?s1)" : "";
    innerSelect = `SELECT DISTINCT ?s1 WHERE { ${body} }${orderClause} LIMIT ${limit} OFFSET ${offset}`;
    outerSelect = `SELECT ?s1 AS ?c1 WHERE { ${innerSelect} }`;
  }
  return [...defines, outerSelect].join("\n");
}


/** Compile a Group By value clone to a grouped SELECT query with counts. The view
 * nested under the selected relationship identifies the value variable to
 * return; full-text and every other source-query constraint remain in scope. */
export function buildFctGroupValuesSparql(tree: FctQueryTree): string | null {
  const state: CompilerState = { nextVariable: 2, patterns: [], errors: [], text: "", textValue: null, textPredicate: null, textProperty: "", viewSubject: null };
  compileNodes(tree.children, "?s1", state);
  if (state.errors.length || !state.viewSubject) return null;

  const findView = (nodes: FctQueryNode[]): FctQueryNode | null => {
    for (const node of nodes) {
      if (node.name === "view") return node;
      const nested = findView(node.children);
      if (nested) return nested;
    }
    return null;
  };
  const view = findView(tree.children);
  const limitValue = Number(view?.attributes.limit ?? 30);
  const offsetValue = Number(view?.attributes.offset ?? 0);
  const limit = Number.isSafeInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 1000) : 30;
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const defines: string[] = [];
  const inference = tree.attributes.inference?.trim();
  if (inference) defines.push(`DEFINE input:inference "${escapeSparqlString(inference)}"`);
  const sameAs = tree.attributes["same-as"]?.trim().toLowerCase();
  if (["yes", "true", "1"].includes(sameAs ?? "")) defines.push('DEFINE input:same-as "yes"');

  const target = state.viewSubject;
  let body = state.patterns.join(" ");
  if (state.text) {
    const terms = textTerms(state.text);
    if (!terms.length) return null;
    const contains = `'"${terms.map((term) => escapeSparqlString(term.toLowerCase())).join(" ")}"'`;
    const textPattern = `quad map virtrdf:DefaultQuadMap { graph ?g { ?s1 ?s1textp ?o1 . ?o1 bif:contains ${contains} option (score ?sc) . } }`;
    const textPropertyFilter = buildTextPropertyFilter(state.textProperty, "?s1textp");
    if (state.textProperty && state.textProperty.toLowerCase() !== "none" && !textPropertyFilter) return null;
    body = `${textPattern} ${textPropertyFilter} ${body}`;
  } else {
    const graph = tree.attributes.graph?.trim();
    const graphTerm = graph ? iriTerm(graph) : null;
    if (graph && !graphTerm) return null;
    if (graphTerm) body = `GRAPH ${graphTerm} { ${body} }`;
    if (!body.trim()) body = `?s1 ?p1 ${target} .`;
  }
  const query = `SELECT (${target} AS ?c1) (COUNT(?s1) AS ?ct) WHERE { ${body} } GROUP BY ${target} LIMIT ${limit} OFFSET ${offset}`;
  return [...defines, query].join("\n");
}

