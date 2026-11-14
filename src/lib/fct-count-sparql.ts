import { ALL_GRAPHS } from "./graph-address-mode";
import type { FctQueryNode, FctQueryTree } from "./fct-query";
import { normalizeFctValue } from "./fct-value-policy";
import { buildVirtuosoFullTextExpression } from "./virtuoso-full-text";
import { guardedNumericRangeFilter, numericFacetBinding, NUMERIC_FACET_PROJECTION } from "./virtuoso-numeric-coercion";

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
  const value = normalizeFctValue(node.text);
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
  // FCT's native datatype shortcuts (e.g. dateTime) are XSD types.
  const xsdTypes = new Set(["boolean", "decimal", "integer", "int", "long", "short", "byte", "double", "float", "date", "dateTime", "time", "gYear", "gYearMonth", "nonNegativeInteger", "positiveInteger", "unsignedLong", "unsignedInt"]);
  const datatypeIri = iriTerm(xsdTypes.has(datatype) ? `http://www.w3.org/2001/XMLSchema#${datatype}` : datatype);
  return datatypeIri ? `${lexical}^^${datatypeIri}` : null;
}

function nextVariable(state: CompilerState): string {
  return `?fct${state.nextVariable++}`;
}

function appendValueFilter(node: FctQueryNode, subject: string, state: CompilerState): void {
  const start = node.attributes.rangeStart?.trim();
  const end = node.attributes.rangeEnd?.trim();
  if (start !== undefined || end !== undefined) {
    const datatype = (node.attributes.datatype ?? "").trim();
    const allowed = new Set(["decimal", "integer", "int", "long", "short", "byte", "double", "float", "date", "dateTime", "time", "gYear", "gYearMonth", "nonNegativeInteger", "positiveInteger", "unsignedLong", "unsignedInt"]);
    if (!allowed.has(datatype)) {
      state.errors.push("FCT value ranges require an XSD numeric or date datatype.");
      return;
    }
    const numeric = !["date", "dateTime", "time", "gYear", "gYearMonth"].includes(datatype);
    if ([start, end].some((bound) => bound !== undefined && (!bound || (numeric && !Number.isFinite(Number(bound)))))) {
      state.errors.push("FCT range bounds must be nonempty and numeric bounds must be finite.");
      return;
    }
    if (start !== undefined && end !== undefined && (numeric ? Number(start) > Number(end) : start > end)) {
      state.errors.push("The FCT rangeStart must not exceed rangeEnd.");
      return;
    }
    if (node.attributes.coerce && node.attributes.coerce !== "numeric") {
      state.errors.push("Unsupported FCT range coercion policy.");
      return;
    }
    if (node.attributes.coerce === "numeric" && !numeric) {
      state.errors.push("Numeric coercion is only valid for numeric FCT ranges.");
      return;
    }
    for (const [bound, operator] of [[start, ">="], [end, "<="]] as const) {
      if (bound === undefined) continue;
      const term = valueTerm({ ...node, text: bound });
      if (!term) {
        state.errors.push("Invalid FCT range bound.");
        return;
      }
      state.patterns.push(`FILTER ${node.attributes.coerce === "numeric" ? guardedNumericRangeFilter(subject, operator, term) : `(${subject} ${operator} ${term})`}`);
    }
    return;
  }
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
  else if (op === "regex") state.patterns.push(`FILTER (REGEX(STR(${subject}), "${escapeSparqlString(node.text ?? "")}"))`);
  else if (op === "starts-with" || op === "starts_with") state.patterns.push(`FILTER (STRSTARTS(LCASE(${lexical}), LCASE(${literal})))`);
  else if (op === "ends-with" || op === "ends_with") state.patterns.push(`FILTER (STRENDS(LCASE(${lexical}), LCASE(${literal})))`);
  else state.errors.push(`The FCT value operator '${node.attributes.op}' is not supported by the count-query compiler.`);
}

