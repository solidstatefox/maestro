"use client";

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
  // URI anchor projected in the same FCT SELECT as a blank-node focus.
  // Not a display badge and not dependent on list-values enrichment.
  recordAnchor?: { parent: string; predicate: string; direction?: "forward" | "reverse"; depth?: number };
  termType?: "uri" | "literal" | "bnode";
  datatype?: string;
  lang?: string;
};

export type ListValueProjection = { property: string; direction: "forward" | "reverse" };

/** Make a read-only clone of the live FCT query for value enrichment.
 * Projection columns are passed separately to the proxy and are never added
 * as FCT relationship nodes or custom attributes. */
export function listValuesQueryClone(xml: string): string {
  const document = new DOMParser().parseFromString(snapshotFctQueryXml(xml, "data"), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid FCT query XML.");
  const view = Array.from(document.getElementsByTagNameNS("http://openlinksw.com/services/facets/1.0", "view"))[0]
    ?? Array.from(document.getElementsByTagName("view"))[0];
  if (!view || !view.parentElement) throw new Error("The live query has no view carrier.");
  view.setAttribute("type", FCT_VIEW_TYPES.LIST_VALUES);
  view.removeAttribute("badges");
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
    const resource = cols[0]?.textContent?.trim() ?? "";
    if (!resource) continue;
    const scoped = cols.slice(2).flatMap((col): ScopeValue[] => {
      const property = col.getAttribute("property") || "";
      if (!property) return [];
      const direction: RelationshipDirection = col.getAttribute("direction") === "reverse" ? "reverse" : "forward";
      const values = Array.from(col.children).filter((node) => node.localName === "value").map((node): EnrichedTerm => {
        const datatype = node.getAttribute("datatype") || undefined;
        const lang = node.getAttribute("xml:lang") || undefined;
        return { value: node.textContent ?? "", type: rdfBindingKind(datatype),
          ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}) };
      });
      return [{ property, direction, label: toLabel(property), values: values.length ? values : [{ value: "-" }] }];
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
  if (document.querySelector("parsererror")) throw new Error("The FCT API returned malformed XML.");
  const byLocalName = (root: ParentNode, name: string) => Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name);
  const root = document.documentElement;
  const getText = (name: string) => byLocalName(root, name)[0]?.textContent?.trim() ?? "";
  const error = presentServerError(getText("error"));
  
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
    const labelColumn = isText ? undefined : (
      columns.slice(1).find((column) => column.attributes?.var === "c2")
      ?? columns.slice(1).find((column) => column.attributes?.recordParent !== "yes" && !isCountColumn(column))
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
        if (!scopeVal.values.some((v) => v.value === nextTerm.value)) {
          scopeVal.values.push(nextTerm);
        }
      }
    }
    // Inspect every structural path ancestor (not display badges). Prefer the
    // nearest URI ancestor, even when the immediate parent is another b-node.
    const structuralParent = first.termType === "bnode"
      ? columns.filter((column) => column.attributes?.recordParent === "yes" && column.termType === "uri"
          && column.value && column.attributes.recordPredicate)
        .sort((a, b) => Number(b.attributes.recordDepth ?? -1) - Number(a.attributes.recordDepth ?? -1))[0]
      : undefined;
    const structuralDepth = structuralParent ? Number(structuralParent.attributes.recordDepth) : NaN;
    const recordAnchor = structuralParent
      ? { parent: structuralParent.value, predicate: structuralParent.attributes.recordPredicate,
          direction: structuralParent.attributes.recordDirection === "reverse" ? "reverse" as const : "forward" as const,
          ...(Number.isSafeInteger(structuralDepth) && structuralDepth >= 0 ? { depth: structuralDepth } : {}) }
      : undefined;
    const item: FctResult = {
      uri: first.value,
      title,
      ...(first.shortform ? { shortform: first.shortform } : {}),
      termType: first.termType ?? "literal",
      ...(first.datatype ? { datatype: first.datatype } : {}),
      ...(first.lang ? { lang: first.lang } : {}),
      columns,
      matches: excerpt ? [{ excerpt, columns: columns.slice(1) }] : [],
      ...(parsedScopeValues.length > 0 ? { scopeValues: parsedScopeValues } : {}),
      ...(recordAnchor ? { recordAnchor } : {}),
    };
    if (resultType === FCT_VIEW_TYPES.LIST_COUNT && second) item.columns = columns;
    // In TEXT views c2 is the excerpt. Later columns can be independent
    // structural Record-identity projections, not additional excerpts.
    if (third && resultType === FCT_VIEW_TYPES.TEXT && second?.attributes?.var !== "c2" && third.attributes?.recordParent !== "yes" && !excerpt)
      item.matches = [{ excerpt: third.value, columns: columns.slice(2) }];
    return [item];
  });
  const facetItems = rowColumns.flatMap((columns) => {
    if (!columns[0]) return [];
    const labelKind = resultType === FCT_VIEW_TYPES.CLASSES ? "Class" : resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? "Role" : resultType === FCT_VIEW_TYPES.PROPERTIES ? "Property" : undefined;
    const exampleColumn = resultType === FCT_VIEW_TYPES.PROPERTIES || resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? columns[2] : undefined;
    return [{
      uri: columns[0].value,
      label: columns[0].label || columns[0].shortform || toLabel(columns[0].value, labelKind),
      count: columns[1]?.value === undefined ? -1 : Number(columns[1].value),
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
  return {
    datatypeEvidence,
    sparql: getText("sparql"),
    viewType: resultType,
    rows: rowColumns,
    complete: getText("complete") === "yes" ? "yes" : "no",
    incomplete: getText("complete") !== "yes" || sqlState === "S1TAT" || Boolean(warning),
	
	...(warning ? { warning } : {}),
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
    properties: resultType === FCT_VIEW_TYPES.PROPERTIES ? facetItems : [],
    classes: resultType === FCT_VIEW_TYPES.CLASSES ? facetItems : [],
    roles: resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? facetItems : [],
    graphs: resultType === FCT_VIEW_TYPES.GRAPHS ? rowColumns.flatMap((columns) => columns[0] ? [{
      uri: columns[0].value,
      // Graph SELECT projects c1=graph, n=distinct matches, bestRank=ranking.
      // The second column is NOT a graph label, and the third is NOT a count.
      label: columns[0].label || columns[0].shortform || toLabel(columns[0].value),
      count: columns[1]?.value === undefined ? -1 : Number(columns[1].value),
    }] : []) : [],
    describe: resultType === FCT_VIEW_TYPES.DESCRIBE ? describe : [],
    count: (resultType === "count" || resultType === FCT_VIEW_TYPES.COUNT_DISTINCT) ? Number(rowColumns[0]?.[0]?.value ?? 0) : undefined,
    shortforms: Array.from(uris, ([uri, metadata]) => ({ uri, ...metadata })),
  };
}

/**
 * Some raw graph-server errors are not actionable as-is. A Virtuoso ANYTIME timeout means the query ran into the
 * server's time limit; the raw text goes to the console and the UI tells the user what to change instead.
 */
export function presentServerError(message: string): string {
  if (/ANYTIME\s+timeout/i.test(message)) {
    console.error("Maestro: the graph server reported an ANYTIME timeout.", message);
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
  if (!response.ok) throw new Error(data.error || `FCT API returned HTTP ${response.status}.`);
  if (data.error) throw new Error(data.error);
  return data;
}

export function groupValueKey(value: FctResult): string {
  return JSON.stringify([value.uri, value.termType ?? "uri", value.datatype ?? "", value.lang ?? ""]);
}

export function fctTermKey(text: string, datatype?: string, lang?: string): string {
  // RDF 1.1 plain literals and xsd:string literals have the same term identity.
  // The FCT response may spell out xsd:string while the FCT <value> uses
  // datatype="string". Their keys must match when reconciling selected values.
  const normalizedDatatype = datatype === "http://www.w3.org/2001/XMLSchema#string" ||
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


