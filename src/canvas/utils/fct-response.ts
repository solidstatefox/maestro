"use client";
import { resolveFacetIri } from "@/lib/fct-facet-iri";
import { browserLog } from "@/lib/maestro-client-logging";
import { normalizeFctFacetItems } from "@/lib/fct-facet-normalization";


import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";
import { snapshotFctQueryXml } from "@/lib/fct-query-api";
import { toLabel } from "@/lib/uri-labels";
import { rdfBindingKind } from "@/lib/bnode";

export type RelationshipDirection = "forward" | "reverse";

export type EnrichedTerm = {
  value: string;
  type?: string;
  datatype?: string;
  lang?: string;
};

export type ScopeValue = {
  id?: string;
  property: string;
  label: string;
  direction: RelationshipDirection;
  values: EnrichedTerm[];
};

export type FctResponseColumn = {
  value: string;
  name?: string;
  shortform?: string;
  label?: string;
  termType?: "uri" | "literal" | "bnode";
  datatype?: string;
  lang?: string;
  attributes: Record<string, string>;
  raw: Record<string, unknown>;
};

export type FctMatch = {
  excerpt: string;
  predicate?: string;
  columns?: FctResponseColumn[];
  graph?: string;
  score?: FctResponseColumn;
  rank?: FctResponseColumn;
};

export type FctResult = {
  uri: string;
  title: string;
  label?: string;
  shortform?: string;
  graph?: string;
  score?: FctResponseColumn;
  rank?: FctResponseColumn;
  columns?: FctResponseColumn[];
  matches: FctMatch[];
  scopeValues?: ScopeValue[];
  termType?: "uri" | "literal" | "bnode";
  datatype?: string;
  lang?: string;
};

export type ListValueProjection = { property: string; direction: "forward" | "reverse"; path?: string[];
  hops?: Array<{ iri: string; direction: "forward" | "reverse" }> };
export type ListValueResource = { type: "uri" | "literal"; value: string; datatype?: string; lang?: string };
const FCT_XML_NS = "http://openlinksw.com/services/facets/1.0";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** Detached population-preserving merge-values request. Its columns are XML
 * relationship nodes plus view-plane anchors for multihop values, never FCT
 * WHERE constraints. A normal list-values query retains ordinary FCT scope.
 * This does not mutate the live query or introduce implicit uid unions.
 */
