"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";

import { IncompleteWidgetIndicator } from "@/canvas/utils/incomplete-widget";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";
import { fctTermKey, facetValueKey, groupValueBinding, type FctResult } from "@/canvas/utils/fct-response";
import { DistinctCount, distinctCountQueryFor, personalFacetInspectorQueries } from "@/canvas/left/filter";
import { GROUP_BY_FACET_HIGHLIGHT_CLASSES } from "@/canvas/utils/query-controller";

import maestroLanguages from "@/data/maestro-languages.json";

import { toLabel } from "@/lib/uri-labels";

import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Bot, CircleSlash, Trash2, UsersRound, ClipboardList } from "lucide-react";

import hljs from "highlight.js/lib/core";
import xmlLanguage from "highlight.js/lib/languages/xml";
import sqlLanguage from "highlight.js/lib/languages/sql";
import { serializeFctQuery, createPropertyWidgetQuery } from "@/lib/fct-query-api";
import type { FctQueryNode } from "@/lib/fct-query-api";

hljs.registerLanguage("xml", xmlLanguage);
// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.
hljs.registerLanguage("sparql", sqlLanguage);

const MAESTRO_ALPHABET_LANGUAGES = maestroLanguages;

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

/** Single inter-item gap used by all left-pane facet lists, including tree branches. */
const FACET_ITEM_GAP_CLASS = "space-y-0.5";
const PROPERTY_ROLE_ITEM_GAP_CLASS = "space-y-0";
/** Row window for the Categories tree query (type="classes" tree="yes"): one row per class/parent edge. */
const CATEGORY_TREE_QUERY_LIMIT = 500;
const RDFS_LABEL_URI = "http://www.w3.org/2000/01/rdf-schema#label";

/** Common RDF vocabulary properties used as human-readable names or labels. */
const TEXT_SEARCH_NAME_PROPERTIES = [
  { label: "rdfs:label", description: "RDF Schema label", uri: RDFS_LABEL_URI },
  { label: "skos:prefLabel", description: "Preferred label", uri: "http://www.w3.org/2004/02/skos/core#prefLabel" },
  { label: "foaf:name", description: "FOAF name", uri: "http://xmlns.com/foaf/0.1/name" },
  { label: "schema:name", description: "Schema.org name", uri: "https://schema.org/name" },
  { label: "dcterms:title", description: "Dublin Core title", uri: "http://purl.org/dc/terms/title" },
  { label: "dc:title", description: "Dublin Core title (legacy)", uri: "http://purl.org/dc/elements/1.1/title" },
  { label: "vcard:fn", description: "Formatted name", uri: "http://www.w3.org/2006/vcard/ns#fn" },
  { label: "foaf:nick", description: "Nickname", uri: "http://xmlns.com/foaf/0.1/nick" },
  { label: "schema:alternateName", description: "Alternative name", uri: "https://schema.org/alternateName" },
  { label: "skos:altLabel", description: "Alternative label", uri: "http://www.w3.org/2004/02/skos/core#altLabel" },
  { label: "skos:hiddenLabel", description: "Hidden label", uri: "http://www.w3.org/2004/02/skos/core#hiddenLabel" },
  { label: "schema:name (HTTP)", description: "Schema.org HTTP namespace", uri: "http://schema.org/name" },
  { label: "schema:alternateName (HTTP)", description: "Schema.org HTTP namespace", uri: "http://schema.org/alternateName" },
] as const;