function compileNodes(nodes: FctQueryNode[], subject: string, state: CompilerState): void {
  for (const node of nodes) {
    switch (node.name) {
      case "view": {
        if ((node.uiKey === "query-view" || node.id === "query-view") || state.viewVariable === null) state.viewVariable = subject;
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
        const expression = buildVirtuosoFullTextExpression(text);
        if (!expression) {
          state.errors.push("The FCT text filter cannot be represented as a SPARQL full-text expression.");
          break;
        }
        const textValue = nextVariable(state);
        const textPredicate = nextVariable(state);
        state.patterns.push(`${subject} ${textPredicate} ${textValue} .`);
        state.patterns.push(`FILTER (bif:contains(${textValue}, "${escapeSparqlString(expression)}"))`);

        // Keep the count query's full-text scope identical to the Results
        // query. The property attribute accepts a whitespace- or comma-separated
        // list of IRIs; "none" (or an omitted property) searches every predicate.
        const textProperty = (node.attributes.property ?? "").trim();
        if (textProperty && textProperty.toLowerCase() !== "none") {
          const properties = textProperty.split(/[\s,]+/).filter(Boolean).map(iriTerm);
          if (!properties.length || properties.some((property) => !property)) {
            state.errors.push("The FCT <text> property attribute must contain one or more IRIs, or 'none'.");
            break;
          }
          state.patterns.push(`FILTER (${textPredicate} IN (${properties.join(", ")}))`);
        }
        break;
      }
      default:
        state.errors.push(`The FCT <${node.name}> node is not supported by the count-query compiler.`);
    }
  }
}

/** A provider contributes projections and a relationship to the existing count
 * graph, not an arbitrary top-level SPARQL query. Expressions and aliases are
 * validated before interpolation; the base COUNT(DISTINCT view) is unchanged. */
export type FacetCountExtension = {
  predicate: string;
  projections: Array<{ aggregate: "MIN" | "MAX" | "AVG" | "SUM"; expression: "xsd:decimal(?facetValue)" | typeof NUMERIC_FACET_PROJECTION; alias: string }>;
};