export function mergeValuesQueryClone(xml: string, columns: readonly ListValueProjection[] = [], resources?: readonly ListValueResource[], projectionIds?: string[]): string {
  const document = new DOMParser().parseFromString(snapshotFctQueryXml(xml, "data"), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid FCT query XML.");
  const root = document.documentElement;
  const originalView = Array.from(root.getElementsByTagName("*")).find(node => node.localName === "view");
  if (!originalView?.parentElement) throw new Error("The live query has no view carrier.");
  const focus = originalView.parentElement;
  // Save the original bindings before replacing the source population.
  const existingFacets = Array.from(focus.children).filter(node => node.localName === "property" || node.localName === "property-of");
  const findExisting = (hops: readonly { iri: string; direction: "forward" | "reverse" }[]): Element | undefined => {
    let candidates = existingFacets;
    let found: Element | undefined;
    for (const hop of hops) {
      found = candidates.find(node => node.localName === (hop.direction === "reverse" ? "property-of" : "property") && node.getAttribute("iri") === hop.iri);
      if (!found) return undefined;
      candidates = Array.from(found.children);
    }
    return found;
  };
  // FCT IDs are base36 letters-first. Preserve the original counter's high
  // water mark, allocate fresh IDs for derived nodes and anchors only.
  const used = new Set(Array.from(root.getElementsByTagName("*")).map(node => node.getAttribute("id")).filter(Boolean));
  let counter = Number.parseInt(root.getAttribute("ctr") || "a", 36);
  if (!Number.isSafeInteger(counter) || counter < 10) counter = 10;
  const alloc = () => {
    while (true) {
      let id = counter.toString(36);
      counter++;
      if (!/^[a-z]/.test(id)) { counter = 10 * 36 ** (id.length - 1); continue; }
      if (used.has(id)) continue;
      used.add(id); return id;
    }
  };
  if (resources) {
    if (!resources.length || resources.length > 100) throw new Error("merge-values resource pages require 1–100 terms.");
    root.replaceChildren();
    for (const term of resources) {
      const value = document.createElementNS(FCT_XML_NS, "value");
      value.setAttribute("id", alloc());
      value.setAttribute("datatype", term.type === "uri" ? "uri" : term.datatype || "string");
      if (term.lang) { value.setAttribute("datatype", "string"); value.setAttributeNS(XML_NS, "xml:lang", term.lang); }
      value.textContent = term.value;
      root.appendChild(value);
    }
  } else originalView.remove();
  const carrier = resources ? root : focus;
  const view = document.createElementNS(FCT_XML_NS, "view");
  view.setAttribute("id", alloc());
  view.setAttribute("type", FCT_VIEW_TYPES.MERGE_VALUES);
  view.setAttribute("limit", resources ? String(resources.length) : originalView.getAttribute("limit") || "100");
  view.setAttribute("offset", resources ? "0" : originalView.getAttribute("offset") || "0");
  carrier.appendChild(view);
  if (columns.length > 24) throw new Error("merge-values supports at most 24 projection columns.");
  for (const column of columns) {
    const hops = column.hops?.length ? column.hops : (column.path?.length ? column.path : [column.property]).map((iri, index) => ({
      iri, direction: index === 0 ? column.direction : "forward" as const,
    }));
    if (!hops.length || hops.length > 16) throw new Error("Invalid merge-values projection path length.");
    const original = findExisting(hops);
    let current: Element = carrier;
    for (const [index, hop] of hops.entries()) {
      if (!/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(hop.iri)) throw new Error("Invalid merge-values predicate IRI.");
      const node = document.createElementNS(FCT_XML_NS, hop.direction === "reverse" ? "property-of" : "property");
      node.setAttribute("id", alloc());
      node.setAttribute("iri", hop.iri);
      if (hops.length > 1 && index === 0) node.setAttribute("column", "false");
      current.appendChild(node);
      current = node;
    }
    if (original) for (const value of Array.from(original.children).filter(child => child.localName === "value"))
      current.appendChild(document.importNode(value, true));
    if (hops.length > 1) {
      const anchor = document.createElementNS(FCT_XML_NS, "a");
      anchor.setAttribute("id", alloc());
      anchor.setAttribute("href", current.getAttribute("id")!);
      carrier.appendChild(anchor);
      projectionIds?.push(anchor.getAttribute("id")!);
    } else projectionIds?.push(current.getAttribute("id")!);
  }
  root.setAttribute("ctr", counter.toString(36));
  return new XMLSerializer().serializeToString(document);
}

/** Read the bounded, typed cells of the Maestro FCT list-values extension. */
export function parseListValuesXml(xml: string): Map<string, ScopeValue[]> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid list-values FCT response XML.");
  const root = doc.documentElement;
  const errorNode = Array.from(root.getElementsByTagName("*")).find((node) => node.localName === "error");
  if (errorNode) throw new Error(errorNode.textContent || "The list-values request failed.");
  const map = new Map<string, ScopeValue[]>();
  const rows = Array.from(root.getElementsByTagName("*")).filter((node) => node.localName === "row");
  for (const row of rows) {
    const cols = Array.from(row.children).filter((node) => node.localName === "column");
    const resource = cols[0]?.textContent ?? "";
    if (!resource) continue;
    const scoped = cols.slice(2).flatMap((col): ScopeValue[] => {
      const property = col.getAttribute("property") || "";
      const id = col.getAttribute("id") || undefined;
      if (!property) return [];
      const direction: RelationshipDirection = col.getAttribute("direction") === "reverse" ? "reverse" : "forward";
      const values = Array.from(col.children).filter((node) => node.localName === "value").map((node): EnrichedTerm => {
        const datatype = node.getAttribute("datatype") || undefined;
        const lang = node.getAttribute("xml:lang") || undefined;
        return { value: node.textContent ?? "", type: rdfBindingKind(datatype),
          ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}) };
      });
      return [{ id, property, direction, label: toLabel(property), values: values.length ? values : [{ value: "-" }] }];
    });
    map.set(resource, scoped);
  }
  return map;
}

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export type ParsedFctResponse = {
  datatypeEvidence?: Array<{ datatype: string; originalDatatype?: string; count: number }>;
  sparql: string;
  executionAddr?: string;
  viewType: string;
  rows: FctResponseColumn[][];
  complete: "yes" | "no";
  rowCount: number;
  incomplete: boolean;
  results: FctResult[];
  properties: { uri: string; label: string; count: number }[];
  classes: { uri: string; label: string; count: number }[];
  roles: { uri: string; label: string; count: number }[];
  graphs: { uri: string; label: string; count: number }[];
  describe: { subject: FctResponseColumn; predicate: FctResponseColumn; object: FctResponseColumn }[];
  count?: number;
  shortforms: { uri: string; shortform?: string; label?: string }[];
    warning?: string;
  sqlState?: string;
  sqlMessage?: string;
  execMilliseconds?: string;
  dbActivity?: string;
  error?: string;
};