import type { PersonalWidgetCardsWorkspace } from "@/canvas/controllers/workspace-interfaces";
export function renderPersonalWidgetCards(workspace: PersonalWidgetCardsWorkspace, layout: "column" | "grid"): ReactNode {
  const { FACET_PAGE_SIZE, activeLeafId, activePropertyFilters, autoConfiguredFacetKeys, beginFacetHoverPreview, clearTutorialPreview, deleteNode, endpointReadyForQuery, facetCandidateCounts, facetHoverPreview, findPropertyPathNode, groupByOptions, groupedPersonalFacetUri, navigateIntoRelationship, navigateToPropertyPath, personalWidgetCardRefs, personalWidgets, queryTree, removeProperty, scrollToGroupForFacetValue, setCentralTab, setFacetCandidateCounts, setGroupByPropertyUri, setPersonalWidgets, setPropertyValue, workspaceTab } = workspace;
    return (
      <div
        className={
          layout === "column"
            ? "flex flex-col gap-3"
            : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        }
      >
        {personalWidgets.map((widget) => {
          const isGroupByFacet = workspaceTab === "browse" && groupedPersonalFacetUri === widget.uri;
          const canGroupByFacet = workspaceTab === "browse" && groupByOptions.some((option) => option.key === `forward:${widget.uri}`);
          return (
          <article
            key={widget.uri}
            ref={(element) => { if (element) personalWidgetCardRefs.current.set(widget.uri, element); else personalWidgetCardRefs.current.delete(widget.uri); }}
            className={`flex min-w-0 flex-col ${isGroupByFacet ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === widget.uri && facetHoverPreview.direction === "forward" ? "rounded-md" : ""}`}
            style={facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === widget.uri && facetHoverPreview.direction === "forward"
              ? { boxShadow: "inset 0 0 0 1px rgb(168 85 247 / 0.85)", borderRadius: "0.375rem", ...(isGroupByFacet ? { borderColor: "rgb(168 85 247 / 0.9)" } : {}) }
              : undefined}
          >
            <header className={`group/header flex items-start justify-between gap-2 border-b px-3 py-2 ${isGroupByFacet ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""} ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === widget.uri && facetHoverPreview.direction === "forward" ? "border-purple-500/80" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Tooltip><TooltipTrigger render={<button
                    type="button"
                    className={`break-words text-left text-sm font-semibold underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === widget.uri && facetHoverPreview.direction === "forward" ? "text-purple-700 dark:text-purple-300" : "text-inherit"}`}
                    onMouseEnter={() => beginFacetHoverPreview(widget.uri, "forward", toLabel(widget.uri), "personal")}
                    onMouseLeave={clearTutorialPreview}
                    onClick={() => {
                      clearTutorialPreview();
                      const existingPath = findPropertyPathNode(widget.uri);
                      if (existingPath) navigateToPropertyPath(existingPath.id);
                      else navigateIntoRelationship(widget.uri, "forward");
                    }}
                  >
                    <IncompleteWidgetIndicator source={`personal:${widget.uri}`} />
                    {activePropertyFilters.some((node) => node.attributes.iri === widget.uri && node.attributes.src === "shacl") && <ClipboardList className="mr-1 inline size-4 shrink-0" aria-label="SHACL-discovered facet" />}
                    {isGroupByFacet && <UsersRound className="mr-1 inline size-4 shrink-0" aria-label="Group by" />}
                    {widget.excluded && <CircleSlash className="mr-1 inline size-3.5 shrink-0" aria-label="Excluded" />}
                    {toLabel(widget.uri, "Property")}
                  </button>} /><TooltipContent>{`Navigate to ${widget.excluded ? `Excluded: ${toLabel(widget.uri, "Property")}` : toLabel(widget.uri)} scope`}</TooltipContent></Tooltip>
                  {autoConfiguredFacetKeys.has(`property::${widget.uri}`) && (
                    <Bot className="size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <QueryInspectorButton
                      query={serializeFctQuery(createPropertyWidgetQuery(queryTree, widget.uri, "forward", undefined, true))}
                      filename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}.xml`}
                      primaryTabLabel="XML"
                      extraQueries={personalFacetInspectorQueries(
                        queryTree,
                        serializeFctQuery(createPropertyWidgetQuery(queryTree, widget.uri, "forward", undefined, true)),
                        widget.uri,
                        widget.values[0],
                        { direction: "forward" },
                      )}
                    />
                    {workspaceTab === "browse" && !widget.excluded && (
                      <Tooltip><TooltipTrigger render={<button
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
                        aria-label={isGroupByFacet ? `Stop grouping by ${toLabel(widget.uri, "Property")}` : `Group results by ${toLabel(widget.uri, "Property")}`}
                      >
                        <UsersRound className="size-4" aria-hidden="true" />
                      </button>} /><TooltipContent>{isGroupByFacet ? `Stop grouping by ${toLabel(widget.uri, "Property")}` : canGroupByFacet ? `Group results by ${toLabel(widget.uri, "Property")}` : "Select this property in the active query before grouping by it"}</TooltipContent></Tooltip>
                    )}
                    <Tooltip><TooltipTrigger render={<button
                      type="button"
                      onClick={() => {
                        const pathNode = findPropertyPathNode(widget.uri);
                        if (pathNode) deleteNode(pathNode.id);
                        else removeProperty(activeLeafId, widget.uri);
                        setPersonalWidgets((current) => current.filter((item) => item.uri !== widget.uri));
                      }}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                      aria-label={`Remove ${widget.excluded ? `Excluded: ${toLabel(widget.uri, "Property")}` : toLabel(widget.uri)} widget`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>} /><TooltipContent>{`Remove ${toLabel(widget.uri, "Property")} facet`}</TooltipContent></Tooltip>
                  </div>
                </div>
                <Tooltip><TooltipTrigger render={<p className="mt-1 break-all text-xs text-muted-foreground">{widget.uri}</p>} /><TooltipContent>{widget.uri}</TooltipContent></Tooltip>
              </div>
              <Tooltip><TooltipTrigger render={<span
                className={`shrink-0 text-xs ${widget.error ? "text-destructive" : "text-muted-foreground"}`}
                aria-live="polite"
              >
                {widget.loading ? <ElapsedStatus label="Updating…" category="personal" clockScope="personal" /> : widget.error ? "Update failed" : widget.values.length}
              </span>} /><TooltipContent>{widget.error || undefined}</TooltipContent></Tooltip>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {!widget.loading &&
                !widget.error &&
                widget.values.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No values found for this property.
                  </p>
                )}
              {!widget.error &&
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
                    // Keep explicitly selected values; hide non-selected values
                    // only after their count is confirmed to be zero.
                    if (checkedValueKeys.has(facetValueKey(value))) return true;
                    const countQuery = distinctCountQueryFor(queryTree, "value", value.uri, widget.uri, value, { direction: "forward" });
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
                      <div className={FACET_ITEM_GAP_CLASS}>
                        {pageValues.map((value, valueIndex) => {
                          const countQuery = distinctCountQueryFor(queryTree, "value", value.uri, widget.uri, value, { direction: "forward" });
                          const isZeroCount = facetCandidateCounts[countQuery] === 0;
                          const valueInputId = `personal-facet-value-${personalWidgets.indexOf(widget)}-${valueIndex}`;
                          const valueLabel = value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri;
                          return (
                          <div
                            key={`${facetValueKey(value)}-${valueIndex}`}
                            aria-disabled={widget.loading || undefined}
                            className={`flex w-full items-start gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50 ${isGroupByFacet ? "" : "cursor-pointer"} ${widget.loading ? "opacity-45" : ""}`}
                          >
                            <input
                              id={valueInputId}
                              type="checkbox"
                              name={`property-value-${widget.uri}`}
                              value={value.uri}
                              checked={checkedValueKeys.has(facetValueKey(value))}
                              disabled={widget.loading}
                              onChange={(event) => {
                                const binding = groupValueBinding(value);
                                setPropertyValue(
                                  activeLeafId,
                                  widget.uri,
                                  { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) },
                                  event.currentTarget.checked,
                                );
                              }}
                              aria-label={`Bind ${toLabel(widget.uri, "Property")} to ${value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}`}
                              className="mt-0.5 size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                              aria-invalid={isZeroCount ? true : undefined}
                            />
                            {isGroupByFacet ? (
                              <Tooltip><TooltipTrigger render={<button
                                type="button"
                                onClick={() => scrollToGroupForFacetValue(value)}
                                className={`min-w-0 flex-1 cursor-pointer break-words text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isZeroCount ? "text-destructive" : ""}`}
                              >{valueLabel}</button>} /><TooltipContent>{`Scroll to group ${valueLabel}`}</TooltipContent></Tooltip>
                            ) : (
                              <label htmlFor={valueInputId} className={`min-w-0 flex-1 break-words cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}>
                                {valueLabel}
                              </label>
                            )}
                            <DistinctCount
                              enabled={endpointReadyForQuery}
                              tree={queryTree}
                              kind="value"
                              uri={value.uri}
                              propertyUri={widget.uri}
                              candidateValue={value}
                              valueRelationship={{ direction: "forward" }}
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
