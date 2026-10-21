"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rememberShortforms, toLabel } from "@/lib/uri-labels";
import { proxyDebugFingerprint, proxyDebugHeaders } from "@/lib/proxy-debug";
import { buildFctCountSparql } from "@/lib/fct-count-sparql";
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
import { Label } from "@/components/ui/label";
import { Code2, Network, Trash2, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CodeBlock } from "@/components/ui/code-block";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
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
  values: FctResult[];
  selectedValues: string[];
  page: number;
  loading: boolean;
  error: string;
};

type RelationshipDirection = "forward" | "reverse";
type ScopeRelationship = { uri: string; direction: RelationshipDirection };
type GroupByOption = ScopeRelationship & { key: string; label: string; nodeId: string; memberBindingNodeId?: string; ancestorRole?: boolean };
type GroupMembersState = { results: FctResult[]; loading: boolean; error: string };


/** Hover-only query inspector for any widget backed by an FCT or SPARQL request. */
function QueryInspectorButton({
  query,
  language = "xml",
  filename,
  label = "View query",
  countQuery,
  countFilename,
  headerTone = false,
}: {
  query: string;
  language?: "xml" | "sparql";
  filename: string;
  label?: string;
  countQuery?: string | null;
  countFilename?: string;
  headerTone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"widget" | "count">("widget");
  if (!query.trim()) return null;
  const showingCount = Boolean(countQuery?.trim()) && activeTab === "count";
  const displayedCode = showingCount ? countQuery! : query;
  const displayedFilename = showingCount ? (countFilename ?? "first-item-count.sparql").replace(/\.xml$/i, ".sparql") : filename;
  const displayedLanguage = showingCount ? "sparql" : language;
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
            {countQuery?.trim() && (
              <div role="tablist" aria-label="Widget queries" className="mb-3 flex gap-1 border-b">
                <button type="button" role="tab" aria-selected={activeTab === "widget"} onClick={() => setActiveTab("widget")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "widget" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>FCT result list</button>
                <button type="button" role="tab" aria-selected={activeTab === "count"} onClick={() => setActiveTab("count")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "count" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>Count SPARQL query</button>
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

/** Each visible item requests its own distinct-row count through the same-origin SPARQL proxy. */
function DistinctCount({
  tree,
  kind,
  uri,
  propertyUri,
  candidateValue,
}: {
  tree: FctQueryTree;
  kind: DistinctCountKind;
  uri: string;
  propertyUri?: string;
  candidateValue?: FctResult;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Key this effect by the compiled scalar count query, not the full browsing
  // query. The compiler deliberately ignores <view> limit/offset, so Results
  // pagination does not refetch every facet count.
  const countSparqlQuery = buildFctCountSparql(
    createDistinctCountQuery(tree, kind, uri, propertyUri, candidateValue, "text"),
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
        if (!cancelled) setCount(parsedCount);
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
      className={`shrink-0 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
      aria-live="polite"
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

/** Return only filter nodes owned by the active view's <properties> group.
 * Relationship/path nodes are structural scope, not filters. Filters are never
 * deduplicated by IRI: the tree mutation API must keep each filter in its one
 * authoritative scope, and consumers must not guess which same-IRI node wins.
 */
function getActiveViewPropertyFilters(tree: FctQueryTree): FctQueryNode[] {
  const view = findQueryNode(tree.children, "query-view");
  const properties = view?.children.find(
    (node) => node.name === "properties" || node.id === "query-view-properties",
  );
  return (properties?.children ?? []).filter(
    (node) =>
      node.name === "property" &&
      node.id.startsWith("property-filter-") &&
      typeof node.attributes.iri === "string",
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
  const widgetQueryXml = serializeFctQuery(createPropertyWidgetQuery(tree, propertyUri));

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
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("personal-widget-values", `PersonalWidgetQueryListener:${propertyUri}`) },
          body: JSON.stringify({
            queryXml: widgetQueryXml,
          }),
          signal: controller.signal,
        });
        const data = await response.json();
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
  } catch {
    // Browsing and filtering must continue when localStorage is unavailable.
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
  try {
    const candidates = readFacetAutofillCandidates();
    // Recompute this facet kind from the latest widget load; do not retain
    // candidates that no longer appear in the current facet results.
    candidates[kind] = Array.from(new Set(uris));
    window.localStorage.setItem(FACET_AUTOFILL_STORAGE_KEY, JSON.stringify(candidates));
    return candidates[kind];
  } catch {
    // Browsing and filtering must continue when localStorage is unavailable.
    return Array.from(new Set(uris));
  }
}

export default function Home() {
  const [selectedUri, setSelectedUri] = useState("");
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
  const [graphText, setGraphText] = useState("");
  const [findEndpointsEnabled, setFindEndpointsEnabled] = useState(false);
  const [centralTab, setCentralTab] = useState<"results" | "groups" | "query-tree" | "view-query">("results");
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
  const [focusWidgetsSuppressed, setFocusWidgetsSuppressed] = useState(false);
  const [groupByPropertyUri, setGroupByPropertyUri] = useState("");
  const [resultsUiPage, setResultsUiPage] = useState(0);
  const [groupUiPage, setGroupUiPage] = useState(0);
  const [groupBatchSize, setGroupBatchSize] = useState<number>(100);
  const [groupBatchOffset, setGroupBatchOffset] = useState(0);
  const [groupHasMoreBatches, setGroupHasMoreBatches] = useState(false);
  const FACET_PAGE_SIZE = 10;
  const [propertyFacets, setPropertyFacets] = useState<FacetItem[]>([]);
  const [classFacets, setClassFacets] = useState<FacetItem[]>([]);
  const [roleFacets, setRoleFacets] = useState<FacetItem[]>([]);
  const [graphFacets, setGraphFacets] = useState<FacetItem[]>([]);
  const [graphHasMore, setGraphHasMore] = useState(false);
  const [propertyFacetSparql, setPropertyFacetSparql] = useState("");
  const [roleFacetSparql, setRoleFacetSparql] = useState("");
  const [facetAutofillCandidates, setFacetAutofillCandidates] = useState<FacetAutofillCandidates>({ property: [], "property-in": [] });
  // localStorage mutations do not trigger React renders. This revision makes
  // facet additions observable to the Auto-configure candidate effects.
  const [facetUsageRevision, setFacetUsageRevision] = useState(0);
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
    setRoleFilter,
    setResultsPage,
    showClassResults,
    refresh: refreshQuery,
    deleteNode,
  } = useFctQuery();

  useEffect(() => {
    setGraphsPage(0);
  }, [queryTree.attributes.graph]);

  const search =
    queryTree.children.find(
      (node) => node.name === "text" && node.id === "query-text",
    )?.text ?? "";

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
        setFctEndpoints(endpoints);
        setSelectedEndpointId(savedSelection);
        setEndpointStatuses({});
        setEndpointChecksTotal(endpoints.length);
        setEndpointMenuError("");
        await runEndpointChecks(
          endpoints,
          !savedSelection,
          savedSelection,
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
        const existing = existingByUri.get(uri);
        if (existing) {
          return existing.selectedValues.length === boundValues.length &&
            existing.selectedValues.every(
              (value, index) => value === boundValues[index],
            )
            ? existing
            : { ...existing, selectedValues: boundValues };
        }
        const facet = propertyFacets.find((item) => item.uri === uri);
        return {
          uri,
          label: facet?.label || compactIri(uri),
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
  const groupByOptions: GroupByOption[] = [
    { key: "", uri: "", direction: "forward", label: "none", nodeId: "" },
    ...getActiveViewPropertyFilters(queryTree).flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri) return [];
      const facet = propertyFacets.find((item) => item.uri === uri);
      return [{ key: `forward:${uri}`, uri, direction: "forward" as const, label: facet?.label || compactIri(uri), nodeId: node.id }];
    }),
    // Only reverse-role nodes explicitly selected in Focus belong in Group By.
    // A <property-of> ancestor that merely contains the active <view> is a
    // navigation/scope breadcrumb, not a checked relationship selection.
    ...getActiveViewRoleFilters(queryTree).flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri) return [];
      const facet = roleFacets.find((item) => item.uri === uri);
      return [{ key: `reverse:${uri}`, uri, direction: "reverse" as const, label: `${facet?.label || compactIri(uri)} of`, nodeId: node.id }];
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
  const visibleGroupValues = groupValues.slice(groupUiPage * resultsPageSize, (groupUiPage + 1) * resultsPageSize);
  const [groupValuesLoading, setGroupValuesLoading] = useState(false);
  const [groupValuesError, setGroupValuesError] = useState("");
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMembersState>>({});
  const groupMemberRequestStates = useRef(new Map<string, "loading" | "loaded">());
  const sourceSparql = sparqlQuery || "# SPARQL will appear after the endpoint returns a query.";
  const queryWithoutPagingXml = serializeFctQuery(
    setQueryViewAttributes(queryTree, { offset: "0" }),
  );
  // Ask FCT for the total independently of the current results page. The
  // count view uses the same active scope and filters, but never the page offset.
  const queryCountXml = serializeFctQuery(
    setQueryViewAttributes(queryTree, { type: "text", limit: "1000", offset: "0" }),
  );

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
  const nextIdentity = `${selectedEndpointId}\u0000${queryCountXml}`;
  const previousIdentity = previousResultsQueryIdentityRef.current;

  previousResultsQueryIdentityRef.current = nextIdentity;

  // Keep the initial load; reset only when an existing query changes.
  if (!previousIdentity || previousIdentity === nextIdentity) return;

  setResultsUiPage(0);
  setResults([]);
  resultsBatchRequestPending.current = false;
  setResultsPageMatchCount(0);
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
  queryCountXml,
  selectedEndpointId,
  resultsOffset,
  resultsBatchSize,
  setResultsPage,
]);

  function clearWidgetsForViewChange() {
    setResultsUiPage(0);
    setResults([]);
    resultsBatchRequestPending.current = false;
    setResultsPageMatchCount(0);
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
  // Never display fewer total results than rows already loaded while a count refreshes.
  const effectiveResultsTotalCount = resultsTotalCount === 0 && (results.length > 0 || resultsPageMatchCount > 0)
    ? Math.max(results.length, resultsPageMatchCount)
    : resultsTotalCount;
  const [describedRecord, setDescribedRecord] = useState<{ property: string; value: string }[]>([]);
  const [recordDescriptionPage, setRecordDescriptionPage] = useState(0);
  const RECORD_DESCRIPTION_PAGE_SIZE = 20;
  const [isDescribing, setIsDescribing] = useState(false);
  const [isCountingResults, setIsCountingResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchPipelineRun, setSearchPipelineRun] = useState(0);
  const [initialBrowseTriggered, setInitialBrowseTriggered] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState(0);

  const resultsCountSparql = buildFctCountSparql(queryTree);

  useEffect(() => {
    const endpointReady = endpointReadyForQuery;
    if (!endpointReady) {
      setResultsTotalCount(null);
      setIsCountingResults(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setResultsTotalCount(null);
    setIsCountingResults(true);

    async function loadTotalCount() {
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
        if (!cancelled) setResultsTotalCount(total);
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        console.warn("SPARQL result count query failed:", error);
        setResultsTotalCount(null);
      } finally {
        if (!cancelled) setIsCountingResults(false);
      }
    }

    void loadTotalCount();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [resultsCountSparql, selectedEndpointId, endpointReadyForQuery]);

  // FCT query timeout is expressed in milliseconds in the XML. Keep the slider
  // in seconds for the UI, and sync it if the authoritative query tree changes.
  useEffect(() => {
    const timeoutMs = Number(queryTree.attributes.timeout ?? "0");
    setTimeoutSeconds(Number.isFinite(timeoutMs)
      ? Math.max(0, Math.min(60, Math.round(timeoutMs / 1000)))
      : 0);
  }, [queryTree.attributes.timeout]);

  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const hasPropertyFacetSnapshot = useRef(false);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [propertyFacetError, setPropertyFacetError] = useState("");
  const [classFacetError, setClassFacetError] = useState("");
  const [expandedUris, setExpandedUris] = useState<Set<string>>(new Set());

  useEffect(() => {
    const endpointReady = endpointReadyForQuery;
    if (!endpointReady || initialBrowseTriggered) return;

    // Kick the same query-tree/search pipeline used by the search box, with an empty string.
    // The run token guarantees a request even though the initial search text is already empty.
    setSearch("");
    setInitialBrowseTriggered(true);
    setSearchPipelineRun((current) => current + 1);
  }, [selectedEndpointId, endpointReadyForQuery, initialBrowseTriggered, setSearch]);

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
        console.info("Maestro Results search request starting", {
          queryFingerprint: proxyDebugFingerprint(queryResultsXml),
          queryXmlLength: queryResultsXml.length,
        });
        const response = await fetch("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...proxyDebugHeaders("results-search", `ResultsSearch:${proxyDebugFingerprint(queryResultsXml)}`),
          },
          body: JSON.stringify({ queryXml: queryResultsXml }),
          signal: controller.signal,
        });

        const data = await response.json();
        rememberShortforms(data?.shortforms);
        console.log("FCT API response:", data);

        if (!response.ok) {
          throw new Error(data.error ?? "Virtuoso search failed.");
        }

        if (cancelled) return;

        let nextResults: FctResult[] = Array.isArray(data.results)
          ? data.results
          : [];

        // Enrich only the resources returned by the authoritative FCT query,
        // using only checked properties/roles attached to the active view scope.
        // The API constructs a bounded VALUES query from these inputs, so a
        // breadcrumb's unrelated filters and the rest of the store are excluded.
        const selectedForward = getActiveViewPropertyFilters(queryTree)
          .map((node) => node.attributes.iri)
          .filter((iri): iri is string => typeof iri === "string" && Boolean(iri));
        const selectedReverse = getActiveViewRoleFilters(queryTree)
          .map((node) => node.attributes.iri)
          .filter((iri): iri is string => typeof iri === "string" && Boolean(iri));
        const resourceUris = [...new Set(nextResults.map((item) => item.uri).filter(Boolean))];
        console.info("Maestro Results enrichment inputs", {
          queryFingerprint: proxyDebugFingerprint(queryResultsXml),
          resourceCount: resourceUris.length,
          propertyCount: new Set(selectedForward).size,
          roleCount: new Set(selectedReverse).size,
          firstResource: resourceUris[0] ?? null,
        });
        const relationships: ScopeValue[] = [
          ...[...new Set(selectedForward)].map((property) => ({
            property,
            label: propertyFacets.find((facet) => facet.uri === property)?.label || compactIri(property),
            direction: "forward" as const,
            values: [{ value: "-" }],
          })),
          ...[...new Set(selectedReverse)].map((property) => ({
            property,
            label: roleFacets.find((facet) => facet.uri === property)?.label || compactIri(property),
            direction: "reverse" as const,
            values: [{ value: "-" }],
          })),
        ];
        // Render the selected relationship labels immediately, even when the
        // SPARQL protocol endpoint is unavailable. Missing values use a dash.
        nextResults = nextResults.map((item) => ({
          ...item,
          scopeValues: relationships.map((relationship) => ({
            ...relationship,
            values: relationship.values.map((value) => ({ ...value })),
          })),
        }));

        try {
          if (resourceUris.length && (selectedForward.length || selectedReverse.length)) {
            const enrichmentResponse = await fetch("/proxy/api/sparql", {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json", ...proxyDebugHeaders("results-enrichment", `ResultsEnrichment:${proxyDebugFingerprint(queryResultsXml)}`) },
              body: JSON.stringify({
                resources: resourceUris,
                properties: [...new Set(selectedForward)],
                roles: [...new Set(selectedReverse)],
              }),
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
            });
            const enrichmentData = await enrichmentResponse.json();
            if (!enrichmentResponse.ok) {
              throw new Error(enrichmentData.error ?? "Could not enrich Results items.");
            }

            const facetLabel = (iri: string, direction: RelationshipDirection) =>
              (direction === "forward" ? propertyFacets : roleFacets)
                .find((facet) => facet.uri === iri)?.label || compactIri(iri);
            const grouped = new Map<string, Map<string, ScopeValue>>();
            for (const item of nextResults) {
              const resourceGroups = new Map<string, ScopeValue>();
              for (const relationship of relationships) {
                const key = `${item.uri}\u0000${relationship.direction}\u0000${relationship.property}`;
                resourceGroups.set(key, {
                  ...relationship,
                  values: [{ value: "-" }],
                });
              }
              grouped.set(item.uri, resourceGroups);
            }
            const bindings = Array.isArray(enrichmentData.results?.bindings)
              ? enrichmentData.results.bindings
              : [];
            for (const binding of bindings) {
              const resource = binding.resource?.value;
              const property = binding.property?.value;
              const direction = binding.direction?.value === "reverse" ? "reverse" : "forward";
              const term = binding.value;
              if (typeof resource !== "string" || typeof property !== "string" ||
                  !term || typeof term.value !== "string") continue;
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
              } else if (!scopeValue.values.some((item) => item.value === nextTerm.value &&
                  item.type === nextTerm.type && item.datatype === nextTerm.datatype && item.lang === nextTerm.lang)) {
                scopeValue.values.push(nextTerm);
              }
            }
            nextResults = nextResults.map((item) => ({
              ...item,
              scopeValues: [...(grouped.get(item.uri)?.values() ?? [])],
            }));
          }
        } catch (enrichmentRequestError) {
          // Aborting this Results run is expected during query/endpoint changes;
          // do not report it as an enrichment failure.
          if (controller.signal.aborted || cancelled) return;

          // A missing/unavailable SPARQL protocol endpoint must not discard the
          // authoritative FCT search results. Log the failure for diagnostics;
          // selected relationship labels remain visible with dash placeholders.
          const message = enrichmentRequestError instanceof Error
            ? enrichmentRequestError.message
            : "Could not enrich Results items.";
          const selectedEndpoint = fctEndpoints.find(
            (endpoint) => endpoint.id === selectedEndpointId,
          );
          const resultTitles = nextResults.map((item) => item.title || item.uri);
          console.warn("Results enrichment failed:", {
            message,
            endpointTitle: selectedEndpoint?.label ?? selectedEndpointId ?? "Unknown endpoint",
            endpointUrl: selectedEndpoint?.url ?? "Unknown endpoint URL",
            resultTitles,
            error: enrichmentRequestError,
          });
        }

        // Enrichment may take much longer than the FCT response. Never allow
        // a completed request for an older breadcrumb/endpoint to repopulate
        // the widgets after the coordinated transition has cleared them.
        if (cancelled || requestQueryIdentity !== activeQueryIdentityRef.current) return;

        setSparqlQuery(typeof data.sparql === "string" ? data.sparql : "");
        setResultsPageMatchCount(Number.isFinite(Number(data.matchCount)) ? Number(data.matchCount) : nextResults.length);
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
  }, [search, queryResultsXml, queryCountXml, resultsOffset, selectedEndpointId, endpointReadyForQuery, searchPipelineRun]);

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
        const response = await fetch("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("group-values", "GroupsValues") },
          body: JSON.stringify({ queryXml: serializeFctQuery(groupTree) }),
          signal: controller.signal,
        });
        const data = await response.json();
        rememberShortforms(data?.shortforms);
        if (!response.ok) throw new Error(data.error ?? "Failed to load group values.");
        if (!cancelled) {
          const nextGroupValues: FctResult[] = Array.isArray(data.results) ? data.results : [];
          setGroupHasMoreBatches(nextGroupValues.length >= groupBatchSize && data.complete !== true);
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
    for (const groupValue of visibleGroupValues) {
      const key = `${selectedGroupByOption.key}::${groupValueKey(groupValue)}`;
      const requestState = groupMemberRequestStates.current.get(key);
      if (requestState === "loaded" || requestState === "loading") continue;
      requestKeys.push(key);
      groupMemberRequestStates.current.set(key, "loading");
      setGroupMembers((current) => ({ ...current, [key]: { results: current[key]?.results ?? [], loading: true, error: "" } }));
      void (async () => {
        try {
          const memberTree = createGroupMemberQuery(queryTree, selectedGroupByOption, groupValue);
          const response = await fetch("/proxy/api/fct", {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "application/json", ...proxyDebugHeaders("group-members", "GroupsMembers") },
            body: JSON.stringify({ queryXml: serializeFctQuery(memberTree) }),
            signal: controller.signal,
          });
          const data = await response.json();
        rememberShortforms(data?.shortforms);
          if (!response.ok) throw new Error(data.error ?? `Failed to load items for ${groupValue.title || groupValue.uri}.`);
          if (!cancelled) {
            groupMemberRequestStates.current.set(key, "loaded");
            setGroupMembers((current) => ({ ...current, [key]: { results: Array.isArray(data.results) ? data.results : [], loading: false, error: "" } }));
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
          groupMemberRequestStates.current.delete(key);
          if (cancelled) return;
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
  }, [centralTab, search, queryXml, selectedGroupByOption?.key, visibleGroupValues.map(groupValueKey).join("|")]);

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
      setIsLoadingProperties(false);
      setIsLoadingClasses(false);
      setIsLoadingRoles(false);
      setFocusWidgetsSuppressed(false);
      return;
    }

    // Every query/endpoint change resets the graph page and invalidates its old rows.
    setGraphsPage(0);
    setGraphFacets([]);

    // A new source query means the previous scope's Autofill intersection is stale.
    // Clear it immediately; each facet kind repopulates its own list after its query loads.
    replaceFacetAutofillCandidates("property", []);
    replaceFacetAutofillCandidates("property-in", []);
    setFacetAutofillCandidates({ property: [], "property-in": [] });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!hasPropertyFacetSnapshot.current) setIsLoadingProperties(true);
      setIsLoadingClasses(true);
      setIsLoadingRoles(true);
      setPropertyFacetError("");
      setClassFacetError("");
      setRoleFacetError("");

      async function loadFacet(view: "properties" | "classes" | "roles") {
        // Incoming predicates are the inverse-property (Roles) facet.
        // Virtuoso exposes these with view type="properties-in".
        const response = await fetch("/proxy/api/fct", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("facet-load", "FacetLoader") },
          body: JSON.stringify({
            queryXml: queryWithoutPagingXml,
            view: view === "roles" ? "properties-in" : view,
          }),
          signal: controller.signal,
        });
        const data = await response.json();
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

      const [propertiesResult, classesResult, rolesResult] =
        await Promise.allSettled([
          loadFacet("properties"),
          loadFacet("classes"),
          loadFacet("roles"),
        ]);

      if (cancelled) return;

      if (propertiesResult.status === "fulfilled") {
        setPropertyFacets(
          Array.isArray(propertiesResult.value.items) ? propertiesResult.value.items : [],
        );
        hasPropertyFacetSnapshot.current = true;
        setPropertyFacetSparql(propertiesResult.value.sparql);
      } else {
        // Preserve the last successful Focus list during transient query failures.
        // The error remains visible, but the pane does not flash empty.
        setPropertyFacetError(
          propertiesResult.reason instanceof Error
            ? propertiesResult.reason.message
            : "Failed to load property facets.",
        );
      }

      if (classesResult.status === "fulfilled") {
        setClassFacets(
          Array.isArray(classesResult.value.items) ? classesResult.value.items : [],
        );
      } else {
        setClassFacets([]);
        setClassFacetError(
          classesResult.reason instanceof Error
            ? classesResult.reason.message
            : "Failed to load class facets.",
        );
      }

      if (rolesResult.status === "fulfilled") {
        setRoleFacets(
          Array.isArray(rolesResult.value.items) ? rolesResult.value.items : [],
        );
        setRoleFacetSparql(rolesResult.value.sparql);
      } else {
        setRoleFacets([]);
        setRoleFacetSparql("");
        setRoleFacetError(
          rolesResult.reason instanceof Error
            ? rolesResult.reason.message
            : "Failed to load role facets.",
        );
      }
      setIsLoadingProperties(false);
      setIsLoadingClasses(false);
      setIsLoadingRoles(false);
      setFocusWidgetsSuppressed(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, queryWithoutPagingXml, queryCountXml, selectedEndpointId, endpointReadyForQuery]);

  // Fetch only the graph page the user requested; never scan the entire result set.
  useEffect(() => {
    if (!endpointReadyForQuery || !selectedEndpointId) {
      setGraphFacets([]);
      setGraphHasMore(false);
      setIsLoadingGraphs(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingGraphs(true);
    async function loadGraphPage() {
      try {
        const limit = FACET_PAGE_SIZE;
        const offset = graphsPage * limit;
        const graphQueryXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
          type: "text", limit: String(limit), offset: String(offset),
        }));
        const response = await fetch("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("graph-list", "GraphList") },
          body: JSON.stringify({ queryXml: graphQueryXml, graphOnly: true }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Failed to load datasites for the current query.");
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

setGraphFacets(graphs.map((uri) => ({ uri, label: uri, count: 0 })));

        setGraphHasMore(!(data.complete === true || data.complete === "yes") && (typeof data.rowCount !== "number" || data.rowCount >= limit));
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
  const visibleResultsPage = allLoadedResults.slice(resultsUiPage * resultsPageSize, (resultsUiPage + 1) * resultsPageSize);
  useEffect(() => {
    if (visibleResultsPage.length > 0 && !visibleResultsPage.some((item) => item.uri === selectedUri)) {
      setSelectedUri(visibleResultsPage[0].uri);
    }
  }, [resultsOffset, resultsPageSize, resultsUiPage, visibleResultsPage, selectedUri]);

  const selectedResult = visibleResultsPage.find((item) => item.uri === selectedUri);

  // Load the selected resource once with SPARQL DESCRIBE; pagination is local to
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
        const response = await fetch("/proxy/api/describe", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-description", "RecordDescription") },
          body: JSON.stringify({ iri: selectedUri }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "SPARQL DESCRIBE failed.");
        if (typeof data.rdfXml !== "string") throw new Error("SPARQL DESCRIBE returned no RDF/XML document.");
        const xml = new DOMParser().parseFromString(data.rdfXml, "application/xml");
        if (xml.querySelector("parsererror")) throw new Error("The DESCRIBE response was not valid XML.");
        const rdfNs = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
        const rows: { property: string; value: string }[] = [];
        // RDF/XML may represent a subject as rdf:Description or as a typed node
        // (for example foaf:Person), so inspect each direct child of rdf:RDF.
        const rdfRoot = xml.documentElement.localName === "RDF"
          ? xml.documentElement
          : xml.getElementsByTagNameNS(rdfNs, "RDF")[0];
        const subjects = rdfRoot ? Array.from(rdfRoot.children) : [];
        for (const subject of subjects) {
          for (const predicate of Array.from(subject.children)) {
            const property = predicate.namespaceURI ? `${predicate.namespaceURI}${predicate.localName}` : predicate.tagName;
            const resource = predicate.getAttributeNS(rdfNs, "resource");
            const nodeId = predicate.getAttributeNS(rdfNs, "nodeID");
            const value = resource || (nodeId ? `_:${nodeId}` : predicate.textContent?.trim() || "");
            if (value) rows.push({ property: toLabel(property), value });
          }
        }
        if (!cancelled) setDescribedRecord(rows);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("SPARQL DESCRIBE failed:", error);
          setDescribedRecord([]);
        }
      } finally {
        if (!cancelled) setIsDescribing(false);
      }
    }
    void loadDescription();
    return () => { cancelled = true; controller.abort(); };
  }, [selectedUri, selectedEndpointId]);

  // The active scope is the property-path node that currently contains the
  // authoritative <view>; at the root, scope is represented by null.
  const activePropertyPath = getPropertyPath();
  const activeLeafId: string | null =
    activePropertyPath.length > 0
      ? activePropertyPath[activePropertyPath.length - 1].id
      : null;
  // Derive checked state from the authoritative query tree, including path
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
    setFacetAutofillCandidates((current) => ({ ...current, property: candidates }));
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
    setFacetAutofillCandidates((current) => ({ ...current, "property-in": candidates }));
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

  // Single source of truth for both checkbox changes and property-label clicks.
  function handlePropertyCheckboxChange(uri: string, checked: boolean, trackUsage = true) {
    if (checked) {
      if (trackUsage && !selectedProperties.has(uri)) {
        recordFacetAddition("property", uri);
        setFacetUsageRevision((revision) => revision + 1);
      }
      addProperty(activeLeafId, uri);
      const facet = propertyFacets.find((item) => item.uri === uri);
      setPersonalWidgets((current) =>
        current.some((widget) => widget.uri === uri)
          ? current
          : [
              ...current,
              {
                uri,
                label: facet?.label || compactIri(uri),
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
    if (checked && trackUsage && !selectedRoles.has(uri)) {
      recordFacetAddition("property-in", uri);
      setFacetUsageRevision((revision) => revision + 1);
    }
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

  function changeResultsPage(delta: number) {
    const nextPage = Math.max(0, resultsUiPage + delta);
    const totalPages = effectiveResultsTotalCount === null ? 1 : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize));
    if (nextPage >= totalPages || nextPage === resultsUiPage) return;
    setResultsUiPage(nextPage);
    const requiredResultCount = (nextPage + 1) * resultsPageSize;
    if (requiredResultCount > results.length && results.length < (effectiveResultsTotalCount ?? Number.POSITIVE_INFINITY) && !isSearching) {
      resultsBatchRequestPending.current = true;
      setResultsPage(resultsBatchSize, resultsOffset + Math.max(1, resultsPageMatchCount));
    }
  }


  useEffect(() => {
    const requiredResultCount = (resultsUiPage + 1) * resultsPageSize;
    if (
      centralTab === "results" &&
      !isSearching &&
      !resultsBatchRequestPending.current &&
      results.length > 0 &&
      results.length < requiredResultCount &&
      results.length < (effectiveResultsTotalCount ?? Number.POSITIVE_INFINITY) &&
      resultsPageMatchCount > 0
    ) {
      resultsBatchRequestPending.current = true;
      setResultsPage(resultsBatchSize, resultsOffset + resultsPageMatchCount);
    }
  }, [centralTab, resultsUiPage, resultsPageSize, isSearching, results.length, effectiveResultsTotalCount, resultsPageMatchCount, resultsBatchSize, resultsOffset, setResultsPage]);

  function compactIri(value: string): string {
    return toLabel(value);
  }

  function classBreadcrumbLabels(parentId: string | null): string[] {
    return getClassesAtNode(parentId).map((iri) => {
      const facet = classFacets.find((item) => item.uri === iri);
      return facet?.label || compactIri(iri);
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

    const flattenPropertiesWrappers = (nodes: FctQueryNode[]) =>
      nodes.flatMap((node) =>
        node.name === "properties" || node.id === "query-view-properties"
          ? node.children
          : [node],
      );

    // First look for alternatives alongside this relationship. A <properties>
    // wrapper is transparent, so its relationship children share one sibling set.
    const parentChildren = "children" in targetParent ? targetParent.children : [];
    const parentSiblings = flattenPropertiesWrappers(parentChildren).filter(
      (node, index, all) =>
        isRelationship(node) &&
        node.id !== targetId &&
        all.findIndex((candidate) => candidate.id === node.id) === index,
    );
    if (parentSiblings.length > 0) return parentSiblings;

    // If the focused relationship is the only relationship at its parent level,
    // its nested <view> may contain a <properties> wrapper with the alternatives
    // for that focus. This is common when the view is carried by a single root
    // relationship, e.g. creator -> view -> properties -> issued / identifier.
    const nestedView = target.children.find((node) => node.name === "view" || node.id === "query-view");
    if (!nestedView) return [];
    const viewRelationships = flattenPropertiesWrappers(nestedView.children).filter(
      (node, index, all) =>
        isRelationship(node) &&
        all.findIndex((candidate) => candidate.id === node.id) === index,
    );
    return viewRelationships;
  }

  function breadcrumbSiblingLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri ?? node.attributes.property ?? node.attributes.role;
    const facet = iri
      ? (node.name === "property-of" ? roleFacets : propertyFacets).find((item) => item.uri === iri)
      : undefined;
    const label = facet?.label || (iri ? compactIri(iri) : queryNodeLabel(node));
    return label + (node.name === "property-of" ? " of" : "");
  }

  function queryNodeLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri;
    if (node.id === "query-text")
      return `Search text${node.text ? `: ${node.text}` : " (empty)"}`;
    if (node.id === "query-view") {
      return `Results view · limit ${node.attributes.limit ?? "30"} · offset ${node.attributes.offset ?? "0"}`;
    }
    if (node.name === "properties") return "Filters";
    if (node.name === "value")
      return node.text ? `Value: ${node.text}` : "Value";
    if (node.name === "property-of") {
      // Depending on the source XML, reverse relationships may expose their
      // predicate through iri, property, role, or text. Prefer the Roles facet
      // label, but never fall back to the generic XML tag name.
      const roleIri = iri ?? node.attributes.property ?? node.attributes.role;
      const role = roleIri
        ? roleFacets.find((item) => item.uri === roleIri)
        : undefined;
      const roleText = typeof node.text === "string" ? node.text.trim() : "";
      return role?.label || (roleIri ? compactIri(roleIri) : "") || roleText || "Role";
    }
    if (node.name === "property") {
      // Keep the full IRI in the query tree; use a concise label only for display.
      // Literal bindings are not wired into the UI yet, but display them if present
      // in the query model/XML (e.g. iri="...date" literal="5/23/92").
      const facet = iri
        ? propertyFacets.find((item) => item.uri === iri)
        : undefined;
      const propertyLabel = facet?.label || (iri ? compactIri(iri) : "Property");
      const literal = node.attributes.literal ?? node.attributes.value;
      return literal !== undefined && literal !== ""
        ? `${propertyLabel} = ${literal}`
        : propertyLabel;
    }
    if (node.name === "class" && iri) {
      const facet = classFacets.find((item) => item.uri === iri);
      return `Class: ${facet?.label || compactIri(iri)}`;
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
        {personalWidgets.map((widget) => (
          <article
  key={widget.uri}
  className="flex min-w-0 flex-col"
>
            <header className="group/header flex items-start justify-between gap-2 border-b px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    className="break-words text-left text-sm font-semibold text-inherit underline-offset-2 hover:underline cursor-pointer"
                    title={`Navigate to ${widget.label} scope`}
                    onClick={() => {
                      const existingPath = findPropertyPathNode(widget.uri);
                      if (existingPath) navigateToPropertyPath(existingPath.id);
                      else navigateIntoRelationship(widget.uri, "forward");
                    }}
                  >
                    {widget.label}
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <QueryInspectorButton
                      query={serializeFctQuery(createPropertyWidgetQuery(queryTree, widget.uri))}
                      filename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}.xml`}
                      countQuery={widget.values[0] ? buildFctCountSparql(createDistinctCountQuery(queryTree, "value", widget.values[0].uri, widget.uri, widget.values[0])) : undefined}
                      countFilename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}-first-item-count.xml`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const pathNode = findPropertyPathNode(widget.uri);
                        if (pathNode) deleteNode(pathNode.id);
                        else removeProperty(activeLeafId, widget.uri);
                        setPersonalWidgets((current) => current.filter((item) => item.uri !== widget.uri));
                      }}
                      className="shrink-0 px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                      aria-label={`Remove ${widget.label} widget`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  {widget.loading && (
                    <span
                      className="text-xs text-sky-100/80 dark:text-sky-200/80"
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
                  ];
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
                            onClick={() =>
                              setPersonalWidgets((current) =>
                                current.map((item) =>
                                  item.uri === widget.uri
                                    ? {
                                        ...item,
                                        page: Math.min(pageCount - 1, page + 1),
                                      }
                                    : item,
                                ),
                              )
                            }
                            disabled={page >= pageCount - 1}
                          >
                            Next
                          </button>
                        </div>
                      )}
                      <div className="space-y-1">
                        {pageValues.map((value) => (
                          <label
                            key={value.uri}
                            className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                          >
                            <input
                              type="checkbox"
                              name={`property-value-${widget.uri}`}
                              value={value.uri}
                              checked={widget.selectedValues.includes(facetValueKey(value))}
                              onChange={(event) => {
                                const binding = groupValueBinding(value);
                                setPropertyValue(
                                  activeLeafId,
                                  widget.uri,
                                  { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) },
                                  event.currentTarget.checked,
                                );
                              }}
                              aria-label={`Bind ${widget.label} to ${value.title || value.uri}`}
                              className="mt-0.5 size-4 shrink-0 accent-current"
                            />
                            <span className="min-w-0 flex-1 break-words">
                              {value.title || value.uri}
                            </span>
                            <DistinctCount
                              tree={queryTree}
                              kind="value"
                              uri={value.uri}
                              propertyUri={widget.uri}
                              candidateValue={value}
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  );
                })()}
            </div>
          </article>
        ))}
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
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label htmlFor="maestro-graph-input" className="shrink-0 text-sm font-medium">Datasite:</label>
          <div className="flex min-w-0 max-w-3xl flex-1 items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <input
              id="maestro-graph-input"
              value={graphText}
              onChange={(event) => setGraphText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") applyGraphText(); }}
              placeholder="Site URI"
              aria-label="Site URI"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
            />
            <Toggle
              type="button"
              pressed={findEndpointsEnabled}
              onPressedChange={setFindEndpointsEnabled}
              title="find endpoints"
              aria-label="find endpoints"
              className="shrink-0 rounded-none border-l border-input px-3 data-[state=on]:bg-green-100 data-[state=on]:text-green-800 data-[state=on]:hover:bg-green-200 dark:data-[state=on]:bg-green-950 dark:data-[state=on]:text-green-300 dark:data-[state=on]:hover:bg-green-900"
            ><Network aria-hidden="true" /></Toggle>
          </div>
          <button
            type="button"
            onClick={clearGraph}
            className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            title="Clear graph field and query graph"
          >Clear</button>
          <button
            type="button"
            onClick={applyGraphText}
            className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >Go</button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.removeItem(FACET_ADD_COUNTS_STORAGE_KEY);
                window.localStorage.removeItem(FACET_AUTOFILL_STORAGE_KEY);
                setFacetAutofillCandidates({ property: [], "property-in": [] });
                setFacetUsageRevision((revision) => revision + 1);
                setAutoResetMessage("Auto-configure was reset.");
              } catch {
                setAutoResetMessage("Auto-configure could not be reset because browser storage is unavailable.");
              }
            }}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent cursor-pointer"
            title="Reset Auto-configure learning history and saved candidates"
          >
            Reset Auto
          </button>
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5" title="FCT query execution timeout">
            <label htmlFor="fct-query-timeout" className="whitespace-nowrap text-xs text-muted-foreground">Timeout</label>
            <div className="w-24">
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
            <output htmlFor="fct-query-timeout" className="w-8 text-right text-xs tabular-nums">{timeoutSeconds}s</output>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <label htmlFor="fct-query-same-as" className="whitespace-nowrap text-xs text-muted-foreground">Aliases</label>
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
            }}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent cursor-pointer"
          >
            RDF Loader
          </button>
          <div className="flex items-center gap-2">
            <Label htmlFor="fct-endpoint" className="whitespace-nowrap text-xs text-muted-foreground">
              Data server:
            </Label>
            <select
              id="fct-endpoint"
              value={selectedEndpointId}
              onChange={(event) =>
                void chooseFctEndpoint(event.currentTarget.value)
              }
              className="max-w-[280px] rounded-md border bg-background px-2.5 py-1.5 text-xs"
              title="Choose which FCT endpoint receives queries"
            >
              {fctEndpoints.length === 0 && (
                <option value="">
                  {isCheckingEndpoints
                    ? "Loading endpoints and checking servers…"
                    : "No endpoints configured"}
                </option>
              )}
              {[...new Set(fctEndpoints.map((endpoint) => endpoint.group || "Endpoints"))].map((group) => (
                <optgroup key={group} label={group}>
                  {fctEndpoints.filter((endpoint) => (endpoint.group || "Endpoints") === group).map((endpoint) => {
                    const status = endpointStatuses[endpoint.id];
                    const mark =
                      status?.status === 200
                        ? "🟢 "
                        : status?.state === "server-error"
                          ? "🔴 "
                          : status && ["unreachable", "timeout"].includes(status.state)
                            ? "🟠 "
                            : "";
                    const statusText =
                      status?.status != null
                        ? ` (${new URL(endpoint.url).protocol.replace(":", "").toUpperCase()} ${status.status})`
                        : status
                          ? ` (${status.state})`
                          : "";
                    return (
                      <option key={endpoint.id} value={endpoint.id}>
                        {mark}{endpoint.label}{statusText}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
            {isCheckingEndpoints && (
              <span
                className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <span className="sr-only">{fctEndpoints.length === 0 ? "Loading FCT servers" : "Updating FCT servers"}</span>
                <Progress className="h-2 w-24" value={endpointChecksTotal ? (endpointChecksCompleted / endpointChecksTotal) * 100 : 0} indeterminate={endpointChecksTotal === 0 || endpointChecksCompleted === 0} aria-label="FCT endpoint checks" />
                {fctEndpoints.length === 0 ? "Loading FCT servers…" : `Updating… ${endpointChecksCompleted}/${endpointChecksTotal}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => void checkFctEndpoints()}
              disabled={isCheckingEndpoints || fctEndpoints.length === 0}
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 cursor-pointer"
              title="Check each server with a small FCT query"
            >
              {isCheckingEndpoints ? "Checking…" : "Check servers"}
            </button>
          </div>
        </div>
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
        <div role="tablist" aria-label="Navigation pane" className="flex shrink-0 gap-1 border-b px-2 pt-2">
          <button type="button" role="tab" aria-selected="true" className="-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground">Navigation</button>
          <button type="button" role="tab" aria-selected="false" disabled aria-disabled="true" title="Coming soon" className="-mb-px cursor-not-allowed px-3 py-2 text-sm font-medium text-muted-foreground opacity-50">Build</button>
          <button type="button" role="tab" aria-selected="false" disabled aria-disabled="true" title="Coming soon" className="-mb-px cursor-not-allowed px-3 py-2 text-sm font-medium text-muted-foreground opacity-50">Publish</button>
        </div>
        <nav aria-label="Navigation breadcrumbs" className="flex min-h-14 flex-wrap items-center gap-2 bg-background px-4 py-2">
        <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigateToPropertyPath("query-root")}
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
        {getPropertyPath().map((crumb, index) => {
          const breadcrumbClasses = classBreadcrumbLabels(crumb.id);
          const breadcrumbLabel = (
            roleFacets.find((item) => item.uri === crumb.uri)?.label ??
            propertyFacets.find((item) => item.uri === crumb.uri)?.label ??
            compactIri(crumb.uri)
          ) + ((crumb.name === "property-of" || crumb.id.startsWith("role-filter-")) ? " of" : "");
          const breadcrumbSiblings = getBreadcrumbSiblings(crumb.id);
          return (
            <span key={crumb.id} className="flex items-center gap-1">
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              <ButtonGroup aria-label={`Controls for ${breadcrumbLabel}`} className="[&>*+*]:!border-l-0">
                <button
                  type="button"
                  onClick={() => navigateToPropertyPath(crumb.id)}
                  className={`relative cursor-pointer rounded-none border-0 px-2.5 pb-1.5 pt-4 text-sm hover:bg-accent ${index === getPropertyPath().length - 1 ? "bg-accent font-medium" : "bg-background"}`}
                  title={`Navigate to ${crumb.uri}${breadcrumbClasses.length ? ` · Classes: ${breadcrumbClasses.join(", ")}` : ""}`}
                  aria-current={
                    index === getPropertyPath().length - 1 ? "location" : undefined
                  }
                >
                  {breadcrumbClasses.length > 0 && (
                    <span className="absolute left-1 top-0 max-w-[calc(100%-8px)] truncate text-left text-[9px] font-normal leading-3 text-muted-foreground" aria-label={`Classes: ${breadcrumbClasses.join(", ")}`}>
                      {breadcrumbClasses.join(", ")}
                    </span>
                  )}
                  {breadcrumbLabel}
                </button>
                <button
                  type="button"
                  onClick={() => deleteNode(crumb.id)}
                  className="flex h-auto min-h-full w-7 shrink-0 self-stretch items-center justify-center rounded-none border-0 py-0 text-base leading-none text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remove ${breadcrumbLabel}`}
                  title={`Remove ${breadcrumbLabel} and its descendants`}
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
                          className="flex h-auto min-h-10 w-8 shrink-0 self-stretch items-center justify-center rounded-none border-0 bg-background p-0 text-foreground outline-none hover:bg-accent focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=open]:bg-accent"
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
                        >
                          {propertyFacets.length}
                        </button>
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
                        >
                          {roleFacets.length}
                        </button>
                      </ButtonGroup>
                    )}
                    {autoConfigureFacetCount > 0 && (
                      <ButtonGroup aria-label="Auto-configure facets">
                        <button
                          type="button"
                          onClick={() => {
                            for (const uri of facetAutofillCandidates.property) {
                              if (!selectedProperties.has(uri)) handlePropertyCheckboxChange(uri, true, false);
                            }
                            for (const uri of facetAutofillCandidates["property-in"]) {
                              if (!selectedRoles.has(uri)) handleRoleCheckboxChange(uri, true, false);
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
                              if (!selectedProperties.has(uri)) handlePropertyCheckboxChange(uri, true, false);
                            }
                            for (const uri of facetAutofillCandidates["property-in"]) {
                              if (!selectedRoles.has(uri)) handleRoleCheckboxChange(uri, true, false);
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
                                ? graphFacets.map((item) => ({ key: item.uri, label: item.uri, count: item.count }))
                                : [];

                      // Query-selected Properties/Roles lead the widget in query
                      // order; never sort the proxy response. The unselected items
                      // remain in exactly the order supplied by FCT.
                      if (group === "Properties" || group === "Roles") {
                        const selected = group === "Properties" ? selectedProperties : selectedRoles;
                        const selectedInQueryOrder = Array.from(selected, (key) =>
                          items.find((item) => item.key === key) ?? {
                            key,
                            label: toLabel(key),
                            count: null,
                          },
                        );
                        items = [
                          ...selectedInQueryOrder,
                          ...items.filter((item) => !selected.has(item.key)),
                        ];
                      }

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
                        Math.ceil(items.length / FACET_PAGE_SIZE),
                      );
                      const pageItems =
                        group === "Properties" ||
                        group === "Classes" ||
                        group === "Roles" ||
                        group === "Graphs"
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
                                query={`${queryWithoutPagingXml}\n<!-- FCT API option: view=properties -->`}
                                filename="properties-fct-query.xml"
                                label="View Properties widget query"
                                headerTone
                                countQuery={propertyFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "property", propertyFacets[0].uri, undefined, undefined, "text")) : undefined}
                                countFilename="properties-first-item-count.sparql"
                              />
                            )}
                            {group === "Roles" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml}\n<!-- FCT API option: view=properties-in -->`}
                                filename="roles-fct-query.xml"
                                label="View Roles widget query"
                                headerTone
                                countQuery={roleFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "role", roleFacets[0].uri, undefined, undefined, "text")) : undefined}
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

                          {(group === "Properties" ||
                            group === "Classes" ||
                            group === "Roles") &&
                            items.length > FACET_PAGE_SIZE && (
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
                            {pageItems.map((item) => (
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
                                    checked={
                                      group === "Properties"
                                        ? selectedProperties.has(item.key)
                                        : group === "Classes"
                                          ? selectedClasses.has(item.key)
                                          : selectedRoles.has(item.key)
                                    }
                                    onChange={(event) =>
                                      group === "Properties"
                                        ? handlePropertyCheckboxChange(
                                            item.key,
                                            event.target.checked,
                                          )
                                        : group === "Classes"
                                          ? toggleClass(
                                              item.key,
                                              event.target.checked,
                                            )
                                          : handleRoleCheckboxChange(
                                              item.key,
                                              event.target.checked,
                                            )
                                    }
                                    aria-label={`Filter by ${item.label}`}
                                    className="size-4 shrink-0 accent-current"
                                  />
                                ) : null}
                                {group === "Properties" ? (
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => navigateIntoRelationship(item.key, "forward")}
                                    title={`Drill down through ${item.label}`}
                                  >
                                    {item.label}
                                  </button>
                                ) : group === "Roles" ? (
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => navigateIntoRelationship(item.key, "reverse")}
                                    title={`Filter by role ${item.label}`}
                                  >
                                    {item.label}
                                  </button>
                                ) : group === "Classes" ? (
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
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
                                  />
                                )}
                                {group === "Classes" && (
                                  <DistinctCount
                                    tree={queryTree}
                                    kind="class"
                                    uri={item.key}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </>
                )}

                {defaultLeftTab === "personal" && (
                  <div className="space-y-3">
                    <article className="flex min-w-0 flex-col">
                      <header className="group/header flex items-start justify-between gap-2 border-b px-2 py-2">
                        <div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">Categories</h2><QueryInspectorButton query={`${queryWithoutPagingXml}\n<!-- FCT API option: view=classes -->`} filename="categories-fct-query.xml" countQuery={classDisplayFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "class", classDisplayFacets[0].uri, undefined, undefined, "text")) : undefined} countFilename="categories-first-item-count.sparql" /></div>
                        <span
                          className={`text-xs ${classFacetError ? "text-destructive" : "text-muted-foreground"}`}
                          aria-live="polite"
                          title={classFacetError || undefined}
                        >
                          {isLoadingClasses
                            ? "Updating…"
                            : classFacetError
                              ? "Update failed"
                              : classDisplayFacets.length}
                        </span>
                      </header>
                      {classFacetError ? (
                        <p className="text-xs text-destructive">{classFacetError}</p>
                      ) : classDisplayFacets.length === 0 && !isLoadingClasses ? (
                        <p className="text-xs text-muted-foreground">No classes found for this query.</p>
                      ) : (
                        <>
                          {classDisplayFacets.length > FACET_PAGE_SIZE && (
                            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.max(0, page - 1))}
                                disabled={classesPage === 0}
                              >
                                Previous
                              </button>
                              <span className="text-muted-foreground">
                                Page {Math.min(classesPage + 1, Math.ceil(classDisplayFacets.length / FACET_PAGE_SIZE))} of {Math.max(1, Math.ceil(classDisplayFacets.length / FACET_PAGE_SIZE))}
                              </span>
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.min(Math.ceil(classDisplayFacets.length / FACET_PAGE_SIZE) - 1, page + 1))}
                                disabled={classesPage >= Math.ceil(classDisplayFacets.length / FACET_PAGE_SIZE) - 1}
                              >
                                Next
                              </button>
                            </div>
                          )}
                          <div className="space-y-1">
                            {classDisplayFacets
                              // classDisplayFacets already puts current-scope
                              // query <class> nodes first, followed by proxy order.
                              .slice(classesPage * FACET_PAGE_SIZE, (classesPage + 1) * FACET_PAGE_SIZE)
                              .map((item) => (
                                <div key={item.uri} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                                  <input
                                    type="checkbox"
                                    checked={selectedClasses.has(item.uri)}
                                    onChange={(event) => toggleClass(item.uri, event.target.checked)}
                                    aria-label={`Filter by class ${toLabel(item.uri)}`}
                                    className="size-4 shrink-0 accent-current"
                                  />
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => {
                                      if (!selectedClasses.has(item.uri)) toggleClass(item.uri, true);
                                      showClassResults(item.uri, activeLeafId);
                                    }}
                                    title={`Show results for class ${toLabel(item.uri)}`}
                                  >
                                    {toLabel(item.uri)}
                                  </button>
                                  <DistinctCount tree={queryTree} kind="class" uri={item.uri} />
                                </div>
                              ))}
                          </div>
                        </>
                      )}
                    </article>
                    {!focusWidgetsSuppressed && activeRoleFilters.map((roleNode) => {
                      const uri = roleNode.attributes.iri ?? "";
                      const label = roleFacets.find((item) => item.uri === uri)?.label || compactIri(uri);
                      return (
                        <article key={roleNode.id} className="flex min-w-0 flex-col">
                          <header className="group/header flex items-start justify-between gap-2 border-b px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <button
                                  type="button"
                                  className="cursor-pointer text-left text-sm font-semibold underline-offset-2 hover:underline"
                                  onClick={() => navigateToPropertyPath(roleNode.id)}
                                  title={`Navigate to role scope ${label}`}
                                >
                                  Role filter: {label}
                                </button>
                                <QueryInspectorButton query={roleFacetSparql} language="sparql" filename="roles-facet.sparql" />
                            <button
                              type="button"
                              className="shrink-0 px-2 py-1 text-xs text-sky-100/80 opacity-0 transition-opacity hover:text-white focus-visible:opacity-100 group-hover/header:opacity-100 dark:text-sky-200/80 dark:hover:text-white cursor-pointer"
                              onClick={() => deleteNode(roleNode.id)}
                              aria-label={`Remove role filter ${label}`}
                            >
                              Remove
                            </button></div>
                              <p className="mt-1 break-all text-xs text-sky-100/80 dark:text-sky-200/80" title={uri}>{uri}</p>
                            </div>
                          </header>
                        </article>
                      );
                    })}
                    {!focusWidgetsSuppressed && renderPersonalWidgetCards("column")}
                    <article className="flex min-w-0 flex-col">
                      <header className="group/header flex items-center justify-between gap-2 px-2 py-2">
                        <div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">Datasites</h2><QueryInspectorButton query={`${queryWithoutPagingXml}\n<!-- FCT API option: graphOnly=true -->`} filename="datasites-fct-query.xml" />
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
                                <input type="radio" name="maestro-query-graph-personal" checked={queryTree.attributes.graph === item.uri} onChange={() => bindGraph(item.uri)} aria-label={`Bind datasite ${item.uri}`} className="size-4 shrink-0 accent-current" />
                                <span className="min-w-0 flex-1 break-all">{item.uri}</span>
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
              <div className="group/header shrink-0 border-b p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search results..."
                    aria-label="Search results"
                    className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
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
                    className="group inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm"
                    aria-label="Query"
                    title="Query"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 transition-transform group-data-[state=on]:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5h5v4H5zM14 15h5v4h-5zM5 15h5v4H5zM10 7h4v10M10 17h4" strokeLinejoin="round" /></svg>
                    <span>{centralTab === "query-tree" || centralTab === "view-query" ? "Results" : "Query"}</span>
                  </Toggle>
                  <QueryInspectorButton query={queryResultsXml} filename="results-fct-query.xml" />
                </div>
                {searchError && <p className="mt-2 text-sm text-destructive">{searchError}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
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
                            {item.title && item.title !== item.uri ? item.title : toLabel(item.uri)}
                          </span>
                          <span className="mt-1 block break-all text-xs text-muted-foreground">
                            {item.uri}
                          </span>
                          {(item.scopeValues?.length ?? 0) > 0 && (
                            <span className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected property values">
                              {item.scopeValues!.map((scopeValue) => scopeValue.values.map((term, termIndex) => {
                                const displayValue = term.type === "uri" ? compactIri(term.value) : term.value;
                                const label = `${scopeValue.direction === "reverse" ? `${scopeValue.label} of` : scopeValue.label}: ${term.value}${term.lang ? ` @${term.lang}` : ""}${term.datatype ? `^^${term.datatype}` : ""}`;
                                return (
                                  <span
                                    key={`${scopeValue.direction}:${scopeValue.property}:${term.value}:${term.lang ?? ""}:${term.datatype ?? ""}:${termIndex}`}
                                    title={label}
                                    className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-normal text-muted-foreground"
                                  >
                                    <span className="font-medium text-foreground">{scopeValue.direction === "reverse" ? `${scopeValue.label} of` : scopeValue.label}</span>
                                    <span className="max-w-[240px] truncate">{displayValue}</span>
                                  </span>
                                );
                              }))}
                            </span>
                          )}
                        </button>

                        {search.trim().length > 0 && (
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

                      {isExpanded && search.trim().length > 0 && (
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
                <div id="central-panel-groups" role="tabpanel" aria-labelledby="central-tab-groups" className="min-h-0 flex-1 overflow-auto p-3">
                  {groupByOptions.length > 0 ? (
                    <div className="flex min-h-0 flex-col gap-3">
                      {groupValuesLoading ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading group values from Virtuoso FCT…</p> : null}
                      {groupValuesError ? <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{groupValuesError}</p> : null}
                      {!groupValuesLoading && !groupValuesError && groupValues.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No values found for this relationship in the current scope.</p> : null}
                      <div className="flex flex-col gap-3">
                        {visibleGroupValues.map((groupValue) => {
                          const memberKey = `${selectedGroupByOption!.key}::${groupValueKey(groupValue)}`;
                          const members = groupMembers[memberKey] ?? { results: [], loading: true, error: "" };
                          const selectedRelationshipNode = findQueryNode(queryTree.children, selectedGroupByOption!.nodeId);
                          const expectedBinding = groupValueBinding(groupValue);
                          const bound = (selectedRelationshipNode?.children ?? []).some((child) => child.name === "value" && child.text === expectedBinding.text && (child.attributes.datatype ?? "uri") === expectedBinding.datatype && (child.attributes["xml:lang"] ?? "") === (expectedBinding.lang ?? ""));
                          return <article key={memberKey} className="flex min-w-0 flex-col rounded-md border border-border">
                            <header className="group/header flex items-start gap-2 border-b border-border px-3 py-2">
                              <input type="checkbox" checked={bound} onChange={(event) => {
                                if (selectedGroupByOption!.direction === "forward") setPropertyValue(activeLeafId, selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                                else setRoleValue(selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                              }} aria-label={`Filter ${selectedGroupByOption!.label} by ${groupValue.title || groupValue.uri}`} className="mt-0.5 size-4 shrink-0 accent-current" />
                              <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{groupValue.title || groupValue.uri}</h3><p className="mt-0.5 break-all text-xs text-muted-foreground">{groupValue.uri}</p></div>
                              <span className="shrink-0 text-xs text-muted-foreground">{members.loading ? "…" : `${members.results.length} ${members.results.length === 1 ? "item" : "items"}`}</span>
                              <QueryInspectorButton query={serializeFctQuery(createGroupMemberQuery(queryTree, selectedGroupByOption!, groupValue))} filename={`group-${(groupValue.title || groupValue.uri).replace(/[^a-z0-9_-]+/gi, "-")}.xml`} />
                            </header>
                            <div className="flex flex-col gap-1 p-2">
                              {members.error ? <p className="px-2 py-2 text-xs text-destructive">{members.error}</p> : members.loading ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading matching Results items…</p> : members.results.length > 0 ? members.results.map((item) => <button key={item.uri} type="button" onClick={() => setSelectedUri(item.uri)} className={`flex min-w-0 flex-col rounded-md px-2 py-2 text-left hover:bg-accent/50 ${selectedUri === item.uri ? "bg-accent/40" : ""}`}><span className="break-words text-sm font-medium cursor-pointer">{item.title && item.title !== item.uri ? item.title : toLabel(item.uri)}</span><span className="mt-0.5 break-all text-xs text-muted-foreground">{item.uri}</span></button>) : <p className="px-2 py-2 text-xs text-muted-foreground">No Results items match this value.</p>}
                            </div>
                          </article>;
                        })}
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
            </section>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={18} className="min-w-0">
            <section className="flex h-full min-h-0 min-w-0 flex-col">
              <div className="border-b p-4">
                <h2 className="text-base font-semibold">
                  {selectedResult?.title ?? "Record"}
                </h2>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {selectedUri}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Properties and values</h3>
                  {describedRecord.length > 0 && <span className="text-xs text-muted-foreground">{describedRecord.length} values</span>}
                </div>
                {describedRecord.length > RECORD_DESCRIPTION_PAGE_SIZE && (
                  <div className="mb-3 flex items-center justify-between gap-2 text-xs">
                    <button type="button" className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setRecordDescriptionPage((page) => Math.max(0, page - 1))} disabled={recordDescriptionPage === 0}>Previous</button>
                    <span className="text-muted-foreground">Page {recordDescriptionPage + 1} of {Math.ceil(describedRecord.length / RECORD_DESCRIPTION_PAGE_SIZE)}</span>
                    <button type="button" className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setRecordDescriptionPage((page) => Math.min(Math.ceil(describedRecord.length / RECORD_DESCRIPTION_PAGE_SIZE) - 1, page + 1))} disabled={recordDescriptionPage >= Math.ceil(describedRecord.length / RECORD_DESCRIPTION_PAGE_SIZE) - 1}>Next</button>
                  </div>
                )}
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Property</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {describedRecord.slice(recordDescriptionPage * RECORD_DESCRIPTION_PAGE_SIZE, (recordDescriptionPage + 1) * RECORD_DESCRIPTION_PAGE_SIZE).map((item, index) => (
                      <tr
                        key={`${item.property}-${index}`}
                        className="border-b"
                      >
                        <td className="break-all px-3 py-3 align-top font-medium">
                          {item.property}
                        </td>
                        <td className="break-all px-3 py-3 align-top">
                          {item.value}
                        </td>
                      </tr>
                    ))}
                    {describedRecord.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-3 py-4 text-sm text-muted-foreground">
                          {isDescribing ? "Loading record description…" : selectedUri ? "No description data returned." : "Select a result to describe it."}
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
