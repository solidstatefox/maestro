"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { rememberShortforms, toLabel } from "@/lib/uri-labels";
import { proxyDebugFingerprint, proxyDebugHeaders } from "@/lib/proxy-debug";
import { buildFctCountSparql } from "@/lib/fct-count-sparql";
import { buildFctResultsSparql } from "@/lib/fct-results-sparql";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Bot, CircleSlash, Code2, Expand, List, Network, RefreshCw, Settings, Link, Shrink, Trash2, UsersRound, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CodeBlock } from "@/components/ui/code-block";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import xmlFormat from "xml-formatter";
import hljs from "highlight.js/lib/core";
import xmlLanguage from "highlight.js/lib/languages/xml";
import sqlLanguage from "highlight.js/lib/languages/sql";
import { useFctQuery, serializeFctQuery, createPropertyWidgetQuery, createGroupMemberQuery, createGroupValuesQuery, createDistinctCountQuery, setQueryViewAttributes } from "@/lib/fct-query-api";
import type { FctQueryNode, FctQueryTree, DistinctCountKind } from "@/lib/fct-query-api";

hljs.registerLanguage("xml", xmlLanguage);
// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.
hljs.registerLanguage("sparql", sqlLanguage);

/*
const sampleResults = [
  { uri: "https://example.org/alice", title: "Alice Smith" },
  { uri: "https://example.org/bob", title: "Bob Jones" },
  { uri: "https://example.org/carol", title: "Carol White" },
  { uri: "https://example.org/company", title: "Example Organization" },
];

const sampleRecords: Record<string, { property: string; value: string }[]> = {
  "https://example.org/alice": [
    { property: "rdf:type", value: "Person" },
    { property: "foaf:name", value: "Alice Smith" },
    { property: "foaf:mbox", value: "alice@example.org" },
  ],
  "https://example.org/bob": [
    { property: "rdf:type", value: "Person" },
    { property: "foaf:name", value: "Bob Jones" },
  ],
  "https://example.org/carol": [
    { property: "rdf:type", value: "Person" },
    { property: "foaf:name", value: "Carol White" },
  ],
  "https://example.org/company": [
    { property: "rdf:type", value: "Organization" },
    { property: "foaf:name", value: "Example Organization" },
  ],
};
*/

const facets = {
  Properties: [],
  Classes: [],
  Roles: [],
  Graphs: [],
};

const DEFAULT_RESULTS_PAGE_SIZE = 30;
const RESULTS_PAGE_SIZE_STORAGE_KEY = "maestro-results-page-size";
const RESULTS_PAGE_SIZE_OPTIONS = [10, 20, 30, 50] as const;
const RESULTS_BATCH_SIZE_OPTIONS = [30, 100, 250, 500, 1000] as const;



type FacetItem = {
  uri: string;
  label: string;
  count: number;
};

type FacetName = string;

type EnrichedTerm = {
  value: string;
  type?: string;
  datatype?: string;
  lang?: string;
};

type ScopeValue = {
  property: string;
  label: string;
  direction: RelationshipDirection;
  values: EnrichedTerm[];
};

type FctResponseColumn = {
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

type FctMatch = {
  excerpt: string;
  columns?: FctResponseColumn[];
  graph?: string;
  score?: FctResponseColumn;
  rank?: FctResponseColumn;
};

type FctResult = {
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

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

type ParsedFctResponse = {
  sparql: string;
  viewType: string;
  rows: FctResponseColumn[][];
  complete: "yes" | "no";
  rowCount: number;
  results: FctResult[];
  properties: { uri: string; label: string; count: number }[];
  classes: { uri: string; label: string; count: number }[];
  roles: { uri: string; label: string; count: number }[];
  graphs: string[];
  describe: { subject: FctResponseColumn; predicate: FctResponseColumn; object: FctResponseColumn }[];
  count?: number;
  shortforms: { uri: string; shortform?: string; label?: string }[];
  error?: string;
};

function parseFctResponse(xmlText: string): ParsedFctResponse {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The FCT API returned malformed XML.");
  const byLocalName = (root: ParentNode, name: string) => Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name);
  const root = document.documentElement;
  const getText = (name: string) => byLocalName(root, name)[0]?.textContent?.trim() ?? "";
  const error = getText("error");
  if (error) return { sparql: getText("sparql"), viewType: "error", rows: [], complete: "no", rowCount: 0, results: [], properties: [], classes: [], roles: [], graphs: [], describe: [], count: undefined, shortforms: [], error };
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
    const termType = datatype === "uri" || datatype === "url" ? "uri" : datatype === "bnode" ? "bnode" : "literal";
    return { value: element.textContent ?? "", name: String(index + 1), termType, ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}), ...(shortform ? { shortform } : {}), ...(label ? { label } : {}), attributes, raw: { "#text": element.textContent ?? "", ...attributes } };
  };
  const rowColumns = rows.map((row) => byLocalName(row, "column").map(termColumn));
  const firstTerm = (columns: FctResponseColumn[]) => columns[0];
  const results: FctResult[] = rowColumns.flatMap((columns) => {
    const first = firstTerm(columns);
    if (!first) return [];
    const second = columns[1];
    const third = columns[2];
    const isText = resultType === "text";
    const excerpt = isText ? (second?.value ?? "") : "";
    const title = first.termType === "uri" ? (first.label || (second && !isText ? second.value : toLabel(first.value))) : (!isText && second ? second.value : first.value);
    const item: FctResult = {
      uri: first.value,
      title,
      ...(first.shortform ? { shortform: first.shortform } : {}),
      termType: first.termType ?? "literal",
      ...(first.datatype ? { datatype: first.datatype } : {}),
      ...(first.lang ? { lang: first.lang } : {}),
      columns,
      matches: excerpt ? [{ excerpt, columns: columns.slice(1) }] : [],
    };
    if (resultType === "list-count" && second) item.columns = columns;
    if (third && resultType === "text") item.matches = [{ excerpt: third.value, columns: columns.slice(2) }];
    return [item];
  });
  const facetItems = rowColumns.flatMap((columns) => {
    if (!columns[0]) return [];
    return [{ uri: columns[0].value, label: columns[0].label || columns[0].shortform || toLabel(columns[0].value), count: Number(columns[1]?.value ?? 0) }];
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
    sparql: getText("sparql"),
    viewType: resultType,
    rows: rowColumns,
    complete: getText("complete") === "yes" ? "yes" : "no",
    rowCount: Number(getText("processed") || rows.length),
    results: resultType === "text" || resultType === "list" || resultType === "list-count" ? results : [],
    properties: resultType === "properties" ? facetItems : [],
    classes: resultType === "classes" ? facetItems : [],
    roles: resultType === "properties-in" ? facetItems : [],
    graphs: resultType === "graphs" ? rowColumns.flatMap((columns) => columns[0] ? [columns[0].value] : []) : [],
    describe: resultType === "describe" ? describe : [],
    count: resultType === "count" ? Number(rowColumns[0]?.[0]?.value ?? 0) : undefined,
    shortforms: Array.from(uris, ([uri, metadata]) => ({ uri, ...metadata })),
  };
}

async function readFctResponse(response: Response): Promise<ParsedFctResponse> {
  const text = await response.text();
  const data = parseFctResponse(text);
  if (!response.ok) throw new Error(data.error || `FCT API returned HTTP ${response.status}.`);
  if (data.error) throw new Error(data.error);
  return data;
}

function groupValueKey(value: FctResult): string {
  return JSON.stringify([value.uri, value.termType ?? "uri", value.datatype ?? "", value.lang ?? ""]);
}

function fctTermKey(text: string, datatype?: string, lang?: string): string {
  return JSON.stringify([text, datatype ?? "uri", lang ?? ""]);
}

function facetValueKey(value: FctResult): string {
  const binding = groupValueBinding(value);
  return fctTermKey(binding.text, binding.datatype, binding.lang);
}

function groupValueBinding(value: FctResult): {
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


type PersonalWidget = {
  uri: string;
  label: string;
  excluded: boolean;
  values: FctResult[];
  selectedValues: string[];
  page: number;
  loading: boolean;
  error: string;
};

type RelationshipDirection = "forward" | "reverse";
type ScopeRelationship = { uri: string; direction: RelationshipDirection };
type GroupByOption = ScopeRelationship & { key: string; label: string; nodeId: string; memberBindingNodeId?: string; ancestorRole?: boolean };

type GroupMembersState = { results: FctResult[]; count?: number; loading: boolean; error: string; offset?: number; hasMore?: boolean };


/** Hover-only query inspector for any widget backed by an FCT or SPARQL request. */
function QueryInspectorButton({
  query,
  language = "xml",
  filename,
  label = "View query",
  countQuery,
  countFilename,
  extraQueries = [],
  headerTone = false,
}: {
  query: string;
  language?: "xml" | "sparql";
  filename: string;
  label?: string;
  countQuery?: string | null;
  countFilename?: string;
  extraQueries?: { id: string; label: string; query: string; filename: string; language?: "xml" | "sparql" }[];
  headerTone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("widget");
  if (!query.trim()) return null;
  const showingCount = Boolean(countQuery?.trim()) && activeTab === "count";
  const selectedExtraQuery = extraQueries.find((item) => item.id === activeTab);
  const displayedCode = showingCount ? countQuery! : selectedExtraQuery?.query ?? query;
  const displayedFilename = showingCount ? (countFilename ?? "first-item-count.sparql").replace(/\.xml$/i, ".sparql") : selectedExtraQuery?.filename ?? filename;
  const displayedLanguage = showingCount || selectedExtraQuery ? selectedExtraQuery?.language ?? "sparql" : language;
  return (
    <>
      <button
        type="button"
        onClick={() => { setActiveTab("widget"); setOpen(true); }}
        aria-label={`${label}: ${filename}`}
        title={label}
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded border opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/header:opacity-100 ${headerTone ? "border-sky-700 bg-sky-800 text-sky-50 hover:bg-sky-700 hover:text-sky-50 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900" : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}
      >
        <Code2 className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-label={`${label}: ${filename}`} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-background p-3 shadow-xl">
            <header className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Query inspector</h2>
                <p className="text-xs text-muted-foreground">Inspect the request used to populate this widget.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent" aria-label="Close query viewer"><X className="size-4" /></button>
            </header>
            {(countQuery?.trim() || extraQueries.length > 0) && (
              <div role="tablist" aria-label="Widget queries" className="mb-3 flex flex-wrap gap-1 border-b">
                <button type="button" role="tab" aria-selected={activeTab === "widget"} onClick={() => setActiveTab("widget")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "widget" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>{countQuery?.trim() ? "Results SPARQL" : "FCT query"}</button>
                {countQuery?.trim() && <button type="button" role="tab" aria-selected={activeTab === "count"} onClick={() => setActiveTab("count")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "count" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>Count SPARQL query</button>}
                {extraQueries.map((item) => <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} onClick={() => setActiveTab(item.id)} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === item.id ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>{item.label}</button>)}
              </div>
            )}
            <p className="mb-2 text-xs text-muted-foreground">{displayedFilename} · {displayedLanguage.toUpperCase()}</p>
            <CodeBlock className="min-h-0 flex-1" code={displayedCode} language={displayedLanguage} filename={displayedFilename} />
          </section>
        </div>
      )}
    </>
  );
}

/** Build the exact count query used as the identity for a candidate's live-scope count. */
function distinctCountQueryFor(
  tree: FctQueryTree,
  kind: DistinctCountKind,
  uri: string,
  propertyUri?: string,
  candidateValue?: FctResult,
): string {
  const viewType =
    kind === "property" ? "properties"
      : kind === "role" ? "properties-in"
        : kind === "class" ? "classes"
          : "list-count";
  return buildFctCountSparql(
    createDistinctCountQuery(tree, kind, uri, propertyUri, candidateValue, viewType),
  ) ?? "";
}

/** Each visible item requests its own distinct-row count through the same-origin SPARQL proxy. */
function DistinctCount({
  tree,
  kind,
  uri,
  propertyUri,
  candidateValue,
  onCountChange,
}: {
  tree: FctQueryTree;
  kind: DistinctCountKind;
  uri: string;
  propertyUri?: string;
  candidateValue?: FctResult;
  onCountChange?: (query: string, count: number | null) => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Key this effect by the compiled scalar count query, not the full browsing
  // query. The compiler deliberately ignores <view> limit/offset, so Results
  // pagination does not refetch every facet count.
  const countSparqlQuery = distinctCountQueryFor(
    tree, kind, uri, propertyUri, candidateValue,
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadCount() {
      let stage = "building scalar count SPARQL from the query tree";
      try {
        if (!countSparqlQuery) {
          throw new Error("The current FCT query tree contains a condition that cannot be compiled safely to SPARQL.");
        }
        stage = "executing scalar count SPARQL";
        const sparqlResponse = await fetch("/proxy/api/sparql", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("distinct-count-sparql", `DistinctCount:${kind}:${propertyUri ?? ""}:${uri}`) },
          body: JSON.stringify({ facetValueCount: { sparql: countSparqlQuery } }),
          signal: controller.signal,
        });
        const sparqlData = await sparqlResponse.json();
        if (!sparqlResponse.ok) {
          throw new Error(sparqlData.error ?? "Failed to execute the item count against SPARQL.");
        }
        stage = "validating scalar count response";
        const parsedCount = Number(sparqlData.count);
        if (!Number.isFinite(parsedCount) || parsedCount < 0) {
          throw new Error("The SPARQL endpoint returned an invalid item count.");
        }
        if (!cancelled) {
          setCount(parsedCount);
          onCountChange?.(countSparqlQuery, parsedCount);
        }
      } catch (requestError) {
        if (
          cancelled ||
          (requestError instanceof Error && requestError.name === "AbortError")
        )
          return;
        const message = requestError instanceof Error ? requestError.message : "Could not load distinct count.";
        console.warn("Maestro facet item count failed", { kind, uri, propertyUri, stage, error: message });
        setError(`${stage}: ${message}`);
      }
    }

    // Query-tree edits can be emitted as a short sequence of intermediate states
    // (for example, deleting a bespoke facet). Wait for that sequence to settle so
    // one user action does not issue/flicker through several obsolete count queries.
    console.info("Maestro DistinctCount effect scheduled", {
      kind,
      uri,
      propertyUri,
      countSparqlLength: countSparqlQuery?.length ?? 0,
      countQueryFingerprint: countSparqlQuery ? proxyDebugFingerprint(countSparqlQuery) : "unsupported-query-tree",
    });
    const refreshTimer = window.setTimeout(() => {
      if (cancelled) return;
      console.info("Maestro DistinctCount request starting", { kind, uri, propertyUri });
      setCount(null);
      onCountChange?.(countSparqlQuery, null);
      setError("");
      void loadCount();
    }, 45);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      controller.abort();
      console.info("Maestro DistinctCount effect cleaned up", { kind, uri, propertyUri });
    };
    // The compiled scalar count query is the semantic identity. Results paging,
    // parent object identity, and other non-count UI changes do not restart it.
  }, [countSparqlQuery]);

  return (
    <span
      className={`shrink-0 text-xs ${error || count === 0 ? "text-destructive" : "text-muted-foreground"}`}
      aria-live="polite"
      aria-invalid={count === 0 ? true : undefined}
      title={
        error
          ? `Could not load distinct count: ${error}`
          : kind === "property"
            ? "Distinct property values"
            : kind === "role"
              ? "Distinct role values"
              : "Distinct results"
      }
    >
      {error
        ? "!"
        : count === null
          ? "…"
          : count.toLocaleString()}
    </span>
  );
}

/** Return selected property nodes from the sibling scope containing the active view.
 * The query tree's structure establishes scope; an internal ID prefix must not
 * decide whether a serialized <property> sibling appears in the Selected list.
 */
function getActiveViewPropertyFilters(tree: FctQueryTree): FctQueryNode[] {
  function findScope(nodes: FctQueryNode[]): FctQueryNode[] | null {
    if (nodes.some((node) => node.id === "query-view")) return nodes;
    for (const node of nodes) {
      const nested = findScope(node.children);
      if (nested) return nested;
    }
    return null;
  }
  return (findScope(tree.children) ?? []).filter((node) =>
    node.name === "property" && typeof node.attributes.iri === "string" && node.attributes.iri.length > 0,
  );
}

/** Return reverse-property filters attached to the active view's scope only.
 * Ancestor <property-of> nodes are navigation breadcrumbs, not filters for the
 * current result set; leaf role-filter nodes are the scope-local selections.
 */
function getActiveViewRoleFilters(tree: FctQueryTree): FctQueryNode[] {
  function findViewScope(nodes: FctQueryNode[]): FctQueryNode[] | null {
    for (const node of nodes) {
      if (node.children.some((child) => child.id === "query-view")) {
        return node.children;
      }
      const nested = findViewScope(node.children);
      if (nested) return nested;
    }
    // The active view can be at the root.
    if (nodes.some((node) => node.id === "query-view")) return nodes;
    return null;
  }
  return (findViewScope(tree.children) ?? []).filter(
    (node) => node.name === "property-of" && node.id.startsWith("role-filter-") &&
      typeof node.attributes.iri === "string",
  );
}

function treeHasPropertyFilter(
  tree: FctQueryTree,
  propertyUri: string,
): boolean {
  return getActiveViewPropertyFilters(tree).some(
    (node) => node.attributes.iri === propertyUri,
  );
}

/** Each widget owns a real subscription to the authoritative query store. */
function PersonalWidgetQueryListener({
  propertyUri,
  setPersonalWidgets,
}: {
  propertyUri: string;
  setPersonalWidgets: Dispatch<SetStateAction<PersonalWidget[]>>;
}) {
  const { tree } = useFctQuery();
  const widgetQueryXml = serializeFctQuery(createPropertyWidgetQuery(tree, propertyUri, "forward", undefined, true));

  useEffect(() => {
    // Reconcile every mounted widget against the active <view> scope. A widget
    // whose filter belongs to another breadcrumb scope must not retain stale
    // values while the parent pane catches up with the new query revision.
    if (!treeHasPropertyFilter(tree, propertyUri)) {
      setPersonalWidgets((current) =>
        current.filter((widget) => widget.uri !== propertyUri),
      );
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPersonalWidgets((current) =>
      current.map((widget) =>
        widget.uri === propertyUri
          ? { ...widget, loading: true, error: "" }
          : widget,
      ),
    );

    async function refreshWidget() {
      try {
        const response = await fetch("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("personal-widget-values", `PersonalWidgetQueryListener:${propertyUri}`) },
          body: widgetQueryXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!response.ok)
          throw new Error(data.error ?? `Failed to load ${propertyUri}.`);
        const fetchedValues: FctResult[] = Array.isArray(data.results)
          ? data.results
          : [];
        // Once this property has an active value binding, show only the selected
        // value(s) in its own widget. Other facets continue to be recomputed from
        // the filtered query, while this widget reflects its current selection.
        const activeFilter = getActiveViewPropertyFilters(tree).find(
          (node) => node.attributes.iri === propertyUri,
        );
        const selectedTerms = (activeFilter?.children ?? [])
          .filter((child) => child.name === "value")
          .map((child) => fctTermKey(
            child.text ?? "",
            child.attributes.datatype,
            child.attributes["xml:lang"],
          ));
        const values = selectedTerms.length
          ? fetchedValues.filter((value) => selectedTerms.includes(facetValueKey(value)))
          : fetchedValues;
        if (cancelled) return;
        setPersonalWidgets((current) =>
          current.map((widget) =>
            widget.uri === propertyUri
              ? {
                  ...widget,
                  values,
                  loading: false,
                  error: "",
                  page: Math.min(
                    widget.page,
                    Math.max(0, Math.ceil(values.length / 10) - 1),
                  ),
                }
              : widget,
          ),
        );
      } catch (error) {
        if (
          cancelled ||
          (error instanceof Error && error.name === "AbortError")
        )
          return;
        setPersonalWidgets((current) =>
          current.map((widget) =>
            widget.uri === propertyUri
              ? {
                  ...widget,
                  loading: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Failed to load property values.",
                }
              : widget,
          ),
        );
      }
    }

    void refreshWidget();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [widgetQueryXml, propertyUri, setPersonalWidgets]);

  return null;
}

/** Loads and renders the value list for a selected reverse-role facet in Filters. */
function PersonalRoleWidget({
  tree,
  roleNode,
  label,
  isGroupByRole,
  onGroupValueClick,
}: {
  tree: FctQueryTree;
  roleNode: FctQueryNode;
  label: string;
  isGroupByRole: boolean;
  onGroupValueClick: (value: FctResult) => void;
}) {
  const { setRoleValue } = useFctQuery();
  const uri = roleNode.attributes.iri ?? "";
  const [values, setValues] = useState<FctResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  // Counts are keyed by the full compiled query, so a new live query scope can
  // never accidentally reuse a candidate's stale count from the prior scope.
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number | null>>({});

  const unconstrainedTree: FctQueryTree = {
    ...tree,
    children: tree.children.map(function removeSelectedRoleValues(node): FctQueryNode {
      return {
        ...node,
        attributes: { ...node.attributes },
        children: node.id === roleNode.id
          ? node.children.filter((child) => child.name !== "value").map((child) => ({ ...child, attributes: { ...child.attributes }, children: child.children.map((nested) => ({ ...nested, attributes: { ...nested.attributes }, children: nested.children })) }))
          : node.children.map(removeSelectedRoleValues),
      };
    }),
  };
  const widgetQueryXml = serializeFctQuery(
    createPropertyWidgetQuery(unconstrainedTree, uri, "reverse", roleNode.id, true),
  );
  const selectedKeys = (roleNode.children ?? [])
    .filter((child) => child.name === "value" && Boolean(child.text))
    .map((child) => fctTermKey(child.text ?? "", child.attributes.datatype, child.attributes["xml:lang"]));

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    async function loadValues() {
      try {
        const response = await fetch("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("personal-role-widget-values", `PersonalRoleWidget:${uri}`) },
          body: widgetQueryXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!response.ok) throw new Error(data.error ?? `Failed to load role values for ${uri}.`);
        const fetched = Array.isArray(data.results) ? data.results as FctResult[] : [];
        if (cancelled) return;
        setValues((current) => current.length === fetched.length && current.every((item, index) => item.uri === fetched[index]?.uri && item.datatype === fetched[index]?.datatype && item.lang === fetched[index]?.lang) ? current : fetched);
        setPage((current) => Math.min(current, Math.max(0, Math.ceil(fetched.length / 10) - 1)));
      } catch (requestError) {
        if (cancelled || (requestError instanceof Error && requestError.name === "AbortError")) return;
        setError(requestError instanceof Error ? requestError.message : "Failed to load role values.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadValues();
    return () => { cancelled = true; controller.abort(); };
  }, [uri, widgetQueryXml, tree]);

  const visibleValues = values.filter((value) => {
    const binding = groupValueBinding(value);
    const countQuery = distinctCountQueryFor(tree, "value", value.uri, uri, value);
    const count = candidateCounts[countQuery];
    const valueKey = fctTermKey(binding.text, binding.datatype, binding.lang);
    // Keep a selected value available to uncheck even if the current query has
    // become empty; hide only confirmed zero-count alternatives.
    return selectedKeys.includes(valueKey) || count !== 0;
  });
  const pageCount = Math.max(1, Math.ceil(visibleValues.length / 10));
  const pageValues = visibleValues.slice(page * 10, (page + 1) * 10);
  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, pageCount - 1)));
  }, [pageCount]);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {loading && <p className="px-2 py-1 text-xs text-muted-foreground" aria-live="polite">Updating…</p>}
      {error && <p className="px-2 py-1 text-xs text-destructive" title={error}>Update failed: {error}</p>}
      {!loading && !error && visibleValues.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No matching values for this role.</p>}
      {visibleValues.length > 10 && (
        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs">
          <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
          <span className="text-muted-foreground">{page + 1}/{pageCount}</span>
          <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button>
        </div>
      )}
      <div className="space-y-1">
        {pageValues.map((value, valueIndex) => {
          const binding = groupValueBinding(value);
          const valueKey = fctTermKey(binding.text, binding.datatype, binding.lang);
          const countQuery = distinctCountQueryFor(tree, "value", value.uri, uri, value);
          const isZeroCount = candidateCounts[countQuery] === 0;
          return (
            <div key={`${value.uri}:${value.datatype ?? ""}:${value.lang ?? ""}`} className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 ${isGroupByRole ? "" : "cursor-pointer"}`}>
              <input id={`personal-role-value-${roleNode.id}-${valueIndex}`} type="checkbox" checked={selectedKeys.includes(valueKey)} onChange={(event) => setRoleValue(uri, { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) }, event.currentTarget.checked)} className="mt-0.5 size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40" aria-invalid={isZeroCount ? true : undefined} aria-label={`Filter ${label} by ${value.termType === "uri" ? toLabel(value.uri) : value.title || value.uri}`} />
              {isGroupByRole ? (
                <button type="button" onClick={() => onGroupValueClick(value)} className={`min-w-0 flex-1 cursor-pointer break-words text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isZeroCount ? "text-destructive" : ""}`} title={`Scroll to group ${value.termType === "uri" ? toLabel(value.uri) : value.title || value.uri}`}>{value.termType === "uri" ? toLabel(value.uri) : value.title || value.uri}</button>
              ) : (
                <label htmlFor={`personal-role-value-${roleNode.id}-${valueIndex}`} className={`min-w-0 flex-1 break-words cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}>
                  {value.termType === "uri" ? toLabel(value.uri) : value.title || value.uri}
                </label>
              )}
              <DistinctCount
                tree={tree}
                kind="value"
                uri={value.uri}
                propertyUri={uri}
                candidateValue={value}
                onCountChange={(query, count) =>
                  setCandidateCounts((current) =>
                    current[query] === count ? current : { ...current, [query]: count },
                  )
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function findQueryNode(
  nodes: FctQueryNode[],
  nodeId: string,
): FctQueryNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const found = findQueryNode(node.children, nodeId);
    if (found) return found;
  }
  return undefined;
}