/** Compile the app's supported FCT query-tree subset directly to a scalar SPARQL count. */
export function buildFctCountSparql(tree: FctQueryTree, extension?: FacetCountExtension, kindDirection?: "property" | "role", probeKind?: string): string | null {
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

  // Mirror the view-level alphabet selection in scalar result counts.
  const findView = (nodes: FctQueryNode[]): FctQueryNode | null => {
    for (const node of nodes) {
      if (node.name === "view") return node;
      const nested = findView(node.children);
      if (nested) return nested;
    }
    return null;
  };
  const viewNode = findView(tree.children);
  const preferredLanguage = (viewNode?.attributes.indexLang ?? "en").toLowerCase();
  if (preferredLanguage !== "all" && !/^[a-z]{2,3}$/.test(preferredLanguage)) return null;
  // Same literal-focus restriction as Results; do not filter URI resources.
  const hasExplicitViewLanguage = (() => {
    const find = (nodes: FctQueryNode[]): boolean | null => {
      for (const node of nodes) {
        if (node.children.some((child) => child.name === "view"))
          return node.children.some((child) => child.name === "value" && !!(child.attributes["xml:lang"] || child.attributes.lang));
        const nested = find(node.children);
        if (nested !== null) return nested;
      }
      return null;
    };
    return find(tree.children) === true;
  })();
  // Same RDF 1.1 language policy as the main FCT compiler: only rdf:langString
  // is restricted. This deliberately avoids LANG() on neutral xsd:string values
  // (e.g. Bookmark tag "demo"), which Virtuoso incorrectly excluded previously.
  if (preferredLanguage !== "all" && !hasExplicitViewLanguage)
    state.patterns.push(`FILTER (!isLiteral(${state.viewVariable}) || DATATYPE(${state.viewVariable}) != <http://www.w3.org/1999/02/22-rdf-syntax-ns#langString> || LANGMATCHES(LANG(${state.viewVariable}), "${preferredLanguage}"))`);
  const indexLetter = viewNode?.attributes.index?.trim() ?? "";
  if (indexLetter) {
    if (!/^[A-Z]$/.test(indexLetter)) return null;
    const props = [...new Set((viewNode?.attributes.indexLabels || "http://www.w3.org/2000/01/rdf-schema#label").split(/[\s,]+/).filter(Boolean))];
    if (!props.length || props.length > 20 || props.some((prop) => !iriTerm(prop))) return null;
    const available = props.map((prop) => `<${prop}>`).join(", ");
    state.patterns.push(`${state.viewVariable} ?maestroIndexPredicate ?maestroIndexLabel .`);
    state.patterns.push(`FILTER (?maestroIndexPredicate IN (${available}))`);
    if (preferredLanguage !== "all") state.patterns.push(`FILTER (!isLiteral(?maestroIndexLabel) || DATATYPE(?maestroIndexLabel) != <http://www.w3.org/1999/02/22-rdf-syntax-ns#langString> || LANGMATCHES(LANG(?maestroIndexLabel), "${preferredLanguage}"))`);
    state.patterns.push(`FILTER (STRSTARTS(UCASE(STR(?maestroIndexLabel)), "${indexLetter}"))`);
  }

  let whereBody = state.patterns.join("\n  ");
  // The FCT query's graph is carried by `addr="graph@graphserver"`, not a
  // separate `graph` attribute. Match the main FCT-to-SPARQL translator: every
  // scalar facet count must use the same named-graph scope as its value list.
  const address = tree.attributes.addr ?? "";
  const addressDelimiter = address.indexOf("@");
  if (addressDelimiter < 0 || !address.slice(addressDelimiter + 1).trim()) return null;
  const graph = address.slice(0, addressDelimiter).trim();
  if (graph && graph !== ALL_GRAPHS) {
    const graphIri = iriTerm(graph);
    if (!graphIri) return null;
    whereBody = `GRAPH ${graphIri} {\n    ${whereBody.replace(/\n/g, "\n    ")}\n  }`;
  }

  // Kind availability uses the same compiled FCT focus and graph scope as counts.
  // One VALUES + EXISTS SELECT evaluates every kind without N network calls.
  // Single-kind ASK variants are used only when an endpoint rejects batching.
  if (kindDirection) {
    const kinds = ["web-url", "string", "numeric", "date", "email", "phone"];
    if (probeKind !== undefined && !kinds.includes(probeKind)) return null;
    const value = "?maestroKindValue";
    const valueStr = `STR(${value})`;
    const numeric = `(isLiteral(${value}) && (DATATYPE(${value}) IN (<http://www.w3.org/2001/XMLSchema#integer>, <http://www.w3.org/2001/XMLSchema#decimal>, <http://www.w3.org/2001/XMLSchema#float>, <http://www.w3.org/2001/XMLSchema#double>, <http://www.w3.org/2001/XMLSchema#int>, <http://www.w3.org/2001/XMLSchema#long>, <http://www.w3.org/2001/XMLSchema#short>, <http://www.w3.org/2001/XMLSchema#byte>, <http://www.w3.org/2001/XMLSchema#nonNegativeInteger>, <http://www.w3.org/2001/XMLSchema#positiveInteger>, <http://www.w3.org/2001/XMLSchema#unsignedInt>, <http://www.w3.org/2001/XMLSchema#unsignedLong>, <http://www.w3.org/2001/XMLSchema#unsignedShort>, <http://www.w3.org/2001/XMLSchema#unsignedByte>) || REGEX(${valueStr}, "^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$")))`;
    const date = `(isLiteral(${value}) && (DATATYPE(${value}) IN (<http://www.w3.org/2001/XMLSchema#date>, <http://www.w3.org/2001/XMLSchema#dateTime>, <http://www.w3.org/2001/XMLSchema#time>, <http://www.w3.org/2001/XMLSchema#gYear>, <http://www.w3.org/2001/XMLSchema#gYearMonth>) || REGEX(${valueStr}, "^[0-9]{4}-[0-9]{2}-[0-9]{2}")))`;
    const email = `REGEX(${valueStr}, "^(mailto:)?[^@ ]+@[^@ ]+[.][^@ ]+$", "i")`;
    const phone = `REGEX(${valueStr}, "^(tel:)?[+]?[0-9()+ .-]{7,}$", "i")`;
    const web = `((isIRI(${value}) || isLiteral(${value})) && REGEX(${valueStr}, "^https?://", "i"))`;
    const choices = [web, `isLiteral(${value}) && !(${numeric} || ${date} || ${email} || ${phone} || ${web})`, numeric, date, email, phone];
    const check = probeKind ? choices[kinds.indexOf(probeKind)] : kinds.map((kind, i) => `(?maestroKind = "${kind}" && (${choices[i]}))`).join(" || ");
    const relation = kindDirection === "property"
      ? `${state.viewVariable} ?maestroKindPredicate ${value} .`
      : `${value} ?maestroKindPredicate ${state.viewVariable} .`;
    const pattern = graph && graph !== ALL_GRAPHS ? `GRAPH <${graph}> { ${relation} }` : relation;
    const condition = `FILTER (${check})`;
    const kindValues = kinds.map(k => `"${k}"`).join(" ");
    const discoveryBody = probeKind
      ? `${pattern}\n  ${condition}`
      : `VALUES ?maestroKind { ${kindValues} }\n  FILTER EXISTS { ${pattern} ${condition} }`;
    const inner = `${whereBody}\n  ${discoveryBody}`;
    return [...queryAttributes, `${probeKind ? "ASK" : "SELECT DISTINCT ?maestroKind"} WHERE {\n  ${inner.replace(/\n/g, "\n  ")}\n}`].join("\n");
  }
  let extraProjections = "";
  if (extension) {
    const predicate = iriTerm(extension.predicate);
    if (!predicate || !extension.projections.length || extension.projections.length > 8 ||
        extension.projections.some(item => !/^(MIN|MAX|AVG|SUM)$/.test(item.aggregate) ||
          !["xsd:decimal(?facetValue)", NUMERIC_FACET_PROJECTION].includes(item.expression) || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(item.alias)) ||
        new Set(extension.projections.map(item => item.alias)).size !== extension.projections.length ||
        extension.projections.some(item => item.alias === "ct")) return null;
    // An OPTIONAL triple preserves the original count even when a resource has
    // no numeric values. Preserve named graph scope for this provider binding.
    const coercible = extension.projections.some(item => item.expression === NUMERIC_FACET_PROJECTION);
    if (coercible && extension.projections.some(item => item.expression !== NUMERIC_FACET_PROJECTION)) return null;
    const relation = `${state.viewVariable} ${predicate} ?facetValue . ${coercible ? numericFacetBinding() : "FILTER (isNumeric(?facetValue))"}`;
    const extraPattern = graph && graph !== ALL_GRAPHS ? `GRAPH <${graph}> { ${relation} }` : relation;
    whereBody += `\nOPTIONAL { ${extraPattern} }`;
    extraProjections = extension.projections.map(item =>
      ` (${item.aggregate}(${item.expression}) AS ?${item.alias})`).join("");
  }
  const countQuery = `SELECT (COUNT(DISTINCT ${state.viewVariable}) AS ?ct)${extraProjections} WHERE {\n  ${whereBody.replace(/\n/g, "\n  ")}\n}`;
  return [...queryAttributes, ...(extension ? ["PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>"] : []), countQuery].join("\n");
}

/** Batched FCT-scoped kind preflight. No independently assembled query path. */
export function buildFctKindAvailabilitySparql(tree: FctQueryTree, direction: "property" | "role", kind?: string): string | null {
  return buildFctCountSparql(tree, undefined, direction, kind);
}