export function parseFctResponse(xmlText: string): ParsedFctResponse {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) throw new Error(`The FCT API returned malformed XML.\n\nRaw response XML (verbatim):\n${xmlText}`);
  const byLocalName = (root: ParentNode, name: string) => Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name);
  const root = document.documentElement;
  const getText = (name: string) => byLocalName(root, name)[0]?.textContent?.trim() ?? "";
  const error = presentServerError(getText("error"));
  const executionAddr = root.getAttribute("execution-addr") ?? undefined;
  
  const warning = getText("warning");
const sqlState = getText("sql-state");
const sqlMessage = getText("sql-message");
const execMilliseconds = getText("exec-milliseconds");
const dbActivity = getText("db-activity");

  if (error) return { sparql: getText("sparql"), viewType: "error", rows: [], complete: "no", rowCount: 0, results: [], properties: [], classes: [], roles: [], graphs: [], describe: [], count: undefined, shortforms: [], incomplete: true, error };
  const datatypeEvidence = byLocalName(root, "datatypeEvidence").flatMap(e => byLocalName(e, "datatype")).map(e => ({
    datatype: e.getAttribute("iri") ?? "", originalDatatype: e.getAttribute("originalDatatype") ?? undefined, count: Number(e.getAttribute("count") ?? "0"),
  })).filter(e => e.datatype && Number.isFinite(e.count) && e.count > 0);
  const resultNode = byLocalName(root, "result")[0];
  const resultType = resultNode?.getAttribute("type") ?? "text";
  const documentBase = root.getAttributeNS("http://www.w3.org/XML/1998/namespace", "base") || resultNode?.getAttributeNS("http://www.w3.org/XML/1998/namespace", "base") || undefined;
  const rows = resultNode ? byLocalName(resultNode, "row") : [];
  const termColumn = (element: Element, index: number): FctResponseColumn => {
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) attributes[attribute.name] = attribute.value;
    const datatype = element.getAttribute("datatype") ?? undefined;
    const lang = element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") ?? element.getAttribute("xml:lang") ?? undefined;
    const shortform = element.getAttribute("shortform") ?? undefined;
    const label = element.getAttribute("label") ?? undefined;
    const termType = rdfBindingKind(datatype);
    return { value: element.textContent ?? "", name: String(index + 1), termType, ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}), ...(shortform ? { shortform } : {}), ...(label ? { label } : {}), attributes, raw: { "#text": element.textContent ?? "", ...attributes } };
  };
  const rowColumns = rows.map((row) => byLocalName(row, "column").map(termColumn));
  const firstTerm = (columns: FctResponseColumn[]) => columns[0];
  const results: FctResult[] = rowColumns.flatMap((columns) => {
    const first = firstTerm(columns);
    if (!first) return [];
    const second = columns[1];
    const third = columns[2];
    const isText = resultType === FCT_VIEW_TYPES.TEXT;
    const excerpt = isText ? (columns.find((column) => column.attributes?.var === "c2")?.value ?? "") : "";
    // A label column is any later column that is not a count. Count-sorted list
    // views (Group By) put the integer COUNT in column 2 and the label, if any,
    // after it; reading column 2 as the label made some titles show the count.
    const isCountColumn = (column: FctResponseColumn) =>
      column.attributes?.var === "ct" || column.attributes?.var === "n"
      || /#(?:integer|int|long|short|nonNegativeInteger|positiveInteger|unsignedInt|unsignedLong)$/.test(column.datatype ?? "");
    // Auxiliary SPARQL projections (sampled subjects, ancestor paths, group
    // counts) are not labels. In particular, a ?sampleSubject URI must never
    // replace the title of the actual c1 value in a property-focused list.
    const isDisplayLabel = (column: FctResponseColumn) =>
      !isCountColumn(column) && column.termType === "literal" &&
      !/^(sampleSubject|recordAncestor\d*|bestRank|score|rank|cluster|sampleLabel)$/i.test(column.attributes?.var ?? "");
    const labelColumn = isText ? undefined : (
      columns.slice(1).find((column) => column.attributes?.var === "c2" && isDisplayLabel(column))
      ?? columns.slice(1).find(isDisplayLabel)
    );
    const title = first.termType === "uri"
      ? (first.label || labelColumn?.value || toLabel(first.value))
      : (labelColumn?.value || first.value);
    const parsedScopeValues: ScopeValue[] = [];
    const scopeValueMap = new Map<string, ScopeValue>();
    for (const column of columns) {
      const propIri = column.attributes?.property;
      if (!propIri) continue;
      const direction: RelationshipDirection = column.attributes?.direction === "reverse" ? "reverse" : "forward";
      const key = `${direction}\u0000${propIri}`;
      let scopeVal = scopeValueMap.get(key);
      if (!scopeVal) {
        scopeVal = {
          property: propIri,
          label: toLabel(propIri),
          direction,
          values: [],
        };
        scopeValueMap.set(key, scopeVal);
        parsedScopeValues.push(scopeVal);
      }
      if (column.value) {
        const nextTerm: EnrichedTerm = {
          value: column.value,
          ...(column.termType ? { type: column.termType } : {}),
          ...(column.datatype ? { datatype: column.datatype } : {}),
          ...(column.lang ? { lang: column.lang } : {}),
        };
        if (!scopeVal.values.some((v) => fctTermKey(v.value, v.datatype ?? (v.type === "uri" ? "uri" : v.lang ? undefined : "string"), v.lang) === fctTermKey(nextTerm.value, nextTerm.datatype ?? (nextTerm.type === "uri" ? "uri" : nextTerm.lang ? undefined : "string"), nextTerm.lang))) {
          scopeVal.values.push(nextTerm);
        }
      }
    }
    const item: FctResult = {
      uri: first.value,
      title,
      ...(first.shortform ? { shortform: first.shortform } : {}),
      termType: first.termType ?? "literal",
      ...(first.datatype ? { datatype: first.datatype } : {}),
      ...(first.lang ? { lang: first.lang } : {}),
      columns,
      matches: excerpt ? [{ excerpt, ...(isText && columns.find(column => column.attributes?.var === "matchPredicate")?.termType === "uri"
        ? { predicate: columns.find(column => column.attributes?.var === "matchPredicate")!.value } : {}), columns: columns.slice(1) }] : [],
      ...(parsedScopeValues.length > 0 ? { scopeValues: parsedScopeValues } : {}),
    };
    if (resultType === FCT_VIEW_TYPES.LIST_COUNT && second) item.columns = columns;
    // In TEXT views c2 is the excerpt; other data columns are display-only.
    if (third && resultType === FCT_VIEW_TYPES.TEXT && second?.attributes?.var !== "c2" && !excerpt)
      item.matches = [{ excerpt: third.value, columns: columns.slice(2) }];
    return [item];
  });
  let invalidClassCount = 0;
  const facetItems = rowColumns.flatMap((rawColumns) => {
    const predicateFacet = resultType === FCT_VIEW_TYPES.PROPERTIES || resultType === FCT_VIEW_TYPES.PROPERTIES_IN;
    const named = (name:string) => rawColumns.find(column=>column.attributes.var===name);
    const columns = predicateFacet && rawColumns.some(column=>column.attributes.var)
      ? [named("c1"),named("n"),named("sampleVal")] : rawColumns;
    if (!columns[0]) return [];
    if (predicateFacet && (columns[0].termType!=="uri" || !resolveFacetIri(columns[0].value) || (columns[1]?.value.trim() && Number(columns[1].value)===0))) return [];
    // Only a full RDF class URI can be serialized as <class iri="...">.
    // Resolve relative values solely when the FCT response declares xml:base;
    // never resolve #OscarNominee against the Maestro app or SPARQL endpoint.
    const classUri = resultType === FCT_VIEW_TYPES.CLASSES
      ? (resolveFacetIri(columns[0].attributes.iri || columns[0].value, documentBase) ?? resolveFacetIri(columns[0].value, documentBase))
      : null;
    if (resultType === FCT_VIEW_TYPES.CLASSES && !classUri) {invalidClassCount++;return [];}
    const value = classUri ?? columns[0].value;
    const labelKind = resultType === FCT_VIEW_TYPES.CLASSES ? "Class" : resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? "Role" : resultType === FCT_VIEW_TYPES.PROPERTIES ? "Property" : undefined;
    const exampleColumn = resultType === FCT_VIEW_TYPES.PROPERTIES || resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? columns[2] : undefined;
    return [{
      uri: value,
      label: columns[0].label || columns[0].shortform || toLabel(value, labelKind),
      count: columns[1]?.value === undefined || !columns[1].value.trim() || !Number.isFinite(Number(columns[1].value))
        ? -1 : Number(columns[1].value),
      ...(resultType === FCT_VIEW_TYPES.CLASSES && columns[2]?.termType === "uri" && columns[2].value ? { parent: columns[2].value } : {}),
      ...(exampleColumn?.value ? { example: { uri: exampleColumn.value, label: exampleColumn.label || exampleColumn.shortform || (exampleColumn.termType === "uri" ? toLabel(exampleColumn.value, "Class") : exampleColumn.value), termType: exampleColumn.termType } } : {}),
    }];
  });
  const describe = rowColumns.flatMap((columns) => columns.length >= 3 ? [{ subject: columns[0], predicate: columns[1], object: columns[2] }] : []);
  const uris = new Map<string, { shortform?: string; label?: string }>();
  for (const columns of rowColumns) {
    for (const column of columns) {
      if (column.termType !== "uri") continue;
      const previous = uris.get(column.value);
      uris.set(column.value, {
        ...(column.shortform || previous?.shortform ? { shortform: column.shortform || previous?.shortform } : {}),
        ...(column.label || previous?.label ? { label: column.label || previous?.label } : {}),
      });
    }
  }
  const categoryWarning = invalidClassCount ? `${invalidClassCount} Category IRI(s) were relative without an XML base; those entries cannot be selected safely.` : "";
  return {
    datatypeEvidence,
    sparql: getText("sparql"),
    executionAddr,
    viewType: resultType,
    rows: rowColumns,
    complete: getText("complete") === "yes" ? "yes" : "no",
    incomplete: getText("complete") !== "yes" || sqlState === "S1TAT" || Boolean(warning),
	
	...((warning || categoryWarning) ? { warning: [warning,categoryWarning].filter(Boolean).join("; ") } : {}),
...(sqlState ? { sqlState } : {}),
...(sqlMessage ? { sqlMessage } : {}),
...(execMilliseconds ? { execMilliseconds } : {}),
...(dbActivity ? { dbActivity } : {}),
	
    rowCount: Number(getText("processed") || rows.length),
    // All native list views yield FCT result rows. Omitting the new property-
    // usage views here made Subjects and Values display zero even when the
    // proxy's SPARQL and FCT XML both contained successful results.
    results: (
      resultType === FCT_VIEW_TYPES.TEXT ||
      resultType === FCT_VIEW_TYPES.LIST ||
      resultType === FCT_VIEW_TYPES.LIST_COUNT ||
      resultType === FCT_VIEW_TYPES.LIST_SUBJECTS ||
      resultType === FCT_VIEW_TYPES.LIST_OBJECTS
    ) ? results : [],
    properties: resultType === FCT_VIEW_TYPES.PROPERTIES ? normalizeFctFacetItems(facetItems) : [],
    classes: resultType === FCT_VIEW_TYPES.CLASSES ? normalizeFctFacetItems(facetItems, true) : [],
    roles: resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? normalizeFctFacetItems(facetItems) : [],
    graphs: resultType === FCT_VIEW_TYPES.GRAPHS ? normalizeFctFacetItems(rowColumns.flatMap((columns) => columns[0] ? [{
      uri: columns[0].value,
      // Graph SELECT projects c1=graph, n=distinct matches, bestRank=ranking.
      // The second column is NOT a graph label, and the third is NOT a count.
      label: columns[0].label || columns[0].shortform || toLabel(columns[0].value),
      count: columns[1]?.value === undefined || !columns[1].value.trim() || !Number.isFinite(Number(columns[1].value))
        ? -1 : Number(columns[1].value),
    }] : [])) : [],
    describe: resultType === FCT_VIEW_TYPES.DESCRIBE ? describe : [],
    count: (resultType === "count" || resultType === FCT_VIEW_TYPES.COUNT_DISTINCT) && /^\d+$/.test(rowColumns[0]?.[0]?.value ?? "") ? Number(rowColumns[0][0].value) : undefined,
    shortforms: Array.from(uris, ([uri, metadata]) => ({ uri, ...metadata })),
  };
}

