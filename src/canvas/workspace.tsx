"use client";

import { PersonalWidgetQueryListener } from "@/canvas/left/filter";

import { BrowseRibbon } from "@/canvas/tab/browse/ribbon";

import { ViewRibbon } from "@/canvas/tab/view/ribbon";
import { AnalyzeRibbon } from "@/canvas/tab/analyze/ribbon";

import maestroLanguages from "@/data/maestro-languages.json";

import { rememberShortforms, toLabel } from "@/lib/uri-labels";
import { proxyDebugHeaders } from "@/lib/proxy-debug";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Toaster, toast } from "@/components/ui/toast";

import { clearClientQueryCache } from "@/lib/client-query-cache";

import { clearMaestroStorage } from "@/lib/maestro-storage";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { WorkspaceSkeleton } from "@/canvas/workspace-skeleton";
import { ResizableHandle, ResizablePanelGroup } from "@/components/ui/resizable";
import { CodeBlock } from "@/components/ui/code-block";

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

import { useWorkspaceController } from "@/canvas/utils/workspace-controller";
import { createBreadcrumbRenderers } from "@/canvas/top/breadcrumb-renderers";
import { AppBarSection } from "@/canvas/top/appbar-pane";
import { LeftCanvasPanel } from "@/canvas/left/pane";
import { CenterCanvasPanel } from "@/canvas/center/pane";
import { RightCanvasPanel } from "@/canvas/right/pane";