type EndpointStatus = {
  id: string;
  status: number | null;
  state: "ok" | "server-error" | "http-error" | "timeout" | "unreachable";
  testedUrl?: string;
  attempts?: Array<{ url: string; status: number | null; state: string }>;
};
type EndpointOption = { id: string; label: string; url: string; group: string };

type FacetAddCounts = {
  property: Record<string, number>;
  "property-in": Record<string, number>;
};

type FacetAutofillCandidates = {
  property: string[];
  "property-in": string[];
};

const FACET_ADD_COUNTS_STORAGE_KEY = "maestro:facet-add-counts:v1";
const FACET_AUTOFILL_STORAGE_KEY = "maestro:facet-autofill:v1";
const AUTO_CONFIGURED_FACETS_STORAGE_KEY = "maestro:auto-configured-facets:v1";

type AutoConfiguredFacetKey = string;

function readAutoConfiguredFacetKeys(): AutoConfiguredFacetKey[] {
  try {
    const raw = window.localStorage.getItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function readFacetAddCounts(): FacetAddCounts {
  const empty: FacetAddCounts = { property: {}, "property-in": {} };
  try {
    const raw = window.localStorage.getItem(FACET_ADD_COUNTS_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FacetAddCounts>;
    return {
      property: parsed.property && typeof parsed.property === "object" ? parsed.property : {},
      "property-in": parsed["property-in"] && typeof parsed["property-in"] === "object" ? parsed["property-in"] : {},
    };
  } catch {
    return empty;
  }
}

function recordFacetAddition(kind: "property" | "property-in", uri: string) {
  try {
    const counts = readFacetAddCounts();
    counts[kind][uri] = (counts[kind][uri] ?? 0) + 1;
    window.localStorage.setItem(FACET_ADD_COUNTS_STORAGE_KEY, JSON.stringify(counts));
  } catch (error) {
    // Browsing and filtering must continue when localStorage is unavailable.
    console.error("[Maestro Auto-configure] Could not persist facet addition count.", error);
  }
}

function readFacetAutofillCandidates(): FacetAutofillCandidates {
  const empty: FacetAutofillCandidates = { property: [], "property-in": [] };
  try {
    const raw = window.localStorage.getItem(FACET_AUTOFILL_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FacetAutofillCandidates>;
    return {
      property: Array.isArray(parsed.property) ? parsed.property.filter((uri): uri is string => typeof uri === "string") : [],
      "property-in": Array.isArray(parsed["property-in"]) ? parsed["property-in"].filter((uri): uri is string => typeof uri === "string") : [],
    };
  } catch {
    return empty;
  }
}

function replaceFacetAutofillCandidates(kind: "property" | "property-in", uris: string[]) {
  const nextUris = Array.from(new Set(uris));
  try {
    const candidates = readFacetAutofillCandidates();
    // Avoid storage churn when the current-scope candidate list did not change.
    const previousUris = candidates[kind];
    if (previousUris.length !== nextUris.length || previousUris.some((uri, index) => uri !== nextUris[index])) {
      candidates[kind] = nextUris;
      window.localStorage.setItem(FACET_AUTOFILL_STORAGE_KEY, JSON.stringify(candidates));
    }
    return nextUris;
  } catch {
    // Browsing and filtering must continue when localStorage is unavailable.
    return nextUris;
  }
}

const RDF_TYPE_URI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const GROUP_BY_FACET_HIGHLIGHT_CLASSES = "border-sky-300 bg-sky-100/80 dark:border-sky-800 dark:bg-sky-950/50";

type ShareableUiState = {
  selectedEndpointId?: string;
  selectedFacet?: FacetName;
  propertiesPage?: number;
  classesPage?: number;
  graphsPage?: number;
  rolesPage?: number;
  findEndpointsEnabled?: boolean;
  centralTab?: "results" | "groups" | "query-tree" | "view-query";
  /** Explicit state for the Results/Query toolbar toggle. */
  queryToggle?: boolean;
  showResultBadges?: boolean;
  /** Explicit state for the Badges toolbar toggle. */
  badgesToggle?: boolean;
  querySourceFormat?: "xml" | "sparql";
  defaultLeftTab?: "facets" | "personal" | "community";
  focusListOrder?: "Properties" | "Roles";
  focusWidgetsSuppressed?: boolean;
  groupByPropertyUri?: string;
  resultsUiPage?: number;
  groupUiPage?: number;
  groupBatchSize?: number;
  groupBatchOffset?: number;
  resultsPageSize?: number;
  selectedUri?: string;
  graphText?: string;
  rdfSourceUrl?: string;
  rdfTargetGraph?: string;
};

function readShareableUiState(): ShareableUiState | null {
  if (typeof window === "undefined") return null;
  const encodedState = new URLSearchParams(window.location.search).get("state");
  if (!encodedState) return null;
  try {
    const parsed: unknown = JSON.parse(encodedState);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ShareableUiState
      : null;
  } catch {
    return null;
  }
}

/** Parse the share URL's serialized FCT XML into a fresh tree with unique client-only node IDs. */
function parseFctQueryXml(xml: string): FctQueryTree | null {
  if (typeof DOMParser === "undefined") return null;
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror") || document.documentElement?.localName !== "query") return null;
  const root = document.documentElement;
  const rootAttributes: Record<string, string> = {};
  for (const attribute of Array.from(root.attributes)) rootAttributes[attribute.name] = attribute.value;
  const usedIds = new Set<string>();
  let hasQueryText = false;
  let hasQueryView = false;
  const elementChildren = (element: Element) => Array.from(element.children);
  const parseNode = (element: Element, path: string, isRootChild: boolean): FctQueryNode => {
    const name = element.localName;
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) attributes[attribute.name] = attribute.value;
    const iri = attributes.iri ?? "";
    let id: string;
    if (name === "text" && isRootChild && !hasQueryText) {
      id = "query-text";
      hasQueryText = true;
    } else if (name === "view" && !hasQueryView) {
      id = "query-view";
      hasQueryView = true;
    } else if (name === "property" && iri) {
      const containsView = (candidate: Element): boolean => candidate.localName === "view" || elementChildren(candidate).some(containsView);
      id = `${containsView(element) ? "property-path" : "property-filter"}-${encodeURIComponent(iri)}-${path}`;
    } else if (name === "property-of" && iri) {
      id = `role-filter-${path}-${encodeURIComponent(iri)}`;
    } else if (name === "class" && iri) {
      id = `class-${path}-${encodeURIComponent(iri)}`;
    } else {
      id = `url-${path}-${name}`;
    }
    const baseId = id;
    let suffix = 1;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    const children = name === "view" ? [] : elementChildren(element).map((child, index) => parseNode(child, `${path}.${index}`, false));
    const text = name === "text" || name === "value" ? (element.textContent ?? "") : undefined;
    return { id, name, attributes, ...(text !== undefined ? { text } : {}), children };
  };
  const children = elementChildren(root).map((child, index) => parseNode(child, String(index), true));
  if (!hasQueryView) {
    children.push({ id: "query-view", name: "view", attributes: { type: "text", limit: "30", offset: "0" }, children: [] });
  }
  if (!hasQueryText) {
    children.unshift({ id: "query-text", name: "text", attributes: { property: "http://www.w3.org/2000/01/rdf-schema#label" }, text: "", children: [] });
  }
  return { name: "query", attributes: rootAttributes, children };
}

export default function Home() {
  const [controlsSheetOpen, setControlsSheetOpen] = useState(false);
  const [selectedUri, setSelectedUri] = useState("");
  const [urlStateInitialized, setUrlStateInitialized] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [fctEndpoints, setFctEndpoints] = useState<EndpointOption[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState("");
  const [endpointStatuses, setEndpointStatuses] = useState<
    Record<string, EndpointStatus>
  >({});
  // Only the selected endpoint's health may affect active query effects. A
  // different endpoint finishing its health check must not restart these loads.
  const selectedEndpointStatus = selectedEndpointId ? endpointStatuses[selectedEndpointId] : undefined;
  const [isCheckingEndpoints, setIsCheckingEndpoints] = useState(false);
  const [endpointChecksCompleted, setEndpointChecksCompleted] = useState(0);
  const [endpointChecksTotal, setEndpointChecksTotal] = useState(0);
  const [endpointMenuError, setEndpointMenuError] = useState("");
  const [selectedFacet, setSelectedFacet] = useState<FacetName>("Properties");
  const [propertiesPage, setPropertiesPage] = useState(0);
  const [classesPage, setClassesPage] = useState(0);
  const [graphsPage, setGraphsPage] = useState(0);
  const [graphListSparql, setGraphListSparql] = useState("");
  const [graphText, setGraphText] = useState("");
  const restoredGraphTextRef = useRef<string | null>(null);
  const [findEndpointsEnabled, setFindEndpointsEnabled] = useState(false);
  const [centralTab, setCentralTab] = useState<"results" | "groups" | "query-tree" | "view-query">("results");
  const [showResultBadges, setShowResultBadges] = useState(false);
  const [querySourceFormat, setQuerySourceFormat] = useState<"xml" | "sparql">("xml");
  const [sparqlQuery, setSparqlQuery] = useState("");
  const [isRdfLoaderOpen, setIsRdfLoaderOpen] = useState(false);
  const [rdfSourceUrl, setRdfSourceUrl] = useState("");
  const [rdfTargetGraph, setRdfTargetGraph] = useState(
    "http://example.org/graph/imported",
  );
  const [isRdfLoading, setIsRdfLoading] = useState(false);
  const [rdfLoadMessage, setRdfLoadMessage] = useState("");
  const [rdfLoadError, setRdfLoadError] = useState(false);
  /*
  const [activeTab, setActiveTab] = useState<
    "default" | "personal" | "community"
  >("default");
*/
  // Inner tabs for the left pane in Default view.
const [defaultLeftTab, setDefaultLeftTab] = useState<"facets" | "personal" | "community">("personal");
  const [focusListOrder, setFocusListOrder] = useState<"Properties" | "Roles">("Properties");


  const [personalWidgets, setPersonalWidgets] = useState<PersonalWidget[]>([]);
  const [breadcrumbTrail, setBreadcrumbTrail] = useState<
  { id: string; uri: string; name: string }[]
>([]);

  const [focusWidgetsSuppressed, setFocusWidgetsSuppressed] = useState(false);
  const [groupByPropertyUri, setGroupByPropertyUri] = useState("");
  const [resultsUiPage, setResultsUiPage] = useState(0);
  const [groupUiPage, setGroupUiPage] = useState(0);
  const [groupBatchSize, setGroupBatchSize] = useState<number>(100);
  const [groupBatchOffset, setGroupBatchOffset] = useState(0);
  const [groupHasMoreBatches, setGroupHasMoreBatches] = useState(false);
  const groupCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingGroupScrollRef = useRef<string | null>(null);
  const personalWidgetCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const roleWidgetCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const categoriesWidgetRef = useRef<HTMLElement | null>(null);
  const FACET_PAGE_SIZE = 10;
  const [propertyFacets, setPropertyFacets] = useState<FacetItem[]>([]);
  const [classFacets, setClassFacets] = useState<FacetItem[]>([]);
  const [classCandidateCounts, setClassCandidateCounts] = useState<Record<string, number | null>>({});
  const [facetCandidateCounts, setFacetCandidateCounts] = useState<Record<string, number | null>>({});
  const [roleFacets, setRoleFacets] = useState<FacetItem[]>([]);
  const [graphFacets, setGraphFacets] = useState<FacetItem[]>([]);
  const [graphHasMore, setGraphHasMore] = useState(false);
  const [propertyFacetSparql, setPropertyFacetSparql] = useState("");
  const [roleFacetSparql, setRoleFacetSparql] = useState("");
  const [facetAutofillCandidates, setFacetAutofillCandidates] = useState<FacetAutofillCandidates>({ property: [], "property-in": [] });
  // localStorage mutations do not trigger React renders. This revision makes
  // additions to the live query observable to the Auto-configure candidate effects.
  const [facetUsageRevision, setFacetUsageRevision] = useState(0);
  const previousFacetQueryNodesRef = useRef<Map<string, { kind: "property" | "property-in"; uri: string }> | null>(null);
  const [autoConfiguredFacetKeys, setAutoConfiguredFacetKeys] = useState<Set<AutoConfiguredFacetKey>>(
    () => new Set(typeof window === "undefined" ? [] : readAutoConfiguredFacetKeys()),
  );
  const [autoResetMessage, setAutoResetMessage] = useState("");
  const [rolesPage, setRolesPage] = useState(0);

  // Facet results can shrink after a query or endpoint change. Never leave a
  // facet widget on a page index that no longer exists (which looks like an
  // empty list even though the header still reports a nonzero count).
  useEffect(() => {
    setPropertiesPage(0);
  }, [propertyFacets.length]);
  useEffect(() => {
    setClassesPage(0);
  }, [classFacets.length]);
  useEffect(() => {
    setRolesPage(0);
  }, [roleFacets.length]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [isLoadingGraphs, setIsLoadingGraphs] = useState(false);
  const [roleFacetError, setRoleFacetError] = useState("");

  const {
    tree: queryTree,
    revision: queryRevision,
    replaceTree: replaceQueryTree,
    getPropertiesAtNode,
    getClassesAtNode,
    getPropertyPath,
    addProperty,
    removeProperty,
    setPropertyValues,
    setPropertyValue,
    setRoleValue,
    addNestedProperty,
    addNestedPropertyOf,
    navigateToPropertyPath: navigateToPropertyPathRaw,
    moveViewToSibling: moveViewToSiblingRaw,
    addClass,
    removeClass,
    setSearchText: setSearch,
    resetQuery,
    setQueryAttribute,
    setNodeAttribute,
    setRoleFilter,
    setResultsPage,
    showClassResults,
    refresh: refreshQuery,
    deleteNode,
  } = useFctQuery();

  useEffect(() => {
    setGraphsPage(0);
  }, [queryTree.attributes.graph]);

  const searchNode = queryTree.children.find(
    (node) => node.name === "text" && node.id === "query-text",
  );
  const search = searchNode?.text ?? "";
  // A missing property means the FCT text search spans every predicate.
  // The default, narrower mode explicitly targets rdfs:label.
  const isExpandedSearch = !searchNode?.attributes.property;

  // Use a structural signature rather than the tree object's identity: the
  // query model can retain the same root object while its children change.
  // That made [queryTree] miss additions, so learned counts stayed at zero.
  const facetQuerySignature = (() => {
    const relationships: Array<[string, string, string]> = [];
    const visit = (nodes: FctQueryNode[]) => {
      for (const node of nodes) {
        if ((node.name === "property" || node.name === "property-of") && node.attributes.iri) {
          relationships.push([node.id, node.name, node.attributes.iri]);
        }
        visit(node.children);
      }
    };
    visit(queryTree.children);
    return JSON.stringify(relationships);
  })();

  // Learn from changes to the authoritative <query> tree, not from UI event
  // handlers. This catches additions from checkboxes, label navigation, and
  // any other code path that inserts a <property> or <property-of> node.
  useEffect(() => {
    const currentNodes = new Map<string, { kind: "property" | "property-in"; uri: string }>();
    const collectRelationshipNodes = (nodes: FctQueryNode[]) => {
      for (const node of nodes) {
        if ((node.name === "property" || node.name === "property-of") && node.attributes.iri) {
          currentNodes.set(node.id, {
            kind: node.name === "property" ? "property" : "property-in",
            uri: node.attributes.iri,
          });
        }
        collectRelationshipNodes(node.children);
      }
    };
    collectRelationshipNodes(queryTree.children);

    const previousNodes = previousFacetQueryNodesRef.current;
    previousFacetQueryNodesRef.current = currentNodes;
    const debugAutoConfigure = (() => {
      try {
        return window.localStorage.getItem("maestro:debug-autoconfigure") === "true";
      } catch {
        return false;
      }
    })();

    // Establish a baseline on mount; don't treat nodes already in an initial
    // query as new user additions.
    if (!previousNodes) {
      if (debugAutoConfigure) {
        console.debug("[Maestro Auto-configure] baseline", Array.from(currentNodes.values()));
      }
      return;
    }

    let recordedAddition = false;
    for (const [id, current] of currentNodes) {
      const previous = previousNodes.get(id);
      if (previous?.kind === current.kind && previous.uri === current.uri) continue;
      recordFacetAddition(current.kind, current.uri);
      recordedAddition = true;
      if (debugAutoConfigure) {
        console.debug("[Maestro Auto-configure] recorded query addition", { id, ...current });
      }
    }
    if (debugAutoConfigure) {
      console.debug("[Maestro Auto-configure] query snapshot", {
        queryRevision,
        previous: Array.from(previousNodes.values()),
        current: Array.from(currentNodes.values()),
        counts: readFacetAddCounts(),
      });
    }
    if (recordedAddition) setFacetUsageRevision((revision) => revision + 1);
  }, [facetQuerySignature, queryRevision]);

  useEffect(() => {
    const activePath = getPropertyPath();

    // Collect IDs of relationship nodes that still exist in the query tree.
    const existingIds = new Set<string>();

    function collectIds(nodes: FctQueryNode[]) {
      for (const node of nodes) {
        if (
          (node.name === "property" || node.name === "property-of") &&
          typeof node.attributes.iri === "string" &&
          node.attributes.iri.length > 0
        ) {
          existingIds.add(node.id);
        }

        collectIds(node.children);
      }
    }

    collectIds(queryTree.children);

    setBreadcrumbTrail((current) => {
      // Remove breadcrumbs whose relationship nodes were deleted.
      const retained = current.filter((crumb) => existingIds.has(crumb.id));

      // If the active path is a prefix of the remembered trail,
      // the user navigated backward. Keep the suffix visible.
      const isNavigatingBackward =
        activePath.length <= retained.length &&
        activePath.every((crumb, index) => crumb.id === retained[index]?.id);

      let nextTrail: { id: string; uri: string; name: string }[];
      if (isNavigatingBackward) {
        nextTrail = retained;
      } else {
        // A new branch was selected or the user drilled farther down.
        // Replace the remembered trail with the active path.
        const unchanged =
          current.length === activePath.length &&
          current.every(
            (crumb, index) =>
              crumb.id === activePath[index]?.id &&
              crumb.uri === activePath[index]?.uri &&
              crumb.name === activePath[index]?.name,
          );
        nextTrail = unchanged ? current : activePath;
      }

      // If no ghost successor is already visible, use the first selected
      // property/property-of facet in this scope as a ghost breadcrumb. The
      // active <view> remains where it is; this only extends the displayed trail.
      if (nextTrail.length <= activePath.length) {
        const scopeId = activePath[activePath.length - 1]?.id;
        const findNode = (nodes: FctQueryNode[], id: string): FctQueryNode | null => {
          for (const node of nodes) {
            if (node.id === id) return node;
            const nested = findNode(node.children, id);
            if (nested) return nested;
          }
          return null;
        };
        const scopeNode = scopeId ? findNode(queryTree.children, scopeId) : null;
        const scopeNodes = scopeNode ? scopeNode.children : queryTree.children;
        const firstSelectedRelationship = scopeNodes.find((node) =>
          (node.name === "property" || node.name === "property-of") &&
          typeof node.attributes.iri === "string" &&
          node.attributes.iri.length > 0 &&
          (node.id.startsWith("property-filter-") || node.id.startsWith("role-filter-")) &&
          node.id !== activePath[activePath.length - 1]?.id,
        );
        if (firstSelectedRelationship) {
          nextTrail = [...nextTrail, {
            id: firstSelectedRelationship.id,
            uri: firstSelectedRelationship.attributes.iri ?? "",
            name: firstSelectedRelationship.name,
          }];
        }
      }
      return nextTrail;
    });
  // queryRevision is required because the query store may mutate the tree in
  // place; it keeps ghost breadcrumbs synchronized after delete/pop actions.
  }, [queryTree, getPropertyPath, queryRevision]);




  useEffect(() => {
    let cancelled = false;
    async function loadEndpointMenu() {
      setIsCheckingEndpoints(true);
      setEndpointChecksCompleted(0);
      try {
        // Load every configured endpoint first, so the menu appears before health checks finish.
        const response = await fetch("/proxy/api/fct", { cache: "no-store", headers: proxyDebugHeaders("endpoint-menu", "EndpointMenu") });
        const data = await response.json();
        rememberShortforms(data?.shortforms);
        if (!response.ok)
          throw new Error(data.error ?? "Could not load FCT endpoints.");
        if (cancelled) return;
        const endpoints = Array.isArray(data.endpoints)
          ? (data.endpoints as EndpointOption[])
          : [];
        const savedSelection =
          typeof data.selectedId === "string" ? data.selectedId : "";
        const requestedUrlSelection = readShareableUiState()?.selectedEndpointId;
        let effectiveSelection = savedSelection;
        if (typeof requestedUrlSelection === "string" && endpoints.some((endpoint) => endpoint.id === requestedUrlSelection)) {
          if (requestedUrlSelection !== savedSelection) {
            const selectResponse = await fetch("/proxy/api/fct", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...proxyDebugHeaders("endpoint-url-restore", "EndpointMenu") },
              body: JSON.stringify({ selectEndpointId: requestedUrlSelection }),
            });
            const selectData = await selectResponse.json();
            rememberShortforms(selectData?.shortforms);
            if (!selectResponse.ok) throw new Error(selectData.error ?? "Could not restore the data server from the share URL.");
          }
          effectiveSelection = requestedUrlSelection;
        }
        setFctEndpoints(endpoints);
        setSelectedEndpointId(effectiveSelection);
        setEndpointStatuses({});
        setEndpointChecksTotal(endpoints.length);
        setEndpointMenuError("");
        await runEndpointChecks(
          endpoints,
          !effectiveSelection,
          effectiveSelection,
          () => cancelled,
        );
      } catch (error) {
        if (!cancelled)
          setEndpointMenuError(
            error instanceof Error
              ? error.message
              : "Could not load FCT endpoints.",
          );
      } finally {
        if (!cancelled) setIsCheckingEndpoints(false);
      }
    }
    void loadEndpointMenu();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runEndpointChecks(
    endpoints: EndpointOption[],
    autoSelectFirstReachable: boolean,
    existingSelection: string,
    isCancelled: () => boolean = () => false,
  ) {
    setIsCheckingEndpoints(true);
    setEndpointChecksCompleted(0);
    setEndpointChecksTotal(endpoints.length);
    const results: Record<string, EndpointStatus> = {};
    let completed = 0;

    // Each endpoint reports independently; the menu updates as each AJAX request returns.
    await Promise.all(
      endpoints.map(async (endpoint) => {
        let status: EndpointStatus;
        try {
          const response = await fetch(
            `/proxy/api/fct?health=1&endpointId=${encodeURIComponent(endpoint.id)}`,
            { cache: "no-store", headers: proxyDebugHeaders("endpoint-health", `EndpointHealth:${endpoint.id}`) },
          );
          const data = await response.json();
        rememberShortforms(data?.shortforms);
          if (!response.ok || !data.check)
            throw new Error(data.error ?? "Health check failed.");
          status = data.check as EndpointStatus;
        } catch {
          status = {
            id: endpoint.id,
            status: null,
            state: "unreachable",
            testedUrl: endpoint.url,
          };
        }
        results[endpoint.id] = status;
        completed += 1;
        if (!isCancelled()) {
          setEndpointStatuses((current) => ({
            ...current,
            [endpoint.id]: status,
          }));
          setEndpointChecksCompleted(completed);
        }
      }),
    );

    if (isCancelled()) return;

    // Keep an existing session choice. On a fresh session, choose the first reachable
    // endpoint in configured order, not whichever health request happens to finish first.
    if (autoSelectFirstReachable && !existingSelection) {
      const firstReachable = endpoints.find(
        (endpoint) =>
          results[endpoint.id]?.status != null &&
          results[endpoint.id].status! < 400,
      );
      if (firstReachable) {
        try {
          const response = await fetch("/proxy/api/fct", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...proxyDebugHeaders("endpoint-auto-select", "EndpointMenu") },
            body: JSON.stringify({
              selectEndpointId: firstReachable.id,
            }),
          });
          const data = await response.json();
        rememberShortforms(data?.shortforms);
          if (!response.ok)
            throw new Error(
              data.error ?? "Could not select the first reachable FCT endpoint.",
            );
          if (!isCancelled()) {
            setSelectedEndpointId(firstReachable.id);
            refreshQuery();
          }
        } catch (error) {
          if (!isCancelled())
            setEndpointMenuError(
              error instanceof Error
                ? error.message
                : "Could not select the first reachable FCT endpoint.",
            );
        }
      }
    }
  }

  async function checkFctEndpoints() {
    setEndpointMenuError("");
    await runEndpointChecks(fctEndpoints, false, selectedEndpointId);
    setIsCheckingEndpoints(false);
  }

  async function chooseFctEndpoint(endpointId: string) {
    if (!endpointId || endpointId === selectedEndpointId) return;
    setEndpointMenuError("");
    try {
      const response = await fetch("/proxy/api/fct", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("endpoint-select", "EndpointMenu") },
        body: JSON.stringify({ selectEndpointId: endpointId }),
      });
      const data = await response.json();
        rememberShortforms(data?.shortforms);
      if (!response.ok)
        throw new Error(data.error ?? "Could not select FCT endpoint.");
      setSelectedEndpointId(endpointId);
      // Trigger the existing query and facet effects to reload against the newly selected server.
      refreshQuery();
    } catch (error) {
      setEndpointMenuError(
        error instanceof Error
          ? error.message
          : "Could not select FCT endpoint.",
      );
    }
  }

  // Personal View widgets subscribe to the authoritative query tree. A widget
  // exists while its property-filter node exists in <query>. Binding selection is
  // reconciled from that node, so deleting a <value> clears only that checkbox
  // while leaving the property filter and its widget intact.
  useEffect(() => {
    // Keep the Filters pane scoped to the properties directly attached to the
    // current <view>, which moves as the user navigates the breadcrumbs.
    if (focusWidgetsSuppressed) {
      setPersonalWidgets([]);
      return;
    }
    const propertyNodes = getActiveViewPropertyFilters(queryTree);
    setPersonalWidgets((current) => {
      const existingByUri = new Map(
        current.map((widget) => [widget.uri, widget]),
      );
      const next = propertyNodes.map((node) => {
        const uri = node.attributes.iri;
        const boundValues = node.children
          .filter((child) => child.name === "value" && Boolean(child.text))
          .map((child) => fctTermKey(child.text ?? "", child.attributes.datatype, child.attributes["xml:lang"]));
        const excluded = node.attributes.exclude?.trim().toLowerCase() === "yes";
        const baseLabel = toLabel(uri);
        const label = baseLabel;
        const existing = existingByUri.get(uri);
        if (existing) {
          return existing.label === label && existing.excluded === excluded &&
            existing.selectedValues.length === boundValues.length &&
            existing.selectedValues.every(
              (value, index) => value === boundValues[index],
            )
            ? existing
            : { ...existing, label, excluded, selectedValues: boundValues };
        }
        return {
          uri,
          label,
          excluded,
          values: [],
          selectedValues: boundValues,
          page: 0,
          loading: true,
          error: "",
        };
      });
      if (
        next.length === current.length &&
        next.every(
          (widget, index) =>
            widget.uri === current[index]?.uri &&
            widget.label === current[index]?.label &&
            widget.excluded === current[index]?.excluded &&
            widget.selectedValues.length ===
              current[index]?.selectedValues.length &&
            widget.selectedValues.every(
              (value, valueIndex) =>
                value === current[index]?.selectedValues[valueIndex],
            ),
        )
      )
        return current;
      return next;
    });
  }, [queryTree, propertyFacets, focusWidgetsSuppressed]);

  const viewNode = findQueryNode(queryTree.children, "query-view");
  // Server batches and visible UI pages are independent. The active query view's
  // limit/offset are the main Results batch profile; the Group by query has its
  // own limit/offset below. The page-size preference is shared across both views.
  const resultsBatchSize = Math.max(
    1,
    Math.floor(Number(viewNode?.attributes.limit ?? 100) || 100),
  );
  const resultsOffset = Math.max(0, Number(viewNode?.attributes.offset ?? "0") || 0);
  const [resultsPageSize, setResultsPageSize] = useState<number>(DEFAULT_RESULTS_PAGE_SIZE);
  const resultsPageSizeStorageInitialized = useRef(false);

  useEffect(() => {
    if (resultsPageSizeStorageInitialized.current) return;
    resultsPageSizeStorageInitialized.current = true;
    try {
      const storedValue = window.localStorage.getItem(RESULTS_PAGE_SIZE_STORAGE_KEY);
      const storedSize = storedValue === null ? NaN : Number(storedValue);
      const validStoredSize = RESULTS_PAGE_SIZE_OPTIONS.find((size) => size === storedSize);
      if (validStoredSize !== undefined) setResultsPageSize(validStoredSize);
      else window.localStorage.setItem(RESULTS_PAGE_SIZE_STORAGE_KEY, String(DEFAULT_RESULTS_PAGE_SIZE));
    } catch {
      // Storage can be disabled by browser privacy settings; paging still works.
    }
  }, []);

  const queryXml = serializeFctQuery(queryTree);
  // The main Results request must use the active view's server-side limit and offset.
  const queryResultsXml = queryXml;
  const prettyQueryXml = xmlFormat(queryXml, { indentation: "  " });

  // Restore the share URL once. Subsequent SPA state changes only rewrite the URL;
  // they never re-run this initializer or navigate the application.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const serializedQuery = params.get("q");
    let restoredQueryFromUrl = false;
    if (serializedQuery) {
      const restoredTree = parseFctQueryXml(serializedQuery);
      if (restoredTree) {
        // Restore the authoritative query through the store so every existing
        // query listener sees the same tree as if the user had built it in the UI.
        replaceQueryTree(restoredTree);
        const restoredTextNode = restoredTree.children.find(
          (node) => node.name === "text" && node.id === "query-text",
        );
        setSearch(restoredTextNode?.text ?? "");
        // The Expand Search toggle is derived from this node's `property`
        // attribute, so retain that attribute in the authoritative parsed tree.
        // In particular, absent `property` means search all properties; a
        // present property (for example rdfs:label) means a restricted search.
        // Keep the datasite field tied to the graph attribute in q, rather than
        // allowing a separately saved draft field to override the shared query.
        const restoredGraph = restoredTree.attributes.graph ?? null;
        setQueryAttribute("graph", restoredGraph);
        setGraphText(restoredGraph ?? "");
        restoredQueryFromUrl = true;
      }
    }
    const restored = readShareableUiState();
    if (restored) {
      if (typeof restored.selectedEndpointId === "string") setSelectedEndpointId(restored.selectedEndpointId);
      if (typeof restored.selectedFacet === "string" && restored.selectedFacet.length < 100) setSelectedFacet(restored.selectedFacet);
      if (typeof restored.propertiesPage === "number" && Number.isFinite(restored.propertiesPage)) setPropertiesPage(Math.max(0, Math.floor(restored.propertiesPage)));
      if (typeof restored.classesPage === "number" && Number.isFinite(restored.classesPage)) setClassesPage(Math.max(0, Math.floor(restored.classesPage)));
      if (typeof restored.graphsPage === "number" && Number.isFinite(restored.graphsPage)) setGraphsPage(Math.max(0, Math.floor(restored.graphsPage)));
      if (typeof restored.rolesPage === "number" && Number.isFinite(restored.rolesPage)) setRolesPage(Math.max(0, Math.floor(restored.rolesPage)));
      if (typeof restored.findEndpointsEnabled === "boolean") setFindEndpointsEnabled(restored.findEndpointsEnabled);
      if (["results", "groups", "query-tree", "view-query"].includes(restored.centralTab ?? "")) setCentralTab(restored.centralTab!);
      // Store the visible toggle state explicitly as well as the full pane mode.
      // This makes the share URL unambiguous while preserving the Groups pane
      // when the Results/Query toggle is off.
      if (typeof restored.queryToggle === "boolean") {
        setCentralTab(restored.queryToggle
          ? (restored.centralTab === "view-query" ? "view-query" : "query-tree")
          : (restored.centralTab === "groups" ? "groups" : "results"));
      }
      if (typeof restored.showResultBadges === "boolean") setShowResultBadges(restored.showResultBadges);
      if (typeof restored.badgesToggle === "boolean") setShowResultBadges(restored.badgesToggle);
      if (restored.querySourceFormat === "xml" || restored.querySourceFormat === "sparql") setQuerySourceFormat(restored.querySourceFormat);
      if (["facets", "personal", "community"].includes(restored.defaultLeftTab ?? "")) setDefaultLeftTab(restored.defaultLeftTab!);
      if (restored.focusListOrder === "Properties" || restored.focusListOrder === "Roles") setFocusListOrder(restored.focusListOrder);
      if (typeof restored.focusWidgetsSuppressed === "boolean") setFocusWidgetsSuppressed(restored.focusWidgetsSuppressed);
      if (typeof restored.groupByPropertyUri === "string") setGroupByPropertyUri(restored.groupByPropertyUri);
      if (typeof restored.resultsUiPage === "number" && Number.isFinite(restored.resultsUiPage)) setResultsUiPage(Math.max(0, Math.floor(restored.resultsUiPage)));
      if (typeof restored.groupUiPage === "number" && Number.isFinite(restored.groupUiPage)) setGroupUiPage(Math.max(0, Math.floor(restored.groupUiPage)));
      if (typeof restored.groupBatchSize === "number" && Number.isFinite(restored.groupBatchSize)) setGroupBatchSize(Math.max(1, Math.min(1000, Math.floor(restored.groupBatchSize))));
      if (typeof restored.groupBatchOffset === "number" && Number.isFinite(restored.groupBatchOffset)) setGroupBatchOffset(Math.max(0, Math.floor(restored.groupBatchOffset)));
      if (typeof restored.resultsPageSize === "number" && RESULTS_PAGE_SIZE_OPTIONS.includes(restored.resultsPageSize as typeof RESULTS_PAGE_SIZE_OPTIONS[number])) setResultsPageSize(restored.resultsPageSize);
      if (typeof restored.selectedUri === "string") setSelectedUri(restored.selectedUri);
      if (!restoredQueryFromUrl && typeof restored.graphText === "string") {
        restoredGraphTextRef.current = restored.graphText;
        setGraphText(restored.graphText);
      }
      if (typeof restored.rdfSourceUrl === "string") setRdfSourceUrl(restored.rdfSourceUrl);
      if (typeof restored.rdfTargetGraph === "string") setRdfTargetGraph(restored.rdfTargetGraph);
    }
    setUrlStateInitialized(true);
  // This is intentionally a one-time initializer for the initial URL only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!urlStateInitialized) return;
    const params = new URLSearchParams(window.location.search);
    params.set("q", queryXml);
    const state: ShareableUiState = {
      selectedEndpointId,
      selectedFacet,
      propertiesPage,
      classesPage,
      graphsPage,
      rolesPage,
      findEndpointsEnabled,
      centralTab,
      queryToggle: centralTab === "query-tree" || centralTab === "view-query",
      showResultBadges,
      badgesToggle: showResultBadges,
      querySourceFormat,
      defaultLeftTab,
      focusListOrder,
      focusWidgetsSuppressed,
      groupByPropertyUri,
      resultsUiPage,
      groupUiPage,
      groupBatchSize,
      groupBatchOffset,
      resultsPageSize,
      selectedUri,
      graphText,
      rdfSourceUrl,
      rdfTargetGraph,
    };
    params.set("state", JSON.stringify(state));
    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [urlStateInitialized, queryXml, queryRevision, selectedEndpointId, selectedFacet, propertiesPage, classesPage, graphsPage, rolesPage, findEndpointsEnabled, centralTab, showResultBadges, querySourceFormat, defaultLeftTab, focusListOrder, focusWidgetsSuppressed, groupByPropertyUri, resultsUiPage, groupUiPage, groupBatchSize, groupBatchOffset, resultsPageSize, selectedUri, graphText, rdfSourceUrl, rdfTargetGraph]);

  // The graph text box may contain an unapplied draft distinct from the query's graph binding.
  // Restore that draft after the query-graph synchronization effect has run once.
  useEffect(() => {
    if (!urlStateInitialized || restoredGraphTextRef.current === null) return;
    setGraphText(restoredGraphTextRef.current);
    restoredGraphTextRef.current = null;
  }, [urlStateInitialized, queryRevision]);

  const activeViewPropertyFilters = getActiveViewPropertyFilters(queryTree);
  const rdfTypePropertyNode = activeViewPropertyFilters.find((node) => node.attributes.iri === RDF_TYPE_URI);
  const groupByOptions: GroupByOption[] = [
    { key: "", uri: "", direction: "forward", label: "none", nodeId: "" },
    // RDF type is permanent dropdown furniture, but it uses the ordinary forward-property grouping path.
    ...(rdfTypePropertyNode?.attributes.exclude?.trim().toLowerCase() === "yes" ? [] : [{ key: `forward:${RDF_TYPE_URI}`, uri: RDF_TYPE_URI, direction: "forward" as const, label: "Category", nodeId: rdfTypePropertyNode?.id ?? "group-by-rdf-type" }]),
    ...activeViewPropertyFilters.flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri || uri === RDF_TYPE_URI || node.attributes.exclude?.trim().toLowerCase() === "yes") return [];
      return [{ key: `forward:${uri}`, uri, direction: "forward" as const, label: toLabel(uri), nodeId: node.id }];
    }),
    // Only reverse-role nodes explicitly selected in Focus belong in Group By.
    // A <property-of> ancestor that merely contains the active <view> is a
    // navigation/scope breadcrumb, not a checked relationship selection.
    ...getActiveViewRoleFilters(queryTree).flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri || node.attributes.exclude?.trim().toLowerCase() === "yes") return [];
      return [{ key: `reverse:${uri}`, uri, direction: "reverse" as const, label: `${toLabel(uri)} of`, nodeId: node.id }];
    }).filter((option, index, all) => all.findIndex((candidate) => candidate.key === option.key) === index),
  ];
  const selectedGroupByOption = groupByOptions.find((option) => option.key !== "" && option.key === groupByPropertyUri) ?? null;
  useEffect(() => {
    if (groupByPropertyUri && !groupByOptions.some((option) => option.key === groupByPropertyUri)) {
      setGroupByPropertyUri("");
      setCentralTab((current) => current === "groups" ? "results" : current);
    }
  }, [groupByPropertyUri, groupByOptions.map((option) => option.key).join("|")]);
  const [groupValues, setGroupValues] = useState<FctResult[]>([]);
  const [groupValuesLoading, setGroupValuesLoading] = useState(false);
  const [groupValuesError, setGroupValuesError] = useState("");
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMembersState>>({});
  const groupMemberRequestStates = useRef(new Map<string, "loading" | "loaded">());
  // Load-more requests must not repopulate a different query or group-by view.
  const groupMemberRequestIdentityRef = useRef("");
  // Counts are derived from the member rows loaded for each visible group.
  // Keep the index and cards in the same descending-count order.
  const pageGroupValues = groupValues.slice(groupUiPage * resultsPageSize, (groupUiPage + 1) * resultsPageSize);
  const visibleGroupValues = pageGroupValues.slice().sort((a, b) => {
      const aKey = `${selectedGroupByOption?.key ?? ""}::${groupValueKey(a)}`;
      const bKey = `${selectedGroupByOption?.key ?? ""}::${groupValueKey(b)}`;
      const aMembers = groupMembers[aKey];
      const bMembers = groupMembers[bKey];
      const aCount = aMembers && !aMembers.loading && !aMembers.error ? (aMembers.count ?? aMembers.results.length) : -1;
      const bCount = bMembers && !bMembers.loading && !bMembers.error ? (bMembers.count ?? bMembers.results.length) : -1;
      return bCount - aCount || (a.title || a.uri).localeCompare(b.title || b.uri);
    });
  const groupedPersonalFacetUri = centralTab === "groups" && selectedGroupByOption?.direction === "forward"
    && selectedGroupByOption.uri !== RDF_TYPE_URI
    && personalWidgets.some((widget) => widget.uri === selectedGroupByOption.uri && !widget.excluded)
    ? selectedGroupByOption.uri
    : null;
  const isGroupByCategory = centralTab === "groups" && selectedGroupByOption?.direction === "forward" && selectedGroupByOption.uri === RDF_TYPE_URI;
  const groupedRoleUri = centralTab === "groups" && selectedGroupByOption?.direction === "reverse"
    ? selectedGroupByOption.uri
    : null;
  const groupedFacetActive = Boolean(groupedPersonalFacetUri || groupedRoleUri || isGroupByCategory);

  // Entering Group by mode selects the matching facet pane once. Do not make
  // the pane depend continuously on groupBy state: users must still be able to
  // open Configure while grouping is active.
  useEffect(() => {
    if (!groupedFacetActive) return;
    setDefaultLeftTab("personal");
  }, [groupedFacetActive, isGroupByCategory, groupedPersonalFacetUri]);

  // Scroll the active facet into view after its pane is visible. This is kept
  // separate from pane selection so switching to Configure is never undone.
  useEffect(() => {
    if (!groupedFacetActive || defaultLeftTab !== "personal") return;
    const target = isGroupByCategory
      ? categoriesWidgetRef.current
      : groupedRoleUri
        ? roleWidgetCardRefs.current.get(groupedRoleUri)
        : personalWidgetCardRefs.current.get(groupedPersonalFacetUri!);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [groupedFacetActive, isGroupByCategory, groupedPersonalFacetUri, groupedRoleUri, defaultLeftTab, personalWidgets.map((widget) => widget.uri).join("|")]);

  useEffect(() => {
    const pendingKey = pendingGroupScrollRef.current;
    if (!pendingKey || centralTab !== "groups") return;
    const target = groupCardRefs.current.get(pendingKey);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingGroupScrollRef.current = null;
    }
  }, [centralTab, groupUiPage, visibleGroupValues.map(groupValueKey).join("|")]);

  function scrollToGroupForFacetValue(value: FctResult) {
    if (centralTab !== "groups" || !selectedGroupByOption) return;
    const matchIndex = groupValues.findIndex((groupValue) => facetValueKey(groupValue) === facetValueKey(value));
    if (matchIndex < 0) return;
    const groupValue = groupValues[matchIndex];
    const key = `${selectedGroupByOption.key}::${groupValueKey(groupValue)}`;
    const targetPage = Math.floor(matchIndex / resultsPageSize);
    if (targetPage !== groupUiPage) {
      pendingGroupScrollRef.current = key;
      setGroupUiPage(targetPage);
      return;
    }
    groupCardRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const sourceSparql = sparqlQuery || "# SPARQL will appear after the endpoint returns a query.";
  const queryWithoutPagingXml = useCallback(
  (viewType?: string) =>
    serializeFctQuery(
      setQueryViewAttributes(queryTree, {
        ...(viewType ? { type: viewType } : {}),
        offset: "0",
      }),
    ),
  [queryTree],
);
  // Snapshot the semantic facet requests. Effects depend on their serialized XML,
  // not queryWithoutPagingXml's callback identity (which changes on every tree edit).
  const propertyFacetQueryXml = queryWithoutPagingXml("properties");
  const classFacetQueryXml = queryWithoutPagingXml("classes");
  const roleFacetQueryXml = queryWithoutPagingXml("properties-in");
  // Ask FCT for the total independently of the current results page. The
  // count view uses the same active scope and filters, but never the page offset.
  const queryCountXml = serializeFctQuery(
    setQueryViewAttributes(queryTree, { type: "text", limit: "1000", offset: "0" }),
  );
  groupMemberRequestIdentityRef.current = `${selectedEndpointId}\u0000${queryCountXml}\u0000${selectedGroupByOption?.key ?? ""}`;

  const [results, setResults] = useState<FctResult[]>([]);
  const resultsBatchRequestPending = useRef(false);
  const activeQueryIdentityRef = useRef("");
  const previousResultsQueryIdentityRef = useRef("");
  const endpointReadyForQuery = Boolean(
    selectedEndpointId &&
    selectedEndpointStatus?.status != null &&
    selectedEndpointStatus.status < 400
  );

  // Keep the active request identity current for stale-response protection, but
  // do not clear widgets merely because arbitrary query state changed. The
  // coordinated clear is invoked only by the explicit view-navigation actions.
  useLayoutEffect(() => {
const queryIdentity = `${selectedEndpointId}\u0000${queryCountXml}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}`;
activeQueryIdentityRef.current = queryIdentity;
}, [queryCountXml, selectedEndpointId, endpointReadyForQuery]);

useEffect(() => {
  if (!urlStateInitialized) return;
  const nextIdentity = `${selectedEndpointId}\u0000${queryCountXml}`;
  const previousIdentity = previousResultsQueryIdentityRef.current;

  previousResultsQueryIdentityRef.current = nextIdentity;

  // Keep the initial load; reset only when an existing query changes.
  if (!previousIdentity || previousIdentity === nextIdentity) return;

  setResultsUiPage(0);
  setResults([]);
  resultsBatchRequestPending.current = false;
  setResultsPageMatchCount(0);
  setResultsPageComplete(false);
  setResultsTotalCount(null);
  setSelectedUri("");
  setDescribedRecord([]);
  setRecordDescriptionPage(0);
  setSparqlQuery("");
  setSearchError("");

  // Restart server-side paging at offset zero for the new query.
  if (resultsOffset !== 0) {
    setResultsPage(resultsBatchSize, 0);
  }
}, [
  queryResultsXml,
  selectedEndpointId,
  urlStateInitialized,
  resultsOffset,
  resultsBatchSize,
  setResultsPage,
]);

  function clearWidgetsForViewChange() {
    setResultsUiPage(0);
    setResults([]);
    resultsBatchRequestPending.current = false;
    setResultsPageMatchCount(0);
    setResultsPageComplete(false);
    setResultsTotalCount(null);
    setIsCountingResults(endpointReadyForQuery);
    setIsSearching(endpointReadyForQuery);
    setSearchError("");
    setSparqlQuery("");
    setSelectedUri("");
    setDescribedRecord([]);
    setIsDescribing(false);

    // Keep the persistent facet widget shells/headers; clear only their data.
    setPropertyFacets([]);
    setClassFacets([]);
    setRoleFacets([]);
    setGraphFacets([]);
    setPropertyFacetSparql("");
    setRoleFacetSparql("");
    setPropertyFacetError("");
    setClassFacetError("");
    setRoleFacetError("");
    setIsLoadingProperties(endpointReadyForQuery);
    setIsLoadingClasses(endpointReadyForQuery);
    setIsLoadingRoles(endpointReadyForQuery);
    setIsLoadingGraphs(endpointReadyForQuery);

    setGroupUiPage(0);
    setGroupBatchOffset(0);
    setGroupHasMoreBatches(false);
    setGroupValues([]);
    setGroupValuesLoading(false);
    setGroupValuesError("");
    setGroupMembers({});
    setFocusWidgetsSuppressed(true);
    setPersonalWidgets([]);

    replaceFacetAutofillCandidates("property", []);
    replaceFacetAutofillCandidates("property-in", []);
    setFacetAutofillCandidates({ property: [], "property-in": [] });

    if (resultsOffset !== 0) setResultsPage(resultsBatchSize, 0);
  }

  function navigateToPropertyPath(targetId: string) {
    const path = getPropertyPath();
    const currentPathId = path[path.length - 1]?.id ?? "query-root";
    if (targetId !== currentPathId) clearWidgetsForViewChange();
    navigateToPropertyPathRaw(targetId);
  }

  function moveViewToSibling(currentFocusId: string, targetId: string) {
    if (currentFocusId !== targetId) clearWidgetsForViewChange();
    moveViewToSiblingRaw(currentFocusId, targetId);
  }
  const [resultsTotalCount, setResultsTotalCount] = useState<number | null>(null);
  const [resultsPageMatchCount, setResultsPageMatchCount] = useState(0);
  // A short SPARQL result batch is the signal that this result stream has ended.
  // The separate scalar count is used for the overall pager, not as a substitute
  // for the actual result bindings returned by the current page query.
  const [resultsPageComplete, setResultsPageComplete] = useState(false);
  // The FCT Results request is paged, so a short batch only says that this
  // page is the end of the stream; it must not override a larger scalar count
  // for the whole query (e.g. 930 matches but 14 rows in the current FCT view).
  // Use the completed result stream only as a fallback when scalar counting is
  // unavailable, and never let a stale/partial batch lower a valid total.
  const effectiveResultsTotalCount = resultsTotalCount === null
    ? (resultsPageComplete ? results.length : null)
    : Math.max(resultsTotalCount, results.length);
  const [describedRecord, setDescribedRecord] = useState<{ property: string; value: string }[]>([]);
  const [recordDescriptionPage, setRecordDescriptionPage] = useState(0);
  const RECORD_DESCRIPTION_PAGE_SIZE = 20;
  
  // First pass: collect every value under its property URI.
const describedProperties = Array.from(
  describedRecord.reduce((grouped, item) => {
    const values = grouped.get(item.property) ?? [];
    values.push(item.value);
    grouped.set(item.property, values);
    return grouped;
  }, new Map<string, string[]>()),
  ([property, values]) => ({ property, values }),
);
  
  const [isDescribing, setIsDescribing] = useState(false);
  const [isCountingResults, setIsCountingResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchPipelineRun, setSearchPipelineRun] = useState(0);
  const [initialBrowseTriggered, setInitialBrowseTriggered] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState(0);

  const resultsCountSparql = buildFctCountSparql(queryTree);
  const resultsSparql = buildFctResultsSparql(queryTree);
  const resultsRequestXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
    type: "text", limit: String(resultsBatchSize), offset: String(resultsOffset),
  }));
  const resultsCountRequestIdentity = `${selectedEndpointId}\u0000${resultsCountSparql ?? ""}`;
  const latestResultsCountRequestIdentityRef = useRef(resultsCountRequestIdentity);
  // Update during render, not in an effect, so a response from an older query
  // cannot win the small interval between a new render and effect cleanup.
  latestResultsCountRequestIdentityRef.current = resultsCountRequestIdentity;

  useEffect(() => {
    const endpointReady = endpointReadyForQuery;
    if (!endpointReady) {
      setResultsTotalCount(null);
      setIsCountingResults(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadTotalCount() {
      if (cancelled) return;
      setIsCountingResults(true);
      try {
        if (!resultsCountSparql) {
          throw new Error("The current FCT query tree contains a condition that cannot be compiled safely to SPARQL.");
        }
        const response = await fetch("/proxy/api/sparql", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("results-total-count", "ResultsTotalCount") },
          body: JSON.stringify({ facetValueCount: { sparql: resultsCountSparql } }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Virtuoso SPARQL count query failed.");
        const total = Number(data.count);
        if (!Number.isSafeInteger(total) || total < 0) {
          throw new Error("Virtuoso returned an invalid scalar count.");
        }
        if (!cancelled && latestResultsCountRequestIdentityRef.current === resultsCountRequestIdentity) {
          setResultsTotalCount(total);
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        console.warn("SPARQL result count query failed:", error);
        if (!cancelled && latestResultsCountRequestIdentityRef.current === resultsCountRequestIdentity) {
          setResultsTotalCount(null);
        }
      } finally {
        if (!cancelled && latestResultsCountRequestIdentityRef.current === resultsCountRequestIdentity) {
          setIsCountingResults(false);
        }
      }
    }

    // Query-tree operations can emit several intermediate revisions during one
    // user action. Debounce the scalar count so Virtuoso only receives the
    // settled query; cleanup also prevents a late response from replacing the
    // count belonging to a newer query.
    const timer = window.setTimeout(() => { void loadTotalCount(); }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [resultsCountSparql, resultsCountRequestIdentity, selectedEndpointId, endpointReadyForQuery]);

  // FCT query timeout is expressed in milliseconds in the XML. Keep the slider
  // in seconds for the UI, and sync it if the authoritative query tree changes.
  useEffect(() => {
    const timeoutMs = Number(queryTree.attributes.timeout ?? "0");
    setTimeoutSeconds(Number.isFinite(timeoutMs)
      ? Math.max(0, Math.min(60, Math.round(timeoutMs / 1000)))
      : 0);
  }, [queryTree.attributes.timeout]);

  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [propertyFacetError, setPropertyFacetError] = useState("");
  const [classFacetError, setClassFacetError] = useState("");
  const [expandedUris, setExpandedUris] = useState<Set<string>>(new Set());

  useEffect(() => {
    // URL restoration must finish before the initial browse decision is made.
    // In particular, never clear search text here: it may have been restored
    // from the shared URL or typed while the endpoint health check was running.
    if (!urlStateInitialized || !endpointReadyForQuery || initialBrowseTriggered) return;

    setInitialBrowseTriggered(true);

    // An empty initial search needs an explicit run token because its text value
    // has not changed. A restored or user-entered search runs through the normal
    // search dependency instead, without being cleared or needlessly restarted.
    if (!search.trim()) {
      setSearchPipelineRun((current) => current + 1);
    }
  }, [urlStateInitialized, selectedEndpointId, endpointReadyForQuery, initialBrowseTriggered, search]);

  useEffect(() => {
    const query = search.trim();
    let cancelled = false;
    // One controller owns both stages of this Results run. When the query,
    // endpoint, or page changes, cleanup aborts any in-flight client requests.
    const controller = new AbortController();
    const requestQueryIdentity = `${selectedEndpointId}\u0000${queryCountXml}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}`;

    // Empty text is a valid initial browse query once an endpoint has passed its health check.
    const endpointReady = endpointReadyForQuery;
    if (!query && !endpointReady) return;
    setSearchError("");

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError("");

      try {
        console.info("Maestro Results FCT request starting", {
          queryFingerprint: proxyDebugFingerprint(resultsRequestXml),
          queryLength: resultsRequestXml.length,
        });
        const response = await fetch("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            ...proxyDebugHeaders("results-search", `ResultsSearch:${proxyDebugFingerprint(resultsRequestXml)}`),
          },
          body: resultsRequestXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        if (cancelled) return;
        rememberShortforms(data?.shortforms);
        const rawResults: FctResult[] = Array.isArray(data.results) ? data.results : [];
        const uniqueResults = new Map<string, FctResult>();
        for (const item of rawResults) {
          const previous = uniqueResults.get(item.uri);
          uniqueResults.set(item.uri, previous
            ? { ...previous, ...item, matches: [...previous.matches, ...item.matches] }
            : { ...item, matches: [...item.matches] });
        }
        const nextResults = Array.from(uniqueResults.values());

        // Enrichment may take much longer than the FCT response. Never allow
        // a completed request for an older breadcrumb/endpoint to repopulate
        // the widgets after the coordinated transition has cleared them.
        if (cancelled || requestQueryIdentity !== activeQueryIdentityRef.current) return;

        setSparqlQuery(data.sparql || "");
        // Paging offsets belong to the raw query rows, not the deduplicated
        // resource list. Text search can return multiple excerpts per resource.
        setResultsPageMatchCount(rawResults.length);
        setResultsPageComplete(rawResults.length < resultsBatchSize);
        setResults((current) => {
          if (resultsOffset === 0) return nextResults;
          const merged = new Map(current.map((item) => [item.uri, item]));
          for (const item of nextResults) {
            const prior = merged.get(item.uri);
            merged.set(item.uri, prior ? { ...prior, ...item, matches: [...prior.matches, ...item.matches] } : item);
          }
          return Array.from(merged.values());
        });

        setSelectedUri((current) => current || nextResults[0]?.uri || "");
      } catch (error) {
        if (cancelled) return;

        setResults([]);
        setResultsPageMatchCount(0);
        setSelectedUri("");
        setSearchError(
          error instanceof Error ? error.message : "Search failed.",
        );
      } finally {
        resultsBatchRequestPending.current = false;
        if (!cancelled) setIsSearching(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, resultsRequestXml, resultsBatchSize, queryCountXml, resultsOffset, selectedEndpointId, endpointReadyForQuery, searchPipelineRun]);

  // Result badges are optional SPARQL enrichment. Keep this separate from the
  // FCT search pipeline so toggling badges never reloads/flickers the result set.
  const resultBadgeUrisKey = results.map((item) => item.uri).join("\u0000");
  const resultBadgePropertiesKey = getActiveViewPropertyFilters(queryTree)
    .map((node) => node.attributes.iri)
    .filter((iri): iri is string => typeof iri === "string" && Boolean(iri))
    .filter((iri, index, all) => all.indexOf(iri) === index)
    .join("\u0000");
  const resultBadgeRolesKey = getActiveViewRoleFilters(queryTree)
    .map((node) => node.attributes.iri)
    .filter((iri): iri is string => typeof iri === "string" && Boolean(iri))
    .filter((iri, index, all) => all.indexOf(iri) === index)
    .join("\u0000");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const selectedForward = resultBadgePropertiesKey ? resultBadgePropertiesKey.split("\u0000") : [];
    const selectedReverse = resultBadgeRolesKey ? resultBadgeRolesKey.split("\u0000") : [];

    if (!showResultBadges || !endpointReadyForQuery || !results.length ||
        (!selectedForward.length && !selectedReverse.length)) {
      setResults((current) => {
        if (!current.some((item) => (item.scopeValues?.length ?? 0) > 0)) return current;
        return current.map((item) => ({ ...item, scopeValues: [] }));
      });
      return () => controller.abort();
    }

    const resourceUris = [...new Set(results.map((item) => item.uri).filter(Boolean))];
    const relationships: ScopeValue[] = [
      ...selectedForward.map((property) => ({
        property,
        label: toLabel(property),
        direction: "forward" as const,
        values: [{ value: "-" }],
      })),
      ...selectedReverse.map((property) => ({
        property,
        label: toLabel(property),
        direction: "reverse" as const,
        values: [{ value: "-" }],
      })),
    ];

    setResults((current) => current.map((item) => ({
      ...item,
      scopeValues: relationships.map((relationship) => ({
        ...relationship,
        values: relationship.values.map((value) => ({ ...value })),
      })),
    })));

    void (async () => {
      try {
        const response = await fetch("/proxy/api/sparql", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...proxyDebugHeaders("results-enrichment", `ResultsEnrichment:${proxyDebugFingerprint(`${resultBadgeUrisKey}:${resultBadgePropertiesKey}:${resultBadgeRolesKey}`)}`),
          },
          body: JSON.stringify({ resources: resourceUris, properties: selectedForward, roles: selectedReverse }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not enrich Results items.");

        const facetLabel = (iri: string, _direction: RelationshipDirection) => toLabel(iri);
        const grouped = new Map<string, Map<string, ScopeValue>>();
        for (const item of results) {
          const resourceGroups = new Map<string, ScopeValue>();
          for (const relationship of relationships) {
            const key = `${item.uri}\u0000${relationship.direction}\u0000${relationship.property}`;
            resourceGroups.set(key, { ...relationship, values: [{ value: "-" }] });
          }
          grouped.set(item.uri, resourceGroups);
        }
        const bindings = Array.isArray(data.results?.bindings) ? data.results.bindings : [];
        for (const binding of bindings) {
          const resource = binding.resource?.value;
          const property = binding.property?.value;
          const direction = binding.direction?.value === "reverse" ? "reverse" : "forward";
          const term = binding.value;
          if (typeof resource !== "string" || typeof property !== "string" || !term || typeof term.value !== "string") continue;
          const key = `${resource}\u0000${direction}\u0000${property}`;
          let resourceGroups = grouped.get(resource);
          if (!resourceGroups) {
            resourceGroups = new Map<string, ScopeValue>();
            grouped.set(resource, resourceGroups);
          }
          let scopeValue = resourceGroups.get(key);
          if (!scopeValue) {
            scopeValue = { property, label: facetLabel(property, direction), direction, values: [] };
            resourceGroups.set(key, scopeValue);
          }
          const nextTerm: EnrichedTerm = {
            value: term.value,
            ...(typeof term.type === "string" ? { type: term.type } : {}),
            ...(typeof term.datatype === "string" ? { datatype: term.datatype } : {}),
            ...(typeof term["xml:lang"] === "string" ? { lang: term["xml:lang"] } : {}),
          };
          if (scopeValue.values.length === 1 && scopeValue.values[0].value === "-") {
            scopeValue.values = [nextTerm];
          } else if (!scopeValue.values.some((item) => item.value === nextTerm.value && item.type === nextTerm.type && item.datatype === nextTerm.datatype && item.lang === nextTerm.lang)) {
            scopeValue.values.push(nextTerm);
          }
        }
        if (cancelled) return;
        setResults((current) => current.map((item) => ({
          ...item,
          scopeValues: [...(grouped.get(item.uri)?.values() ?? [])],
        })));
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.warn("Results badge enrichment failed:", error);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [showResultBadges, resultBadgeUrisKey, resultBadgePropertiesKey, resultBadgeRolesKey, selectedEndpointId, endpointReadyForQuery, propertyFacets, roleFacets]);

  useEffect(() => {
    setGroupUiPage(0);
    setGroupBatchOffset(0);
    setGroupHasMoreBatches(false);
    setGroupValues([]);
    setGroupMembers({});
    groupMemberRequestStates.current.clear();
    setGroupValuesError("");
  }, [queryCountXml, selectedGroupByOption?.key]);

  // Load group values through FCT itself. This query is a clone of the current
  // tree with the selected relationship used to enumerate its values.
  useEffect(() => {
    let cancelled = false;
    if (centralTab !== "groups" || !selectedGroupByOption) {
      setGroupValuesLoading(false);
      setGroupValuesError("");
      return;
    }
    const controller = new AbortController();
    setGroupValuesLoading(true);
    setGroupValuesError("");
    (async () => {
      try {
        const groupTreeBase = createGroupValuesQuery(queryTree, selectedGroupByOption);
        const groupTree = setQueryViewAttributes(groupTreeBase, {
          // Group headings enumerate the selected relationship's distinct
          // values (including RDF literals), not text-search result resources.
          type: "list", limit: String(groupBatchSize), offset: String(groupBatchOffset),
        });
        const groupValuesXml = serializeFctQuery(groupTree);
        const response = await fetch("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("group-values-fct", "GroupsValues") },
          body: groupValuesXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        if (!cancelled) {
          rememberShortforms(data?.shortforms);
          const nextGroupValues: FctResult[] = Array.isArray(data.results) ? data.results : [];
          setGroupHasMoreBatches(nextGroupValues.length >= groupBatchSize);
          setGroupValues((current) => {
            if (groupBatchOffset === 0) return nextGroupValues;
            const merged = new Map(current.map((item) => [groupValueKey(item), item]));
            for (const item of nextGroupValues) merged.set(groupValueKey(item), item);
            return Array.from(merged.values());
          });
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setGroupValues([]);
        setGroupValuesError(error instanceof Error ? error.message : "Failed to load group values.");
      } finally {
        if (!cancelled) setGroupValuesLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [centralTab, search, queryCountXml, groupByPropertyUri, selectedGroupByOption?.key, groupBatchSize, groupBatchOffset]);

  // Each group member list is another FCT request: clone the complete source
  // query, bind only this group's value to the selected relationship, and keep
  // the view and all other filters exactly as they are.
  useEffect(() => {
    if (!selectedGroupByOption || groupValues.length === 0) {
      setGroupMembers({});
      return;
    }
    // Do not populate the Groups tab while another tab is active, and do not
    // fetch members for group cards that are not currently visible.
    if (centralTab !== "groups" || visibleGroupValues.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    const requestKeys: string[] = [];
    for (const groupValue of pageGroupValues) {
      const key = `${selectedGroupByOption.key}::${groupValueKey(groupValue)}`;
      const requestState = groupMemberRequestStates.current.get(key);
      if (requestState === "loaded" || requestState === "loading") continue;
      requestKeys.push(key);
      groupMemberRequestStates.current.set(key, "loading");
      setGroupMembers((current) => ({ ...current, [key]: { results: current[key]?.results ?? [], loading: true, error: "" } }));
      void (async () => {
        try {
          const memberTree = createGroupMemberQuery(queryTree, selectedGroupByOption, groupValue);
          const memberXml = serializeFctQuery(setQueryViewAttributes(memberTree, {
            type: "text", limit: String(resultsBatchSize), offset: "0",
          }));
          const request = (body: string, label: string) => fetch("/proxy/api/fct", {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("group-members-fct", label) },
            body,
            signal: controller.signal,
          }).then(readFctResponse);
          // The SPARQL translator does not implement FCT's `count` view.
          // Use the distinct member rows returned by the supported `text` view
          // for the group count instead of issuing a request that always errors.
          const data = await request(memberXml, "GroupsMembers");
          if (!cancelled) {
            rememberShortforms(data?.shortforms);
            const rawResults: FctResult[] = Array.isArray(data.results) ? data.results : [];
            const uniqueResults = new Map<string, FctResult>();
            for (const item of rawResults) {
              const previous = uniqueResults.get(item.uri);
              uniqueResults.set(item.uri, previous ? { ...previous, ...item, matches: [...previous.matches, ...item.matches] } : { ...item, matches: [...item.matches] });
            }
            groupMemberRequestStates.current.set(key, "loaded");
            setGroupMembers((current) => ({ ...current, [key]: {
              results: Array.from(uniqueResults.values()),
              count: uniqueResults.size,
              loading: false,
              error: "",
              // Keep the raw-row offset: a resource can have multiple excerpts.
              offset: rawResults.length,
              hasMore: rawResults.length >= resultsBatchSize,
            } }));
          }
        } catch (error) {
          // Cleanup already releases this request's loading marker. An aborted
          // older request must not delete the marker for a newer request that
          // has since started for the same group key.
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          groupMemberRequestStates.current.delete(key);
          setGroupMembers((current) => ({ ...current, [key]: { results: [], loading: false, error: error instanceof Error ? error.message : "Failed to load group items." } }));
        }
      })();
    }
    return () => {
      cancelled = true;
      for (const key of requestKeys) {
        if (groupMemberRequestStates.current.get(key) === "loading") groupMemberRequestStates.current.delete(key);
      }
      controller.abort();
    };
  }, [centralTab, search, queryXml, selectedGroupByOption?.key, pageGroupValues.map(groupValueKey).join("|"), resultsBatchSize]);

  useEffect(() => {
    const query = search.trim();
    let cancelled = false;

    const endpointReady = endpointReadyForQuery;
    if (!query && !endpointReady) {
      setPropertyFacets([]);
      setClassFacets([]);
      setRoleFacets([]);
      setGraphFacets([]);
      setPropertyFacetSparql("");
      setRoleFacetSparql("");
      replaceFacetAutofillCandidates("property", []);
      replaceFacetAutofillCandidates("property-in", []);
      setFacetAutofillCandidates({ property: [], "property-in": [] });
      setPropertyFacetError("");
      setClassFacetError("");
      setRoleFacetError("");
      setIsLoadingProperties(false);
      setIsLoadingClasses(false);
      setIsLoadingRoles(false);
      setFocusWidgetsSuppressed(false);
      return;
    }

    // Each facet is an independent request and owns its own loading/error state.
    // Release personal widgets immediately from the current query tree; they must
    // not wait for Categories, Properties, or Roles to finish loading.
    setFocusWidgetsSuppressed(false);
    setIsLoadingProperties(true);
    setIsLoadingClasses(true);
    setIsLoadingRoles(true);
    setPropertyFacetError("");
    setClassFacetError("");
    setRoleFacetError("");

    // Every query/endpoint change resets the graph page and invalidates its old rows.
    setGraphsPage(0);
    setGraphFacets([]);

    // A new source query means the previous scope's Autofill intersection is stale.
    // Clear it immediately; each facet kind repopulates its own list after its query loads.
    replaceFacetAutofillCandidates("property", []);
    replaceFacetAutofillCandidates("property-in", []);
    setFacetAutofillCandidates({ property: [], "property-in": [] });
    const controller = new AbortController();

    async function loadFacet(view: "properties" | "classes" | "roles") {
      // Incoming predicates are the inverse-property (Roles) facet.
      // Virtuoso exposes these with view type="properties-in".
      const facetXml = view === "roles" ? roleFacetQueryXml : view === "classes" ? classFacetQueryXml : propertyFacetQueryXml;
      const response = await fetch("/proxy/api/fct", {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", "FacetLoader") },
        body: facetXml,
        signal: controller.signal,
      });
      const data = await readFctResponse(response);
      rememberShortforms(data?.shortforms);
      if (!response.ok)
        throw new Error(data.error ?? `Failed to load ${view} facets.`);
      return {
        items: view === "classes"
          ? data.classes
          : view === "roles"
            ? data.roles
            : data.properties,
        sparql: typeof data.sparql === "string" ? data.sparql : "",
      };
    }

    async function refreshFacet(view: "properties" | "classes" | "roles") {
      try {
        const result = await loadFacet(view);
        if (cancelled) return;
        const items = Array.isArray(result.items) ? result.items : [];
        if (view === "properties") {
          setPropertyFacets(items);
          setPropertyFacetSparql(result.sparql);
        } else if (view === "classes") {
          setClassFacets(items);
        } else {
          setRoleFacets(items);
          setRoleFacetSparql(result.sparql);
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        const message = error instanceof Error ? error.message : `Failed to load ${view} facets.`;
        if (view === "properties") {
          setPropertyFacets([]);
          setPropertyFacetSparql("");
          setPropertyFacetError(message);
        } else if (view === "classes") {
          setClassFacets([]);
          setClassFacetError(message);
        } else {
          setRoleFacets([]);
          setRoleFacetSparql("");
          setRoleFacetError(message);
        }
      } finally {
        if (!cancelled) {
          if (view === "properties") setIsLoadingProperties(false);
          else if (view === "classes") setIsLoadingClasses(false);
          else setIsLoadingRoles(false);
        }
      }
    }

    // Keep a short debounce for intermediate query-tree edits, but once the
    // settled snapshot is ready, launch all three independent requests together.
    const timer = setTimeout(() => {
      void refreshFacet("properties");
      void refreshFacet("classes");
      void refreshFacet("roles");
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, propertyFacetQueryXml, classFacetQueryXml, roleFacetQueryXml, selectedEndpointId, endpointReadyForQuery]);

  // Fetch only the graph page the user requested; never scan the entire result set.
  useEffect(() => {
    if (!endpointReadyForQuery || !selectedEndpointId) {
      setGraphFacets([]);
      setGraphListSparql("");
      setGraphHasMore(false);
      setIsLoadingGraphs(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingGraphs(true);
    setGraphListSparql("");
    async function loadGraphPage() {
      try {
        const limit = FACET_PAGE_SIZE;
        const offset = graphsPage * limit;
        const graphQueryXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
          type: "graphs", limit: String(limit), offset: String(offset),
        }));
        const response = await fetch("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("graph-list", "GraphList") },
          body: graphQueryXml,
          signal: controller.signal,
        });
        const responseText = await response.text();
        const data = parseFctResponse(responseText);
        if (!cancelled) rememberShortforms(data?.shortforms);
        if (!cancelled) setGraphListSparql(data.sparql ?? "");
        if (!response.ok) throw new Error(data.error ?? "Failed to load datasites for the current query.");
        if (data.error) throw new Error(data.error);
        if (cancelled) return;
        //const graphs = Array.isArray(data.graphs) ? [...new Set(data.graphs.filter((value: unknown): value is string => typeof value === "string"))] : [];
       // setGraphFacets(graphs.map((uri: string) => ({ uri, label: uri, count: 0 })));

const graphs: string[] = Array.isArray(data.graphs)
  ? Array.from(
      new Set<string>(
        (data.graphs as unknown[]).filter(
          (value): value is string => typeof value === "string"
        )
      )
    )
  : [];

setGraphFacets(graphs.map((uri) => ({ uri, label: toLabel(uri), count: 0 })));

        setGraphHasMore(typeof data.rowCount === "number" ? data.rowCount >= limit : graphs.length >= limit);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Graph page load failed:", error);
          setGraphFacets([]);
          setGraphHasMore(false);
        }
      } finally {
        if (!cancelled) setIsLoadingGraphs(false);
      }
    }
    void loadGraphPage();
    return () => { cancelled = true; controller.abort(); };
  }, [graphsPage, queryWithoutPagingXml, selectedEndpointId, endpointReadyForQuery]);


  // Defensively merge duplicate resource rows by URI. The API normally groups
  // these already, but this also protects the UI if the endpoint returns repeats.
  const visibleResults = Array.from(
    results.reduce((grouped, item) => {
      const existing = grouped.get(item.uri);
      if (existing) {
        const seenExcerpts = new Set(
          existing.matches.map((match) => match.excerpt),
        );
        for (const match of item.matches) {
          if (!seenExcerpts.has(match.excerpt)) {
            existing.matches.push(match);
            seenExcerpts.add(match.excerpt);
          }
        }
        if ((!existing.title || existing.title === existing.uri) && item.title) {
          existing.title = item.title;
        }
      } else {
        grouped.set(item.uri, {
          ...item,
          matches: [...item.matches],
        });
      }
      return grouped;
    }, new Map<string, FctResult>()),
  ).map(([, item]) => item);
  const allLoadedResults = visibleResults;
  // Match excerpts/counts are meaningful only for the root-level live <view>.
  // A nested view represents a focused path, not a root text-search result set.
  const isRootView = queryTree.children.some((node) => node.id === "query-view");
  const visibleResultsPage = allLoadedResults.slice(resultsUiPage * resultsPageSize, (resultsUiPage + 1) * resultsPageSize);
  useEffect(() => {
    // Group members can be selected even when they are not on the ordinary
    // Results page. Do not let Results-page auto-selection override that pick
    // while the Groups tab is active; restore page-local selection on return.
    if (centralTab !== "groups" && visibleResultsPage.length > 0 && !visibleResultsPage.some((item) => item.uri === selectedUri)) {
      setSelectedUri(visibleResultsPage[0].uri);
    }
  }, [centralTab, resultsOffset, resultsPageSize, resultsUiPage, visibleResultsPage, selectedUri]);

  const selectedResult = visibleResultsPage.find((item) => item.uri === selectedUri);
  const selectedGroupRecord = groupValues.find((item) => item.uri === selectedUri);

  // Load the selected resource once through the FCT DESCRIBE view; pagination is local to
  // the returned property/value pairs and does not trigger another server query.
  useEffect(() => {
    if (!selectedUri || !selectedEndpointId) {
      setDescribedRecord([]);
      setRecordDescriptionPage(0);
      setIsDescribing(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setDescribedRecord([]);
    setRecordDescriptionPage(0);
    setIsDescribing(true);
    async function loadDescription() {
      try {
        const describeQueryXml = `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" inference="${escapeXmlText(queryTree.attributes.inference ?? "")}" same-as="${escapeXmlText(queryTree.attributes["same-as"] ?? "")}"><value datatype="uri">${escapeXmlText(selectedUri)}</value><view type="describe" limit="30" offset="0"/></query>`;
        const response = await fetch("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("record-description-fct", "RecordDescription") },
          body: describeQueryXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        if (!cancelled) rememberShortforms(data?.shortforms);
        const rows = data.describe.flatMap((triple) => {
          const property = triple.predicate.value;
          const object = triple.object.termType === "bnode" ? `_:${triple.object.value}` : triple.object.value;
          return property && object ? [{ property, value: object }] : [];
        });
        if (!cancelled) setDescribedRecord(rows);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("FCT DESCRIBE failed:", error);
          setDescribedRecord([]);
        }
      } finally {
        if (!cancelled) setIsDescribing(false);
      }
    }
    void loadDescription();
    return () => { cancelled = true; controller.abort(); };
  }, [selectedUri, selectedEndpointId, queryTree.attributes.inference, queryTree.attributes["same-as"]]);

  // The active scope is the property-path node that currently contains the
  // authoritative <view>; at the root, scope is represented by null.
// The active scope is the property-path node that currently contains the
// authoritative <view>; at the root, scope is represented by null.
const activePropertyPath = getPropertyPath();

const activeLeafId: string | null =
  activePropertyPath.length > 0
    ? activePropertyPath[activePropertyPath.length - 1].id
    : null;

const displayedBreadcrumbPath =
  activePropertyPath.length <= breadcrumbTrail.length &&
  activePropertyPath.every(
    (crumb, index) => crumb.id === breadcrumbTrail[index]?.id,
  )
    ? breadcrumbTrail
    : activePropertyPath;

const activeBreadcrumbIndex = activePropertyPath.length - 1;  // Derive checked state from the authoritative query tree, including path
  // properties left at the root when a breadcrumb moves the view elsewhere.
  const activePropertyFilters = getActiveViewPropertyFilters(queryTree);
  const activeRoleFilters = getActiveViewRoleFilters(queryTree);
  // Checkbox state is local to the active view's scope. Filters selected in
  // another query-tree branch must not appear checked when navigating here.
  const selectedProperties = new Set(
    activePropertyFilters
      .map((node) => node.attributes.iri)
      .filter((iri): iri is string => typeof iri === "string"),
  );
  const selectedRoles = new Set(
    activeRoleFilters
      .map((node) => node.attributes.iri)
      .filter((iri): iri is string => typeof iri === "string"),
  );
  const selectedClasses = new Set(getClassesAtNode(activeLeafId));
  // Keep query-selected Categories visible even if the classes endpoint omits
  // them from its current candidate list. Only current-scope <class> nodes are
  // considered; classes from another query-tree branch are deliberately ignored.
  const classDisplayFacets = [
    ...Array.from(selectedClasses)
      .filter((uri) => !classFacets.some((item) => item.uri === uri))
      .map((uri) => ({ uri, label: uri, count: 0 })),
    ...classFacets,
  ];
  const visibleClassDisplayFacets = classDisplayFacets.filter((item) => {
    const countQuery = distinctCountQueryFor(queryTree, "class", item.uri);
    // Selected classes stay visible so they can be unchecked; unselected classes
    // disappear once their count against this exact live query is confirmed 0.
    return selectedClasses.has(item.uri) || classCandidateCounts[countQuery] !== 0;
  });
  // Like Properties and Roles, Categories puts query-selected terms in a
  // dedicated pane above the paged list, so selected items do not appear twice.
  const selectedClassDisplayFacets = visibleClassDisplayFacets.filter((item) => selectedClasses.has(item.uri));
  const unselectedClassDisplayFacets = visibleClassDisplayFacets.filter((item) => !selectedClasses.has(item.uri));
  useEffect(() => {
    setClassesPage((current) =>
      Math.min(current, Math.max(0, Math.ceil(unselectedClassDisplayFacets.length / FACET_PAGE_SIZE) - 1)),
    );
  }, [unselectedClassDisplayFacets.length]);
  const autoConfigureFacetCount =
    facetAutofillCandidates.property.filter((uri) => !selectedProperties.has(uri)).length +
    facetAutofillCandidates["property-in"].filter((uri) => !selectedRoles.has(uri)).length;
  const selectedPropertyKey = Array.from(selectedProperties).sort().join("|");
  const selectedRoleKey = Array.from(selectedRoles).sort().join("|");

  // Auto-configure candidates are the intersection of frequently added facets
  // and the current FCT facet results. The FCT response already represents the
  // active query scope, so a second SPARQL request is unnecessary and can fail
  // on endpoints that expose FCT but restrict their SPARQL service.
  useEffect(() => {
    if (typeof window === "undefined" || isLoadingProperties) return;
    const counts = readFacetAddCounts();
    const highFrequency = new Set(
      Object.entries(counts.property)
        .filter(([, count]) => count >= 3)
        .map(([uri]) => uri),
    );
    const applicable = propertyFacets
      .map((facet) => facet.uri)
      .filter((uri) => highFrequency.has(uri) && !selectedProperties.has(uri));
    const candidates = replaceFacetAutofillCandidates("property", applicable);
    setFacetAutofillCandidates((current) =>
      current.property.length === candidates.length &&
      current.property.every((uri, index) => uri === candidates[index])
        ? current
        : { ...current, property: candidates },
    );
  }, [isLoadingProperties, propertyFacets, facetUsageRevision, selectedPropertyKey]);

  useEffect(() => {
    if (typeof window === "undefined" || isLoadingRoles) return;
    const counts = readFacetAddCounts();
    const highFrequency = new Set(
      Object.entries(counts["property-in"])
        .filter(([, count]) => count >= 3)
        .map(([uri]) => uri),
    );
    const applicable = roleFacets
      .map((facet) => facet.uri)
      .filter((uri) => highFrequency.has(uri) && !selectedRoles.has(uri));
    const candidates = replaceFacetAutofillCandidates("property-in", applicable);
    setFacetAutofillCandidates((current) =>
      current["property-in"].length === candidates.length &&
      current["property-in"].every((uri, index) => uri === candidates[index])
        ? current
        : { ...current, "property-in": candidates },
    );
  }, [isLoadingRoles, roleFacets, facetUsageRevision, selectedRoleKey]);
  // Shared lookup for relationship paths. Direction selects the RDF edge tag;
  // the ID prefix distinguishes a path node from an ordinary filter node.
  function findRelationshipPathNode(
    uri: string,
    direction: RelationshipDirection,
  ): FctQueryNode | null {
    const tag = direction === "forward" ? "property" : "property-of";
    const idPrefix = direction === "forward" ? "property-path-" : "role-filter-";
    function visit(nodes: FctQueryNode[]): FctQueryNode | null {
      for (const node of nodes) {
        if (node.name === tag && node.id.startsWith(idPrefix) && node.attributes.iri === uri) return node;
        const nested = visit(node.children);
        if (nested) return nested;
      }
      return null;
    }
    return visit(queryTree.children);
  }

  function findPropertyPathNode(uri: string): FctQueryNode | null {
    return findRelationshipPathNode(uri, "forward");
  }

  function setAutoConfiguredFacet(kind: "property" | "property-in", uri: string, enabled: boolean) {
    const key = `${kind}::${uri}`;
    let next = new Set(autoConfiguredFacetKeys);
    try {
      const raw = window.localStorage.getItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) next = new Set(parsed.filter((item): item is string => typeof item === "string"));
      }
    } catch {
      // Fall back to this session's state when browser storage is unavailable.
    }
    if (enabled) next.add(key);
    else next.delete(key);
    setAutoConfiguredFacetKeys(next);
    try {
      window.localStorage.setItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // The UI marker is still useful for this session if storage is unavailable.
    }
  }

  // Single source of truth for both checkbox changes and property-label clicks.
  function handlePropertyCheckboxChange(uri: string, checked: boolean, trackUsage = true) {
    if (trackUsage) setAutoConfiguredFacet("property", uri, false);
    if (checked) {
      addProperty(activeLeafId, uri);
      const facet = propertyFacets.find((item) => item.uri === uri);
      setPersonalWidgets((current) =>
        current.some((widget) => widget.uri === uri)
          ? current
          : [
              ...current,
              {
                uri,
                label: toLabel(uri),
                excluded: false,
                values: [],
                selectedValues: [],
                page: 0,
                loading: true,
                error: "",
              },
            ],
      );
    } else {
      const pathNode = findPropertyPathNode(uri);
      if (pathNode) {
        // The API relocates the view safely if this path currently contains it.
        deleteNode(pathNode.id);
      } else {
        removeProperty(activeLeafId, uri);
      }
      setPersonalWidgets((current) =>
        current.filter((widget) => widget.uri !== uri),
      );
    }
  }

  function handleFacetShiftClick(
    group: "Properties" | "Classes" | "Roles",
    uri: string,
    currentlySelected: boolean,
  ) {
    const activePath = getPropertyPath();
    const scopeParentId = activePath[activePath.length - 1]?.id ?? null;
    const findNode = (nodes: FctQueryNode[], id: string): FctQueryNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const nested = findNode(node.children, id);
        if (nested) return nested;
      }
      return null;
    };
    const scopeParent = scopeParentId ? findNode(queryTree.children, scopeParentId) : null;
    const scopeNodes = scopeParent ? scopeParent.children : queryTree.children;
    const nodeName = group === "Properties" ? "property" : group === "Roles" ? "property-of" : "class";
    let facetNode = scopeNodes.find((node) =>
      node.name === nodeName && node.attributes.iri === uri &&
      (group !== "Properties" || node.id.startsWith("property-filter-")) &&
      (group !== "Roles" || node.id.startsWith("role-filter-")),
    );

    if (currentlySelected && facetNode) {
      setNodeAttribute(facetNode.id, "exclude", facetNode.attributes.exclude === "yes" ? null : "yes");
      return;
    }

    if (group === "Properties") {
      handlePropertyCheckboxChange(uri, true);
      facetNode = { id: `property-filter-${encodeURIComponent(uri)}`, name: "property", attributes: { iri: uri }, children: [] };
    } else if (group === "Classes") {
      toggleClass(uri, true);
      facetNode = { id: `class-${scopeParentId ? `${encodeURIComponent(scopeParentId)}-` : "root-"}${encodeURIComponent(uri)}`, name: "class", attributes: { iri: uri }, children: [] };
    } else {
      handleRoleCheckboxChange(uri, true);
      facetNode = { id: `role-filter-${scopeParentId ? `${encodeURIComponent(scopeParentId)}-` : "root-"}${encodeURIComponent(uri)}`, name: "property-of", attributes: { iri: uri }, children: [] };
    }
    setNodeAttribute(facetNode.id, "exclude", "yes");
  }

  function isFacetExcluded(group: "Properties" | "Classes" | "Roles", uri: string): boolean {
    const activePath = getPropertyPath();
    const scopeParentId = activePath[activePath.length - 1]?.id ?? null;
    const findNode = (nodes: FctQueryNode[], id: string): FctQueryNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const nested = findNode(node.children, id);
        if (nested) return nested;
      }
      return null;
    };
    const scopeParent = scopeParentId ? findNode(queryTree.children, scopeParentId) : null;
    const nodeName = group === "Properties" ? "property" : group === "Roles" ? "property-of" : "class";
    return (scopeParent ? scopeParent.children : queryTree.children).some((node) =>
      node.name === nodeName && node.attributes.iri === uri && node.attributes.exclude === "yes" &&
      (group !== "Properties" || node.id.startsWith("property-filter-")) &&
      (group !== "Roles" || node.id.startsWith("role-filter-")),
    );
  }

  function toggleClass(uri: string, checked: boolean) {
    if (checked) addClass(activeLeafId, uri);
    else removeClass(activeLeafId, uri);
  }

  // Graph selection is a query-wide binding, independent of the text-search node.
  // Keep the toolbar's Graph field synchronized with the query graph attribute.
  useEffect(() => {
    setGraphText(queryTree.attributes.graph ?? "");
  }, [queryTree.attributes.graph]);

  function bindGraph(uri: string) {
    setGraphText(uri);
    setQueryAttribute("graph", uri);
  }

  function applyGraphText() {
    const graph = graphText.trim();
    setQueryAttribute("graph", graph || null);
  }

  function clearGraph() {
    setGraphText("");
    setQueryAttribute("graph", null);
  }

  function handleRoleCheckboxChange(uri: string, checked: boolean, trackUsage = true) {
    if (trackUsage) setAutoConfiguredFacet("property-in", uri, false);
    setRoleFilter(uri, checked);
  }

  function navigateIntoRelationship(uri: string, direction: RelationshipDirection) {
    const existingPath = findRelationshipPathNode(uri, direction);
    if (existingPath) {
      navigateToPropertyPath(existingPath.id);
      return;
    }

    // Adding a relationship path relocates the active <view>, so clear all
    // query-scoped widget results as part of this explicit view transition.
    clearWidgetsForViewChange();
    if (direction === "forward") {
      // Preserve Properties behavior: ensure its filter is selected before the
      // query API promotes it into a forward path.
      if (!selectedProperties.has(uri)) handlePropertyCheckboxChange(uri, true);
      addNestedProperty(uri);
    } else {
      // The query API promotes an existing role filter, or creates the reverse
      // path directly, and places the active view inside the <property-of>.
      addNestedPropertyOf(uri);
    }
  }

  const changeResultsPage = useCallback((delta: number) => {
    const nextPage = Math.max(0, resultsUiPage + delta);
    const totalPages = effectiveResultsTotalCount === null ? 1 : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize));
    if (nextPage >= totalPages || nextPage === resultsUiPage) return;
    setResultsUiPage(nextPage);
    const requiredResultCount = (nextPage + 1) * resultsPageSize;
    if (requiredResultCount > results.length && results.length < (effectiveResultsTotalCount ?? Number.POSITIVE_INFINITY) && !isSearching) {
      resultsBatchRequestPending.current = true;
      setResultsPage(resultsBatchSize, resultsOffset + Math.max(1, resultsPageMatchCount));
    }
  }, [resultsUiPage, effectiveResultsTotalCount, resultsPageSize, results.length, isSearching, resultsBatchSize, resultsOffset, resultsPageMatchCount, setResultsPage]);

  useEffect(() => {
    if (centralTab !== "results") return;
    const handleResultsArrowKeys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.closest("input, textarea, select, [contenteditable='true']")
      )) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") {
        changeResultsPage(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        changeResultsPage(1);
        return;
      }
      if (allLoadedResults.length === 0) return;
      const currentIndex = allLoadedResults.findIndex((item) => item.uri === selectedUri);
      const nextIndex = currentIndex < 0
        ? (event.key === "ArrowDown" ? 0 : allLoadedResults.length - 1)
        : currentIndex + (event.key === "ArrowDown" ? 1 : -1);
      if (nextIndex < 0 || nextIndex >= allLoadedResults.length) return;
      setSelectedUri(allLoadedResults[nextIndex].uri);
      setResultsUiPage(Math.floor(nextIndex / resultsPageSize));
    };
    window.addEventListener("keydown", handleResultsArrowKeys);
    return () => window.removeEventListener("keydown", handleResultsArrowKeys);
  }, [centralTab, allLoadedResults, selectedUri, resultsPageSize, changeResultsPage]);

  useEffect(() => {
    if (centralTab !== "results") return;
    document.querySelector('[data-result-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [centralTab, selectedUri, resultsUiPage, visibleResultsPage]);


  function compactIri(value: string): string {
    return toLabel(value);
  }

  function classBreadcrumbLabels(parentId: string | null): string[] {
    return getClassesAtNode(parentId).map((iri) => {
      return toLabel(iri);
    });
  }

  function getBreadcrumbSiblings(targetId: string): FctQueryNode[] {
    const isRelationship = (node: FctQueryNode) =>
      node.name === "property" || node.name === "property-of";

    let target: FctQueryNode | undefined;
    let targetParent: FctQueryNode | FctQueryTree | undefined;

    const visit = (
      nodes: FctQueryNode[],
      parent: FctQueryNode | FctQueryTree,
    ): boolean => {
      for (const node of nodes) {
        if (node.id === targetId) {
          target = node;
          targetParent = parent;
          return true;
        }
        if (visit(node.children, node)) return true;
      }
      return false;
    };
    visit(queryTree.children, queryTree);
    if (!target || !targetParent) return [];

    const parentChildren = "children" in targetParent ? targetParent.children : [];
    const parentSiblings = parentChildren.filter(
      (node, index, all) =>
        isRelationship(node) &&
        node.id !== targetId &&
        all.findIndex((candidate) => candidate.id === node.id) === index,
    );
    if (parentSiblings.length > 0) return parentSiblings;

    return [];

  }

  function breadcrumbSiblingLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri ?? node.attributes.property ?? node.attributes.role;
    const baseLabel = (iri ? toLabel(iri) : queryNodeLabel(node)) +
      (node.name === "property-of" ? " of" : "");
    return baseLabel;
  }

  /**
   * Pop the selected relationship from the displayed breadcrumb stack.
   * If this relationship has siblings, keep the stack slot and expose the
   * first remaining sibling there. This also handles auto-added ghost crumbs:
   * they represent real selected relationships even when the live <view> is
   * still at their parent.
   */
  function popBreadcrumbNode(crumb: { id: string; uri: string; name: string }) {
    const siblings = getBreadcrumbSiblings(crumb.id);
    const replacement = siblings[0];

    // Delete only this relationship (and its descendants) from the query.
    deleteNode(crumb.id);

    setBreadcrumbTrail((current) => {
      const crumbIndex = current.findIndex((entry) => entry.id === crumb.id);
      if (crumbIndex < 0) return current;

      // A sibling replaces the popped entry in the stack. Otherwise remove
      // this entry and the descendant suffix that belonged to it.
      const prefix = current.slice(0, crumbIndex);
      if (!replacement) return prefix;
      return [
        ...prefix,
        {
          id: replacement.id,
          uri: replacement.attributes.iri ?? "",
          name: replacement.name,
        },
      ];
    });
  }

  function queryNodeLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri;
    if (node.id === "query-text")
      return `Search text${node.text ? `: ${node.text}` : " (empty)"}`;
    if (node.id === "query-view") {
      return `Results view · limit ${node.attributes.limit ?? "30"} · offset ${node.attributes.offset ?? "0"}`;
    }
    if (node.name === "value")
      return node.text ? `Value: ${node.text}` : "Value";
    if (node.name === "property-of") {
      // Depending on the source XML, reverse relationships may expose their
      // predicate through iri, property, role, or text. Prefer the Roles facet
      // label, but never fall back to the generic XML tag name.
      const roleIri = iri ?? node.attributes.property ?? node.attributes.role;
      const roleText = typeof node.text === "string" ? node.text.trim() : "";
      return (roleIri ? toLabel(roleIri) : "") || roleText || "Role";
    }
    if (node.name === "property") {
      // Keep the full IRI in the query tree; use a concise label only for display.
      // Literal bindings are not wired into the UI yet, but display them if present
      // in the query model/XML (e.g. iri="...date" literal="5/23/92").
      const propertyLabel = iri ? toLabel(iri) : "Property";
      const literal = node.attributes.literal ?? node.attributes.value;
      return literal !== undefined && literal !== ""
        ? `${propertyLabel} = ${literal}`
        : propertyLabel;
    }
    if (node.name === "class" && iri) {
      return `Class: ${toLabel(iri)}`;
    }
    return node.name;
  }


  const renderQueryNode = (
    node: FctQueryNode,
    depth = 0,
  ): ReactNode => {
    const protectedNode =
      node.id === "query-text" || node.id === "query-view";
    return (
      <li key={node.id} className="min-w-0">
        <div
          className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
          style={{ marginLeft: depth * 14 }}
        >
          <span
            className="mt-0.5 select-none text-muted-foreground"
            aria-hidden="true"
          >
            {node.children.length ? "▾" : "·"}
          </span>
          {node.name === "property" || node.name === "property-of" ? (
            <button
              type="button"
              className="min-w-0 flex-1 break-words text-left text-sm underline-offset-2 hover:underline cursor-pointer"
              title={`Navigate to ${node.name === "property-of" ? "reverse-role" : "property"} scope: ${node.attributes.iri ?? queryNodeLabel(node)}`}
              onClick={() => navigateToPropertyPath(node.id)}
            >
              {queryNodeLabel(node)}{node.name === "property-of" ? " of" : ""}
            </button>
          ) : (
            <span
              className="min-w-0 flex-1 break-words text-sm"
              title={node.attributes.iri ?? node.name}
            >
              {queryNodeLabel(node)}
            </span>
          )}
          <button
            type="button"
            aria-label={
              protectedNode
                ? `${queryNodeLabel(node)} is required`
                : `Remove ${queryNodeLabel(node)} and its children`
            }
            title={
              protectedNode
                ? "Required query node"
                : "Remove this node and all descendants"
            }
            disabled={protectedNode}
            onClick={() => deleteNode(node.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-base leading-none text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-25"
          >
            −
          </button>
        </div>
        {node.children.length > 0 && (
          <ul
            className="border-l border-border/70"
            style={{ marginLeft: depth * 14 + 18 }}
          >
            {node.children.map((child) => renderQueryNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  // Shared widget renderer. The left-pane version stacks widgets vertically;
  // the full Personal View keeps the original responsive grid.
  function renderPersonalWidgetCards(layout: "column" | "grid"): ReactNode {
    return (
      <div
        className={
          layout === "column"
            ? "flex flex-col gap-3"
            : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        }
      >
        {personalWidgets.map((widget) => {
          const isGroupByFacet = groupedPersonalFacetUri === widget.uri;
          const canGroupByFacet = groupByOptions.some((option) => option.key === `forward:${widget.uri}`);
          return (
          <article
            key={widget.uri}
            ref={(element) => { if (element) personalWidgetCardRefs.current.set(widget.uri, element); else personalWidgetCardRefs.current.delete(widget.uri); }}
            className={`flex min-w-0 flex-col ${isGroupByFacet ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : ""}`}
          >
            <header className={`group/header flex items-start justify-between gap-2 border-b px-3 py-2 ${isGroupByFacet ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    className="break-words text-left text-sm font-semibold text-inherit underline-offset-2 hover:underline cursor-pointer"
                    title={`Navigate to ${widget.excluded ? `Excluded: ${toLabel(widget.uri)}` : toLabel(widget.uri)} scope`}
                    onClick={() => {
                      const existingPath = findPropertyPathNode(widget.uri);
                      if (existingPath) navigateToPropertyPath(existingPath.id);
                      else navigateIntoRelationship(widget.uri, "forward");
                    }}
                  >
                    {isGroupByFacet && <UsersRound className="mr-1 inline size-4 shrink-0" aria-label="Group by" />}
                    {widget.excluded && <CircleSlash className="mr-1 inline size-3.5 shrink-0" aria-label="Excluded" />}
                    {toLabel(widget.uri)}
                  </button>
                  {autoConfiguredFacetKeys.has(`property::${widget.uri}`) && (
                    <Bot className="size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <QueryInspectorButton
                      query={serializeFctQuery(createPropertyWidgetQuery(queryTree, widget.uri, "forward", undefined, true))}
                      filename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}.xml`}
                      countQuery={widget.values[0] ? buildFctCountSparql(createDistinctCountQuery(queryTree, "value", widget.values[0].uri, widget.uri, widget.values[0])) : undefined}
                      countFilename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}-first-item-count.xml`}
                    />
                    {!widget.excluded && (
                      <button
                        type="button"
                        disabled={!canGroupByFacet}
                        aria-pressed={isGroupByFacet}
                        onClick={() => {
                          if (isGroupByFacet) {
                            setGroupByPropertyUri("");
                            setCentralTab("results");
                          } else {
                            setGroupByPropertyUri(`forward:${widget.uri}`);
                            setCentralTab("groups");
                          }
                        }}
                        className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:pointer-events-none disabled:opacity-30 ${isGroupByFacet ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}
                        aria-label={isGroupByFacet ? `Stop grouping by ${toLabel(widget.uri)}` : `Group results by ${toLabel(widget.uri)}`}
                        title={isGroupByFacet ? `Stop grouping by ${toLabel(widget.uri)}` : canGroupByFacet ? `Group results by ${toLabel(widget.uri)}` : "Select this property in the active query before grouping by it"}
                      >
                        <UsersRound className="size-4" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const pathNode = findPropertyPathNode(widget.uri);
                        if (pathNode) deleteNode(pathNode.id);
                        else removeProperty(activeLeafId, widget.uri);
                        setPersonalWidgets((current) => current.filter((item) => item.uri !== widget.uri));
                      }}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                      aria-label={`Remove ${widget.excluded ? `Excluded: ${toLabel(widget.uri)}` : toLabel(widget.uri)} widget`}
                      title={`Remove ${toLabel(widget.uri)} facet`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  {widget.loading && (
                    <span
                      className="mt-1 break-all text-xs text-muted-foreground"
                      aria-live="polite"
                    >
                      Updating…
                    </span>
                  )}
                  {widget.error && (
                    <span
                      className="text-xs text-destructive"
                      title={widget.error}
                    >
                      Update failed
                    </span>
                  )}
                </div>
                <p
                  className="mt-1 break-all text-xs text-muted-foreground"
                  title={widget.uri}
                >
                  {widget.uri}
                </p>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {!widget.loading &&
                !widget.error &&
                widget.values.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No values found for this property.
                  </p>
                )}
              {!widget.loading &&
                !widget.error &&
                widget.values.length > 0 &&
                (() => {
                  // Query XML is the source of truth for checked values. Read
                  // this property's <value> children from the active view scope
                  // before ordering/paging endpoint results; selectedValues is a
                  // reconciled UI cache and can lag a render behind query changes.
                  const queryFilter = activePropertyFilters.find(
                    (node) => node.attributes.iri === widget.uri,
                  );
                  const checkedValueNodes = (queryFilter?.children ?? [])
                    .filter((child) => child.name === "value" && Boolean(child.text));
                  const queryValueKey = (node: FctQueryNode) => {
                    const datatype = node.attributes.datatype;
                    const lang = node.attributes["xml:lang"];
                    const effectiveDatatype = datatype ?? (lang ? undefined : "string");
                    return fctTermKey(node.text ?? "", effectiveDatatype, lang);
                  };
                  const checkedValueKeys = new Set(checkedValueNodes.map(queryValueKey));
                  const endpointValueKeys = new Set(widget.values.map(facetValueKey));
                  // Place query-selected values first in query order. Do not sort
                  // endpoint results: all unchecked values retain proxy order.
                  const endpointValuesByKey = new Map(
                    widget.values.map((value) => [facetValueKey(value), value] as const),
                  );
                  const checkedValuesFromQuery: FctResult[] = checkedValueNodes.map((node) => {
                    const key = queryValueKey(node);
                    const endpointValue = endpointValuesByKey.get(key);
                    if (endpointValue) return endpointValue;
                    const datatype = node.attributes.datatype;
                    const lang = node.attributes["xml:lang"];
                    const value = node.text ?? "";
                    return {
                      uri: value,
                      title: value,
                      termType: datatype === "uri" ? "uri" : "literal",
                      ...(datatype ? { datatype } : {}),
                      ...(lang ? { lang } : {}),
                      matches: [],
                    };
                  });
                  const orderedValues = [
                    ...checkedValuesFromQuery,
                    ...widget.values.filter((value) => !checkedValueKeys.has(facetValueKey(value))),
                  ].filter((value) => {
                    const valueKey = facetValueKey(value);
                    if (checkedValueKeys.has(valueKey)) return true;
                    const countQuery = distinctCountQueryFor(queryTree, "value", value.uri, widget.uri, value);
                    return facetCandidateCounts[countQuery] !== 0;
                  });
                  const pageCount = Math.max(
                    1,
                    Math.ceil(orderedValues.length / FACET_PAGE_SIZE),
                  );
                  const page = Math.min(widget.page, pageCount - 1);
                  const pageValues = orderedValues.slice(
                    page * FACET_PAGE_SIZE,
                    (page + 1) * FACET_PAGE_SIZE,
                  );
                  return (
                    <>
                      {widget.values.length > FACET_PAGE_SIZE && (
                        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs">
                          <button
                            type="button"
                            className="rounded px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() =>
                              setPersonalWidgets((current) =>
                                current.map((item) =>
                                  item.uri === widget.uri
                                    ? { ...item, page: Math.max(0, page - 1) }
                                    : item,
                                ),
                              )
                            }
                            disabled={page === 0}
                          >
                            Previous
                          </button>
                          <span className="text-muted-foreground">
                            {page + 1}/{pageCount}
                          </span>
                          <button
                            type="button"
                            className="rounded px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={(event) => {
                              // Keep pagination from shifting the left pane when the
                              // newly rendered page changes the browser's scroll anchor.
                              const scrollContainer = event.currentTarget.closest(
                                ".overflow-y-auto",
                              ) as HTMLElement | null;
                              const scrollTop = scrollContainer?.scrollTop ?? 0;
                              setPersonalWidgets((current) =>
                                current.map((item) =>
                                  item.uri === widget.uri
                                    ? {
                                        ...item,
                                        page: Math.min(pageCount - 1, page + 1),
                                      }
                                    : item,
                                ),
                              );
                              requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                  if (scrollContainer) scrollContainer.scrollTop = scrollTop;
                                });
                              });
                            }}
                            disabled={page >= pageCount - 1}
                          >
                            Next
                          </button>
                        </div>
                      )}
                      <div className="space-y-1">
                        {pageValues.map((value, valueIndex) => {
                          const countQuery = distinctCountQueryFor(queryTree, "value", value.uri, widget.uri, value);
                          const isZeroCount = facetCandidateCounts[countQuery] === 0;
                          const valueInputId = `personal-facet-value-${personalWidgets.indexOf(widget)}-${valueIndex}`;
                          const valueLabel = value.termType === "uri" ? toLabel(value.uri) : value.title || value.uri;
                          return (
                          <div
                            key={`${facetValueKey(value)}-${valueIndex}`}
                            className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 ${isGroupByFacet ? "" : "cursor-pointer"}`}
                          >
                            <input
                              id={valueInputId}
                              type="checkbox"
                              name={`property-value-${widget.uri}`}
                              value={value.uri}
                              checked={checkedValueKeys.has(facetValueKey(value))}
                              onChange={(event) => {
                                const binding = groupValueBinding(value);
                                setPropertyValue(
                                  activeLeafId,
                                  widget.uri,
                                  { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) },
                                  event.currentTarget.checked,
                                );
                              }}
                              aria-label={`Bind ${toLabel(widget.uri)} to ${value.termType === "uri" ? toLabel(value.uri) : value.title || value.uri}`}
                              className="mt-0.5 size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                              aria-invalid={isZeroCount ? true : undefined}
                            />
                            {isGroupByFacet ? (
                              <button
                                type="button"
                                onClick={() => scrollToGroupForFacetValue(value)}
                                className={`min-w-0 flex-1 cursor-pointer break-words text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isZeroCount ? "text-destructive" : ""}`}
                                title={`Scroll to group ${valueLabel}`}
                              >{valueLabel}</button>
                            ) : (
                              <label htmlFor={valueInputId} className={`min-w-0 flex-1 break-words cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}>
                                {valueLabel}
                              </label>
                            )}
                            <DistinctCount
                              tree={queryTree}
                              kind="value"
                              uri={value.uri}
                              propertyUri={widget.uri}
                              candidateValue={value}
                              onCountChange={(query, count) =>
                                setFacetCandidateCounts((current) =>
                                  current[query] === count ? current : { ...current, [query]: count },
                                )
                              }
                            />
                          </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
            </div>
          </article>
          );
        })}
      </div>
    );
  }

  return (
    <main className="flex h-dvh min-h-[500px] flex-col bg-background text-foreground">
      {isCheckingEndpoints && (
        <div className="fixed inset-x-0 top-0 z-[100] h-1.5 bg-muted" role="status" aria-label="Checking FCT endpoints">
          <Progress className="h-full rounded-none bg-muted" value={endpointChecksTotal > 0 ? (endpointChecksCompleted / endpointChecksTotal) * 100 : 0} indeterminate={endpointChecksTotal === 0 || endpointChecksCompleted === 0} aria-label="FCT endpoint check progress" />
        </div>
      )}
      {personalWidgets.map((widget) => (
        <PersonalWidgetQueryListener
          key={widget.uri}
          propertyUri={widget.uri}
          setPersonalWidgets={setPersonalWidgets}
        />
      ))}

      <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <label htmlFor="maestro-graph-input" className="shrink-0 text-sm font-medium">Datasite:</label>
          <div className="flex min-w-0 max-w-3xl flex-1 items-stretch overflow-hidden rounded-md border border-input bg-background">
            <input
              id="maestro-graph-input"
              value={graphText}
              onChange={(event) => setGraphText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") applyGraphText(); }}
              placeholder="Enter keywords or site URI"
              aria-label="Site URI"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
            />
            <Tooltip>
              <TooltipTrigger render={
                <Toggle
                  type="button"
                  pressed={findEndpointsEnabled}
                  onPressedChange={setFindEndpointsEnabled}
                  aria-label={findEndpointsEnabled ? "Find Data Servers On" : "Find Data Servers Off"}
                  className="shrink-0 rounded-none border-0 px-3 data-[state=on]:bg-green-100 data-[state=on]:text-green-800 data-[state=on]:hover:bg-green-200 dark:data-[state=on]:bg-green-950 dark:data-[state=on]:text-green-300 dark:data-[state=on]:hover:bg-green-900"
                ><Network aria-hidden="true" /></Toggle>
              } />
              <TooltipContent>{findEndpointsEnabled ? "Find Data Servers On" : "Find Data Servers Off"}</TooltipContent>
            </Tooltip>
          </div>
          <button
              type="button"
              onClick={clearGraph}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              title="Clear graph field and query graph"
            >Clear</button>
          <button
              type="button"
              onClick={applyGraphText}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >Go</button>
              <div className="ml-8 flex min-w-0 flex-wrap items-center gap-2">
                <Label htmlFor="fct-endpoint" className="shrink-0 text-sm font-medium">Data server:</Label>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <ButtonGroup aria-label="Data server selection and refresh" className="max-w-full [&>select]:min-w-0 [&>select]:flex-1 [&>select]:rounded-none [&>select]:border-0 [&>select]:bg-background [&>select]:px-2 [&>select]:py-2 [&>select]:text-sm">
                    <select
                      id="fct-endpoint"
                      value={selectedEndpointId}
                      onChange={(event) => void chooseFctEndpoint(event.currentTarget.value)}
                      className="w-80 max-w-full"
                      title="Choose which FCT endpoint receives queries"
                    >
                      {fctEndpoints.length === 0 && (
                        <option value="">
                          {isCheckingEndpoints ? "Loading endpoints and checking servers…" : "No endpoints configured"}
                        </option>
                      )}
                      {[...new Set(fctEndpoints.map((endpoint) => endpoint.group || "Endpoints"))].map((group) => (
                        <optgroup key={group} label={group}>
                          {fctEndpoints.filter((endpoint) => (endpoint.group || "Endpoints") === group).map((endpoint) => {
                            const status = endpointStatuses[endpoint.id];
                            const mark =
                              status?.status === 200 ? "🟢 " :
                              status?.state === "server-error" ? "🔴 " :
                              status && ["unreachable", "timeout"].includes(status.state) ? "🟠 " : "";
                            const statusText = status?.status != null
                              ? ` (${new URL(endpoint.url).protocol.replace(":", "").toUpperCase()} ${status.status})`
                              : status ? ` (${status.state})` : "";
                            return <option key={endpoint.id} value={endpoint.id}>{mark}{endpoint.label}{statusText}</option>;
                          })}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void checkFctEndpoints()}
                      disabled={isCheckingEndpoints || fctEndpoints.length === 0}
                      aria-label={isCheckingEndpoints ? "Checking servers" : "Check servers"}
                      className="inline-flex shrink-0 items-center justify-center px-2.5 py-2 text-sm hover:bg-accent disabled:opacity-50"
                      title={isCheckingEndpoints ? "Checking servers…" : "Check each server with a small FCT query"}
                    ><RefreshCw aria-hidden="true" className={`size-4 ${isCheckingEndpoints ? "animate-spin" : ""}`} /></button>
                  </ButtonGroup>
                  {isCheckingEndpoints && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
                      <span className="sr-only">{fctEndpoints.length === 0 ? "Loading FCT servers" : "Updating FCT servers"}</span>
                      {fctEndpoints.length === 0 ? "Loading FCT servers…" : `Updating… ${endpointChecksCompleted}/${endpointChecksTotal}`}
                    </span>
                  )}
                </div>
              </div>
        </div>
        <Tooltip>
          <TooltipTrigger render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy share link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setShareLinkCopied(true);
                  window.setTimeout(() => setShareLinkCopied(false), 1800);
                } catch {
                  setShareLinkCopied(false);
                }
              }}
            ><Link aria-hidden="true" /></Button>
          } />
          <TooltipContent>{shareLinkCopied ? "Share link copied" : "Copy share link"}</TooltipContent>
        </Tooltip>
        <Sheet open={controlsSheetOpen} onOpenChange={setControlsSheetOpen}>
          <SheetTrigger
            render={
              <Button variant="outline" className="inline-flex shrink-0 items-center gap-2" aria-label="Open controls">
                <Settings className="size-4" aria-hidden="true" />
              </Button>
            }
          />
          <SheetContent side="right" className="w-[min(92vw,28rem)] overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Maestro controls</SheetTitle>
              <SheetDescription>Query behavior, appearance, and data server settings.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-4">
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <Label>Appearance</Label>
                <ThemeToggle />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label>Auto-configure</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Clear learned facet usage and saved candidates.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      window.localStorage.removeItem(FACET_ADD_COUNTS_STORAGE_KEY);
                      window.localStorage.removeItem(FACET_AUTOFILL_STORAGE_KEY);
                      window.localStorage.removeItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY);
                      setAutoConfiguredFacetKeys(new Set());
                      setFacetAutofillCandidates({ property: [], "property-in": [] });
                      setFacetUsageRevision((revision) => revision + 1);
                      setAutoResetMessage("Auto-configure was reset.");
                    } catch {
                      setAutoResetMessage("Auto-configure could not be reset because browser storage is unavailable.");
                    }
                  }}
                  className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  title="Reset Auto-configure learning history and saved candidates"
                >Reset Auto</button>
              </div>
              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="fct-query-timeout">Query timeout</Label>
                  <output htmlFor="fct-query-timeout" className="text-sm tabular-nums">{timeoutSeconds}s</output>
                </div>
                <Slider
                  id="fct-query-timeout"
                  aria-label="Query timeout in seconds"
                  min={0}
                  max={60}
                  step={1}
                  value={[timeoutSeconds]}
                  onValueChange={(values) => setTimeoutSeconds(values[0] ?? 0)}
                  onValueCommit={(values) => setQueryAttribute("timeout", String((values[0] ?? 0) * 1000))}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label htmlFor="fct-query-same-as">Aliases</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Include owl:sameAs relationships.</p>
                </div>
                <Switch
                  id="fct-query-same-as"
                  checked={queryTree.attributes["same-as"] === "yes"}
                  onCheckedChange={(checked) => setQueryAttribute("same-as", checked ? "yes" : "no")}
                  aria-label="Include owl:sameAs relationships"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsRdfLoaderOpen(true);
                  setRdfLoadMessage("");
                  setRdfLoadError(false);
                  setControlsSheetOpen(false);
                }}
                className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
              >RDF Loader</button>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {autoResetMessage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="auto-reset-dialog-title"
            className="w-full max-w-md rounded-xl border bg-background p-6 text-foreground shadow-xl"
          >
            <h2 id="auto-reset-dialog-title" className="text-base font-semibold">
              Auto-configure
            </h2>
            <p className="mt-3 text-sm text-muted-foreground" role="status" aria-live="polite">
              {autoResetMessage}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setAutoResetMessage("")}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {isRdfLoaderOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rdf-loader-title"
        >
          <section className="w-full max-w-xl rounded-xl border bg-background p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="rdf-loader-title" className="text-lg font-semibold">
                  RDF Loader
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Load RDF from a direct HTTP(S) URL into your local Virtuoso
                  database.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRdfLoaderOpen(false)}
                disabled={isRdfLoading}
                className="rounded-md border px-2 py-1 text-sm disabled:opacity-50 cursor-pointer"
              >
                Close
              </button>
            </div>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setIsRdfLoading(true);
                setRdfLoadMessage("");
                setRdfLoadError(false);
                try {
                  const response = await fetch("/proxy/api/rdf-loader", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...proxyDebugHeaders("rdf-loader", "RdfLoader") },
                    body: JSON.stringify({
                      sourceUrl: rdfSourceUrl.trim(),
                      targetGraph: rdfTargetGraph.trim(),
                    }),
                  });
                  const data = await response.json();
        rememberShortforms(data?.shortforms);
                  if (!response.ok)
                    throw new Error(data.error || "RDF load failed.");
                  setRdfLoadMessage(data.message || "RDF load completed.");
                } catch (error) {
                  setRdfLoadError(true);
                  setRdfLoadMessage(
                    error instanceof Error ? error.message : "RDF load failed.",
                  );
                } finally {
                  setIsRdfLoading(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="rdf-source-url"
                  className="mb-1 block text-sm font-medium"
                >
                  RDF source URL
                </label>
                <input
                  id="rdf-source-url"
                  type="url"
                  required
                  value={rdfSourceUrl}
                  onChange={(event) =>
                    setRdfSourceUrl(event.currentTarget.value)
                  }
                  placeholder="https://example.org/data.ttl"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Use a direct link to an RDF document, not a dataset landing
                  page. Start with a small Turtle, RDF/XML, or N-Triples file.
                </p>
              </div>
              <div>
                <label
                  htmlFor="rdf-target-graph"
                  className="mb-1 block text-sm font-medium"
                >
                  Target graph IRI
                </label>
                <input
                  id="rdf-target-graph"
                  type="url"
                  required
                  value={rdfTargetGraph}
                  onChange={(event) =>
                    setRdfTargetGraph(event.currentTarget.value)
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Loaded triples will be placed in this named graph.
                </p>
              </div>
              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                This first version runs Virtuoso&apos;s <code>LOAD</code>{" "}
                command on the local server. It does not show byte-level
                progress and is not intended for multi-gigabyte dumps.
              </div>
              {rdfLoadMessage && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`rounded-md border p-3 text-sm ${rdfLoadError ? "border-destructive text-destructive" : "border-emerald-600 text-emerald-700 dark:text-emerald-400"}`}
                >
                  {rdfLoadMessage}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRdfLoaderOpen(false)}
                  disabled={isRdfLoading}
                  className="rounded-md border px-3 py-2 text-sm disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isRdfLoading ||
                    !rdfSourceUrl.trim() ||
                    !rdfTargetGraph.trim()
                  }
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRdfLoading ? "Loading RDF…" : "Load RDF"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {endpointMenuError && (
        <p role="alert" className="border-b px-4 py-1.5 text-xs text-destructive">
          {endpointMenuError}
        </p>
      )}

      <div className="shrink-0">
        <div role="tablist" aria-label="Query pane" className="flex shrink-0 gap-1 border-b px-2 pt-2">
          <button type="button" role="tab" aria-selected="true" className="-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground">Query</button>
          <button type="button" role="tab" aria-selected="false" disabled aria-disabled="true" title="Coming soon" className="-mb-px cursor-not-allowed px-3 py-2 text-sm font-medium text-muted-foreground opacity-50">View</button>
          <button type="button" role="tab" aria-selected="false" disabled aria-disabled="true" title="Coming soon" className="-mb-px cursor-not-allowed px-3 py-2 text-sm font-medium text-muted-foreground opacity-50">Build</button>
          <button type="button" role="tab" aria-selected="false" disabled aria-disabled="true" title="Coming soon" className="-mb-px cursor-not-allowed px-3 py-2 text-sm font-medium text-muted-foreground opacity-50">Publish</button>
        </div>
        <nav aria-label="Navigation breadcrumbs" className="flex min-h-14 flex-wrap items-center gap-2 bg-background px-4 py-2">
        <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setDefaultLeftTab("personal"); navigateToPropertyPath("query-root"); }}
          className={`relative cursor-pointer rounded-md border px-2.5 pb-1.5 pt-4 text-sm ${getPropertyPath().length === 0 ? "border-primary bg-accent font-medium" : "bg-background hover:bg-accent"}`}
          title={`Return to the top-level query view${classBreadcrumbLabels(null).length ? ` · Classes: ${classBreadcrumbLabels(null).join(", ")}` : ""}`}
        >
          {classBreadcrumbLabels(null).length > 0 && (
            <span className="absolute left-1 top-0 max-w-[calc(100%-8px)] truncate text-left text-[9px] font-normal leading-3 text-muted-foreground" aria-label={`Classes: ${classBreadcrumbLabels(null).join(", ")}`}>
              {classBreadcrumbLabels(null).join(", ")}
            </span>
          )}
          {search ? `"${search}"` : "query"}
        </button>

        </span>
        {displayedBreadcrumbPath.map((crumb, index) => {
  const isInactiveSuffix = index > activeBreadcrumbIndex;
          const breadcrumbClasses = classBreadcrumbLabels(crumb.id);
          const breadcrumbNode = findQueryNode(queryTree.children, crumb.id);
          const breadcrumbBaseLabel = toLabel(crumb.uri) + ((crumb.name === "property-of" || crumb.id.startsWith("role-filter-")) ? " of" : "");
          const breadcrumbExcluded = breadcrumbNode?.attributes.exclude?.trim().toLowerCase() === "yes";
          const breadcrumbLabel = breadcrumbExcluded ? `Excluded: ${breadcrumbBaseLabel}` : breadcrumbBaseLabel;
          const breadcrumbSiblings = getBreadcrumbSiblings(crumb.id);
          return (
            <span key={crumb.id} className="flex items-center gap-1">
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              <ButtonGroup aria-label={`Controls for ${breadcrumbLabel}`} className="[&>*+*]:!border-l-0">
                <button
                  type="button"
                  onClick={() => { setDefaultLeftTab("personal"); navigateToPropertyPath(crumb.id); }}
                  className={`relative cursor-pointer rounded-none border-0 px-2.5 pb-1.5 pt-4 text-sm hover:bg-accent ${
  index === activeBreadcrumbIndex
    ? "bg-accent font-medium text-foreground"
    : isInactiveSuffix
      ? "bg-background text-muted-foreground"
      : "bg-background text-foreground"
}`}
                  title={`Navigate to ${crumb.uri}${breadcrumbClasses.length ? ` · Classes: ${breadcrumbClasses.join(", ")}` : ""}`}
                  aria-current={
  index === activeBreadcrumbIndex ? "location" : undefined
}
                >
                  {breadcrumbClasses.length > 0 && (
                    <span className="absolute left-1 top-0 max-w-[calc(100%-8px)] truncate text-left text-[9px] font-normal leading-3 text-muted-foreground" aria-label={`Classes: ${breadcrumbClasses.join(", ")}`}>
                      {breadcrumbClasses.join(", ")}
                    </span>
                  )}
                  {breadcrumbExcluded && <CircleSlash className="mr-1 inline size-3.5" aria-label="Excluded" />}
                  {breadcrumbBaseLabel}
                </button>
                <button
                  type="button"
                  onClick={() => popBreadcrumbNode(crumb)}
                  className="flex h-auto min-h-full w-7 shrink-0 self-stretch items-center justify-center rounded-none border-0 py-0 text-base leading-none text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Pop ${breadcrumbLabel} from the breadcrumb stack`}
                  title="Pop this relationship and its descendants; preserve a sibling when available"
                >
                  −
                </button>
                {breadcrumbSiblings.length > 0 && (
                  <>
                    <span aria-hidden="true" className="my-1 w-px shrink-0 self-stretch bg-border" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Choose a sibling for ${compactIri(crumb.uri)}`}
                          title="Choose a sibling relationship"
                          className={`flex h-auto min-h-10 w-8 shrink-0 self-stretch items-center justify-center rounded-none border-0 bg-background p-0 ${
  isInactiveSuffix ? "text-muted-foreground" : "text-foreground"
} outline-none hover:bg-accent focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=open]:bg-accent`}
                        >
                          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 6 4 4 4-4" /></svg>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        {breadcrumbSiblings.map((sibling) => (
                          <DropdownMenuItem
                            key={sibling.id}
                            onSelect={() => moveViewToSibling(crumb.id, sibling.id)}
                          >
                            {sibling.attributes.exclude?.trim().toLowerCase() === "yes" && <CircleSlash className="mr-2 inline size-3.5" aria-label="Excluded" />}
                            {breadcrumbSiblingLabel(sibling)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </ButtonGroup>
            </span>
          );
        })}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

          <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
            <ResizablePanel defaultSize={25} minSize={16} className="min-w-0">
            {/* Left pane navigation uses count links while retaining the existing panes. */}
            <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r">
              <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-sm whitespace-nowrap">
                {defaultLeftTab === "facets" ? (
                  <>
                    <ButtonGroup aria-label="Return to facets">
                      <button type="button" onClick={() => setDefaultLeftTab("personal")} className="px-2 text-xs font-medium hover:bg-accent">Return to Facets</button>
                      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                      <button
                        type="button"
                        onClick={() => setDefaultLeftTab("personal")}
                        className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent"
                        aria-label={`Show Filters, ${personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)} facets`}
                        title="Show Filters"
                      >
                        {personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)}
                      </button>
                    </ButtonGroup>
                  </>
                ) : (
                  <>
                    {propertyFacets.length > 0 && (
                      <ButtonGroup aria-label="Configure properties">
                        <button type="button" onClick={() => { setFocusListOrder("Properties"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="px-2 text-xs font-medium hover:bg-accent">Configure Properties</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <button
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Properties");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Show Focus properties, ${propertyFacets.length} properties`}
                          title="Show Focus properties first"
                        >{propertyFacets.length}</button>
                      </ButtonGroup>
                    )}
                    {roleFacets.length > 0 && (
                      <ButtonGroup aria-label="Configure roles">
                        <button type="button" onClick={() => { setFocusListOrder("Roles"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="px-2 text-xs font-medium hover:bg-accent">Configure Roles</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <button
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Roles");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Show Focus roles, ${roleFacets.length} roles`}
                          title="Show Focus roles first"
                        >{roleFacets.length}</button>
                      </ButtonGroup>
                    )}
                    {(isLoadingProperties && propertyFacets.length === 0) ||
                    (isLoadingRoles && roleFacets.length === 0) ? (
                      <span role="status" aria-live="polite" className="px-2 text-xs text-muted-foreground">
                        Fetching configure controls…
                      </span>
                    ) : null}
                    {autoConfigureFacetCount > 0 && (
                      <ButtonGroup aria-label="Auto-configure facets">
                        <button
                          type="button"
                          onClick={() => {
                            for (const uri of facetAutofillCandidates.property) {
                              if (!selectedProperties.has(uri)) {
                                handlePropertyCheckboxChange(uri, true, false);
                                setAutoConfiguredFacet("property", uri, true);
                              }
                            }
                            for (const uri of facetAutofillCandidates["property-in"]) {
                              if (!selectedRoles.has(uri)) {
                                handleRoleCheckboxChange(uri, true, false);
                                setAutoConfiguredFacet("property-in", uri, true);
                              }
                            }
                          }}
                          className="px-2 text-xs font-medium hover:bg-accent"
                          title="Add high-frequency Properties and Roles that apply to the current query scope"
                        >Auto-configure</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <button
                          type="button"
                          onClick={() => {
                            for (const uri of facetAutofillCandidates.property) {
                              if (!selectedProperties.has(uri)) {
                                handlePropertyCheckboxChange(uri, true, false);
                                setAutoConfiguredFacet("property", uri, true);
                              }
                            }
                            for (const uri of facetAutofillCandidates["property-in"]) {
                              if (!selectedRoles.has(uri)) {
                                handleRoleCheckboxChange(uri, true, false);
                                setAutoConfiguredFacet("property-in", uri, true);
                              }
                            }
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Auto-configure ${autoConfigureFacetCount} facets`}
                          title={`${autoConfigureFacetCount} facets will be added`}
                        >{autoConfigureFacetCount}</button>
                      </ButtonGroup>
                    )}
                  </>
                )}
              </div>
              <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${defaultLeftTab === "facets" ? "bg-sky-50/70 dark:bg-sky-950/20" : "bg-background"}`}>
                {defaultLeftTab === "facets" && (
                  <>
                    {((Object.keys(facets) as FacetName[]).filter((group) => group !== "Classes" && group !== "Graphs") as FacetName[]).sort((a, b) => {
                      const order = focusListOrder === "Properties" ? ["Properties", "Roles", "Graphs"] : ["Roles", "Properties", "Graphs"];
                      return order.indexOf(a) - order.indexOf(b);
                    }).map((group) => {
                      let items: { key: string; label: string; count: number | null }[] =
                        group === "Properties"
                          ? propertyFacets.map((item) => ({
                              key: item.uri,
                              label: toLabel(item.uri),
                              count: item.count,
                            }))
                          : group === "Classes"
                            ? classFacets.map((item) => ({
                                key: item.uri,
                                label: `${toLabel(item.uri)}s`,
                                count: item.count,
                              }))
                            : group === "Roles"
                              ? roleFacets.map((item) => ({
                                  key: item.uri,
                                  label: toLabel(item.uri),
                                  count: item.count,
                                }))
                              : group === "Graphs"
                                ? graphFacets.map((item) => ({ key: item.uri, label: toLabel(item.uri), count: item.count }))
                                : [];

                      // Keep checked Properties/Roles in a separate pane above
                      // pagination. Only unchecked items participate in paging;
                      // preserve query order for selected items and FCT order below.
                      const selectedItems =
                        group === "Properties" || group === "Roles"
                          ? Array.from(
                              group === "Properties" ? selectedProperties : selectedRoles,
                              (key) => {
                                const countKind: DistinctCountKind = group === "Properties" ? "property" : "role";
                                const countQuery = distinctCountQueryFor(queryTree, countKind, key);
                                return {
                                  key,
                                  label: items.find((item) => item.key === key)?.label ?? toLabel(key),
                                  count: facetCandidateCounts[countQuery] ?? null,
                                };
                              },
                            )
                          : [];
                      const selectedKeys = new Set(selectedItems.map((item) => item.key));
                      const unselectedItems = items.filter((item) => {
                        if (selectedKeys.has(item.key)) return false;
                        if (group !== "Properties" && group !== "Roles") return true;
                        const countKind: DistinctCountKind = group === "Properties" ? "property" : "role";
                        const countQuery = distinctCountQueryFor(queryTree, countKind, item.key);
                        return facetCandidateCounts[countQuery] !== 0;
                      });

                      const currentPage =
                        group === "Properties"
                          ? propertiesPage
                          : group === "Classes"
                            ? classesPage
                            : group === "Graphs"
                              ? graphsPage
                              : rolesPage;
                      const pageCount = Math.max(
                        1,
                        Math.ceil(
                          (group === "Properties" || group === "Roles"
                            ? unselectedItems.length
                            : items.length) / FACET_PAGE_SIZE,
                        ),
                      );
                      const pageItems =
                        group === "Properties" || group === "Roles"
                          ? unselectedItems.slice(
                              currentPage * FACET_PAGE_SIZE,
                              (currentPage + 1) * FACET_PAGE_SIZE,
                            )
                          : group === "Classes" || group === "Graphs"
                            ? items.slice(
                                currentPage * FACET_PAGE_SIZE,
                                (currentPage + 1) * FACET_PAGE_SIZE,
                              )
                            : items;
                      const setPage =
                        group === "Properties"
                          ? setPropertiesPage
                          : group === "Classes"
                            ? setClassesPage
                            : group === "Graphs"
                              ? setGraphsPage
                              : setRolesPage;

                      if ((group === "Properties" || group === "Roles") && items.length === 0) return null;

                      return (
                        <section key={group} className="mb-5">
                          <div className={`group/header mb-2 flex w-full items-center gap-1 border-b ${group === "Properties" || group === "Roles" ? "bg-sky-800 dark:bg-sky-950" : ""}`}>
                            <button
                              className={`flex min-w-0 items-center px-3 py-2 text-left text-sm font-medium ${
                                group === "Properties" || group === "Roles"
                                  ? "bg-sky-800 text-sky-50 dark:bg-sky-950 dark:text-sky-100"
                                  : selectedFacet === group
                                    ? "text-primary"
                                    : "text-foreground"
                              }`}
                              onClick={() => setSelectedFacet(group)}
                            >
                              <span className="truncate">{group}</span>
                            </button>
                            {group === "Properties" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml("properties")}\n<!-- FCT API option: view=properties -->`}
                                filename="properties-fct-query.xml"
                                label="View Properties widget query"
                                headerTone
                                countQuery={propertyFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "property", propertyFacets[0].uri, undefined, undefined, "properties")) : undefined}
                                countFilename="properties-first-item-count.sparql"
                              />
                            )}
                            {group === "Roles" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml("properties-in")}\n<!-- FCT API option: view=properties-in -->`}
                                filename="roles-fct-query.xml"
                                label="View Roles widget query"
                                headerTone
                                countQuery={roleFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "role", roleFacets[0].uri, undefined, undefined, "properties-in")) : undefined}
                                countFilename="roles-first-item-count.sparql"
                              />
                            )}
                            <span
                              className={`ml-auto shrink-0 px-2 text-xs font-normal ${(group === "Properties" && propertyFacetError) || (group === "Classes" && classFacetError) || (group === "Roles" && roleFacetError) ? "text-destructive" : group === "Properties" || group === "Roles" ? "text-sky-100/80 dark:text-sky-200/80" : "text-muted-foreground"}`}
                              aria-live="polite"
                              title={group === "Properties" ? propertyFacetError : group === "Classes" ? classFacetError : group === "Roles" ? roleFacetError : undefined}
                            >
                              {(group === "Properties" && isLoadingProperties) || (group === "Classes" && isLoadingClasses) || (group === "Roles" && isLoadingRoles)
                                ? "Updating…"
                                : (group === "Properties" && propertyFacetError) || (group === "Classes" && classFacetError) || (group === "Roles" && roleFacetError)
                                  ? "Update failed"
                                  : group === "Properties" ? propertyFacets.length : group === "Classes" ? classFacets.length : group === "Roles" ? roleFacets.length : items.length}
                            </span>
                          </div>

                          {(group === "Properties" || group === "Roles") &&
                            selectedItems.length > 0 && (
                              <div className="mb-2 rounded-md border border-border/70 bg-background/80 p-2">
                                <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">Selected</div>
                                <div className="space-y-1">
                                  {selectedItems.map((item) => (
                                    <div
                                      key={item.key}
                                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                                    >
                                      <input
                                        type="checkbox"
                                        checked
                                        data-excluded={isFacetExcluded(group, item.key) ? "true" : undefined}
                                        aria-invalid={item.count === 0 ? true : undefined}
                                        onClick={(event) => {
                                          if (event.shiftKey) {
                                            event.preventDefault();
                                            handleFacetShiftClick(group, item.key, true);
                                          }
                                        }}
                                        onChange={(event) => {
                                          if (group === "Properties") {
                                            handlePropertyCheckboxChange(item.key, event.currentTarget.checked);
                                          } else {
                                            handleRoleCheckboxChange(item.key, event.currentTarget.checked);
                                          }
                                        }}
                                        aria-label={`Unselect ${item.label}`}
                                        className={isFacetExcluded(group, item.key)
                                          ? "relative size-4 shrink-0 appearance-none rounded-[3px] border border-black bg-white checked:border-black checked:bg-black checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-[14px] checked:after:font-bold checked:after:leading-none checked:after:text-white checked:after:content-['×'] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:!border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:!border-destructive/50 dark:aria-invalid:ring-destructive/40"
                                          : "size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"}
                                      />
                                      {group === "Properties" ? (
                                        <button
                                          type="button"
                                          className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${item.count === 0 ? "text-destructive" : ""}`}
                                          onClick={() => navigateIntoRelationship(item.key, "forward")}
                                          title={`Drill down through ${item.label}`}
                                        >
                                          {item.label}
                                          {autoConfiguredFacetKeys.has(`property::${item.key}`) && (
                                            <Bot className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                          )}
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${item.count === 0 ? "text-destructive" : ""}`}
                                          onClick={() => navigateIntoRelationship(item.key, "reverse")}
                                          title={`Filter by role ${item.label}`}
                                        >
                                          {item.label}
                                          {autoConfiguredFacetKeys.has(`property-in::${item.key}`) && (
                                            <Bot className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                          )}
                                        </button>
                                      )}
                                      <DistinctCount
                                        tree={queryTree}
                                        kind={group === "Properties" ? "property" : "role"}
                                        uri={item.key}
                                        onCountChange={(countQuery, count) =>
                                          setFacetCandidateCounts((current) =>
                                            current[countQuery] === count ? current : { ...current, [countQuery]: count },
                                          )
                                        }
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                          {(group === "Properties" ||
                            group === "Classes" ||
                            group === "Roles") &&
                            (group === "Properties" || group === "Roles" ? unselectedItems.length : items.length) > FACET_PAGE_SIZE && (
                              <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs">
                                <button
                                  type="button"
                                  className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() =>
                                    setPage((page) => Math.max(0, page - 1))
                                  }
                                  disabled={currentPage === 0}
                                >
                                  Previous
                                </button>
                                <span className="text-muted-foreground">
                                  Page {Math.min(currentPage + 1, pageCount)} of{" "}
                                  {pageCount}
                                </span>
                                <button
                                  type="button"
                                  className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() =>
                                    setPage((page) =>
                                      Math.min(pageCount - 1, page + 1),
                                    )
                                  }
                                  disabled={currentPage >= pageCount - 1}
                                >
                                  Next
                                </button>
                              </div>
                            )}

                          <div className="space-y-1">
                            {pageItems.map((item) => {
                              const countKind: DistinctCountKind | null =
                                group === "Properties" ? "property" : group === "Roles" ? "role" : group === "Classes" ? "class" : null;
                              const countQuery = countKind ? distinctCountQueryFor(queryTree, countKind, item.key) : null;
                              const isZeroCount = countQuery ? facetCandidateCounts[countQuery] === 0 : item.count === 0;
                              const isExcluded = group === "Properties" || group === "Classes" || group === "Roles"
                                ? isFacetExcluded(group, item.key)
                                : false;
                              return (
                              <div
                                key={item.key}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                              >
                                {group === "Graphs" ? (
                                  <input
                                    type="radio"
                                    name="maestro-query-graph"
                                    checked={queryTree.attributes.graph === item.key}
                                    onChange={() => bindGraph(item.key)}
                                    aria-label={`Bind graph ${item.label}`}
                                    className="size-4 shrink-0 accent-current"
                                  />
                                ) : group === "Properties" ||
                                group === "Classes" ||
                                group === "Roles" ? (
                                  <input
                                    type="checkbox"
                                    aria-invalid={isZeroCount ? true : undefined}
                                    checked={
                                      group === "Properties"
                                        ? selectedProperties.has(item.key)
                                        : group === "Classes"
                                          ? selectedClasses.has(item.key)
                                          : selectedRoles.has(item.key)
                                    }
                                    data-excluded={isFacetExcluded(group as "Properties" | "Classes" | "Roles", item.key) ? "true" : undefined}
                                    onClick={(event) => {
                                      if (event.shiftKey) {
                                        event.preventDefault();
                                        const currentlySelected = group === "Properties"
                                          ? selectedProperties.has(item.key)
                                          : group === "Classes"
                                            ? selectedClasses.has(item.key)
                                            : selectedRoles.has(item.key);
                                        handleFacetShiftClick(group as "Properties" | "Classes" | "Roles", item.key, currentlySelected);
                                      }
                                    }}
                                    onChange={(event) =>
                                      group === "Properties"
                                        ? handlePropertyCheckboxChange(item.key, event.currentTarget.checked)
                                        : group === "Classes"
                                          ? toggleClass(item.key, event.currentTarget.checked)
                                          : handleRoleCheckboxChange(item.key, event.currentTarget.checked)
                                    }
                                    aria-label={`Filter by ${item.label}`}
                                    className={isExcluded
                                      ? "relative size-4 shrink-0 appearance-none rounded-[3px] border border-black bg-white checked:border-black checked:bg-black checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-[14px] checked:after:font-bold checked:after:leading-none checked:after:text-white checked:after:content-['×'] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:!border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:!border-destructive/50 dark:aria-invalid:ring-destructive/40"
                                      : "size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"}
                                  />
                                ) : null}
                                {group === "Properties" ? (
                                  <button
                                    type="button"
                                    className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}
                                    onClick={() => navigateIntoRelationship(item.key, "forward")}
                                    title={`Drill down through ${item.label}`}
                                  >
                                    {item.label}
                                  </button>
                                ) : group === "Roles" ? (
                                  <button
                                    type="button"
                                    className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}
                                    onClick={() => navigateIntoRelationship(item.key, "reverse")}
                                    title={`Filter by role ${item.label}`}
                                  >
                                    {item.label}
                                  </button>
                                ) : group === "Classes" ? (
                                  <button
                                    type="button"
                                    className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}
                                    onClick={() => {
                                      if (!selectedClasses.has(item.key)) toggleClass(item.key, true);
                                      showClassResults(item.key, activeLeafId);
                                    }}
                                    title={`Show results for class ${toLabel(item.key)}`}
                                  >
                                    {toLabel(item.key)}
                                  </button>
                                ) : group === "Graphs" ? (
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => bindGraph(item.key)}
                                    title={`Bind graph ${item.key}`}
                                  >
                                    {item.label}
                                  </button>
                                ) : (
                                  <span className="min-w-0 flex-1 break-all">{item.label}</span>
                                )}
                                {(group === "Properties" ||
                                  group === "Roles") && (
                                  <DistinctCount
                                    tree={queryTree}
                                    kind={
                                      group === "Properties" ? "property" : "role"
                                    }
                                    uri={item.key}
                                    onCountChange={(query, count) =>
                                      setFacetCandidateCounts((current) =>
                                        current[query] === count ? current : { ...current, [query]: count },
                                      )
                                    }
                                  />
                                )}
                                {group === "Classes" && (
                                  <DistinctCount
                                    tree={queryTree}
                                    kind="class"
                                    uri={item.key}
                                    onCountChange={(query, count) =>
                                      setFacetCandidateCounts((current) =>
                                        current[query] === count ? current : { ...current, [query]: count },
                                      )
                                    }
                                  />
                                )}
                              </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </>
                )}

                {defaultLeftTab === "personal" && (
                  <div className="space-y-3">
                    <article ref={categoriesWidgetRef} className={`flex min-w-0 flex-col ${isGroupByCategory ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : ""}`}>
                      <header className={`group/header flex items-start justify-between gap-2 border-b px-2 py-2 ${isGroupByCategory ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""}`}>
                        <div className="flex min-w-0 items-center gap-1">{isGroupByCategory && <UsersRound className="size-4 shrink-0" aria-label="Group by Category" />}<h2 className="text-sm font-semibold">Categories</h2><QueryInspectorButton query={`${queryWithoutPagingXml("classes")}\n<!-- FCT API option: view=classes -->`} filename="categories-fct-query.xml" countQuery={visibleClassDisplayFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "class", visibleClassDisplayFacets[0].uri, undefined, undefined, "classes")) : undefined} countFilename="categories-first-item-count.sparql" /><button
                          type="button"
                          aria-pressed={isGroupByCategory}
                          onClick={() => {
                            if (isGroupByCategory) {
                              setGroupByPropertyUri("");
                              setCentralTab("results");
                            } else {
                              setGroupByPropertyUri(`forward:${RDF_TYPE_URI}`);
                              setCentralTab("groups");
                            }
                          }}
                          className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 ${isGroupByCategory ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}
                          aria-label={isGroupByCategory ? "Stop grouping by Category" : "Group results by Category"}
                          title={isGroupByCategory ? "Stop grouping by Category" : "Group results by Category"}
                        ><UsersRound className="size-4" aria-hidden="true" /></button></div>
                        <span
                          className={`text-xs ${classFacetError ? "text-destructive" : "text-muted-foreground"}`}
                          aria-live="polite"
                          title={classFacetError || undefined}
                        >
                          {isLoadingClasses
                            ? "Updating…"
                            : classFacetError
                              ? "Update failed"
                              : visibleClassDisplayFacets.length}
                        </span>
                      </header>
                      {classFacetError ? (
                        <p className="text-xs text-destructive">{classFacetError}</p>
                      ) : visibleClassDisplayFacets.length === 0 && !isLoadingClasses ? (
                        <p className="text-xs text-muted-foreground">No classes found for this query.</p>
                      ) : (
                        <>
                          {selectedClassDisplayFacets.length > 0 && (
                            <div className="mt-2 mb-2 rounded-md border border-border/70 bg-background/80 p-2">
                              <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">Selected</div>
                              <div className="space-y-1">
                                {selectedClassDisplayFacets.map((item) => {
                                  const countQuery = distinctCountQueryFor(queryTree, "class", item.uri);
                                  const count = classCandidateCounts[countQuery] ?? null;
                                  return (
                                    <div key={item.uri} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                                      <input
                                        type="checkbox"
                                        checked
                                        data-excluded={isFacetExcluded("Classes", item.uri) ? "true" : undefined}
                                        aria-invalid={count === 0 ? true : undefined}
                                        onClick={(event) => {
                                          if (event.shiftKey) {
                                            event.preventDefault();
                                            handleFacetShiftClick("Classes", item.uri, true);
                                          }
                                        }}
                                        onChange={(event) => toggleClass(item.uri, event.currentTarget.checked)}
                                        aria-label={`Unselect category ${toLabel(item.uri)}`}
                                        className={isFacetExcluded("Classes", item.uri)
                                          ? "relative size-4 shrink-0 appearance-none rounded-[3px] border border-black bg-white checked:border-black checked:bg-black checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-[14px] checked:after:font-bold checked:after:leading-none checked:after:text-white checked:after:content-['×'] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:!border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:!border-destructive/50 dark:aria-invalid:ring-destructive/40"
                                          : "size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"}
                                      />
                                      <button
                                        type="button"
                                        className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${count === 0 ? "text-destructive" : ""}`}
                                        onClick={() => isGroupByCategory ? scrollToGroupForFacetValue({ uri: item.uri, title: toLabel(item.uri), matches: [], termType: "uri" }) : showClassResults(item.uri, activeLeafId)}
                                        title={isGroupByCategory ? `Scroll to group ${toLabel(item.uri)}` : `Show results for class ${toLabel(item.uri)}`}
                                      >
                                        {isFacetExcluded("Classes", item.uri) && <CircleSlash className="mr-1 inline size-3.5" aria-label="Excluded" />}
                                        {toLabel(item.uri)}
                                      </button>
                                      <DistinctCount
                                        tree={queryTree}
                                        kind="class"
                                        uri={item.uri}
                                        onCountChange={(query, nextCount) =>
                                          setClassCandidateCounts((current) =>
                                            current[query] === nextCount ? current : { ...current, [query]: nextCount },
                                          )
                                        }
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {unselectedClassDisplayFacets.length > FACET_PAGE_SIZE && (
                            <div className="mt-2 mb-2 flex items-center justify-between gap-2 text-xs">
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.max(0, page - 1))}
                                disabled={classesPage === 0}
                              >
                                Previous
                              </button>
                              <span className="text-muted-foreground">
                                Page {Math.min(classesPage + 1, Math.ceil(unselectedClassDisplayFacets.length / FACET_PAGE_SIZE))} of {Math.max(1, Math.ceil(unselectedClassDisplayFacets.length / FACET_PAGE_SIZE))}
                              </span>
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.min(Math.ceil(unselectedClassDisplayFacets.length / FACET_PAGE_SIZE) - 1, page + 1))}
                                disabled={classesPage >= Math.ceil(unselectedClassDisplayFacets.length / FACET_PAGE_SIZE) - 1}
                              >
                                Next
                              </button>
                            </div>
                          )}
                          <div className="space-y-1">
                            {unselectedClassDisplayFacets
                              // Selected classes are shown above; this list pages only
                              // through the remaining available categories.
                              .slice(classesPage * FACET_PAGE_SIZE, (classesPage + 1) * FACET_PAGE_SIZE)
                              .map((item) => {
                                const countQuery = distinctCountQueryFor(queryTree, "class", item.uri);
                                const isZeroCount = classCandidateCounts[countQuery] === 0;
                                return (
                                <div key={item.uri} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                                  <input
                                    type="checkbox"
                                    checked={selectedClasses.has(item.uri)}
                                    onChange={(event) => toggleClass(item.uri, event.target.checked)}
                                    aria-label={`Filter by class ${toLabel(item.uri)}`}
                                    className="size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                                    aria-invalid={isZeroCount ? true : undefined}
                                  />
                                  <button
                                    type="button"
                                    className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}
                                    onClick={() => {
                                      if (isGroupByCategory) {
                                        scrollToGroupForFacetValue({ uri: item.uri, title: toLabel(item.uri), matches: [], termType: "uri" });
                                      } else {
                                        if (!selectedClasses.has(item.uri)) toggleClass(item.uri, true);
                                        showClassResults(item.uri, activeLeafId);
                                      }
                                    }}
                                    title={isGroupByCategory ? `Scroll to group ${toLabel(item.uri)}` : `Show results for class ${toLabel(item.uri)}`}
                                  >
                                    {toLabel(item.uri)}
                                  </button>
                                  <DistinctCount
                                    tree={queryTree}
                                    kind="class"
                                    uri={item.uri}
                                    onCountChange={(query, count) =>
                                      setClassCandidateCounts((current) =>
                                        current[query] === count ? current : { ...current, [query]: count },
                                      )
                                    }
                                  />
                                </div>
                                );
                              })}
                          </div>
                        </>
                      )}
                    </article>
                    {!focusWidgetsSuppressed && activeRoleFilters.map((roleNode) => {
                      const uri = roleNode.attributes.iri ?? "";
                      const roleLabel = `${toLabel(uri)} of`;
                      const excluded = roleNode.attributes.exclude?.trim().toLowerCase() === "yes";
                      const label = `${roleLabel} `;
                      const isGroupByRole = groupByPropertyUri === `reverse:${uri}`;
                      const canGroupByRole = !excluded && groupByOptions.some((option) => option.key === `reverse:${uri}`);
                      return (
                        <article key={roleNode.id} ref={(element) => { if (element) roleWidgetCardRefs.current.set(uri, element); else roleWidgetCardRefs.current.delete(uri); }} className={`flex min-w-0 flex-col ${isGroupByRole ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : ""}`}>
                          <header className={`group/header flex items-start justify-between gap-2 border-b px-3 py-2 ${isGroupByRole ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""}`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <button
                                  type="button"
                                  className="cursor-pointer text-left text-sm font-semibold underline-offset-2 hover:underline"
                                  onClick={() => navigateToPropertyPath(roleNode.id)}
                                  title={`Navigate to role scope ${label}`}
                                >
                                  {isGroupByRole && <UsersRound className="mr-1 inline size-4 shrink-0" aria-label="Group by" />}
                                  {excluded && <CircleSlash className="mr-1 inline size-3.5" aria-label="Excluded" />}
                                  {label}
                                </button>
                                <div className="flex shrink-0 items-center gap-1">
                                  <QueryInspectorButton
                                    query={`${queryWithoutPagingXml("properties-in")}\n<!-- FCT API option: view=properties-in -->`}
                                    filename="roles-fct-query.xml"
                                    label="View Roles widget query"
                                    countQuery={buildFctCountSparql(createDistinctCountQuery(queryTree, "role", uri, undefined, undefined, "text"))}
                                    countFilename="roles-first-item-count.sparql"
                                  />
                                  {!excluded && (
                                    <button
                                      type="button"
                                      disabled={!canGroupByRole}
                                      aria-pressed={isGroupByRole}
                                      onClick={() => {
                                        if (isGroupByRole) {
                                          setGroupByPropertyUri("");
                                          setCentralTab("results");
                                        } else {
                                          setGroupByPropertyUri(`reverse:${uri}`);
                                          setCentralTab("groups");
                                        }
                                      }}
                                      className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:pointer-events-none disabled:opacity-30 ${isGroupByRole ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}
                                      aria-label={isGroupByRole ? `Stop grouping by ${roleLabel}` : `Group results by ${roleLabel}`}
                                      title={isGroupByRole ? `Stop grouping by ${roleLabel}` : canGroupByRole ? `Group results by ${roleLabel}` : "Select this role in the active query before grouping by it"}
                                    >
                                      <UsersRound className="size-4" aria-hidden="true" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                                    onClick={() => deleteNode(roleNode.id)}
                                    aria-label={`Remove role filter ${label}`}
                                    title={`Remove role filter ${roleLabel}`}
                                  >
                                    <Trash2 className="size-4" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                              <p className="mt-1 break-all text-xs text-muted-foreground" title={uri}>{uri}</p>
                            </div>
                          </header>
                          <PersonalRoleWidget tree={queryTree} roleNode={roleNode} label={label.trim()} isGroupByRole={groupedRoleUri === uri} onGroupValueClick={scrollToGroupForFacetValue} />
                        </article>
                      );
                    })}
                    {!focusWidgetsSuppressed && renderPersonalWidgetCards("column")}
                    <article className="flex min-w-0 flex-col">
                      <header className="group/header flex items-center justify-between gap-2 px-2 py-2">
                        <div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">Datasites</h2><QueryInspectorButton query={`${queryWithoutPagingXml()}\n<!-- FCT API option: graphOnly=true -->`} filename="datasites-fct-query.xml" extraQueries={[{ id: "graph-list-sparql", label: "GraphList SPARQL", query: graphListSparql || "# GraphList SPARQL will appear after the endpoint returns a query.", filename: "graph-list.sparql", language: "sparql" }]} />
                          {queryTree.attributes.graph && (
                            <button
                              type="button"
                              onClick={clearGraph}
                              className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                              aria-label="Clear graph selection"
                              title="Clear datasite selection and Datasite field"
                            ><X className="size-4" aria-hidden="true" /></button>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground" aria-live="polite">
                          {isLoadingGraphs ? "Updating…" : graphFacets.length}
                        </span>
                      </header>
                      {graphFacets.length === 0 ? (
                        <p className="px-2 text-xs text-muted-foreground">
                          {isLoadingGraphs ? "Loading datasites…" : "No registered graphs yet."}
                        </p>
                      ) : (
                        <>
                          {(graphsPage > 0 || graphHasMore) && (
                            <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs">
                              <button type="button" className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setGraphsPage((page) => Math.max(0, page - 1))} disabled={graphsPage === 0 || isLoadingGraphs}>Previous</button>
                              <span className="text-muted-foreground">Page {graphsPage + 1}</span>
                              <button type="button" className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setGraphsPage((page) => page + 1)} disabled={!graphHasMore || isLoadingGraphs}>Next</button>
                            </div>
                          )}
                          <div className="space-y-1">
                            {[...graphFacets]
                              .sort((a, b) => {
                                const selectedGraph = queryTree.attributes.graph;
                                if (a.uri === selectedGraph) return -1;
                                if (b.uri === selectedGraph) return 1;
                                return 0;
                              })
                              .map((item) => (
                              <label key={item.uri} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 cursor-pointer">
                                <input type="radio" name="maestro-query-graph-personal" checked={queryTree.attributes.graph === item.uri} onChange={() => bindGraph(item.uri)} aria-label={`Bind datasite ${toLabel(item.uri)}`} className="size-4 shrink-0 accent-current" />
                                <span className="min-w-0 flex-1 break-words">{toLabel(item.uri)}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </article>
                  </div>
                )}

                {defaultLeftTab === "community" && (
                  <div className="space-y-2">
                    <h2 className="text-sm font-semibold">Community</h2>
                    <p className="text-xs text-muted-foreground">
                      Community-shared views will appear here. This tab is a
                      placeholder for now.
                    </p>
                  </div>
                )}
              </div>
            </aside>

            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={45} minSize={25} className="min-w-0">
            <section className="flex h-full min-h-0 min-w-0 flex-col border-r">
              <div className="group/header shrink-0 border-b px-3 pb-3 pt-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
                  <span className="shrink-0 text-muted-foreground">
                    Group <strong className="font-semibold text-foreground">{isCountingResults || effectiveResultsTotalCount === null ? "…" : effectiveResultsTotalCount.toLocaleString()}</strong> results by:
                  </span>
                  <select
                    id="groups-property-select"
                    aria-label="Group results by property"
                    value={groupByPropertyUri}
                    disabled={groupByOptions.length <= 1}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setGroupByPropertyUri(value);
                      setCentralTab(value ? "groups" : "results");
                    }}
                    className="min-w-[8rem] max-w-full flex-1 rounded-md border border-input bg-background py-2 pl-3 pr-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {groupByOptions.map((option) => <option key={option.key || "none"} value={option.key}>{option.label}</option>)}
                  </select>
                  <label htmlFor="results-page-size" className="shrink-0 text-muted-foreground">in pages of</label>
                  <select
                    id="results-page-size"
                    aria-label="Results page size"
                    value={resultsPageSize}
                    disabled={isSearching}
                    onChange={(event) => {
                      const nextSize = Number(event.currentTarget.value);
                      if (!RESULTS_PAGE_SIZE_OPTIONS.some((size) => size === nextSize)) return;
                      try {
                        window.localStorage.setItem(RESULTS_PAGE_SIZE_STORAGE_KEY, String(nextSize));
                      } catch {
                        // Storage can be disabled; the current selection still applies.
                      }
                      setResultsPageSize(nextSize);
                      setResultsUiPage(0);
                      setGroupUiPage(0);
                    }}
                    className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {RESULTS_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                  <span aria-hidden="true" className="mx-1 h-6 border-l border-border" />
                  <label htmlFor="results-batch-size" className="shrink-0 text-muted-foreground">Batch size</label>
                  <select
                    id="results-batch-size"
                    aria-label="Server batch size"
                    value={centralTab === "groups" && selectedGroupByOption ? groupBatchSize : resultsBatchSize}
                    disabled={isSearching || groupValuesLoading}
                    onChange={(event) => {
                      const nextSize = Number(event.currentTarget.value);
                      if (!RESULTS_BATCH_SIZE_OPTIONS.some((size) => size === nextSize)) return;
                      if (centralTab === "groups" && selectedGroupByOption) {
                        setGroupBatchSize(nextSize);
                        setGroupBatchOffset(0);
                        setGroupUiPage(0);
                        setGroupHasMoreBatches(false);
                        setGroupValues([]);
                      } else {
                        setResultsUiPage(0);
                        setResults([]);
                        setResultsPage(nextSize, 0);
                      }
                    }}
                    className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {RESULTS_BATCH_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                  </select>
                  {selectedGroupByOption ? <><span aria-hidden="true" className="mx-1 h-6 border-l border-border" /><span className="shrink-0 text-muted-foreground">{groupValuesLoading ? "…" : `${visibleGroupValues.length} ${visibleGroupValues.length === 1 ? "group" : "groups"}`}</span></> : null}
                </div>
              </div>

              {(centralTab === "results" && effectiveResultsTotalCount !== null && effectiveResultsTotalCount > resultsPageSize || centralTab === "groups" && selectedGroupByOption && (groupValues.length > resultsPageSize || groupHasMoreBatches)) && (
                <div className="flex min-h-[42px] shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
                  <span className="text-muted-foreground" aria-live="polite">
                    {centralTab === "groups"
                      ? `Page ${groupUiPage + 1} / ${Math.max(1, Math.ceil(groupValues.length / resultsPageSize)).toLocaleString()}${groupHasMoreBatches ? "+" : ""}`
                      : `Page ${resultsUiPage + 1} / ${Math.max(1, Math.ceil((effectiveResultsTotalCount ?? 0) / resultsPageSize)).toLocaleString()}`}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-input px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => {
                        if (centralTab === "groups") setGroupUiPage((page) => Math.max(0, page - 1));
                        else changeResultsPage(-1);
                      }}
                      disabled={(centralTab === "groups" ? groupUiPage === 0 : resultsUiPage === 0) || isSearching || groupValuesLoading}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-input px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => {
                        if (centralTab === "groups") {
                          const nextPage = groupUiPage + 1;
                          setGroupUiPage(nextPage);
                          if ((nextPage + 1) * resultsPageSize > groupValues.length && groupHasMoreBatches) {
                            setGroupBatchOffset(groupValues.length);
                          }
                        } else changeResultsPage(1);
                      }}
                      disabled={isSearching || groupValuesLoading || (centralTab === "groups" ? ((groupUiPage + 1) * resultsPageSize >= groupValues.length && !groupHasMoreBatches) : resultsUiPage + 1 >= Math.ceil((effectiveResultsTotalCount ?? 0) / resultsPageSize))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
              {centralTab === "results" && (
                <div
                  id="central-panel-results"
                  role="tabpanel"
                  aria-labelledby="central-tab-results"
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                >


              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {visibleResultsPage.map((item, index) => {
                  const isExpanded = expandedUris.has(item.uri);

                  return (
                    <div
                      key={`${item.uri}-${index}`}
                      data-result-selected={selectedUri === item.uri ? "true" : "false"}
                      className={`mb-2 rounded-md border ${
                        selectedUri === item.uri
                          ? "border-primary"
                          : "border-border"
                      }`}
                    >
                      <div className="flex items-start gap-2 p-3">
                        <button
                          onClick={() => setSelectedUri(item.uri)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="block text-sm font-medium cursor-pointer">
                            {item.termType === "uri" ? toLabel(item.uri) : item.title || item.uri}
                          </span>
                          <span className="mt-1 block break-all text-xs text-muted-foreground">
                            {item.uri}
                          </span>
                          {(item.scopeValues?.length ?? 0) > 0 && (
                            <span className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected property values">
                              {item.scopeValues!.map((scopeValue) => scopeValue.values.map((term, termIndex) => {
                                const propertyLabel = toLabel(scopeValue.property);
                                const visiblePropertyLabel = scopeValue.direction === "reverse" ? `${propertyLabel} of` : propertyLabel;
                                const displayValue = term.type === "uri" ? toLabel(term.value) : term.value;
                                const label = `${visiblePropertyLabel}: ${displayValue}${term.lang ? ` @${term.lang}` : ""}${term.datatype ? `^^${term.datatype}` : ""}`;
                                return (
                                  <span
                                    key={`${scopeValue.direction}:${scopeValue.property}:${term.value}:${term.lang ?? ""}:${term.datatype ?? ""}:${termIndex}`}
                                    title={label}
                                    className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-normal text-muted-foreground"
                                  >
                                    <span className="font-medium text-foreground">{visiblePropertyLabel}</span>
                                    <span className="max-w-[240px] truncate">{displayValue}</span>
                                  </span>
                                );
                              }))}
                            </span>
                          )}
                        </button>

                        {isRootView && search.trim().length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedUris((previous) => {
                                const next = new Set(previous);

                                if (next.has(item.uri)) {
                                  next.delete(item.uri);
                                } else {
                                  next.add(item.uri);
                                }

                                return next;
                              })
                            }
                            className="shrink-0 rounded px-2 py-1 text-xs hover:bg-accent"
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "Hide" : "Matches"} ({item.matches.length})
                          </button>
                        )}
                      </div>

                      {isRootView && isExpanded && search.trim().length > 0 && (
                        <div className="border-t px-3 py-2">
                          {item.matches.map((match, index) => (
                            <div
                              key={`${item.uri}-match-${index}`}
                              className="border-b py-2 text-sm last:border-b-0"
                            >
                              {match.excerpt ? (
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: match.excerpt
                                      .replace(/&lt;b&gt;/gi, "<b>")
                                      .replace(/&lt;\/b&gt;/gi, "</b>"),
                                  }}
                                />
                              ) : (
                                "(No excerpt available)"
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {visibleResultsPage.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">
                    {searchError
                      ? "Search could not be completed."
                      : !search.trim()
                        ? "No resources returned for the initial empty-text query."
                        : isSearching
                          ? "Searching..."
                          : "No matching results."}
                  </p>
                )}
              </div>
                </div>
              )}

              {centralTab === "groups" && selectedGroupByOption && (
                <div id="central-panel-groups" role="tabpanel" aria-labelledby="central-tab-groups" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {groupByOptions.length > 0 ? (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      {groupValuesLoading ? <p className="shrink-0 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading group values from Virtuoso FCT…</p> : null}
                      {groupValuesError ? <p className="shrink-0 rounded-md border border-destructive/40 p-3 text-sm text-destructive">{groupValuesError}</p> : null}
                      {!groupValuesLoading && !groupValuesError && groupValues.length === 0 ? <p className="shrink-0 rounded-md border border-dashed p-4 text-sm text-muted-foreground">No values found for this relationship in the current scope.</p> : null}
                      <div className="min-w-0 flex-1 overflow-y-auto p-3">
                        <div className="flex flex-col gap-3">
                        {visibleGroupValues.map((groupValue) => {
                          const groupValueLabel = groupValue.termType === "uri" ? toLabel(groupValue.uri) : groupValue.title || groupValue.uri;
                          const memberKey = `${selectedGroupByOption!.key}::${groupValueKey(groupValue)}`;
                          const members = groupMembers[memberKey] ?? { results: [], loading: true, error: "" };
                          const selectedRelationshipNode = findQueryNode(queryTree.children, selectedGroupByOption!.nodeId);
                          const expectedBinding = groupValueBinding(groupValue);
                          const bound = (selectedRelationshipNode?.children ?? []).some((child) => child.name === "value" && child.text === expectedBinding.text && (child.attributes.datatype ?? "uri") === expectedBinding.datatype && (child.attributes["xml:lang"] ?? "") === (expectedBinding.lang ?? ""));
                          return <article key={memberKey} ref={(element) => { if (element) groupCardRefs.current.set(memberKey, element); else groupCardRefs.current.delete(memberKey); }} data-group-card="true" className="flex min-w-0 flex-col rounded-md border border-border">
                            <header className="group/header flex items-start gap-2 border-b border-border px-3 py-2">
                              <input type="checkbox" checked={bound} onChange={(event) => {
                                if (selectedGroupByOption!.direction === "forward") setPropertyValue(activeLeafId, selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                                else setRoleValue(selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                              }} aria-label={`Filter ${selectedGroupByOption!.label} by ${groupValueLabel}`} className="mt-0.5 size-4 shrink-0 accent-current" />
                              <div className="min-w-0 flex-1">
                                <button type="button" onClick={() => setSelectedUri(groupValue.uri)} className="block max-w-full cursor-pointer break-words text-left text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Load this group value in the Record viewer">{groupValueLabel}</button>
                                <p className="mt-0.5 break-all text-xs text-muted-foreground">{groupValue.uri}</p>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">{members.loading ? "…" : members.hasMore ? `${members.count ?? members.results.length} loaded` : `${members.count ?? members.results.length} ${(members.count ?? members.results.length) === 1 ? "item" : "items"}`}</span>
                              <QueryInspectorButton query={serializeFctQuery(createGroupMemberQuery(queryTree, selectedGroupByOption!, groupValue))} filename={`group-${groupValueLabel.replace(/[^a-z0-9_-]+/gi, "-")}.xml`} />
                            </header>
                            <div className="flex flex-col gap-1 p-2">
                              {members.error ? <p className="px-2 py-2 text-xs text-destructive">{members.error}</p> : members.loading ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading matching Results items…</p> : members.results.length > 0 ? members.results.map((item) => <button key={item.uri} type="button" onClick={() => setSelectedUri(item.uri)} className={`flex min-w-0 flex-col rounded-md px-2 py-2 text-left hover:bg-accent/50 ${selectedUri === item.uri ? "bg-accent/40" : ""}`}><span className="break-words text-sm font-medium cursor-pointer">{item.termType === "uri" ? toLabel(item.uri) : item.title || item.uri}</span><span className="mt-0.5 break-all text-xs text-muted-foreground">{item.uri}</span></button>) : <p className="px-2 py-2 text-xs text-muted-foreground">No Results items match this value.</p>}
                              {members.hasMore && !members.loading ? <button
                                type="button"
                                className="mx-2 my-1 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent"
                                onClick={() => {
                                  const option = selectedGroupByOption;
                                  if (!option || groupMemberRequestStates.current.get(memberKey) === "loading") return;
                                  const requestIdentity = groupMemberRequestIdentityRef.current;
                                  const offset = members.offset ?? members.results.length;
                                  groupMemberRequestStates.current.set(memberKey, "loading");
                                  setGroupMembers((current) => ({ ...current, [memberKey]: { ...(current[memberKey] ?? members), loading: true, error: "" } }));
                                  void (async () => {
                                    const controller = new AbortController();
                                    try {
                                      const memberTree = createGroupMemberQuery(queryTree, option, groupValue);
                                      const memberXml = serializeFctQuery(setQueryViewAttributes(memberTree, {
                                        type: "text", limit: String(resultsBatchSize), offset: String(offset),
                                      }));
                                      const response = await fetch("/proxy/api/fct", {
                                        method: "POST",
                                        cache: "no-store",
                                        headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("group-members-fct", "GroupsMembersMore") },
                                        body: memberXml,
                                        signal: controller.signal,
                                      });
                                      const data = await readFctResponse(response);
                                      if (groupMemberRequestIdentityRef.current !== requestIdentity) return;
                                      rememberShortforms(data?.shortforms);
                                      const rawResults: FctResult[] = Array.isArray(data.results) ? data.results : [];
                                      setGroupMembers((current) => {
                                        const previous = current[memberKey]?.results ?? members.results;
                                        const merged = new Map(previous.map((item) => [item.uri, item]));
                                        for (const item of rawResults) {
                                          const prior = merged.get(item.uri);
                                          merged.set(item.uri, prior ? { ...prior, ...item, matches: [...prior.matches, ...item.matches] } : { ...item, matches: [...item.matches] });
                                        }
                                        const results = Array.from(merged.values());
                                        return { ...current, [memberKey]: {
                                          results,
                                          count: results.length,
                                          loading: false,
                                          error: "",
                                          offset: offset + rawResults.length,
                                          hasMore: rawResults.length >= resultsBatchSize,
                                        } };
                                      });
                                      groupMemberRequestStates.current.set(memberKey, "loaded");
                                    } catch (error) {
                                      if (groupMemberRequestIdentityRef.current !== requestIdentity) return;
                                      groupMemberRequestStates.current.delete(memberKey);
                                      setGroupMembers((current) => ({ ...current, [memberKey]: {
                                        ...(current[memberKey] ?? members),
                                        loading: false,
                                        error: error instanceof Error ? error.message : "Failed to load more group items.",
                                      } }));
                                    }
                                  })();
                                }}
                              >{members.error ? "Retry loading items" : "Load more items"}</button> : null}
                            </div>
                          </article>;
                        })}
                        </div>
                      </div>
                    </div>
                  ) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Select a property or role in Focus, then choose it from Group by.</p>}
                </div>
              )}

              {centralTab === "query-tree" && (
                <div
                  id="central-panel-query-tree"
                  role="tabpanel"
                  aria-labelledby="central-tab-query-tree"
                  className="min-h-0 flex-1 overflow-auto p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Live query structure. Changes in Filters, Focus, navigation, and bindings appear here immediately.
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          resetQuery();
                          setSearch("");
                          setGroupByPropertyUri("");
                          setCentralTab("query-tree");
                          setSearchPipelineRun((current) => current + 1);
                        }}
                        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setCentralTab("view-query")}
                        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        View source
                      </button>
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {queryTree.children.map((node) => renderQueryNode(node))}
                  </ul>
                </div>
              )}

              {centralTab === "view-query" && (
                <div
                  id="central-panel-view-query"
                  role="tabpanel"
                  aria-labelledby="central-tab-view-query"
                  className="min-h-0 flex-1 overflow-auto p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Query source returned by the FCT endpoint.</p>
                    <ButtonGroup aria-label="Query source format">
                      <Toggle pressed={querySourceFormat === "xml"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("xml"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">XML</Toggle>
                      <Toggle pressed={querySourceFormat === "sparql"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("sparql"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">SPARQL</Toggle>
                    </ButtonGroup>
                    <button type="button" onClick={() => setCentralTab("query-tree")} className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">Back to Query</button>
                  </div>
                  <CodeBlock className="h-full min-h-0" language={querySourceFormat === "xml" ? "xml" : "sparql"} code={querySourceFormat === "xml" ? prettyQueryXml : sourceSparql} filename={querySourceFormat === "xml" ? "fct-query.xml" : "query.sparql"} />
                </div>
              )}
              <div className="group/header shrink-0 border-t bg-muted p-3">
                <div className="flex items-center gap-2">
                  <ButtonGroup aria-label="Text search controls" className="flex min-w-0 flex-1 [&>*+*]:!border-l-0">
                    <input
                      autoFocus
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search results..."
                      aria-label="Search results"
                      className="min-w-0 flex-1 rounded-none border-0 bg-background px-3 py-2 text-sm outline-none focus-visible:outline-none focus-visible:ring-0"
                    />
                    <Tooltip>
                      <TooltipTrigger render={
                        <Toggle
                          pressed={isExpandedSearch}
                          onPressedChange={(pressed) => setNodeAttribute("query-text", "property", pressed ? null : "http://www.w3.org/2000/01/rdf-schema#label")}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-none border-0 px-3 py-2 text-sm data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                          aria-label={isExpandedSearch ? "Search rdfs:label Only" : "Search All Properties"}
                        >
                          {isExpandedSearch ? (
                            <Shrink aria-hidden="true" className="size-4" />
                          ) : (
                            <Expand aria-hidden="true" className="size-4" />
                          )}
                        </Toggle>
                      } />
                      <TooltipContent>{isExpandedSearch ? "Search only rdfs:label values" : "Search all properties"}</TooltipContent>
                    </Tooltip>
                  </ButtonGroup>
                  <button
                    type="button"
                    onClick={() => {
                      // Clear the authoritative <text> node, then explicitly run
                      // the same FCT results pipeline even if it was already empty.
                      setSearch("");
                      setSearchPipelineRun((current) => current + 1);
                    }}
                    className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                    aria-label="Clear text search"
                    title="Clear text search"
                  >
                    Clear
                  </button>
                  <Toggle
                    pressed={centralTab === "query-tree" || centralTab === "view-query"}
                    onPressedChange={(pressed) => setCentralTab(pressed ? "query-tree" : (groupByPropertyUri ? "groups" : "results"))}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm data-[state=on]:border-black data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:border-black dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                    aria-label={centralTab === "query-tree" || centralTab === "view-query" ? "Query" : "Results"}
                  >
                    {centralTab === "query-tree" || centralTab === "view-query" ? <Code2 aria-hidden="true" className="size-4" /> : <List aria-hidden="true" className="size-4" />}
                    <span>{centralTab === "query-tree" || centralTab === "view-query" ? "Query" : "Results"}</span>
                  </Toggle>
                  <Toggle
                    pressed={showResultBadges}
                    onPressedChange={setShowResultBadges}
                    className="shrink-0 rounded-md border border-input px-3 py-2 text-sm data-[state=on]:border-black data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:border-black dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                    aria-label={showResultBadges ? "Badges On" : "Badges Off"}
                  >
                    <span>{showResultBadges ? "Badges On" : "Badges Off"}</span>
                  </Toggle>
                  <QueryInspectorButton query={resultsSparql ?? ""} language="sparql" filename="results-query.sparql" countQuery={resultsCountSparql} countFilename="results-count.sparql" />
                </div>
                {searchError && <p className="mt-2 text-sm text-destructive">{searchError}</p>}
              </div>
            </section>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={18} className="min-w-0">
            <section className="flex h-full min-h-0 min-w-0 flex-col">
              <div className="border-b p-4">
                <h2 className="text-base font-semibold">
                  {selectedResult?.title ?? (selectedGroupRecord ? (selectedGroupRecord.termType === "uri" ? toLabel(selectedGroupRecord.uri) : selectedGroupRecord.title || selectedGroupRecord.uri) : "Record")}
                </h2>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {selectedUri}
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
                {describedRecord.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {describedProperties.length} properties · {describedRecord.length} values
                  </span>
                ) : <span />}
                {describedProperties.length > RECORD_DESCRIPTION_PAGE_SIZE && (
  <div className="flex items-center justify-between gap-2 text-xs">
    <button
      type="button"
      className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => setRecordDescriptionPage((page) => Math.max(0, page - 1))}
      disabled={recordDescriptionPage === 0}
    >
      Previous
    </button>

    <span className="text-muted-foreground">
      Page {recordDescriptionPage + 1} of {Math.ceil(describedProperties.length / RECORD_DESCRIPTION_PAGE_SIZE)}
    </span>

    <button
      type="button"
      className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => setRecordDescriptionPage((page) =>
        Math.min(
          Math.ceil(describedProperties.length / RECORD_DESCRIPTION_PAGE_SIZE) - 1,
          page + 1,
        )
      )}
      disabled={recordDescriptionPage >= Math.ceil(describedProperties.length / RECORD_DESCRIPTION_PAGE_SIZE) - 1}
    >
      Next
    </button>
  </div>
)}
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Property</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
  {describedProperties
    .slice(
      recordDescriptionPage * RECORD_DESCRIPTION_PAGE_SIZE,
      (recordDescriptionPage + 1) * RECORD_DESCRIPTION_PAGE_SIZE,
    )
    .flatMap((item) =>
      item.values.map((value, index) => (
        <tr
          key={`${item.property}-${index}`}
          className="border-b"
        >
          {index === 0 && (
            <td
              rowSpan={item.values.length}
              className="whitespace-nowrap px-3 py-3 align-top font-medium"
            >
              {toLabel(item.property)}
            </td>
          )}
          <td className="break-all px-3 py-3 align-top">
            {value}
          </td>
        </tr>
      )),
    )}

  {describedRecord.length === 0 && (
    <tr>
      <td colSpan={2} className="px-3 py-4 text-sm text-muted-foreground">
        {isDescribing
          ? "Loading record description…"
          : selectedUri
            ? "No description data returned."
            : "Select a result to describe it."}
      </td>
    </tr>
  )}
</tbody>
                </table>
              </div>
            </section>
            </ResizablePanel>
          </ResizablePanelGroup>

      </div>
    </main>
  );
}