/**
 * Some raw graph-server errors are not actionable as-is. A Virtuoso ANYTIME timeout means the query ran into the
 * server's time limit; the browser logger emits a bounded diagnostic (when enabled)
 * and the UI tells the user what to change instead.
 */
export function presentServerError(message: string): string {
  if (/ANYTIME\s+timeout/i.test(message)) {
    browserLog.debug("fct.anytime.timeout", message);
    return `The graph server reported an ANYTIME timeout (partial or no results). ${message} Check the query's complexity and the graph server's own timeout limit; a nonzero Maestro timeout does not override server limits.`;
  }
  return message;
}

/** Browser/undici fetch errors are often just "Failed to fetch"; say what actually failed. */
export function facetLoadErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;
  if (/^(failed to fetch|fetch failed|load failed|network ?error)/i.test(message)) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
    return `${message}${causeText ? `: ${causeText}` : ""} — the request to the Maestro server did not complete (server down, network interruption, or blocked request).`;
  }
  return presentServerError(message);
}

export async function readFctResponse(response: Response): Promise<ParsedFctResponse> {
  const text = await response.text();
  const data = parseFctResponse(text);
  if (!response.ok) {
    if (response.status === 504 && response.headers.get("X-Maestro-Failure-Origin") === "upstream-transport") {
      browserLog.warn("fct.response.unavailable", data.error || `FCT API returned HTTP ${response.status}.`);
      throw new Error("No usable response was received from the graph server.");
    }
    throw new Error(data.error || `FCT API returned HTTP ${response.status}.`);
  }
  if (data.error) throw new Error(data.error);
  return data;
}

