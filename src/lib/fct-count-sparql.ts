import type { FctQueryNode, FctQueryTree } from "./fct-query";

type CompilerState = {
  nextVariable: number;
  viewVariable: string | null;
  patterns: string[];
  errors: string[];
};

function escapeSparqlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function iriTerm(value: string | undefined): string | null {
  if (!value || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || /[<>"{}|^`\\\u0000-\u0020]/.test(value)) return null;
  return `<${value}>`;
}

function valueTerm(node: FctQueryNode): string | null {
  const value = node.text ?? "";
  const datatype = node.attributes.datatype ?? "";
  const language = node.attributes["xml:lang"] ?? node.attributes.lang ?? "";
  if (datatype === "uri" || datatype === "url") return iriTerm(value);
  if (datatype === "bnode" || datatype === "blank-node") return null;
  const lexical = `"${escapeSparqlString(value)}"`;
  if (language) {
    if (!/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(language)) return null;
    return `${lexical}@${language}`;
  }
  if (!datatype || datatype === "string" || datatype === "literal" || datatype === "http://www.openlinksw.com/schemas/facets/dtp/plainstring") {
    return lexical;
  }
  const datatypeIri = iriTerm(datatype);
  return datatypeIri ? `${lexical}^^${datatypeIri}` : null;
}

function textSearchExpression(text: string): string | null {
  // FCT's default text view tokenizes the search string and combines the terms
  // with AND inside bif:contains. Keep punctuation out of the SPARQL expression
  // so user input cannot escape the literal or inject search operators.
  const terms = text.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!terms.length) return null;
  return `(${terms.map((term) => term.toLocaleUpperCase("en-US")).join(" AND ")})`;
}

function nextVariable(state: CompilerState): string {
  return `?fct${state.nextVariable++}`;
}

function appendValueFilter(node: FctQueryNode, subject: string, state: CompilerState): void {
  const term = valueTerm(node);
  if (!term) {
    state.errors.push("The query contains a value term that cannot be represented safely in SPARQL.");
    return;
  }
  const op = (node.attributes.op ?? "=").trim().toLowerCase();
  const operators: Record<string, string> = {
    "": "=", "=": "=", eq: "=", equal: "=",
    "!=": "!=", ne: "!=", "<>": "!=",
    ">": ">", gt: ">", ">=": ">=", gte: ">=",
    "<": "<", lt: "<", "<=": "<=", lte: "<=",
  };
  if (operators[op]) {
    state.patterns.push(`FILTER (${subject} ${operators[op]} ${term})`);
    return;
  }
  const lexical = `STR(${subject})`;
  const literal = `STR(${term})`;
  if (op === "contains") state.patterns.push(`FILTER (CONTAINS(LCASE(${lexical}), LCASE(${literal})))`);
  else if (op === "starts-with" || op === "starts_with") state.patterns.push(`FILTER (STRSTARTS(LCASE(${lexical}), LCASE(${literal})))`);
  else if (op === "ends-with" || op === "ends_with") state.patterns.push(`FILTER (STRENDS(LCASE(${lexical}), LCASE(${literal})))`);
  else state.errors.push(`The FCT value operator '${node.attributes.op}' is not supported by the count-query compiler.`);
}

function compileNodes(nodes: FctQueryNode[], subject: string, state: CompilerState): void {
  for (const node of nodes) {
    switch (node.name) {
      case "view": {
        if (node.id === "query-view" || state.viewVariable === null) state.viewVariable = subject;
        compileNodes(node.children, subject, state);
        break;
      }
      case "property":
      case "property-of": {
        const predicate = iriTerm(node.attributes.iri);
        if (!predicate) {
          state.errors.push(`The FCT <${node.name}> node has a missing or unsupported IRI.`);
          break;
        }
        const related = nextVariable(state);
        const relationshipPattern = node.name === "property"
          ? `${subject} ${predicate} ${related} .`
          : `${related} ${predicate} ${subject} .`;
        if (node.attributes.exclude?.trim().toLowerCase() === "yes") {
          // Exclusion is a negative condition; it must not bind the related
          // variable or constrain counts to resources that have this edge.
          state.patterns.push(`FILTER NOT EXISTS { ${relationshipPattern} }`);
          break;
        }
        state.patterns.push(relationshipPattern);
        // Candidate facet counts must mirror the click action: the candidate
        // relationship constrains the current focus resources, so count the
        // distinct active-view variable rather than every related object. A
        // multi-valued property can have many objects for one focus resource.
        compileNodes(node.children, related, state);
        break;
      }
      case "class": {
        const classIri = iriTerm(node.attributes.iri);
        if (!classIri) {
          state.errors.push("The query contains a class with a missing or unsupported IRI.");
          break;
        }
        const classPattern = `${subject} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ${classIri} .`;
        if (node.attributes.exclude?.trim().toLowerCase() === "yes") {
          state.patterns.push(`FILTER NOT EXISTS { ${classPattern} }`);
        } else {
          state.patterns.push(classPattern);
        }
        compileNodes(node.children, subject, state);
        break;
      }
      case "value":
        appendValueFilter(node, subject, state);
        break;
      case "text": {
        const text = node.text?.trim() ?? "";
        if (!text) break;
        const expression = textSearchExpression(text);
        if (!expression) {
          state.errors.push("The FCT text filter cannot be represented as a SPARQL full-text expression.");
          break;
        }
        const textValue = nextVariable(state);
        const textPredicate = nextVariable(state);
        state.patterns.push(`${subject} ${textPredicate} ${textValue} .`);
        state.patterns.push(`FILTER (bif:contains(${textValue}, "${escapeSparqlString(expression)}"))`);

        // Keep the count query's full-text scope identical to the Results
        // query. FCT's <text property="..."> restricts matches to that
        // predicate; "none" (or an omitted property) intentionally searches
        // every predicate.
        const textProperty = (node.attributes.property ?? "").trim();
        if (textProperty && textProperty.toLowerCase() !== "none") {
          const property = iriTerm(textProperty);
          if (!property) {
            state.errors.push("The FCT <text> property attribute must be an IRI or 'none'.");
            break;
          }
          state.patterns.push(`FILTER (${textPredicate} IN (${property}))`);
        }
        break;
      }
      default:
        state.errors.push(`The FCT <${node.name}> node is not supported by the count-query compiler.`);
    }
  }
}

/** Compile the app's supported FCT query-tree subset directly to a scalar SPARQL count. */
export function buildFctCountSparql(tree: FctQueryTree): string | null {
  const state: CompilerState = {
    nextVariable: 0,
    viewVariable: null,
    patterns: [],
    errors: [],
  };
  const root = "?fct0";
  state.nextVariable = 1;
  compileNodes(tree.children, root, state);
  if (state.errors.length || !state.viewVariable || !state.patterns.length) return null;

  const queryAttributes: string[] = [];
  const inference = tree.attributes.inference?.trim();
  if (inference) queryAttributes.push(`DEFINE input:inference "${escapeSparqlString(inference)}"`);
  const sameAs = tree.attributes["same-as"]?.trim().toLowerCase();
  if (sameAs === "yes" || sameAs === "true" || sameAs === "1") {
    queryAttributes.push('DEFINE input:same-as "yes"');
  }

  let whereBody = state.patterns.join("\n  ");
  const graph = tree.attributes.graph?.trim();
  if (graph) {
    const graphIri = iriTerm(graph);
    if (!graphIri) return null;
    whereBody = `GRAPH ${graphIri} {\n    ${whereBody.replace(/\n/g, "\n    ")}\n  }`;
  }

  const countQuery = `SELECT (COUNT(DISTINCT ${state.viewVariable}) AS ?ct) WHERE {\n  ${whereBody.replace(/\n/g, "\n  ")}\n}`;
  return [...queryAttributes, countQuery].join("\n");
}
