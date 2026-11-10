"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { Ban } from "lucide-react";
import { useEffect, useState } from "react";
import { parseAlphabetSelections, toggleAlphabetSelection } from "@/lib/alphabet-selections";
import { createBreadcrumbRenderers } from "@/canvas/top/breadcrumb-renderers";
import { BrowseQueryTreeCanvas, BrowseGroupsCanvas, BrowseChatCanvas, BrowseResultsCanvas } from "@/canvas/tab/browse/page";
import { ViewTabCanvas } from "@/canvas/tab/view/page";
import { AnalyzeTabCanvas } from "@/canvas/tab/analyze/page";

import { RESULTS_PAGE_SIZE_STORAGE_KEY, RESULTS_BATCH_SIZE_OPTIONS, CENTER_PANEL_LIMIT_STORAGE_KEY, CENTER_GROUP_LIMIT_STORAGE_KEY } from "@/canvas/sheet/settings";

import { IncompleteWidgetIndicator } from "@/canvas/utils/incomplete-widget";


import maestroLanguages from "@/data/maestro-languages.json";

import { ButtonGroup } from "@/components/ui/button-group";

import { Separator } from "@/components/ui/separator";

import { Toggle } from "@/components/ui/toggle";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { ChevronDown, Code2, Tag, Tags, ListTree, X } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { formatPagePosition } from "@/canvas/utils/pagination";

import { maestroStorageSet } from "@/lib/maestro-storage";

import { ResizablePanel } from "@/components/ui/resizable";
import { CodeBlock } from "@/components/ui/code-block";

import xmlFormat from "xml-formatter";

// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.

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

import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