/** Workbench composition. The route entry does not own query, record, or facet state. */
export function MaestroWorkspace() {
  const workspace = useWorkspaceController();
  // Keep the loading skeleton aligned with the actual resizable workspace widths.
  // The layout callback is triggered on resize; switching into loading does not
  // unmount this state, so there is no layout jump or second width preference.
  const [workspacePanelWidths, setWorkspacePanelWidths] = useState<number[]>([25, 45, 30]);
  const { renderRootBreadcrumb, renderPathBreadcrumb } = createBreadcrumbRenderers(workspace);
  const {
    FACET_PAGE_SIZE,
    RECORD_DESCRIPTION_PAGE_SIZE,
    activeBlankNodeTab,
    activeBreadcrumbIndex,
    activeLeafId,
    activePropertyFilters,
    activeQueryIdentityRef,
    activeRoleFilters,
    activeViewPropertyFilters,
    alphabetCounts,
    alphabetError,
    alphabetIndex,
    alphabetLabelUris,
    alphabetPreflight,
    alphabetQueryXml,
    alphabetSparql,
    analysisColumnWidths,
    analysisDefinitions,
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
    applyGraphText,
    applyRecordAsRootValue,
    assistantPendingPrompt,
    assistantPromptDraft,
    assistantPromptIdRef,
    authRestoreIssue,
    authSession,
    autoConfigureFacetCount,
    autoConfiguredFacetKeys,
    availableCompareFacets,
    beginFacetHoverPreview,
    beginRecordHoverPreview,
    bindGraph,
    blankNodeRecords,
    bookmarkDescription,
    bookmarkDialogOpen,
    bookmarkImportFileRef,
    bookmarkQueryDebug,
    bookmarkQueryDebugOpen,
    bookmarkSaving,
    bookmarkTagVocabulary,
    bookmarkTags,
    bookmarkTitle,
    bookmarkTitleInputRef,
    browserLogLevel,
    browserLogging,
    categoriesIncomplete,
    categoriesTreeMode,
    categoriesWidgetRef,
    categoryPageCount,
    categoryTreeAllCollapsed,
    categoryTreePages,
    categoryTreeParentKeys,
    centralPaneRef,
    centralTab,
    changeResultsPage,
    changeWidgetTimeout,
    checkSelectedGraphServer,
    checkingEndpointIds,
    chooseFctEndpoint,
    classFacetError,
    classFacetWarning,
    classFacets,
    classesPage,
    clearCacheDialogOpen,
    clearGraph,
    clearTutorialPreview,
    controlsSheetOpen,
    currentFormattedRecordHtml,
    currentRecordDescriptionKey,
    defaultLeftTab,
    deleteBookmarks,
    deleteCurrentQueryHistory,
    deleteHistoryDialogOpen,
    deleteNode,
    deleteQueryHistory,
    describedProperties,
    describedPropertyCount,
    describedPropertyRows,
    describedRecord,
    describedRecordUri,
    describedRoleCount,
    describedRoleRows,
    discoveredViews,
    displayedRecord,
    displayedRecordPage,
    displayedRecordPageCount,
    downloadRecordDescribe,
    effectiveCompareFacet,
    effectivePageSize,
    effectiveResultsTotalCount,
    endpointChecksCompleted,
    endpointChecksTotal,
    endpointHealthToast,
    endpointMenuError,
    endpointReadyForQuery,
    graphRegistryReady,
    endpointStatuses,
    exitEverywhere,
    expandedCategoryNodes,
    expandedUris,
    exportBookmarks,
    facetCandidateCounts,
    facetHoverPreview,
    fctEndpoints,
    fetchedAvatarUrl,
    findEndpointsEnabled,
    focusListOrder,
    focusWidgetsSuppressed,
    formatHistoryAction,
    formattedRecordButtonsHtml,
    formattedRecordContainerRef,
    graphAlreadySelected,
    graphAutoFill,
    graphFacets,
    graphHasMore,
    graphInfo,
    graphInfoOpen,
    graphListSparql,
    graphPageCount,
    graphProbe,
    graphProbeIdentity,
    graphSort,
    graphSortPickerExpanded,
    graphText,
    graphsPage,
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
    groupedPersonalFacetUri,
    groupedRoleUri,
    handleFacetShiftClick,
    handleFetchProfile,
    handleLoginSubmit,
    handlePropertyCheckboxChange,
    handleRoleCheckboxChange,
    handleTestConnection,
    histogramColumns,
    historyActionItems,
    historyActionMenu,
    historyBookmarkId,
    historyHasNewer,
    historyHasOlder,
    historyHoverTimerRef,
    historyNavigationPending,
    historyVisitIdRef,
    historyVisitQueryRef,
    historyWriteQueueRef,
    hoveredFacetKey,
    importBookmarks,
    initialBrowseTriggered,
    invokeRecordService,
    isCheckingEndpoints,
    isCompareAnalysis,
    isDeletingCurrentHistory,
    isDeletingHistory,
    isDescribing,
    isExportingBookmarks,
    isFacetExcluded,
    isFetchingAvatar,
    isGroupByCategory,
    isImportingBookmarks,
    isLoadingAlphabet,
    isLoadingClasses,
    isLoadingGraphs,
    isLoadingHistoryQuery,
    isLoadingProperties,
    isLoadingRecordPolicy,
    isLoadingRoles,
    isQueryBookmarked,
    isRdfLoaderOpen,
    isRdfLoading,
    isRefreshingFailedEndpoint,
    isRootView,
    isSearching,
    isValidatingRecord,
    leftPanelLimit,
    leftWidgetLimits,
    liveQueryHasText,
    loadHistoryQuery,
    loadingRecordAuthors,
    loadingRecordGraphs,
    localStorageUsageBytes,
    loginDialogOpen,
    loginError,
    loginGraphPrefix,
    loginGraphStore,
    loginOauthProfileUrl,
    loginOauthToken,
    loginOauthUserName,
    loginPassword,
    loginShowPassword,
    loginTab,
    loginTesting,
    loginUsername,
    loginWebIdUri,
    manualRecordFormatSelectionRef,
    matchingBookmarkId,
    navigateIntoRelationship,
    navigateQueryHistory,
    navigateResultBadge,
    navigateToPropertyPath,
    openGraphInfo,
    openRecordPropertyUri,
    orderResults,
    pagedUnselectedClasses,
    panelLimitsOpen,
    pendingCenterBatchLimit,
    pendingGroupsBatchLimit,
    pendingHistoryVisitRef,
    pendingLeftPanelLimit,
    pendingRecordDescriptionLimit,
    personalRoleFacetNodes,
    personalSparqlEndpoint,
    personalWidgets,
    preferredAlphabetLanguage,
    prefixSource,
    prefixStatus,
    prettyQueryXml,
    propertiesPage,
    propertyFacetError,
    propertyFacetWarning,
    propertyFacets,
    queryRefreshRevision,
    querySourceFormat,
    queryTree,
    queryTreeHeightDbRef,
    queryTreeHeightPercent,
    queryTreeOpen,
    queryWithoutPagingXml,
    queryXml,
    rdfSourceUrl,
    rdfTargetGraph,
    readyAnalysisValues,
    recordAuthorError,
    recordAuthors,
    recordControlsOpen,
    recordDebug,
    recordDescribeIncomplete,
    recordDescriptionError,
    recordDescriptionPageSize,
    recordDescriptionQueryLimit,
    recordDescriptionSnapshot,
    recordFormatEnabled,
    recordFormatError,
    recordFormatMenuOpen,
    recordFormatPreferenceKey,
    recordFormatPreferenceLoaded,
    recordFormatPreviews,
    recordGraphError,
    recordGraphOptions,
    recordGraphs,
    recordPolicies,
    recordPolicy,
    recordPolicyCheckedUri,
    recordPolicyError,
    recordRootDebugQuery,
    recordServiceArguments,
    recordServiceDom,
    recordServiceResults,
    recordServiceTab,
    recordServices,
    recordUriLabelCacheRef,
    recordValidation,
    refreshFailedEndpointAndRetry,
    refreshMaestroPage,
    refreshQuery,
    renderQueryNode,
    resetQuery,
    restoreHistoryActionItem,
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
    roleFacetError,
    roleFacetWarning,
    roleFacets,
    roleWidgetCardRefs,
    roleWidgetStatuses,
    rolesPage,
    runAutoConfigure,
    scrollToGroupForFacetValue,
    search,
    searchError,
    searchNode,
    selectedAnalysisUri,
    selectedClassDisplayFacets,
    selectedClasses,
    selectedEndpointId,
    selectedEndpointStatus,
    selectedGroupByOption,
    selectedGroupRecord,
    selectedProperties,
    selectedRecordAuthor,
    selectedRecordGraph,
    selectedRecordTemplateUri,
    selectedRecordTermType,
    selectedResult,
    selectedRoles,
    selectedUri,
    selectedView,
    selectedViewUri,
    setActiveBlankNodeTab,
    setAnalysisSelection,
    setAnalyzeHistogram,
    setAssistantPendingPrompt,
    setAssistantPromptDraft,
    setAuthRestoreIssue,
    setAuthSession,
    setAutoConfiguredFacetKeys,
    setBookmarkCheckRevision,
    setBookmarkDescription,
    setBookmarkDialogOpen,
    setBookmarkQueryDebugOpen,
    setBookmarkSaving,
    setBookmarkTagVocabulary,
    setBookmarkTags,
    setBookmarkTitle,
    setBrowserLogLevel,
    setBrowserLogging,
    setCentralTab,
    setClassesPage,
    setClearCacheDialogOpen,
    setCompareFacet,
    setControlsSheetOpen,
    setDefaultLeftTab,
    setDeleteHistoryDialogOpen,
    setDescribedRecord,
    setEndpointHealthToast,
    setEndpointReloadRevision,
    setExpandedCategoryNodes,
    setExpandedUris,
    setExplicitBlankNodeAnchor,
    setFacetAutofillCandidates,
    setFacetUsageRevision,
    setFindEndpointsEnabled,
    setFocusListOrder,
    setFormattedRecordButtonsHtml,
    setFormattedRecordHtml,
    setGraphAutoFill,
    setGraphInfoOpen,
    setGraphSort,
    setGraphSortPickerExpanded,
    setGraphText,
    setGraphsPage,
    setGroupBatchOffset,
    setGroupBatchSize,
    setGroupByPropertyUri,
    setGroupHasMoreBatches,
    setGroupUiPage,
    setGroupValues,
    setHistoryBookmarkId,
    setHoveredFacetKey,
    setIsQueryBookmarked,
    setIsRdfLoaderOpen,
    setIsRdfLoading,
    setLocalStorageUsageBytes,
    setLoginDialogOpen,
    setLoginGraphPrefix,
    setLoginGraphStore,
    setLoginOauthProfileUrl,
    setLoginOauthToken,
    setLoginOauthUserName,
    setLoginPassword,
    setLoginShowPassword,
    setLoginTab,
    setLoginUsername,
    setLoginWebIdUri,
    setMatchingBookmarkId,
    setNodeAttribute,
    setOrderResults,
    setPanelLimitsOpen,
    setPendingCenterBatchLimit,
    setPendingGroupsBatchLimit,
    setPendingLeftPanelLimit,
    setPendingRecordDescriptionLimit,
    setPersonalPoliciesReady,
    setPersonalPoliciesSeedError,
    setPersonalWidgets,
    setPreferredAlphabetLanguage,
    setPrefixSource,
    setPropertiesPage,
    setPropertyValue,
    setQueryAttribute,
    setQuerySourceFormat,
    setQueryTreeHeightPercent,
    setQueryTreeOpen,
    setRdfSourceUrl,
    setRdfTargetGraph,
    setRecordControlsOpen,
    setRecordDescriptionPage,
    setRecordDescriptionPageSize,
    setRecordDescriptionSnapshot,
    setRecordFormatEnabled,
    setRecordFormatError,
    setRecordFormatMenuOpen,
    setRecordPolicy,
    setRecordServiceTab,
    setRecordValidation,
    setResults,
    setResultsPage,
    setResultsPageSize,
    setResultsUiPage,
    setRoleValue,
    setRoleWidgetStatuses,
    setRolesPage,
    setSearch,
    setSearchPipelineRun,
    setSelectedAnalysisUri,
    setSelectedFacet,
    setSelectedRecordAuthor,
    setSelectedRecordGraph,
    setSelectedRecordTemplateUri,
    setSelectedUri,
    setSelectedViewUri,
    setShareLinkCopied,
    setShowResultBadges,
    setTimeoutEditorOpen,
    setTutorialMode,
    setViewFeature,
    setViewPanel,
    setWidgetTimeouts,
    setWorkspaceTab,
    shareLinkCopied,
    shiftKeyDown,
    showClassResults,
    showConfigureProperties,
    showConfigureRoles,
    showPropertiesSpinner,
    showResultBadges,
    showRolesSpinner,
    sourceSparql,
    startHistoryActionHover,
    stopHistoryActionHover,
    timeoutEditorOpen,
    toggleAnalysisRow,
    toggleClass,
    tutorialBreadcrumbPath,
    tutorialMode,
    uriNode,
    urlStateInitialized,
    validateSelectedRecord,
    viewDiscoveryError,
    viewDiscoveryLoading,
    viewFeature,
    viewFeatureCount,
    viewFeatureError,
    viewFeatureHtml,
    viewFeatureLoading,
    viewHtml,
    viewPanel,
    viewRenderError,
    visibleClassDisplayFacets,
    visibleGroupValues,
    visibleResultsPage,
    widgetTimeouts,
    workspaceTab,
  } = workspace;
  // Do not mount toolbar/panes until share-URL state has been restored.
  // This prevents default toggle values appearing for a frame and avoids
  // mounting query-dependent widget effects with provisional query state.
  if (!urlStateInitialized) return null;
  // Inspect all explicit <class> constraints, including nested breadcrumb scopes.
  // Superclass closure is resolved by the personal ontology graph on the server.
  const queryClassUris: string[] = [];
  const collectQueryClasses = (nodes: typeof queryTree.children) => {
    for (const node of nodes) {
      if (node.name === "class" && node.attributes.iri) queryClassUris.push(node.attributes.iri);
      collectQueryClasses(node.children);
    }
  };
  collectQueryClasses(queryTree.children);
  // Use the identical live ribbon in both ready and loading layouts.
  const workspaceRibbon = (workspaceTab === "browse" ? <BrowseRibbon breadcrumbs={<>{renderRootBreadcrumb()}{tutorialBreadcrumbPath.map((crumb, index) => renderPathBreadcrumb(crumb, index))}</>} /> : workspaceTab === "view" ? <ViewRibbon viewPanel={viewPanel} setViewPanel={setViewPanel} breadcrumbs={<>{renderRootBreadcrumb()}{tutorialBreadcrumbPath.map((crumb, index) => renderPathBreadcrumb(crumb, index))}</>} discoveredViews={discoveredViews} viewFeature={viewFeature} setViewFeature={setViewFeature} onSelectFeature={workspace.selectViewFeature} selectedViewUri={selectedViewUri} onSelectView={(uri) => { setSelectedViewUri(uri); setViewFeature(null); }} viewDiscoveryLoading={viewDiscoveryLoading} queryClassUris={queryClassUris} queryXml={queryXml} triggerUri={selectedUri || matchingBookmarkId || ""} historyUri={historyVisitQueryRef.current === queryXml ? (historyVisitIdRef.current || historyBookmarkId) : undefined} /> : <AnalyzeRibbon analysisDefinitions={analysisDefinitions} selectedAnalysisUri={selectedAnalysisUri} analyzeHistogram={analyzeHistogram} isCompareAnalysis={isCompareAnalysis} firstBreadcrumbLabel={tutorialBreadcrumbPath[0] ? toLabel(tutorialBreadcrumbPath[0].uri, "Property") : undefined} firstResultTitle={visibleResultsPage[0]?.title} onSelectAnalysis={(uri) => { setSelectedAnalysisUri(uri); setAnalyzeHistogram(false); }} onSelectHistogram={(uri) => { setSelectedAnalysisUri(uri); setAnalyzeHistogram(true); }} />);
  if (!graphRegistryReady || selectedEndpointStatus?.state !== "ok" || selectedEndpointStatus.status !== 200) return (
    <main className="flex h-dvh min-h-[500px] flex-col bg-background text-foreground">
      <Toaster />
      <AppBarSection workspace={workspace} />
      <WorkspaceSkeleton
        ribbon={workspaceRibbon}
        panelWidths={workspacePanelWidths}
        onLayout={(sizes: number[]) => {
          if (sizes.length === 3 && sizes.every((size) => Number.isFinite(size) && size > 0)) {
            setWorkspacePanelWidths((previous) => sizes.every((size, index) => Math.abs(size - (previous[index] ?? 0)) < 0.01) ? previous : [...sizes]);
          }
        }}
        message={!graphRegistryReady ? "Loading graph servers" : "Checking selected graph server"}
        error={endpointMenuError || endpointHealthToast?.message}
      />
    </main>
  );

  return (
    <main className="flex h-dvh min-h-[500px] flex-col bg-background text-foreground">
      <Toaster />
      {endpointHealthToast && <div role="alert" className="fixed bottom-5 right-5 z-[200] flex max-w-md items-center gap-3 rounded-lg border border-destructive/40 bg-popover p-4 text-popover-foreground shadow-xl">
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-destructive">Graph server health check failed</div><div className="mt-1 text-sm">{endpointHealthToast.message}</div></div>
        <button type="button" className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50" disabled={isRefreshingFailedEndpoint} onClick={() => void refreshFailedEndpointAndRetry()}>{isRefreshingFailedEndpoint ? "Refreshing…" : "Refresh"}</button>
        <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss health check error" onClick={() => setEndpointHealthToast(null)}>×</button>
      </div>}
      <AlertDialog open={clearCacheDialogOpen} onOpenChange={setClearCacheDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Maestro cache?</AlertDialogTitle>
            <AlertDialogDescription>Clear all localStorage data saved by this site? This resets saved settings and reloads Maestro.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => {
              try {
                await clearClientQueryCache();
                await clearMaestroStorage();
                window.localStorage.clear();
                window.location.reload();
              } catch {
                toast.add({ title: "Could not clear cache", description: "Check your browser's site storage permissions.", type: "error" });
                setClearCacheDialogOpen(false);
              }
            }}>Clear Cache</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteHistoryDialogOpen} onOpenChange={(open) => { if (!isDeletingHistory) setDeleteHistoryDialogOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete query History?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete all Maestro query History visits from your personal RDF store? This cannot be undone. Saved query bookmarks will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingHistory}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isDeletingHistory} onClick={(event) => { event.preventDefault(); void deleteQueryHistory(); }}>
              {isDeletingHistory ? "Deleting…" : "Delete All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {isCheckingEndpoints && (
        <div className="fixed inset-x-0 top-0 z-[100] h-1.5 bg-muted" role="status" aria-label="Checking FCT endpoints">
          <Progress className="h-full rounded-none bg-muted" value={endpointChecksTotal > 0 ? (endpointChecksCompleted / endpointChecksTotal) * 100 : 0} indeterminate={endpointChecksTotal === 0 || endpointChecksCompleted === 0} aria-label="FCT endpoint check progress" />
        </div>
      )}
      {endpointReadyForQuery && personalWidgets.map((widget) => (
        <PersonalWidgetQueryListener
          key={widget.uri}
          propertyUri={widget.uri}
          sortByCount={centralTab === "groups" && groupByPropertyUri === `forward:${widget.uri}`}
          limit={leftWidgetLimits.personalFacets}
          groupBy={centralTab === "groups" && selectedGroupByOption && groupedPersonalFacetUri === widget.uri ? { option: selectedGroupByOption, limit: groupBatchSize } : undefined}
          setPersonalWidgets={setPersonalWidgets}
          endpointReady={endpointReadyForQuery}
          refreshRevision={queryRefreshRevision}
        />
      ))}

      <AppBarSection workspace={workspace} />

      <Dialog open={isRdfLoaderOpen} onOpenChange={(open) => { if (!isRdfLoading) setIsRdfLoaderOpen(open); }}>
        <DialogContent aria-labelledby="rdf-loader-title" className="w-full max-w-xl p-5">
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
                  toast.add({ title: "RDF load completed", description: data.message || "The RDF document was loaded into the target graph.", type: "success" });
                } catch (error) {
                  toast.add({ title: "RDF load failed", description: error instanceof Error ? error.message : "RDF load failed.", type: "error" });
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
        </DialogContent>
      </Dialog>

      {endpointMenuError && (
        <p role="alert" className="border-b px-4 py-1.5 text-xs text-destructive">
          <>{endpointMenuError}{endpointMenuError.includes("Could not load graphs from the personal SPARQL store") && <> Check that your <a href={personalSparqlEndpoint || undefined} target="_blank" rel="noreferrer" className="underline underline-offset-2">personal graph server</a> is online.</>}</>
        </p>
      )}

      <div className="shrink-0">
        {workspaceRibbon}

      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

          <ResizablePanelGroup key={workspaceTab} direction="horizontal" className="min-h-0 flex-1"
            onLayout={(sizes: number[]) => {
              if (sizes.length === 3 && sizes.every((size) => Number.isFinite(size) && size > 0)) {
                setWorkspacePanelWidths((previous) => sizes.every((size, index) => Math.abs(size - (previous[index] ?? 0)) < 0.01) ? previous : [...sizes]);
              }
            }}>
            <LeftCanvasPanel workspace={workspace} />
            <ResizableHandle withHandle />
            <CenterCanvasPanel workspace={workspace} />
            <RightCanvasPanel workspace={workspace} />
          </ResizablePanelGroup>

      </div>
      <Dialog open={bookmarkQueryDebugOpen} onOpenChange={setBookmarkQueryDebugOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Bookmark query Code Block</DialogTitle><DialogDescription>Inspect the bounded FCT query, the SPARQL returned by Virtuoso FCT, and both raw responses.</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto">
            <section><h3 className="mb-2 text-sm font-semibold">FCT query XML</h3><CodeBlock code={bookmarkQueryDebug.xml || "No saved query has run yet."} language="xml" filename="bookmark-history-query.xml" /></section>
            <section><h3 className="mb-2 text-sm font-semibold">Translated SPARQL</h3><CodeBlock code={bookmarkQueryDebug.sparql} language="sparql" filename="bookmark-history-query.sparql" /></section>
            <section><h3 className="mb-2 text-sm font-semibold">FCT results response</h3><CodeBlock code={bookmarkQueryDebug.response} language="xml" filename="bookmark-history-query-response.xml" /></section>
            <section><h3 className="mb-2 text-sm font-semibold">Count response</h3><CodeBlock code={bookmarkQueryDebug.countResponse} language="xml" filename="bookmark-history-query-count-response.xml" /></section>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
