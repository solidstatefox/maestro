"use client";

import { PersonalWidgetQueryListener } from "@/canvas/left/filter";

import { BrowseRibbon } from "@/canvas/tab/browse/ribbon";

import { ViewRibbon } from "@/canvas/tab/view/ribbon";
import { AnalyzeRibbon } from "@/canvas/tab/analyze/ribbon";
import { MaestroHoverExpand } from "@/components/ui/maestro-hover-expand";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { BrowsePanePositionContext, BrowsePanePreferenceContext, useBrowsePanePreference } from "@/canvas/browse-pane-layout";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { activeBrowsePaneOrder, browseSizesInOrder, browseSizesFromLayout } from "@/canvas/browse-pane-order";

import maestroLanguages from "@/data/maestro-languages.json";

import { rememberShortforms, toLabel } from "@/lib/uri-labels";
import { updatePersonal } from "@/lib/client-personal-sparql";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Toaster, toast } from "@/components/ui/toast";

import { clearClientQueryCache } from "@/lib/client-query-cache";
import { selectMaestroCapabilities } from "@/lib/app-lifecycle/access";

import { clearMaestroStorage } from "@/lib/maestro-storage";
import { Progress } from "@/components/ui/progress";
import { FacetsLoadingSkeleton, ResultsLoadingSkeleton } from "@/canvas/workspace-skeleton";
import { CenterPaneFrame, CenterPaneBody } from "@/canvas/workspace-pane-shells";
import { GraphUnavailableFacets, GraphUnavailableResults, GraphUnavailableRecord } from "@/canvas/workspace-unavailable";
import { selectWorkspaceSkeletonBoundaries, selectLeftPaneSkeletonWidgets } from "@/lib/app-lifecycle/skeleton-boundaries";
import { activeTransportedFacets, sameTransportedFacetIdentity } from "@/lib/fct-facet-alias";
import { propertyUsageScope } from "@/lib/property-usage-query";
import { AppLifecycleDiagnostics } from "@/canvas/diagnostics/app-lifecycle-diagnostics";
import { ResizableHandle, ResizablePanelGroup } from "@/components/ui/resizable";
import { CodeBlock } from "@/components/ui/code-block";
import { Button } from "@/components/ui/button";
import { FileWarning } from "lucide-react";
import { MaestroEmptyResults } from "@/components/ui/maestro-empty-results";
import { fctQueryExecutionAddress } from "@/lib/fct-query-clone";

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
import { readShareableUiState } from "@/canvas/utils/query-controller";
import type { LeftSkeletonPane } from "@/lib/app-lifecycle/skeleton-boundaries";
import { createBreadcrumbRenderers } from "@/canvas/top/breadcrumb-renderers";
import { RootAutocompleteQueryInspector } from "@/canvas/top/root-autocomplete-query-inspector";
import { AppBarSection } from "@/canvas/top/appbar-pane";
import { LeftCanvasPanel } from "@/canvas/left/pane";
import { CenterCanvasPanel } from "@/canvas/center/pane";
import { RightCanvasPanel } from "@/canvas/right/pane";

