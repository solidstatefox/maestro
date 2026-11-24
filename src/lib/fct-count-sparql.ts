import { effectiveMaestroLanguage, validMaestroLanguage } from "./maestro-language";
import { inspectFctValueReferences, type ReferenceNode } from "./fct-value-references";
import { MAESTRO_KIND_IDS, normalizeMaestroKind, maestroKindSparql } from "./maestro-kinds";
import { ALL_GRAPHS } from "./graph-address-mode";
import type { FctQueryNode, FctQueryTree } from "./fct-query";
import { normalizeFctValue } from "./fct-value-policy";
import { buildVirtuosoFullTextExpression } from "./virtuoso-full-text";
import { guardedNumericRangeFilter, numericFacetBinding, NUMERIC_FACET_PROJECTION } from "./virtuoso-numeric-coercion";

type CountReferenceResolver = {
  rootId: string;
  subjects: ReadonlyMap<string, string>;
  omitted: ReadonlySet<string>;
  buildPopulation: (targetId: string, valueId: string, inherited: ReadonlySet<string>, member: string) => string;
};
type CompilerState = {
  references?: CountReferenceResolver;
  nextVariable: number;
  viewVariable: string | null;
  patterns: string[];
  errors: string[];
  relationBindings: Map<string,string>;
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
  if (node.attributes.enabled === "false" || state.references?.omitted.has(node.id)) return;
  if (node.attributes.from !== undefined || node.attributes.fromView !== undefined) {
    const from = node.attributes.from;
    if (from !== undefined) {
      const name = from === state.references?.rootId ? "?fct0" : state.references?.subjects.get(from);
      if (!name) state.errors.push(`Malformed FCT Query: unknown from reference "${from}".`);
      else state.patterns.push(`FILTER (BOUND(${name}) && sameTerm(${subject}, ${name}))`);
    } else {
      if (!state.references) { state.errors.push("Missing fromView count compiler context."); return; }
      const member = `?maestroPopulation${state.nextVariable++}`;
      state.patterns.push(state.references.buildPopulation(node.attributes.fromView!, node.id, state.references.omitted, member));
      state.patterns.push(`FILTER (sameTerm(${subject}, ${member}))`);
    }
    return;
  }
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
  const groups = new Map<string, FctQueryNode[]>();
  for (const node of nodes) if ((node.name === "property" || node.name === "property-of") && node.attributes.uid) {
    const uid = node.attributes.uid;
    if (!/^[a-z0-9]+$/.test(uid)) { state.errors.push(`Invalid OR identifier ${uid}`); continue; }
    groups.set(uid, [...(groups.get(uid) ?? []), node]);
  }
  const handled = new Set<string>();
  for (const node of nodes) {
    const uid = (node.name === "property" || node.name === "property-of") ? node.attributes.uid : undefined;
    const members = uid ? groups.get(uid) : undefined;
    if (uid && members && members.length > 1) {
      if (handled.has(uid)) continue;
      handled.add(uid);
      const base = state.nextVariable;
      let next = base;
      const branches: string[] = [];
      for (const member of members) {
        const branchState: CompilerState = { nextVariable: base, viewVariable: state.viewVariable,
          patterns: [], errors: state.errors, relationBindings: new Map(state.relationBindings), references: state.references };
        compileNodes([{ ...member, attributes: Object.fromEntries(Object.entries(member.attributes).filter(([key]) => key !== "uid")) }], subject, branchState);
        if (branchState.viewVariable) state.viewVariable = branchState.viewVariable;
        next = Math.max(next, branchState.nextVariable);
        branches.push(`{ ${branchState.patterns.join(" \n  ")} }`);
      }
      state.nextVariable = next;
      state.patterns.push(branches.join(" UNION "));
      continue;
    }
    switch (node.name) {
      case "view": {
        if ((node.uiKey === "query-view" || node.id === "query-view") || state.viewVariable === null) state.viewVariable = subject;
        compileNodes(node.children, subject, state);
        break;
      }
      case "property":
      case "property-of": {
        if (node.attributes.derive === "split") {
          const reference = state.references?.subjects.get(node.id);
          if (reference) state.patterns.push(`BIND(${subject} AS ${reference})`);
          const source=state.relationBindings.get(node.attributes.pid || "");
          const delimiter=node.attributes.splitPattern || "";
          if (!source || !delimiter || delimiter.length > 2000) {
            state.errors.push("Derived split facet requires a source rid and delimiter pattern.");
            break;
          }
          const sourceValuePredicate=node.attributes.sourceValuePredicate || "";
          const predicate=sourceValuePredicate ? iriTerm(sourceValuePredicate) : null;
          if (sourceValuePredicate && !predicate) {
            state.errors.push("Derived split sourceValuePredicate must be a valid RDF predicate IRI.");
            break;
          }
          const lexicalSource=predicate ? nextVariable(state) : source;
          if (predicate) state.patterns.push(`${source} ${predicate} ${lexicalSource} .`);
          state.patterns.push(`FILTER (isLiteral(${lexicalSource}))`);
          const normalized=nextVariable(state), index=nextVariable(state), raw=nextVariable(state), related=nextVariable(state);
          state.patterns.push(`BIND(REPLACE(STR(${lexicalSource}), "${escapeSparqlString(delimiter)}", ";", "i") AS ${normalized})`);
          state.patterns.push(`VALUES ${index} { ${Array.from({length:64},(_,i)=>i).join(" ")} }`);
          const tokenPattern=`CONCAT("^(?:[^;]*;){", STR(${index}), "}([^;]+)(?:;.*)?$")`;
          state.patterns.push(`FILTER (REGEX(${normalized}, ${tokenPattern}))`);
          state.patterns.push(`BIND(REPLACE(${normalized}, ${tokenPattern}, "$1") AS ${raw})`);
          state.patterns.push(`BIND(REPLACE(${raw}, "^\\\\s+|\\\\s+$", "") AS ${related})`);
          state.patterns.push(`FILTER (STRLEN(${related}) > 0)`);
          if (node.attributes.rid) state.relationBindings.set(node.attributes.rid,related);
          compileNodes(node.children,related,state);
          break;
        }
        if (node.attributes.derive === "regex") {
          const reference = state.references?.subjects.get(node.id);
          if (reference) state.patterns.push(`BIND(${subject} AS ${reference})`);
          const source = state.relationBindings.get(node.attributes.pid || "");
          const pattern = node.attributes.pattern || "";
          const capture = node.attributes.capture || "";
          if (!source || !pattern || pattern.length > 2000 || !/^[1-9]$/.test(capture)) {
            state.errors.push("Derived regex facet is missing a bound spawning facet or a valid capture.");
            break;
          }
          const sourceValuePredicate = node.attributes.sourceValuePredicate || "";
          const predicate = sourceValuePredicate ? iriTerm(sourceValuePredicate) : null;
          if (sourceValuePredicate && !predicate) {
            state.errors.push("Derived regex sourceValuePredicate must be a valid RDF predicate IRI.");
            break;
          }
          const lexicalSource = predicate ? nextVariable(state) : source;
          if (predicate) {
            state.patterns.push(`${source} ${predicate} ${lexicalSource} .`);
            state.patterns.push(`FILTER (isLiteral(${lexicalSource}))`);
          }
          const related = nextVariable(state);
          state.patterns.push(`FILTER (REGEX(STR(${lexicalSource}), "${escapeSparqlString(pattern)}"))`);
          state.patterns.push(`BIND(REPLACE(STR(${lexicalSource}), "${escapeSparqlString(pattern)}", "$${capture}") AS ${related})`);
          if (node.attributes.rid) state.relationBindings.set(node.attributes.rid, related);
          compileNodes(node.children, related, state);
          break;
        }
        const predicate = iriTerm(node.attributes.iri);
        if (!predicate) {
          state.errors.push(`The FCT <${node.name}> node has a missing or unsupported IRI.`);
          break;
        }
        const related = nextVariable(state);
        const reference = state.references?.subjects.get(node.id);
        if (node.attributes.rid) state.relationBindings.set(node.attributes.rid, related);
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
        if (reference) state.patterns.push(`BIND(${node.name === "property-of" ? related : subject} AS ${reference})`);
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
      case "a":
        // <a> is a viewer-only transported facet descriptor. The existing
        // population is unchanged by its presence; only explicit alias
        // projection requests resolve the referenced relationship path.
        break;
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
export function buildFctCountSparql(tree: FctQueryTree, extension?: FacetCountExtension, kindDirection?: "property" | "role", probeKind?: string, temporalPredicate?: string, effectiveLanguage = effectiveMaestroLanguage()): string | null {
  // The scalar/count compiler must honor the same declarative node references
  // as the Results compiler. Otherwise a valid from/fromView would silently
  // yield an unrelated count or disable every numeric-domain preflight.
  const { byId, referencedSubjects } = inspectFctValueReferences(tree as ReferenceNode);
  const rootId = tree.attributes.id;
  const subjects = new Map([...referencedSubjects].map(([id, name]) => [id, `?${name}`]));
  const graphAddress = tree.attributes.addr ?? "";
  const graphDelimiter = graphAddress.indexOf("@");
  const scopedGraph = graphDelimiter >= 0 ? graphAddress.slice(0, graphDelimiter).trim() : "";
  const buildPopulation: CountReferenceResolver["buildPopulation"] = (targetId, valueId, inherited, member) => {
    if (inherited.has(valueId) || inherited.size > 20) throw new Error(`Malformed FCT Query: cyclic fromView reference at ${valueId}.`);
    if (!byId.has(targetId)) throw new Error(`Malformed FCT Query: missing fromView node "${targetId}".`);
    const omitted = new Set([...inherited, valueId]);
    const clone = structuredClone(tree);
    const relocatedView: FctQueryNode = { id: "", name: "view", attributes: { type: "list" }, children: [] };
    const relocate = (node: FctQueryTree | FctQueryNode) => {
      node.children = node.children.filter(child => child.name !== "view");
      for (const child of node.children) relocate(child);
      const id = "id" in node ? node.id : node.attributes.id;
      if (id === targetId) node.children.push(structuredClone(relocatedView));
    };
    relocate(clone);
    const inner: CompilerState = {nextVariable: 1, viewVariable: null, patterns: [], errors: [],
      relationBindings: new Map(), references: {rootId, subjects, omitted, buildPopulation}};
    compileNodes(clone.children, "?fct0", inner);
    if (inner.errors.length) throw new Error(inner.errors.join(" "));
    if (!inner.viewVariable) throw new Error(`Malformed FCT Query: fromView target "${targetId}" has no population.`);
    if (!inner.patterns.some(pattern => /(?:\s|^)<[^>]+>\s|bif:contains/.test(pattern)))
      inner.patterns.unshift("?fct0 ?maestroAnyPredicate ?maestroAnyValue .");
    const body = inner.patterns.join("\n    ");
    const scopedBody = scopedGraph && scopedGraph !== ALL_GRAPHS
      ? `GRAPH ${iriTerm(scopedGraph)} {\n      ${body}\n    }` : body;
    return `{ SELECT DISTINCT (${inner.viewVariable} AS ${member}) WHERE {\n    ${scopedBody}\n  } }`;
  };
  const state: CompilerState = {
    nextVariable: 0,
    viewVariable: null,
    patterns: [],
    errors: [],
    relationBindings: new Map(),
    references: {rootId, subjects, omitted:new Set(), buildPopulation},
  };
  const root = "?fct0";
  state.nextVariable = 1;
  const rootUriMembers = tree.children.filter(node=>node.name==="value" && node.attributes.datatype==="uri");
  const multipleRootMembers = rootUriMembers.length > 1;
  if (multipleRootMembers && (rootUriMembers.length > 120 || tree.children.some(node=>node.name==="value" && node.attributes.datatype!=="uri"))) return null;
  const members = multipleRootMembers ? rootUriMembers.map(valueTerm) : [];
  if (members.some(member=>!member)) return null;
  compileNodes(multipleRootMembers ? tree.children.filter(node=>node.name!=="value") : tree.children, root, state);
  if (multipleRootMembers) state.patterns.unshift(`VALUES ${root} { ${members.join(" ")} }`);
  // A root <view> with no filters is valid for Kind discovery: the candidate
  // property/role triple below binds the otherwise unconstrained root. Ordinary
  // scalar counts still require an explicit finite scope.
  if (state.errors.length || !state.viewVariable || (!state.patterns.length && !kindDirection)) return null;

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
  const preferredLanguage = validMaestroLanguage(effectiveLanguage);
  if (!preferredLanguage) return null;
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
    const kinds = MAESTRO_KIND_IDS;
    const normalizedProbe=probeKind === undefined ? undefined : normalizeMaestroKind(probeKind);
    if (probeKind !== undefined && !normalizedProbe) return null;
    const value = "?maestroKindValue";
    const choices=kinds.map(kind=>maestroKindSparql(kind,value) ?? "false");
    const check = normalizedProbe ? choices[kinds.indexOf(normalizedProbe)] : kinds.map((kind,i)=>`(?maestroKind = "${kind}" && (${choices[i]}))`).join(" || ");
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
  if (temporalPredicate) {
    // Normalize the provider's date, dateTime, gYearMonth, gYear and canonical
    // date-like strings to sortable *day* bounds. Partial dates have a different
    // earliest/latest possible day, so MIN and MAX use separate bindings.
    const predicate = iriTerm(temporalPredicate);
    if (!predicate || extension) return null;
    // A temporal-domain query carries its <view> directly on this property.
    // The view variable is therefore already the date literal: do not add
    // `?dateLiteral dcterms:created ?anotherValue`, which returns no matches.
    const focusedOnTemporalFacet = (() => {
      const contains = (nodes: FctQueryNode[]): boolean => nodes.some(node =>
        node.name === "property" && node.attributes.iri === temporalPredicate && node.children.some(child => child.name === "view") ||
        contains(node.children));
      return contains(tree.children);
    })();
    const source = focusedOnTemporalFacet ? state.viewVariable : "?facetValue";
    // Min/max of ISO lexical forms sorts chronologically for canonical years,
    // months, days and datetimes. Avoid nested conditional BINDs which some
    // Virtuoso builds silently leave unbound in aggregate SELECTs.
    const normalize = `FILTER (isLiteral(${source})) BIND(STR(${source}) AS ?facetLex) FILTER (REGEX(?facetLex, "^[0-9]{4}(-[0-9]{2}(-[0-9]{2}([T ].*)?)?)?$"))`;

    if (focusedOnTemporalFacet) {
      // Avoid nesting a second graph pattern around the already scoped value.
      whereBody += `\n${normalize}`;
    } else {
      const relation = `${state.viewVariable} ${predicate} ?facetValue . ${normalize}`;
      const extraPattern = graph && graph !== ALL_GRAPHS ? `GRAPH <${graph}> { ${relation} }` : relation;
      whereBody += `\nOPTIONAL { ${extraPattern} }`;
    }
    extraProjections = " (MIN(?facetLex) AS ?min) (MAX(?facetLex) AS ?max)";
  }
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

/** Date provider domain, in the live FCT focus and graph scope. Values are ISO
 * calendar days; UI never changes the original RDF literals or query filters. */
export function buildFctTemporalDomainSparql(tree: FctQueryTree, property: string): string | null {
  return buildFctCountSparql(tree, undefined, undefined, undefined, property);
}