/** The FCT server may return multiple rows for one facet term (for example
 * multiple labels or joins). Facet widgets are SETS of RDF terms, never a
 * list of raw SELECT rows. Keep the first result in server order and enrich
 * only absent display metadata. A grouped count is an aggregate of the term,
 * NOT a per-row contribution: summing duplicated counts invents members.
 *
 * Do not apply this to ordinary Browse Results: several text matches for one
 * resource can be independent results. This function belongs at the boundary
 * of each derived facet value query and is safe for both direct/role facets.
 */
/** Authoritative membership aggregate from the count-sorted LIST response. */
export function facetMembershipCount(value: FctResult): number | undefined {
  const lexical = value.columns?.find(column => column.attributes?.var === "ct")?.value;
  if (lexical === undefined || !/^\d+$/.test(lexical.trim())) return undefined;
  const count = Number(lexical);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

/** Missing aggregates are an invalid response, not a zero count. Exclude
 * confirmed zero rows before they enter widget state or pagination. */
export function countedFacetValues(values: readonly FctResult[]): FctResult[] {
  if (values.some(value => facetMembershipCount(value) === undefined))
    throw new Error("Personal facet response is missing a valid membership count (?ct).");
  return distinctFacetValues(values.filter(value => facetMembershipCount(value)! > 0));
}

export function distinctFacetValues(values: readonly FctResult[]): FctResult[] {
  const byTerm = new Map<string, FctResult>();
  for (const value of values) {
    const key = facetValueKey(value);
    const existing = byTerm.get(key);
    if (!existing) {
      byTerm.set(key, value);
      continue;
    }
    // Prefer an actual label if a later row supplies one. Keep the original
    // first-seen order and do not concatenate counts from repeated SELECT rows.
    if ((existing.title === existing.uri || !existing.title) && value.title && value.title !== value.uri) {
      byTerm.set(key, { ...existing, title: value.title, ...(value.label ? { label: value.label } : {}) });
    }
  }
  return [...byTerm.values()];
}

export function groupValueKey(value: FctResult): string {
  return JSON.stringify([value.uri, value.termType ?? "uri", value.datatype ?? "", value.lang ?? ""]);
}

export function fctTermKey(text: string, datatype?: string, lang?: string): string {
  // RDF 1.1 plain literals and xsd:string literals have the same term identity.
  // The FCT response may spell out xsd:string while the FCT <value> uses
  // datatype="string". Their keys must match when reconciling selected values.
  // RDF 1.1 language-tagged literals always have rdf:langString as their
  // datatype. Some FCT projections omit it while others spell it out;
  // both represent the same RDF term, provided xml:lang is present.
  const normalizedDatatype = lang && datatype === "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
    ? "" : datatype === "http://www.w3.org/2001/XMLSchema#string" ||
    datatype === "http://www.openlinksw.com/schemas/facets/dtp/plainstring" ? "string" : datatype;
  return JSON.stringify([text, normalizedDatatype ?? (lang ? "" : "uri"), lang?.toLowerCase() ?? ""]);
}

export function facetValueKey(value: FctResult): string {
  const binding = groupValueBinding(value);
  // Literal results without an explicit datatype are FCT strings, not URIs.
  // Keep this key aligned with queryValueKey so a one-item literal facet
  // remains visibly checked after its checkbox is clicked.
  const datatype = binding.datatype ?? (binding.lang ? undefined : value.termType === "uri" ? "uri" : "string");
  return fctTermKey(binding.text, datatype, binding.lang);
}

export function groupValueBinding(value: FctResult): {
  text: string;
  datatype?: string;
  lang?: string;
} {
  const isUri = value.termType === "uri";
  const datatype =
    value.datatype ===
    "http://www.openlinksw.com/schemas/facets/dtp/plainstring"
      ? "string"
      : value.datatype;

  return {
    text: value.uri,
    ...(isUri
      ? { datatype: "uri" }
      : datatype
        ? { datatype }
        : value.lang
          ? {}
          : { datatype: "string" }),
    ...(value.lang ? { lang: value.lang } : {}),
  };
}