/** Workbench composition. The route entry does not own query, record, or facet state. */
export function MaestroWorkspace() {
  const workspace = useWorkspaceController();
  const browsePanePreference = useBrowsePanePreference();
  const [analyzeRibbonPanel, setAnalyzeRibbonPanel] = useState<"analytics" | "trail">("analytics");
  // The arriving share URL may specify Configure, but the controller begins at
  // Filters until its canonical restore commits the FCT query and UI.
  // Project only the *skeleton* from the arriving URL to avoid a wrong-pane
  // flash; never mutate the query, graph-server selection, or saved pane state.
  const [arrivalLeftPane, setArrivalLeftPane] = useState<{
    pane: LeftSkeletonPane;
    focusListOrder?: "Properties" | "Roles";
  } | null>(null);
  useLayoutEffect(() => {
    const state = readShareableUiState(window.location.search);
    if (state?.defaultLeftTab === "facets" || state?.defaultLeftTab === "personal" || state?.defaultLeftTab === "community") {
      setArrivalLeftPane({ pane: state.defaultLeftTab,
        focusListOrder: state.focusListOrder === "Roles" || state.focusListOrder === "Properties" ? state.focusListOrder : undefined });
    }
  }, []);
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
    commitConfigureFacetChanges,
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
    graphHealthReady,
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
    groupByBeforeCodeViewRef,
    groupByOptions,
    groupCardRefs,
    groupHasMoreBatches,
    groupMembers,
    groupUiPage,
    groupValues,
    groupValuesError,
    groupValuesLoading,
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
    setViewProvider,
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
    urlRestoreError,
    validateSelectedRecord,
    viewDiscoveryError,
    viewDiscoveryLoading,
    viewProvider,
    viewProviderCount,
    viewProviderError,
    viewProviderHtml,
    viewProviderLoading,
    viewHtml,
    viewPanel,
    viewRenderError,
    visibleClassDisplayFacets,
    visibleGroupValues,
    visibleResultsPage,
    widgetTimeouts,
    workspaceTab,
  } = workspace;
  // Keep the shell visible while restoring the share URL, without mounting
  // provisional query-dependent controls or dispatching an FCT query.
  // The visible left pane defines which facet data is relevant. Loading a
  // Configure-only Properties query must not hide an otherwise ready Filters
  // pane (nor make Filters look ready before Categories/Graphs have loaded).
  const restoringLeftPane = !urlStateInitialized ? (arrivalLeftPane?.pane ?? defaultLeftTab) : defaultLeftTab;
  const restoringFocusOrder = !urlStateInitialized ? (arrivalLeftPane?.focusListOrder ?? focusListOrder) : focusListOrder;
  const configuring = defaultLeftTab === "facets";
  const filtering = defaultLeftTab === "personal";
  const leftPaneLoading = configuring
    ? isLoadingProperties || isLoadingRoles
    : filtering && (isLoadingClasses || isLoadingGraphs || workspace.isLoadingCategoryTree ||
        personalWidgets.some(widget => widget.loading) ||
        personalRoleFacetNodes.some(node => roleWidgetStatuses[node.id]?.loading === true));
  const leftPaneContentPresent = configuring
    ? propertyFacets.length > 0 || roleFacets.length > 0
    : !filtering || classFacets.length > 0 || graphFacets.length > 0 ||
      personalWidgets.some(widget => !widget.loading) ||
      personalRoleFacetNodes.some(node => roleWidgetStatuses[node.id]?.loading === false);
  const leftPaneFailed = configuring
    ? Boolean(propertyFacetError || roleFacetError)
    : filtering && Boolean(classFacetError);
  // Match the actual FilterWorkspaceContent composition and the current
  // <view>-scoped Personal widgets. No speculative Status widgets are shown
  // before the authoritative access/bookmark gate is open.
  const personalPropertyLabels = new Map<string, string>();
  if (!focusWidgetsSuppressed) {
    for (const node of activePropertyFilters) {
      const iri = node.attributes.iri;
      if (iri && iri !== "http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
        personalPropertyLabels.set(iri, toLabel(iri, "Property"));
    }
    for (const widget of personalWidgets) {
      if (widget.uri !== "http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
        personalPropertyLabels.set(widget.uri, widget.label);
    }
  }
  const leftSkeletonWidgets = selectLeftPaneSkeletonWidgets({
    pane: restoringLeftPane,
    focusListOrder: restoringFocusOrder,
    showStatus: workspace.accessCapabilities.canShowStatusFacet,
    showPropertyUsage: Boolean(propertyUsageScope(queryTree)),
    focusWidgetsSuppressed,
    transported: activeTransportedFacets(queryTree).map(alias => ({
      key: alias.id,
      title: alias.path.map(step => toLabel(step.iri, "Property")).join(" › "),
    })),
    personalRoles: personalRoleFacetNodes.map(node => ({
      key: node.id,
      title: `${toLabel(node.attributes.iri, "Role")} of`,
    })),
    personalProperties: [...personalPropertyLabels].map(([key, title]) => ({ key, title })),
  });
  const skeletons = selectWorkspaceSkeletonBoundaries({
    hydrated: urlStateInitialized,
    tab: workspaceTab,
    graphPhase: workspace.operationsSnapshot.graph.phase,
    queryPhase: workspace.operationsSnapshot.query.phase,
    registryReady: graphRegistryReady,
    endpointReady: graphHealthReady,
    discoveryPending: graphAutoFill && !graphAlreadySelected &&
      !(graphProbe.identity === graphProbeIdentity && (graphProbe.state === "no-graph" || graphProbe.state === "error")),
    discoveryFailed: graphAutoFill && !graphAlreadySelected && graphProbe.identity === graphProbeIdentity && graphProbe.state === "error",
    // An inconclusive SPARQL health probe is not evidence of server failure;
    // neither a stale toast nor an auto-fill timeout may turn a green server red.
    endpointFailed: !graphHealthReady && Boolean(endpointMenuError ||
      (endpointHealthToast && endpointHealthToast.endpointId === selectedEndpointId) ||
      (graphRegistryReady && selectedEndpointStatus &&
       selectedEndpointStatus.state !== "ok" && selectedEndpointStatus.state !== "probe-error" &&
       !isCheckingEndpoints && !isRefreshingFailedEndpoint)),
    facetsLoading: leftPaneLoading,
    facetContentPresent: leftPaneContentPresent,
    facetFailed: leftPaneFailed,
    initialQueryStarted: initialBrowseTriggered,
    recordSelected: Boolean(selectedUri),
    recordLoading: isDescribing || isLoadingRecordPolicy,
    recordReady: Boolean(selectedUri && describedRecordUri === selectedUri),
    recordFailed: Boolean(recordDescriptionError || recordPolicyError),
  });
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
  const workspaceRibbon = !urlStateInitialized ? <div role={urlRestoreError ? "alert" : "status"} aria-live="polite" className="flex min-h-12 shrink-0 items-center gap-3 border-b px-4 py-2"><span className="text-sm font-semibold">Browse</span><span className="text-xs text-muted-foreground">{urlRestoreError ? "Share URL restoration failed" : "Restoring query…"}</span></div> : ((workspaceTab === "view" && !workspace.accessCapabilities.canUsePersonalStore) || workspaceTab === "browse" ? <BrowseRibbon breadcrumbs={<>{renderRootBreadcrumb()}{tutorialBreadcrumbPath.map((crumb, index) => renderPathBreadcrumb(crumb, index))}</>} /> : workspaceTab === "view" ? <ViewRibbon viewPanel={viewPanel} setViewPanel={setViewPanel} breadcrumbs={<>{renderRootBreadcrumb()}{tutorialBreadcrumbPath.map((crumb, index) => renderPathBreadcrumb(crumb, index))}</>} discoveredViews={discoveredViews} viewProvider={viewProvider} setViewProvider={setViewProvider} onSelectProvider={workspace.selectViewProvider} onFeaturesEntered={workspace.enterViewFeatures} selectedViewUri={selectedViewUri} onSelectView={workspace.selectPerspective} viewDiscoveryLoading={viewDiscoveryLoading} viewDiscoveryError={viewDiscoveryError} queryClassUris={queryClassUris} queryMatchedProviders={workspace.queryMatchedProviders} queryXml={queryXml} triggerUri={selectedUri || matchingBookmarkId || ""} historyUri={historyVisitQueryRef.current === queryXml ? (historyVisitIdRef.current || historyBookmarkId) : undefined} /> : <MaestroHoverExpand active={analyzeRibbonPanel} onChange={(panel) => {
    if (panel === "analytics" || panel === "trail") setAnalyzeRibbonPanel(panel);
  }} panels={[{ id: "trail", label: "Trail", content: <nav aria-label="Analyze breadcrumbs" className="flex w-max min-w-full flex-nowrap items-start gap-2">{renderRootBreadcrumb()}{tutorialBreadcrumbPath.map((crumb,index)=>renderPathBreadcrumb(crumb,index))}</nav> }, { id: "analytics", label: "Analytics", content: <AnalyzeRibbon discoveryPhase={workspace.analysisDiscoveryPhase} discoveryError={workspace.analysisDiscoveryError} discoveryWaiting={workspace.analysisDiscoveryWaiting} onRetryDiscovery={workspace.retryAnalysisDiscovery} analysisDefinitions={analysisDefinitions} selectedAnalysisUri={selectedAnalysisUri} analyzeHistogram={analyzeHistogram} isCompareAnalysis={isCompareAnalysis} firstBreadcrumbLabel={tutorialBreadcrumbPath[0] ? toLabel(tutorialBreadcrumbPath[0].uri, "Property") : undefined} firstResultTitle={visibleResultsPage[0]?.title} onSelectAnalysis={(uri) => { setSelectedAnalysisUri(uri); setAnalyzeHistogram(false); }} onSelectHistogram={(uri) => { setSelectedAnalysisUri(uri); setAnalyzeHistogram(true); }} /> }]} />);
  const activePaneOrder = activeBrowsePaneOrder(browsePanePreference.order, !urlStateInitialized || workspaceTab === "browse");
  const browsePanelGroup = useRef<ImperativePanelGroupHandle>(null);
  const browseLayoutActive = urlStateInitialized && workspaceTab === "browse" && browsePanePreference.loaded;
  const savedSizes = browsePanePreference.sizes;
  useLayoutEffect(() => {
    if (browseLayoutActive && browsePanelGroup.current?.getLayout().length === 3) browsePanelGroup.current.setLayout(browseSizesInOrder(savedSizes, browsePanePreference.order));
  }, [browseLayoutActive, browsePanePreference.order, savedSizes]);
  const saveBrowseLayout = () => {
    if (!browseLayoutActive) return;
    const layout = browsePanelGroup.current?.getLayout();
    const next = layout && browseSizesFromLayout(browsePanePreference.order, layout);
    if (next && next.some((size, index) => Math.abs(size - savedSizes[index]) > 0.001)) browsePanePreference.changeSizes(next);
  };
  return (
    <BrowsePanePreferenceContext.Provider value={browsePanePreference}>
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <Toaster />
      <AppLifecycleDiagnostics registry={workspace.appLifecycle} access={workspace.accessController} operations={workspace.operationsController} providerCatalog={workspace.providerCatalogController} />
      {endpointHealthToast && <div role="status" className="fixed bottom-5 right-5 z-[200] flex w-[min(28rem,calc(100vw-2.5rem))] max-h-[80vh] items-start gap-2 overflow-y-auto rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md">
        <div className="min-w-0 flex-1"><div className="text-xs font-medium">{workspace.accessCapabilities.proxyTransport === "unavailable" ? "Maestro proxy unavailable" : "Graph server health check failed"}</div><div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-xs text-muted-foreground">{endpointHealthToast.message}</div></div>
        <button type="button" className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50" disabled={isRefreshingFailedEndpoint} onClick={() => void refreshFailedEndpointAndRetry()}>{isRefreshingFailedEndpoint ? "Refreshing…" : "Refresh"}</button>
        <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss health check error" onClick={() => setEndpointHealthToast(null)}>×</button>
      </div>}
      <AlertDialog open={clearCacheDialogOpen && workspace.accessCapabilities.canClearCaches} onOpenChange={setClearCacheDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Maestro cache?</AlertDialogTitle>
            <AlertDialogDescription>Clear all localStorage data saved by this site? This resets saved settings and reloads Maestro.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={!workspace.accessCapabilities.canClearCaches} onClick={async (event) => {
              if (!selectMaestroCapabilities(workspace.accessController.getSnapshot()).canClearCaches) {
                event.preventDefault();
                toast.add({ title: "Cache clearing unavailable", description: "Wait until login and graph seeding finish.", type: "warning" });
                return;
              }
              try {
                await clearClientQueryCache();
                await clearMaestroStorage();
                window.localStorage.clear();
                window.location.reload();
              } catch (error) {
                toast.add({ title: "Could not clear cache", description: error instanceof Error ? error.message : String(error), type: "error" });
                setClearCacheDialogOpen(false);
              }
            }}>Clear Cache</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={workspace.accessCapabilities.canUsePersonalStore && deleteHistoryDialogOpen} onOpenChange={(open) => { if (!isDeletingHistory) setDeleteHistoryDialogOpen(open); }}>
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
      {urlStateInitialized && endpointReadyForQuery && personalWidgets.filter((widget) => {
        if (!widget.anchor) return true;
        // The previous Browse widgets can survive for one render after a ribbon
        // replaces the FCT tree. Never mount an alias listener for a stale path.
        return activeTransportedFacets(queryTree).some((candidate) =>
          sameTransportedFacetIdentity(candidate, widget.anchor));
      }).map((widget) => (
        <PersonalWidgetQueryListener
          key={widget.key ?? widget.uri}
          widgetKey={widget.key ?? widget.uri}
          anchorId={widget.anchor?.id}
          href={widget.anchor?.href}
          propertyUri={widget.uri}
          limit={leftWidgetLimits.personalFacets}
          setPersonalWidgets={setPersonalWidgets}
          endpointReady={endpointReadyForQuery}
          refreshRevision={queryRefreshRevision}
        />
      ))}

      <AppBarSection workspace={workspace} />

      <Dialog open={workspace.accessCapabilities.canUsePersonalStore && isRdfLoaderOpen} onOpenChange={(open) => { if (!isRdfLoading) setIsRdfLoaderOpen(open); }}>
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
                  const sourceUrl = new URL(rdfSourceUrl.trim());
                  if (!["http:", "https:"].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) throw new Error("RDF source must be a public HTTP(S) URL.");
                  const targetGraph = rdfTargetGraph.trim();
                  if (!/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(targetGraph)) throw new Error("Invalid RDF target graph IRI.");
                  const update = `LOAD <${sourceUrl.href}> INTO GRAPH <${targetGraph}>`;
                  await updatePersonal(update,undefined,undefined,"rdf-load");
                  toast.add({ title: "RDF load completed", description: `Loaded ${sourceUrl.href} into ${targetGraph}.`, type: "success" });
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



      <div className="shrink-0">
        {workspaceRibbon}

      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" onKeyUpCapture={event => { if (event.target instanceof HTMLElement && event.target.hasAttribute("data-panel-resize-handle-id")) saveBrowseLayout(); }}>

          <BrowsePanePositionContext.Provider value={activePaneOrder}>
          <ResizablePanelGroup ref={browsePanelGroup} direction="horizontal" className="min-h-0 flex-1">
            {activePaneOrder.map((pane, index) => <Fragment key={pane}>
              {pane === "filters" ? (skeletons.facets === "loading" ? <FacetsLoadingSkeleton
              pane={restoringLeftPane}
              widgets={leftSkeletonWidgets}
              workspace={workspace}
            /> : skeletons.facets === "degraded"
              ? <GraphUnavailableFacets pane={defaultLeftTab}
                onShowFilters={commitConfigureFacetChanges}
                onConfigureProperties={() => { workspace.setFocusListOrder("Properties"); setDefaultLeftTab("facets"); }}
                onConfigureRoles={() => { workspace.setFocusListOrder("Roles"); setDefaultLeftTab("facets"); }} />
              : <LeftCanvasPanel workspace={workspace} />) : pane === "results" ? (!urlStateInitialized && urlRestoreError ? (
              <CenterPaneFrame><CenterPaneBody>
              <section role="alert" className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4" aria-label="Share URL restoration error">
                <MaestroEmptyResults
                  title="Could not restore the Share URL"
                  media={<FileWarning aria-hidden="true"/>}
                  description={<>
                    {urlRestoreError}
                    <span className="mt-2 block text-xs">The incoming URL is preserved. FCT execution remains blocked until a valid query is restored.</span>
                  </>}
                  actions={<>
                    <Button type="button" variant="default" size="sm"
                      className="bg-black text-white hover:bg-zinc-800 focus-visible:ring-zinc-500 dark:bg-black dark:text-white dark:hover:bg-zinc-800"
                      onClick={() => window.location.reload()}>Retry</Button>
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => window.location.assign(window.location.pathname)}>New Query</Button>
                  </>}
                />
              </section>
              </CenterPaneBody></CenterPaneFrame>
            ) : skeletons.results === "loading" ? <ResultsLoadingSkeleton wide={urlStateInitialized && workspaceTab !== "browse"} />
              : skeletons.results === "degraded" ? <GraphUnavailableResults wide={urlStateInitialized && workspaceTab !== "browse"} />
              : <CenterCanvasPanel workspace={workspace} />) : (skeletons.record === "degraded" ? <GraphUnavailableRecord /> : <RightCanvasPanel workspace={workspace} />)}
              {index < activePaneOrder.length - 1 && <ResizableHandle withHandle className="shrink-0" onDragging={dragging => { if (!dragging) saveBrowseLayout(); }} />}
            </Fragment>)}
          </ResizablePanelGroup>
          </BrowsePanePositionContext.Provider>

      </div>
      {/* This lives in the durable workspace root, not the hover-unfurled
          breadcrumb editor. Mouse movement cannot unmount the Code Block. */}
      <RootAutocompleteQueryInspector
        open={workspace.rootAutocompleteInspectorOpen}
        onOpenChange={workspace.setRootAutocompleteInspectorOpen}
        query={workspace.rootAutocompleteInspection?.query ?? null}
        input={workspace.rootAutocompleteInspection?.input ?? ""}
        addr={workspace.rootAutocompleteInspection?.addr ?? ""}
      />
      <Dialog open={bookmarkQueryDebugOpen} onOpenChange={setBookmarkQueryDebugOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Bookmark query Code Block</DialogTitle><DialogDescription>Inspect the bounded FCT query, the SPARQL returned by Virtuoso FCT, and both raw responses.</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto">
            <section><h3 className="mb-2 text-sm font-semibold">FCT query XML</h3><CodeBlock code={bookmarkQueryDebug.xml || "No saved query has run yet."} language="xml" filename="bookmark-history-query.xml" /></section>
            <section><h3 className="mb-2 text-sm font-semibold">Translated SPARQL</h3><CodeBlock code={bookmarkQueryDebug.sparql} language="sparql" filename="bookmark-history-query.sparql" executionAddr={fctQueryExecutionAddress(bookmarkQueryDebug.xml)} /></section>
            <section><h3 className="mb-2 text-sm font-semibold">FCT results response</h3><CodeBlock code={bookmarkQueryDebug.response} language="xml" filename="bookmark-history-query-response.xml" /></section>
            <section><h3 className="mb-2 text-sm font-semibold">Count response</h3><CodeBlock code={bookmarkQueryDebug.countResponse} language="xml" filename="bookmark-history-query-count-response.xml" /></section>
          </div>
        </DialogContent>
      </Dialog>
    </main>
    </BrowsePanePreferenceContext.Provider>
  );
}