/** UI owned by CenterCanvasPanel. State and commands come from the shared workspace controller. */
export function CenterCanvasPanel({ workspace }: { workspace: WorkspaceController }) {
  const {
    activeBreadcrumbIndex,
    activeLeafId,
    activeQueryIdentityRef,
    alphabetCounts,
    alphabetError,
    alphabetIndex,
    alphabetLabelUris,
    alphabetPreflight,
    alphabetQueryXml,
    alphabetSparql,
    analysisColumnWidths,
    analysisError,
    analysisLoading,
    analysisRowKeys,
    analysisSelectedKeys,
    analysisSelectionPageKey,
    analysisTable,
    analysisValuesError,
    analyzeBreadcrumbTrail,
    analyzeHistogram,
    analyzeTableHeaderNodes,
    assistantPendingPrompt,
    assistantPromptDraft,
    assistantPromptIdRef,
    authSession,
    availableCompareFacets,
    centralPaneRef,
    centralTab,
    changeResultsPage,
    checkSelectedGraphServer,
    checkingEndpointIds,
    chooseFctEndpoint,
    discoveredViews,
    effectiveCompareFacet,
    effectivePageSize,
    effectiveResultsTotalCount,
    endpointReadyForQuery,
    expandedUris,
    facetHoverPreview,
    fctEndpoints,
    groupBatchSize,
    groupByBeforeCodeViewRef,
    groupByOptions,
    groupByPropertyUri,
    groupCardRefs,
    groupHasMoreBatches,
    groupMembers,
    groupUiPage,
    groupValues,
    groupValuesError,
    groupValuesLoading,
    histogramColumns,
    initialBrowseTriggered,
    isCompareAnalysis,
    isLoadingAlphabet,
    isRootView,
    isSearching,
    liveQueryHasText,
    navigateResultBadge,
    personalSparqlEndpoint,
    preferredAlphabetLanguage,
    prettyQueryXml,
    querySourceFormat,
    queryTree,
    queryTreeHeightPercent,
    queryTreeOpen,
    readyAnalysisValues,
    renderQueryNode,
    resetQuery,
    results,
    resultsBatchRequestPending,
    resultsBatchSize,
    resultsListValuesSparql,
    resultsListValuesXml,
    resultsLoadedQueryIdentityRef,
    resultsPageComplete,
    resultsPageSize,
    resultsPageSizeOptions,
    resultsRawResponse,
    resultsUiPage,
    search,
    searchError,
    searchNode,
    selectedAnalysisUri,
    selectedEndpointId,
    selectedGroupByOption,
    selectedUri,
    selectedView,
    selectedViewUri,
    setAnalysisSelection,
    setAssistantPendingPrompt,
    setAssistantPromptDraft,
    setCentralTab,
    setCompareFacet,
    setExpandedUris,
    setGroupBatchOffset,
    setGroupBatchSize,
    setGroupByPropertyUri,
    setGroupHasMoreBatches,
    setGroupUiPage,
    setGroupValues,
    setNodeAttribute,
    setPropertyValue,
    setQuerySourceFormat,
    setQueryTreeHeightPercent,
    setQueryTreeOpen,
    setResults,
    setResultsPage,
    setResultsPageSize,
    setResultsUiPage,
    setRoleValue,
    setSearch,
    setSearchPipelineRun,
    setSelectedUri,
    setSelectedViewUri,
    setShowResultBadges,
    setWorkspaceTab,
    showResultBadges,
    sourceSparql,
    toggleAnalysisRow,
    tutorialMode,
    uriNode,
    urlStateInitialized,
    viewDiscoveryError,
    viewDiscoveryLoading,
    viewFeature,
    viewFeatureCount,
    viewFeatureError,
    viewFeatureHtml,
    viewFeatureLoading,
    viewHtml,
    viewRenderError,
    visibleGroupValues,
    visibleResultsPage,
    workspaceTab,
  } = workspace;
  const { renderScopeValueBadge, renderRootBreadcrumb, renderPathBreadcrumb } = createBreadcrumbRenderers(workspace);
  return (
<ResizablePanel defaultSize={workspaceTab === "browse" ? 45 : 75} minSize={25} className="min-w-0">
            <section ref={centralPaneRef} className="flex h-full min-h-0 min-w-0 flex-col border-r">
              <div className={`group/header shrink-0 border-b px-3 pb-3 pt-0 ${centralTab === "chat" || workspaceTab !== "browse" ? "hidden" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
                  <span className="shrink-0 text-muted-foreground">
                    <IncompleteWidgetIndicator source={centralTab === "groups" ? "groups" : "results"} /> Group <strong className="font-semibold text-foreground">{effectiveResultsTotalCount !== null ? shortenCount(effectiveResultsTotalCount) : "many"}</strong> results by:
                  </span>
                  <div className="relative flex min-w-[8rem] max-w-full flex-1 items-center">
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
                    className="w-full min-w-0 appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {groupByOptions.map((option) => <option key={option.key || "none"} value={option.key}>{option.label}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 size-4 text-muted-foreground" />
                  </div>
                  <label htmlFor="results-page-size" className="shrink-0 text-muted-foreground">in pages of</label>
                  <div className="relative inline-flex shrink-0 items-center">
                  <select
                    id="results-page-size"
                    aria-label="Results page size"
                    value={effectivePageSize}
                    disabled={isSearching}
                    onChange={(event) => {
                      const nextSize = Number(event.currentTarget.value);
                      if (!resultsPageSizeOptions.includes(nextSize)) return;
                      try {
                        maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY, String(nextSize));
                      } catch {
                        // Storage can be disabled; the current selection still applies.
                      }
                      setResultsPageSize(nextSize);
                      setResultsUiPage(0);
                      setGroupUiPage(0);
                    }}
                    className="h-9 min-w-[4.5rem] appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm"
                  >
                    {resultsPageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground" />
                  </div>
                  <span aria-hidden="true" className="mx-1 h-6 border-l border-border" />
                  <label htmlFor="results-batch-size" className="shrink-0 text-muted-foreground">Batch size</label>
                  <div className="relative inline-flex shrink-0 items-center">
                  <select
                    id="results-batch-size"
                    aria-label="Server batch size"
                    value={centralTab === "groups" && selectedGroupByOption ? groupBatchSize : resultsBatchSize}
                    disabled={isSearching || groupValuesLoading}
                    onChange={(event) => {
                      const nextSize = Number(event.currentTarget.value);
                      if (!RESULTS_BATCH_SIZE_OPTIONS.some((size) => size === nextSize)) return;
                      if (centralTab === "groups" && selectedGroupByOption) {
                        maestroStorageSet(CENTER_GROUP_LIMIT_STORAGE_KEY, String(nextSize));
                        setGroupBatchSize(nextSize);
                        setGroupBatchOffset(0);
                        setGroupUiPage(0);
                        setGroupHasMoreBatches(false);
                        setGroupValues([]);
                      } else {
                        maestroStorageSet(CENTER_PANEL_LIMIT_STORAGE_KEY, String(nextSize));
                        setResultsUiPage(0);
                        setResults([]);
                        resultsLoadedQueryIdentityRef.current = "";
                        setResultsPage(nextSize, 0);
                      }
                    }}
                    className="h-9 min-w-[5rem] appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm"
                  >
                    {RESULTS_BATCH_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground" />
                  </div>
                  {selectedGroupByOption ? <><span aria-hidden="true" className="mx-1 h-6 border-l border-border" /><span className="shrink-0 text-muted-foreground">{groupValuesLoading ? "…" : `${visibleGroupValues.length} ${visibleGroupValues.length === 1 ? "group" : "groups"}`}</span></> : null}
                </div>
              </div>

              {/* An active alphabet restriction must remain visible and toggleable even when
                  subsequent filters eliminate its count or the alphabet preflight fails. */}
              {workspaceTab === "browse" && centralTab === "results" && (alphabetPreflight === "available" || Boolean(alphabetIndex)) && (
                <div id="maestro-alphabet" className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2" aria-label="Alphabetical browse by selected label properties">
                  {!isLoadingAlphabet && <IncompleteWidgetIndicator source="alphabet" />}
                  {Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").filter((letter) => (alphabetCounts[letter] ?? 0) > 0 || parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`)).map((letter) => (
                    <button key={letter} type="button" title={`Letter ${letter}; Shift-click excludes the letter; multiple selections are OR`} aria-label={`Letter ${letter}: ${alphabetCounts[letter] ?? 0} results`} aria-pressed={parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`)}
                      disabled={isLoadingAlphabet || (!alphabetCounts[letter] && !parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`))}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`) ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "border-border hover:bg-accent hover:text-accent-foreground"}`}
                      onClick={(event) => {
                        setNodeAttribute("query-view", "indexLabels", alphabetLabelUris);
                        setNodeAttribute("query-view", "indexLang", preferredAlphabetLanguage);
                        setNodeAttribute("query-view", "index", toggleAlphabetSelection(alphabetIndex, letter, event.shiftKey) || null);
                        setResultsUiPage(0); setResults([]); setResultsPage(resultsBatchSize, 0);
                      }}>
                      <span className="font-medium">{parseAlphabetSelections(alphabetIndex).includes(`!${letter}`) ? <><Ban aria-label="Excluded" className="mr-1 inline size-3.5" />{letter}</> : letter}</span>
                      <Separator orientation="vertical" className="mx-1 h-4 bg-current opacity-30 data-vertical:self-center" />
                      <span className={`tabular-nums font-normal ${parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`) ? "text-primary-foreground/65" : "text-muted-foreground"}`}>{shortenCount(alphabetCounts[letter] ?? 0)}</span>
                    </button>
                  ))}
                  {isLoadingAlphabet && <span className="text-xs text-muted-foreground"><ElapsedStatus label="Fetching alphabet" category="alphabet" clockScope="alphabet" requestWaves={26} /></span>}
                  {alphabetError && !Object.values(alphabetCounts).some((count) => count > 0) && <span className="text-xs text-destructive" title={alphabetError}>Alphabet unavailable</span>}
                </div>
              )}

              {workspaceTab === "browse" && ((centralTab === "results" && (resultsUiPage > 0 || results.length > resultsPageSize ||
                (effectiveResultsTotalCount === null && !resultsPageComplete && results.length > 0) ||
                (effectiveResultsTotalCount !== null && effectiveResultsTotalCount > resultsPageSize)) ||
                centralTab === "groups" && selectedGroupByOption && (groupValues.length > resultsPageSize || groupHasMoreBatches))) && (
                <div className="flex min-h-[42px] shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
                  <span className="text-muted-foreground" aria-live="polite">
                    {centralTab === "groups"
                      ? formatPagePosition(groupUiPage, Math.max(1, Math.ceil(groupValues.length / resultsPageSize)), groupHasMoreBatches)
                      : effectiveResultsTotalCount === null
                        ? formatPagePosition(resultsUiPage, resultsPageComplete ? Math.max(1, Math.ceil(results.length / resultsPageSize)) : null)
                        : formatPagePosition(resultsUiPage, Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize)))}
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
                      disabled={isSearching || groupValuesLoading || (centralTab === "groups"
                        ? ((groupUiPage + 1) * resultsPageSize >= groupValues.length && !groupHasMoreBatches)
                        : effectiveResultsTotalCount === null
                          ? (results.length <= (resultsUiPage + 1) * resultsPageSize && (resultsPageComplete || resultsBatchRequestPending.current))
                          : resultsUiPage + 1 >= Math.ceil(effectiveResultsTotalCount / resultsPageSize))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
              <ViewTabCanvas workspace={workspace} />
              <AnalyzeTabCanvas workspace={workspace} />

              <BrowseResultsCanvas workspace={workspace} />

              <BrowseChatCanvas workspace={workspace} />

              <BrowseGroupsCanvas workspace={workspace} />

              {centralTab === "view-query" && (
                <div
                  id="central-panel-view-query"
                  role="tabpanel"
                  aria-labelledby="central-tab-view-query"
                  className="min-h-0 flex-1 overflow-auto p-3"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <ButtonGroup aria-label="Query source format" className="flex h-auto min-w-0 flex-wrap gap-1">
                      <Toggle pressed={querySourceFormat === "xml"} onPressedChange={(pressed) => { if (pressed) { setQuerySourceFormat("xml"); } }} className="rounded-none border-0 px-3 py-1.5 text-xs">XML</Toggle>
                      <Toggle pressed={querySourceFormat === "sparql"} onPressedChange={(pressed) => { if (pressed) { setQuerySourceFormat("sparql"); } }} className="rounded-none border-0 px-3 py-1.5 text-xs">SPARQL</Toggle>
                      <Toggle pressed={querySourceFormat === "alphabet-xml"} onPressedChange={(pressed) => { if (pressed) { setQuerySourceFormat("alphabet-xml"); } }} className="rounded-none border-0 px-3 py-1.5 text-xs">Alphabet XML</Toggle>
                      <Toggle pressed={querySourceFormat === "alphabet-sparql"} onPressedChange={(pressed) => { if (pressed) { setQuerySourceFormat("alphabet-sparql"); } }} className="rounded-none border-0 px-3 py-1.5 text-xs">Alphabet SPARQL</Toggle>
                      {showResultBadges && <>
                        <Toggle pressed={querySourceFormat === "list-values-xml"} onPressedChange={(pressed) => { if (pressed) { setQuerySourceFormat("list-values-xml"); } }} className="h-auto min-w-0 whitespace-normal rounded-none border-0 px-3 py-1.5 text-xs">List-Values XML</Toggle>
                        <Toggle pressed={querySourceFormat === "list-values-sparql"} onPressedChange={(pressed) => { if (pressed) { setQuerySourceFormat("list-values-sparql"); } }} className="h-auto min-w-0 whitespace-normal rounded-none border-0 px-3 py-1.5 text-xs">List-Values SPARQL</Toggle>
                      </>}
                      <Toggle pressed={querySourceFormat === "response"} onPressedChange={(pressed) => { if (pressed) { setQuerySourceFormat("response"); } }} className="rounded-none border-0 px-3 py-1.5 text-xs">FCT response</Toggle>
                    </ButtonGroup>
                    <button type="button" onClick={() => { setCentralTab(groupByPropertyUri ? "groups" : "results"); setQueryTreeOpen(true); }} className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">Back to Query</button>
                  </div>
                  <CodeBlock
                    className="h-full min-h-0"
                    language={(querySourceFormat === "xml" || querySourceFormat === "alphabet-xml" || querySourceFormat === "list-values-xml" || querySourceFormat === "response") ? "xml" : "sparql"}
                    code={querySourceFormat === "xml" ? prettyQueryXml
                      : querySourceFormat === "sparql" ? sourceSparql
                      : querySourceFormat === "alphabet-xml" ? xmlFormat(alphabetQueryXml, { indentation: "  " })
                      : querySourceFormat === "list-values-xml" && showResultBadges ? xmlFormat(resultsListValuesXml, { indentation: "  " })
                      : querySourceFormat === "list-values-sparql" && showResultBadges ? resultsListValuesSparql
                      : querySourceFormat === "response" ? resultsRawResponse
                      : alphabetSparql}
                    filename={querySourceFormat === "xml" ? "fct-query.xml"
                      : querySourceFormat === "sparql" ? "query.sparql"
                      : querySourceFormat === "alphabet-xml" ? "alphabet-query.xml"
                      : querySourceFormat === "list-values-xml" && showResultBadges ? "results-list-values.xml"
                      : querySourceFormat === "list-values-sparql" && showResultBadges ? "results-list-values.sparql"
                      : querySourceFormat === "response" ? "results-fct-response.xml"
                      : "alphabet-query.sparql"}
                  />
                </div>
              )}
              {/* Drag the separator to resize the Results / Query Tree split. */}
              {workspaceTab === "browse" && queryTreeOpen && <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize Query Tree height"
                aria-valuemin={15}
                aria-valuemax={75}
                aria-valuenow={Math.round(queryTreeHeightPercent)}
                tabIndex={0}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!(event.buttons & 1) || !centralPaneRef.current) return;
                  const bounds = centralPaneRef.current.getBoundingClientRect();
                  if (bounds.height <= 0) return;
                  const next = Math.max(15, Math.min(75, ((bounds.bottom - event.clientY) / bounds.height) * 100));
                  setQueryTreeHeightPercent(Math.round(next * 10) / 10);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  setQueryTreeHeightPercent((height) => Math.max(15, Math.min(75, height + (event.key === "ArrowUp" ? 2 : -2))));
                }}
                className="z-10 flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center border-y border-border bg-muted/70 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              ><span className="h-0.5 w-10 rounded-full bg-muted-foreground/60" /></div>}
              {/* Query Tree pane: its height is user-resizable and persisted in IndexedDB. */}
              <BrowseQueryTreeCanvas workspace={workspace} />
              {workspaceTab === "browse" && <div className="group/header shrink-0 border-t bg-muted p-3">
                {centralTab === "chat" ? (
                  <div id="maestro-assistant-composer-slot" className="w-full" />
                ) : (<>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <input
                      onFocus={() => setCentralTab("chat")}
                      aria-label="Ask the assistant"
                      placeholder="Message Maestro…"
                      value={assistantPromptDraft}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAssistantPromptDraft(value);
                        if (value.length > 0) setCentralTab("chat");
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.shiftKey) return;
                        event.preventDefault();
                        const text = assistantPromptDraft.trim();
                        if (!text) return;
                        const id = ++assistantPromptIdRef.current;
                        setAssistantPendingPrompt({ id, text });
                        setAssistantPromptDraft("");
                        setCentralTab("chat");
                      }}
                      className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <ButtonGroup
                    aria-label="Results, badges, and query inspector"
                    className="hidden shrink-0 items-center [&>*+*]:border-l [&>*+*]:border-input group-hover/header:inline-flex"
                  >
                    <Tooltip>
                      <TooltipTrigger render={
                        <Toggle
                          pressed={queryTreeOpen}
                          onPressedChange={setQueryTreeOpen}
                          className="size-9 shrink-0 border-0 p-0 text-sm data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                          aria-label={queryTreeOpen ? "Hide Query Tree" : "Show Query Tree"}
                          aria-controls="central-panel-query-tree"
                          aria-expanded={queryTreeOpen}
                        >
                          <ListTree aria-hidden="true" className="size-4" />
                        </Toggle>
                      } />
                      <TooltipContent>{queryTreeOpen ? "Hide Query Tree" : "Show Query Tree"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={
                        <Toggle
                          pressed={showResultBadges}
                          onPressedChange={(pressed) => {
                            setShowResultBadges(pressed);
                            if (!pressed && (querySourceFormat === "list-values-xml" || querySourceFormat === "list-values-sparql")) setQuerySourceFormat("xml");
                            // Badge enrichment independently projects rdf:type; toggling
                            // presentation must not mutate the authoritative FCT query.
                          }}
                          className="size-9 shrink-0 border-0 p-0 text-sm data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                          aria-label={showResultBadges ? "Badges On" : "Badges Off"}
                        >
                          {showResultBadges ? <Tags aria-hidden="true" className="size-4" /> : <Tag aria-hidden="true" className="size-4" />}
                        </Toggle>
                      } />
                      <TooltipContent>{showResultBadges ? "Badges On" : "Badges Off"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={
                        <Toggle
                          pressed={centralTab === "view-query"}
                          onPressedChange={(pressed) => {
                            if (pressed) {
                              groupByBeforeCodeViewRef.current = groupByPropertyUri;
                              setCentralTab("view-query");
                            } else {
                              const retainedGroupBy = groupByBeforeCodeViewRef.current || groupByPropertyUri;
                              if (retainedGroupBy) setGroupByPropertyUri(retainedGroupBy);
                              setCentralTab(retainedGroupBy ? "groups" : "results");
                            }
                          }}
                          className="size-9 shrink-0 border-0 p-0 text-sm data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                          aria-label="View source"
                        >
                          <Code2 aria-hidden="true" className="size-4" />
                        </Toggle>
                      } />
                      <TooltipContent>View source</TooltipContent>
                    </Tooltip>
                  </ButtonGroup>
                </div>
                {searchError && endpointReadyForQuery && <p className="mt-2 text-sm text-destructive">{searchError}{searchError.includes("Could not load graphs from the personal SPARQL store") && <> Check that your <a href={personalSparqlEndpoint || undefined} target="_blank" rel="noreferrer" className="underline underline-offset-2">personal graph server</a> is online.</>}</p>}
                </>)}
              </div>}
            </section>
            </ResizablePanel>
  );
}
