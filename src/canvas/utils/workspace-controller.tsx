"use client";
import { createAuthenticationActions, useAuthenticationSessionLifecycle } from "@/canvas/controllers/authentication";

import { useAuthenticationState } from "@/canvas/controllers/authentication";
import { useHistoryState } from "@/canvas/controllers/history";
import { useBookmarksState } from "@/canvas/controllers/bookmarks";
import { useGraphServersState } from "@/canvas/controllers/graph-servers";
import { useGraphScopeState, useGraphScopeNavigation } from "@/canvas/controllers/graph-scope";
import { useQuerySessionState, useQuerySessionController } from "@/canvas/controllers/query-session";
import { usePreferencesState, readToolbarToggleState } from "@/canvas/controllers/preferences";
import { useFacetsState, useFacetRuntimeState } from "@/canvas/controllers/facets";
import { useResultsState } from "@/canvas/controllers/results";
import { usePersonalRecordStatus } from "@/canvas/controllers/personal-record-status";
import type { StatusFacetName } from "@/lib/personal-status-vocabulary";
import { canUsePersonalStore } from "@/lib/personal-session-access";
import { useRecordState } from "@/canvas/controllers/record";
import { useViewState } from "@/canvas/controllers/view";
import { usePublishState } from "@/canvas/controllers/publish";
import { useChatState } from "@/canvas/controllers/chat";

import { createHistoryActionRestorer, deriveHistoryAction } from "@/canvas/utils/history";
import { DEFAULT_RESULTS_PAGE_SIZE, RESULTS_PAGE_SIZE_STORAGE_KEY, RESULTS_BATCH_SIZE_OPTIONS, LEFT_PANEL_LIMIT_STORAGE_KEY, DEFAULT_LEFT_PANEL_LIMIT, LEFT_WIDGET_LIMIT_KEYS, LEFT_WIDGET_LIMIT_OPTIONS, leftWidgetLimitStorageKey, type LeftWidgetLimitKey, CENTER_PANEL_LIMIT_STORAGE_KEY, CENTER_GROUP_LIMIT_STORAGE_KEY, RIGHT_PANEL_DESCRIBE_LIMIT_STORAGE_KEY, RIGHT_PANEL_PAGE_LIMIT_STORAGE_KEY, RIGHT_PANEL_DESCRIBE_LIMIT_OPTIONS, RIGHT_PANEL_PAGE_LIMIT_OPTIONS } from "@/canvas/sheet/settings";


import { IncompleteWidgetIndicator } from "@/canvas/utils/incomplete-widget";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";
import { listValuesQueryClone, parseListValuesXml, escapeXmlText, parseFctResponse, readFctResponse, presentServerError, facetLoadErrorMessage, groupValueKey, fctTermKey, facetValueKey, groupValueBinding, type EnrichedTerm, type ScopeValue, type FctResponseColumn, type FctMatch, type FctResult, type ParsedFctResponse, type ListValueProjection, type RelationshipDirection } from "@/canvas/utils/fct-response";
import { DistinctCount, distinctCountQueryFor, personalFacetInspectorQueries, PersonalWidgetQueryListener, PersonalRoleWidget, getActiveViewPropertyFilters, getActiveViewRoleFilters, getPersonalRoleFacetNodes, treeHasPropertyFilter, compareGroupValues, type PersonalWidget, type ScopeRelationship, type GroupByOption, type GroupMembersState, type RoleWidgetStatus } from "@/canvas/left/filter";
import { findQueryNode, queryTreeHasStatuses, ellipsize, RDF_TYPE_URI, GROUP_BY_FACET_HIGHLIGHT_CLASSES, readGraphServerFromQueryXml, readShareableUiState, parseFctQueryXml, workbenchQueryTreeApi, type ShareableUiState, APPBAR_TAB_NUMBER, VIEW_RIBBON_TAB_NUMBER, decodeAppbarTab, copyRibbonUrlParams } from "@/canvas/utils/query-controller";


import { getLocalStorageUsageBytes, formatStorageBytes, useBrowserLoggingSettings, useLocalStorageUsage } from "@/canvas/sheet/settings";
import { createFacetItem, collectCategoryTreeParentKeys, paginateCategoryTree, categoryTreeNodeKey, type FacetItem, type CategoryTreeNode, type FacetName, type OntologyClassMetadata } from "@/canvas/left/filter";
import { FACET_ADD_COUNTS_STORAGE_KEY, FACET_AUTOFILL_STORAGE_KEY, AUTO_CONFIGURED_FACETS_STORAGE_KEY, FACET_EXCLUDE_STORAGE_KEY, CONFIGURE_LIST_BACKGROUND_COLOR, CONFIGURE_HEADER_BACKGROUND_COLOR, CONFIGURE_HEADER_BORDER_COLOR, readFacetExcludeRegistry, recordFacetExclude, isFacetExcludeRecorded, readAutoConfiguredFacetKeys, readFacetAddCounts, recordFacetAddition, readFacetAutofillCandidates, replaceFacetAutofillCandidates, executeAutoConfigure, type FacetAddCounts, type FacetAutofillCandidates, type FacetExcludeRegistry, type AutoConfiguredFacetKey } from "@/canvas/left/configure";
import { pageSizesForBatch } from "@/canvas/center/results";
import { MaestroChatPane } from "@/canvas/center/chat";
import { BrowseRibbon } from "@/canvas/tab/browse/ribbon";
import { BrowseResults } from "@/canvas/tab/browse/results-view";
import { ViewRibbon } from "@/canvas/tab/view/ribbon";
import { AnalyzeRibbon } from "@/canvas/tab/analyze/ribbon";
import { ViewPage } from "@/canvas/tab/view/view-components";
import { AnalyzeHistogram, useAnalyzeState, type AnalysisDefinition, type AnalysisCell, type AnalysisTable } from "@/canvas/tab/analyze/analysis-utils";

import { downloadRecordDescribeSnapshot, blankNodeRecordListValuesQuery, rootBlankNodeRecordQuery, useRecordCoreState, useRecordPresentationState, useRecordPageSettings, type RecordService, type ServiceResult, type RecordValueTerm, type BlankNodeRecord, type RecordGraphAuthor } from "@/canvas/right/record";
import { parsePolicyQueryAction, resolveRecordFormatCategory, useRecordFormatSelection, type RecordPolicyOption } from "@/canvas/right/format";
import { RecordValidationNotice, useRecordValidationState, validateRecordSnapshot } from "@/canvas/right/validator";
import { EndpointStatusIcon, type EndpointStatus, type EndpointOption } from "@/canvas/top/appbar";
import { renderValueOperator } from "@/canvas/top/breadcrumb";

import { FCT_VIEW_TYPES, type FctViewType } from "@/lib/fct-view-types";
import { propertyUsageNavigation, type PropertyUsageDirection } from "@/lib/property-usage-query";
import type { FctValue } from "@/lib/fct-query-api";
import maestroLanguages from "@/data/maestro-languages.json";
import { LIST_VALUES_MAX_RESOURCES } from "@/lib/list-values-transport";
import { listValuesProjectionSparql } from "@/lib/list-values-inspector";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rememberNamespaceMetadata, rememberShortforms, setNamespacePrefixSource, setObservationQueryAddr, toLabel } from "@/lib/uri-labels";
import { proxyDebugFingerprint, proxyDebugHeaders } from "@/lib/proxy-debug";
import { buildFctCountSparql } from "@/lib/fct-count-sparql";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { featureFctQuery } from "@/lib/feature-fct-query";
import { ThemeToggle } from "@/components/theme-toggle";
import { configureMaestroBrowserLogging, type BrowserLogLevel } from "@/lib/maestro-client-logging";
import type { ReactNode, Dispatch, SetStateAction, CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ButtonGroup } from "@/components/ui/button-group";
import { MaestroAnalysisDataTable, type MaestroDataColumn, type MaestroDataRow } from "@/components/maestro-analysis-data-table";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { renderDiscoveredViewXslt } from "@/lib/discovered-view-xslt";
import { FEATURE_VIEW_XSLT, type FeatureKind, type FeatureItem } from "@/lib/feature-view-xslt";
import { MaestroHoverExpand } from "@/components/ui/maestro-hover-expand";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback, AvatarBadge } from "@/components/ui/avatar";
import { Toggle } from "@/components/ui/toggle";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Toaster, toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Ban, Bot, Check, ChevronDown, ChevronRight, ChevronLeft, ChevronsRightLeft, ChevronsDownUp, ChevronsUpDown, CircleSlash, Code2, Focus, List, MousePointerClick, Network, Settings, Link, SearchCode, SignalHigh, SignalLow, SignalMedium, SignalZero, Signal, Tag, Tags, Trash, Trash2, UsersRound, BetweenHorizontalStart, BetweenHorizontalEnd, ListTree, CornerDownLeft, CirclePlay, AtSign, Shapes, X, Slash, GlobeCode, LoaderCircle, ArrowDown01, ArrowDown10, ArrowDownAZ, ArrowDownZA, ArrowLeft, ArrowRight, ClockArrowRight, Equal, EqualApproximately, Regex, RotateCcw, RotateCw, RefreshCw, Bookmark, History, BadgeCheck, BadgeAlert, BadgeX, BadgeQuestionMark, SquarePlus, SquareX, SquareCheck, User, LogIn, LogOut, KeyRound, ShieldCheck, ClipboardCheck, ClipboardList, CircleFadingCheck, Download, Upload, Eye, EyeOff, Info, Table2, TableProperties, ChartColumn, Server, Database, Globe, LayoutGrid, FileCode2, ArrowLeftRight, Blocks, WandSparkles } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { PersonalAuthSession, AuthType, loadPersonalAuthSession, savePersonalAuthSession, clearPersonalAuthSession, setMaestroSessionCookie, buildAuthHeader, graphForPrefix, AUTH_EXPECTED_KEY } from "@/lib/personal-auth";
import { ALL_GRAPHS } from "@/lib/graph-address-mode";
import { MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, abortPendingMaestroQueries, stopPendingMaestroQueries, resumePendingMaestroQueries, cachedFetchFct, clearClientQueryCache, maestroQueryFetch } from "@/lib/client-query-cache";
import { DEFAULT_MAESTRO_CONCURRENCY, readMaestroConcurrency, writeMaestroConcurrency, syncMaestroConcurrency, type MaestroConcurrency } from "@/lib/maestro-concurrency";
import { MAESTRO_TIMEOUT_CATEGORIES, readMaestroWidgetTimeouts, writeMaestroWidgetTimeouts, type MaestroTimeoutCategory } from "@/lib/maestro-query-timeouts";
import { setMaestroIncompleteResults, getMaestroIncompleteResults, subscribeMaestroIncompleteResults } from "@/lib/maestro-incomplete-results";
import { resetMaestroIncompleteResults } from "@/lib/maestro-incomplete-results";
import { resetMaestroQueryExecutionClocks } from "@/lib/maestro-query-execution-clock";
import { initializeMaestroStorage, maestroStorageGet, maestroStorageSet, clearMaestroStorage } from "@/lib/maestro-storage";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CodeBlock } from "@/components/ui/code-block";
import { transformMaestroRecordXslt, transformMaestroQueryXslt } from "@/lib/maestro-xslt";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import xmlFormat from "xml-formatter";
import hljs from "highlight.js/lib/core";
import xmlLanguage from "highlight.js/lib/languages/xml";
import sqlLanguage from "highlight.js/lib/languages/sql";
import { serializeFctQuery, createPropertyWidgetQuery, createPersonalRoleValuesQuery, createGroupMemberQuery, createGroupValuesQuery, createDistinctCountQuery, setQueryViewAttributes } from "@/lib/fct-query-api";
import type { FctQueryNode, FctQueryTree, FctUiResultSummary, DistinctCountKind } from "@/lib/fct-query-api";

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






/** Shared workspace lifecycle and query orchestration. The FCT query API remains authoritative. */
export function useWorkspaceController() {
  const [isSpongingUri, setIsSpongingUri] = useState(false);
  const {
    authSession, setAuthSession, personalPoliciesReady, setPersonalPoliciesReady,
    personalPoliciesSeedError, setPersonalPoliciesSeedError, loginDialogOpen, setLoginDialogOpen,
    authRestoreIssue, setAuthRestoreIssue, authRestoreComplete, setAuthRestoreComplete,
    loginTab, setLoginTab, loginGraphStore, setLoginGraphStore,
    loginGraphPrefix, setLoginGraphPrefix, loginUsername, setLoginUsername,
    loginPassword, setLoginPassword, loginShowPassword, setLoginShowPassword,
    loginOauthToken, setLoginOauthToken, loginOauthProfileUrl, setLoginOauthProfileUrl,
    loginOauthUserName, setLoginOauthUserName, loginWebIdUri, setLoginWebIdUri,
    loginTesting, setLoginTesting, loginError, setLoginError,
    isFetchingAvatar, setIsFetchingAvatar, fetchedAvatarUrl, setFetchedAvatarUrl,
  } = useAuthenticationState();
  const {
    deleteHistoryDialogOpen, setDeleteHistoryDialogOpen, isDeletingHistory, setIsDeletingHistory,
    isLoadingHistoryQuery, setIsLoadingHistoryQuery, historyHasOlder, setHistoryHasOlder,
    historyHasNewer, setHistoryHasNewer, historyNavigationPending, setHistoryNavigationPending,
    historyActionItems, setHistoryActionItems, historyActionMenu, setHistoryActionMenu,
    historyHoverTimerRef, isDeletingCurrentHistory, setIsDeletingCurrentHistory, historyVisitQueryRef,
    historyVisitIdRef, historyWriteQueueRef, templateHistoryFlushRef, pendingHistoryVisitRef,
  } = useHistoryState();
  const {
    shareLinkCopied, setShareLinkCopied, bookmarkDialogOpen, setBookmarkDialogOpen,
    bookmarkTitle, setBookmarkTitle, bookmarkDescription, setBookmarkDescription,
    bookmarkTags, setBookmarkTags, bookmarkTagVocabulary, setBookmarkTagVocabulary,
    bookmarkSaving, setBookmarkSaving, isQueryBookmarked, setIsQueryBookmarked,
    matchingBookmarkId, setMatchingBookmarkId, bookmarkCheckRevision, setBookmarkCheckRevision,
    historyBookmarkId, setHistoryBookmarkId, bookmarkTitleInputRef, isExportingBookmarks,
    setIsExportingBookmarks, isImportingBookmarks, setIsImportingBookmarks, bookmarkImportFileRef,
  } = useBookmarksState();
  const {
    endpointReloadRevision, setEndpointReloadRevision, queryRefreshRevision, setQueryRefreshRevision,
    fctEndpoints, setFctEndpoints, selectedEndpointId, setSelectedEndpointId,
    endpointStatuses, setEndpointStatuses, isCheckingEndpoints, setIsCheckingEndpoints,
    checkingEndpointIds, setCheckingEndpointIds, endpointChecksCompleted, setEndpointChecksCompleted,
    endpointChecksTotal, setEndpointChecksTotal, endpointMenuError, setEndpointMenuError,
    endpointHealthToast, setEndpointHealthToast, isRefreshingFailedEndpoint, setIsRefreshingFailedEndpoint,
  } = useGraphServersState();
  const {
    personalSparqlEndpoint, setPersonalSparqlEndpoint, graphInfoOpen, setGraphInfoOpen,
    graphInfoRequestRef,
  } = useGraphScopeState();
  const {
    selectedUri, setSelectedUri, urlStateInitialized, setUrlStateInitialized,
    querySourceFormat, setQuerySourceFormat, sparqlQuery, setSparqlQuery,
    breadcrumbTrail, setBreadcrumbTrail, ancestorGhostRetainedRef, previousActiveGhostPathRef,
    previousScopeRelationshipsRef, signalPickerExpanded, setSignalPickerExpanded, rootSearchExpanded,
    setRootSearchExpanded, rootUriLabelCacheRef, namePropertyMenuOpen, setNamePropertyMenuOpen,
    breadcrumbPreviewSummaries, setBreadcrumbPreviewSummaries, breadcrumbMenuPreviewSummaries, setBreadcrumbMenuPreviewSummaries,
    breadcrumbPreviewPendingIds, setBreadcrumbPreviewPendingIds, metadataRegistryRef, collapsedQueryNodeIds,
    setCollapsedQueryNodeIds,
  } = useQuerySessionState();
  const {
    controlsSheetOpen, setControlsSheetOpen, clearCacheDialogOpen, setClearCacheDialogOpen,
    preferredAlphabetLanguage, setPreferredAlphabetLanguage, prefixSource, setPrefixSource,
    prefixStatus, setPrefixStatus, centralTab, setCentralTab,
    workspaceTab, setWorkspaceTab, queryTreeOpen, setQueryTreeOpen,
    queryTreeHeightPercent, setQueryTreeHeightPercent, queryTreeHeightLoaded, setQueryTreeHeightLoaded,
    recordFormatEnabled, setRecordFormatEnabled, recordFormatPreferenceLoaded, setRecordFormatPreferenceLoaded,
    queryTreeHeightDbRef, showResultBadges, setShowResultBadges, orderResults,
    setOrderResults, breadcrumbBadgeMode, setBreadcrumbBadgeMode, hoveredBreadcrumbBadgeId,
    setHoveredBreadcrumbBadgeId, openBreadcrumbDropdownId, setOpenBreadcrumbDropdownId, shiftKeyDown,
    setShiftKeyDown, hoveredFacetKey, setHoveredFacetKey, panelLimitsOpen,
    setPanelLimitsOpen, timeoutEditorOpen, setTimeoutEditorOpen,
  } = usePreferencesState();
  const {
    defaultLeftTab, setDefaultLeftTab, personalWidgets, setPersonalWidgets,
    tutorialMode, setTutorialMode, facetHoverPreview, setFacetHoverPreview,
    focusWidgetsSuppressed, setFocusWidgetsSuppressed, personalWidgetCardRefs, roleWidgetCardRefs,
    categoriesWidgetRef, facetListsLoadingObservedRef, facetListsLoadKeyRef, isLoadingRoles,
    setIsLoadingRoles, isLoadingGraphs, setIsLoadingGraphs, roleFacetError,
    setRoleFacetError, expandedCategoryNodes, setExpandedCategoryNodes, ontologyClassMetadata,
    setOntologyClassMetadata, isLoadingProperties, setIsLoadingProperties, isLoadingClasses,
    setIsLoadingClasses, isLoadingCategoryTree, setIsLoadingCategoryTree, configureQueryTransition, setConfigureQueryTransition, pendingConfigureFacetIdentityRef,
    propertyFacetError, setPropertyFacetError, classFacetError, setClassFacetError,
    propertyFacetWarning, setPropertyFacetWarning, classFacetWarning, setClassFacetWarning,
    categoriesIncomplete, setCategoriesIncomplete, roleFacetWarning, setRoleFacetWarning,
    expandedUris, setExpandedUris,
  } = useFacetsState();
  const {
    groupByPropertyUri, setGroupByPropertyUri, groupByBeforeCodeViewRef, resultsUiPage,
    setResultsUiPage, groupUiPage, setGroupUiPage, groupBatchSize,
    setGroupBatchSize, groupBatchOffset, setGroupBatchOffset, groupHasMoreBatches,
    setGroupHasMoreBatches, groupCardRefs, pendingGroupScrollRef, groupValues,
    setGroupValues, groupValuesLoading, setGroupValuesLoading, groupValuesError,
    setGroupValuesError, groupMembers, setGroupMembers, alphabetCounts,
    setAlphabetCounts, alphabetCountsQueryRef, alphabetError, setAlphabetError,
    isLoadingAlphabet, setIsLoadingAlphabet, alphabetPreflight, setAlphabetPreflight,
    results, setResults, resultsBatchRequestPending, resultsLoadedQueryIdentityRef,
    activeQueryIdentityRef, previousResultsQueryIdentityRef, lastPreflightRef, preflightInFlightRef,
    resultsTotalCount, setResultsTotalCount, resultsPageMatchCount, setResultsPageMatchCount,
    resultsPageComplete, setResultsPageComplete, isCountingResults, setIsCountingResults,
    isSearching, setIsSearching, resultsRawResponse, setResultsRawResponse,
    resultListValuesDebug, setResultListValuesDebug, searchError, setSearchError,
    searchPipelineRun, setSearchPipelineRun, initialBrowseTriggered, setInitialBrowseTriggered,
  } = useResultsState();
  const personalStoreReady = canUsePersonalStore(authSession, authRestoreComplete);
  const {
    isLoadingRecordPolicy, setIsLoadingRecordPolicy, recordPolicyCheckedUri, setRecordPolicyCheckedUri,
    recordPolicyError, setRecordPolicyError, isDescribing, setIsDescribing,
    recordDescriptionError, setRecordDescriptionError, recordDescribeIncomplete, setRecordDescribeIncomplete,
    activeFormatterRequestRef, formattedRecordKey, setFormattedRecordKey, formatterHasEnrichment,
    setFormatterHasEnrichment, attemptedFormatterEnrichmentRef,
  } = useRecordState();
  const {
    selectedViewUri, setSelectedViewUri, viewDiscoveryLoading, setViewDiscoveryLoading,
    viewDiscoveryError, setViewDiscoveryError, viewPanel, setViewPanel,
    viewFeature, setViewFeature, viewFeatureHtml, setViewFeatureHtml,
    viewFeatureLoading, setViewFeatureLoading, viewFeatureError, setViewFeatureError,
    viewFeatureCount, setViewFeatureCount, viewHtml, setViewHtml,
    viewXsltMetadata, setViewXsltMetadata, viewDomainRanks, setViewDomainRanks,
    viewRenderError, setViewRenderError, viewServerSoftware, setViewServerSoftware,
    viewServerDescriptions, setViewServerDescriptions,
  } = useViewState();
  const {
    isRdfLoaderOpen, setIsRdfLoaderOpen, rdfSourceUrl, setRdfSourceUrl,
    rdfTargetGraph, setRdfTargetGraph, isRdfLoading, setIsRdfLoading,
  } = usePublishState();
  const {
    assistantPromptDraft, setAssistantPromptDraft, assistantPendingPrompt, setAssistantPendingPrompt,
    assistantPromptIdRef,
  } = useChatState();
  
  const { browserLogging, setBrowserLogging, browserLogLevel, setBrowserLogLevel } = useBrowserLoggingSettings();
  
  
  
  
  const { localStorageUsageBytes, setLocalStorageUsageBytes } = useLocalStorageUsage(controlsSheetOpen);
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  // A new login publishes its cookie before the ./graph manifest reload finishes.
  // Record policy reads must wait until the shapes graph is fully repopulated.
  
  
  // Graph info card (opened from the info icon in the graph input group).
  
  const [graphInfo, setGraphInfo] = useState<{
    graph: string;
    subjectCount: number | null; subjectCountLoading: boolean; subjectCountError: string;
    access: boolean | null; accessLoading: boolean; accessError: string;
  }>({ graph: "", subjectCount: null, subjectCountLoading: false, subjectCountError: "", access: null, accessLoading: false, accessError: "" });
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const loginRememberMe = true;
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  // A template flush persists every edit but publishes just the final live query.
  
  // While the pointer is over the search input, coalesce rapid query edits into
  // While the root breadcrumb search is expanded, coalesce changes into one in-memory snapshot.
  
  
  useEffect(() => {
    let active = true;
    void initializeMaestroStorage().then(() => {
      const saved = maestroStorageGet("maestro-alphabet-preferred-language");
      if (active && saved && (saved === "all" || MAESTRO_ALPHABET_LANGUAGES.some((option) => option.code === saved))) {
        setPreferredAlphabetLanguage(saved);
      }
    });
    return () => { active = false; };
  }, []);
  
  
  useEffect(() => {
    let active = true;
    const stored = maestroStorageGet("maestro-namespace-prefix-source");
    if (active && (stored === "prefixcc" || stored === "zazuko" || stored === "builtin")) setPrefixSource(stored);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    if (prefixSource === "builtin") {
      setNamespacePrefixSource({});
      setPrefixStatus("Built-in list only");
      return () => { active = false; };
    }
    setPrefixStatus("Loading namespace prefixes…");
    fetch(`/proxy/api/ontology/prefixes?source=${prefixSource}`, { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((data: { prefixes?: Record<string, string>; count?: number; note?: string }) => {
        if (!active) return;
        setNamespacePrefixSource(data.prefixes ?? {});
        setPrefixStatus(`${data.count ?? 0} community prefixes · ${data.note ?? "Built-in fallback"}`);
      })
      .catch(() => { if (active) { setNamespacePrefixSource({}); setPrefixStatus("Built-in prefixes (remote source unavailable)"); } });
    return () => { active = false; };
  }, [prefixSource]);
  
  
  const activeBreadcrumbButtonRef = useRef<HTMLButtonElement | null>(null);
  
  // Only the selected endpoint's health may affect active query effects. A
  // different endpoint finishing its health check must not restart these loads.
  const selectedEndpointStatus = selectedEndpointId ? endpointStatuses[selectedEndpointId] : undefined;
  
  
  
  
  
  
  
  // A fresh 200 from an FCT query proves that its *own* graph server is
  // responding. Recover a non-green status once, without updating green on
  // every request or treating 4xx/5xx as a connectivity failure.
  useEffect(() => {
    const onSuccess = (event: Event) => {
      const endpointUrl = (event as CustomEvent<{ endpointUrl?: string }>).detail?.endpointUrl;
      if (!endpointUrl) return;
      const endpoint = fctEndpoints.find((item) => item.id === selectedEndpointId);
      if (!endpoint || endpoint.url !== endpointUrl) return;
      setEndpointStatuses((current) => {
        const previous = current[endpoint.id];
        if (previous?.state === "ok" && previous.status === 200) return current;
        return { ...current, [endpoint.id]: {
          id: endpoint.id, status: 200, state: "ok", testedUrl: endpoint.url,
        } };
      });
    };
    window.addEventListener(MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, onSuccess);
    return () => window.removeEventListener(MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, onSuccess);
  }, [fctEndpoints, selectedEndpointId]);

  const { selectedFacet, setSelectedFacet, propertiesPage, setPropertiesPage, classesPage, setClassesPage, graphsPage, setGraphsPage, graphSort, setGraphSort, graphSortPickerExpanded, setGraphSortPickerExpanded, graphListSparql, setGraphListSparql, graphText, setGraphText, graphAutoFill, setGraphAutoFill, graphFieldEditing, setGraphFieldEditing, graphNavigationHistory, setGraphNavigationHistory, graphNavigationIndex, setGraphNavigationIndex, findEndpointsEnabled, setFindEndpointsEnabled, lastManualGraphRef, restoredGraphTextRef } = useGraphScopeNavigation();
  
  
  // The URL's top-level tab takes precedence from the first client paint.
  // A layout effect runs before the browser paints, avoiding a flash of Browse
  // while the full query and shareable UI state are still being restored.
  useLayoutEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    const decodedTab = decodeAppbarTab(requestedTab);
    if (decodedTab) setWorkspaceTab(decodedTab);
  }, []);
  const { analysisDefinitions, setAnalysisDefinitions, selectedAnalysisUri, setSelectedAnalysisUri, analysisTable, setAnalysisTable, analysisColumnWidths, setAnalysisColumnWidths, analysisSelection, setAnalysisSelection, analysisError, setAnalysisError, analysisLoading, setAnalysisLoading, analysisValuesState, setAnalysisValuesState, analysisValuesError, setAnalysisValuesError, compareFacet, setCompareFacet, analyzeHistogram, setAnalyzeHistogram, analysisRenderedBaseRef, analysisPresentationStyle, beginAnalysisColumnResize } = useAnalyzeState();
  
  
  
  // The Query Tree is its own pane under the results, not a replacement tab.
  
  
  
  
  
  
  const centralPaneRef = useRef<HTMLElement | null>(null);
  
  
  
  
  
  
  

  const toggleBreadcrumbBadgeMode = useCallback(() => {
    setBreadcrumbBadgeMode((current) => {
      const next = current === "records" ? "classes" : "records";
      maestroStorageSet("maestro-breadcrumb-badge-mode", next);
      return next;
    });
  }, []);

// This tracks the Shift key and hovered row
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Shift") setShiftKeyDown(true);
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Shift") setShiftKeyDown(false);
  };

  const handleWindowBlur = () => setShiftKeyDown(false);

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", handleWindowBlur);

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleWindowBlur);
  };
}, []);

  // Keep the draggable Query Tree pane height and order-results toggle in IndexedDB.
  useEffect(() => {
    void initializeMaestroStorage().then(() => {
      const saved = maestroStorageGet("maestro-order-results");
      if (saved !== null) {
        setOrderResults(saved === "yes" || saved === "true");
      }
      const savedBadgeMode = maestroStorageGet("maestro-breadcrumb-badge-mode");
      if (savedBadgeMode === "classes" || savedBadgeMode === "records") {
        setBreadcrumbBadgeMode((current) => {
          const stateObj = readShareableUiState(typeof window !== "undefined" ? window.location.search : "");
          if (stateObj?.breadcrumbBadgeMode) return stateObj.breadcrumbBadgeMode;
          return savedBadgeMode;
        });
      }
    });
    if (typeof window === "undefined" || !window.indexedDB) {
      setQueryTreeHeightLoaded(true);
      setRecordFormatPreferenceLoaded(true);
      return;
    }
    let cancelled = false;
    const request = window.indexedDB.open("maestro-ui-preferences", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("preferences")) db.createObjectStore("preferences");
    };
    request.onsuccess = () => {
      const db = request.result;
      if (cancelled) { db.close(); return; }
      queryTreeHeightDbRef.current = db;
      const preferences = db.transaction("preferences", "readonly").objectStore("preferences");
      const read = preferences.get("query-tree-height-percent");
      const readFormat = preferences.get("record-format-enabled");
      const readOrder = preferences.get("order-results-enabled");
      read.onsuccess = () => {
        const value = Number(read.result);
        if (!cancelled && Number.isFinite(value) && value >= 15 && value <= 75) setQueryTreeHeightPercent(value);
        if (!cancelled) setQueryTreeHeightLoaded(true);
      };
      read.onerror = () => { if (!cancelled) setQueryTreeHeightLoaded(true); };
      readOrder.onsuccess = () => {
        if (!cancelled && typeof readOrder.result === "boolean") {
          setOrderResults(readOrder.result);
        }
      };
      readFormat.onsuccess = () => {
        if (!cancelled) {
          setRecordFormatEnabled(readFormat.result === true);
          setRecordFormatPreferenceLoaded(true);
        }
      };
      readFormat.onerror = () => { if (!cancelled) setRecordFormatPreferenceLoaded(true); };
    };
    request.onerror = () => {
      if (!cancelled) {
        setQueryTreeHeightLoaded(true);
        setRecordFormatPreferenceLoaded(true);
      }
    };
    return () => {
      cancelled = true;
      queryTreeHeightDbRef.current?.close();
      queryTreeHeightDbRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!queryTreeHeightLoaded || !queryTreeHeightDbRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        const transaction = queryTreeHeightDbRef.current?.transaction("preferences", "readwrite");
        transaction?.objectStore("preferences").put(queryTreeHeightPercent, "query-tree-height-percent");
      } catch (error) {
        console.warn("Maestro could not persist Query Tree height in IndexedDB", error);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [queryTreeHeightPercent, queryTreeHeightLoaded]);

  // Restore personal authentication session on load.
  useAuthenticationSessionLifecycle({ authSession, setAuthSession, setAuthRestoreIssue, setLoginGraphStore, setPersonalSparqlEndpoint, setLoginGraphPrefix, setLoginTab, setLoginUsername, setLoginPassword, setLoginOauthToken, setLoginOauthProfileUrl, setLoginOauthUserName, setLoginWebIdUri, setFetchedAvatarUrl, setAuthRestoreComplete });

  

  useEffect(() => {
    if (!recordFormatPreferenceLoaded || !queryTreeHeightDbRef.current) return;
    try {
      const transaction = queryTreeHeightDbRef.current.transaction("preferences", "readwrite");
      transaction.objectStore("preferences").put(recordFormatEnabled, "record-format-enabled");
    } catch (error) {
      console.warn("Maestro could not persist the Format toggle in IndexedDB", error);
    }
  }, [recordFormatEnabled, recordFormatPreferenceLoaded]);



  
  
  
  
  
  
  /*
  const [activeTab, setActiveTab] = useState<
    "default" | "personal" | "community"
  >("default");
*/
  // Inner tabs for the left pane in Default view.

  const [focusListOrder, setFocusListOrder] = useState<"Properties" | "Roles">("Properties");


  
  // SHACL-discovered widgets use the ordinary Personal facet machinery.
  // This set changes only the label icon, not widget query/filter behavior.
  // Tutorial previews are presentation-only and never mutate or persist the query.
  
  
  // One owner controls every transient tutorial highlight. Clearing this state
  // removes the results overlay, Query Tree tint, breadcrumb tint, and widget tint.
  const clearTutorialPreview = () => setFacetHoverPreview(null);
  const beginFacetHoverPreview = (uri: string, direction: "forward" | "reverse", label: string, source: "personal" | "configure") => {
    if (!tutorialMode) return;
    const matchingRelationship = findRelationshipPreviewNode(uri, direction);
    setFacetHoverPreview({
      kind: "facet", uri, direction, label, source,
      // Preview the selected relationship as the immediate successor crumb,
      // without changing the authoritative query or saved breadcrumb trail.
      successorNodeId: matchingRelationship && !getPropertyPath().some((crumb) => crumb.id === matchingRelationship.id)
        ? matchingRelationship.id
        : null,
    });
  };
  const beginRecordHoverPreview = (uri: string, label: string) => {
    if (!tutorialMode || !uri.trim()) return;
    setFacetHoverPreview({ kind: "record", uri, label, direction: "forward", source: "record" });
  };
  

  // Remember whether the muted suffix came from navigating to an ancestor.
  // Such a suffix must not be replaced by newly added Configure relationships.
  
  
  

  
  
  // Preserve a Personal facet's group-by selection while the Code Block pane
  // temporarily replaces the results/groups pane.
  
  
  
  
  
  
  
  
  
  
  
  
  
  const { FACET_PAGE_SIZE, propertyFacets, setPropertyFacets, classFacets, setClassFacets, classTreeEdges, setClassTreeEdges, facetCandidateCounts, setFacetCandidateCounts, roleFacets, setRoleFacets, roleWidgetStatuses, setRoleWidgetStatuses, graphFacets, setGraphFacets, graphHasMore, setGraphHasMore, graphTotalCount, setGraphTotalCount, graphListIncomplete, setGraphListIncomplete, propertyFacetSparql, setPropertyFacetSparql, roleFacetSparql, setRoleFacetSparql, facetAutofillCandidates, setFacetAutofillCandidates, facetUsageRevision, setFacetUsageRevision, autoConfiguredFacetKeys, setAutoConfiguredFacetKeys, rolesPage, setRolesPage, previousFacetQueryNodesRef } = useFacetRuntimeState();
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
    insertNode,
    setSearchText: setSearch,
    resetQuery: resetQueryStore,
    setQueryAttribute,
    setNodeAttribute,
    setRoleFilter,
    setResultsPage,
    showClassResults,
    refresh: refreshQuery,
    deleteNode,
  } = useQuerySessionController();


  useEffect(() => {
    setGraphsPage(0);
  }, [queryTree.attributes.graph]);

  const searchNode = queryTree.children.find(
    (node) => node.name === "text" && node.id === "query-text",
  );
  // Treat any root-level URI value as the fixed-subject constraint, including
  // legacy/duplicate nodes that do not have Maestro's canonical node ID.
  const rootUriValues = queryTree.children.filter(
    (node) => node.name === "value" && node.attributes.datatype === "uri",
  );
  const uriNode = rootUriValues.find((node) => node.id === "query-uri-value")
    ?? rootUriValues.find((node) => Boolean(node.text?.trim()))
    ?? rootUriValues[0];
  const activeSearchNode = uriNode ?? searchNode;
  const [searchDraft, setSearchDraft] = useState(activeSearchNode?.text ?? "");
  // Keep text search and fixed-subject URI drafts independently so switching
  // signals never overwrites the term belonging to the other mode.
  const [savedSearchDraft, setSavedSearchDraft] = useState(searchNode?.text ?? "");
  const [savedUriDraft, setSavedUriDraft] = useState(uriNode?.text ?? "");
  const [selectedNamePropertyUris, setSelectedNamePropertyUris] = useState<string[]>(() => {
    const configured = (searchNode?.attributes.property ?? RDFS_LABEL_URI).trim();
    const parsed = configured.split(/[\s,]+/).filter(Boolean);
    return parsed.length && parsed[0].toLowerCase() !== "none" ? parsed : [RDFS_LABEL_URI];
  });
  const [selectedSearchResourceTypes, setSelectedSearchResourceTypes] = useState<string[]>(() =>
    (searchNode?.attributes.type ?? "").split(/[\s,]+/).filter((type) => type === "class" || type === "property"));
  const search = searchDraft;
  const searchDraftRef = useRef(searchDraft);

  // Follow query edits from elsewhere while retaining independent text and URI drafts.
  useEffect(() => {
    if (!activeSearchNode) return;
    const nextText = activeSearchNode.text ?? "";
    searchDraftRef.current = nextText;
    setSearchDraft(nextText);
    if (activeSearchNode.name === "value" && activeSearchNode.attributes.datatype === "uri") setSavedUriDraft(nextText);
    else if (activeSearchNode.id === "query-text") setSavedSearchDraft(nextText);
  }, [activeSearchNode?.id, activeSearchNode?.text]);
  // The URI signal fixes the query subject; other signals search text values or clear the term.
  const querySignalMode: "uri" | "exact" | "name" | "all" | "clear" = uriNode
    ? "uri"
    : !searchNode
      ? "clear"
      : searchNode.attributes.property
        ? "name"
        : "all";
  // Keep the selected signal separate from query constraints. URI mode is valid
  // with an empty draft, in which case the query API correctly stores no <value>.
  const [selectedSignalMode, setSelectedSignalMode] = useState<"uri" | "exact" | "name" | "all" | "clear">(querySignalMode);
  const selectedSignalModeRef = useRef<"uri" | "exact" | "name" | "all" | "clear">(querySignalMode);
  // Follow live query changes when a URI or text constraint exists. If neither
  // exists, preserve the selected mode so an empty URI draft stays in URI mode.
  useEffect(() => {
    if (uriNode) {
      selectedSignalModeRef.current = "uri";
      setSelectedSignalMode("uri");
    } else if (searchNode) {
      const mode = searchNode.attributes.property ? (searchNode.attributes.exact === "true" ? "exact" : "name") : "all";
      selectedSignalModeRef.current = mode;
      setSelectedSignalMode(mode);
    }
  }, [uriNode?.id, uriNode?.text, searchNode?.id, searchNode?.attributes.property, searchNode?.attributes.exact]);
  useEffect(() => {
    const next = (searchNode?.attributes.type ?? "").split(/[\s,]+/).filter((type) => type === "class" || type === "property");
    setSelectedSearchResourceTypes((old) => old.join(" ") === next.join(" ") ? old : next);
  }, [searchNode?.attributes.type]);
  const textSearchMode = selectedSignalMode;
  const selectedNamePropertyLabel = selectedNamePropertyUris
    .map((uri) => TEXT_SEARCH_NAME_PROPERTIES.find((property) => property.uri === uri)?.label ?? toLabel(uri))
    .join(", ") || "no properties";
  
  const signalOptions = [
    { mode: "uri" as const, Icon: Signal, label: "URI — use the entered URI as the fixed subject" },
    { mode: "exact" as const, Icon: SignalHigh, label: `Exact name — match ${selectedNamePropertyLabel} exactly` },
    { mode: "name" as const, Icon: SignalMedium, label: `Name — search using ${selectedNamePropertyLabel}` },
    { mode: "all" as const, Icon: SignalLow, label: "All fields — search text across all properties" },
    { mode: "clear" as const, Icon: SignalZero, label: "No text — remove the text constraint from the query" },
  ];
  const ActiveSignalIcon = signalOptions.find(({ mode }) => mode === textSearchMode)?.Icon ?? Signal;
  
  const rootSearchExpandedRef = useRef(rootSearchExpanded);
  // Last record label seen for each root URI, so the root crumb label stays stable when the badge toggles to Classes.
  
  // Keep queued History work aware of the breadcrumb's current visibility,
  // including work enqueued just before the search field opened.
  rootSearchExpandedRef.current = rootSearchExpanded;
  
  // The Categories tree/list toggle belongs to the authoritative FCT query,
  // so History, share links, and restored queries reproduce the same mode.
  const categoriesTreeMode = queryTree.attributes.classTree === "true";
  // Path keys of explicitly expanded tree nodes. New trees and new branches start closed.
  
  

  const { handleFetchProfile, handleTestConnection, handleLoginSubmit } = createAuthenticationActions({
    loginTab,
    loginOauthProfileUrl,
    loginWebIdUri,
    setIsFetchingAvatar,
    setFetchedAvatarUrl,
    loginOauthUserName,
    setLoginOauthUserName,
    loginGraphStore,
    loginGraphPrefix,
    loginUsername,
    loginPassword,
    fetchedAvatarUrl,
    loginOauthToken,
    setLoginTesting,
    setLoginError,
    setLoginGraphStore,
    setLoginGraphPrefix,
    setLoginUsername,
    setLoginPassword,
    setPersonalPoliciesReady,
    setPersonalPoliciesSeedError,
    setAuthSession,
    setAuthRestoreIssue,
    setPersonalSparqlEndpoint,
    setLoginDialogOpen,
    setEndpointReloadRevision,
    setBookmarkCheckRevision
  });
  
  
  const breadcrumbMenuPreviewPendingRef = useRef(new Set<string>());
  useEffect(() => { setBreadcrumbMenuPreviewSummaries({}); breadcrumbMenuPreviewPendingRef.current.clear(); }, [queryRevision, selectedEndpointId]);
  
  // Reuse result-set metadata for the exact scoped query before issuing a breadcrumb-only request.
  

  function setMainViewType(node: FctQueryNode, type: string): FctQueryNode {
    return {
      ...node,
      attributes: node.id === "query-view"
        ? { ...node.attributes, type, offset: "0" }
        : node.attributes,
      children: node.children.map((child) => setMainViewType(child, type)),
    };
  }

  /** Navigate from a Record predicate to that predicate URI as a new root. */
  const openRecordPropertyUri = (uri: string) => {
    if (!uri.trim()) return;
    // Clear all prior constraints/path but preserve graphsite@graphserver routing.
    const findView = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
      for (const node of nodes) {
        if (node.name === "view") return node;
        const nested = findView(node.children);
        if (nested) return nested;
      }
      return undefined;
    };
    const currentView = findView(queryTree.children);
    const rootView: FctQueryNode = currentView
      ? { ...currentView, attributes: { ...currentView.attributes, type: FCT_VIEW_TYPES.LIST, offset: "0", index: "" }, children: [] }
      : { id: "query-view", name: "view", attributes: { type: FCT_VIEW_TYPES.LIST, limit: "30", offset: "0" }, children: [] };
    const freshTree = { ...queryTree, children: [rootView] };
    const rooted = workbenchQueryTreeApi.setValue(freshTree, null, [{ text: uri, datatype: "uri" }], {
      replaceExisting: true,
      idPrefix: "query-uri-value",
    });
    replaceQueryTree(rooted);
    selectedSignalModeRef.current = "uri";
    setSelectedSignalMode("uri");
    setSavedUriDraft(uri);
    searchDraftRef.current = uri;
    setSearchDraft(uri);
    setSearchPipelineRun((current) => current + 1);
  };

  // Navigate through the shared FCT query API. Class navigation must use a
  // native <class>, which Categories and the root breadcrumb both derive from.
  // Property/role badges use the same canonical filter IDs as their widgets.
  const navigateResultBadge = (predicate: string, term: ScopeValue["values"][number], direction: "forward" | "reverse", category = false, operator: "=" | "contains" = "=") => {
    const uri = term.value.trim();
    if (!uri || uri === "-") return;
    const freshView: FctQueryNode = {
      id: "query-view", name: "view", attributes: {
        type: FCT_VIEW_TYPES.LIST, limit: String(resultsBatchSize), offset: "0",
      }, children: [],
    };
    // Preserve query-wide settings (especially addr), but remove all previous
    // constraints. Compose the new tree via the public query transformations,
    // then publish it once so all listeners derive the same authoritative state.
    let nextTree = { ...queryTree, children: [freshView] };
    if (category) {
      nextTree = workbenchQueryTreeApi.addClass(nextTree, null, uri);
    } else {
      const value = {
        text: uri,
        ...(operator === "contains" ? { op: "contains" } : {}),
        ...(term.type === "uri" ? { datatype: "uri" }
          : term.datatype ? { datatype: term.datatype }
          : term.lang ? { lang: term.lang }
          : { datatype: "string" }),
      };
      if (direction === "reverse") {
        nextTree = workbenchQueryTreeApi.setRoleFilter(nextTree, predicate, true);
        nextTree = workbenchQueryTreeApi.setRoleValue(nextTree, predicate, value, true);
      } else {
        nextTree = workbenchQueryTreeApi.addProperty(nextTree, predicate, null);
        nextTree = workbenchQueryTreeApi.setPropertyValues(nextTree, null, predicate, [value]);
      }
    }
    replaceQueryTree(nextTree);
    searchDraftRef.current = "";
    setSearchDraft("");
    setResultsUiPage(0);
    setCentralTab("results");
  };

  const applyRecordAsRootValue = (uri: string) => {
    if (!uri.trim()) return;
    const nonTextTree = {
      ...queryTree,
      children: queryTree.children
        .filter((node) => node.name !== "text")
        .map((node) => setMainViewType(node, FCT_VIEW_TYPES.LIST)),
    };
    const record = results.find((item) => item.uri === uri) ?? groupValues.find((item) => item.uri === uri);
    const rootValue = record?.termType === "literal"
      ? { text: uri, ...(record.lang ? { lang: record.lang } : { datatype: record.datatype || "string" }) }
      : { text: uri, datatype: "uri" };
    replaceQueryTree(workbenchQueryTreeApi.setValue(nonTextTree, null, [rootValue], {
      replaceExisting: true,
      idPrefix: "query-uri-value",
    }));
    if (record?.termType !== "literal") {
      selectedSignalModeRef.current = "uri";
      setSelectedSignalMode("uri");
      setSavedUriDraft(uri);
      searchDraftRef.current = uri;
      setSearchDraft(uri);
    }
    clearTutorialPreview();
    setSearchPipelineRun((current) => current + 1);
  };


  function setTextSearchMode(mode: "uri" | "exact" | "name" | "all" | "clear", propertyUris = selectedNamePropertyUris, resourceTypes = selectedSearchResourceTypes) {
    setSelectedSearchResourceTypes(resourceTypes);
    selectedSignalModeRef.current = mode;
    setSelectedSignalMode(mode);
    if (mode === "name" || mode === "exact") setSelectedNamePropertyUris(propertyUris);
    if (mode === "clear") {
      // Both drafts are retained independently; clear only the active query constraint.
      if (uriNode) setSavedUriDraft(uriNode.text ?? searchDraft);
      else if (searchNode) setSavedSearchDraft(searchNode.text ?? searchDraft);
      const withoutSearch = {
        ...queryTree,
        children: queryTree.children
          .filter((node) => node.id !== "query-text")
          .map((node) => setMainViewType(node, FCT_VIEW_TYPES.TEXT)),
      };
      replaceQueryTree(workbenchQueryTreeApi.setValue(withoutSearch, null, [], {
        replaceExisting: true,
        idPrefix: "query-uri-value",
      }));
      searchDraftRef.current = "";
      setSearchDraft("");
      setSearchPipelineRun((current) => current + 1);
      return;
    }

    if (mode === "uri") {
      const restoredUri = uriNode?.text ?? savedUriDraft;
      searchDraftRef.current = restoredUri;
      setSearchDraft(restoredUri);
      setSavedUriDraft(restoredUri);
      const nonSearchTree = {
        ...queryTree,
        children: queryTree.children
          .filter((node) => node.name !== "text")
          .map((node) => setMainViewType(node, FCT_VIEW_TYPES.LIST)),
      };
      replaceQueryTree(workbenchQueryTreeApi.setValue(
        nonSearchTree,
        null,
        restoredUri.trim() ? [{ text: restoredUri, datatype: "uri" }] : [],
        { replaceExisting: true, idPrefix: "query-uri-value" },
      ));
      setSearchPipelineRun((current) => current + 1);
      return;
    }

    const restoredText = searchNode?.text ?? savedSearchDraft;
    const uriToResolve = (mode === "name" || mode === "exact") && textSearchMode === "uri" && !restoredText.trim()
      ? (uriNode?.text ?? savedUriDraft).trim()
      : "";
    searchDraftRef.current = restoredText;
    setSearchDraft(restoredText);
    setSavedSearchDraft(restoredText);

    const textNode: FctQueryNode = searchNode
      ? {
          ...searchNode,
          attributes: mode === "name" || mode === "exact" ? { ...searchNode.attributes, property: propertyUris.join(" "), ...(resourceTypes.length ? { type: resourceTypes.join(" ") } : { type: "" }), exact: mode === "exact" ? "true" : "false" } : Object.fromEntries(Object.entries(searchNode.attributes).filter(([key]) => key !== "property" && key !== "exact" && key !== "type")),
          text: restoredText,
        }
      : {
          id: "query-text",
          name: "text",
          attributes: mode === "name" || mode === "exact" ? { property: propertyUris.join(" "), exact: mode === "exact" ? "true" : "false", ...(resourceTypes.length ? { type: resourceTypes.join(" ") } : {}) } : {},
          text: restoredText,
          children: [],
        };
    const withoutSearch = {
      ...queryTree,
      children: queryTree.children
        .filter((node) => node.id !== "query-text")
        .map((node) => setMainViewType(node, FCT_VIEW_TYPES.TEXT)),
    };
    const withoutUri = workbenchQueryTreeApi.setValue(withoutSearch, null, [], {
      replaceExisting: true,
      idPrefix: "query-uri-value",
    });
    replaceQueryTree({ ...withoutUri, children: [textNode, ...withoutUri.children] });
    setSearchPipelineRun((current) => current + 1);

    // When leaving URI mode for an empty Name search, resolve the URI's label.
    // Only fill the field if the user has not started typing while the request runs.
    if (uriToResolve) {
      void (async () => {
        const controller = new AbortController();
        try {
            const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("uri-label-lookup", "UriLabelLookup") },
            body: `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" inference="${escapeXmlText(queryTree.attributes.inference ?? "")}" same-as="${escapeXmlText(queryTree.attributes["same-as"] ?? "")}" addr="${escapeXmlText(queryTree.attributes.addr || (selectedEndpointId ? `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}` : ""))}"><value datatype="uri">${escapeXmlText(uriToResolve)}</value><view type="${FCT_VIEW_TYPES.DESCRIBE}" limit="30" offset="0"/></query>`,
            signal: controller.signal,
          });
          const data = await readFctResponse(response);
          const label = (data.describe ?? []).find((triple) =>
            triple.subject?.value === uriToResolve &&
            triple.predicate?.value === RDFS_LABEL_URI &&
            triple.object?.termType !== "bnode" &&
            Boolean(triple.object?.value?.trim()),
          )?.object?.value?.trim() ?? "";
          if (label && (selectedSignalModeRef.current === "name" || selectedSignalModeRef.current === "exact") && !searchDraftRef.current.trim()) {
            searchDraftRef.current = label;
            setSearchDraft(label);
            setSavedSearchDraft(label);
            setSearch(label);
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.warn("URI label lookup failed:", error);
          }
        }
      })();
    }
  }

  function updateSearchText(value: string) {
    searchDraftRef.current = value;
    setSearchDraft(value);
    if (textSearchMode === "uri") {
      setSavedUriDraft(value);
      const nonSearchTree = {
        ...queryTree,
        children: queryTree.children.filter((node) => node.name !== "text"),
      };
      replaceQueryTree(workbenchQueryTreeApi.setValue(
        nonSearchTree,
        null,
        value.trim() ? [{ text: value, datatype: "uri" }] : [],
        { replaceExisting: true, idPrefix: "query-uri-value" },
      ));
      return;
    }
    if (searchNode) {
      setSavedSearchDraft(value);
      setSearch(value);
      return;
    }
    // Typing after Clear Terms starts a fresh, restrictive name search.
    setSavedSearchDraft(value);
    replaceQueryTree({
      ...queryTree,
      children: [
        { id: "query-text", name: "text", attributes: { property: RDFS_LABEL_URI }, text: value, children: [] },
        ...queryTree.children,
      ],
    });
  }

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
    const currentNodes = new Map<string, { kind: "property" | "property-in"; uri: string; excluded: boolean }>();
    const collectRelationshipNodes = (nodes: FctQueryNode[]) => {
      for (const node of nodes) {
        if ((node.name === "property" || node.name === "property-of") && node.attributes.iri) {
          currentNodes.set(node.id, {
            kind: node.name === "property" ? "property" : "property-in",
            uri: node.attributes.iri,
            excluded: node.attributes.exclude?.trim().toLowerCase() === "yes",
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
      // Whenever the live query adds or changes a facet node, store its exclude boolean.
      if (!previous || previous.kind !== current.kind || previous.uri !== current.uri || previous.excluded !== current.excluded) {
        recordFacetExclude(current.kind, current.uri, current.excluded);
      }
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
    const activeIds = activePath.map((crumb) => crumb.id);
    const previousActiveIds = previousActiveGhostPathRef.current;
    const movedToAncestor = previousActiveIds.length > activeIds.length &&
      activeIds.every((id, index) => id === previousActiveIds[index]);
    if (movedToAncestor) ancestorGhostRetainedRef.current = true;
    else if (previousActiveIds.join("|") !== activeIds.join("|")) ancestorGhostRetainedRef.current = false;
    previousActiveGhostPathRef.current = activeIds;

    // Only relationships in the authoritative query can appear as breadcrumbs.
    const existingIds = new Set<string>();
    const scopeRelationships = new Map<string, FctQueryNode[]>();
    const collect = (nodes: FctQueryNode[], scopeId: string) => {
      const relationships = nodes.filter((node) =>
        (node.name === "property" || node.name === "property-of") && Boolean(node.attributes.iri?.trim()),
      );
      scopeRelationships.set(scopeId, relationships);
      for (const node of relationships) existingIds.add(node.id);
      for (const node of nodes) collect(node.children, node.id);
    };
    collect(queryTree.children, "query-root");
    const currentScopeIds = new Map(Array.from(scopeRelationships, ([id, nodes]) => [id, nodes.map((node) => node.id)]));
    const previousScopeIds = previousScopeRelationshipsRef.current;
    const scopeId = activePath[activePath.length - 1]?.id ?? "query-root";
    const siblingNodes = scopeRelationships.get(scopeId) ?? [];
    const newlyAdded = siblingNodes.filter((node) => !(previousScopeIds.get(scopeId) ?? []).includes(node.id));
    previousScopeRelationshipsRef.current = currentScopeIds;

    setBreadcrumbTrail((current) => {
      const retained = current.filter((crumb) => existingIds.has(crumb.id));
      const activeIsPrefix = activePath.length <= retained.length &&
        activePath.every((crumb, index) => crumb.id === retained[index]?.id);
      let nextTrail = activeIsPrefix ? retained : activePath;

      // An ancestor-navigation suffix is owned by the user's navigation, so
      // Configure additions cannot silently replace its muted path.
      if (ancestorGhostRetainedRef.current && nextTrail.length > activePath.length) return nextTrail;

      // A Configure addition at the root (or any active scope) creates a
      // single ghost successor without moving <view>. When there is already an
      // automatic ghost, the *latest* added sibling takes that slot.
      const candidate = newlyAdded[newlyAdded.length - 1] ??
        (nextTrail.length <= activePath.length ? siblingNodes[siblingNodes.length - 1] : undefined);
      if (candidate) {
        nextTrail = [...activePath, {
          id: candidate.id,
          uri: candidate.attributes.iri ?? "",
          name: candidate.name,
        }];
        ancestorGhostRetainedRef.current = false;
      }
      return nextTrail;
    });
  }, [queryTree, getPropertyPath, queryRevision]);



  const [graphRegistryLoadedRevision, setGraphRegistryLoadedRevision] = useState<number>(-1);
  const graphRegistryReady = authRestoreComplete && graphRegistryLoadedRevision === endpointReloadRevision && fctEndpoints.length > 0;

  // Read the registry once after session restoration; subsequently only an
  // explicit login changes the menu. Never POST a proxy selection on refresh.
  useEffect(() => {
    if (!authRestoreComplete) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const requestedUrl = readGraphServerFromQueryXml(params.get("q"));
        const response = await cachedFetchFct("/proxy/api/fct", {
          cache: "no-store", headers: proxyDebugHeaders("endpoint-menu", "EndpointMenu"),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load graph servers.");
        if (cancelled) return;
        const endpoints: EndpointOption[] = Array.isArray(data.endpoints)
          ? (data.endpoints as EndpointOption[]).filter((item) =>
              authSession || (item.id !== "personal-sparql" && item.label.toLowerCase() !== "personal sparql"))
          : [];
        // The server in the authoritative query wins. Match the shorthand
        // registry address and its expanded /sparql URL equivalently.
        const canonicalServer = (value: string) => {
          try {
            const uri = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
            const path = uri.pathname.replace(/\/+$/, "") || "/sparql";
            return `${uri.host.toLowerCase()}${path}`;
          } catch { return value.trim().toLowerCase(); }
        };
        const requested = requestedUrl
          ? endpoints.find((item) => item.url === requestedUrl || item.id === requestedUrl ||
              canonicalServer(item.url) === canonicalServer(requestedUrl))
          : undefined;
        if (requestedUrl && !requested) {
          setEndpointMenuError(`The graph server in query addr is not configured: ${requestedUrl}`);
        } else {
          setEndpointMenuError("");
        }
        // An empty response during restoration must not erase a menu that
        // was already available to the user.
        setFctEndpoints((current) => endpoints.length > 0 ? endpoints : current);
        // Readiness is explicit: an empty or failed registry cannot release the startup gate.
        if (endpoints.length > 0) setGraphRegistryLoadedRevision(endpointReloadRevision);
        // Preserve the selection across a login-triggered registry reload.
        // Never clear it because a transient response omits an entry.
        setSelectedEndpointId((current) => {
          const retained = endpoints.find((item) => item.id === current);
          const choice = requested ?? retained ?? (!requestedUrl ? endpoints[0] : undefined);
          return choice?.id ?? current;
        });
      } catch (error) {
        if (!cancelled) setEndpointMenuError(
          error instanceof Error ? error.message : "Could not load graph servers.",
        );
        // Keep both the existing menu and selection on fetch failure.
      }
    })();
    return () => { cancelled = true; };
    // A new login explicitly increments endpointReloadRevision. Session
    // restoration only unblocks the first read; it never increments revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRestoreComplete, endpointReloadRevision]);

  /** Health-check precisely one selected server. Never scan the registry. */
  async function checkSelectedGraphServer(endpoint: EndpointOption, manageProgress = true): Promise<EndpointStatus> {
    setCheckingEndpointIds((current) => ({ ...current, [endpoint.id]: true }));
    if (manageProgress) {
      setIsCheckingEndpoints(true);
      setEndpointChecksCompleted(0);
      setEndpointChecksTotal(1);
    }
    let status: EndpointStatus;
    try {
      const response = await fetch(
        `/proxy/api/fct?health=1&endpointId=${encodeURIComponent(endpoint.id)}`,
        { cache: "no-store", headers: proxyDebugHeaders("endpoint-health", `EndpointHealth:${endpoint.id}`) },
      );
      const data = await response.json();
      if (!response.ok || !data.check) throw new Error(data.error ?? "Health check failed.");
      status = data.check as EndpointStatus;
    } catch {
      status = { id: endpoint.id, status: null, state: "unreachable", testedUrl: endpoint.url };
    } finally {
      setCheckingEndpointIds((current) => ({ ...current, [endpoint.id]: false }));
      if (manageProgress) {
        setEndpointChecksCompleted(1);
        setIsCheckingEndpoints(false);
      }
    }
    // A host-only registry entry may resolve to HTTP, but only after HTTPS
    // returned 404. Make that resolved URL authoritative for subsequent queries.
    if (status.state === "ok" && status.status === 200 &&
        endpoint.schemeInferred && endpoint.url.startsWith("https://") &&
        status.testedUrl === endpoint.url.replace(/^https:\/\//, "http://")) {
      const resolvedUrl = status.testedUrl;
      setFctEndpoints((current) => current.map((item) => item.id === endpoint.id ? { ...item, url: resolvedUrl } : item));
      const address = queryTree.attributes.addr ?? "";
      const separator = address.indexOf("@");
      if (separator >= 0 && address.slice(separator + 1) === endpoint.url) {
        setQueryAttribute("addr", `${address.slice(0, separator)}@${resolvedUrl}`);
      }
    }
    setEndpointStatuses((current) => ({ ...current, [endpoint.id]: status }));
    return status;
  }

  async function refreshFailedEndpointAndRetry() {
    if (!endpointHealthToast || isRefreshingFailedEndpoint) return;
    const endpoint = fctEndpoints.find((item) => item.id === endpointHealthToast.endpointId);
    if (!endpoint) return;
    setIsRefreshingFailedEndpoint(true);
    try {
      const health = await checkSelectedGraphServer(endpoint);
      if (health.state === "ok" && health.status === 200) {
        setEndpointHealthToast(null);
        setEndpointMenuError("");
        refreshQuery();
      }
    } finally {
      setIsRefreshingFailedEndpoint(false);
      setIsCheckingEndpoints(false);
    }
  }

  /** Only a user's explicit menu selection or a saved query URI may select a server. */
  async function synchronizeFctEndpointSelection(graphServerUri: string) {
    if (!graphServerUri) return;
    const endpoint = fctEndpoints.find((item) => item.url === graphServerUri || item.id === graphServerUri);
    if (!endpoint) throw new Error(`The query references an unconfigured graph server: ${graphServerUri}`);
    if (!authSession && (endpoint.id === "personal-sparql" || endpoint.label.toLowerCase() === "personal sparql")) {
      throw new Error("Log in before selecting the personal graph server.");
    }
    setSelectedEndpointId(endpoint.id);
    setEndpointMenuError("");
  }

  async function chooseFctEndpoint(endpointId: string) {
    if (!endpointId || endpointId === selectedEndpointId) return;
    const endpoint = fctEndpoints.find((item) => item.id === endpointId);
    if (!endpoint) return;
    if (!authSession && (endpoint.id === "personal-sparql" || endpoint.label.toLowerCase() === "personal sparql")) return;
    setSelectedEndpointId(endpointId);
    setEndpointMenuError("");
    setEndpointHealthToast(null);
    const graph = queryTree.attributes.graph?.trim() ?? "";
    setQueryAttribute("addr", `${graph}@${endpoint.url}`);
    // The query health gate checks the newly selected server before executing.
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
        const baseLabel = toLabel(uri, "Property");
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
  useEffect(() => {
    const rootHasUri = queryTree.children.some((node) => node.name === "value" && node.attributes.datatype === "uri");
    const rootHasRelationship = queryTree.children.some((node) => node.name === "property" || node.name === "property-of");
    const rootView = queryTree.children.find((node) => node.name === "view");
    if (rootHasUri && !rootHasRelationship && rootView?.attributes.type === FCT_VIEW_TYPES.PROPERTIES) {
      setNodeAttribute(rootView.id, "type", FCT_VIEW_TYPES.LIST);
    }
  }, [queryTree, setNodeAttribute]);
  const resultsBatchSize = Math.max(
    1,
    Math.floor(Number(viewNode?.attributes.limit ?? 100) || 100),
  );
  const resultsOffset = Math.max(0, Number(viewNode?.attributes.offset ?? "0") || 0);
  const [resultsPageSize, setResultsPageSize] = useState<number>(DEFAULT_RESULTS_PAGE_SIZE);
  const activePageBatchSize = centralTab === "groups" ? groupBatchSize : resultsBatchSize;
  const resultsPageSizeOptions = pageSizesForBatch(activePageBatchSize);
  const effectivePageSize = resultsPageSizeOptions.includes(resultsPageSize) ? resultsPageSize : resultsPageSizeOptions[0];
  useEffect(() => {
    if (resultsPageSize !== effectivePageSize) {
      setResultsPageSize(effectivePageSize);
      // Keep the restored page on URL hydration; reset only when the user
      // explicitly changes the page-size selector.
      maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY, String(effectivePageSize));
    }
  }, [resultsPageSize, effectivePageSize]);

  useEffect(() => {
    let active = true;
    void initializeMaestroStorage().then(() => {
      if (!active) return;
      const savedCenter = Number(maestroStorageGet(CENTER_PANEL_LIMIT_STORAGE_KEY));
      if (RESULTS_BATCH_SIZE_OPTIONS.some((value) => value === savedCenter)) {
        const live = workbenchQueryTreeApi.getTree();
        const node = findQueryNode(live.children, "query-view");
        // Respect the restored/share URL's explicit view limit; the Sheet controls
        // it only when the view is still at the default initial batch size.
        if (node && Number(node.attributes.limit ?? 30) === 30 && savedCenter !== 30) {
          setResultsPage(savedCenter, 0);
        }
      }
      const savedGroup = Number(maestroStorageGet(CENTER_GROUP_LIMIT_STORAGE_KEY));
      if (RESULTS_BATCH_SIZE_OPTIONS.some((value) => value === savedGroup)) setGroupBatchSize(savedGroup);
      const savedDescribe = Number(maestroStorageGet(RIGHT_PANEL_DESCRIBE_LIMIT_STORAGE_KEY));
      if (RIGHT_PANEL_DESCRIBE_LIMIT_OPTIONS.some((value) => value === savedDescribe)) setRecordDescriptionQueryLimit(savedDescribe);
      const savedPage = Number(maestroStorageGet(RIGHT_PANEL_PAGE_LIMIT_STORAGE_KEY));
      if (RIGHT_PANEL_PAGE_LIMIT_OPTIONS.some((value) => value === savedPage)) setRecordDescriptionPageSize(savedPage);
    });
    return () => { active = false; };
  }, []);

  const resultsPageSizeStorageInitialized = useRef(false);

  useEffect(() => {
    if (resultsPageSizeStorageInitialized.current) return;
    resultsPageSizeStorageInitialized.current = true;
    let active = true;
    void initializeMaestroStorage().then(() => {
      if (!active) return;
      const saved = maestroStorageGet(RESULTS_PAGE_SIZE_STORAGE_KEY);
      const savedSize = Number(saved);
      if (saved !== null && Number.isFinite(savedSize) && savedSize > 0) setResultsPageSize(savedSize);
      else maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY, String(DEFAULT_RESULTS_PAGE_SIZE));
    });
    return () => { active = false; };
  }, []);

  const [leftPanelLimit, setLeftPanelLimitState] = useState<number>(DEFAULT_LEFT_PANEL_LIMIT);
  useEffect(() => {
    let active = true;
    void initializeMaestroStorage().then(() => {
      if (!active) return;
      const stored = Number(maestroStorageGet(LEFT_PANEL_LIMIT_STORAGE_KEY));
      const valid = RESULTS_BATCH_SIZE_OPTIONS.find((size) => size === stored);
      if (valid !== undefined) setLeftPanelLimitState(valid);
    });
    return () => { active = false; };
  }, []);
  const setLeftPanelLimit = useCallback((size: number) => {
    if (!RESULTS_BATCH_SIZE_OPTIONS.some((option) => option === size)) return;
    setLeftPanelLimitState(size);
    setGraphsPage(0);
    maestroStorageSet(LEFT_PANEL_LIMIT_STORAGE_KEY, String(size));
  }, []);

  // Independent query LIMITs. The shared historical preference is used only when migrating
  // previously saved settings; FACET_PAGE_SIZE remains an unrelated UI pagination size.
  const [leftWidgetLimits, setLeftWidgetLimits] = useState<Record<LeftWidgetLimitKey, number>>({
    categories: DEFAULT_LEFT_PANEL_LIMIT, graphs: DEFAULT_LEFT_PANEL_LIMIT,
    personalFacets: DEFAULT_LEFT_PANEL_LIMIT, properties: DEFAULT_LEFT_PANEL_LIMIT, roles: DEFAULT_LEFT_PANEL_LIMIT,
  });
  useEffect(() => {
    let active = true;
    void initializeMaestroStorage().then(() => {
      if (!active) return;
      const legacy = Number(maestroStorageGet(LEFT_PANEL_LIMIT_STORAGE_KEY));
      const fallback = Number.isFinite(legacy) && legacy > 0 ? legacy : DEFAULT_LEFT_PANEL_LIMIT;
      setLeftWidgetLimits((current) => {
        const next = { ...current };
        for (const key of LEFT_WIDGET_LIMIT_KEYS) {
          const value = Number(maestroStorageGet(leftWidgetLimitStorageKey(key)));
          next[key] = Number.isFinite(value) && value > 0 ? value : fallback;
        }
        return next;
      });
    });
    return () => { active = false; };
  }, []);
  const setLeftWidgetLimit = useCallback((key: LeftWidgetLimitKey, size: number) => {
    if (!LEFT_WIDGET_LIMIT_OPTIONS.some((option) => option === size)) return;
    setLeftWidgetLimits((current) => ({ ...current, [key]: size }));
    maestroStorageSet(leftWidgetLimitStorageKey(key), String(size));
    if (key === "graphs") setGraphsPage(0);
    if (key === "categories") setClassesPage(0);
    if (key === "properties") setPropertiesPage(0);
    if (key === "roles") setRolesPage(0);
  }, []);

  const queryXml = serializeFctQuery(queryTree);
  // Status filters are ordinary, scope-local FCT nodes, just like <class>.
  // No separate React selection state and no bookmark-dependent Results mode.
  const statusFilterScopeId = getPropertyPath().at(-1)?.id ?? null;
  const statusScope = statusFilterScopeId ? findQueryNode(queryTree.children, statusFilterScopeId) : undefined;
  const scopeStatusNodes = (statusScope?.children ?? queryTree.children).filter((node) => node.name === "status");
  const selectedStatusFilters = new Set<StatusFacetName>(scopeStatusNodes
    .map((node) => (node.text ?? "").trim().replace("gttp://ggg.maestro.ecosys/ns/ui#", ""))
    .filter((name): name is StatusFacetName => name === "New" || name === "Seen" || name === "Starred" || name === "Hidden"));
  const toggleSelectedStatusFilter = useCallback((name: StatusFacetName) => {
    const uri = `gttp://ggg.maestro.ecosys/ns/ui#${name}`;
    const scope = statusFilterScopeId ? findQueryNode(queryTree.children, statusFilterScopeId) : undefined;
    const existing = (scope?.children ?? queryTree.children).find((node) => node.name === "status" && node.text?.trim() === uri);
    if (existing) deleteNode(existing.id);
    else insertNode(statusFilterScopeId, { id: `status-${crypto.randomUUID()}`, name: "status", attributes: { type: "uri" }, text: uri, children: [] });
    setResultsUiPage(0);
    setResultsPage(resultsBatchSize, 0);
  }, [statusFilterScopeId, queryTree, deleteNode, insertNode, resultsBatchSize, setResultsPage]);

  // Load vocabulary namespace labels from the app's LOD metadata route. Known
  // prefixes are seeded synchronously, so the UI never falls back to nsN for
  // established public vocabularies while metadata is loading.
  useEffect(() => {
    let active = true;
    fetch("/proxy/api/ontology/namespaces", { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { namespaces?: unknown } | null) => {
        if (active && payload?.namespaces) rememberNamespaceMetadata(payload.namespaces);
      })
      .catch(() => { /* Built-in namespace prefixes remain available offline. */ });
    return () => { active = false; };
  }, []);

  // Ask the personal store whether this exact serialized query already has a bookmark.
  useEffect(() => {
    if (!personalStoreReady || !graphRegistryReady) { setIsQueryBookmarked(false); setMatchingBookmarkId(""); return; }
    if (!urlStateInitialized) return;
    let active = true;
    setIsQueryBookmarked(false);
    setMatchingBookmarkId("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/proxy/api/query-favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check", queryXml, historyId: historyBookmarkId || undefined }),
          cache: "no-store",
        });
        const payload = await response.json() as { bookmarked?: boolean; historyId?: string | null };
        if (active && response.ok) {
          setIsQueryBookmarked(payload.bookmarked === true);
          setMatchingBookmarkId(payload.bookmarked && payload.historyId ? payload.historyId : "");
        }
      } catch {
        if (active) {
          setIsQueryBookmarked(false);
          setMatchingBookmarkId("");
        }
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [queryXml, urlStateInitialized, bookmarkCheckRevision, historyBookmarkId, personalStoreReady, graphRegistryReady]);

  // Keep History navigation enabled state synchronized with the actual store.
  // With no loaded History item, the comparison cursor is the current time.
  useEffect(() => {
    if (!personalStoreReady) { setHistoryHasOlder(false); setHistoryHasNewer(false); return; }
    if (!urlStateInitialized || rootSearchExpanded) return;
    let active = true;
    // Preserve the currently displayed button states while the root search
    // field is open. They are refreshed only after the coalesced History write
    // has been persisted when the field closes.
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        // Query changes enqueue a History visit. Wait for that write, then ask
        // relative to the newly-current item rather than the previous cursor.
        await historyWriteQueueRef.current;
        if (!active) return;
        const currentId = historyVisitQueryRef.current === queryXml
          ? historyVisitIdRef.current
          : historyBookmarkId;
        // Attribute each availability query to the specific navigation button
        // whose enabled state it controls. Separate requests make the component
        // identity unambiguous in DevTools and server-side request logs.
        const [backResponse, forwardResponse] = await Promise.all([
          fetch("/proxy/api/query-favorites", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-maestro-debug-component": "HistoryBackButton",
            },
            body: JSON.stringify({ action: "availability", direction: "backward", historyId: currentId }),
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/proxy/api/query-favorites", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-maestro-debug-component": "HistoryForwardButton",
            },
            body: JSON.stringify({ action: "availability", direction: "forward", historyId: currentId }),
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        const [backPayload, forwardPayload] = await Promise.all([
          backResponse.json() as Promise<{ older?: boolean }>,
          forwardResponse.json() as Promise<{ newer?: boolean }>,
        ]);
        if (active) {
          setHistoryHasOlder(backResponse.ok && backPayload.older === true);
          setHistoryHasNewer(forwardResponse.ok && forwardPayload.newer === true);
        }
      } catch {
        if (active) {
          setHistoryHasOlder(false);
          setHistoryHasNewer(false);
        }
      }
    }, 100);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [urlStateInitialized, historyBookmarkId, queryXml, bookmarkCheckRevision, rootSearchExpanded, personalStoreReady]);

  useEffect(() => {
    if (!bookmarkDialogOpen) return;
    const timer = window.setTimeout(() => {
      bookmarkTitleInputRef.current?.focus();
      bookmarkTitleInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookmarkDialogOpen]);

  // The main Results request must use the active view's server-side limit and offset.
  const queryResultsXml = queryXml;
  const prettyQueryXml = xmlFormat(queryXml, { indentation: "  " });

  /**
   * Apply a saved FCT query and its shareable UI state without navigating. The
   * initial URL restore and RDF History navigation both use this same path so
   * query listeners and every UI component are refreshed consistently.
   */
  function restoreQueryAndUiState(
    serializedQuery: string | null,
    restored: ShareableUiState | null,
    restoredHistoryId?: string | null,
  ): boolean {
    if (restoredHistoryId) setHistoryBookmarkId(restoredHistoryId);
    let restoredQueryFromUrl = false;
    if (serializedQuery) {
      const restoredTree = parseFctQueryXml(serializedQuery);
      if (restoredTree) {
        // Restore the authoritative query through the store so every existing
        // query listener sees the same tree as if the user had built it in the UI.
        const restoredTextNode = restoredTree.children.find(
          (node) => node.name === "text" && node.id === "query-text",
        );
        setSearch(restoredTextNode?.text ?? "");
        // The Name / All fields / Clear Terms control is derived from the
        // presence of this node and its `property` attribute. Preserve that
        // structure exactly, including a URL that intentionally has no <text>.
        // Keep the datasite field tied to the graph attribute in q, rather than
        // allowing a separately saved draft field to override the shared query.
        const restoredAddress = restoredTree.attributes.addr ?? "";
        const addressDelimiter = restoredAddress.indexOf("@");
        const incomingGraph = addressDelimiter >= 0 ? restoredAddress.slice(0, addressDelimiter) : "";
        // Three distinct address modes: empty graph triggers discovery,
        // $ALL$ explicitly disables graph scoping, an IRI selects that graph.
        const restoredGraph = incomingGraph;
        restoredTree.attributes.graph = restoredGraph;
        restoredTree.attributes.addr = addressDelimiter >= 0 ? `${restoredGraph}${restoredAddress.slice(addressDelimiter)}` : restoredAddress;
        // Leave graph-less share URLs untouched so the query preprocessor can
        // resolve their graph before dispatching normal queries.
        replaceQueryTree(restoredTree);
        if (restoredGraph !== ALL_GRAPHS) lastManualGraphRef.current = restoredGraph;
        setGraphText(restoredGraph);
        restoredQueryFromUrl = true;
      }
    }
    if (restored) {
      // Ribbon identity is the SHACL provider resource URI, never its label.
      if (restored.viewPanel === "trail" || restored.viewPanel === "perspectives" || restored.viewPanel === "features") setViewPanel(restored.viewPanel);
      if (restored.selectedViewUri === "" || (typeof restored.selectedViewUri === "string" && restored.selectedViewUri.length <= 2048 && /^(?:https?:|gttp:|gttps:|urn:)/.test(restored.selectedViewUri))) setSelectedViewUri(restored.selectedViewUri);
      if (restored.viewFeature === null || restored.viewFeature === "policies" || restored.viewFeature === "formats" || restored.viewFeature === "transcoders") setViewFeature(restored.viewFeature);
      if (typeof restored.selectedAnalysisUri === "string" && restored.selectedAnalysisUri.length <= 2048 && /^(?:https?:|gttp:|gttps:|urn:)/.test(restored.selectedAnalysisUri)) setSelectedAnalysisUri(restored.selectedAnalysisUri);
      if (typeof restored.analyzeHistogram === "boolean") setAnalyzeHistogram(restored.analyzeHistogram);
      // Endpoint selection is authoritative in the restored query addr.
      if (typeof restored.selectedFacet === "string" && restored.selectedFacet.length < 100) setSelectedFacet(restored.selectedFacet);
      if (typeof restored.propertiesPage === "number" && Number.isFinite(restored.propertiesPage)) setPropertiesPage(Math.max(0, Math.floor(restored.propertiesPage)));
      if (typeof restored.classesPage === "number" && Number.isFinite(restored.classesPage)) setClassesPage(Math.max(0, Math.floor(restored.classesPage)));
      if (typeof restored.graphsPage === "number" && Number.isFinite(restored.graphsPage)) setGraphsPage(Math.max(0, Math.floor(restored.graphsPage)));
      if (typeof restored.rolesPage === "number" && Number.isFinite(restored.rolesPage)) setRolesPage(Math.max(0, Math.floor(restored.rolesPage)));
      if (typeof restored.findEndpointsEnabled === "boolean") setFindEndpointsEnabled(restored.findEndpointsEnabled);
      // "query-tree" was a full-pane tab in older share links; it is now the
      // lower pane, so it maps to Results plus an open Query Tree pane.
      if (["results", "groups", "query-tree", "view-query", "chat"].includes(restored.centralTab ?? "")) {
        setCentralTab(restored.centralTab === "query-tree" || restored.centralTab === "chat" ? "results" : restored.centralTab!);
      }
      if (restored.workspaceTab === "browse" || restored.workspaceTab === "view" || restored.workspaceTab === "analyze") setWorkspaceTab(restored.workspaceTab);
      const toolbarToggles = readToolbarToggleState(restored);
      setQueryTreeOpen(toolbarToggles.queryTreeOpen);
      setShowResultBadges(
        typeof restored.showResultBadges === "boolean" || typeof restored.badgesToggle === "boolean"
          ? toolbarToggles.showResultBadges
          : maestroStorageGet("maestro-show-result-badges") === "true",
      );
      if (restored.breadcrumbBadgeMode === "classes" || restored.breadcrumbBadgeMode === "records") {
        setBreadcrumbBadgeMode(restored.breadcrumbBadgeMode);
        maestroStorageSet("maestro-breadcrumb-badge-mode", restored.breadcrumbBadgeMode);
      }
      if (["xml", "sparql", "alphabet-xml", "alphabet-sparql", "list-values-xml", "list-values-sparql", "response"].includes(restored.querySourceFormat ?? "")) setQuerySourceFormat(restored.querySourceFormat as "xml" | "sparql" | "alphabet-xml" | "alphabet-sparql" | "list-values-xml" | "list-values-sparql" | "response");
      if (["facets", "personal", "community"].includes(restored.defaultLeftTab ?? "")) setDefaultLeftTab(restored.defaultLeftTab!);
      if (restored.focusListOrder === "Properties" || restored.focusListOrder === "Roles") setFocusListOrder(restored.focusListOrder);
      if (typeof restored.focusWidgetsSuppressed === "boolean") setFocusWidgetsSuppressed(restored.focusWidgetsSuppressed);
      if (typeof restored.groupByPropertyUri === "string") setGroupByPropertyUri(restored.groupByPropertyUri);
      if (typeof restored.resultsUiPage === "number" && Number.isFinite(restored.resultsUiPage)) setResultsUiPage(Math.max(0, Math.floor(restored.resultsUiPage)));
      if (typeof restored.groupUiPage === "number" && Number.isFinite(restored.groupUiPage)) setGroupUiPage(Math.max(0, Math.floor(restored.groupUiPage)));
      if (typeof restored.groupBatchSize === "number" && RESULTS_BATCH_SIZE_OPTIONS.some((n) => n === restored.groupBatchSize)) setGroupBatchSize(restored.groupBatchSize);
      if (typeof restored.groupBatchOffset === "number" && Number.isFinite(restored.groupBatchOffset)) setGroupBatchOffset(Math.max(0, Math.floor(restored.groupBatchOffset)));
      if (typeof restored.resultsPageSize === "number" && Number.isFinite(restored.resultsPageSize) && restored.resultsPageSize > 0) setResultsPageSize(restored.resultsPageSize);
      if (typeof restored.selectedUri === "string") setSelectedUri(restored.selectedUri);
      // Clear Terms removes <text> from q, so preserve the hidden draft separately
      // to restore it when the user switches back to Name or All fields.
      const restoredNameProperties = Array.isArray(restored.selectedNamePropertyUris)
        ? restored.selectedNamePropertyUris.filter((uri): uri is string => typeof uri === "string" && uri.trim().length > 0)
        : typeof restored.selectedNamePropertyUri === "string" && restored.selectedNamePropertyUri.trim()
          ? restored.selectedNamePropertyUri.split(/[\s,]+/).filter(Boolean)
          : null;
      if (restoredNameProperties?.length) setSelectedNamePropertyUris(restoredNameProperties);
      if (typeof restored.savedSearchDraft === "string") {
        setSavedSearchDraft(restored.savedSearchDraft);
        if (!restoredQueryFromUrl && !restored.savedUriDraft) setSearchDraft(restored.savedSearchDraft);
      }
      if (typeof restored.savedUriDraft === "string") {
        setSavedUriDraft(restored.savedUriDraft);
        if (!restoredQueryFromUrl) setSearchDraft(restored.savedUriDraft);
      }
      if (typeof restored.graphAutoFill === "boolean") setGraphAutoFill(restored.graphAutoFill);
      if (typeof restored.graphText === "string" && restored.graphText !== ALL_GRAPHS) {
        lastManualGraphRef.current = restored.graphText;
        if (!restoredQueryFromUrl) {
          restoredGraphTextRef.current = restored.graphText;
          setGraphText(restored.graphText);
        }
      }
      if (typeof restored.rdfSourceUrl === "string") setRdfSourceUrl(restored.rdfSourceUrl);
      if (typeof restored.rdfTargetGraph === "string") setRdfTargetGraph(restored.rdfTargetGraph);
    }
    // Root breadcrumb: signal status plus the URI and search-text values saved with this History item.
    // The explicit saved fields win; items saved before they existed fall back to what the query itself implies.
    {
      const rootChildren = serializedQuery ? (parseFctQueryXml(serializedQuery)?.children ?? []) : [];
      const impliedUri = rootChildren.find((node) => node.name === "value" && node.attributes.datatype === "uri");
      const impliedText = rootChildren.find((node) => node.name === "text" && node.id === "query-text");
      const impliedMode: "uri" | "exact" | "name" | "all" | "clear" = impliedUri ? "uri" : !impliedText ? "clear" : impliedText.attributes.property ? (impliedText.attributes.exact === "true" ? "exact" : "name") : "all";
      const savedMode = restored?.selectedSignalMode;
      const mode: "uri" | "exact" | "name" | "all" | "clear" | null = savedMode === "uri" || savedMode === "name" || savedMode === "exact" || savedMode === "all" || savedMode === "clear"
        ? savedMode
        : (serializedQuery ? impliedMode : null);
      if (mode) {
        selectedSignalModeRef.current = mode;
        setSelectedSignalMode(mode);
      }
      if (serializedQuery || restored) {
        const uriValue = typeof restored?.savedUriDraft === "string" ? restored.savedUriDraft : (impliedUri?.text ?? "");
        const textValue = typeof restored?.savedSearchDraft === "string" ? restored.savedSearchDraft : (impliedText?.text ?? "");
        setSavedUriDraft(uriValue);
        setSavedSearchDraft(textValue);
        const shown = typeof restored?.searchDraft === "string" ? restored.searchDraft : (mode === "uri" ? uriValue : mode === "clear" ? "" : textValue);
        searchDraftRef.current = shown;
        setSearchDraft(shown);
      }
    }
    return restoredQueryFromUrl;
  }

  useEffect(() => {
    if (urlStateInitialized) maestroStorageSet("maestro-show-result-badges", showResultBadges ? "true" : "false");
  }, [urlStateInitialized, showResultBadges]);

  // Restore the initial share URL once. Subsequent state changes only rewrite
  // the address bar; they never navigate or rerun this initializer.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Select the URL tab before restoring any query or saved UI state.
    const tabFromUrl = params.get("tab");
    const decodedTabFromUrl = decodeAppbarTab(tabFromUrl);
    if (decodedTabFromUrl) setWorkspaceTab(decodedTabFromUrl);
    const initialUiState = readShareableUiState();
    restoreQueryAndUiState(params.get("q"), initialUiState, params.get("history"));
    if (!initialUiState) setShowResultBadges(maestroStorageGet("maestro-show-result-badges") === "true");
    // An explicit ?tab= wins over a possibly older workspaceTab in saved state.
    if (decodedTabFromUrl) setWorkspaceTab(decodedTabFromUrl);
    setUrlStateInitialized(true);
  // This is intentionally a one-time initializer for the initial URL only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One authoritative serializer for the address bar, History and bookmarks.
  // Never save window.location.href as a snapshot of React state: the URL effect
  // can lag behind the user's most recent ribbon selection.
  function buildCurrentShareUrl(): string {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    params.set("q", queryXml);
    params.set("tab", String(APPBAR_TAB_NUMBER[workspaceTab]));
    params.set("ribbonTab", String(VIEW_RIBBON_TAB_NUMBER[viewPanel]));
    params.set("ribbonButton", workspaceTab === "view" && viewPanel === "perspectives" ? selectedViewUri : "");
    const state: ShareableUiState = {
      selectedFacet,
      propertiesPage,
      classesPage,
      graphsPage,
      rolesPage,
      findEndpointsEnabled,
      centralTab,
      viewFeature,
      selectedAnalysisUri,
      analyzeHistogram,
      queryToggle: queryTreeOpen,
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
      graphAutoFill,
      rdfSourceUrl,
      rdfTargetGraph,
      selectedSignalMode,
      searchDraft,
      savedSearchDraft,
      savedUriDraft,
      selectedNamePropertyUris,
      breadcrumbBadgeMode,
    };
    params.set("state", JSON.stringify(state));
    return url.href;
  }

  useEffect(() => {
    if (!urlStateInitialized) return;
    const url = new URL(buildCurrentShareUrl());
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [urlStateInitialized, queryXml, queryRevision, selectedEndpointId, selectedFacet, propertiesPage, classesPage, graphsPage, rolesPage, findEndpointsEnabled, centralTab, workspaceTab, queryTreeOpen, showResultBadges, querySourceFormat, defaultLeftTab, focusListOrder, focusWidgetsSuppressed, groupByPropertyUri, resultsUiPage, groupUiPage, groupBatchSize, groupBatchOffset, resultsPageSize, selectedUri, graphText, graphAutoFill, rdfSourceUrl, rdfTargetGraph, savedSearchDraft, savedUriDraft, selectedNamePropertyUris, breadcrumbBadgeMode, selectedSignalMode, searchDraft, viewPanel, selectedViewUri, viewFeature, selectedAnalysisUri, analyzeHistogram]);

  /** Persist one History visit for a query snapshot, preserving queue ordering. */
  async function writeHistoryVisit(queryXmlSnapshot: string, stateUrlSnapshot: string, action: { operator: "+" | "-"; xpath: string; value?: string } | null) {
    const response = await fetch("/proxy/api/query-favorites", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "visit", queryXml: queryXmlSnapshot, stateUrl: stateUrlSnapshot, historyAction: action }), cache: "no-store",
    });
    const payload = await response.json() as { historyId?: string; error?: string };
    if (!response.ok || !payload.historyId) throw new Error(payload.error ?? `HTTP ${response.status}`);
    historyVisitIdRef.current = payload.historyId;
    setHistoryBookmarkId(payload.historyId);
    // Persist the URL captured for this exact query visit, not the current URL.
    const visitUrl = new URL(stateUrlSnapshot, window.location.origin);
    visitUrl.searchParams.set("history", payload.historyId);
    const currentParams = new URLSearchParams(window.location.search);
    if (currentParams.get("q") === queryXmlSnapshot) {
      currentParams.set("history", payload.historyId);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${currentParams.toString()}${window.location.hash}`);
    }
    await fetch("/proxy/api/query-favorites", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateState", historyId: payload.historyId, stateUrl: visitUrl.toString() }), cache: "no-store",
    });
  }

  // Each distinct FCT query gets its own History record. While the root breadcrumb
  // search is visible, coalesce all query/UI changes and persist only the latest
  // snapshot after the search closes. Ribbon/perspective selections are UI-only
  // changes too: they must update the saved visit URL, not just the address bar.
  useEffect(() => {
    if (!urlStateInitialized) return;
    // Not logged in: never record History. Tracking refs stay untouched so the current query is recorded as a fresh visit after login.
    if (!personalStoreReady || templateHistoryFlushRef.current) return;
    const stateUrl = buildCurrentShareUrl();
    const previousQueryXml = historyVisitQueryRef.current;
    const isInitialLoadedHistoryItem = Boolean(historyBookmarkId && !previousQueryXml);
    const isNewQuery = !isInitialLoadedHistoryItem && previousQueryXml !== queryXml;
    const queryAction = isNewQuery ? deriveHistoryAction(previousQueryXml, queryXml) : null;
    historyVisitQueryRef.current = queryXml;
    if (isInitialLoadedHistoryItem) historyVisitIdRef.current = historyBookmarkId;

    const synchronize = async () => {
      try {
        if (isNewQuery) {
          await writeHistoryVisit(queryXml, stateUrl, queryAction);
          return;
        }

        // On initial restoration, keep the selected History item as the cursor.
        // On UI-only state changes, update its URL without creating a new visit.
        const currentId = historyBookmarkId;
        // Never overwrite an older visit's URL with the URL for a newer query
        // while that newer query's History item is still being written.
        if (currentId && historyVisitIdRef.current === currentId && historyVisitQueryRef.current === queryXml) {
          await fetch("/proxy/api/query-favorites", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "updateState", historyId: currentId, stateUrl }), cache: "no-store",
          });
        }
      } catch (error) {
        console.warn("Maestro History synchronization failed", error);
      }
    };

    if (rootSearchExpanded) {
      // No History writes while the root search field is visible. Only create a
      // pending snapshot once a query changes, then replace it with the latest
      // query/state whenever more changes occur.
      if (isNewQuery || pendingHistoryVisitRef.current) {
        const pendingPreviousXml = pendingHistoryVisitRef.current?.queryXml ?? previousQueryXml;
        pendingHistoryVisitRef.current = { queryXml, stateUrl, action: deriveHistoryAction(pendingPreviousXml, queryXml) };
      }
      return;
    }
    const pending = pendingHistoryVisitRef.current;
    if (pending) {
      pendingHistoryVisitRef.current = null;
      // Persist the final coalesced snapshot, not a separately reconstructed
      // value. Intermediate snapshots are discarded when the ref is cleared.
      const persistLatest = async () => {
        if (rootSearchExpandedRef.current) {
          pendingHistoryVisitRef.current = { queryXml: pending.queryXml, stateUrl: pending.stateUrl, action: pending.action };
          return;
        }
        try {
          await writeHistoryVisit(pending.queryXml, pending.stateUrl, pending.action);
        } catch (error) {
          console.warn("Maestro History synchronization failed", error);
        }
      };
      historyWriteQueueRef.current = historyWriteQueueRef.current.then(persistLatest, persistLatest);
      return;
    }
    const synchronizeWhenCollapsed = async () => {
      if (rootSearchExpandedRef.current) {
        pendingHistoryVisitRef.current = { queryXml, stateUrl, action: queryAction };
        return;
      }
      await synchronize();
    };
    historyWriteQueueRef.current = historyWriteQueueRef.current.then(synchronizeWhenCollapsed, synchronizeWhenCollapsed);
    // Do not cancel queued writes in effect cleanup; pending History is flushed
    // when the root breadcrumb search field closes.
  }, [urlStateInitialized, queryXml, queryRevision, historyBookmarkId, selectedEndpointId, selectedFacet, propertiesPage, classesPage, graphsPage, rolesPage, findEndpointsEnabled, centralTab, workspaceTab, queryTreeOpen, showResultBadges, querySourceFormat, defaultLeftTab, focusListOrder, focusWidgetsSuppressed, groupByPropertyUri, resultsUiPage, groupUiPage, groupBatchSize, groupBatchOffset, resultsPageSize, selectedUri, graphText, graphAutoFill, rdfSourceUrl, rdfTargetGraph, savedSearchDraft, savedUriDraft, selectedNamePropertyUris, rootSearchExpanded, authSession, selectedSignalMode, viewPanel, selectedViewUri, viewFeature, selectedAnalysisUri, analyzeHistogram]);

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
      return [{ key: `forward:${uri}`, uri, direction: "forward" as const, label: toLabel(uri, "Property"), nodeId: node.id }];
    }),
    // Only reverse-role nodes explicitly selected in Focus belong in Group By.
    // A <property-of> ancestor that merely contains the active <view> is a
    // navigation/scope breadcrumb, not a checked relationship selection.
    ...getActiveViewRoleFilters(queryTree).flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri || node.attributes.exclude?.trim().toLowerCase() === "yes") return [];
      return [{ key: `reverse:${uri}`, uri, direction: "reverse" as const, label: `${toLabel(uri, "Role")} of`, nodeId: node.id }];
    }).filter((option, index, all) => all.findIndex((candidate) => candidate.key === option.key) === index),
  ];
  const selectedGroupByOption = groupByOptions.find((option) => option.key !== "" && option.key === groupByPropertyUri) ?? null;
  useEffect(() => {
    if (urlStateInitialized && endpointReadyForQuery && groupByPropertyUri && !groupByOptions.some((option) => option.key === groupByPropertyUri)) {
      // Opening Code Block does not mutate the FCT query. Ignore transient
      // facet-option gaps during that pane switch; restore the grouping when
      // returning to Results instead of treating the pane switch as deselection.
      if (groupByBeforeCodeViewRef.current === groupByPropertyUri) return;
      setGroupByPropertyUri("");
      setCentralTab((current) => current === "groups" ? "results" : current);
    }
  }, [groupByPropertyUri, groupByOptions.map((option) => option.key).join("|"), centralTab]);
  useEffect(() => {
    if (groupByBeforeCodeViewRef.current && centralTab !== "view-query" && groupByOptions.some((option) => option.key === groupByBeforeCodeViewRef.current)) {
      groupByBeforeCodeViewRef.current = "";
    }
  }, [centralTab, groupByOptions.map((option) => option.key).join("|")]);
  
  
  
  
  const groupMemberRequestStates = useRef(new Map<string, "loading" | "loaded">());
  // Counts are derived from the member rows loaded for each visible group.
  // Keep the index and cards in the same descending-count order.
  // Order the WHOLE loaded set with the canonical comparator before paging, so page N of the cards, the group
  // index, and the grouped Personal facet widget (same comparator, same query) all list values in one order.
  const orderedGroupValues = groupValues.slice().sort(compareGroupValues);
  const pageGroupValues = orderedGroupValues.slice(groupUiPage * resultsPageSize, (groupUiPage + 1) * resultsPageSize);
  const visibleGroupValues = pageGroupValues;
  const groupedPersonalFacetUri = selectedGroupByOption?.direction === "forward"
    && selectedGroupByOption.uri !== RDF_TYPE_URI
    && personalWidgets.some((widget) => widget.uri === selectedGroupByOption.uri && !widget.excluded)
    ? selectedGroupByOption.uri
    : null;
  const isGroupByCategory = selectedGroupByOption?.direction === "forward" && selectedGroupByOption.uri === RDF_TYPE_URI;
  const groupedRoleUri = selectedGroupByOption?.direction === "reverse"
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
    const clickedKey = facetValueKey(value);
    let matchIndex = orderedGroupValues.findIndex((groupValue) => facetValueKey(groupValue) === clickedKey);
    // Fall back to the value's identity (URI/text + language) if term-type metadata differs between the two panes.
    if (matchIndex < 0) matchIndex = orderedGroupValues.findIndex((groupValue) => groupValue.uri === value.uri && (groupValue.lang ?? "") === (value.lang ?? ""));
    if (matchIndex < 0) return;
    const groupValue = orderedGroupValues[matchIndex];
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
  function navigatePropertyUsage(direction: PropertyUsageDirection, selection?: { value: FctValue; checked: boolean }) {
    // Pivot through the predicate selected in Results. A checkbox binds its
    // Subject/Values item to the new relationship, never the predicate itself.
    const next = propertyUsageNavigation(queryTree, direction, selection, selectedUri);
    if (next === queryTree) {
      toast.add({ title: "Select a property first", description: "Select a predicate resource in Results before navigating.", type: "error" });
      return;
    }
    replaceQueryTree(next);
    setCentralTab("results");
    setWorkspaceTab("browse");
  }
  const queryWithoutPagingXml = useCallback(
  (viewType?: FctViewType, sortByCount = false, classTree = false) =>
    serializeFctQuery(
      setQueryViewAttributes(queryTree, {
        ...(viewType ? { type: viewType } : {}),
        sort: sortByCount ? "count" : "",
        // tree="yes" adds every superclass up to the root, so the view returns one row per
        // (class, parent) edge and needs a much larger window than the flat list.
        limit: String(viewType === FCT_VIEW_TYPES.CLASSES ? leftWidgetLimits.categories
          : viewType === FCT_VIEW_TYPES.PROPERTIES ? leftWidgetLimits.properties
          : viewType === FCT_VIEW_TYPES.PROPERTIES_IN ? leftWidgetLimits.roles
          : viewType === FCT_VIEW_TYPES.GRAPHS ? leftWidgetLimits.graphs : leftPanelLimit),
        offset: "0",
        ...(classTree ? { tree: "yes" } : {}),
      }),
    ),
  [queryTree, leftPanelLimit, leftWidgetLimits.categories, leftWidgetLimits.properties, leftWidgetLimits.roles, leftWidgetLimits.graphs],
);
  // Snapshot the semantic facet requests. Effects depend on their serialized XML,
  // not queryWithoutPagingXml's callback identity (which changes on every tree edit).
  const propertyFacetQueryXml = queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES);
  // The flat Categories list is authoritative in both display modes. Tree mode only changes its arrangement.
  const classFacetQueryXml = queryWithoutPagingXml(FCT_VIEW_TYPES.CLASSES, isGroupByCategory, false);
  const roleFacetQueryXml = queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES_IN);
  // For broad scans of large public endpoints, use the tested rdfs:label-only
  // alphabet query. Other label predicates in the former 17-way join made the
  // aggregation prohibitively expensive on the Virtuoso DBpedia demo.
  const alphabetLabelUris = "http://www.w3.org/2000/01/rdf-schema#label";
  // The Alphabet system facet queries a clone of the live scope and never
  // constrains its own counts by the currently selected letter.
  const alphabetQueryXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
    type: FCT_VIEW_TYPES.ALPHABET, index: "", indexLabels: alphabetLabelUris, indexLang: preferredAlphabetLanguage, limit: "26", offset: "0",
  }));
  // ASK preflight: clone the *live* query and append only the label
  // relationship to its active view scope. Do not run the alphabet query,
  // its language/initial filters, GROUP BY, or any count until ASK is true.
  const alphabetAskQueryXml = (() => {
    const clone = setQueryViewAttributes(queryTree, {
      type: FCT_VIEW_TYPES.ASK, index: "", limit: "1", offset: "0",
    });
    const addLabelAtViewScope = (nodes: FctQueryNode[], parentName = "query"): FctQueryNode[] => {
      // Literal values at a forward-property focus do not have RDF labels.
      // The alphabet query includes them, so the preflight must too.
      if (nodes.some((node) => node.name === "view")) return parentName === "property" ? nodes : [
        ...nodes,
        { id: "alphabet-preflight-label", name: "property", attributes: { iri: alphabetLabelUris }, children: [] },
      ];
      return nodes.map((node) => ({ ...node, children: addLabelAtViewScope(node.children, node.name) }));
    };
    return serializeFctQuery({ ...clone, children: addLabelAtViewScope(clone.children) });
  })();
  // Each alphabet badge now uses the same letter-restricted WHERE clause as
  // the Results view. Virtuoso's grouped uppercase-initial aggregate produced
  // incorrect totals on DBpedia, whereas the scalar Z count returned 3.
  const alphabetCountSparqlForLetter = (letter: string): string => {
    const letterXml = alphabetQueryXml
      .replace('type="alphabet"', 'type="text"')
      .replace('index=""', `index="${letter}"`);
    const compiled = compileFctXmlToSparql(letterXml);
    const start = compiled.query.indexOf("WHERE {");
    const end = compiled.query.lastIndexOf("\n}");
    const select = compiled.query.indexOf("SELECT");
    if (start < 0 || end < start || select < 0 || !/^\?[A-Za-z_][A-Za-z0-9_]*$/.test(compiled.target)) {
      throw new Error(`Cannot derive the ${letter} alphabet count from Results SPARQL.`);
    }
    return `${compiled.query.slice(0, select)}SELECT (COUNT(DISTINCT ${compiled.target}) AS ?ct)\n${compiled.query.slice(start, end + 2)}`;
  };
  // The Code Block shows the actual count query for the selected letter (or
  // A as an example when none is selected); the other 25 differ only by letter.
  const alphabetSparql = (() => {
    try {
      const selected = queryTree.children.flatMap((node) => {
        const collect = (item: FctQueryNode): string[] => item.name === "view"
          ? [item.attributes.index ?? ""]
          : item.children.flatMap(collect);
        return collect(node);
      }).find((letter) => /^[A-Z]$/.test(letter));
      const letter = selected || "A";
      return `# Alphabet count for ${letter}; Maestro executes one scalar query per letter A–Z.\n${alphabetCountSparqlForLetter(letter)}`;
    } catch (error) {
      return `# Alphabet count SPARQL compilation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  const currentView = (() => {
    const seek = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
      for (const node of nodes) {
        if (node.name === "view") return node;
        const child = seek(node.children);
        if (child) return child;
      }
    };
    return seek(queryTree.children);
  })();
  const alphabetIndex = currentView?.attributes.index || "";
  
  
  
  
  
  // Ask FCT for the total independently of the current results page. The
  // count view uses the same active scope and filters, but never the page offset.
  const queryCountXml = serializeFctQuery(
    setQueryViewAttributes(queryTree, { type: FCT_VIEW_TYPES.TEXT, limit: "1000", offset: "0" }),
  );

  const resultsEnrichmentCacheRef = useRef(new Map<string, ScopeValue[]>());
  
  
  
  
  const queryGraphServer = readGraphServerFromQueryXml(queryCountXml);
  // The graph portion of addr is a required preprocessing result, not a
  // second, independent component state. A missing graph authorizes only the
  // constrained LIMIT 1 discovery probe until it completes with no matches.
  const graphAddress = queryTree.attributes.addr ?? "";
  const graphSeparator = graphAddress.indexOf("@");
  const graphAlreadySelected = graphSeparator > 0 && Boolean(graphAddress.slice(0, graphSeparator).trim());
  setObservationQueryAddr(queryTree.attributes.addr ?? "");
  const graphProbeIdentity = `${queryXml}\u0000${selectedEndpointId}\u0000${queryRefreshRevision}`;
  const [graphProbe, setGraphProbe] = useState<{ identity: string; state: "empty" | "running" | "no-graph" | "error"; error?: string }>({ identity: "", state: "empty" });
  const graphResolutionReady = !graphAutoFill || graphAlreadySelected || (graphProbe.identity === graphProbeIdentity && graphProbe.state === "no-graph");
  const graphHealthReady = Boolean(
    selectedEndpointId && selectedEndpointStatus?.state === "ok" && selectedEndpointStatus.status === 200 &&
    queryGraphServer && fctEndpoints.some((endpoint) => endpoint.id === selectedEndpointId && queryGraphServer === endpoint.url)
  );
  useEffect(() => {
    if (!urlStateInitialized || !graphHealthReady || graphAlreadySelected || graphFieldEditing || !graphAutoFill) return;
    // The probe is keyed on the exact live XML, so a changed query invalidates
    // old results. Neither a failed probe nor a partial result grants access.
    const controller = new AbortController();
    setGraphProbe({ identity: graphProbeIdentity, state: "running" });
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/fct", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("graph-preprocess", "GraphPreprocessor") },
          body: JSON.stringify({ queryXml, discoverGraph: true }),
        });
        const data = await response.json() as { graph?: string | null; found?: boolean; error?: string };
        if (!response.ok) throw new Error(data.error ?? `Graph discovery returned HTTP ${response.status}`);
        if (controller.signal.aborted) return;
        if (!data.found) {
          setGraphProbe({ identity: graphProbeIdentity, state: "no-graph" });
        } else if (data.graph && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\]+$/.test(data.graph)) {
          // setQueryAttribute('graph') also rewrites the graph portion of addr
          // atomically, preserving the user's authoritative graph server.
          setGraphText(data.graph);
          setQueryAttribute("graph", data.graph);
        } else {
          throw new Error("Graph discovery returned an invalid graph URI.");
        }
      } catch (error) {
        if (!controller.signal.aborted) setGraphProbe({ identity: graphProbeIdentity, state: "error", error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => controller.abort();
  }, [urlStateInitialized, graphHealthReady, graphAlreadySelected, graphFieldEditing, graphAutoFill, graphProbeIdentity, queryXml]);
  const endpointReadyForQuery = graphRegistryReady && graphResolutionReady && Boolean(
    selectedEndpointId &&
    selectedEndpointStatus?.state === "ok" &&
    selectedEndpointStatus.status === 200 &&
    // addr is authoritative: a restored query must not race ahead of its server.
    (queryGraphServer && fctEndpoints.some((endpoint) =>
      endpoint.id === selectedEndpointId &&
      (queryGraphServer === endpoint.url)
    ))
  );

  // History navigation holds the old pipeline suspended while the RDF History
  // item and potentially a different graph server are being restored.
  const historyRestoreInProgressRef = useRef(false);

  // Query pipeline barrier: cancel prior requests (including scheduler queue),
  // clear their clocks and incomplete statuses before new render effects fetch.
  // A results-page offset changes queryRevision but NOT the semantic query.
  // Never tear down Configure, Categories, or already-loaded batches for paging.
  // Refresh increments the query revision too, even when XML is unchanged.
  useLayoutEffect(() => {
    if (historyRestoreInProgressRef.current) return;
    abortPendingMaestroQueries();
    resumePendingMaestroQueries();
    resetMaestroQueryExecutionClocks();
    resetMaestroIncompleteResults();
    // Clear visible data immediately, not after the next request settles.
    setResults([]);
    setResultsTotalCount(null);
    setResultsPageMatchCount(0);
    setResultsPageComplete(false);
    resultsLoadedQueryIdentityRef.current = "";
    resultsBatchRequestPending.current = false;
    setGroupValues([]);
    setGroupMembers({});
    setGroupValuesError("");
    setPropertyFacetError("");
    setRoleFacetError("");
    setClassFacetError("");
    setIsLoadingProperties(endpointReadyForQuery);
    setIsLoadingRoles(endpointReadyForQuery);
    setIsLoadingClasses(endpointReadyForQuery);
    setIsLoadingCategoryTree(endpointReadyForQuery && categoriesTreeMode);
    // The Alphabet effect, not query-tree initialization, owns its loading
    // state. In particular, a canceled prior request must not leave letters
    // disabled while the next ASK preflight is being scheduled.
    setIsLoadingAlphabet(false);
    setAlphabetPreflight("checking");
    setAlphabetCounts({});
    setAlphabetError("");
    alphabetCountsQueryRef.current = "";
  }, [queryCountXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);


  
  // A URL load or an attempted query against a non-green server triggers
  // exactly one selected-server health check. No startup failover or bulk scans.
  
  
  useEffect(() => {
    if (!urlStateInitialized || !graphRegistryReady || !selectedEndpointId) return;
    const selected = fctEndpoints.find((item) => item.id === selectedEndpointId);
    if (!selected || queryGraphServer !== selected.url) return;
    if (selectedEndpointStatus?.state === "ok" && selectedEndpointStatus.status === 200) return;
    // One automatic health-check sequence per selected server. Query revisions
    // must not restart its progress bar; a manual Refresh can retry explicitly.
    const probeKey = selected.url;
    if (lastPreflightRef.current === probeKey || preflightInFlightRef.current === selected.url) return;
    lastPreflightRef.current = probeKey;
    preflightInFlightRef.current = selected.url;
    // The outer startup sequence owns the progress indicator across all retries.
    // Individual probe attempts must not reset or hide it.
    setEndpointChecksCompleted(0);
    setEndpointChecksTotal(3);
    setIsCheckingEndpoints(true);
    void (async () => {
      try {
        // A cold start can race the proxy registry/session initialization. Only
        // report an unavailable server after a couple of bounded retries; the
        // manual toast Refresh used to work because it happened later.
        let health: EndpointStatus | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, attempt * 900));
          health = await checkSelectedGraphServer(selected, false);
          setEndpointChecksCompleted(attempt + 1);
          if (health.state === "ok" && health.status === 200) break;
        }
        if (health?.state !== "ok" || health.status !== 200) {
          setEndpointHealthToast({ endpointId: selected.id, message: `Graph server ${selected.label} is unavailable.` });
        } else {
          setEndpointHealthToast(null);
        }
      } finally {
        if (preflightInFlightRef.current === selected.url) preflightInFlightRef.current = "";
        setEndpointChecksCompleted(3);
        setIsCheckingEndpoints(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStateInitialized, graphRegistryReady, selectedEndpointId, fctEndpoints, queryGraphServer, queryRefreshRevision, queryRevision]);

  // A cheap ASK first determines whether the current scope has labels.
  // Only a true response reveals the pane and starts counts.
  // Both requests share the same AbortController so navigation cannot publish
  // stale letters or reveal the pane for an earlier query.
  useEffect(() => {
    const controller = new AbortController();
    if (alphabetCountsQueryRef.current !== alphabetQueryXml) {
      alphabetCountsQueryRef.current = alphabetQueryXml;
      setAlphabetCounts({});
    }
    setAlphabetPreflight("checking");
    setIsLoadingAlphabet(false);
    setAlphabetError("");
    if (!selectedEndpointId || !endpointReadyForQuery) {
      setAlphabetPreflight("unavailable");
      return () => controller.abort();
    }
    void (async () => {
      try {
        const askResponse = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("alphabet-ask", "AlphabetSystemFacetAsk") },
          body: alphabetAskQueryXml,
        });
        const askXml = await askResponse.text();
        if (!askResponse.ok) throw new Error(`Alphabet preflight returned HTTP ${askResponse.status}: ${askXml.slice(0, 300)}`);
        const askDoc = new DOMParser().parseFromString(askXml, "application/xml");
        if (askDoc.querySelector("parsererror")) throw new Error("Invalid alphabet ASK response XML.");
        const decision = Array.from(askDoc.getElementsByTagName("*")).find((node) => node.localName === "boolean")?.textContent?.trim();
        if (decision !== "true" && decision !== "false") throw new Error("Alphabet preflight returned no valid boolean.");
        if (controller.signal.aborted) return;
        if (decision === "false") {
          setAlphabetPreflight("unavailable");
          setAlphabetCounts({});
          return;
        }
        setAlphabetPreflight("available");
        setIsLoadingAlphabet(true);
        // The grouped first-letter aggregate is not equivalent to the scalar
        // letter-restricted count on Virtuoso (observed on DBpedia: Z=1 vs 3).
        // Derive each count from the exact TEXT Results selection, including
        // its scope, label predicates, and language restriction.
        const letters = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
        const next: Record<string, number> = {};
        const failures: string[] = [];
        const countLetter = async (letter: string): Promise<void> => {
          const sparql = alphabetCountSparqlForLetter(letter);
          const response = await cachedFetchFct("/proxy/api/sparql", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: { "Content-Type": "application/json", ...proxyDebugHeaders("alphabet-letter-count", `AlphabetCount:${letter}`) },
            body: JSON.stringify({ facetValueCount: { sparql, addr: queryTree.attributes.addr } }),
          });
          if (!response.ok) throw new Error(`Letter ${letter}: HTTP ${response.status}`);
          const payload = await response.json();
          const count = Number(payload.count);
          if (payload.incomplete || !Number.isSafeInteger(count) || count < 0) {
            throw new Error(`Letter ${letter}: incomplete or invalid count`);
          }
          next[letter] = count;
        };
        // Limit concurrent full-text aggregates against public SPARQL endpoints.
        let cursor = 0;
        await Promise.all(Array.from({ length: 3 }, async () => {
          while (!controller.signal.aborted && cursor < letters.length) {
            const letter = letters[cursor++];
            try { await countLetter(letter); }
            catch (error) {
              if (!controller.signal.aborted) failures.push(error instanceof Error ? error.message : String(error));
            }
          }
        }));
        if (!controller.signal.aborted) {
          setMaestroIncompleteResults("alphabet", {
            incomplete: failures.length > 0, requestId: "", message: failures.join("; "),
          });
          setAlphabetCounts(next);
          if (failures.length) setAlphabetError(`${failures.length} alphabet letter counts could not be verified.`);
          if (!Object.values(next).some((count) => count > 0)) setAlphabetPreflight("unavailable");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setAlphabetError(error instanceof Error ? error.message : "Could not load alphabet counts.");
          setAlphabetPreflight("unavailable");
          setAlphabetCounts({});
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingAlphabet(false);
      }
    })();
    return () => {
      controller.abort();
      // Aborted operations intentionally skip their finally setter. Release
      // the previous request's loading state even when no replacement starts
      // (e.g. Home with no Alphabet index, or an endpoint becoming unavailable).
      setIsLoadingAlphabet(false);
    };
  }, [alphabetQueryXml, alphabetAskQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  useEffect(() => {
    // Keep the view's persisted index label predicates consistent with changes
    // to the user's selected root search label properties.
    if (alphabetIndex && (currentView?.attributes.indexLabels ?? "") !== alphabetLabelUris) setNodeAttribute("query-view", "indexLabels", alphabetLabelUris);
    if ((currentView?.attributes.indexLang ?? "en") !== preferredAlphabetLanguage) setNodeAttribute("query-view", "indexLang", preferredAlphabetLanguage);
  }, [alphabetIndex, currentView?.attributes.indexLabels, currentView?.attributes.indexLang, alphabetLabelUris, preferredAlphabetLanguage]);

  // Keep the active request identity current for stale-response protection, but
  // do not clear widgets merely because arbitrary query state changed. The
  // coordinated clear is invoked only by the explicit view-navigation actions.
  useLayoutEffect(() => {
const queryIdentity = `${selectedEndpointId}\u0000${queryCountXml}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}`;
activeQueryIdentityRef.current = queryIdentity;
}, [queryCountXml, selectedEndpointId, endpointReadyForQuery]);

useEffect(() => {
  if (!urlStateInitialized || !endpointReadyForQuery) return;
  const nextIdentity = `${selectedEndpointId}\u0000${queryCountXml}`;
  const previousIdentity = previousResultsQueryIdentityRef.current;

  previousResultsQueryIdentityRef.current = nextIdentity;

  // Keep the initial load; reset only when an existing query changes.
  if (!previousIdentity || previousIdentity === nextIdentity) return;

  setResultsUiPage(0);
  setResults([]);
  resultsLoadedQueryIdentityRef.current = "";
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
  endpointReadyForQuery,
  resultsOffset,
  resultsBatchSize,
  setResultsPage,
]);

  function clearWidgetsForViewChange() {
    setResultsUiPage(0);
    setResults([]);
    resultsLoadedQueryIdentityRef.current = "";
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
    // Keep the last successful Configure lists visible while replacement requests
    // load. A transient health failure must not remove the Configure buttons.
    setClassFacets([]); setClassTreeEdges([]);
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

  /** Root breadcrumb action, shared by its button and the Refresh fallback. */
  function handleRootBreadcrumbClick() {
    clearTutorialPreview();
    setDefaultLeftTab("personal");
    navigateToPropertyPath("query-root");
  }

  /** Use the breadcrumb's single navigation path for relationship crumbs. */
  function handleBreadcrumbClick(targetId: string) {
    clearTutorialPreview();
    setDefaultLeftTab("personal");
    navigateToPropertyPath(targetId);
  }

  /** Home always starts a fresh query pipeline, even if already at Home.
   * Reset the old transport and counters synchronously, before changing the
   * query tree; the revision also invalidates requests when the XML is equal. */
  function resetHomeQuery() {
    abortPendingMaestroQueries();
    resetMaestroQueryExecutionClocks();
    resetMaestroIncompleteResults();
    setIsLoadingAlphabet(false);
    setAlphabetPreflight("checking");
    setAlphabetCounts({});
    setAlphabetError("");
    alphabetCountsQueryRef.current = "";
    clearWidgetsForViewChange();
    resetQueryStore();
    setQueryRefreshRevision((revision) => revision + 1);
  }

  /** New root text search for RDF classes, initiated by the Categories header. */
  function startCategoryNameSearch() {
    // Search for classes by rdfs:label and then show their rdf:type subjects.
    // Preserve the selected graph server, but search across all of its graphs.
    const address = queryTree.attributes.addr ?? "";
    const server = address.includes("@") ? address.slice(address.indexOf("@") + 1) : "";
    const existingView = findQueryNode(queryTree.children, "query-view");
    const nextView: FctQueryNode = existingView
      ? { ...existingView, attributes: { ...existingView.attributes, type: FCT_VIEW_TYPES.TEXT, offset: "0" }, children: [] }
      : { id: "query-view", name: "view", attributes: { type: FCT_VIEW_TYPES.TEXT, limit: "30", offset: "0" }, children: [] };
    resetHomeQuery();
    replaceQueryTree({
      ...queryTree,
      attributes: { ...queryTree.attributes, addr: `$ALL$@${server}` },
      children: [
        { id: "query-text", name: "text", text: "", attributes: { property: RDFS_LABEL_URI, exact: "false", type: "class" }, children: [] },
        { id: "query-category-type-role", name: "property-of", attributes: { iri: RDF_TYPE_URI }, children: [nextView] },
      ],
    });
    setSelectedNamePropertyUris([RDFS_LABEL_URI]);
    setSelectedSearchResourceTypes(["class"]);
    setSelectedSignalMode("name");
    selectedSignalModeRef.current = "name";
    searchDraftRef.current = "";
    setSearchDraft("");
    setSavedSearchDraft("");
    setDefaultLeftTab("personal");
    setCentralTab("results");
    setRootSearchExpanded(true);
    setNamePropertyMenuOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[aria-label="Search results"]')?.focus());
  }

  /** X: stop transport/queue work without refreshing or discarding loaded data. */
  function cancelMaestroPage() {
    stopPendingMaestroQueries();
    setIsLoadingProperties(false);
    setIsLoadingRoles(false);
    setIsLoadingClasses(false);
    setIsLoadingCategoryTree(false);
    setIsLoadingGraphs(false);
    setIsLoadingAlphabet(false);
    setIsSearching(false);
    setIsCountingResults(false);
    setGroupValuesLoading(false);
    setLoadingRecordGraphs(false);
    setLoadingRecordAuthors(false);
    setIsLoadingRecordPolicy(false);
    setIsDescribing(false);
    setViewDiscoveryLoading(false);
    setViewFeatureLoading(false);
    setIsValidatingRecord(false);
    setConfigureQueryTransition(false);
    resultsBatchRequestPending.current = false;
  }

  /** Toolbar Refresh repeats the current query, checking only a non-green server. */
  async function refreshMaestroPage() {
    const selected = fctEndpoints.find((item) => item.id === selectedEndpointId);
    if (!selected) return;
    const status = endpointStatuses[selected.id];
    if (!(status?.state === "ok" && status.status === 200)) {
      const health = await checkSelectedGraphServer(selected);
      if (health.state !== "ok" || health.status !== 200) {
        setEndpointHealthToast({ endpointId: selected.id, message: `Graph server ${selected.label} is unavailable.` });
        return;
      }
      setEndpointHealthToast(null);
    }
    refreshQuery();
    setQueryRefreshRevision((revision) => revision + 1);
    setSearchPipelineRun((revision) => revision + 1);
  }

  function refreshCurrentBreadcrumb() {
    const activeBreadcrumbButton = activeBreadcrumbButtonRef.current;
    if (activeBreadcrumbButton) {
      activeBreadcrumbButton.click();
      return;
    }
    const activeCrumb = displayedBreadcrumbPath[activeBreadcrumbIndex];
    if (activeCrumb) handleBreadcrumbClick(activeCrumb.id);
    else handleRootBreadcrumbClick();
  }

  function moveViewToSibling(currentFocusId: string, targetId: string) {
    if (currentFocusId !== targetId) clearWidgetsForViewChange();
    moveViewToSiblingRaw(currentFocusId, targetId);
  }
  
  
  // A short SPARQL result batch is the signal that this result stream has ended.
  // The separate scalar count is used for the overall pager, not as a substitute
  // for the actual result bindings returned by the current page query.
  
  // The FCT Results request is paged, so a short batch only says that this
  // page is the end of the stream; it must not override a larger scalar count
  // for the whole query (e.g. 930 matches but 14 rows in the current FCT view).
  // Use the completed result stream only as a fallback when scalar counting is
  // unavailable, and never let a stale/partial batch lower a valid total.
  const effectiveResultsTotalCount = resultsTotalCount === null
    ? (resultsPageComplete ? results.length : null)
    : Math.max(resultsTotalCount, results.length);
  const { explicitBlankNodeAnchor, setExplicitBlankNodeAnchor, blankNodeRecords, setBlankNodeRecords, activeBlankNodeTab, setActiveBlankNodeTab, describedRecord, setDescribedRecord, describedRecordUri, setDescribedRecordUri, recordDescriptionSnapshot, setRecordDescriptionSnapshot, recordGraphs, setRecordGraphs, selectedRecordGraph, setSelectedRecordGraph, selectedRecordAuthor, setSelectedRecordAuthor, recordGraphError, setRecordGraphError, loadingRecordGraphs, setLoadingRecordGraphs, loadingRecordAuthors, setLoadingRecordAuthors, recordAuthorError, setRecordAuthorError, recordGraphAuthors, setRecordGraphAuthors, recordGraphOptions, graphsInSelectedFamily, recordAuthors, recordGraphFamily } = useRecordCoreState();
  const { recordPolicies, setRecordPolicies, recordPolicy, setRecordPolicy, selectedRecordTemplateUri, setSelectedRecordTemplateUri, manualRecordFormatSelectionRef } = useRecordFormatSelection();
  // Format choices belong to the selected Category (rdf:type), never to an individual record.
  // Explicitly checked Categories take precedence when a resource has several types.
  const recordFormatCategory = (): string => {
    const path = getPropertyPath();
    const scopeId = path[path.length - 1]?.id ?? null;
    return resolveRecordFormatCategory(getClassesAtNode(scopeId), describedRecord);
  };
  const recordFormatPreferenceKey = (kind: "policy" | "template"): string => {
    const category = recordFormatCategory();
    return category ? `record-${kind}-category:${category}` : "";
  };
  
  
  
  const { recordValidation, setRecordValidation, isValidatingRecord, setIsValidatingRecord } = useRecordValidationState();
  const { formattedRecordHtml, setFormattedRecordHtml, recordLabelRevision, setRecordLabelRevision, formattedRecordButtonsHtml, setFormattedRecordButtonsHtml, recordFormatPreviews, setRecordFormatPreviews, recordFormatMenuOpen, setRecordFormatMenuOpen, recordControlsOpen, setRecordControlsOpen, recordFormatError, setRecordFormatError, bookmarkQueryDebugOpen, setBookmarkQueryDebugOpen, bookmarkQueryDebug, setBookmarkQueryDebug, recordServices, setRecordServices, recordServiceTab, setRecordServiceTab, recordServiceResults, setRecordServiceResults, recordServiceArguments, setRecordServiceArguments, recordServiceDom, setRecordServiceDom, recordDebug, setRecordDebug, recordUriLabelCacheRef, activeServiceRecordRef, formattedRecordContainerRef } = useRecordPresentationState(preferredAlphabetLanguage);
  /** Download the RDF triples in the exact DESCRIBE snapshot shown in Record. */
  const downloadRecordDescribe = () => downloadRecordDescribeSnapshot(
    recordDescriptionSnapshot,
    currentRecordDescriptionKey,
    selectedUri,
  );
  const { recordDescriptionPage, setRecordDescriptionPage, recordDescriptionPageSize, setRecordDescriptionPageSize, recordDescriptionQueryLimit, setRecordDescriptionQueryLimit, pendingRecordDescriptionLimit, setPendingRecordDescriptionLimit, pendingCenterBatchLimit, setPendingCenterBatchLimit, pendingLeftPanelLimit, setPendingLeftPanelLimit, pendingGroupsBatchLimit, setPendingGroupsBatchLimit } = useRecordPageSettings();
  const previousSettingsRevisionRef = useRef<string | null>(null);
  useEffect(() => {
    const semanticRevision = `${queryCountXml}\u0000${queryRefreshRevision}`;
    if (previousSettingsRevisionRef.current === null) {
      previousSettingsRevisionRef.current = semanticRevision;
      return;
    }
    if (previousSettingsRevisionRef.current === semanticRevision) return;
    previousSettingsRevisionRef.current = semanticRevision;
    if (pendingRecordDescriptionLimit !== null) {
      setRecordDescriptionQueryLimit(pendingRecordDescriptionLimit);
      setPendingRecordDescriptionLimit(null);
    }
    if (pendingCenterBatchLimit !== null) {
      setPendingCenterBatchLimit(null);
      // Apply the preference to the live view when another query change occurs.
      setResultsPage(pendingCenterBatchLimit, 0);
    }
    if (pendingLeftPanelLimit !== null) {
      setLeftPanelLimitState(pendingLeftPanelLimit);
      setGraphsPage(0);
      setPendingLeftPanelLimit(null);
    }
    if (pendingGroupsBatchLimit !== null) {
      setGroupBatchSize(pendingGroupsBatchLimit);
      setGroupBatchOffset(0);
      setGroupUiPage(0);
      setPendingGroupsBatchLimit(null);
    }
  }, [queryCountXml, queryRefreshRevision, pendingRecordDescriptionLimit, pendingCenterBatchLimit, pendingLeftPanelLimit, pendingGroupsBatchLimit, setResultsPage]);
  
  const RECORD_DESCRIPTION_PAGE_SIZE = recordDescriptionPageSize;
  
  // Record SELECT already applies the preferred-language filter. The exact same
  // rows are used by the table, XSLT formatter, and SHACL validation.
  const displayedRecord = describedRecord;

  // Group visible DESCRIBE triples by predicate and direction: outgoing
  // properties and incoming roles share the same paging sequence.
const describedProperties = Array.from(
  displayedRecord.reduce((grouped, item) => {
    const key = `${item.direction}\u0000${item.property}`;
    const values = grouped.get(key) ?? { property: item.property, direction: item.direction, values: [] as RecordValueTerm[] };
    values.values.push(item);
    grouped.set(key, values);
    return grouped;
  }, new Map<string, { property: string; direction: "property" | "property-of"; values: RecordValueTerm[] }>()),
  ([, item]) => item,
);
// A language change can shrink the visible property count. Clamp the
// displayed page without modifying the complete DESCRIBE snapshot.
const displayedRecordPageCount = Math.max(1, Math.ceil(describedProperties.length / RECORD_DESCRIPTION_PAGE_SIZE));
const displayedRecordPage = Math.min(recordDescriptionPage, displayedRecordPageCount - 1);
const describedPropertyPage = describedProperties.slice(
  displayedRecordPage * RECORD_DESCRIPTION_PAGE_SIZE,
  (displayedRecordPage + 1) * RECORD_DESCRIPTION_PAGE_SIZE,
);
const describedPropertyRows = describedPropertyPage.filter((item) => item.direction === "property");
const describedRoleRows = describedPropertyPage.filter((item) => item.direction === "property-of");
const describedPropertyCount = describedProperties.filter((item) => item.direction === "property").length;
const describedRoleCount = describedProperties.filter((item) => item.direction === "property-of").length;
  
  
  
  
  
  
  
  
  
  
  const [queryConcurrency, setQueryConcurrency] = useState<MaestroConcurrency>(() => readMaestroConcurrency());
  const [queryConcurrencyHydrated, setQueryConcurrencyHydrated] = useState(false);
  const [widgetTimeouts, setWidgetTimeouts] = useState<Record<MaestroTimeoutCategory, number>>(() => readMaestroWidgetTimeouts());
  
  
  // Group By member rows are not part of the ordinary Results page. Preserve
  // their RDF term type and badge-derived parent when opening their Record.
  const currentRecordIdentity = results.find((item) => item.uri === selectedUri)
    ?? Object.values(groupMembers).flatMap((group) => group.results).find((item) => item.uri === selectedUri)
    ?? groupValues.find((item) => item.uri === selectedUri);
  const blankNodeTerm = currentRecordIdentity?.termType === "bnode" ||
    /^(?:nodeID:\/\/|_:)/i.test(selectedUri) || explicitBlankNodeAnchor?.label === selectedUri;
  const blankNodeFocus = getPropertyPath().at(-1);
  // Record identity is supplied by the Results SELECT, never inferred from
  // optional card badges. Explicit navigation from a URI Record stays valid.
  const blankNodeAnchor = explicitBlankNodeAnchor?.label === selectedUri
    ? { parent: explicitBlankNodeAnchor.parent, predicate: explicitBlankNodeAnchor.predicate }
    : blankNodeTerm && currentRecordIdentity?.recordAnchor
      ? currentRecordIdentity.recordAnchor
      : null;
  const currentRecordDescriptionKey = [selectedUri, blankNodeTerm ? "bnode" : currentRecordIdentity?.termType ?? "uri", blankNodeAnchor?.parent ?? "", blankNodeAnchor?.predicate ?? "", currentRecordIdentity?.datatype ?? "", currentRecordIdentity?.lang ?? "", selectedEndpointId, queryTree.attributes.addr ?? "",
    queryTree.attributes.graph ?? "", queryTree.attributes.inference ?? "", queryTree.attributes["same-as"] ?? "",
    selectedRecordGraph, selectedRecordAuthor, recordDescriptionQueryLimit, preferredAlphabetLanguage].join("\u0000");


  const resultsCountSparql = buildFctCountSparql(queryTree);
  const rootUriWithoutPath = queryTree.children.some((node) => node.name === "value" && node.attributes.datatype === "uri") &&
    !queryTree.children.some((node) => node.name === "property" || node.name === "property-of");
  const resultsRequestXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
    type: rootUriWithoutPath ? FCT_VIEW_TYPES.LIST : FCT_VIEW_TYPES.TEXT,
    limit: String(resultsBatchSize),
    offset: String(resultsOffset),
    // Capture the URI parent from the SAME result set as the blank-node term.
    // Optional list-values badges can still be loaded/hidden separately.
    badges: getActiveViewRoleFilters(queryTree).length > 0 ? "yes" : "no",
    order: orderResults ? "yes" : "no",
  }));
  const resultsCountRequestIdentity = `${selectedEndpointId}\u0000${resultsCountSparql ?? ""}`;
  const completeFirstResultsPage = resultsPageComplete && resultsOffset === 0 &&
    resultsLoadedQueryIdentityRef.current === activeQueryIdentityRef.current;
  const latestResultsCountRequestIdentityRef = useRef(resultsCountRequestIdentity);
  // Update during render, not in an effect, so a response from an older query
  // cannot win the small interval between a new render and effect cleanup.
  latestResultsCountRequestIdentityRef.current = resultsCountRequestIdentity;

  useEffect(() => {
    const endpointReady = endpointReadyForQuery;
    // Share URL restoration must precede even the count query. Otherwise
    // the initial default FCT tree triggers a needless request on startup.
    if (!urlStateInitialized || !endpointReady) {
      setResultsTotalCount(null);
      setIsCountingResults(false);
      return;
    }

    // Bookmark status does not select an execution or counting pipeline.
    // A complete first page proves the total without another full graph scan.
    if (completeFirstResultsPage) {
      setResultsTotalCount(results.length);
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
        const hasStatuses = queryTreeHasStatuses(queryTree);
        const response = hasStatuses
          ? await cachedFetchFct("/proxy/api/fct", {
              method: "POST", cache: "no-store", signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ queryXml, countOnly: true }),
            })
          : await cachedFetchFct("/proxy/api/sparql", {
              method: "POST", cache: "no-store",
              headers: { "Content-Type": "application/json", ...proxyDebugHeaders("results-total-count", "ResultsTotalCount") },
              body: JSON.stringify({ facetValueCount: { sparql: resultsCountSparql, addr: queryTree.attributes.addr } }),
              signal: controller.signal,
            });
        let total: number;
        if (hasStatuses) {
          const xml = await response.text();
          if (!response.ok) throw new Error(xml.slice(0, 500) || "State-constrained FCT count failed.");
          const doc = new DOMParser().parseFromString(xml, "application/xml");
          const value = doc.getElementsByTagNameNS("http://openlinksw.com/services/facets/1.0/", "column")[0]?.textContent ?? "";
          total = Number(value);
        } else {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Virtuoso SPARQL count query failed.");
          total = Number(data.count);
        }
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
  }, [urlStateInitialized, resultsCountSparql, resultsCountRequestIdentity, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision, completeFirstResultsPage, queryXml]);

  // Hydrate from the existing Maestro IndexedDB store (not the live query XML).
  useEffect(() => {
    let disposed = false;
    void initializeMaestroStorage().then(() => {
      if (!disposed) setWidgetTimeouts(readMaestroWidgetTimeouts());
    });
    return () => { disposed = true; };
  }, []);

  // Hydrate first, then publish the browser's limits. Login/restore changes
  // trigger a fresh sync; changes in Sheet update the proxy immediately.
  useEffect(() => {
    let disposed = false;
    void initializeMaestroStorage().then(() => {
      if (!disposed) { setQueryConcurrency(readMaestroConcurrency()); setQueryConcurrencyHydrated(true); }
    });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!queryConcurrencyHydrated) return;
    void syncMaestroConcurrency(queryConcurrency).catch(error => console.warn("[Maestro] Query quota sync failed", error));
  }, [authSession, queryConcurrency, queryConcurrencyHydrated]);
  function changeQueryConcurrency(next: MaestroConcurrency) {
    const updated = { ...next, heavyPerServer: Math.min(next.heavyPerServer, next.lightPerServer) };
    setQueryConcurrency(updated);
    writeMaestroConcurrency(updated);
  }

  function changeWidgetTimeout(category: MaestroTimeoutCategory, seconds: number) {
    const next = { ...widgetTimeouts, [category]: seconds };
    setWidgetTimeouts(next);
    writeMaestroWidgetTimeouts(next);
  }

  
  

  // The authoritative <query> revision, not the asynchronous facet effects,
  // starts both Configure spinners. Keep a short visible interval even when
  // cached FCT responses complete before the next browser paint.
  
  const previousConfigureQueryRevisionRef = useRef(`${queryCountXml}\u0000${queryRefreshRevision}`);
  const previouslyVisibleConfigureButtonsRef = useRef({ properties: false, roles: false });
  useLayoutEffect(() => {
    const semanticRevision = `${queryCountXml}\u0000${queryRefreshRevision}`;
    if (previousConfigureQueryRevisionRef.current === semanticRevision) return;
    previousConfigureQueryRevisionRef.current = semanticRevision;
    setConfigureQueryTransition(true);
    const timer = window.setTimeout(() => setConfigureQueryTransition(false), 450);
    return () => window.clearTimeout(timer);
  }, [queryCountXml, queryRefreshRevision]);

  // Facet arrays can be cleared synchronously with a query change. Retain only
  // the buttons that were visible before that change until the spinner settles.
  if (propertyFacets.length > 0) previouslyVisibleConfigureButtonsRef.current.properties = true;
  if (roleFacets.length > 0) previouslyVisibleConfigureButtonsRef.current.roles = true;
  useEffect(() => {
    if (!configureQueryTransition && !isLoadingProperties) {
      previouslyVisibleConfigureButtonsRef.current.properties = propertyFacets.length > 0;
    }
    if (!configureQueryTransition && !isLoadingRoles) {
      previouslyVisibleConfigureButtonsRef.current.roles = roleFacets.length > 0;
    }
  }, [configureQueryTransition, isLoadingProperties, isLoadingRoles, propertyFacets.length, roleFacets.length]);
  const showConfigureProperties = propertyFacets.length > 0 ||
    (configureQueryTransition && previouslyVisibleConfigureButtonsRef.current.properties);
  const showConfigureRoles = roleFacets.length > 0 ||
    (configureQueryTransition && previouslyVisibleConfigureButtonsRef.current.roles);
  const showPropertiesSpinner = configureQueryTransition || isLoadingProperties;
  const showRolesSpinner = configureQueryTransition || isLoadingRoles;

  // Start the Configure count spinners as soon as the authoritative facet
  // requests change, before the next paint. Waiting for the asynchronous
  // request effects can briefly show counts from the previous query.
  
  useLayoutEffect(() => {
    const identity = `${selectedEndpointId}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}\u0000${propertyFacetQueryXml}\u0000${roleFacetQueryXml}`;
    if (pendingConfigureFacetIdentityRef.current === identity) return;
    pendingConfigureFacetIdentityRef.current = identity;
    if (endpointReadyForQuery) {
      setIsLoadingProperties(true);
      setIsLoadingRoles(true);
    }
  }, [selectedEndpointId, endpointReadyForQuery, propertyFacetQueryXml, roleFacetQueryXml]);

  // Mirror the Group By scroll behavior for Color By, including a selection
  // restored from a share URL after the Map perspective mounts.
  const [colorByScrollTarget, setColorByScrollTarget] = useState<{ direction: string; iri: string } | null>(null);
  useEffect(() => {
    const handleSelection = (event: Event) => {
      const { direction, iri } = (event as CustomEvent<{ direction: string; iri: string }>).detail ?? {};
      if (typeof iri === "string" && iri && ["forward", "reverse", "class"].includes(direction)) {
        setDefaultLeftTab("personal");
        setColorByScrollTarget({ direction, iri });
      }
    };
    window.addEventListener("maestro:colorby-selection", handleSelection);
    return () => window.removeEventListener("maestro:colorby-selection", handleSelection);
  }, [setDefaultLeftTab]);
  useEffect(() => {
    if (!colorByScrollTarget || defaultLeftTab !== "personal") return;
    const { direction, iri } = colorByScrollTarget;
    const loading = direction === "class" ? isLoadingClasses
      : direction === "reverse" ? isLoadingRoles : isLoadingProperties;
    if (loading) return;
    const target = direction === "class" ? categoriesWidgetRef.current
      : direction === "reverse" ? roleWidgetCardRefs.current.get(iri)
      : personalWidgetCardRefs.current.get(iri);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setColorByScrollTarget(null);
  }, [colorByScrollTarget, defaultLeftTab, isLoadingClasses, isLoadingRoles,
      isLoadingProperties, personalWidgets.map(widget => widget.uri).join("|"),
      roleFacets.map(facet => facet.uri).join("|")]);

  // Scroll to the active Group by facet when that widget's own request settles.
  // Other facet widgets load independently and must not delay this scroll.
  useEffect(() => {
    const facetLoadKey = `${queryXml}\u0000${selectedEndpointId}\u0000${search}`;
    const targetLoading = isGroupByCategory
      ? isLoadingClasses
      : groupedRoleUri
        ? isLoadingRoles
        : isLoadingProperties;

    if (facetListsLoadKeyRef.current !== facetLoadKey) {
      facetListsLoadKeyRef.current = facetLoadKey;
      // A view change may already have set this widget's loading state before
      // this effect sees the new key. Remember that in-flight request so its
      // completion still triggers the scroll.
      facetListsLoadingObservedRef.current = targetLoading;
      return;
    }

    // Scroll as soon as the active Group by widget settles; unrelated facet
    // widgets must not delay it.
    if (targetLoading) {
      facetListsLoadingObservedRef.current = true;
      return;
    }
    if (!facetListsLoadingObservedRef.current || !groupedFacetActive || defaultLeftTab !== "personal") return;

    const target = isGroupByCategory
      ? categoriesWidgetRef.current
      : groupedRoleUri
        ? roleWidgetCardRefs.current.get(groupedRoleUri)
        : personalWidgetCardRefs.current.get(groupedPersonalFacetUri!);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [
    groupedFacetActive,
    isGroupByCategory,
    groupedPersonalFacetUri,
    groupedRoleUri,
    defaultLeftTab,
    queryXml,
    selectedEndpointId,
    search,
    personalWidgets.map((widget) => widget.uri).join("|"),
    roleFacets.map((facet) => facet.uri).join("|"),
    isLoadingClasses,
    isLoadingProperties,
    isLoadingRoles,
    isLoadingGraphs,
  ]);

  
  




  
  
  

  useEffect(() => {
    // URL restoration must finish before the initial browse decision is made.
    // In particular, never clear search text here: it may have been restored
    // from the shared URL or typed while the endpoint health check was running.
    if (!urlStateInitialized || !endpointReadyForQuery || initialBrowseTriggered) return;

    setInitialBrowseTriggered(true);

    // Results already subscribes to endpoint readiness and the restored query.
    // Do not advance searchPipelineRun here: it schedules a *second* identical
    // first-load request whenever the initial search text is empty.
  }, [urlStateInitialized, selectedEndpointId, endpointReadyForQuery, initialBrowseTriggered, search]);

  useEffect(() => {
    const query = search.trim();
    let cancelled = false;
    // One controller owns both stages of this Results run. When the query,
    // endpoint, or page changes, cleanup aborts any in-flight client requests.
    const controller = new AbortController();
    const requestQueryIdentity = `${selectedEndpointId}\u0000${queryCountXml}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}`;

    // Do not fetch the default tree while a shared query is restoring, or
    // before the selected endpoint has passed the health check. Empty search
    // remains a valid query once both prerequisites are ready.
    const endpointReady = endpointReadyForQuery;
    if (!urlStateInitialized || !endpointReady) return;
    setSearchError("");

    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return;
      setIsSearching(true);
      setSearchError("");

      try {
        console.info("Maestro Results FCT request starting", {
          queryFingerprint: proxyDebugFingerprint(resultsRequestXml),
          queryLength: resultsRequestXml.length,
        });
        const response = await (queryTreeHasStatuses(queryTree)
          ? cachedFetchFct("/proxy/api/fct", {
              method: "POST", cache: "no-store", signal: controller.signal,
              headers: { "Content-Type": "text/xml; charset=utf-8" }, body: resultsRequestXml,
            })
          : cachedFetchFct("/proxy/api/fct", {
              method: "POST", cache: "no-store",
              headers: { "Content-Type": "text/xml; charset=utf-8",
                ...proxyDebugHeaders("results-search", `ResultsSearch:${proxyDebugFingerprint(resultsRequestXml)}`) },
              body: resultsRequestXml, signal: controller.signal,
            }));
        // Preserve the actual FCT transport response for diagnosing discrepancies
        // between standalone SPARQL execution and Maestro's displayed records.
        const rawResponse = await response.clone().text();
        if (!cancelled) setResultsRawResponse(rawResponse.slice(0, 200_000));
        if (!response.ok) throw new Error(rawResponse.slice(0, 500) || `Results request failed (${response.status}).`);
        const data = await readFctResponse(response);
        if (cancelled) return;
        rememberShortforms(data?.shortforms);
        const focusPredicate = getPropertyPath().at(-1)?.uri;
        const rawResults: FctResult[] = (Array.isArray(data.results) ? data.results : []).map((item: FctResult) => {
          if (item.termType !== "bnode" || !focusPredicate) return item;
          const structuralRole = item.scopeValues?.find((value) => value.direction === "reverse" && value.property === focusPredicate);
          const parent = structuralRole?.values.find((value) => value.type === "uri")?.value;
          return parent ? { ...item, recordAnchor: { parent, predicate: focusPredicate } } : item;
        });
        const uniqueResults = new Map<string, FctResult>();
        for (const item of rawResults) {
          const previous = uniqueResults.get(item.uri);
          uniqueResults.set(item.uri, previous
            ? { ...previous, ...item, recordAnchor: previous.recordAnchor ?? item.recordAnchor, matches: [...previous.matches, ...item.matches] }
            : { ...item, matches: [...item.matches] });
        }
        // Preserve the parent binding from the primary FCT response. Badge
        // enrichment runs independently and only fills display values.
        const nextResults = Array.from(uniqueResults.values());

        // Enrichment may take much longer than the FCT response. Never allow
        // a completed request for an older breadcrumb/endpoint to repopulate
        // the widgets after the coordinated transition has cleared them.
        if (cancelled || requestQueryIdentity !== activeQueryIdentityRef.current) return;

        resultsLoadedQueryIdentityRef.current = requestQueryIdentity;
        setSparqlQuery(data.sparql || "");
        setResultsPageMatchCount(nextResults.length);
        setResultsPageComplete(!data.incomplete && rawResults.length < resultsBatchSize);
        setMaestroIncompleteResults("results", { incomplete: data.incomplete, requestId: "", message: data.warning || "" });
        setResults((current) => {
          if (resultsOffset === 0) return nextResults;
          const merged = new Map(current.map((item) => [item.uri, item]));
          for (const item of nextResults) {
            const prior = merged.get(item.uri);
            merged.set(item.uri, prior ? { ...prior, ...item, scopeValues: prior.scopeValues?.length ? prior.scopeValues : item.scopeValues,
              recordAnchor: item.recordAnchor ?? prior.recordAnchor, matches: [...prior.matches, ...item.matches] } : item);
          }
          return Array.from(merged.values());
        });

        setSelectedUri((current) => current || nextResults[0]?.uri || "");
      } catch (error) {
        // A user pressing X must preserve already-loaded results.
        if (cancelled || controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;

        setResults([]);
        resultsLoadedQueryIdentityRef.current = "";
        setResultsPageMatchCount(0);
        setSelectedUri("");
        setSearchError(
          presentServerError(error instanceof Error ? error.message : "Search failed."),
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
  }, [urlStateInitialized, search, resultsRequestXml, resultsBatchSize, queryCountXml, resultsOffset, selectedEndpointId, endpointReadyForQuery, searchPipelineRun, queryTree]);

  // Result badges are optional SPARQL enrichment. Keep this separate from the
  // FCT search pipeline so toggling badges never reloads/flickers the result set.
  // Enrichment values are server data, not transient loading UI. Retain them when
  // the same records reappear on another page or an unrelated facet rerenders.
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

  // Badge visibility is presentation state, never an edit to the live FCT query.
  // The separate list-values request receives its columns explicitly.
  // This is the same FCT XML supplied to Results list-values enrichment.
  // Its response carries both executed SPARQL statements (page + projections).
  const resultsListValuesXml = (() => {
    if (!showResultBadges) return "";
    try {
      return listValuesQueryClone(serializeFctQuery(queryTree));
    } catch { return ""; }
  })();
  // The inspector must show list-values SPARQL, never the unrelated Results
  // SELECT. Render its real projection with the currently selected page terms
  // even before the asynchronous enrichment reply brings execution metadata.
  const projectedPageTerms = results.filter(item => item.uri && item.termType !== "bnode").map(item => ({
    type: (item.termType === "literal" ? "literal" : "uri") as "uri" | "literal",
    value: item.uri, ...(item.datatype ? { datatype: item.datatype } : {}), ...(item.lang ? { lang: item.lang } : {}),
  }));
  const projectionColumns = [
    { property: RDF_TYPE_URI, direction: "forward" as const },
    ...(resultBadgePropertiesKey ? resultBadgePropertiesKey.split("\u0000").filter(uri => uri !== RDF_TYPE_URI).map(property => ({ property, direction: "forward" as const })) : []),
    ...(resultBadgeRolesKey ? resultBadgeRolesKey.split("\u0000").map(property => ({ property, direction: "reverse" as const })) : []),
  ];
  const projectionGraph = (queryTree.attributes.addr ?? "").split("@")[0];
  const resultsListValuesSparql = resultsListValuesXml && resultListValuesDebug?.xml === resultsListValuesXml
    ? resultListValuesDebug.sparql
    : resultsListValuesXml
      ? listValuesProjectionSparql(projectedPageTerms.slice(0, LIST_VALUES_MAX_RESOURCES), projectionColumns,
          projectionGraph === "$ALL$" ? "" : projectionGraph)
      : "";

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Transport batching is internal: a new page only enriches resources
    // missing from the scoped cache. Earlier pages are never re-requested.
    const selectedForward = [...new Set([
      RDF_TYPE_URI,
      ...(resultBadgePropertiesKey ? resultBadgePropertiesKey.split("\u0000") : []),
    ])];
    const selectedReverse = resultBadgeRolesKey ? resultBadgeRolesKey.split("\u0000") : [];
    if (!showResultBadges || !endpointReadyForQuery || !results.length || !resultsListValuesXml) {
      // Enrichment is presentation data. Transient endpoint readiness and badge
      // visibility must not erase FCT-projected Record identity or cached badges.
      return () => controller.abort();
    }

    const relationships: ScopeValue[] = [
      ...selectedForward.map((property) => ({
        property, label: toLabel(property), direction: "forward" as const, values: [{ value: "-" }],
      })),
      ...selectedReverse.map((property) => ({
        property, label: toLabel(property), direction: "reverse" as const, values: [{ value: "-" }],
      })),
    ];
    const enrichmentScope = `list-values-projected-v2\u0000${selectedEndpointId}\u0000${serializeFctQuery(setQueryViewAttributes(queryTree, { offset: "0", limit: "0" }))}\u0000${resultBadgePropertiesKey}\u0000${resultBadgeRolesKey}\u0000`;
    const cache = resultsEnrichmentCacheRef.current;
    // The projection endpoint accepts URI and literal terms, not blank-node
    // display labels. Blank-node Record identity comes from the primary SELECT.
    const resources = [...new Map(results.filter((item) => item.uri && item.termType !== "bnode")
      .map((item) => [item.uri, { type: item.termType === "literal" ? "literal" : "uri", value: item.uri,
        ...(item.datatype ? { datatype: item.datatype } : {}), ...(item.lang ? { lang: item.lang } : {}) }])).values()];
    const missing = resources.filter((term) => !cache.has(enrichmentScope + term.value));
    // Do not place '-' placeholder rows in authoritative Result state.
    // A previously loaded card must remain stable while enrichment is pending.
    setResults((current) => current.map((item) => {
      const saved = cache.get(enrichmentScope + item.uri);
      return saved && item.scopeValues !== saved ? { ...item, scopeValues: saved } : item;
    }));
    if (!missing.length) return () => { cancelled = true; controller.abort(); };

    void (async () => {
      try {
        // Keep this limit aligned with the proxy's request contract. It is
        // transport backpressure, not the FCT view limit or a Sheet setting.
        const maxResourcesPerRequest = LIST_VALUES_MAX_RESOURCES;
        for (let start = 0; start < missing.length; start += maxResourcesPerRequest) {
          if (cancelled || controller.signal.aborted) return;
          const batch = missing.slice(start, start + maxResourcesPerRequest);
          const queryXml = resultsListValuesXml;
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              ...proxyDebugHeaders("results-enrichment", `ResultsListValues:${proxyDebugFingerprint(`${resultBadgeUrisKey}:${resultBadgePropertiesKey}:${resultBadgeRolesKey}`)}:${start / maxResourcesPerRequest + 1}`),
            },
            body: JSON.stringify({ queryXml, resources: batch, projections: projectionColumns }),
            signal: controller.signal,
          });
          const xml = await response.text();
          if (!response.ok) throw new Error(`list-values batch ${start / maxResourcesPerRequest + 1} returned HTTP ${response.status}: ${xml.slice(0, 300)}`);
          const responseDocument = new DOMParser().parseFromString(xml, "application/xml");
          const executedSparql = Array.from(responseDocument.getElementsByTagName("*"))
            .find((node) => node.localName === "sparql")?.textContent || "";
          if (!cancelled) setResultListValuesDebug({ xml: queryXml,
            sparql: executedSparql || "# The list-values response did not include an executed SPARQL projection." });
          const parsed = parseListValuesXml(xml);
          if (cancelled) return;
          for (const term of batch) {
            const projected = parsed.get(term.value) ?? [];
            const values = relationships.map((relationship) =>
              projected.find((value) => value.direction === relationship.direction && value.property === relationship.property)
              ?? { ...relationship, values: [{ value: "-" }] });
            cache.set(enrichmentScope + term.value, values);
          }
          if (cache.size > 2500) {
            for (const key of Array.from(cache.keys()).slice(0, cache.size - 2000)) cache.delete(key);
          }
          setResults((current) => current.map((item) => {
            const saved = cache.get(enrichmentScope + item.uri);
            return saved && item.scopeValues !== saved ? { ...item, scopeValues: saved } : item;
          }));
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setResultListValuesDebug({ xml: resultsListValuesXml,
          sparql: `${listValuesProjectionSparql(missing.slice(0, LIST_VALUES_MAX_RESOURCES).map(term => ({ ...term, type: term.type as "uri" | "literal" })), projectionColumns,
            projectionGraph === "$ALL$" ? "" : projectionGraph)}\n# Projection failed: ${error instanceof Error ? error.message : String(error)}` });
        console.warn("Results badge enrichment failed:", error);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [showResultBadges, resultBadgeUrisKey, resultBadgePropertiesKey, resultBadgeRolesKey, selectedEndpointId, endpointReadyForQuery, resultsListValuesXml]);

  // Some Virtuoso endpoints return a successful grouped A-Z response while
  // omitting an initial visibly represented in the Results list. Verify such
  const lastGroupResetIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    // Don't erase share-URL group position during the first successful restore.
    // Only changes after the initial ready identity reset grouping/pagination.
    if (!urlStateInitialized || !endpointReadyForQuery) return;
    const identity = `${queryCountXml}\0${selectedGroupByOption?.key ?? ""}\0${queryRefreshRevision}`;
    if (lastGroupResetIdentityRef.current === null) {
      lastGroupResetIdentityRef.current = identity;
      return;
    }
    if (lastGroupResetIdentityRef.current === identity) return;
    lastGroupResetIdentityRef.current = identity;
    setGroupUiPage(0);
    setGroupBatchOffset(0);
    setGroupHasMoreBatches(false);
    setGroupValues([]);
    setGroupMembers({});
    groupMemberRequestStates.current.clear();
    setGroupValuesError("");
  }, [urlStateInitialized, endpointReadyForQuery, queryCountXml, selectedGroupByOption?.key, queryRefreshRevision]);

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
        // Same query the Personal facet runs for this property/role/category (count-sorted),
        // so each group heading count equals the count shown in that facet.
        const groupTree = createGroupValuesQuery(queryTree, selectedGroupByOption, {
          limit: groupBatchSize, offset: groupBatchOffset,
        });
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("group-values-fct", "GroupsValues") },
          body: serializeFctQuery(groupTree),
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!cancelled) setMaestroIncompleteResults("groups", { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        if (!cancelled) {
          // Column 1 is the value, column 2 the facet's own distinct count (ct / n).
          const responseValues: FctResult[] = (Array.isArray(data.results) ? data.results : []).filter((item) => Boolean(item.uri) && (item.columns?.length ?? 0) >= 2);
          // Virtuoso's classes facet can omit grouped rows although the same
          // Categories widget already has valid class/count pairs. Reuse the
          // existing facet projection only for Category grouping and only when
          // the group response is empty; do not fabricate zero-count groups.
          // Only established class and current result counts can fill an
          // unexpectedly empty grouped Categories response.
          const knownGroupClasses = new Map(classFacets
            .filter((item) => item.uri && Number.isFinite(item.count) && item.count >= 0)
            .map((item) => [item.uri, { uri: item.uri, label: item.label, count: item.count }]));
          if (effectiveResultsTotalCount !== null) {
            for (const iri of getClassesAtNode(getPropertyPath().at(-1)?.id ?? null)) {
              knownGroupClasses.set(iri, { uri: iri, label: knownGroupClasses.get(iri)?.label ?? toLabel(iri, "Class"), count: effectiveResultsTotalCount });
            }
          }
          const nextGroupValues: FctResult[] = responseValues.length || !isGroupByCategory
            ? responseValues
            : [...knownGroupClasses.values()]
                .slice(groupBatchOffset, groupBatchOffset + groupBatchSize)
                .map((item): FctResult => ({
                  uri: item.uri, title: item.label || toLabel(item.uri, "Class"), termType: "uri", matches: [],
                  columns: [
                    { value: item.uri, termType: "uri", attributes: { datatype: "uri" }, raw: {} },
                    { value: String(item.count), datatype: "http://www.w3.org/2001/XMLSchema#integer", attributes: { var: "ct" }, raw: {} },
                  ],
                }));
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
        setGroupValuesError(presentServerError(error instanceof Error ? error.message : "Failed to load group values."));
      } finally {
        if (!cancelled) setGroupValuesLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [centralTab, search, queryCountXml, groupByPropertyUri, selectedGroupByOption?.key, groupBatchSize, groupBatchOffset, queryRefreshRevision, classFacets, effectiveResultsTotalCount, getPropertyPath]);

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
            type: FCT_VIEW_TYPES.TEXT, limit: String(resultsBatchSize), offset: "0",
            // Group By member Records need their URI parent binding in the
            // same SELECT as the blank node, independently of card badges.
            badges: getActiveViewRoleFilters(memberTree).length ? "yes" : "no",
          }));
          const request = (body: string, label: string) => cachedFetchFct("/proxy/api/fct", {
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
            const focusPredicate = getPropertyPath().at(-1)?.uri;
            const rawResults: FctResult[] = (Array.isArray(data.results) ? data.results : []).map((item: FctResult) => {
              if (item.termType !== "bnode" || !focusPredicate) return item;
              const role = item.scopeValues?.find((scope) => scope.direction === "reverse" && scope.property === focusPredicate);
              const parent = role?.values.find((value) => value.type === "uri")?.value;
              return parent ? { ...item, recordAnchor: { parent, predicate: focusPredicate } } : item;
            });
            const uniqueResults = new Map<string, FctResult>();
            for (const item of rawResults) {
              const previous = uniqueResults.get(item.uri);
              uniqueResults.set(item.uri, previous ? { ...previous, ...item, recordAnchor: previous.recordAnchor ?? item.recordAnchor, matches: [...previous.matches, ...item.matches] } : { ...item, matches: [...item.matches] });
            }
            groupMemberRequestStates.current.set(key, "loaded");
            setGroupMembers((current) => ({ ...current, [key]: { results: Array.from(uniqueResults.values()), count: uniqueResults.size, loading: false, error: "" } }));
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
  }, [centralTab, search, queryXml, selectedGroupByOption?.key, pageGroupValues.map(groupValueKey).join("|"), resultsBatchSize, queryRefreshRevision]);

  // Scope-wide side effects are separate from facet fetching. A facet request
  // must never cancel, wait for, or determine another facet's request lifecycle.
  useEffect(() => {
    const query = search.trim();
    if (!query && !endpointReadyForQuery) {
      // Do not discard previously loaded Configure lists during a transient
      // not-ready state; the next successful facet response replaces them.
      setClassFacets([]); setClassTreeEdges([]);
      setGraphFacets([]);
      setPropertyFacetSparql("");
      setRoleFacetSparql("");
      replaceFacetAutofillCandidates("property", []);
      replaceFacetAutofillCandidates("property-in", []);
      setFacetAutofillCandidates({ property: [], "property-in": [] });
      setFocusWidgetsSuppressed(false);
      return;
    }

    setFocusWidgetsSuppressed(false);
    // Graph pagination and Autofill are query-scope state, not facet request state.
    setGraphsPage(0);
    setGraphFacets([]);
    replaceFacetAutofillCandidates("property", []);
    replaceFacetAutofillCandidates("property-in", []);
    setFacetAutofillCandidates({ property: [], "property-in": [] });
  }, [search, queryCountXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Categories owns its own request, debounce, cancellation, data, error and
  // loading state. It does not wait for Properties or Roles.
  useEffect(() => {
    if (!search.trim() && !endpointReadyForQuery) {
      setClassFacets([]); setClassTreeEdges([]);
      setClassFacetError("");
      setCategoriesIncomplete(false);
      setIsLoadingClasses(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingClasses(true);
    setClassFacetError("");
    setCategoriesIncomplete(false);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const loadCategories = async (xml: string, source: string) => {
            const response = await cachedFetchFct("/proxy/api/fct", {
              method: "POST",
              headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", source) },
              body: xml,
              signal: controller.signal,
            });
            const data = await readFctResponse(response);
            if (!response.ok || data.error) throw new Error(data.error ?? `Categories query failed with HTTP ${response.status}.`);
            return data;
          };
          let data: ParsedFctResponse | undefined;
          let usedSampleFallback = false;
          let originalIncomplete = false;
          let originalWarning = "";
          const isAnytimeError = (error: unknown) => /ANYTIME|S1TAT|time.?limit|incomplete results/i.test(error instanceof Error ? error.message : String(error));
          try {
            data = await loadCategories(classFacetQueryXml, "FacetLoader:classes");
            originalIncomplete = data.incomplete;
            originalWarning = data.warning || data.sqlMessage || "";
            // Preserve partial class rows. Only retry when none were returned.
          } catch (firstError) {
            if (!isAnytimeError(firstError)) throw firstError;
            originalIncomplete = true;
            originalWarning = firstError instanceof Error ? firstError.message : String(firstError);
            // Tree and flat aggregation can both be interrupted before producing
            // the first grouped result. Fall through to the bounded sample below.
          }
          if (!data || (data.classes.length === 0 && (data.incomplete || originalIncomplete))) {
            // A limited unaggregated scan can return class/resource pairs before
            // Virtuoso manages to complete a global GROUP BY. Counts are
            // sample frequencies, never represented as exact totals.
            const sampleXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
              type: FCT_VIEW_TYPES.CLASSES, sample: "yes", tree: "", sort: "", offset: "0", limit: "500",
            }));
            const sampled = await loadCategories(sampleXml, "FacetLoader:classes-sample-fallback");
            const classSamples = new Map<string, { label: string; members: Set<string> }>();
            for (const columns of sampled.rows) {
              const iri = columns[0]?.value;
              const resource = columns[1]?.value;
              if (!iri || !resource) continue;
              const entry = classSamples.get(iri) ?? { label: columns[0]?.label || columns[0]?.shortform || toLabel(iri, "Class"), members: new Set<string>() };
              entry.members.add(resource);
              classSamples.set(iri, entry);
            }
            data = { ...sampled, classes: Array.from(classSamples, ([uri, item]) => ({ uri, label: item.label, count: item.members.size })) };
            usedSampleFallback = true;
          }
          if (cancelled) return;
          rememberShortforms(data?.shortforms);
          const classRows: FacetItem[] = Array.isArray(data.classes) ? data.classes : [];
          // Facet items and counts come exclusively from the flat Categories query.
          const uniqueClasses = new Map<string, FacetItem>();
          for (const row of classRows) if (!uniqueClasses.has(row.uri)) uniqueClasses.set(row.uri, row);
          setClassFacets(Array.from(uniqueClasses.values()));

		  setClassFacetWarning("");
          const incomplete = originalIncomplete || data.incomplete || usedSampleFallback;
          setCategoriesIncomplete(incomplete);
          const sampleNote = usedSampleFallback ? "Categories were recovered by a bounded non-aggregating scan. Counts reflect distinct resources in the returned sample, not complete class totals." : "";
          setMaestroIncompleteResults("categories", { incomplete, requestId: "", message: [originalWarning, data.warning || data.sqlMessage || "", sampleNote].filter(Boolean).join("; ") || "" });
        } catch (error) {
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          setCategoriesIncomplete(true);
          setMaestroIncompleteResults("categories", { incomplete: true, requestId: "", message: error instanceof Error ? error.message : String(error) });
          setClassFacetError(facetLoadErrorMessage(error, "Failed to load classes facets."));
        } finally {
          if (!cancelled) setIsLoadingClasses(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      // A cancelled request skips its finally block; release this widget's
      // loading indicator during cleanup. A replacement effect sets it true.
      setIsLoadingClasses(false);
    };
  }, [search, classFacetQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // The tree request supplies relationships only, never additional category items or counts.
  // Its output is intersected with the authoritative flat class list at render time.
  useEffect(() => {
    if (!categoriesTreeMode || (!search.trim() && !endpointReadyForQuery)) {
      setIsLoadingCategoryTree(false);
      setClassTreeEdges([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingCategoryTree(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", "FacetLoader:classes-hierarchy") },
            body: queryWithoutPagingXml(FCT_VIEW_TYPES.CLASSES, false, true),
            signal: controller.signal,
          });
          const data = await readFctResponse(response);
          if (!response.ok || data.error) throw new Error(data.error ?? `Category hierarchy query failed with HTTP ${response.status}.`);
          if (cancelled) return;
          setClassTreeEdges((data.classes ?? []).flatMap((row) => "parent" in row && typeof row.parent === "string" && row.parent ? [{ uri: row.uri, parent: row.parent }] : []));
          if (data.incomplete) {
            const previous = getMaestroIncompleteResults("categories");
            setCategoriesIncomplete(true);
            setMaestroIncompleteResults("categories", {
              incomplete: true,
              requestId: "",
              message: [previous?.message, "Category hierarchy was incomplete; only relationships between classes in the flat Categories list are shown.", data.warning || data.sqlMessage || ""].filter(Boolean).join("; "),
            });
          }
        } catch (error) {
          if (cancelled || controller.signal.aborted) return;
          // An unavailable hierarchy must never remove an item from the flat list.
          setClassTreeEdges([]);
          const previous = getMaestroIncompleteResults("categories");
          setCategoriesIncomplete(true);
          setMaestroIncompleteResults("categories", {
            incomplete: true,
            requestId: "",
            message: [previous?.message, "Superclass hierarchy unavailable; displaying only classes from the flat list.", error instanceof Error ? error.message : String(error)].filter(Boolean).join("; "),
          });
        } finally {
          if (!cancelled) setIsLoadingCategoryTree(false);
        }
      })();
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); setIsLoadingCategoryTree(false); };
  }, [categoriesTreeMode, classFacetQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Properties has a completely separate request lifecycle from Categories and Roles.
  useEffect(() => {
    if (!search.trim() && !endpointReadyForQuery) {
      setIsLoadingProperties(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingProperties(true);
    setPropertyFacetError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", "FacetLoader:properties") },
            body: propertyFacetQueryXml,
            signal: controller.signal,
          });
          const data = await readFctResponse(response);
          if (!response.ok && !data.incomplete) throw new Error(data.error ?? "Failed to load properties facets.");
          if (cancelled) return;
          rememberShortforms(data?.shortforms);
          setPropertyFacets(Array.isArray(data.properties) ? data.properties.filter((item) => item.uri !== RDF_TYPE_URI) : []);
		  setPropertyFacetWarning("");
          setMaestroIncompleteResults("properties", { incomplete: data.incomplete, requestId: "", message: data.warning || "" });
          setPropertyFacetSparql(typeof data.sparql === "string" ? data.sparql : "");
        } catch (error) {
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          setPropertyFacetError(facetLoadErrorMessage(error, "Failed to load properties facets."));
          setMaestroIncompleteResults("properties", { incomplete: true, requestId: "", message: error instanceof Error ? error.message : String(error) });
        } finally {
          if (!cancelled) setIsLoadingProperties(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      // The replacement request owns the loading flag; do not clear it on cancellation.
    };
  }, [search, propertyFacetQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Roles has a completely separate request lifecycle from Categories and Properties.
  useEffect(() => {
    if (!search.trim() && !endpointReadyForQuery) {
      // Preserve the last successful Role facets until a new response arrives.
      setIsLoadingRoles(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingRoles(true);
    setRoleFacetError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", "FacetLoader:roles") },
            body: roleFacetQueryXml,
            signal: controller.signal,
          });
          const data = await readFctResponse(response);
          if (!response.ok && !data.incomplete) throw new Error(data.error ?? "Failed to load roles facets.");
          if (cancelled) return;
          rememberShortforms(data?.shortforms);
          setRoleFacets(Array.isArray(data.roles) ? data.roles : []);
		  setRoleFacetWarning("");
          setMaestroIncompleteResults("roles", { incomplete: data.incomplete, requestId: "", message: data.warning || "" });
          setRoleFacetSparql(typeof data.sparql === "string" ? data.sparql : "");
        } catch (error) {
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          setRoleFacetError(facetLoadErrorMessage(error, "Failed to load roles facets."));
          setMaestroIncompleteResults("roles", { incomplete: true, requestId: "", message: error instanceof Error ? error.message : String(error) });
        } finally {
          if (!cancelled) setIsLoadingRoles(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      // The replacement request owns the loading flag; do not clear it on cancellation.
    };
  }, [search, roleFacetQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Graphs is a bounded discovery widget, not an aggregate/count workload.
  // Display the graph URIs returned within the Sheet limit. If there are more
  // than the cap, the incomplete indicator explains that the list is bounded.
  // Never run COUNT(DISTINCT ?g) in parallel just to render the widget.
  useEffect(() => { setGraphTotalCount(null); }, [queryCountXml, leftWidgetLimits.graphs, selectedEndpointId, queryRefreshRevision]);

  // Fetch only the graph page the user requested; never scan the entire result set.
  useEffect(() => {
    if (!endpointReadyForQuery || !selectedEndpointId) {
      setGraphFacets([]);
      setGraphListSparql("");
      setGraphHasMore(false);
      setGraphListIncomplete(false);
      setIsLoadingGraphs(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingGraphs(true);
    setGraphListIncomplete(false);
    setGraphListSparql("");
    async function loadGraphPage() {
      try {
        // Match Categories pagination: display at most ten graphs per page.
        const limit = leftWidgetLimits.graphs;
        const offset = 0;
        // Graphs must search across ALL named graphs containing this result
        // set, even after preprocessing has selected a graph in the live addr.
        // Only this clone is unscoped; the authoritative live query is untouched.
        const graphViewTree = setQueryViewAttributes(queryTree, {
          type: FCT_VIEW_TYPES.GRAPHS, limit: String(limit), offset: String(offset),
        });
        const liveAddr = graphViewTree.attributes.addr ?? "";
        const at = liveAddr.indexOf("@");
        if (at < 0) throw new Error("Graph-list query has no graph server address.");
        const graphQueryXml = serializeFctQuery({
          ...graphViewTree,
          attributes: {
            ...graphViewTree.attributes,
            addr: liveAddr.slice(at),
          },
        });
        const response = await maestroQueryFetch("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("graph-list", "GraphList") },
          body: graphQueryXml,
          signal: controller.signal,
        });
        const responseText = await response.text();
        const data = parseFctResponse(responseText);
        if (!cancelled) rememberShortforms(data?.shortforms);
        if (!cancelled) setGraphListSparql(data.sparql ?? "");
        if (!cancelled) {
          setGraphListIncomplete(data.incomplete);
          setMaestroIncompleteResults("graphs", { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        }
        if (!response.ok && !data.incomplete) throw new Error(data.error ?? "Failed to load graphs for the current query.");
        if (data.error && !data.incomplete) throw new Error(data.error);
        if (cancelled) return;
        // Retain any rows Virtuoso emitted under Anytime, even when incomplete.
        // No retry is necessary: the primary graph projection has no blocking aggregate.
        //const graphs = Array.isArray(data.graphs) ? [...new Set(data.graphs.filter((value: unknown): value is string => typeof value === "string"))] : [];
       // setGraphFacets(graphs.map((uri: string) => ({ uri, label: uri, count: 0 })));

const graphs: FacetItem[] = Array.isArray(data.graphs)
  ? Array.from(
      new Map<string, FacetItem>(
        (data.graphs as FacetItem[])
          .filter((item) => item && typeof item.uri === "string")
          .map((item) => [
            item.uri,
            createFacetItem(
              item.uri,
              item.label || toLabel(item.uri, "Class"),
              item.count,
            ),
          ]),
      ).values(),
    )
  : [];
setGraphFacets(graphs);

        setGraphHasMore(typeof data.rowCount === "number" ? data.rowCount >= limit : graphs.length >= limit);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Graph page load failed:", error);
          // Do not erase the last usable graph page because a subsequent
          // timeout or transient network failure returned no new rows.
          setGraphHasMore(false);
          setGraphListIncomplete(true);
          setMaestroIncompleteResults("graphs", { incomplete: true, requestId: "",
            message: error instanceof Error ? error.message : "Graph query did not complete." });
        }
      } finally {
        if (!cancelled) setIsLoadingGraphs(false);
      }
    }
    void loadGraphPage();
    return () => { cancelled = true; controller.abort(); };
  }, [leftWidgetLimits.graphs, queryCountXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);


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
  // The live query is the source of truth: without a <text> node there is no
  // text match to explain, whatever the search field happens to contain.
  const liveQueryHasText = queryTree.children.some((node) => node.name === "text");
  const visibleResultsPage = allLoadedResults.slice(resultsUiPage * resultsPageSize, (resultsUiPage + 1) * resultsPageSize);
  // The lit Bookmark button is the sole client-side feature gate for Personal states.
  const recordStatus = usePersonalRecordStatus({ enabled: personalStoreReady && isQueryBookmarked, results: visibleResultsPage, selectedUri, queryXml, resultsReady: urlStateInitialized && !isSearching && endpointReadyForQuery, pageIdentity: `${resultsOffset}:${resultsUiPage}:${resultsPageSize}:${queryRefreshRevision}`,
    onHiddenChanged: refreshQuery, selectedStatuses: selectedStatusFilters, toggleSelectedStatus: toggleSelectedStatusFilter });
  // Save last *known* query-wide Results/New observations on the History visit.
  // Unavailable statistics are never converted to zero, and stale pipelines
  // cannot overwrite a newer query's visit.
  const historyMetricWriteKeyRef = useRef("");
  useEffect(() => {
    if (!personalStoreReady || !urlStateInitialized || isSearching || isCountingResults || effectiveResultsTotalCount === null) return;
    const historyId = historyVisitQueryRef.current === queryXml ? historyVisitIdRef.current : "";
    if (!historyId) return;
    const lastNewCount = recordStatus.enabled && recordStatus.countsReady && !recordStatus.loading && !recordStatus.error
      ? recordStatus.counts.New : null;
    const key = `${historyId}:${effectiveResultsTotalCount}:${lastNewCount ?? "unknown"}`;
    if (historyMetricWriteKeyRef.current === key) return;
    historyMetricWriteKeyRef.current = key;
    void fetch("/proxy/api/query-favorites", {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateMetrics", historyId,
        lastResultCount: effectiveResultsTotalCount, lastNewCount }),
    }).then(response => { if (!response.ok && historyMetricWriteKeyRef.current === key) historyMetricWriteKeyRef.current = ""; })
      .catch(() => { if (historyMetricWriteKeyRef.current === key) historyMetricWriteKeyRef.current = ""; });
  }, [personalStoreReady, urlStateInitialized, isSearching, isCountingResults, effectiveResultsTotalCount,
    queryXml, historyBookmarkId, recordStatus.enabled, recordStatus.countsReady,
    recordStatus.loading, recordStatus.error, recordStatus.counts.New]);

  useEffect(() => {
    // Group members can be selected even when they are not on the ordinary
    // Results page. Do not let Results-page auto-selection override that pick
    // while the Groups tab is active; restore page-local selection on return.
    if (centralTab !== "groups" && explicitBlankNodeAnchor?.label !== selectedUri && visibleResultsPage.length > 0 && !visibleResultsPage.some((item) => item.uri === selectedUri)) {
      setSelectedUri(visibleResultsPage[0].uri);
    }
  }, [centralTab, resultsOffset, resultsPageSize, resultsUiPage, visibleResultsPage, selectedUri, explicitBlankNodeAnchor?.label]);

  useEffect(() => {
    if (!urlStateInitialized || isSearching || !resultsPageComplete || results.length === 0) return;
    const lastLoadedPage = Math.max(0, Math.ceil(allLoadedResults.length / resultsPageSize) - 1);
    if (resultsUiPage > lastLoadedPage) setResultsUiPage(lastLoadedPage);
  }, [urlStateInitialized, isSearching, resultsPageComplete, results.length, resultsPageSize, resultsUiPage]);

  const selectedResult = visibleResultsPage.find((item) => item.uri === selectedUri);
  const selectedGroupRecord = groupValues.find((item) => item.uri === selectedUri);
  // Preserve RDF identity when Record is focused on a literal FCT result.
  const selectedRecordTerm = currentRecordIdentity ?? selectedResult ?? selectedGroupRecord;
  const selectedRecordTermType = blankNodeTerm ? "bnode" : selectedRecordTerm?.termType ?? "uri";
  const selectedRecordDatatype = selectedRecordTerm?.datatype;
  const selectedRecordLanguage = selectedRecordTerm?.lang;
  // A literal reached through a focused forward property is known to have
  // at least that incoming Role in the current query context. Retain this
  // predicate for a bounded fallback when a global Roles scan times out.
  const recordFocusNode = getPropertyPath().at(-1);
  const recordFocusPredicate = selectedRecordTermType === "literal" && recordFocusNode?.name === "property"
    ? recordFocusNode.uri : undefined;
  const recordFocusValueDatatype = selectedRecordDatatype && selectedRecordDatatype !== "string" ? selectedRecordDatatype : undefined;
  const recordRootDebugValue = `<value datatype="${escapeXmlText(selectedRecordTermType === "uri" ? "uri" : selectedRecordLanguage ? "string" : recordFocusValueDatatype ?? "string")}"${selectedRecordLanguage ? ` xml:lang="${escapeXmlText(selectedRecordLanguage)}"` : ""}>${escapeXmlText(selectedUri)}</value>`;
  const recordRootDebugQuery = `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" addr="${escapeXmlText(queryTree.attributes.addr ?? "")}">${recordRootDebugValue}<view type="${FCT_VIEW_TYPES.DESCRIBE}" limit="${recordDescriptionQueryLimit}" offset="0"/></query>`;

  // The bound-node query is also the identity used by graph provenance.
  // A nodeID:// display label must never be interpolated as an RDF IRI; each
  // operation rebinds the node through the authoritative FCT property path.
  const blankNodeGraphQueryXml = selectedRecordTermType === "bnode" && blankNodeAnchor
    ? (() => {
        try {
          return blankNodeRecordListValuesQuery(
            serializeFctQuery(queryTree), blankNodeAnchor.predicate, blankNodeAnchor.parent,
            recordDescriptionQueryLimit, explicitBlankNodeAnchor?.label === selectedUri,
          );
        } catch { return ""; }
      })()
    : "";
  const graphDiscoveryIdentity = selectedRecordTermType === "bnode"
    ? { queryXml: blankNodeGraphQueryXml, parent: blankNodeAnchor?.parent, predicate: blankNodeAnchor?.predicate }
    : { iri: selectedUri };

  // The graph membership request is independent of optional author metadata.
  // Always send the authoritative query address; endpoint selection must not
  // diverge from the graph server in the live query address.
  useEffect(() => {
    setRecordGraphs([]);
    setRecordGraphAuthors([]);
    setSelectedRecordGraph("");
    setSelectedRecordAuthor("");
    setRecordGraphError("");
    setRecordAuthorError("");
    // A server ID alone does not guarantee that its registry, health check,
    // and authoritative query address have settled after URL restoration.
    // Avoid a transient "server not configured" error during that interval.
    if (!selectedUri || !endpointReadyForQuery || !selectedEndpointId ||
        (selectedRecordTermType === "bnode" && !blankNodeGraphQueryXml) || selectedRecordTermType === "literal") {
      setLoadingRecordGraphs(false);
      return;
    }
    const controller = new AbortController();
    setLoadingRecordGraphs(true);
    void (async () => {
      try {
        // A freshly restored graph-server registry can briefly lag the query
        // preflight. Retry ONLY that transient lookup failure; never repeat
        // expensive graph scans or silently retry other endpoint errors.
        let data: { graphs?: string[]; error?: string } = {};
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await maestroQueryFetch("/proxy/api/record-graphs", {
            method: "POST", cache: "no-store",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-graph-discovery", "RecordGraphs") },
            body: JSON.stringify({ ...graphDiscoveryIdentity, addr: queryTree.attributes.addr, operation: "graphs" }),
          });
          data = await response.json() as { graphs?: string[]; error?: string };
          if (response.ok) break;
          const temporaryRegistryMiss = response.status === 503 &&
            /graph server from query addr is not configured/i.test(data.error ?? "");
          if (!temporaryRegistryMiss || attempt === 2) throw new Error(data.error || "Could not discover record graphs.");
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              controller.signal.removeEventListener("abort", abort);
              resolve();
            }, 300 * (attempt + 1));
            const abort = () => {
              clearTimeout(timer);
              reject(new DOMException("Request aborted", "AbortError"));
            };
            if (controller.signal.aborted) abort();
            else controller.signal.addEventListener("abort", abort, { once: true });
          });
        }
        if (!controller.signal.aborted) setRecordGraphs(data.graphs ?? []);
      } catch (error) {
        if (!controller.signal.aborted) {
          const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
          setRecordGraphError(timedOut
            ? "Graph discovery timed out. Record data can still load without graph metadata."
            : error instanceof Error ? error.message : "Could not discover record graphs.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingRecordGraphs(false);
      }
    })();
    return () => controller.abort();
  }, [selectedUri, selectedRecordTermType, blankNodeGraphQueryXml, selectedEndpointId, endpointReadyForQuery, queryTree.attributes.addr, queryRefreshRevision]);

  // Load author provenance only after the user selects a graph family.
  // Slow metadata queries must never delay the Graph dropdown.
  useEffect(() => {
    setRecordGraphAuthors([]);
    setRecordAuthorError("");
    setSelectedRecordAuthor("");
    if (!selectedRecordGraph || !graphsInSelectedFamily.length || !selectedUri) {
      setLoadingRecordAuthors(false);
      return;
    }
    const controller = new AbortController();
    setLoadingRecordAuthors(true);
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/record-graphs", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-author-discovery", "RecordAuthors") },
          body: JSON.stringify({ ...graphDiscoveryIdentity, addr: queryTree.attributes.addr, operation: "authors", graphs: graphsInSelectedFamily }),
        });
        const data = await response.json() as { authors?: RecordGraphAuthor[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not discover graph authors.");
        if (!controller.signal.aborted) setRecordGraphAuthors(data.authors ?? []);
      } catch (error) {
        if (!controller.signal.aborted) setRecordAuthorError(error instanceof Error ? error.message : "Could not discover graph authors.");
      } finally {
        if (!controller.signal.aborted) setLoadingRecordAuthors(false);
      }
    })();
    return () => controller.abort();
  }, [selectedUri, selectedRecordGraph, recordGraphs, blankNodeGraphQueryXml, queryTree.attributes.addr, queryRefreshRevision]);

  // Membership discovery does not change an unfiltered DESCRIBE. Only selected
  // graph/author filters need the discovered list, avoiding a second record load.
  const filteredDescriptionGraphs = selectedRecordGraph || selectedRecordAuthor ? recordGraphs : null;

  // Load the selected resource once through Record SELECT; pagination is local to
  // the returned property/value pairs and does not trigger another server query.
  useEffect(() => {
    if (!selectedUri || !selectedEndpointId) {
      setDescribedRecord([]);
      setRecordDescriptionSnapshot(null);
      setRecordDescriptionPage(0);
      setIsDescribing(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setBlankNodeRecords([]);
    setActiveBlankNodeTab(0);
    setDescribedRecord([]);
    setRecordDescriptionSnapshot(null);
    setRecordDescribeIncomplete(false);
    setRecordDescriptionError("");
    if (selectedRecordTermType === "bnode") setRecordValidation(null);
    setDescribedRecordUri("");
    setRecordDescriptionPage(0);
    setFormattedRecordHtml("");
    setFormattedRecordButtonsHtml({});
    setRecordFormatError("");
    setRecordPolicyCheckedUri("");
    setIsDescribing(true);
    setRecordDebug({ xml: "", sparql: "", formatterXml: "", formatterSparql: "", policyDiscovery: "", templateLookup: "" });
    async function loadDescription() {
      try {
        let snapshotXml = "";
        let snapshotIncomplete = false;
        let rows: RecordValueTerm[] = [];
        let snapshotTerms: { subject: string; predicate: string; object: string; objectType: string; datatype?: string; lang?: string }[] = [];
        // The authoritative Record snapshot comes from one SPARQL SELECT.
        // The server filters language-tagged literals before applying the limit.
        // URI labels are fetched separately, without joining or multiplying triples.
        const selectedGraphs = selectedRecordAuthor
          ? [selectedRecordAuthor]
          : selectedRecordGraph
            ? (filteredDescriptionGraphs ?? []).filter((graph) => graph.split("#", 1)[0] === selectedRecordGraph)
            : [];
        if ((selectedRecordGraph || selectedRecordAuthor) && !selectedGraphs.length) {
          throw new Error("No named graphs are available for the selected Record graph or author.");
        }
        if (selectedRecordTermType === "bnode") {
          const rootBlankNode = !blankNodeAnchor && getPropertyPath().length === 0;
          if (!blankNodeAnchor && !rootBlankNode) {
            throw new Error("This blank node has no parent binding in its Results query response. A non-root Record needs its FCT-path parent binding.");
          }
          // The same FCT path rebinds the node in the query that describes it.
          // Root nodes have no parent URI; use the actual paged Results query.
          const blankRecordQueryXml = rootBlankNode
            ? rootBlankNodeRecordQuery(resultsRequestXml)
            : blankNodeRecordListValuesQuery(
                serializeFctQuery(queryTree), blankNodeAnchor!.predicate, blankNodeAnchor!.parent,
                recordDescriptionQueryLimit, explicitBlankNodeAnchor?.label === selectedUri,
              );
          const response = await cachedFetchFct("/proxy/api/sparql", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-blank-node-siblings", "RecordDescription") },
            body: JSON.stringify({ recordBlankNodes: {
              queryXml: blankRecordQueryXml,
              ...(blankNodeAnchor ? { parent: blankNodeAnchor.parent, predicate: blankNodeAnchor.predicate } : { root: true }),
              preferredLanguage: preferredAlphabetLanguage, limit: recordDescriptionQueryLimit,
              ...(selectedRecordGraph || selectedRecordAuthor ? { graphs: selectedGraphs } : {}),
            } }),
          });
          const payload = await response.json() as {
            error?: string; query?: string; incomplete?: boolean;
            results?: { bindings?: Array<Record<string, { type: string; value: string; datatype?: string; "xml:lang"?: string }>> };
          };
          if (!response.ok) throw new Error(payload.error || "Blank-node Record SELECT failed.");
          if (cancelled) return;
          const siblings = new Map<string, { rows: RecordValueTerm[]; triples: string[] }>();
          const fctNs = "http://openlinksw.com/services/facets/1.0/";
          for (const binding of payload.results?.bindings ?? []) {
            const node = binding.node, predicate = binding.predicate, object = binding.object;
            if (node?.type !== "bnode" || !node.value) continue;
            const id = `_:${node.value}`;
            const group = siblings.get(id) ?? { rows: [], triples: [] };
            // Keep the tab even when no outgoing values survive the language filter.
            if (!predicate?.value || !object) { siblings.set(id, group); continue; }
            const direction: "property" | "property-of" = binding.direction?.value === "property-of" ? "property-of" : "property";
            const valueType = object.type === "uri" ? "uri" : object.type === "bnode" ? "bnode" : "literal";
            const objectValue = valueType === "bnode" ? `_:${object.value}` : object.value;
            group.rows.push({ property: predicate.value, value: objectValue, direction, termType: valueType,
              ...(object.datatype ? { datatype: object.datatype } : {}),
              ...(object["xml:lang"] ? { lang: object["xml:lang"] } : {}) });
            const objectAttrs = ` termType="${valueType}"${object.datatype ? ` datatype="${escapeXmlText(object.datatype)}"` : ""}${object["xml:lang"] ? ` xml:lang="${escapeXmlText(object["xml:lang"])}"` : ""}`;
            group.triples.push(`<fct:row direction="${direction}"><fct:column termType="bnode">${escapeXmlText(id)}</fct:column><fct:column termType="uri">${escapeXmlText(predicate.value)}</fct:column><fct:column${objectAttrs}>${escapeXmlText(objectValue)}</fct:column></fct:row>`);
            siblings.set(id, group);
          }
          const incomplete = Boolean(payload.incomplete) || (payload.results?.bindings?.length ?? 0) >= recordDescriptionQueryLimit;
          const records: BlankNodeRecord[] = Array.from(siblings, ([id, group]) => ({
            id,
            rows: [...new Map(group.rows.map((row) => [
              [row.direction, row.property, row.value, row.termType, row.datatype ?? "", row.lang ?? ""].join("\u0000"), row,
            ])).values()],
            xml: `<fct:facets xmlns:fct="${fctNs}"><fct:complete>${incomplete ? "no" : "yes"}</fct:complete><fct:result type="describe">${group.triples.join("")}</fct:result></fct:facets>`,
          }));
          // The returned blank-node label is not portable between calls; only
          // use it to choose an initial tab if the endpoint happens to reuse it.
          // A label match is useful within one endpoint session but not a
          // portable RDF identity; expose all candidates as selectable tabs.
          const initialIndex = Math.max(0, records.findIndex((record) => record.id === selectedUri));
          setBlankNodeRecords(records);
          setActiveBlankNodeTab(initialIndex);
          setDescribedRecord(records[initialIndex]?.rows ?? []);
          setDescribedRecordUri(selectedUri);
          setRecordDescribeIncomplete(incomplete);
          setRecordDescriptionSnapshot(records[initialIndex]
            ? { key: currentRecordDescriptionKey, uri: selectedUri, xml: records[initialIndex].xml, incomplete }
            : null);
          setRecordDebug((current) => ({ ...current,
            xml: blankRecordQueryXml,
            sparql: payload.query ?? "Blank-node Record SELECT query unavailable.",
          }));
          return;
        }
        const response = await cachedFetchFct("/proxy/api/sparql", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-select-language", "RecordDescription") },
          body: JSON.stringify({ recordSelect: {
            queryXml: serializeFctQuery(queryTree),
            iri: selectedUri, termType: selectedRecordTermType,
            ...(recordFocusPredicate ? { focusPredicate: recordFocusPredicate } : {}),
            ...(selectedRecordDatatype && selectedRecordDatatype !== "string" && selectedRecordTermType === "literal" ? { datatype: selectedRecordDatatype } : {}),
            ...(selectedRecordLanguage ? { lang: selectedRecordLanguage } : {}),
            limit: recordDescriptionQueryLimit, preferredLanguage: preferredAlphabetLanguage,
            ...(selectedRecordGraph || selectedRecordAuthor ? { graphs: selectedGraphs } : {}),
          } }),
        });
        const data = await response.json() as {
          error?: string; incomplete?: boolean; query?: string;
          results?: { bindings?: Array<Record<string, {
            type: string; value: string; datatype?: string; "xml:lang"?: string;
          }>> };
        };
        if (!response.ok) throw new Error(data.error || "Record SELECT failed.");
        const fetchedBindings = data.results?.bindings ?? [];
        snapshotIncomplete = Boolean(data.incomplete);
        if (!cancelled) {
          setRecordDescribeIncomplete(snapshotIncomplete);
          setRecordDebug((current) => ({ ...current,
            xml: `POST /proxy/api/sparql\n${JSON.stringify({ recordSelect: { iri: selectedUri, termType: selectedRecordTermType, datatype: selectedRecordDatatype, lang: selectedRecordLanguage, limit: recordDescriptionQueryLimit, preferredLanguage: preferredAlphabetLanguage, graphs: selectedGraphs } }, null, 2)}`,
            sparql: data.query ?? "Record SELECT query unavailable.",
          }));
        }
        // URI labels are independently enriched in the background. The Record
        // SELECT intentionally returns only the three RDF triple columns.
        for (const binding of fetchedBindings) {
          const subject = binding.subject, predicate = binding.predicate, object = binding.object;
          if (!subject?.value || !predicate?.value || !object?.value) continue;
          const objectType = object.type === "uri" ? "uri" : object.type === "bnode" ? "bnode" : "literal";
          const objectValue = objectType === "bnode" ? `_:${object.value}` : object.value;
          snapshotTerms.push({ subject: subject.value, predicate: predicate.value,
            object: objectValue, objectType, ...(object.datatype ? { datatype: object.datatype } : {}),
            ...(object["xml:lang"] ? { lang: object["xml:lang"] } : {}) });
          const matchesRecordObject = object.value === selectedUri &&
            (selectedRecordTermType === "uri" ? object.type === "uri" :
             selectedRecordTermType === "literal" ? object.type === "literal" &&
               (object["xml:lang"] ?? "").toLowerCase() === (selectedRecordLanguage ?? "").toLowerCase() &&
               (!selectedRecordDatatype || !object.datatype || object.datatype === selectedRecordDatatype) :
             object.type === "bnode");
          const direction: "property" | "property-of" | null = selectedRecordTermType === "uri" && subject.value === selectedUri
            ? "property" : matchesRecordObject ? "property-of" : null;
          if (direction) rows.push({ property: predicate.value,
            value: direction === "property" ? objectValue : subject.value, direction,
            termType: direction === "property" ? objectType : "uri",
            ...(direction === "property" && object.datatype ? { datatype: object.datatype } : {}),
            ...(direction === "property" && object["xml:lang"] ? { lang: object["xml:lang"] } : {}),
          });

        }
        // Deduplicate the authoritative RDF triples (not auxiliary labels).
        snapshotTerms = [...new Map(snapshotTerms.map((term) => [
          [term.subject, term.predicate, term.object, term.objectType, term.datatype ?? "", term.lang ?? ""].join("\u0000"), term,
        ])).values()];
        rows = [...new Map(rows.map((row) => [
          [row.direction, row.property, row.value, row.termType, row.datatype ?? "", row.lang ?? ""].join("\u0000"), row,
        ])).values()];
        // Record SELECT applies LIMIT to eligible triples. A full page may
        // have additional rows on the endpoint.
        snapshotIncomplete = snapshotIncomplete || snapshotTerms.length >= recordDescriptionQueryLimit;
        if (!cancelled) setRecordDescribeIncomplete(snapshotIncomplete);
        // Normalize the actual Default-viewer rows for both filtered and unfiltered
        // requests. Never feed a different/raw server representation to XSLT.
        {
          const fctNs = "http://openlinksw.com/services/facets/1.0/";
          const triplesXml = snapshotTerms
            .filter((triple) => selectedRecordTermType === "uri" ? triple.subject === selectedUri || triple.object === selectedUri : triple.object === selectedUri)
            .map((triple) => {
              const attrs = ` termType="${escapeXmlText(triple.objectType)}"${triple.datatype ? ` datatype="${escapeXmlText(triple.datatype)}"` : ""}${triple.lang ? ` xml:lang="${escapeXmlText(triple.lang)}"` : ""}`;
              return `<fct:row><fct:column termType="uri">${escapeXmlText(triple.subject)}</fct:column><fct:column termType="uri">${escapeXmlText(triple.predicate)}</fct:column><fct:column${attrs}>${escapeXmlText(triple.object)}</fct:column></fct:row>`;
            }).join("");
          snapshotXml = `<fct:facets xmlns:fct="${fctNs}"><fct:complete>${snapshotIncomplete ? "no" : "yes"}</fct:complete><fct:result type="describe">${triplesXml}</fct:result></fct:facets>`;
        }
        if (!cancelled) {
          setRecordDescriptionSnapshot({ key: currentRecordDescriptionKey, uri: selectedUri, xml: snapshotXml, incomplete: snapshotIncomplete });
          setDescribedRecord(rows);
          setDescribedRecordUri(selectedUri);
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Record SELECT failed:", error);
          const message = error instanceof Error ? error.message : String(error);
          setRecordDescriptionError(`Record SELECT failed: ${message}`);
          setRecordFormatError(`Record SELECT failed: ${message}`);
          setDescribedRecord([]);
          setRecordDescriptionSnapshot(null);
          setRecordDescribeIncomplete(false);
        }
      } finally {
        if (!cancelled) setIsDescribing(false);
      }
    }
    void loadDescription();
    return () => { cancelled = true; controller.abort(); };
  }, [selectedUri, selectedRecordTermType, selectedRecordDatatype, selectedRecordLanguage, recordFocusPredicate, blankNodeAnchor?.parent, blankNodeAnchor?.predicate, selectedEndpointId, selectedRecordGraph, selectedRecordAuthor, filteredDescriptionGraphs, queryTree.attributes.addr, queryTree.attributes.graph, queryTree.attributes.inference, queryTree.attributes["same-as"], currentRecordDescriptionKey, recordDescriptionQueryLimit, preferredAlphabetLanguage, queryRefreshRevision, resultsRequestXml]);

  // The separate Record graph dropdown loader already knows which named graphs
  // contain this resource. Reuse that list for a single background label query;
  // never enumerate named graphs inside the initial Record SELECT or delay it.
  useEffect(() => {
    if (!selectedUri || describedRecordUri !== selectedUri || isDescribing ||
        !recordGraphs.length || !describedRecord.length || !selectedEndpointId) return;
    const addr = queryTree.attributes.addr || `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}`;
    const labelCache = recordUriLabelCacheRef.current;
    const valueUris = [...new Set(describedRecord
      .filter((row) => /^https?:\/\//i.test(row.value))
      .map((row) => row.value))];
    const missing = valueUris.filter((uri) => !labelCache.has(`${addr}\u0000${uri}`)).slice(0, 128);
    if (!missing.length) return;
    const graphIris = selectedRecordAuthor
      ? [selectedRecordAuthor]
      : selectedRecordGraph
        ? recordGraphs.filter((graph) => graph.split("#", 1)[0] === selectedRecordGraph)
        : recordGraphs;
    if (!graphIris.length) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await cachedFetchFct("/proxy/api/sparql", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-value-labels", "RecordValueLabels") },
          body: JSON.stringify({ recordValueLabels: { addr: queryTree.attributes.addr, uris: missing, graphs: graphIris, preferredLanguage: preferredAlphabetLanguage, version: 2 } }),
        });
        const data = await response.json() as {
          error?: string;
          results?: { bindings?: Array<Record<string, { type: string; value: string; "xml:lang"?: string }>> };
        };
        if (!response.ok) throw new Error(data.error || "Record URI label lookup failed.");
        if (controller.signal.aborted) return;
        const predicates = [
          "http://www.w3.org/2000/01/rdf-schema#label",
          "http://www.w3.org/2004/02/skos/core#prefLabel",
          "http://schema.org/name", "https://schema.org/name",
          "http://xmlns.com/foaf/0.1/name", "http://purl.org/dc/terms/title",
        ];
        const requested = new Set(missing);
        const best = new Map<string, { rank: number; text: string }>();
        for (const binding of data.results?.bindings ?? []) {
          const uri = binding.labelResource?.value ?? "";
          const label = binding.label;
          if (!requested.has(uri) || binding.labelResource?.type !== "uri" ||
              label?.type !== "literal" || !label.value.trim()) continue;
          const predicate = predicates.indexOf(binding.labelPredicate?.value ?? "");
          if (predicate < 0) continue;
          const lang = (label["xml:lang"] ?? "").toLowerCase();
          const rank = predicate * 2 + (lang === preferredAlphabetLanguage.toLowerCase() || lang.startsWith(`${preferredAlphabetLanguage.toLowerCase()}-`) ? 0 : 1);
          const current = best.get(uri);
          if (!current || rank < current.rank ||
              (rank === current.rank && label.value.localeCompare(current.text) < 0)) {
            best.set(uri, { rank, text: label.value });
          }
        }
        if (controller.signal.aborted) return;
        let updated = false;
        for (const [uri, label] of best) {
          const key = `${addr}\u0000${uri}`;
          if (labelCache.get(key) !== label.text) {
            labelCache.set(key, label.text);
            updated = true;
          }
        }
        if (updated) setRecordLabelRevision((value) => value + 1);
      } catch (error) {
        if (!controller.signal.aborted) console.warn("Record named-graph label enrichment failed:", error);
      }
    })();
    return () => controller.abort();
  }, [selectedUri, describedRecordUri, describedRecord, isDescribing, recordGraphs,
      selectedRecordGraph, selectedRecordAuthor, selectedEndpointId,
      queryTree.attributes.addr, queryTree.attributes.graph, preferredAlphabetLanguage]);

  // The formatted card may already be on screen when named-graph labels arrive.
  // Update only its URI link text; do not rerun SHACL, XSLT, or the Record SELECT.
  useEffect(() => {
    const root = formattedRecordContainerRef.current;
    if (!root || !formattedRecordHtml) return;
    const addr = queryTree.attributes.addr || `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}`;
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-maestro-record-uri]"))) {
      const uri = element.getAttribute("data-maestro-record-uri") ?? "";
      const label = recordUriLabelCacheRef.current.get(`${addr}\u0000${uri}`);
      if (label) element.textContent = label;
    }
  }, [recordLabelRevision, formattedRecordHtml, selectedUri, selectedEndpointId,
      queryTree.attributes.addr, queryTree.attributes.graph]);

  // Discover a record's class policy from the personal SPARQL server after its DESCRIBE data identifies rdf:type values.
  useEffect(() => {
    if (!personalStoreReady) { setRecordPolicy(null); setRecordPolicies([]); setSelectedRecordTemplateUri(""); setRecordPolicyError(""); setIsLoadingRecordPolicy(false); setRecordPolicyCheckedUri(selectedUri); return; }
    // Never discover against a partially reloaded policy graph.
    if (!personalPoliciesReady) {
      setRecordPolicy(null);
      setRecordPolicies([]);
      setIsLoadingRecordPolicy(!personalPoliciesSeedError);
      setRecordPolicyError(personalPoliciesSeedError ? `Personal policy graph load failed: ${personalPoliciesSeedError}` : "");
      return;
    }
    if (!selectedUri || selectedRecordTermType === "bnode" || !personalSparqlEndpoint) {
      setRecordPolicy(null);
      setRecordPolicies([]);
      setSelectedRecordTemplateUri("");
      setRecordPolicyError("");
      setRecordValidation(null);
      setFormattedRecordHtml("");
      setRecordFormatError("");
      setIsLoadingRecordPolicy(false);
      setRecordPolicyCheckedUri("");
      return;
    }
    // Wait for this record's DESCRIBE before deciding its formatter. Do not
    // clear the prior policy during a temporary empty/loading transition.
    if (isDescribing || describedRecordUri !== selectedUri || !describedRecord.length) return;
    const rdfTypeUri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const knownResultClassIris = (selectedResult?.uri === selectedUri || selectedGroupRecord?.uri === selectedUri)
      ? getClassesAtNode(getPropertyPath().at(-1)?.id ?? null)
      : [];
    const actualRecordTypes = Array.from(new Set(describedRecord
      .filter((item) => item.direction === "property" && item.property === rdfTypeUri && /^[a-z][a-z0-9+.-]*:/i.test(item.value))
      .map((item) => item.value)));
    const recordTypes = Array.from(new Set([
      ...actualRecordTypes,
      // When the partial DESCRIBE does not include rdf:type, the current
      // Results query's class constraint still identifies this matched record.
      ...knownResultClassIris,
    ]));
    if (!recordTypes.length) {
      setRecordPolicy(null);
      setRecordPolicies([]);
      setSelectedRecordTemplateUri("");
      setRecordPolicyError("");
      setIsLoadingRecordPolicy(false);
      setRecordPolicyCheckedUri(selectedUri);
      return;
    }
    const controller = new AbortController();
    setIsLoadingRecordPolicy(true);
    // Retain the current selection while the next record's policy is resolved;
    // the record-keyed render guard prevents showing stale formatted HTML.
    setRecordPolicyError("");
    maestroQueryFetch("/proxy/api/policies", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-discover", "RecordPolicyDiscovery") },
      body: JSON.stringify({ action: "discover", recordTypes, recordUri: selectedUri, queryXml,
        historyUri: historyVisitQueryRef.current === queryXml ? historyVisitIdRef.current : undefined }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { policies?: { uri: string; label: string; recordShape: string; matchedClasses?: string[]; templates: { uri: string; label: string }[] }[]; error?: string; debugSparql?: string };
      if (!controller.signal.aborted) setRecordDebug((current) => ({ ...current, policyDiscovery: payload.debugSparql ?? `POST /proxy/api/policies\n${JSON.stringify({ action: "discover", recordTypes }, null, 2)}` }));
      if (!response.ok) throw new Error(payload.error || `Policy lookup returned HTTP ${response.status}.`);
      if (!controller.signal.aborted) {
        const hasSavedHistoryQuery = describedRecord.some((item) => item.property === "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#historyQueryXML" && item.value.trim().length > 0);
        const policies = (payload.policies ?? []).map((item) => {
          // The query-results format is meaningful only for records that actually carry a saved FCT query.
          const templates = (item.templates ?? []).filter((template) =>
            !template.uri.endsWith("BookmarkQueryResultsTemplate") || hasSavedHistoryQuery,
          );
          return { ...item, matchedClasses: item.matchedClasses ?? [], templates, template: templates[0]?.uri ?? null };
        }).filter((item) => item.templates.length > 0);
        setRecordPolicies(policies);
        let preferredPolicy = policies[0] ?? null;
        let preferredTemplate = preferredPolicy?.templates[0]?.uri ?? "";
        try {
          const db = queryTreeHeightDbRef.current;
          if (db && selectedUri) {
            const store = db.transaction("preferences", "readonly").objectStore("preferences");
            const policyKey = recordFormatPreferenceKey("policy");
            const templateKey = recordFormatPreferenceKey("template");
            const readPreference = (key: string) => new Promise<string>((resolve) => {
              if (!key) { resolve(""); return; }
              const req = store.get(key);
              req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : "");
              req.onerror = () => resolve("");
            });
            // Schedule both IndexedDB reads before awaiting either one so
            // the readonly transaction cannot auto-close between requests.
            const [savedPolicy, savedTemplate] = await Promise.all([
              readPreference(policyKey), readPreference(templateKey),
            ]);
            preferredPolicy = policies.find((item) => item.uri === savedPolicy) ?? preferredPolicy;
            preferredTemplate = preferredPolicy?.templates.some((item) => item.uri === savedTemplate) ? savedTemplate : (preferredPolicy?.templates[0]?.uri ?? "");
          }
        } catch { /* Use the first available policy/format when no saved preference is available. */ }
        // The XML query is authoritative. Only classes directly in the active
        // view scope participate; never consult classes from unrelated branches.
        // Test every scoped class against every actual rdf:type, then prefer a
        // discovered policy whose mui:forClass matches that shared class.
        const activePath = getPropertyPath();
        const scopeClasses = getClassesAtNode(activePath.at(-1)?.id ?? null);
        const recordTypeSet = new Set(actualRecordTypes);
        const matchingClass = scopeClasses.find((iri) =>
          recordTypeSet.has(iri) && policies.some((policy) => policy.matchedClasses.includes(iri)));
        const queryClassPolicy = matchingClass
          ? policies.find((policy) => policy.matchedClasses.includes(matchingClass)) ?? null
          : null;
        const explicitSelection = manualRecordFormatSelectionRef.current;
        const manualPolicy = explicitSelection?.recordUri === selectedUri && explicitSelection.queryXml === queryXml
          ? policies.find((policy) => policy.uri === explicitSelection.policyUri &&
              policy.templates.some((template) => template.uri === explicitSelection.templateUri)) ?? null
          : null;
        if (manualPolicy && explicitSelection) {
          preferredPolicy = manualPolicy;
          preferredTemplate = explicitSelection.templateUri;
        } else if (queryClassPolicy) {
          preferredPolicy = queryClassPolicy;
          preferredTemplate = queryClassPolicy.templates[0]?.uri ?? "";
        }
        if (controller.signal.aborted) return;
        setRecordPolicy(preferredPolicy);
        setSelectedRecordTemplateUri(preferredTemplate);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
        setRecordPolicyError(error instanceof Error ? error.message : "Could not look up the record policy.");
      }
    }).finally(() => { if (!controller.signal.aborted) { setIsLoadingRecordPolicy(false); setRecordPolicyCheckedUri(selectedUri); } });
    return () => controller.abort();
  }, [selectedUri, selectedRecordTermType, personalSparqlEndpoint, describedRecord, describedRecordUri, isDescribing, recordFormatPreferenceLoaded, authSession, personalPoliciesReady, personalPoliciesSeedError, selectedResult?.uri, selectedGroupRecord?.uri, queryXml, historyBookmarkId]);


  async function validateSelectedRecord(policyOverride: RecordPolicyOption | null = recordPolicy) {
    if (!selectedUri || !policyOverride || !personalPoliciesReady) return;
    setIsValidatingRecord(true);
    setRecordValidation(null);
    setRecordPolicyError("");
    try {
      // Validate the *same* immutable DESCRIBE snapshot used by the formatter.
      // A second query would allow validation to pass a different dataset.
      const snapshot = recordDescriptionSnapshot;
      if (!snapshot || snapshot.key !== currentRecordDescriptionKey || snapshot.uri !== selectedUri || isDescribing) {
        throw new Error("The record description must finish loading before validation.");
      }
      const report = await validateRecordSnapshot(policyOverride, snapshot);
      setRecordValidation(report);
      // Validate is the sole trigger for ingesting SHACL-discovered Personal facets.
      // Query clones preserve the live scope but cannot mutate its view.
      try {
        const candidateClasses = classFacets.map((item) => item.uri);
        const candidateProperties = propertyFacets.map((item) => item.uri);
        const candidateRoles = roleFacets.map((item) => item.uri);
        const facetResponse = await maestroQueryFetch("/proxy/api/policies", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-shacl-facet-ingestion", "RecordShaclFacets") },
          body: JSON.stringify({
            action: "facet-discover", recordShape: policyOverride.recordShape,
            classes: candidateClasses, properties: candidateProperties, roles: candidateRoles,
            classQuery: classFacetQueryXml, propertyQuery: propertyFacetQueryXml, roleQuery: roleFacetQueryXml,
          }),
        });
        const facetPayload = await facetResponse.json() as { facets?: { uri: string; direction: "forward" | "reverse"; label: string }[]; graph?: string; propertyShapes?: number; rawPaths?: number; error?: string };
        if (!facetResponse.ok) throw new Error(facetPayload.error || `SHACL facet discovery returned HTTP ${facetResponse.status}.`);
        // Collect the complete SHACL path set before touching the live query.
        // Direction + IRI is the identity; preserve order and deduplicate.
        const queuedFacets = Array.from(new Map((facetPayload.facets ?? [])
          .filter((facet) => facet && /^https?:\/\/|^gttps?:\/\/|^[a-z][a-z0-9+.-]*:/i.test(facet.uri))
          .map((facet) => [`${facet.direction}:${facet.uri}`, facet])).values());
        if (!queuedFacets.length) {
          setRecordPolicyError(`Validation completed, but no Personal facets could be derived from ${policyOverride.recordShape} in ${facetPayload.graph ?? "the configured shapes graph"}. Discovered ${facetPayload.propertyShapes ?? "unknown"} property shapes and ${facetPayload.rawPaths ?? "unknown"} paths. ${facetPayload.propertyShapes === 0 ? "Check whether the SHACL policy document is loaded into your personal graph server." : "Check the shape paths and supported forward/inverse property forms."}`);
        } else {
          // Use the *current* authoritative snapshot, not the tree captured
          // before the asynchronous validation and SHACL requests began.
          const liveTree = workbenchQueryTreeApi.getTree();
          const scopePath = getPropertyPath();
          const scopeId = scopePath[scopePath.length - 1]?.id ?? null;
          const findScope = (tree: FctQueryTree): FctQueryNode[] | null => {
            if (!scopeId) return tree.children;
            const find = (nodes: FctQueryNode[]): FctQueryNode | null => {
              for (const node of nodes) {
                if (node.id === scopeId) return node;
                const nested = find(node.children);
                if (nested) return nested;
              }
              return null;
            };
            return find(tree.children)?.children ?? null;
          };
          const scopeChildren = findScope(liveTree);
          if (!scopeChildren || !scopeChildren.some((node) => node.id === "query-view")) {
            throw new Error("The current FCT view changed while SHACL facets were being discovered. Please Validate again.");
          }
          let queuedTree = liveTree;
          let changed = false;
          for (const facet of queuedFacets) {
            const nodeName = facet.direction === "reverse" ? "property-of" : "property";
            const existing = findScope(queuedTree)?.find((node) =>
              node.name === nodeName && node.attributes.iri === facet.uri,
            );
            if (existing) continue;
            const newNode: FctQueryNode = {
              id: facet.direction === "reverse"
                ? `role-filter-${scopeId ? `${encodeURIComponent(scopeId)}-` : "root-"}${encodeURIComponent(facet.uri)}`
                : `property-filter-${scopeId ? `${encodeURIComponent(scopeId)}-` : "root-"}${encodeURIComponent(facet.uri)}`,
              name: nodeName,
              attributes: { iri: facet.uri },
              children: [],
            };
            queuedTree = workbenchQueryTreeApi.insertNode(queuedTree, scopeId, newNode);
            changed = true;
          }
          // Exactly one authoritative publication for all queued relationships.
          if (changed) replaceQueryTree(queuedTree);
          setFocusWidgetsSuppressed(false);
          setDefaultLeftTab("personal");
        }
      } catch (facetError) {
        console.warn("SHACL facet ingestion failed after record validation:", facetError);
        setRecordPolicyError(facetError instanceof Error ? `Validation completed, but SHACL facet ingestion failed: ${facetError.message}` : "SHACL facet ingestion failed.");
      }
    } catch (error) {
      setRecordPolicyError(error instanceof Error ? error.message : "Could not validate this record.");
    } finally {
      setIsValidatingRecord(false);
    }
  }

  // A formatter result belongs to one record and one selected template. Async
  // responses for older selections may finish later and must never repaint it.
  const currentRecordFormatKey = `${currentRecordDescriptionKey}\u0000${recordPolicy?.uri ?? ""}\u0000${selectedRecordTemplateUri}`;
  const latestRecordFormatKeyRef = useRef(currentRecordFormatKey);
  latestRecordFormatKeyRef.current = currentRecordFormatKey;
  // Abort obsolete Record formatter traffic when the selected Record, graph,
  // policy, or template changes. Previews share the same lifecycle.
  const recordFormatterAbortControllersRef = useRef(new Set<AbortController>());
  useEffect(() => () => {
    for (const controller of recordFormatterAbortControllersRef.current) controller.abort();
    recordFormatterAbortControllersRef.current.clear();
  }, [currentRecordFormatKey]);
  
  
  const currentFormattedRecordHtml = formattedRecordKey === currentRecordFormatKey ? formattedRecordHtml : "";

  
  async function formatSelectedRecord(templateOverride?: string, preview = false, enrichLinkedResources = false): Promise<string | null> {
    if (!recordPolicy || !personalPoliciesReady) return null;
    const templateUri = templateOverride || selectedRecordTemplateUri || recordPolicy.template;
    if (!templateUri) {
      if (!preview) { setRecordFormatError("This policy does not identify an XSLT template yet."); setFormattedRecordHtml(""); }
      return null;
    }
    if (!recordDescriptionSnapshot || recordDescriptionSnapshot.uri !== selectedUri ||
        recordDescriptionSnapshot.key !== currentRecordDescriptionKey ||
        describedRecordUri !== selectedUri || isDescribing) return null;
    const requestKey = currentRecordFormatKey;
    const controller = new AbortController();
    recordFormatterAbortControllersRef.current.add(controller);
    const isCurrentRequest = () => !controller.signal.aborted && latestRecordFormatKeyRef.current === requestKey;
    let formatStage = "Record formatting";
    if (!preview && !enrichLinkedResources && isCurrentRequest()) { setRecordFormatError(""); setFormattedRecordHtml(""); setFormattedRecordButtonsHtml({}); setFormattedRecordKey(""); }
    try {
      if (!preview && !enrichLinkedResources) {
        formatStage = "Record SHACL validation";
        const checked = await validateRecordSnapshot(recordPolicy, recordDescriptionSnapshot);
        if (!isCurrentRequest()) return null;
        setRecordValidation(checked);
        if (!checked.complete || !checked.conforms) {
          throw new Error(`The selected format was not loaded because its SHACL validation did not pass. ${checked.message} ${checked.violations.map((v) => v.message).join(" ")}`.trim());
        }
      }
      formatStage = "Record template retrieval (/proxy/api/policies)";
      const templateResponse = await maestroQueryFetch("/proxy/api/policies", {
        method: "POST", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-template", "RecordPolicyTemplate") },
        body: JSON.stringify({ action: "template", template: templateUri }),
      });
      const templatePayload = await templateResponse.json() as { templateXslt?: string; enrichmentXslt?: string; nextName?: string; nextVersion?: string; error?: string; debugSparql?: string };
      if (!preview && isCurrentRequest()) setRecordDebug((current) => ({ ...current, templateLookup: templatePayload.debugSparql ?? `POST /proxy/api/policies\n${JSON.stringify({ action: "template", template: templateUri }, null, 2)}` }));
      if (!templateResponse.ok || typeof templatePayload.templateXslt !== "string") throw new Error(templatePayload.error || `Template reload returned HTTP ${templateResponse.status}.`);
      if (!preview && !enrichLinkedResources && isCurrentRequest()) setFormatterHasEnrichment(Boolean(templatePayload.enrichmentXslt));
      if (!isCurrentRequest()) return null;
      formatStage = "Record formatting preparation";
      // Formatting never issues a second DESCRIBE. The snapshot is exactly the
      // data the default Record table received, including its completion status.
      // Do not transform a previous resource/graph selection while the new one loads.
      const snapshot = recordDescriptionSnapshot;
      if (!snapshot || snapshot.uri !== selectedUri || snapshot.key !== currentRecordDescriptionKey ||
          describedRecordUri !== selectedUri || isDescribing) {
        if (!preview && isCurrentRequest()) setRecordFormatError("The record description is not ready yet.");
        return null;
      }
      const sourceXml = new DOMParser().parseFromString(snapshot.xml, "application/xml");
      if (sourceXml.querySelector("parsererror") || sourceXml.documentElement.localName !== "facets") {
        throw new Error("The Record viewer's DESCRIBE snapshot is not valid FCT XML.");
      }
      if (!preview && isCurrentRequest()) {
        setRecordDebug((current) => ({ ...current,
          formatterXml: current.xml,
          formatterSparql: current.sparql,
        }));
      }
      // A formatter can declare an optional XSLT query transformation in RDF.
      // This is generic template execution: predicates, relationships, and
      // presentation are owned by the selected stylesheet, not by Maestro.
      if (!preview && enrichLinkedResources && templatePayload.enrichmentXslt) {
        formatStage = "Record enrichment (Maestro SaxonJS)";
        const enrichmentQueryDocument = await transformMaestroQueryXslt(
          templatePayload.enrichmentXslt, sourceXml, serializeFctQuery(queryTree), selectedUri, controller.signal,
        );
        const enrichmentRoot = enrichmentQueryDocument.documentElement;
        if (!enrichmentRoot || enrichmentRoot.localName !== "query") throw new Error("Formatter enrichment XSLT did not produce an FCT query.");
        if (Array.from(enrichmentRoot.getElementsByTagName("*")).some((element) => element.localName === "view")) {
        const activeGraph = selectedRecordAuthor || (selectedRecordGraph
          ? recordGraphs.find((uri) => uri.split("#", 1)[0] === selectedRecordGraph) ?? selectedRecordGraph
          : recordGraphs[0]);
        const originalAddr = enrichmentRoot.getAttribute("addr") || queryTree.attributes.addr || "";
        const delimiter = originalAddr.indexOf("@");
        if (activeGraph && delimiter >= 0) enrichmentRoot.setAttribute("addr", `${activeGraph}@${originalAddr.slice(delimiter + 1)}`);
        const enrichmentResponse = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("record-template-enrichment", "RecordTemplateEnrichment") },
          body: new XMLSerializer().serializeToString(enrichmentQueryDocument),
        });
        const enrichmentXml = await enrichmentResponse.text();
        if (!enrichmentResponse.ok) throw new Error(`Formatter enrichment query returned HTTP ${enrichmentResponse.status}: ${enrichmentXml.slice(0, 300)}`);
        const enrichmentDocument = new DOMParser().parseFromString(enrichmentXml, "application/xml");
        if (enrichmentDocument.querySelector("parsererror")) throw new Error("Invalid formatter enrichment response XML.");
        const namespace = "http://openlinksw.com/services/facets/1.0/";
        const targetResult = Array.from(sourceXml.getElementsByTagNameNS(namespace, "result"))
          .find((element) => element.getAttribute("type") === FCT_VIEW_TYPES.DESCRIBE);
        if (targetResult) {
          const insertTriple = (subject: string, predicate: string, object: Element) => {
            if (!subject || !predicate || !object.textContent?.trim()) return;
            const row = sourceXml.createElementNS(namespace, "fct:row");
            const subjectColumn = sourceXml.createElementNS(namespace, "fct:column");
            subjectColumn.setAttribute("datatype", "uri"); subjectColumn.textContent = subject;
            const predicateColumn = sourceXml.createElementNS(namespace, "fct:column");
            predicateColumn.setAttribute("datatype", "uri"); predicateColumn.textContent = predicate;
            const objectColumn = sourceXml.createElementNS(namespace, "fct:column");
            for (const attribute of Array.from(object.attributes)) objectColumn.setAttribute(attribute.name, attribute.value);
            objectColumn.textContent = object.textContent;
            row.append(subjectColumn, predicateColumn, objectColumn);
            targetResult.appendChild(row);
          };
          for (const row of Array.from(enrichmentDocument.getElementsByTagNameNS(namespace, "row"))) {
            const columns = Array.from(row.children).filter((node) => node.localName === "column");
            const resource = columns[0]?.textContent?.trim() ?? "";
            if (!resource) continue;
            const projections = new Map<string, Element[]>();
            for (const column of columns.slice(2)) {
              const path = column.getAttribute("path") || "";
              if (!path) continue;
              projections.set(path, Array.from(column.children).filter((node) => node.localName === "value"));
            }
            for (const [path, values] of projections) {
              const predicates = path.split(/\s+/);
              if (predicates.length !== 1) continue;
              for (const value of values) insertTriple(resource, predicates[0], value);
            }
            for (const [path, values] of projections) {
              const predicates = path.split(/\s+/);
              if (predicates.length !== 2) continue;
              for (const parent of projections.get(predicates[0]) ?? []) {
                const parentUri = parent.textContent?.trim() ?? "";
                for (const value of values) insertTriple(parentUri, predicates[1], value);
              }
            }
          }
        }
        } // A template with no applicable query view needs no enrichment.
      }
      if (!isCurrentRequest()) return null;
      // Optional Commons discovery is added to the READ-ONLY XML envelope.
      // The XSLT still selects and lays out every photograph using XPath.
      let commonsImages: Array<{url: string; credit?: string; license?: string; source?: string; title?: string}> = [];
      if (!preview && templateUri.includes("DbpediaPlaceRecordTemplate")) {
        const rdfsLabel = "http://www.w3.org/2000/01/rdf-schema#label";
        const fctNs = "http://openlinksw.com/services/facets/1.0/";
        const label = Array.from(sourceXml.getElementsByTagNameNS(fctNs, "row"))
          .filter((row) => Array.from(row.children).filter((child) => child.localName === "column")[1]?.textContent?.trim() === rdfsLabel)
          .map((row) => Array.from(row.children).filter((child) => child.localName === "column")[2]?.textContent?.trim() ?? "")
          .find(Boolean) || selectedUri?.split("/").pop()?.replace(/_/g," ") || "";
        if (label) {
          try {
            const response = await fetch(`/proxy/api/commons-images?label=${encodeURIComponent(label.slice(0, 120))}`, {
              cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
            });
            if (response.ok) {
              const payload = await response.json() as { images?: typeof commonsImages };
              commonsImages = payload.images ?? [];
            }
          } catch (error) {
            if (controller.signal.aborted) return null;
            console.debug("Optional Commons images unavailable", error);
          }
        }
      }
      if (!isCurrentRequest()) return null;
      formatStage = "Record formatting (Maestro SaxonJS)";
      const document = await transformMaestroRecordXslt(
        templatePayload.templateXslt,
        sourceXml,
        serializeFctQuery(queryTree),
        selectedUri,
        controller.signal,
        commonsImages,
      );
      if (!isCurrentRequest()) return null;
      formatStage = "Record template rendering";
      const templateRoot = document.body.firstElementChild;
      if (!templateRoot || templateRoot.tagName.toLowerCase() !== "section" || templateRoot.id !== "maestro-record-viewer") {
        throw new Error('The XSLT result must have a root <section id="maestro-record-viewer"> so it can replace the default Record viewer content.');
      }
      // Use the same npm package/version notation used by registry dependency metadata.
      const frameworkRequirement = (templateRoot.getAttribute("mui:framework") ?? "").trim();
      const frameworkMatch = /^([a-z0-9@/._-]+)@\^(\d+)\.(\d+)\.(\d+)$/.exec(frameworkRequirement);
      if (!frameworkMatch) throw new Error('The template must declare a package requirement such as mui:framework="next@^16.4.0".');
      if (frameworkMatch[1] !== templatePayload.nextName) throw new Error(`Template framework package "${frameworkMatch[1]}" does not match the installed package "${templatePayload.nextName || "(unknown)"}".`);
      const installedVersion = /^(\d+)\.(\d+)\.(\d+)/.exec(templatePayload.nextVersion ?? "");
      if (!installedVersion) throw new Error("Maestro could not determine the installed Next.js version to check this template.");
      const requiredVersion = frameworkMatch.slice(2).map(Number);
      const actualVersion = installedVersion.slice(1).map(Number);
      const versionIsOlder = actualVersion[0] !== requiredVersion[0]
        ? actualVersion[0] < requiredVersion[0]
        : actualVersion[1] !== requiredVersion[1]
          ? actualVersion[1] < requiredVersion[1]
          : actualVersion[2] < requiredVersion[2];
      if (actualVersion[0] !== requiredVersion[0] || versionIsOlder) {
        throw new Error(`This template requires ${frameworkRequirement}; the installed version is ${templatePayload.nextVersion}.`);
      }
      // Resolve URI-valued card fields to RDF labels using the same graph server,
      // while preserving the URI for Maestro's root-value navigation.
      // Some older templates emit URI objects as plain <dd> text. Promote
      // those individual values to URI-aware links instead of requiring every
      // graph-stored stylesheet to be rewritten for Maestro navigation.
      for (const field of Array.from(document.body.querySelectorAll<HTMLElement>("dd[id]"))) {
        if (field.querySelector("[data-maestro-record-uri]")) continue;
        const text = (field.textContent ?? "").trim();
        if (!/^https?:\/\//i.test(text)) continue;
        const values = text.split(/,\s+(?=https?:\/\/)/i).filter(Boolean);
        if (!values.every((value) => /^https?:\/\//i.test(value))) continue;
        field.replaceChildren(...values.flatMap((value, index) => {
          const anchor = document.createElement("a");
          anchor.id = `${field.id}-link-${index + 1}`;
          anchor.setAttribute("data-maestro-record-uri", value);
          anchor.setAttribute("href", "#");
          anchor.textContent = value;
          if (index === 0) return [anchor];
          const separator = document.createElement("span");
          separator.id = `${field.id}-separator-${index + 1}`;
          separator.textContent = " · ";
          return [separator, anchor];
        }));
      }
      const uriTargets = Array.from(document.body.querySelectorAll<HTMLElement>("[data-maestro-record-uri]"));
      // URI display labels are enriched separately in discovered graphs;
      // the authoritative Record SELECT never joins those label triples.
      const queryAddrForLabels = queryTree.attributes.addr || (selectedEndpointId ? `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}` : "");
      const cachedLabels = recordUriLabelCacheRef.current;
      for (const target of uriTargets) {
        const uri = target.getAttribute("data-maestro-record-uri") ?? "";
        if (!uri) continue;
        target.textContent = cachedLabels.get(`${queryAddrForLabels}\u0000${uri}`) ?? toLabel(uri);
        target.setAttribute("title", uri);
        target.setAttribute("href", "#");
        target.classList.add("cursor-pointer", "text-sky-700", "hover:underline", "dark:text-sky-400");
      }
      // Both views share this snapshot. Surface partial DESCRIBE responses rather
      // than imply that an omitted profile field was absent from the graph.
      if (recordDescriptionSnapshot.incomplete) {
        const warning = document.createElement("p");
        warning.id = "maestro-record-partial-warning";
        warning.className = "border-t bg-muted/40 px-5 py-2 text-xs text-muted-foreground";
        warning.textContent = "This record description is incomplete. Some fields may be missing.";
        templateRoot.querySelector("#record-fields")?.insertAdjacentElement("afterend", warning);
      }
      const sourceIds = new Set<string>();
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        const id = element.getAttribute("id");
        if (!id) throw new Error(`Template element <${element.tagName.toLowerCase()}> is missing its required id.`);
        if (sourceIds.has(id)) throw new Error(`Template contains duplicate id \"${id}\".`);
        sourceIds.add(id);
      }
      const queryDefinitions = new Map<string, Element>();
      document.querySelectorAll("query[id]").forEach((element) => {
        const id = element.getAttribute("id");
        if (id) queryDefinitions.set(id, element);
      });
      // Keep XML query definitions and all their IDs in a hidden template area so repeated HTML components do not duplicate those IDs.
      const queryDefinitionContainer = document.createElement("div");
      queryDefinitionContainer.hidden = true;
      queryDefinitionContainer.setAttribute("aria-hidden", "true");
      queryDefinitionContainer.setAttribute("data-maestro-query-definitions", "true");
      for (const queryDefinition of queryDefinitions.values()) queryDefinitionContainer.appendChild(queryDefinition);
      if (queryDefinitions.size > 0) document.body.appendChild(queryDefinitionContainer);
      const xpathValues = (xml: XMLDocument, expression: string): string[] => {
        const resolver = (prefix: string | null) => prefix === "fct" ? "http://openlinksw.com/services/facets/1.0/" : null;
        try {
          const result = xml.evaluate(expression, xml.documentElement, resolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const values: string[] = [];
          for (let index = 0; index < result.snapshotLength; index += 1) {
            const node = result.snapshotItem(index);
            const value = node?.nodeType === Node.ATTRIBUTE_NODE ? node.nodeValue : node?.textContent;
            if (value?.trim()) values.push(value.trim());
          }
          if (values.length) return values;
          const scalar = xml.evaluate(expression, xml.documentElement, resolver, XPathResult.STRING_TYPE, null).stringValue;
          return scalar.trim() ? [scalar.trim()] : [];
        } catch {
          // A malformed or unmatched template XPath must never leak into the rendered record.
          return [];
        }
      };
      const sanitize = (root: Element) => {
        root.querySelectorAll("script, iframe, object, embed, form, base, link, style, meta[http-equiv]").forEach((element) => element.remove());
        for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
          for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            if (/^on/i.test(name) || name === "srcdoc") element.removeAttribute(attribute.name);
            else if (["href", "src", "action", "formaction", "xlink:href"].includes(name) && /^\s*javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
          }
        }
      };
      const setBoundValue = (element: Element, values: string[]) => {
        let value = values.join(", ");
        // Render bookmark creation timestamps as a readable local date/time.
        if (element.getAttribute("mui:data") === "http://purl.org/dc/terms/created" && values[0]) {
          const parsedDate = new Date(values[0]);
          if (!Number.isNaN(parsedDate.getTime())) {
            value = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsedDate);
          }
        }
        const tagName = element.tagName.toLowerCase();
        if (tagName === "input") element.setAttribute("value", value);
        else if (tagName === "a" && element.hasAttribute("mui:data")) {
          const safeUrl = values[0] ?? "";
          if (/^(https?:\/\/|\/(?!\/)|\.{1,2}\/|\?|#)/i.test(safeUrl)) {
            element.setAttribute("href", safeUrl);
            element.setAttribute("target", element.id === "bookmark-title-link" ? "_self" : "_blank");
            element.setAttribute("rel", "noopener noreferrer");
          } else element.removeAttribute("href");
          element.textContent = value;
        } else if (element.getAttribute("mui:data") === "maestro:bookmark-tags") {
          element.replaceChildren(...values.map((tag) => {
            const badge = document.createElement("span");
            badge.className = "inline-flex items-center rounded-full border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground";
            badge.textContent = tag;
            return badge;
          }));
        } else element.textContent = value;
      };
      const bindingExpression = (binding: string): string => {
        if (binding.startsWith("xpath:")) return binding.slice(6).trim();
        // Backward compatibility for existing templates that still bind by predicate IRI.
        const escaped = binding.replace(/&/g, "&amp;").replace(/'/g, "&apos;");
        // Match the predicate wherever it appears in a DESCRIBE row and read the row's final column as its object.
      // This avoids assuming that every FCT response shape places predicate/object in columns 2 and 3.
      return `/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='${escaped}']]/fct:column[last()]`;
      };
      const bindValues = (root: Element, xml: XMLDocument) => {
        for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
          const binding = element.getAttribute("mui:data");
          if (binding) setBoundValue(element, xpathValues(xml, bindingExpression(binding)));
          const hrefBinding = element.getAttribute("mui:href");
          if (hrefBinding) {
            const href = xpathValues(xml, bindingExpression(hrefBinding))[0] ?? "";
            element.removeAttribute("mui:href");
            if (/^(https?:\/\/|\/(?!\/)|\.{1,2}\/|\?|#)/i.test(href)) {
              element.setAttribute("href", href);
              element.setAttribute("target", element.id === "bookmark-title-link" ? "_self" : "_blank");
              element.setAttribute("rel", "noopener noreferrer");
            } else {
              element.setAttribute("href", "");
            }
          }
        }
      };

      // Templates may declare controls with mui:parent="<id>". Remove those controls
      // from the record body and render them into the matching application button bar.
      const templateButtonsByParent: Record<string, string[]> = {};
      for (const button of Array.from(document.body.querySelectorAll("[mui\\:parent]"))) {
        const parentId = (button.getAttribute("mui:parent") ?? "").trim();
        button.removeAttribute("mui:parent");
        if (!parentId) throw new Error("A template control with mui:parent must name its target element id.");
        if (parentId === "record_title_icon" && (button.localName !== "svg" || button.namespaceURI !== "http://www.w3.org/2000/svg")) {
          throw new Error("The Record title icon slot only accepts SVG artwork.");
        }
        sanitize(button);
        (templateButtonsByParent[parentId] ??= []).push(button.outerHTML);
        button.remove();
      }

      const queryComponents = Array.from(document.body.querySelectorAll("[mui\\:query]"))
        .filter((element) => !element.closest("[data-maestro-query-definitions]"));
      const elementDepth = (element: Element) => { let depth = 0; for (let parent = element.parentElement; parent; parent = parent.parentElement) depth += 1; return depth; };
      queryComponents.sort((left, right) => elementDepth(right) - elementDepth(left));
      let queryInstanceCounter = 0;
      const makeInstanceIdsUnique = (root: Element) => {
        const elements = [root, ...Array.from(root.querySelectorAll("*"))];
        const replacements = new Map<string, string>();
        for (const element of elements) {
          const id = element.getAttribute("id");
          if (!id) continue;
          const uniqueId = `${id}--maestro-instance-${++queryInstanceCounter}`;
          replacements.set(id, uniqueId);
          element.setAttribute("id", uniqueId);
        }
        for (const element of elements) {
          for (const attributeName of ["for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "headers", "list", "form"]) {
            const value = element.getAttribute(attributeName);
            if (!value) continue;
            const rewritten = value.split(/\s+/).map((id) => replacements.get(id) ?? id).join(" ");
            element.setAttribute(attributeName, rewritten);
          }
          const href = element.getAttribute("href");
          if (href?.startsWith("#") && replacements.has(href.slice(1))) element.setAttribute("href", `#${replacements.get(href.slice(1))}`);
        }
      };
      for (const component of queryComponents) {
        const queryId = component.getAttribute("mui:query") ?? "";
        const queryDefinition = queryDefinitions.get(queryId);
        if (!queryDefinition) throw new Error(`Template component references missing query id \"${queryId}\".`);
        const queryXml = queryDefinition.outerHTML;
        if (queryXml.length > 100000 || !/^\s*<query\b/i.test(queryXml) || !/openlinksw\.com\/services\/facets\/1\.0/.test(queryXml)) {
          throw new Error(`Embedded query \"${queryId}\" is not a valid bounded Maestro FCT query.`);
        }
        const queryResponse = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          signal: controller.signal, headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("record-template-query", "RecordTemplateQuery") },
          body: queryXml,
        });
        const queryData = await readFctResponse(queryResponse);
        if (!isCurrentRequest()) return null;
        const results = queryData.results.slice(0, 100);
        const replacements: Element[] = [];
        for (const result of results) {
          if (!result.uri || result.termType !== "uri") continue;
          const clone = component.cloneNode(true) as Element;
          clone.removeAttribute("mui:query");
          clone.setAttribute("data-result-uri", result.uri);
          clone.setAttribute("data-maestro-query-instance", "true");
          makeInstanceIdsUnique(clone);
          // The removed per-resource DESCRIBE helper is not available here.
          // Bind from the already loaded Record snapshot instead.
          bindValues(clone, sourceXml);
          sanitize(clone);
          replacements.push(clone);
        }
        if (replacements.length) component.replaceWith(...replacements);
        else component.replaceWith(document.createTextNode(""));
      }

      // Evaluate XPath bindings against the actual fct:facets XML returned by DESCRIBE.
      const currentDocument = sourceXml;
      // Run the exact saved FCT query with a five-row window, then clone that XML
      // and change only the view type to count so the count uses identical filters.
      const historyQueryXml = xpathValues(currentDocument, "/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#historyQueryXML']]/fct:column[last()]" )[0];
      const historyCountElement = document.body.querySelector("[mui\\:history-query-count]");
      const historyResultsElement = document.body.querySelector("[mui\\:history-query-results]");
      if ((historyCountElement || historyResultsElement) && historyQueryXml && /^\s*(?:<\?xml[^>]*>\s*)?<query\b/i.test(historyQueryXml)) {
        const savedQueryDocument = new DOMParser().parseFromString(historyQueryXml, "application/xml");
        if (savedQueryDocument.querySelector("parsererror")) throw new Error("The Bookmark's saved FCT query XML is malformed.");
        // addr is authoritative: its first @ separates graph from graph
        // server, and any later @ belongs to the graph-server portion.
        const savedQueryRoot = savedQueryDocument.documentElement;
        const existingAddress = savedQueryRoot.getAttribute("addr") ?? "";
        const addressDelimiter = existingAddress.indexOf("@");
        const endpointHint = addressDelimiter >= 0 ? existingAddress.slice(addressDelimiter + 1).trim() : "";
        const savedEndpoint = endpointHint
          ? fctEndpoints.find((endpoint) => endpoint.id === endpointHint || endpoint.url === endpointHint || endpoint.label === endpointHint)
          : fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId);
        if (!savedEndpoint) throw new Error("The Bookmark's query addr does not identify a configured graph server.");
        const graph = addressDelimiter >= 0
          ? existingAddress.slice(0, addressDelimiter).trim()
          : (savedQueryRoot.getAttribute("graph")?.trim() ?? "");
        savedQueryRoot.setAttribute("addr", `${graph}@${savedEndpoint.url}`);
        savedQueryRoot.removeAttribute("graph");
        //if (savedEndpoint.id !== selectedEndpointId) await synchronizeFctEndpointSelection(savedEndpoint.id);
		
		
        const savedView = Array.from(savedQueryDocument.getElementsByTagName("*")).find((element) => element.localName === "view");
        if (!savedView) throw new Error("The Bookmark's saved FCT query has no view element.");
        savedView.setAttribute("limit", "5");
        savedView.setAttribute("offset", "0");
        const boundedQuery = new XMLSerializer().serializeToString(savedQueryDocument);
        const countQueryDocument = savedQueryDocument.cloneNode(true) as XMLDocument;
        const countView = Array.from(countQueryDocument.getElementsByTagName("*")).find((element) => element.localName === "view");
        if (!countView) throw new Error("Could not clone the saved FCT query's view for counting.");
        // The SPARQL translator does not support view type="count". Count via a
        // text-view clone with a larger bounded window instead, while preserving
        // the exact saved query filters and bindings.
        countView.setAttribute("type", FCT_VIEW_TYPES.TEXT);
        countView.setAttribute("limit", "100000");
        countView.setAttribute("offset", "0");
        const countQuery = new XMLSerializer().serializeToString(countQueryDocument);
        const [queryResponse, countResponse] = await Promise.all([
          cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("bookmark-history-query-results", "BookmarkHistoryQueryResults") }, body: boundedQuery }),
          cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("bookmark-history-query-count", "BookmarkHistoryQueryCount") }, body: countQuery }),
        ]);
        const [queryResponseText, countResponseText] = await Promise.all([queryResponse.clone().text(), countResponse.clone().text()]);
        if (!isCurrentRequest()) return null;
        const queryData = await readFctResponse(queryResponse);
        // A count failure must not discard successful result rows. The fallback
        // count is the number returned by the expanded text query (capped at 100k).
        let countData: ParsedFctResponse | null = null;
        try { countData = await readFctResponse(countResponse); } catch { /* show bounded results even if counting fails */ }
        const sparqlMatch = queryResponseText.match(/<fct:sparql>([\s\S]*?)<\/fct:sparql>/i);
        setBookmarkQueryDebug({ xml: boundedQuery, sparql: sparqlMatch ? sparqlMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&") : "SPARQL was not included in the FCT response.", response: queryResponseText, countResponse: countResponseText });
        if (historyCountElement) {
          historyCountElement.removeAttribute("mui:history-query-count");
          const total = countData?.results.length;
          historyCountElement.textContent = typeof total === "number"
            ? `${shortenCount(total)} matching result${total === 1 ? "" : "s"}${total >= 100000 ? " (count capped at 100k)" : ""}; showing up to five.`
            : `${shortenCount(queryData.results.length)} result${queryData.results.length === 1 ? "" : "s"} returned; showing up to five (count unavailable).`;
        }
        if (historyResultsElement) {
          historyResultsElement.removeAttribute("mui:history-query-results");
          const itemTemplate = historyResultsElement.querySelector("li");
          historyResultsElement.replaceChildren();
          for (const result of queryData.results.slice(0, 5)) {
            const item = itemTemplate?.cloneNode(true) as HTMLLIElement | undefined ?? document.createElement("li");
            item.textContent = result.title || result.uri;
            item.removeAttribute("id");
            if (result.uri && result.termType === "uri") {
              const link = document.createElement("a");
              link.href = result.uri; link.target = "_blank"; link.rel = "noopener noreferrer";
              link.textContent = result.title || result.uri; link.className = "underline underline-offset-2";
              item.replaceChildren(link);
            }
            historyResultsElement.appendChild(item);
          }
          if (!queryData.results.length) {
            const item = document.createElement("li"); item.textContent = "No results returned.";
            historyResultsElement.appendChild(item);
          }
        }
      } else {
        if (historyCountElement) historyCountElement.textContent = historyQueryXml ? "The saved query could not be run." : "No saved FCT query is stored on this Bookmark.";
        if (historyResultsElement) historyResultsElement.replaceChildren();
      }
      for (const element of Array.from(document.body.querySelectorAll("[mui\\:data], [mui\\:href]"))) {
        if (element.closest("[data-maestro-query-instance]")) continue;
        const binding = element.getAttribute("mui:data");
        if (binding === "maestro:bookmark-tags") {
          const tagValues = [
            ...xpathValues(currentDocument, "/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='http://purl.org/dc/terms/subject']]/fct:column[last()]"),
            ...xpathValues(currentDocument, "/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='http://rdfs.org/scot/ns#has_tag']]/fct:column[last()]"),
            ...xpathValues(currentDocument, "/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='http://www.w3.org/2004/02/skos/core#prefLabel']]/fct:column[last()]"),
          ].filter((value) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value));
          setBoundValue(element, [...new Set(tagValues)]);
        } else if (binding) setBoundValue(element, xpathValues(currentDocument, bindingExpression(binding)));
        const hrefBinding = element.getAttribute("mui:href");
        if (hrefBinding) {
          const href = xpathValues(currentDocument, bindingExpression(hrefBinding))[0] ?? "";
          element.removeAttribute("mui:href");
          if (/^(https?:\/\/|\/(?!\/)|\.{1,2}\/|\?|#)/i.test(href)) {
            element.setAttribute("href", href);
            element.setAttribute("target", element.id === "bookmark-title-link" ? "_self" : "_blank");
            element.setAttribute("rel", "noopener noreferrer");
          } else {
            // Do not expose unresolved XPath expressions or retain a stale destination.
            element.setAttribute("href", "");
          }
        }
      }
      // XSLT may emit declarative template calls. Interpret them against query
      // clones, not the authoritative live tree. A live-scope call is queued
      // until the full stylesheet and all sandbox queries have completed.
      // Grammar:
      //   <mui:template-call scope="sandbox" action="fctQueryTreeApi.setSearchText(undefined, 'cat')"
      //                      execute="true" target="template-results" />
      //   <mui:template-call scope="live" action="fctQueryTreeApi.addClass(undefined, null, 'http://example.org/Cat')" />
      // Optional direct <query> children of a sandbox call may be emitted by
      // xsl:copy-of from /mctx:context/mctx:live-query/fct:query.
      const templateCalls = Array.from(document.body.querySelectorAll("mui\\:template-call"));
      if (templateCalls.length > 64) throw new Error("The XSLT template exceeds the limit of 64 query calls.");
      const templateApi = workbenchQueryTreeApi as unknown as Record<string, (...args: unknown[]) => unknown>;
      let sandboxTree = workbenchQueryTreeApi.getTree(queryTree);
      let queuedLiveTree = workbenchQueryTreeApi.getTree(queryTree);
      const liveSnapshots: string[] = [];
      let executedSandboxQueries = 0;
      for (const call of templateCalls) {
        const scope = (call.getAttribute("scope") ?? "sandbox").trim();
        if (scope !== "sandbox" && scope !== "live") throw new Error("XSLT template call scope must be sandbox or live.");
        const action = (call.getAttribute("action") ?? "").trim();
        const explicitQuery = call.querySelector("query");
        if (scope === "live" && explicitQuery) throw new Error("Live template calls must use the approved query-edit API, not raw query XML.");
        if (action) {
          const parsedAction = parsePolicyQueryAction(action, call, selectedUri);
          const startingTree = scope === "live" ? queuedLiveTree : sandboxTree;
          const result = templateApi[parsedAction.method](startingTree, ...parsedAction.args.slice(1));
          if (!result || typeof result !== "object") throw new Error(`Template operation ${parsedAction.method} did not produce a query tree.`);
          const nextTree = workbenchQueryTreeApi.getTree(result as typeof startingTree);
          if (scope === "live") {
            queuedLiveTree = nextTree;
            liveSnapshots.push(serializeFctQuery(nextTree));
          } else sandboxTree = nextTree;
        } else if (!explicitQuery) {
          throw new Error("An XSLT template call must have an approved action or a cloned query.");
        }

        if (call.getAttribute("execute") === "true") {
          if (scope !== "sandbox") throw new Error("Only sandboxed template queries may execute before the live queue is flushed.");
          if (++executedSandboxQueries > 4) throw new Error("The XSLT template exceeds four sandbox query executions.");
          let queryXml = explicitQuery ? explicitQuery.outerHTML : serializeFctQuery(sandboxTree);
          const isolatedQuery = new DOMParser().parseFromString(queryXml, "application/xml");
          if (isolatedQuery.querySelector("parsererror") || isolatedQuery.documentElement.localName !== "query") {
            throw new Error("Sandbox template query is not a valid FCT XML query.");
          }
          const address = isolatedQuery.documentElement.getAttribute("addr") ?? "";
          const currentAddress = queryTree.attributes.addr ?? "";
          // Templates may change filters and view settings, but must not
          // silently redirect credentials/requests to a different graph server.
          if (!address || address.slice(address.indexOf("@") + 1) !== currentAddress.slice(currentAddress.indexOf("@") + 1)) {
            throw new Error("A sandbox query must use the live query's graph server.");
          }
          for (const view of Array.from(isolatedQuery.getElementsByTagName("*")).filter((element) => element.localName === "view")) {
            const limit = Number(view.getAttribute("limit") ?? 30);
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) view.setAttribute("limit", "100");
            view.setAttribute("offset", "0");
          }
          queryXml = new XMLSerializer().serializeToString(isolatedQuery);
          if (queryXml.length > 100000) throw new Error("Sandbox FCT query is too large.");
          if (!preview) {
            const response = await cachedFetchFct("/proxy/api/fct", {
              method: "POST", cache: "no-store",
              signal: controller.signal, headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("record-xslt-sandbox", "RecordXsltSandbox") },
              body: queryXml,
            });
            const results = (await readFctResponse(response)).results.slice(0, 100);
            if (!isCurrentRequest()) return null;
            const targetId = (call.getAttribute("target") ?? "").trim();
            const target = targetId ? document.getElementById(targetId) : null;
            if (target) {
              // Preserve the first child as a styled result prototype when present.
              const prototype = target.firstElementChild?.cloneNode(true) as Element | undefined;
              target.replaceChildren();
              for (const result of results) {
                const child = prototype?.cloneNode(true) as Element | undefined ?? document.createElement("div");
                child.removeAttribute("id");
                child.textContent = result.title || result.uri;
                target.appendChild(child);
              }
            }
          }
        }
        call.remove();
      }

      if (!preview && !isCurrentRequest()) return null;
      if (!preview && liveSnapshots.length) {
        // Save every intermediate History snapshot in queue order, but do not
        // publish any intermediate tree. Only the final replaceTree notifies
        // Maestro's FCT subscribers and causes a query to execute.
        const finalXml = liveSnapshots[liveSnapshots.length - 1];
        if (authSession) {
          templateHistoryFlushRef.current = true;
          try {
            await historyWriteQueueRef.current;
            let previousXml = serializeFctQuery(queryTree);
            for (const snapshot of liveSnapshots) {
              if (snapshot === previousXml) continue;
              const url = new URL(window.location.href);
              url.searchParams.set("q", snapshot);
              await writeHistoryVisit(snapshot, url.toString(), deriveHistoryAction(previousXml, snapshot));
              previousXml = snapshot;
            }
            historyVisitQueryRef.current = finalXml;
          } catch (cause) {
            console.warn("Could not persist every queued template edit to History", cause);
            // Let Maestro's ordinary History effect record the final query if
            // an intermediate History write fails.
            historyVisitQueryRef.current = "";
          } finally {
            templateHistoryFlushRef.current = false;
          }
        }
        replaceQueryTree(queuedLiveTree);
      }

      sanitize(document.body);
      // Embedded XML query definitions remain present with their IDs in the hidden template area.
      document.querySelectorAll("query").forEach((element) => { element.setAttribute("hidden", ""); element.setAttribute("aria-hidden", "true"); });
      if (preview) {
        const previewRoot = document.body.firstElementChild;
        if (previewRoot) {
          previewRoot.querySelectorAll("[id]").forEach((element) => element.setAttribute("id", `preview-${templateUri.replace(/[^a-z0-9]/gi, "-")}-${element.id}`));
          if (previewRoot.id) previewRoot.id = `preview-${templateUri.replace(/[^a-z0-9]/gi, "-")}-${previewRoot.id}`;
        }
        return document.body.innerHTML;
      }
      if (!isCurrentRequest()) return null;
      setFormattedRecordButtonsHtml(Object.fromEntries(Object.entries(templateButtonsByParent).map(([parentId, buttons]) => [parentId, buttons.join("")])));
      const initialRecordHtml = document.body.innerHTML;
      setFormattedRecordHtml(initialRecordHtml);
      setFormattedRecordKey(requestKey);
      setRecordControlsOpen(false);
      return initialRecordHtml;
    } catch (error) {
      if (controller.signal.aborted || !isCurrentRequest() ||
          (error instanceof Error && error.name === "AbortError")) return null;
      const detail = error instanceof Error ? error.message : "Unknown error";
      const message = `${formatStage} failed: ${detail}`;
      if (!preview && !enrichLinkedResources) {
        setRecordFormatError(message);
        setFormattedRecordHtml("");
        setFormattedRecordKey("");
        setFormattedRecordButtonsHtml({});
      }
      if (enrichLinkedResources) {
        console.warn("Optional stylesheet enrichment failed; initial formatted Record remains available.", message);
      }
      return null;
    } finally {
      recordFormatterAbortControllersRef.current.delete(controller);
    }
  }

  // Formatters may request a second, bounded enrichment pass through their
  // graph-declared XSLT query pivot. This pipeline is independent of domain.
  
  useEffect(() => {
    if (!formatterHasEnrichment || !currentFormattedRecordHtml ||
        !recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey ||
        !selectedUri || isDescribing) return;
    const key = currentRecordFormatKey;
    if (attemptedFormatterEnrichmentRef.current === key) return;
    attemptedFormatterEnrichmentRef.current = key;
    void formatSelectedRecord(undefined, false, true);
  }, [formatterHasEnrichment, currentFormattedRecordHtml, currentRecordFormatKey, recordDescriptionSnapshot, currentRecordDescriptionKey, selectedUri, isDescribing]);

  useEffect(() => {
    if (!recordFormatMenuOpen || !recordPolicy || !selectedUri || recordPolicyCheckedUri !== selectedUri || recordPolicies.flatMap((policy) => policy.templates).length < 1) { setRecordFormatPreviews({}); return; }
    let cancelled = false;
    void (async () => {
      const previews: Record<string, string> = {};
      for (const template of recordPolicy.templates) {
        const html = await formatSelectedRecord(template.uri, true);
        if (html) previews[template.uri] = html;
        if (cancelled) return;
      }
      if (!cancelled) setRecordFormatPreviews(previews);
    })();
    return () => { cancelled = true; };
  }, [recordFormatMenuOpen, recordPolicy?.uri, recordPolicies.map((policy) => `${policy.uri}:${policy.templates.map((template) => template.uri).join(",")}`).join("|"), selectedUri, personalSparqlEndpoint, recordPolicyCheckedUri]);

  useEffect(() => {
    if (!recordFormatPreferenceLoaded || !recordFormatEnabled || !recordPolicy || !selectedUri || isDescribing || isLoadingRecordPolicy || recordPolicyCheckedUri !== selectedUri || currentFormattedRecordHtml || !recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey || describedRecordUri !== selectedUri) return;
    const requestKey = currentRecordFormatKey;
    if (activeFormatterRequestRef.current === requestKey) return;
    activeFormatterRequestRef.current = requestKey;
    void formatSelectedRecord().finally(() => {
      if (activeFormatterRequestRef.current === requestKey) activeFormatterRequestRef.current = "";
    });
  }, [recordFormatPreferenceLoaded, recordFormatEnabled, recordPolicy?.uri, selectedRecordTemplateUri, selectedUri, isDescribing, isLoadingRecordPolicy, recordPolicyCheckedUri, currentFormattedRecordHtml, recordDescriptionSnapshot, currentRecordDescriptionKey, describedRecordUri]);

  // Read service metadata from the SHACL policy graph. The formatter never
  // contains a list of APIs, and there are no service-specific branches here.
  useEffect(() => {
    const key = `${selectedUri}\u0000${currentRecordDescriptionKey}\u0000${selectedRecordTemplateUri}`;
    activeServiceRecordRef.current = key;
    setRecordServices([]);
    setRecordServiceTab("");
    setRecordServiceArguments({});
    setRecordServiceResults({});
    if (!personalStoreReady || !selectedUri || describedRecordUri !== selectedUri || isDescribing ||
        recordDescriptionSnapshot?.key !== currentRecordDescriptionKey) return;
    const recordTypes = Array.from(new Set(describedRecord.filter((item) =>
      item.direction === "property" && item.property === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
      /^https?:\/\//i.test(item.value)).map((item) => item.value)));
    // A class constrained by the authoritative query remains valid scope
    // context if the Record SELECT was partial and omitted its rdf:type row.
    const scopeTypes = getClassesAtNode(getPropertyPath().at(-1)?.id ?? null);
    const types = Array.from(new Set([...recordTypes, ...scopeTypes]));
    if (!types.length) return;
    const controller = new AbortController();
    void maestroQueryFetch("/proxy/api/services", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-service-discover", "RecordServices") },
      body: JSON.stringify({ action: "discover", recordTypes: types }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { services?: RecordService[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `Service discovery failed (${response.status}).`);
      if (!controller.signal.aborted && activeServiceRecordRef.current === key) setRecordServices(payload.services ?? []);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) console.warn("Record service discovery unavailable:", error);
    });
    return () => controller.abort();
  }, [selectedUri, currentRecordDescriptionKey, selectedRecordTemplateUri, describedRecordUri, isDescribing, personalStoreReady, recordDescriptionSnapshot?.key]);

  // The stylesheet opts a text field into the generic expandable-text behavior.
  // Maestro never needs to know its RDF domain or its template-specific element IDs.
  useEffect(() => {
    const root = formattedRecordContainerRef.current;
    if (!root || !currentFormattedRecordHtml) return;
    const summaries = Array.from(root.querySelectorAll<HTMLElement>("[data-maestro-expandable]"));
    if (!summaries.length) return;
    const cleanups: Array<() => void> = [];

    for (const summary of summaries) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mt-1 inline-flex min-h-7 items-center text-xs font-medium text-current underline underline-offset-2 opacity-75 transition-opacity hover:opacity-100 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
      toggle.textContent = "more…";
      toggle.setAttribute("aria-controls", summary.id);
      toggle.setAttribute("aria-expanded", "false");
      toggle.hidden = true;
      summary.insertAdjacentElement("afterend", toggle);
      const oldOverflow = summary.style.overflow;
      const oldMaxHeight = summary.style.maxHeight;
      const oldMaskImage = summary.style.maskImage;
      const oldTransition = summary.style.transition;
      let expanded = false;
      let wasLong = false;
      const sync = () => {
        const styles = window.getComputedStyle(summary);
        const fontSize = Number.parseFloat(styles.fontSize) || 14;
        const lineHeight = styles.lineHeight === "normal"
          ? fontSize * 1.5
          : Number.parseFloat(styles.lineHeight) || fontSize * 1.5;
        const collapsedHeight = Math.ceil(lineHeight * 8);
        const naturalHeight = summary.scrollHeight;
        wasLong = naturalHeight > collapsedHeight + 2;
        toggle.hidden = !wasLong;
        if (!wasLong) {
          summary.style.maxHeight = "";
          summary.style.maskImage = "";
          summary.style.overflow = "";
          return;
        }
        summary.style.overflow = "hidden";
        summary.style.maxHeight = `${expanded ? naturalHeight : collapsedHeight}px`;
        summary.style.maskImage = expanded ? "none" : "linear-gradient(to bottom, black 52%, transparent 100%)";
        toggle.textContent = expanded ? "less…" : "more…";
        toggle.setAttribute("aria-expanded", String(expanded));
      };
      summary.style.transition = "max-height 250ms ease, mask-image 250ms ease";
      const click = () => { expanded = !expanded; sync(); };
      toggle.addEventListener("click", click);
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
      observer?.observe(root);
      sync();
      cleanups.push(() => {
        observer?.disconnect();
        toggle.removeEventListener("click", click);
        toggle.remove();
        summary.style.overflow = oldOverflow;
        summary.style.maxHeight = oldMaxHeight;
        summary.style.maskImage = oldMaskImage;
        summary.style.transition = oldTransition;
      });
    }
    return () => { for (const cleanup of cleanups) cleanup(); };
  }, [currentFormattedRecordHtml]);

  // XSLT stylesheets may declare a service host using generic data attributes.
  // Portals preserve React event handling without rewriting template content.
  useEffect(() => {
    const root = formattedRecordContainerRef.current;
    const tabs = root?.querySelector<HTMLElement>("[data-maestro-services-tabs]");
    const host = root?.querySelector<HTMLElement>("[data-maestro-services-host]");
    if (!root || !tabs || !host || !currentFormattedRecordHtml) { setRecordServiceDom(null); return; }
    setRecordServiceDom((previous) => previous?.tabs === tabs && previous?.host === host ? previous : {tabs,host});
    const props = root.querySelector<HTMLElement>("[data-maestro-services-properties]");
    const propsButton = root.querySelector<HTMLButtonElement>("[data-maestro-services-properties-tab]");
    if (props) props.hidden = Boolean(recordServiceTab);
    if (propsButton) {
      propsButton.setAttribute("aria-selected", String(!recordServiceTab));
      propsButton.classList.toggle("bg-accent", !recordServiceTab);
      propsButton.onclick = () => setRecordServiceTab("");
    }
    return () => { if (propsButton) propsButton.onclick = null; };
  }, [currentFormattedRecordHtml, recordServiceTab]);

  async function invokeRecordService(service: RecordService, operation: RecordService["operations"][number]) {
    const snapshot = recordDescriptionSnapshot;
    if (!snapshot || snapshot.uri !== selectedUri || snapshot.key !== currentRecordDescriptionKey ||
        describedRecordUri !== selectedUri) return;
    const key = `${selectedUri}\u0000${currentRecordDescriptionKey}\u0000${selectedRecordTemplateUri}`;
    const argumentsForService = recordServiceArguments[service.uri] ?? {};
    if (operation.requires.some((name) => !argumentsForService[name])) return;
    setRecordServiceResults((previous) => ({...previous,[service.uri]:{html:"",error:"",loading:true,name:operation.label}}));
    try {
      const response = await maestroQueryFetch("/proxy/api/services", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-service-execute", "RecordServiceInvocation") },
        body: JSON.stringify({action:"invoke", service:service.uri, operation:operation.uri,
          recordUri:selectedUri, queryXml, fctXml:snapshot.xml, arguments:argumentsForService}),
      });
      const result = await response.json() as {html?:string; values?:Record<string,string>; error?:string};
      if (!response.ok) throw new Error(result.error || `Service failed (${response.status}).`);
      if (activeServiceRecordRef.current !== key) return;
      if (result.values) setRecordServiceArguments((previous) => ({...previous,
        [service.uri]:{...previous[service.uri],...result.values}}));
      // Sanitize graph-authored response HTML before it reaches React's
      // dangerouslySetInnerHTML: no script, embedded resources, handlers or URLs.
      const doc = new DOMParser().parseFromString(result.html ?? "", "text/html");
      const allowed = new Set(["SECTION","DIV","SPAN","P","H3","H4","TABLE","THEAD","TBODY","TR","TH","TD","UL","LI","OL","DETAILS","SUMMARY","STRONG","EM","PRE","CODE","BR"]);
      const clean = (node: Node): void => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType !== Node.ELEMENT_NODE) continue;
          const element = child as HTMLElement;
          if (!allowed.has(element.tagName)) { element.replaceWith(...Array.from(element.childNodes).filter((item) => item.nodeType === Node.TEXT_NODE)); continue; }
          for (const attr of Array.from(element.attributes)) if (attr.name !== "class") element.removeAttribute(attr.name);
          clean(element);
        }
      };
      clean(doc.body);
      setRecordServiceResults((previous) => ({...previous,[service.uri]:{html:doc.body.innerHTML,error:"",loading:false,name:operation.label}}));
    } catch (error) {
      if (activeServiceRecordRef.current === key) setRecordServiceResults((previous) => ({...previous,
        [service.uri]:{html:"",error:error instanceof Error?error.message:"Service failed.",loading:false,name:operation.label}}));
    }
  }

  // Template actions are parsed as a restricted API-call grammar, then dispatched through Maestro's existing query-update API.
  useEffect(() => {
    const root = formattedRecordContainerRef.current;
    if (!root || !formattedRecordHtml) return;
    const handleTemplateAction = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Providers may request that the user bookmark the calling FCT query.
      // This is a presentation signal only: it neither saves the query nor
      // changes policy state, and is available to any trusted XSLT provider.
      const bookmarkRequest = target.closest('[mui\\:request="bookmark-query"]');
      if (bookmarkRequest) {
        event.preventDefault();
        window.dispatchEvent(new Event("maestro:bookmark-query-request"));
        return;
      }
      const carouselButton = target.closest("[data-maestro-carousel]");
      if (carouselButton) {
        event.preventDefault();
        const carousel = carouselButton.closest("#record-carousel");
        const track = carousel?.querySelector<HTMLElement>("#record-carousel-track");
        if (track) {
          const direction = carouselButton.getAttribute("data-maestro-carousel") === "previous" ? -1 : 1;
          track.scrollBy({ left: track.clientWidth * direction, behavior: "smooth" });
        }
        return;
      }
      // Record-formatter chips can request the same property navigation as
      // result-card badges, with an explicit lexical contains comparison.
      const propertyChip = target.closest("[data-maestro-filter-property]");
      if (propertyChip) {
        event.preventDefault();
        const predicate = propertyChip.getAttribute("data-maestro-filter-property") ?? "";
        const value = propertyChip.getAttribute("data-maestro-filter-value") ?? "";
        const operator = propertyChip.getAttribute("data-maestro-filter-op") === "contains" ? "contains" : "=";
        if (/^https?:\/\//.test(predicate) && value.trim()) {
          navigateResultBadge(predicate, { value, type: "literal" }, "forward", false, operator);
        }
        return;
      }
      // Explicit formatter actions always win over the default hyperdata link.
      // In particular: Bookmark's saved-query link, Movie's Year chip, custom
      // mui:action calls, carousel controls, and ordinary external links that
      // do not represent a value in this Record.
      if (target.closest("#bookmark-title-link, [mui\\:href], [data-maestro-filter-property]")) return;

      // A formatted Record has the same semantic default as a Results badge:
      // navigate to the things sharing this *predicate/value*, not to the
      // object URI itself. Derive the RDF term from the authoritative Record
      // SELECT, not from the display label, so datatypes/languages survive.
      const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
      const explicitAction = target.closest("[mui\\:action]");
      const link = explicitAction ? null : target.closest<HTMLAnchorElement>("a[href]");
      const recordUriLink = target.closest<HTMLElement>("[data-maestro-record-uri]");
      const linkedUri = recordUriLink?.getAttribute("data-maestro-record-uri")?.trim() ?? "";
      const href = link?.getAttribute("href") ?? "";
      const hrefIsResource = /^https?:\/\//i.test(href);
      // Do not hijack external actions (shopping, source links, share links).
      if (link && !recordUriLink && href !== "#" && !hrefIsResource) return;

      const candidates = describedRecord.filter((row) => row.termType !== "bnode" &&
        (row.direction === "property" || row.direction === "property-of"));
      const addr = queryTree.attributes.addr || `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}`;
      const matchesFor = (text: string, explicitUri: string) => candidates.filter((row) => {
        if (explicitUri) return row.termType === "uri" && row.value === explicitUri;
        if (normalize(row.value) === text) return true;
        if (row.termType !== "uri") return false;
        const label = recordUriLabelCacheRef.current.get(`${addr}\u0000${row.value}`);
        return (label && normalize(label) === text) ||
          normalize((row.value.split(/[\/#]/).pop() ?? "").replace(/_/g, " ")) === text;
      });
      // Start with the smallest visible value element. Never treat a whole
      // paragraph/table/section as a value merely because it contains one.
      let clickedValue: Element | null = explicitAction ? null : recordUriLink || link || target;
      let matches: typeof candidates = [];
      while (clickedValue && clickedValue !== root) {
        const name = clickedValue.tagName.toLowerCase();
        // Leaf divs sometimes contain a literal directly; container divs are
        // not values and must never become click targets wholesale.
        if (["section", "article", "table", "tbody", "tr", "dl"].includes(name) ||
            (name === "div" && clickedValue.children.length > 0)) break;
        const display = normalize(clickedValue.textContent ?? "");
        const valueUri = clickedValue === recordUriLink ? linkedUri :
          clickedValue === link && hrefIsResource ? href : "";
        if (display || valueUri) matches = matchesFor(display, valueUri);
        if (matches.length) break;
        clickedValue = clickedValue.parentElement;
      }
      // When the same lexical value occurs under multiple predicates, use
      // the nearest property label where possible. Never guess an RDF relation.
      if (matches.length > 1) {
        const row = target.closest("dd, td, li");
        const labelText = normalize(row?.previousElementSibling?.textContent ??
          row?.parentElement?.querySelector("dt, th")?.textContent ?? "").toLowerCase();
        if (labelText) {
          const compact = (iri: string) => iri.split(/[\/#]/).pop()?.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase() ?? "";
          const narrowed = matches.filter((candidate) =>
            labelText === normalize(toLabel(candidate.property)).toLowerCase() ||
            labelText === compact(candidate.property));
          if (narrowed.length) matches = narrowed;
        }
      }
      const unique = new Map(matches.map((row) => [
        `${row.direction}\u0000${row.property}\u0000${row.value}\u0000${row.datatype ?? ""}\u0000${row.lang ?? ""}`, row,
      ]));
      if (unique.size === 1) {
        const row = [...unique.values()][0];
        event.preventDefault();
        navigateResultBadge(row.property, {
          value: row.value, type: row.termType,
          ...(row.datatype ? { datatype: row.datatype } : {}),
          ...(row.lang ? { lang: row.lang } : {}),
        }, row.direction === "property-of" ? "reverse" : "forward",
          row.direction === "property" && row.property === RDF_TYPE_URI);
        return;
      }
      // Preserve the existing fallback for URI links not in the Record's
      // predicate/value bindings. Never replace an explicit specialized action.
      if (recordUriLink) {
        if (/^https?:\/\//i.test(linkedUri)) { event.preventDefault(); openRecordPropertyUri(linkedUri); }
        return;
      }
      const actionElement = target.closest("[mui\\:action]");
      if (!actionElement) return;
      event.preventDefault();
      const source = actionElement.getAttribute("mui:action") ?? "";
      try {
        const { method, args } = parsePolicyQueryAction(source, actionElement, selectedUri);
        const api = workbenchQueryTreeApi as unknown as Record<string, (...values: unknown[]) => unknown>;
        api[method](...args);
        setRecordFormatError("");
      } catch (error) {
        setRecordFormatError(error instanceof Error ? error.message : "The template action was rejected.");
      }
    };
    root.addEventListener("click", handleTemplateAction);
    return () => root.removeEventListener("click", handleTemplateAction);
  }, [formattedRecordHtml, selectedUri, describedRecord, selectedEndpointId, queryTree.attributes.addr,
      queryTree.attributes.graph, navigateResultBadge]);

  // The active scope is the property-path node that currently contains the
  // authoritative <view>; at the root, scope is represented by null.
// The active scope is the property-path node that currently contains the
// authoritative <view>; at the root, scope is represented by null.
const activePropertyPath = getPropertyPath();

const activeLeafId: string | null =
  activePropertyPath.length > 0
    ? activePropertyPath[activePropertyPath.length - 1].id
    : null;

  // Perspective-supplied facets belong to the context in which its RDF class
  // is declared, not wherever the user later moves the view. In particular,
  // navigating into dcterms:created must never introduce a tag requirement there.
  useEffect(() => {
    const bookmarkPerspective = selectedViewUri === "gttp://ggg.maestro.ecosys/shacl/provider/bookmarks-perspective";
    const historyPerspective = selectedViewUri === "gttp://ggg.maestro.ecosys/shacl/provider/history-perspective";
    if (!bookmarkPerspective && !historyPerspective) return;
    const bookmarkClass = "http://www.w3.org/2002/01/bookmark#Bookmark";
    const historyClass = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#QueryHistoryVisit";
    type Scope = { parentId: string | null; siblings: typeof queryTree.children; kind: "bookmark" | "history" };
    const findClassContext = (siblings: typeof queryTree.children, parentId: string | null): Scope | null => {
      // For History's perspective a bookmark is also a history visit; use the
      // property actually stored on that bookmark, dcterms:created.
      const declaredBookmark = siblings.some(node => node.name === "class" && node.attributes.iri === bookmarkClass);
      if (declaredBookmark) return { parentId, siblings, kind: "bookmark" };
      const declaredHistory = siblings.some(node => node.name === "class" && node.attributes.iri === historyClass);
      if (historyPerspective && declaredHistory) return { parentId, siblings, kind: "history" };
      for (const node of siblings) {
        if (node.name !== "property" && node.name !== "property-of") continue;
        const nested = findClassContext(node.children, node.id);
        if (nested) return nested;
      }
      return null;
    };
    const context = findClassContext(queryTree.children, null);
    if (!context || (bookmarkPerspective && context.kind !== "bookmark")) return;
    const existing = new Set(context.siblings.filter(node => node.name === "property").map(node => node.attributes.iri));
    const tagUris = [
      "http://www.w3.org/2004/02/skos/core#prefLabel",
      "http://purl.org/dc/terms/subject",
      "http://rdfs.org/scot/ns#has_tag",
    ];
    const preferredTag = bookmarkTagVocabulary === "dcterms" ? tagUris[1]
      : bookmarkTagVocabulary === "scot" ? tagUris[2] : tagUris[0];
    const required: string[] = [];
    if (bookmarkPerspective && !tagUris.some(uri => existing.has(uri))) required.push(preferredTag);
    const temporalProperty = context.kind === "bookmark"
      ? "http://purl.org/dc/terms/created"
      : "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#historyCreated";
    if (!existing.has(temporalProperty)) required.push(temporalProperty);
    if (!required.length) return;
    // Discovery or a restored selectedViewUri never authorizes query editing.
    // Verify approval on the personal graph server at the moment of execution.
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/proxy/api/perspectives", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approved", providerUri: selectedViewUri }),
        });
        const approval = await response.json() as { approved?: boolean };
        if (!response.ok || !approval.approved || controller.signal.aborted) return;
        let next = queryTree;
        for (const uri of required) {
      next = workbenchQueryTreeApi.addProperty(next, uri, context.parentId);
      // Resolve in the *same* declared class scope, not the current view scope.
      const siblingsForContext = context.parentId
        ? (function find(nodes: typeof queryTree.children): typeof queryTree.children | null {
            for (const node of nodes) {
              if (node.id === context.parentId) return node.children;
              const child = find(node.children);
              if (child) return child;
            }
            return null;
          })(next.children)
        : next.children;
      const added = siblingsForContext?.find(node => node.name === "property" && node.attributes.iri === uri);
      if (!added) continue;
      // The provider's insertion is an ordinary, authoritative relationship.
      // Its IRI may be recorded for human-readable provenance only.
      next = workbenchQueryTreeApi.setNodeAttribute(next, added.id, "src", selectedViewUri);
    }
        if (!controller.signal.aborted) replaceQueryTree(next);
      } catch { /* A failed approval check must never modify the live query. */ }
    })();
    return () => controller.abort();
  }, [selectedViewUri, queryTree, bookmarkTagVocabulary, replaceQueryTree]);

  /** Apply a SHACL-discovered personal date-range facet to the current view scope. */
  const setPersonalDateRange = useCallback((property: string, start: string, end: string) => {
    const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/;
    if ((start && !valid.test(start)) || (end && !valid.test(end)) || (start && end && start > end)) return;
    const scoped = getActiveViewPropertyFilters(queryTree).some(node => node.attributes.iri === property);
    let tree = scoped ? queryTree : workbenchQueryTreeApi.addProperty(queryTree, property, activeLeafId);
    const facet = getActiveViewPropertyFilters(tree).find(node => node.attributes.iri === property);
    if (!facet) return;
    // Applying or clearing a date range edits only its <value> constraint.
    replaceQueryTree(workbenchQueryTreeApi.setPropertyValues(tree, activeLeafId, property,
      start || end ? [{ text: "", datatype: "dateTime", attributes: {
        ...(start ? { rangeStart: start } : {}), ...(end ? { rangeEnd: end } : {}),
      } }] : []));
  }, [queryTree, activeLeafId, replaceQueryTree]);

const displayedBreadcrumbPath =
  activePropertyPath.length <= breadcrumbTrail.length &&
  activePropertyPath.every(
    (crumb, index) => crumb.id === breadcrumbTrail[index]?.id,
  )
    ? breadcrumbTrail
    : activePropertyPath;

const activeBreadcrumbIndex = activePropertyPath.length - 1;
const tutorialBreadcrumbPath = tutorialMode && facetHoverPreview?.kind === "facet" && facetHoverPreview.successorNodeId
  ? [
      ...displayedBreadcrumbPath.slice(0, activeBreadcrumbIndex + 1),
      {
        id: facetHoverPreview.successorNodeId,
        uri: facetHoverPreview.uri,
        name: facetHoverPreview.direction === "forward" ? "property" : "property-of",
      },
    ]
  : displayedBreadcrumbPath;
const tutorialBreadcrumbTargetId = tutorialMode && facetHoverPreview?.kind === "facet"
  ? facetHoverPreview.successorNodeId ?? null
  : null;
const breadcrumbPreviewPathKey = `query-root|${displayedBreadcrumbPath.map((crumb) => crumb.id).join("|")}`;
const makeBreadcrumbScopedTree = (
  targetId: string,
  // Predecessor records the badge chain has already resolved. Each is bound as a
  // <value> on its own node, so the target scope can only return values reached
  // from that exact record (R0 -p1-> R1 -p2-> R2 ...).
  pins: { nodeId: string; uri: string }[] = [],
  viewType: typeof FCT_VIEW_TYPES.TEXT | typeof FCT_VIEW_TYPES.CLASSES = FCT_VIEW_TYPES.TEXT,
): FctQueryTree | null => {
  // Metadata queries are clones of the live query. Only the active <view> is
  // moved to the target scope and normalized to one result at offset zero.
  const cloned = JSON.parse(JSON.stringify(queryTree)) as FctQueryTree;
  const existingView = findQueryNode(queryTree.children, "query-view");
  const removeViews = (nodes: FctQueryNode[]) => {
    for (const node of nodes) {
      node.children = node.children.filter((child) => child.name !== "view");
      removeViews(node.children);
    }
  };
  cloned.children = cloned.children.filter((node) => node.name !== "view");
  removeViews(cloned.children);
  const pinValue = (nodeId: string, uri: string): FctQueryNode => ({
    id: `badge-pin-${nodeId}`,
    name: "value",
    attributes: { datatype: "uri" },
    text: uri,
    children: [],
  });
  const alreadyBound = (nodes: FctQueryNode[], uri: string) =>
    nodes.some((node) => node.name === "value" && node.text === uri);
  for (const pin of pins) {
    if (pin.nodeId === "query-root") {
      if (!alreadyBound(cloned.children, pin.uri)) cloned.children.push(pinValue(pin.nodeId, pin.uri));
      continue;
    }
    const pinTarget = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
      for (const node of nodes) {
        if (node.id === pin.nodeId) return node;
        const nested = pinTarget(node.children);
        if (nested) return nested;
      }
      return undefined;
    };
    const target = pinTarget(cloned.children);
    if (target && !alreadyBound(target.children, pin.uri)) target.children.push(pinValue(pin.nodeId, pin.uri));
  }
  const viewNode: FctQueryNode = {
    id: "query-view",
    name: "view",
    attributes: { ...(existingView?.attributes ?? {}), type: viewType, limit: viewType === FCT_VIEW_TYPES.CLASSES ? "30" : "1", offset: "0" },
    children: [],
  };
  const attach = (nodes: FctQueryNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === targetId) {
        node.children.push(viewNode);
        return true;
      }
      if (attach(node.children)) return true;
    }
    return false;
  };
  if (targetId === "query-root") {
    cloned.children.push(viewNode);
    return cloned;
  }
  return attach(cloned.children) ? cloned : null;
};
const metadataRegistryKey = (tree: FctQueryTree) => `${selectedEndpointId}\u0000${serializeFctQuery(tree)}`;

// When the center-pane result set finishes loading, register its first item and
// total count under the same one-result scoped query used by breadcrumb metadata.
useEffect(() => {
  const expectedLoadedIdentity = `${selectedEndpointId}\u0000${queryCountXml}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}`;
  if (!endpointReadyForQuery || isSearching || isCountingResults) return;
  if (resultsLoadedQueryIdentityRef.current !== expectedLoadedIdentity) return;
  // If the center pane did not obtain a usable total, leave the registry empty
  // so the breadcrumb fallback can fetch its own count rather than caching null.
  if (effectiveResultsTotalCount === null) return;
  const activeScopeId = activeLeafId ?? "query-root";
  const scopedTree = makeBreadcrumbScopedTree(activeScopeId);
  if (!scopedTree) return;
  const first = results[0];
  // A positive COUNT with no returned text row is an incomplete example lookup,
  // not proof that the result set is empty. Let the scoped preview retry.
  if (!first && effectiveResultsTotalCount > 0) return;
  const summary: FctUiResultSummary = {
    label: first ? (first.label?.trim() || first.title?.trim() || toLabel(first.uri)) : "—",
    count: effectiveResultsTotalCount,
    ...(first ? { uri: first.uri, termType: first.termType ?? "uri" } : {}),
  };
  metadataRegistryRef.current.set(metadataRegistryKey(scopedTree), summary);
  // Bound the in-memory registry so navigating across many queries cannot grow it indefinitely.
  if (metadataRegistryRef.current.size > 300) {
    const oldestKey = metadataRegistryRef.current.keys().next().value;
    if (oldestKey) metadataRegistryRef.current.delete(oldestKey);
  }
}, [activeLeafId, effectiveResultsTotalCount, endpointReadyForQuery, isCountingResults, isSearching, queryCountXml, queryTree, results, selectedEndpointId]);

useEffect(() => {
  if (!endpointReadyForQuery) {
    setBreadcrumbPreviewSummaries({});
    setBreadcrumbPreviewPendingIds(new Set());
    return;
  }
  const controller = new AbortController();
  let cancelled = false;
  const targetCrumbs = [{ id: "query-root", uri: "" }, ...displayedBreadcrumbPath.map((crumb) => ({ id: crumb.id, uri: crumb.uri }))];
  const activeScopeId = activeLeafId ?? "query-root";
  const centerPaneIsLoading = isSearching || isCountingResults;
  const cachedSummary = (tree: FctQueryTree) => metadataRegistryRef.current.get(metadataRegistryKey(tree));
  const request = async (xml: string, component: string) => {
    const response = await cachedFetchFct("/proxy/api/fct", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("breadcrumb-preview", component) },
      body: xml,
      signal: controller.signal,
    });
    return await readFctResponse(response);
  };
  // A positive count can coexist with an empty/partial text view on a busy
  // graph server. The simpler list view supplies an independent first resource
  // for the e.g. badge without inventing an example from the count.
  const firstExample = async (tree: FctQueryTree, textData: ParsedFctResponse, component: string): Promise<FctResult | undefined> => {
    if (textData.results[0]) return textData.results[0];
    if (controller.signal.aborted) return undefined;
    try {
      const listTree = setQueryViewAttributes(tree, { type: FCT_VIEW_TYPES.LIST, limit: "1", offset: "0", order: "no" });
      const listData = await request(serializeFctQuery(listTree), `${component}:list-fallback`);
      if (listData.error) return undefined;
      return listData.results[0];
    } catch (error) {
      if (!controller.signal.aborted) console.info("Maestro e.g. badge list fallback failed", { component, error });
      return undefined;
    }
  };
  const recordSummary = (first: FctResult | undefined, count: number | null): FctUiResultSummary => ({
    label: first ? (first.label?.trim() || first.title?.trim() || toLabel(first.uri)) : count !== null && count > 0 ? "Example unavailable" : "—",
    count,
    ...(first ? { uri: first.uri, termType: first.termType ?? "uri" } : {}),
  });
  /** Whole-scope first record plus result count (the same query the center pane runs). */
  const fetchScopeSummary = async (tree: FctQueryTree, crumbId: string): Promise<FctUiResultSummary | null> => {
    try {
      const countSparql = buildFctCountSparql(tree);
      const [textData, countResponse] = await Promise.all([
        request(serializeFctQuery(tree), `BreadcrumbPreview:${crumbId}:text`),
        countSparql ? cachedFetchFct("/proxy/api/sparql", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("breadcrumb-preview-count", `BreadcrumbPreview:${crumbId}:count`) },
          body: JSON.stringify({ facetValueCount: { sparql: countSparql, addr: tree.attributes.addr } }),
          signal: controller.signal,
        }) : Promise.resolve(null),
      ]);
      let count: number | null = null;
      if (countResponse?.ok) {
        const countPayload = await countResponse.json() as { count?: unknown };
        const parsedCount = Number(countPayload.count);
        if (Number.isSafeInteger(parsedCount) && parsedCount >= 0) count = parsedCount;
      }
      const first = count !== 0
        ? await firstExample(tree, textData, `BreadcrumbPreview:${crumbId}`)
        : textData.results[0];
      const summary = recordSummary(first, count);
      if (first || count === 0) metadataRegistryRef.current.set(metadataRegistryKey(tree), summary);
      return summary;
    } catch (error) {
      if (!controller.signal.aborted) console.info("Maestro breadcrumb preview lookup failed", { crumb: crumbId, error });
      return null;
    }
  };
  /** First record only, for a scope whose predecessors are pinned to specific records. */
  const fetchChainRecord = async (tree: FctQueryTree, crumbId: string): Promise<FctUiResultSummary | null> => {
    try {
      const textData = await request(serializeFctQuery(tree), `BreadcrumbPreview:${crumbId}:chain`);
      const first = await firstExample(tree, textData, `BreadcrumbPreview:${crumbId}:chain`);
      const summary = recordSummary(first, null);
      if (first) metadataRegistryRef.current.set(metadataRegistryKey(tree), summary);
      return summary;
    } catch (error) {
      if (!controller.signal.aborted) console.info("Maestro breadcrumb chain lookup failed", { crumb: crumbId, error });
      return null;
    }
  };

  // Walk the breadcrumb left to right so every label comes from ONE record path:
  // the root badge shows record R0, and each next badge shows the first value of
  // that crumb's property (or property-of) on the previous badge's record. The ct
  // stays the size of the whole result set at that node. With fetchMissing=false
  // this only reads caches and never awaits, so it completes synchronously.
  const walkChain = async (fetchMissing: boolean, onStep?: (id: string, summary: FctUiResultSummary) => void) => {
    const resolved: Record<string, FctUiResultSummary> = {};
    if (breadcrumbBadgeMode === "classes") {
      for (let index = 0; index < targetCrumbs.length; index += 1) {
        const crumb = targetCrumbs[index];
        const scopeTree = makeBreadcrumbScopedTree(crumb.id, [], FCT_VIEW_TYPES.CLASSES);
        if (!scopeTree) continue;
        let scope = cachedSummary(scopeTree);
        if (!scope && fetchMissing) {
          try {
            const data = await request(serializeFctQuery(scopeTree), `BreadcrumbPreview:${crumb.id}:classes`);
            if (data.error) throw new Error(data.error);
            if (data.classes && data.classes.length > 0) {
              const firstClass = data.classes[0];
              scope = {
                label: firstClass.label || toLabel(firstClass.uri),
                count: firstClass.count,
                zeroClasses: false,
                uri: firstClass.uri,
                termType: "uri",
              };
            } else {
              scope = {
                label: "No category",
                count: 0,
                zeroClasses: true,
              };
            }
            metadataRegistryRef.current.set(metadataRegistryKey(scopeTree), scope);
          } catch (error) {
            if (!controller.signal.aborted) console.info("Maestro breadcrumb preview classes lookup failed", { crumb: crumb.id, error });
          }
        }
        if (cancelled || controller.signal.aborted) return resolved;
        if (scope) {
          resolved[crumb.id] = scope;
          onStep?.(crumb.id, scope);
        }
      }
      return resolved;
    }

    // undefined = not known yet, null = no usable record (empty set / not a resource).
    const records: Array<FctUiResultSummary | null | undefined> = [];
    for (let index = 0; index < targetCrumbs.length; index += 1) {
      const crumb = targetCrumbs[index];
      const scopeTree = makeBreadcrumbScopedTree(crumb.id);
      if (!scopeTree) { records[index] = undefined; continue; }
      let scope = cachedSummary(scopeTree);
      if (!scope && fetchMissing && !(crumb.id === activeScopeId && centerPaneIsLoading)) {
        // The center pane registers its own scope; don't race it with a duplicate request.
        scope = (await fetchScopeSummary(scopeTree, crumb.id)) ?? undefined;
      }
      if (cancelled || controller.signal.aborted) return resolved;

      if (index === 0) {
        records[0] = scope ?? undefined;
        if (scope) { resolved[crumb.id] = scope; onStep?.(crumb.id, scope); }
        continue;
      }
      const previous = records[index - 1];
      if (previous === undefined) { records[index] = undefined; continue; }
	  /*
      if (previous === null || previous.termType !== "uri" || !previous.uri) {
        // A literal or empty set has no properties to follow.
        records[index] = null;
        resolved[crumb.id] = { label: "—", count: scope?.count ?? null };
        onStep?.(crumb.id, resolved[crumb.id]);
        continue;
      }*/
	  if (previous === null || previous.termType !== "uri" || !previous.uri) {
  // The previous result cannot be used to follow this path.
  // Still display the first result from this crumb's own result set.
  records[index] = null;

  resolved[crumb.id] = scope?.uri
    ? scope
    : { label: "—", count: scope?.count ?? null };

  onStep?.(crumb.id, resolved[crumb.id]);
  continue;
}
      const pins: { nodeId: string; uri: string }[] = [];
      for (let earlier = 0; earlier < index; earlier += 1) {
        const record = records[earlier];
        if (record?.uri) pins.push({ nodeId: targetCrumbs[earlier].id, uri: record.uri });
      }
      const chainTree = makeBreadcrumbScopedTree(crumb.id, pins);
      if (!chainTree) { records[index] = undefined; continue; }
      let chained = cachedSummary(chainTree);
      if (!chained && fetchMissing) chained = (await fetchChainRecord(chainTree, crumb.id)) ?? undefined;
      if (cancelled || controller.signal.aborted) return resolved;
      if (!chained) { records[index] = undefined; continue; }
      records[index] = chained.uri ? chained : null;
      resolved[crumb.id] = { label: chained.label, count: scope?.count ?? null, ...(chained.uri ? { uri: chained.uri, termType: chained.termType } : {}) };
      onStep?.(crumb.id, resolved[crumb.id]);
    }
    return resolved;
  };

  // Show whatever the caches already resolve; only the rest is "Loading…".
  // With fetchMissing=false walkChain never reaches an await, so this callback
  // fills syncResolved synchronously, before the lines below read it.
  const syncResolved: Record<string, FctUiResultSummary> = {};
  void walkChain(false, (id, summary) => { syncResolved[id] = summary; });
  setBreadcrumbPreviewSummaries((current) => ({ ...current, ...syncResolved }));
  setBreadcrumbPreviewPendingIds(new Set(targetCrumbs.filter((crumb) => !syncResolved[crumb.id]).map((crumb) => crumb.id)));

  const timer = window.setTimeout(() => {
    void walkChain(true, (id, summary) => {
      if (cancelled || controller.signal.aborted) return;
      setBreadcrumbPreviewSummaries((current) => ({ ...current, [id]: summary }));
      setBreadcrumbPreviewPendingIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }).then((resolved) => {
      if (cancelled || controller.signal.aborted) return;
      // Drop summaries for crumbs that no longer exist or could not be resolved.
      setBreadcrumbPreviewSummaries(resolved);
      setBreadcrumbPreviewPendingIds(new Set(centerPaneIsLoading && !resolved[activeScopeId] ? [activeScopeId] : []));
    });
  }, 120);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    controller.abort();
  };
}, [activeLeafId, breadcrumbPreviewPathKey, effectiveResultsTotalCount, isCountingResults, isSearching, queryRevision, queryTree, results, selectedEndpointId, endpointReadyForQuery, breadcrumbBadgeMode]);

// Derive checked state from the authoritative query tree, including path
  // properties left at the root when a breadcrumb moves the view elsewhere.
  const activePropertyFilters = getActiveViewPropertyFilters(queryTree);
  const activeRoleFilters = getActiveViewRoleFilters(queryTree);
  const personalRoleFacetNodes = getPersonalRoleFacetNodes(queryTree);
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
  // The classes FCT view returns each class and its grouped count together.
  // Do not run a per-class DistinctCount or remove classes on later count updates.
  const visibleClassDisplayFacets = classDisplayFacets;
  // Like Properties and Roles, Categories puts query-selected terms in a
  // dedicated pane above the paged list, so selected items do not appear twice.
  const selectedClassDisplayFacets = visibleClassDisplayFacets.filter((item) => selectedClasses.has(item.uri));
  const unselectedClassDisplayFacets = visibleClassDisplayFacets.filter((item) => !selectedClasses.has(item.uri));
  const categoryMetadataUrisKey = classDisplayFacets.map((item) => item.uri).sort().join("\n");
  useEffect(() => {
    if (!personalStoreReady) return;
    if (!categoryMetadataUrisKey) return;
    const controller = new AbortController();
    const uris = categoryMetadataUrisKey.split("\n").filter(Boolean);
    const batches: string[][] = [];
    for (let offset = 0; offset < uris.length; offset += 100) batches.push(uris.slice(offset, offset + 100));
    void (async () => {
      const discovered: OntologyClassMetadata[] = [];
      for (const batch of batches) {
        if (controller.signal.aborted) return;
        const response = await fetch("/proxy/api/ontology", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uris: batch }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Ontology discovery/ingestion returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
        const payload = await response.json() as { items?: OntologyClassMetadata[] };
        discovered.push(...(payload.items ?? []));
      }
      if (controller.signal.aborted) return;
      setOntologyClassMetadata((current) => {
        const next = { ...current };
        for (const item of discovered) if (item?.uri && item.ontology) next[item.uri] = item;
        return next;
      });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) console.info("Maestro category ontology discovery or ingestion was incomplete; inspect the /proxy/api/ontology response and personal SPARQL store.", error);
    });
    return () => controller.abort();
  }, [categoryMetadataUrisKey, personalStoreReady]);
  useEffect(() => {
    if (!authSession) { setPersonalSparqlEndpoint(""); return; }
    const controller = new AbortController();
    void fetch("/proxy/api/ontology", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Personal SPARQL endpoint lookup returned HTTP ${response.status}.`);
        return await response.json() as { endpoint?: string };
      })
      .then((payload) => { if (!controller.signal.aborted) setPersonalSparqlEndpoint(payload.endpoint ?? ""); })
      .catch((error: unknown) => { if (!controller.signal.aborted) console.info("Could not read the personal SPARQL endpoint configuration.", error); });
    return () => controller.abort();
  }, [authSession]);

  const pagedUnselectedClasses = unselectedClassDisplayFacets.slice(classesPage * FACET_PAGE_SIZE, (classesPage + 1) * FACET_PAGE_SIZE);
  const categoryTreeItems = categoriesTreeMode ? unselectedClassDisplayFacets : pagedUnselectedClasses;
  const categoryTreeRoots: CategoryTreeNode[] = (() => {
    // The hierarchy comes from the query itself (rdfs:subClassOf edges of the result-set classes up to the
    // root). A class with several parents is listed under each of them, with its own subtree repeated.
    const itemByUri = new Map(categoryTreeItems.map((item) => [item.uri, item]));
    const parentsOf = new Map<string, Set<string>>();
    for (const edge of classTreeEdges) {
      if (edge.uri === edge.parent || !itemByUri.has(edge.uri) || !itemByUri.has(edge.parent)) continue;
      (parentsOf.get(edge.uri) ?? parentsOf.set(edge.uri, new Set()).get(edge.uri)!).add(edge.parent);
    }
    // Where the query returned no subclass edge, fall back to the ontology store's recorded parent.
    for (const item of categoryTreeItems) {
      if (parentsOf.has(item.uri)) continue;
      const fallback = ontologyClassMetadata[item.uri]?.parent;
      if (fallback && fallback !== item.uri && itemByUri.has(fallback)) parentsOf.set(item.uri, new Set([fallback]));
    }
    const childrenOf = new Map<string, string[]>();
    for (const [uri, parents] of parentsOf) for (const parent of parents) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(uri);
    const byLabel = (a: CategoryTreeNode, b: CategoryTreeNode) => toLabel(a.item.uri).localeCompare(toLabel(b.item.uri));
    // Repeating a multi-parent subtree can grow quickly; bound the total rendered nodes.
    let budget = 2000;
    const build = (uri: string, path: ReadonlySet<string>): CategoryTreeNode => {
      budget -= 1;
      const nextPath = new Set(path).add(uri);
      // Skipping ancestors on the current path breaks subclass cycles in malformed ontologies.
      const children = budget > 0 ? (childrenOf.get(uri) ?? []).filter((child) => !nextPath.has(child)).map((child) => build(child, nextPath)) : [];
      children.sort(byLabel);
      return { item: itemByUri.get(uri)!, children };
    };
    const roots = categoryTreeItems.filter((item) => !parentsOf.has(item.uri)).map((item) => build(item.uri, new Set()));
    // Classes that only occur inside a subclass cycle have no root; surface them rather than hiding them.
    const reachable = new Set<string>();
    const collect = (node: CategoryTreeNode) => { reachable.add(node.item.uri); node.children.forEach(collect); };
    roots.forEach(collect);
    for (const item of categoryTreeItems) {
      if (reachable.has(item.uri)) continue;
      const node = build(item.uri, new Set());
      collect(node);
      roots.push(node);
    }
    roots.sort(byLabel);
    return roots;
  })();
  const categoryTreePages = categoriesTreeMode ? paginateCategoryTree(categoryTreeRoots) : [];
  const categoryTreeParentKeys = categoriesTreeMode ? collectCategoryTreeParentKeys(categoryTreeRoots) : [];
  const categoryTreeAllCollapsed = categoryTreeParentKeys.length > 0 && categoryTreeParentKeys.every((key) => !expandedCategoryNodes.has(key));
  // A total from a separate aggregate does not establish that a partial
  // graph-list page contains its promised ten members. Never advertise a
  // precise Page X of Y in that situation.
  // The Sheet controls the query LIMIT; ten is only the number displayed per UI page.
  // Graphs are fetched once up to leftPanelLimit and paged locally, just like the other facets.
  const graphPageCount = Math.max(1, Math.ceil(graphFacets.length / FACET_PAGE_SIZE));
  useEffect(() => {
    if (graphPageCount !== null) setGraphsPage((current) => Math.min(current, graphPageCount - 1));
  }, [graphPageCount]);
  const categoryPageCount = categoriesTreeMode
    ? Math.max(1, categoryTreePages.length)
    : Math.max(1, Math.ceil(unselectedClassDisplayFacets.length / FACET_PAGE_SIZE));
  useEffect(() => {
    setClassesPage((current) => Math.min(current, categoryPageCount - 1));
  }, [categoryPageCount]);
  const autoConfigureFacetCount =
    facetAutofillCandidates.property.filter((uri) => uri !== RDF_TYPE_URI && !selectedProperties.has(uri)).length +
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

  /**
   * Finds a node to highlight for a tutorial preview. Unlike path navigation,
   * this may return an ordinary relationship filter when no path node exists.
   */
  function findRelationshipPreviewNode(
    uri: string,
    direction: RelationshipDirection,
  ): FctQueryNode | null {
    const pathNode = findRelationshipPathNode(uri, direction);
    if (pathNode) return pathNode;
    const tag = direction === "forward" ? "property" : "property-of";
    function visit(nodes: FctQueryNode[]): FctQueryNode | null {
      for (const node of nodes) {
        if (node.name === tag && node.attributes.iri === uri) return node;
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

  // Add every pending Auto-configure candidate. A facet whose registry exclude
  // boolean is true is written to the live query with exclude="yes".
  const runAutoConfigure = () => executeAutoConfigure({
    facetAutofillCandidates,
    selectedProperties,
    selectedRoles,
    getPropertyPath,
    handlePropertyCheckboxChange,
    handleRoleCheckboxChange,
    setAutoConfiguredFacet,
    setNodeAttribute,
  });

  // Single source of truth for both checkbox changes and property-label clicks.
  function handlePropertyCheckboxChange(uri: string, checked: boolean, trackUsage = true) {
    // rdf:type may still be needed in the authoritative query for Result Badges
    // and Group By Category, but must never create a Personal facet widget.
    if (uri === RDF_TYPE_URI && checked) {
      addProperty(activeLeafId, uri);
      return;
    }
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
                label: toLabel(uri, "Property"),
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
    const activeGraph = queryTree.attributes.graph ?? "";
    if (activeGraph !== ALL_GRAPHS && activeGraph) lastManualGraphRef.current = activeGraph;
    setGraphText(activeGraph);
  }, [queryTree.attributes.graph]);

  // `addr` is graphURI@graphserverURI. Only the user's graph-server
  // selection may change the latter. A first-use default or old ID is
  // normalized once when the login-time endpoint registry is available.
  useEffect(() => {
    const endpoint = fctEndpoints.find((item) => item.id === selectedEndpointId);
    if (!endpoint) return;
    const address = queryTree.attributes.addr ?? "";
    const separator = address.indexOf("@");
    // A missing graph attribute means no graph binding. Never recover an old
    // graphsite from addr after the user has explicitly cleared the field.
    const graph = queryTree.attributes.graph?.trim() ?? "";
    const server = separator >= 0 ? address.slice(separator + 1) : "";
    const resolved = fctEndpoints.find((item) => item.url === server);
    // Never rewrite a saved URI that points to a different graph server.
    if (server && !resolved && server !== endpoint.id) return;
    const normalized = `${graph}@${resolved?.url ?? endpoint.url}`;
    if (address !== normalized) setQueryAttribute("addr", normalized);
  }, [selectedEndpointId, fctEndpoints, queryTree.attributes.addr, queryTree.attributes.graph]);

  function bindGraph(uri: string) {
    setGraphFieldEditing(false);
    lastManualGraphRef.current = uri;
    setGraphText(uri);
    recordGraphNavigation(uri);
    setQueryAttribute("graph", uri);
    clearTutorialPreview();
  }

  function startHistoryActionHover(direction: "backward" | "forward") {
    if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current);
    historyHoverTimerRef.current = setTimeout(() => {
      setHistoryActionMenu(direction);
      setHistoryActionItems([]);
      void fetch("/proxy/api/query-favorites", {
        method: "POST", headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-history-actions", "HistoryActionMenu") },
        // Radiate from the loaded History item: earlier items for Back, later items for Forward.
        body: JSON.stringify({ action: "recentActions", direction, historyId: historyVisitQueryRef.current === queryXml ? (historyVisitIdRef.current || historyBookmarkId || undefined) : (historyBookmarkId || undefined) }), cache: "no-store",
      }).then(async (response) => {
        const payload = await response.json() as { items?: Array<{ historyId: string; created: string; action: { operator: "+" | "-"; xpath: string; value?: string } | null }> };
        if (response.ok && Array.isArray(payload.items)) setHistoryActionItems(payload.items);
      }).catch((error) => console.info("Could not load recent History actions", error));
    }, 1500);
  }

  function stopHistoryActionHover() {
    if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current);
    historyHoverTimerRef.current = setTimeout(() => setHistoryActionMenu(null), 250);
  }

  const restoreHistoryActionItem = createHistoryActionRestorer({
    synchronizeFctEndpointSelection,
    restoreQueryAndUiState,
    historyVisitQueryRef,
    historyVisitIdRef,
    clearPendingHistoryVisit: () => { pendingHistoryVisitRef.current = null; },
    setRootSearchExpanded,
    setHistoryBookmarkId,
    setHistoryActionMenu,
  });

  function formatHistoryAction(action: { operator: "+" | "-"; xpath: string; value?: string } | null, direction: "backward" | "forward") {
    if (!action) return "Query state changed";
    const operator = direction === "backward" ? (action.operator === "+" ? "−" : "+") : action.operator;
    return `${operator} ${action.xpath}${operator === "+" && action.value ? ` = ${action.value}` : ""}`;
  }

  async function navigateQueryHistory(direction: "backward" | "forward") {
    if (historyNavigationPending !== null) return;
    historyRestoreInProgressRef.current = true;
    // History navigation is a new query pipeline, not a pagination operation.
    // Cancel immediately, before the asynchronous History lookup begins.
    stopPendingMaestroQueries();
    resetMaestroQueryExecutionClocks();
    resetMaestroIncompleteResults();
    setResults([]);
    setResultsTotalCount(null);
    setResultsPageMatchCount(0);
    setResultsPageComplete(false);
    resultsLoadedQueryIdentityRef.current = "";
    resultsBatchRequestPending.current = false;
    setGroupValues([]);
    setGroupMembers({});
    setPropertyFacets([]);
    setRoleFacets([]);
    setClassFacets([]);
    setClassTreeEdges([]);
    setGraphFacets([]);
    setPropertyFacetError("");
    setRoleFacetError("");
    setClassFacetError("");
    setIsLoadingProperties(false);
    setIsLoadingRoles(false);
    setIsLoadingClasses(false);
    setIsLoadingCategoryTree(false);
    setIsLoadingGraphs(false);
    setIsLoadingAlphabet(false);
    setAlphabetCounts({});
    setAlphabetPreflight("checking");
    setIsSearching(false);
    setIsCountingResults(false);
    setGroupValuesLoading(false);
    setConfigureQueryTransition(false);
    setHistoryNavigationPending(direction);
    try {
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-maestro-debug-component": direction === "backward" ? "HistoryBackButton" : "HistoryForwardButton",
        },
        body: JSON.stringify({ action: "navigate", direction, historyId: historyBookmarkId }), cache: "no-store",
      });
      const payload = await response.json() as { found?: boolean; stateUrl?: string; queryXml?: string; historyId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      if (!payload.found) {
        toast.add({ title: `No ${direction === "backward" ? "earlier" : "later"} query in History`, type: "info" });
        return;
      }
      if (!payload.queryXml || !payload.historyId) {
        throw new Error("The selected History item does not contain a saved query.");
      }

      // stateUrl is RDF-stored metadata, not a navigation target. Read its
      // serialized UI state, but apply the query XML returned by the RDF result
      // set as the authoritative query. The shared restore function updates the
      // query store and all related UI state without reloading the page.
      const savedUrl = payload.stateUrl ? new URL(payload.stateUrl, window.location.href) : null;
      const restoredUiState = savedUrl ? readShareableUiState(savedUrl.search) : null;
      const restoredTree = parseFctQueryXml(payload.queryXml);
      if (!restoredTree) throw new Error("The selected History item contains invalid FCT query XML.");
      const graphServerId = readGraphServerFromQueryXml(payload.queryXml);
      if (!graphServerId) throw new Error("The History item does not identify a graph server in addr.");
      await synchronizeFctEndpointSelection(graphServerId);

      historyVisitQueryRef.current = serializeFctQuery(restoredTree);
      historyVisitIdRef.current = payload.historyId;
      pendingHistoryVisitRef.current = null;
      setRootSearchExpanded(false);
      restoreQueryAndUiState(payload.queryXml, restoredUiState, payload.historyId);
      // Even the same serialized query must start a new execution generation.
      setQueryRefreshRevision((revision) => revision + 1);

      // Keep the current browser URL synchronized without navigating. The URL
      // remains a reflection of app state; it is not the source used to restore it.
      const params = new URLSearchParams(window.location.search);
      params.set("q", payload.queryXml);
      params.set("history", payload.historyId);
      if (savedUrl?.searchParams.has("state")) params.set("state", savedUrl.searchParams.get("state")!);
      if (savedUrl) copyRibbonUrlParams(savedUrl.searchParams, params);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not navigate query History.";
      toast.add({ title: "Could not navigate query History", description: message, type: "error" });
    } finally {
      historyRestoreInProgressRef.current = false;
      setHistoryNavigationPending(null);
    }
  }

  /** A Features button replaces the single authoritative live FCT query,
   * exactly like navigating to a saved History query. No shadow feature query:
   * Trail, left facets, Results, and the Features cards read this same tree. */
  async function selectViewFeature(feature: "policies" | "formats" | "transcoders" | null) {
    if (!feature) { setViewFeature(null); return; }
    try {
      const response = await fetch("/proxy/api/view-features/query-config", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature }),
      });
      const payload = await response.json() as { graph?: string; personalEndpointUrl?: string; error?: string };
      if (!response.ok || !payload.graph || !payload.personalEndpointUrl)
        throw new Error(payload.error || "Could not locate the personal Features graph.");
      // Must select the personal endpoint before committing the query: the
      // graph-server selector can otherwise rewrite addr to the previous server.
      await synchronizeFctEndpointSelection(payload.personalEndpointUrl);
      const tree = featureFctQuery(queryTree, feature, payload.graph, payload.personalEndpointUrl, resultsBatchSize);
      const xml = serializeFctQuery(tree);
      if (!restoreQueryAndUiState(xml, null)) throw new Error("Could not restore the Features FCT query.");
      setViewFeature(feature);
      setViewPanel("features");
      setSearchDraft("");
      setSavedSearchDraft("");
      setGroupByPropertyUri("");
      setCentralTab("results");
      setControlsSheetOpen(false);
    } catch (error) {
      toast.add({ title: "Could not navigate to Features", description: error instanceof Error ? error.message : "Features FCT query failed.", type: "error" });
    }
  }

  async function loadHistoryQuery(includeFavorites = false) {
    if (isLoadingHistoryQuery) return;
    setIsLoadingHistoryQuery(true);
    try {
      // Use the server-resolved SITE_HISTORY graph rather than duplicating its
      // default in client code, so .env.local remains authoritative.
      const response = await fetch("/proxy/api/query-favorites/config", { cache: "no-store" });
      const payload = await response.json() as { historyGraph?: string; personalEndpointUrl?: string; error?: string };
      if (!response.ok || !payload.historyGraph || !payload.personalEndpointUrl) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      // History and Bookmarks live in the personal SPARQL store, so opening either
      // view selects the personal graph server in the toolbar (and the proxy cookie).
      // The addr-sync effect rewrites the query's addr from the selected server, so
      // leaving the previous server selected would silently redirect this query.
      const normalizeEndpointUrl = (value: string) => {
        const url = new URL(value);
        url.hash = "";
        url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
        return url.toString().replace(/\/$/u, "");
      };
      const personalEndpoint = fctEndpoints.find((endpoint) => {
        try {
          return normalizeEndpointUrl(endpoint.url) === normalizeEndpointUrl(payload.personalEndpointUrl!);
        } catch {
          return false;
        }
      });
      if (!personalEndpoint) {
        throw new Error(`The personal SPARQL endpoint (${payload.personalEndpointUrl}) is not present in the Graphs graph.`);
      }
      // Build the History query as a complete FCT query, then pass it through
      // the same restore path used by URL state. That path updates the live
      // query store through its API, notifying the query tree, breadcrumbs,
      // facets, results, and URL-state listeners together.
      // Health-checks the personal server, selects it, and throws if it is offline.
      await synchronizeFctEndpointSelection(personalEndpoint.url);
      const baseHistoryGraph = payload.historyGraph.replace(/#.*$/, "");
      const graphIri = `${baseHistoryGraph}#${includeFavorites ? "bookmarks" : "history"}`;
      const addrAttr = `${graphIri}@${personalEndpoint.url}`;
      const classIri = includeFavorites
        ? "http://www.w3.org/2002/01/bookmark#Bookmark"
        : "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#QueryHistoryVisit";

      const historyTree: FctQueryTree = {
        ...queryTree,
        attributes: {
          ...queryTree.attributes,
          graph: graphIri,
          addr: addrAttr,
          ...(orderResults ? { order: "yes" } : {}),
        },
        children: [
          { id: "history-bookmark-class", name: "class", attributes: { iri: classIri }, children: [] },
          { id: "query-view", name: "view", attributes: { type: FCT_VIEW_TYPES.TEXT, limit: "30", offset: "0" }, children: [] },
        ],
      };
      const historyQueryXml = serializeFctQuery(historyTree);
      if (!restoreQueryAndUiState(historyQueryXml, null)) {
        throw new Error("Could not restore the generated History query.");
      }

      setSearchDraft("");
      setSavedSearchDraft("");
      setGroupByPropertyUri("");
      setCentralTab("results");
      setControlsSheetOpen(false);
      toast.add({
        title: includeFavorites ? "Bookmarks loaded" : "History loaded",
        description: includeFavorites
          ? "Showing Bookmark records from your personal graph server."
          : "Showing Query History Visit records from your personal graph server.",
        type: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load query History.";
      toast.add({ title: "Could not load query History", description: message, type: "error" });
    } finally {
      setIsLoadingHistoryQuery(false);
    }
  }

  async function deleteCurrentQueryHistory() {
    if (isDeletingCurrentHistory || !historyBookmarkId) return;
    setIsDeletingCurrentHistory(true);
    try {
      await historyWriteQueueRef.current;
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-history", "DeleteCurrentHistory") },
        body: JSON.stringify({ action: "deleteCurrentHistory", historyId: historyBookmarkId }),
        cache: "no-store",
      });
      const payload = await response.json() as { deleted?: boolean; nextHistoryId?: string; queryXml?: string; stateUrl?: string; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? `HTTP ${response.status}`);
      historyVisitQueryRef.current = "";
      historyVisitIdRef.current = "";
      pendingHistoryVisitRef.current = null;
      if (payload.nextHistoryId && payload.queryXml) {
        const savedUrl = payload.stateUrl ? new URL(payload.stateUrl, window.location.href) : null;
        const restoredTree = parseFctQueryXml(payload.queryXml);
        if (!restoredTree) throw new Error("The next earlier History item contains invalid FCT query XML.");
        historyVisitQueryRef.current = serializeFctQuery(restoredTree);
        historyVisitIdRef.current = payload.nextHistoryId;
        const restoredUiState = savedUrl ? readShareableUiState(savedUrl.search) : null;
        restoreQueryAndUiState(payload.queryXml, restoredUiState, payload.nextHistoryId);
        const params = new URLSearchParams(window.location.search);
        params.set("q", payload.queryXml);
        params.set("history", payload.nextHistoryId);
        if (savedUrl?.searchParams.has("state")) params.set("state", savedUrl.searchParams.get("state")!);
      if (savedUrl) copyRibbonUrlParams(savedUrl.searchParams, params);
        else params.delete("state");
        window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
      } else {
        setHistoryBookmarkId("");
      }
      setBookmarkCheckRevision((revision) => revision + 1);
      toast.add({ title: "History item deleted", description: payload.nextHistoryId ? "Restored the next earlier History item." : "The current History item was deleted; no earlier item remains.", type: "success" });
    } catch (error) {
      toast.add({ title: "Could not delete History item", description: error instanceof Error ? error.message : "The History item could not be deleted.", type: "error" });
    } finally {
      setIsDeletingCurrentHistory(false);
    }
  }

  
  
  

  async function exportBookmarks() {
    if (isExportingBookmarks) return;
    setIsExportingBookmarks(true);
    try {
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "ExportBookmarks") },
        body: JSON.stringify({ action: "exportBookmarks" }),
      });
      const payload = await response.json() as { format?: string; error?: string; triples?: unknown[] };
      if (!response.ok || !Array.isArray(payload.triples)) throw new Error(payload.error ?? `HTTP ${response.status}`);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `maestro-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally { URL.revokeObjectURL(url); }
      toast.add({ title: "Bookmarks exported", description: `${payload.triples.length} RDF triples exported.`, type: "success" });
    } catch (error) {
      toast.add({ title: "Could not export Bookmarks", description: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setIsExportingBookmarks(false); }
  }

  async function importBookmarks(file: File) {
    if (isImportingBookmarks) return;
    setIsImportingBookmarks(true);
    try {
      if (file.size > 4_000_000) throw new Error("Bookmark import files must be smaller than 4 MB.");
      const imported = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "ImportBookmarks") },
        body: JSON.stringify({ action: "importBookmarks", archive: imported }),
      });
      const payload = await response.json() as { imported?: number; error?: string };
      if (!response.ok || typeof payload.imported !== "number") throw new Error(payload.error ?? `HTTP ${response.status}`);
      setBookmarkCheckRevision((revision) => revision + 1);
      toast.add({ title: "Bookmarks imported", description: `${payload.imported} RDF triples imported into your personal Bookmarks graph.`, type: "success" });
    } catch (error) {
      toast.add({ title: "Could not import Bookmarks", description: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setIsImportingBookmarks(false); }
  }

  async function deleteBookmarks() {
    if (isDeletingHistory) return;
    setIsDeletingHistory(true);
    try {
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST", headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "DeleteBookmarks") },
        body: JSON.stringify({ action: "deleteBookmarks" }), cache: "no-store",
      });
      const payload = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setBookmarkCheckRevision((revision) => revision + 1);
      toast.add({ title: "Bookmarks deleted", description: "Bookmark records were deleted. Ordinary History visits were preserved.", type: "success" });
    } catch (error) {
      toast.add({ title: "Could not delete Bookmarks", description: error instanceof Error ? error.message : "The Bookmark records could not be deleted.", type: "error" });
    } finally { setIsDeletingHistory(false); }
  }

  async function deleteQueryHistory() {
    if (isDeletingHistory) return;
    setIsDeletingHistory(true);
    try {
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-history", "DeleteHistory") },
        body: JSON.stringify({ action: "deleteHistory" }),
        cache: "no-store",
      });
      const payload = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? `HTTP ${response.status}`);
      historyVisitQueryRef.current = "";
      historyVisitIdRef.current = "";
      pendingHistoryVisitRef.current = null;
      setHistoryBookmarkId("");
      const params = new URLSearchParams(window.location.search);
      params.delete("history");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
      setHistoryHasOlder(false);
      setHistoryHasNewer(false);
      setHistoryNavigationPending(null);
      setDeleteHistoryDialogOpen(false);
      toast.add({ title: "History deleted", description: "Query History visits were removed from your RDF store. Saved bookmarks were preserved.", type: "success" });
    } catch (error) {
      toast.add({ title: "Could not delete History", description: error instanceof Error ? error.message : "The History records could not be deleted.", type: "error" });
    } finally {
      setIsDeletingHistory(false);
    }
  }

  function navigateGraphHistory(nextIndex: number) {
    const graph = graphNavigationHistory[nextIndex];
    if (graph === undefined) return;
    setGraphNavigationIndex(nextIndex);
    setGraphText(graph);
    setQueryAttribute("graph", graph || null);
    clearTutorialPreview();
  }

  function recordGraphNavigation(graph: string) {
    const prefix = graphNavigationHistory.slice(0, graphNavigationIndex + 1);
    if (prefix[prefix.length - 1] === graph) {
      setGraphNavigationHistory(prefix);
      return;
    }
    const next = [...prefix, graph];
    setGraphNavigationHistory(next);
    setGraphNavigationIndex(next.length - 1);
  }

  async function openGraphInfo() {
    const graph = graphText.trim();
    const requestId = ++graphInfoRequestRef.current;
    const isCurrent = () => graphInfoRequestRef.current === requestId;
    setGraphInfoOpen(true);
    const validIri = /^https?:\/\/[^\s<>"{}|\\^`]+$/i.test(graph);
    if (!validIri) {
      setGraphInfo({ graph, subjectCount: null, subjectCountLoading: false, subjectCountError: graph ? "Not a valid graph IRI." : "Enter a graph URI first.", access: null, accessLoading: false, accessError: "" });
      return;
    }
    setGraphInfo({ graph, subjectCount: null, subjectCountLoading: true, subjectCountError: "", access: null, accessLoading: true, accessError: "" });

    const loadCount = async () => {
      try {
        const sparql = `SELECT (COUNT(DISTINCT ?s) AS ?ct) WHERE { GRAPH <${graph}> { ?s ?p ?o } }`;
        const response = await fetch("/proxy/api/sparql", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("graph-info-count", "GraphInfo:count") },
          body: JSON.stringify({ facetValueCount: { sparql, addr: queryTree.attributes.addr } }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.count !== "number") throw new Error(data.error ?? `Subject count failed (HTTP ${response.status}).`);
        if (isCurrent()) setGraphInfo((current) => ({ ...current, subjectCount: data.count, subjectCountLoading: false }));
      } catch (error) {
        if (isCurrent()) setGraphInfo((current) => ({ ...current, subjectCountLoading: false, subjectCountError: facetLoadErrorMessage(error, "Subject count failed.") }));
      }
    };
    const loadAccess = async () => {
      try {
        const response = await fetch("/proxy/api/graph-access", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("graph-info-access", "GraphInfo:access") },
          body: JSON.stringify({ graph }),
        });
        const data = await response.json().catch(() => ({}));
        if (typeof data.access !== "boolean") throw new Error(data.error ?? `Access test failed (HTTP ${response.status}).`);
        if (isCurrent()) setGraphInfo((current) => ({ ...current, access: data.access, accessLoading: false, accessError: data.access ? "" : String(data.error ?? "") }));
      } catch (error) {
        if (isCurrent()) setGraphInfo((current) => ({ ...current, access: false, accessLoading: false, accessError: facetLoadErrorMessage(error, "Access test failed.") }));
      }
    };
    await Promise.all([loadCount(), loadAccess()]);
  }

  function applyGraphText() {
    setGraphFieldEditing(false);
    const graph = graphText.trim();
    if (graph && graph !== ALL_GRAPHS) lastManualGraphRef.current = graph;
    recordGraphNavigation(graph);
    setQueryAttribute("graph", graph || null);
    clearTutorialPreview();
  }

  function clearGraph() {
    setGraphFieldEditing(false);
    // X switches only graph scope, never the search signal or text constraint.
    const current = graphText.trim();
    if (current && current !== ALL_GRAPHS) lastManualGraphRef.current = current;
    const nextGraph = graphAutoFill ? ALL_GRAPHS : "";
    setGraphText(nextGraph);
    recordGraphNavigation(nextGraph);
    setQueryAttribute("graph", nextGraph || null);
    clearTutorialPreview();
  }

  function exitEverywhere() {
    setGraphFieldEditing(true);
    // Restore the user's last manual graph without touching the text signal.
    // If none was entered, leave an editable blank field for a new graph.
    const restored = lastManualGraphRef.current;
    setGraphText(restored);
    recordGraphNavigation(restored);
    setQueryAttribute("graph", restored || null);
    clearTutorialPreview();
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
    // An unknown total is not a one-page result set. Continue paging while a
    // loaded page is available or the server has not returned a final short batch.
    const knownTotalPages = effectiveResultsTotalCount === null
      ? null
      : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize));
    const hasLoadedNextPage = results.length > nextPage * resultsPageSize;
    const canRequestNextBatch = !resultsPageComplete && results.length > 0;
    if (nextPage === resultsUiPage || (knownTotalPages !== null
      ? nextPage >= knownTotalPages
      : !hasLoadedNextPage && !canRequestNextBatch)) return;
    setResultsUiPage(nextPage);
    const requiredResultCount = (nextPage + 1) * resultsPageSize;
    if (requiredResultCount > results.length &&
        results.length < (effectiveResultsTotalCount ?? Number.POSITIVE_INFINITY) &&
        !resultsPageComplete && !isSearching && !resultsBatchRequestPending.current) {
      resultsBatchRequestPending.current = true;
      setResultsPage(resultsBatchSize, resultsOffset + Math.max(1, resultsPageMatchCount));
    }
  }, [resultsUiPage, effectiveResultsTotalCount, resultsPageSize, results.length, resultsPageComplete, isSearching, resultsBatchSize, resultsOffset, resultsPageMatchCount, setResultsPage]);

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
    const scope = parentId ? findQueryNode(queryTree.children, parentId) : null;
    const statuses = (scope?.children ?? queryTree.children).filter((item) => item.name === "status")
      .map((item) => (item.text ?? "").split("#").pop() ?? "").filter(Boolean);
    return [...getClassesAtNode(parentId).map((iri) => toLabel(iri, "Class")), ...statuses];
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

  /** Bound <value> children of a relationship node, in query order. */
  function hasValueRange(value: FctQueryNode): boolean {
    return value.attributes.rangeStart !== undefined || value.attributes.rangeEnd !== undefined;
  }

  function boundValueNodes(node: FctQueryNode | undefined): FctQueryNode[] {
    return (node?.children ?? []).filter((child) => child.name === "value" && (Boolean(child.text) || hasValueRange(child)));
  }

  function boundValueLabel(value: FctQueryNode): string {
    if (hasValueRange(value)) {
      return `(${value.attributes.rangeStart ?? ""}, ${value.attributes.rangeEnd ?? ""})`;
    }
    const text = value.text ?? "";
    const lang = value.attributes["xml:lang"];
    const base = value.attributes.datatype === "uri" ? toLabel(text) : text;
    return lang ? `${base} @${lang}` : base;
  }

  /** Lazy, real example/count for a submenu node, never the predicate display name. */
  async function loadBreadcrumbMenuPreview(nodeId: string) {
    if (breadcrumbPreviewSummaries[nodeId] || breadcrumbMenuPreviewSummaries[nodeId] || breadcrumbMenuPreviewPendingRef.current.has(nodeId)) return;
    const scoped = makeBreadcrumbScopedTree(nodeId);
    if (!scoped || !endpointReadyForQuery) return;
    breadcrumbMenuPreviewPendingRef.current.add(nodeId);
    try {
      const sparql = buildFctCountSparql(scoped);
      const [response, countResponse] = await Promise.all([
        cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("breadcrumb-menu-preview", `BreadcrumbMenu:${nodeId}`) },
          body: serializeFctQuery(scoped),
        }),
        sparql ? cachedFetchFct("/proxy/api/sparql", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("breadcrumb-menu-count", `BreadcrumbMenu:${nodeId}:count`) },
          body: JSON.stringify({ facetValueCount: { sparql, addr: queryTree.attributes.addr } }),
        }) : Promise.resolve(null),
      ]);
      const parsed = await readFctResponse(response);
      const first = parsed.results[0];
      let count: number | null = null;
      if (countResponse?.ok) {
        const payload = await countResponse.json() as { count?: unknown };
        const n = Number(payload.count);
        if (Number.isSafeInteger(n) && n >= 0) count = n;
      }
      setBreadcrumbMenuPreviewSummaries((current) => ({ ...current, [nodeId]: {
        label: first?.label?.trim() || first?.title?.trim() || (first ? toLabel(first.uri, "OBJECT") : "—"),
        count,
        ...(first ? { uri: first.uri, termType: first.termType ?? "uri" } : {}),
      } }));
    } catch (error) {
      console.info("Maestro submenu example lookup failed", { nodeId, error });
    } finally {
      breadcrumbMenuPreviewPendingRef.current.delete(nodeId);
    }
  }

  /** Breadcrumb menu's first item is the example itself, never the relationship label. */
  function renderBreadcrumbMenuHeader(
    summary: FctUiResultSummary | undefined,
    ariaLabel: string,
    onActivate: () => void,
    isBound: boolean,
  ): ReactNode {
    return (
      <DropdownMenuItem
        aria-label={ariaLabel}
        onSelect={onActivate}
        className="mb-1 rounded-b-none border-b pb-1.5 text-xs font-medium text-foreground"
      >
        <span className="max-w-56 truncate">
          {summary?.label && summary.label !== "—" ? `${isBound ? "" : "e.g. "}${ellipsize(summary.label, 40).replace(/[’']s$/u, "")}` : "Example loading…"}
        </span>
      </DropdownMenuItem>
    );
  }

  /**
   * One breadcrumb dropdown entry. A node with child relationships becomes a submenu whose contents are that
   * node's own children (recursively); a leaf is a plain item. Every entry, and every submenu header, runs
   * onSelectNode(node.id) - the same navigation a normal menu item performs.
   */
  function renderBreadcrumbNodeMenuItem(
    node: FctQueryNode,
    onSelectNode: (nodeId: string) => void,
  ): ReactNode {
    const childRelationshipNodes = (node.children ?? []).filter(
      (c) => c.name === "property" || c.name === "property-of"
    );
    const isChildBearing = childRelationshipNodes.length > 0;
    const iri = node.attributes?.iri || "";
    const directionSuffix = (node.name === "property-of" || node.id.startsWith("role-filter-")) ? " of" : "";
    const baseLabel = toLabel(iri, directionSuffix ? "Role" : "Property") + directionSuffix;
    const isExcluded = node.attributes?.exclude?.trim().toLowerCase() === "yes";
    const boundValues = boundValueNodes(node);
    const summary = breadcrumbPreviewSummaries[node.id] ?? breadcrumbMenuPreviewSummaries[node.id];

    const nodeContent = (
      <span className="flex items-center gap-1.5 flex-1 min-w-0">
        {isExcluded && <CircleSlash className="size-3.5 shrink-0 text-destructive" aria-label="Excluded" />}
        <span className="truncate">{baseLabel}</span>
        {boundValues.map((v) => (
          <span key={v.id} className="ml-1 inline-flex items-baseline gap-0.5 text-xs text-muted-foreground">
            {renderValueOperator(v, "size-3")}
            <span>
              {boundValueLabel(v)}
            </span>
          </span>
        ))}
      </span>
    );

    if (isChildBearing) {
      return (
        <DropdownMenuSub key={node.id} onOpenChange={(open) => { if (open) void loadBreadcrumbMenuPreview(node.id); }}>
          <DropdownMenuSubTrigger
            onClick={() => onSelectNode(node.id)}
            className="whitespace-normal break-words flex items-center justify-between"
          >
            {nodeContent}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="z-50 w-max min-w-44 max-w-[calc(100vw-2rem)]">
            {renderBreadcrumbMenuHeader(summary, `Move view to ${baseLabel}`, () => onSelectNode(node.id), boundValues.length > 0)}
            {childRelationshipNodes.map((child) => renderBreadcrumbNodeMenuItem(child, onSelectNode))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }

    return (
      <DropdownMenuItem
        key={node.id}
        onSelect={() => onSelectNode(node.id)}
        className="whitespace-normal break-words"
      >
        {nodeContent}
      </DropdownMenuItem>
    );
  }

  /**
   * A relationship's bound values sit on the stack just above it: the first
   * pop removes the most recent binding, and only when none remain does the
   * next pop remove the relationship itself.
   */
  function popBreadcrumbOrBinding(crumb: { id: string; uri: string; name: string }) {
    const values = boundValueNodes(findQueryNode(queryTree.children, crumb.id));
    if (values.length > 0) {
      deleteNode(values[values.length - 1].id);
      return;
    }
    popBreadcrumbNode(crumb);
  }

  function queryNodeLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri;
    if (node.id === "query-everything") return "Everything";
    if (node.id === "query-text")
      return node.text || "Everything";
    if (node.id === "query-view") {
      return `Focus · limit ${node.attributes.limit ?? "30"} · offset ${node.attributes.offset ?? "0"}`;
    }
    if (node.name === "value")
      return boundValueLabel(node) || "Value";
    if (node.name === "property-of") {
      // Depending on the source XML, reverse relationships may expose their
      // predicate through iri, property, role, or text. Prefer the Roles facet
      // label, but never fall back to the generic XML tag name.
      const roleIri = iri ?? node.attributes.property ?? node.attributes.role;
      const roleText = typeof node.text === "string" ? node.text.trim() : "";
      return (roleIri ? toLabel(roleIri, "Role") : "") || roleText || "Role";
    }
    if (node.name === "property") {
      // Keep the full IRI in the query tree; use a concise label only for display.
      // Literal bindings are not wired into the UI yet, but display them if present
      // in the query model/XML (e.g. iri="...date" literal="5/23/92").
      const propertyLabel = iri ? toLabel(iri, "Property") : "Property";
      const literal = node.attributes.literal ?? node.attributes.value;
      return literal !== undefined && literal !== ""
        ? `${propertyLabel} = ${literal}`
        : propertyLabel;
    }
    if (node.name === "class" && iri) {
      return `Class: ${toLabel(iri, "Class")}`;
    }
    if (node.name === "status") return `Status: ${(node.text ?? "").split("#").pop() ?? "Status"}`;
    return node.name;
  }


  
  const rootClassNodes = queryTree.children.filter((node) => node.name === "class");
  const rootStatusNodes = queryTree.children.filter((node) => node.name === "status");
  // Prefer the Text node, otherwise attach root classes to a root Value node.
  const rootClassCarrierId = queryTree.children.find((node) => node.id === "query-text")?.id
    ?? queryTree.children.find((node) => node.name === "value")?.id
    ?? "query-everything";
  const classLabelsForQueryNode = (node: FctQueryNode): string[] => {
    const nested = node.children.filter((child) => child.name === "class").map((child) => child.attributes.iri).filter((iri): iri is string => Boolean(iri));
    const rootStack = node.id === rootClassCarrierId
      ? rootClassNodes.map((classNode) => classNode.attributes.iri).filter((iri): iri is string => Boolean(iri))
      : [];
    const scopedStatuses = node.children.filter((child) => child.name === "status")
      .map((child) => (child.text ?? "").split("#").pop() ?? "");
    const rootStatuses = node.id === rootClassCarrierId ? rootStatusNodes.map((child) => (child.text ?? "").split("#").pop() ?? "") : [];
    return [...Array.from(new Set([...nested, ...rootStack])).map((uri) => toLabel(uri, "Class")), ...scopedStatuses, ...rootStatuses].filter(Boolean);
  };

  const rootPreviewNodeId = queryTree.children.find((node) => node.name === "value" && node.attributes.datatype === "uri")?.id
    ?? queryTree.children.find((node) => node.id === "query-text")?.id
    ?? "query-everything";
  const renderQueryNode = (
    node: FctQueryNode,
    depth = 0,
  ): ReactNode => {
    // A nested <view> is the focus marker for its parent, not a separate tree row.
    if (node.id === "query-view") return null;
    const protectedNode = node.id === "query-text" || node.id === "query-view" || node.id === "query-everything";
    const rootHasFocusView = queryTree.children.some((child) => child.id === "query-view");
    const isRoot = depth === 0;
    // A <view> belongs to its immediate parent. Color that parent's icon green
    // wherever it occurs in the tree; at the root, the standalone view focuses
    // the root search/value node instead.
    const hasAttachedFocusView = node.children.some((child) => child.id === "query-view");
    const isRootFocusCarrier = isRoot && rootHasFocusView && (node.id === "query-text" || node.id === "query-everything" || node.name === "value");
    const isFocusCarrier = hasAttachedFocusView || isRootFocusCarrier;
    const isRootUriValue = isRoot && node.name === "value" && node.attributes.datatype === "uri";
    const SearchModeIcon = signalOptions.find((option) => option.mode === textSearchMode)?.Icon ?? Signal;
    const NodeIcon = node.id === "query-text"
      ? SearchModeIcon
      : node.id === "query-everything"
        ? SearchModeIcon
        : node.id === "query-view"
        ? null
        : node.name === "property"
          ? BetweenHorizontalStart
          : node.name === "property-of"
            ? BetweenHorizontalEnd
            : node.name === "class"
              ? Shapes
              : node.name === "value"
                ? isRootUriValue ? GlobeCode : Tag
                : null;
    const nodeIconColor = isFocusCarrier
      ? "text-emerald-600 dark:text-emerald-400"
      : node.id === "query-text" || node.id === "query-everything"
        ? "text-black dark:text-white"
        : node.name === "property" || node.name === "property-of"
          ? "text-red-600 dark:text-red-400"
          : node.name === "class"
            ? "text-blue-600 dark:text-blue-400"
            : "text-muted-foreground";
    // <value> children of a property, property-of, or class are shown inline on
    // their parent's row (= value) instead of as separate rows.
    const inlinesValues = node.name === "property" || node.name === "property-of" || node.name === "class";
    const inlineValues = inlinesValues ? boundValueNodes(node) : [];
    const topInlineValue = inlineValues[inlineValues.length - 1];
    const inlineClassNodes = node.children.filter((child) => child.name === "class");
    const rootClassesOnThisNode = node.id === rootClassCarrierId ? rootClassNodes : [];
    const rootStatusesOnThisNode = node.id === rootClassCarrierId ? rootStatusNodes : [];
    const inlineStatusNodes = node.children.filter((child) => child.name === "status");
    const topInlineClass = [...inlineClassNodes, ...rootClassesOnThisNode][inlineClassNodes.length + rootClassesOnThisNode.length - 1];
    const topInlineStatus = [...inlineStatusNodes, ...rootStatusesOnThisNode].at(-1);
    // The root row (Everything / search text / root URI value) is a stack too. Its
    // text or value is on top and comes off first, like a <value> on a property;
    // then the root classes pop one at a time. With none of them there is nothing
    // to remove, so the minus is not shown at all.
    const isRootCarrierRow = isRoot && node.id === rootClassCarrierId;
    const rootTextOrValue = isRootCarrierRow && (
      (node.id === "query-text" && Boolean(node.text?.trim() || search.trim())) ||
      (node.name === "value" && Boolean(node.text?.trim())));
    const showMinus = !isRootCarrierRow || rootTextOrValue || rootClassesOnThisNode.length > 0 || rootStatusesOnThisNode.length > 0;
    const lockedNode = protectedNode && !isRootCarrierRow;
    const visibleChildren = node.children.filter((child) =>
      child.id !== "query-view" && child.name !== "class" && child.name !== "status" && !(inlinesValues && child.name === "value" && (Boolean(child.text) || hasValueRange(child))));
    const hasVisibleChildren = visibleChildren.length > 0;
    const isCollapsed = collapsedQueryNodeIds.has(node.id);
    const toggleCollapsed = () => setCollapsedQueryNodeIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
    return (
      <li key={node.id} className="min-w-0">
        <div
          className={`flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60 ${
            facetHoverPreview && ((facetHoverPreview.kind === "record" && node.id === rootPreviewNodeId) || (facetHoverPreview.kind === "facet" && node.id === facetHoverPreview.successorNodeId))
              ? "bg-purple-50/70 text-purple-800 ring-1 ring-inset ring-purple-500/80 dark:bg-purple-950/30 dark:text-purple-200"
              : ""
          }`}
          style={{ marginLeft: depth * 14 }}
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            {hasVisibleChildren ? (
              <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={toggleCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${queryNodeLabel(node)}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                {isCollapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
              </button>} /><TooltipContent>{`${isCollapsed ? "Expand" : "Collapse"} node`}</TooltipContent></Tooltip>
            ) : null}
          </span>
          {NodeIcon && (node.name === "property" || node.name === "property-of" ? (
            <Tooltip>
              <TooltipTrigger render={<span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center" aria-label={node.name === "property-of" ? "Role" : "Property"}><NodeIcon className={`size-4 ${nodeIconColor}`} aria-hidden="true" /></span>} />
              <TooltipContent>{node.name === "property-of" ? "Role" : "Property"}</TooltipContent>
            </Tooltip>
          ) : (
            node.id === "query-text" || node.id === "query-everything"
              ? <span className="relative mt-0.5 flex size-4 shrink-0">{textSearchMode !== "clear" && <Signal strokeWidth={2.5} className="absolute inset-0 size-4 text-muted-foreground/35" aria-hidden="true" />}<NodeIcon strokeWidth={2.5} className={`absolute inset-0 size-4 ${nodeIconColor}`} aria-hidden="true" /></span>
              : <NodeIcon className={`mt-0.5 size-4 shrink-0 ${nodeIconColor}`} aria-hidden="true" />
          ))}
          <span className="min-w-0 flex-1 break-words text-sm">
            {node.name === "property" || node.name === "property-of" ? (
              <Tooltip><TooltipTrigger render={<button
                type="button"
                className="min-w-0 break-words text-left underline-offset-2 hover:underline cursor-pointer"
                onClick={() => navigateToPropertyPath(node.id)}
              >
                {queryNodeLabel(node)}{node.name === "property-of" ? " of" : ""}{classLabelsForQueryNode(node).length > 0 ? ` (${classLabelsForQueryNode(node).join(", ")})` : ""}
              </button>} /><TooltipContent>{`Navigate to ${node.name === "property-of" ? "reverse-role" : "property"} scope: ${node.attributes.iri ?? queryNodeLabel(node)}`}</TooltipContent></Tooltip>
            ) : (
              <Tooltip><TooltipTrigger render={<span
                className="min-w-0 break-words"
              >
                {node.name === "value" && <span className="mr-1 inline-flex align-middle">{renderValueOperator(node)}</span>}
                {node.id === "query-view" ? "Results view" : facetHoverPreview?.kind === "record" && node.id === rootPreviewNodeId ? facetHoverPreview.label : queryNodeLabel(node)}{classLabelsForQueryNode(node).length > 0 ? ` (${classLabelsForQueryNode(node).join(", ")})` : ""}
              </span>} /><TooltipContent>{node.attributes.iri ?? node.name}</TooltipContent></Tooltip>
            )}
            {inlineValues.map((value, index) => (
              <span key={value.id} className="ml-1 inline-flex max-w-full items-baseline gap-1 align-baseline">
                {index > 0 && <span>,</span>}
                {index === 0 || value.attributes.op !== inlineValues[0]?.attributes.op ? renderValueOperator(value) : null}
                <Tooltip><TooltipTrigger render={<span
                  className="min-w-0 break-words"
                >
                  {boundValueLabel(value)}
                </span>} /><TooltipContent>{`${value.text ?? ""}${value.attributes.datatype ? ` (${value.attributes.datatype})` : ""}`}</TooltipContent></Tooltip>
              </span>
            ))}
          </span>
          {showMinus && (
          <Tooltip><TooltipTrigger render={<button
            type="button"
            aria-label={
              lockedNode
                ? `${queryNodeLabel(node)} is required`
                : isRootCarrierRow
                  ? rootTextOrValue
                    ? node.name === "value" ? "Remove the root value" : "Clear the search text"
                    : topInlineStatus ? `Remove state ${(topInlineStatus.text ?? "").split("#").pop()} from the root`
                    : `Remove class ${toLabel(topInlineClass?.attributes.iri ?? "class")} from the root`
                  : topInlineValue
                    ? `Remove value ${boundValueLabel(topInlineValue)} from ${queryNodeLabel(node)}`
                    : topInlineStatus
                      ? `Remove state ${(topInlineStatus.text ?? "").split("#").pop()} from ${queryNodeLabel(node)}`
                    : topInlineClass
                      ? `Remove class ${toLabel(topInlineClass.attributes.iri ?? "class")} from ${queryNodeLabel(node)}`
                      : `Remove ${queryNodeLabel(node)} and its children`
            }
            disabled={lockedNode}
            onClick={() => {
              if (isRootCarrierRow) {
                if (rootTextOrValue) updateSearchText("");
                else if (topInlineStatus) deleteNode(topInlineStatus.id);
                else if (topInlineClass) deleteNode(topInlineClass.id);
                return;
              }
              deleteNode(topInlineValue ? topInlineValue.id : topInlineStatus ? topInlineStatus.id : topInlineClass ? topInlineClass.id : node.id);
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-base leading-none text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-25"
          >
            −
          </button>} /><TooltipContent>{lockedNode
                ? "Required query node"
                : isRootCarrierRow
                  ? rootTextOrValue
                    ? `${node.name === "value" ? "Remove the root value" : "Clear the search text"}${rootClassesOnThisNode.length > 0 ? "; click again to remove the last class" : ""}`
                    : topInlineStatus ? "Remove the last root state constraint" : "Remove the last root class constraint"
                  : topInlineValue
                    ? "Remove the bound value; click again to remove the node"
                    : topInlineStatus ? "Remove the last state constraint; click again to remove the node"
                    : topInlineClass
                      ? "Remove the last class constraint; click again to remove the node"
                      : "Remove this node and all descendants"}</TooltipContent></Tooltip>
          )}
        </div>
        {hasVisibleChildren && !isCollapsed && (
          <ul
            className="border-l border-border/70"
            style={{ marginLeft: depth * 14 + 18 }}
          >
            {visibleChildren.map((child) => <Fragment key={child.id}>{renderQueryNode(child, depth + 1)}</Fragment>)}
          </ul>
        )}
      </li>
    );
  };

  // Shared widget renderer. The left-pane version stacks widgets vertically;
  // the full Personal View keeps the original responsive grid.
  

  /**
   * Attach non-enumerable UI-only result metadata to the live query node that
   * owns the active <view>. This never changes XML, query identity, or revision.
   */
  function defineUiResultSummary(
    target: { uiResultSummary?: FctUiResultSummary },
    summary: FctUiResultSummary | undefined,
  ) {
    Object.defineProperty(target, "uiResultSummary", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: summary,
    });
  }

  function clearUiResultSummaries(nodes: FctQueryNode[]) {
    for (const node of nodes) {
      defineUiResultSummary(node, undefined);
      clearUiResultSummaries(node.children);
    }
  }

  clearUiResultSummaries(queryTree.children);
  defineUiResultSummary(queryTree, undefined);
  const firstResultForSummary = results[0];
  const resultSummary: FctUiResultSummary | undefined =
    firstResultForSummary || effectiveResultsTotalCount !== null
      ? {
          label: firstResultForSummary
            ? (firstResultForSummary.label?.trim() || firstResultForSummary.title?.trim() || toLabel(firstResultForSummary.uri))
            : effectiveResultsTotalCount !== null && effectiveResultsTotalCount > 0 ? "Example unavailable" : "—",
          count: effectiveResultsTotalCount,
        }
      : undefined;
  if (resultSummary) {
    if (queryTree.children.some((node) => node.name === "view")) {
      defineUiResultSummary(queryTree, resultSummary);
    } else {
      const attachToViewCarrier = (nodes: FctQueryNode[]): boolean => {
        for (const node of nodes) {
          if (node.children.some((child) => child.name === "view")) {
            defineUiResultSummary(node, resultSummary);
            return true;
          }
          if (attachToViewCarrier(node.children)) return true;
        }
        return false;
      };
      attachToViewCarrier(queryTree.children);
    }
  }

  // Root crumb text. In URI mode (signal-none) the readonly crumb shows the URI's label while the
  // search field keeps the URI itself. Possessive "’s" marks a node that has a successor crumb; the
  // root takes it only for the URI (signal-none) and Name (signal-low) signals.
  const rootSearchText = search.trim();
  const rootSummaryForLabel = breadcrumbPreviewSummaries["query-root"];
  if (textSearchMode === "uri" && rootSearchText && rootSummaryForLabel && !rootSummaryForLabel.zeroClasses
    && rootSummaryForLabel.uri === rootSearchText && rootSummaryForLabel.label && rootSummaryForLabel.label !== "—") {
    rootUriLabelCacheRef.current.set(rootSearchText, rootSummaryForLabel.label);
  }
  const rootUriLabel = textSearchMode === "uri" && rootSearchText
    ? (rootUriLabelCacheRef.current.get(rootSearchText) ?? toLabel(rootSearchText))
    : "";
  const rootPossessiveEligible = (textSearchMode === "uri" || textSearchMode === "name" || textSearchMode === "exact") && tutorialBreadcrumbPath.length > 0;
  const rootLabelPossessive = rootPossessiveEligible && rootSearchText ? "’s" : "";
  const rootBadgeLabelOk = Boolean(rootSummaryForLabel && !rootSummaryForLabel.zeroClasses && rootSummaryForLabel.label && rootSummaryForLabel.label !== "—");
  const rootBadgePossessive = rootPossessiveEligible && rootBadgeLabelOk ? "’s" : "";

  async function spongeCurrentUri(): Promise<void> {
    const uri = rootSearchText;
    const endpoint = fctEndpoints.find((entry) => entry.id === selectedEndpointId)?.url;
    if (!endpoint || !/^https?:\/\//i.test(uri)) {
      toast.add({ title: "Sponge URI", description: "Choose URIBurner and enter an HTTP(S) resource URI.", type: "error" });
      return;
    }
    setIsSpongingUri(true);
    try {
      const timeoutMs = readMaestroWidgetTimeouts().other * 1000;
      const response = await fetch("/proxy/api/sponge", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri, endpoint, timeoutMs }),
      });
      const payload = await response.json() as { error?: string; authorizationRequired?: boolean };
      if (!response.ok) {
        throw new Error(payload.authorizationRequired
          ? "URIBurner requires authorization for this operation. No credentials were sent."
          : payload.error || `URIBurner returned HTTP ${response.status}.`);
      }
      toast.add({ title: "URIBurner sponge requested", description: "Refreshing Maestro's URI query.", type: "success" });
      await refreshMaestroPage();
    } catch (error) {
      toast.add({ title: "URIBurner sponge failed", description: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setIsSpongingUri(false); }
  }

  const searchInputGroup = (
                  <ButtonGroup
                    aria-label="Search text and signal controls"
                    className="min-w-0 flex-1 rounded-none border-0 [&>*+*]:border-l [&>*+*]:border-input [&>span]:border-l-0 [&>input]:min-w-0 [&>input]:flex-1 [&>input]:rounded-none [&>input]:border-0 [&>input]:bg-background [&>input]:px-3 [&>input]:py-2 [&>input]:text-sm"
                  >
                    {textSearchMode === "uri" ? (
                      <>
                      <Tooltip><TooltipTrigger render={<span
                        role="img"
                        aria-label="URI"
                        className="flex h-10 shrink-0 items-center justify-center px-2 text-muted-foreground"
                      >
                        <GlobeCode className="size-4" aria-hidden="true" />
                      </span>} /><TooltipContent>{"URI"}</TooltipContent></Tooltip>
                      {/^https?:\/\//i.test(rootSearchText) && /(?:^|\.)uriburner\.com$/i.test((() => { try { return new URL(fctEndpoints.find((entry) => entry.id === selectedEndpointId)?.url ?? "").hostname; } catch { return ""; } })()) && (
                        <Tooltip><TooltipTrigger render={<button type="button" disabled={isSpongingUri} onClick={() => void spongeCurrentUri()} aria-label="Sponge URI with URIBurner" className="flex h-10 shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"><WandSparkles className="size-4" aria-hidden="true" />{isSpongingUri ? "Sponging…" : "Sponge"}</button>} /><TooltipContent>Ask URIBurner to dereference this URI, then refresh the query</TooltipContent></Tooltip>
                      )}
                      </>
                    ) : (
                      <DropdownMenu
                        open={namePropertyMenuOpen}
                        onOpenChange={(open) => {
                          setNamePropertyMenuOpen(open);
                          if (!open) setRootSearchExpanded(false);
                        }}
                      >
                        <Tooltip>
                          <TooltipTrigger render={<DropdownMenuTrigger asChild><button type="button" onMouseEnter={() => { setRootSearchExpanded(true); setNamePropertyMenuOpen(true); }} aria-label={`Choose name/label property; currently ${selectedNamePropertyLabel}`} className="flex h-10 shrink-0 items-center justify-center px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><SearchCode className="size-4" aria-hidden="true" /></button></DropdownMenuTrigger>} />
                          <TooltipContent>Choose name/label property — currently {selectedNamePropertyLabel}</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Resource names</div>
                          {([ { key: "class", label: "Category name", description: "Search classes (rdfs:Class / owl:Class)" },
                            { key: "property", label: "Property name", description: "Search RDF and OWL properties" } ] as const).map((kind) => (
                            <DropdownMenuCheckboxItem key={kind.key}
                              checked={selectedSearchResourceTypes.includes(kind.key)}
                              onSelect={(event) => event.preventDefault()}
                              onCheckedChange={(checked) => {
                                const next = checked
                                  ? [...new Set([...selectedSearchResourceTypes, kind.key])]
                                  : selectedSearchResourceTypes.filter((value) => value !== kind.key);
                                setTextSearchMode(textSearchMode === "exact" ? "exact" : "name", selectedNamePropertyUris, next);
                              }}>
                              <span className="flex flex-col"><span>{kind.label}</span><span className="text-xs text-muted-foreground">{kind.description}</span></span>
                            </DropdownMenuCheckboxItem>
                          ))}
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Matching label predicates</div>
                          {TEXT_SEARCH_NAME_PROPERTIES.map((property) => {
                            const checked = selectedNamePropertyUris.includes(property.uri);
                            return (
                              <DropdownMenuCheckboxItem
                                key={property.uri}
                                checked={checked}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(nextChecked) => {
                                  const nextProperties = nextChecked
                                    ? [...selectedNamePropertyUris, property.uri]
                                    : selectedNamePropertyUris.filter((uri) => uri !== property.uri);
                                  // Keep at least one predicate selected so Name mode never silently
                                  // becomes an unrestricted all-properties search.
                                  if (nextProperties.length) setTextSearchMode(textSearchMode === "exact" ? "exact" : "name", nextProperties);
                                }}
                              >
                                <span className="flex min-w-0 flex-1 flex-col"><span>{property.label}</span><span className="text-xs text-muted-foreground">{property.description}</span></span>
                              </DropdownMenuCheckboxItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <input
                      autoFocus
                      value={search}
                      onChange={(event) => updateSearchText(event.target.value)}
                      placeholder={textSearchMode === "uri" ? "Enter URI" : "Enter keywords"}
                      aria-label="Search results"
                      className="min-w-0 flex-1 outline-none"
                    />
                    <div
                      aria-label="Search mode"
                      className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none ${signalPickerExpanded ? "w-50" : "w-10"}`}
                      onMouseEnter={() => setSignalPickerExpanded(true)}
                      onMouseLeave={() => setSignalPickerExpanded(false)}
                      onFocusCapture={() => setSignalPickerExpanded(true)}
                      onBlurCapture={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setSignalPickerExpanded(false);
                        }
                      }}
                    >
                      <div className="inline-flex w-[12.5rem] shrink-0 overflow-hidden">
                        {(signalPickerExpanded
                          ? signalOptions
                          : [...signalOptions].sort((left, right) =>
                              left.mode === textSearchMode ? -1 : right.mode === textSearchMode ? 1 : 0,
                            )
                        ).map(({ mode, Icon, label }) => (
                          <Tooltip key={mode}>
                            <TooltipTrigger render={
                              <button
                                type="button"
                                onClick={() => {
                                  setTextSearchMode(mode);
                                  setSignalPickerExpanded(false);
                                }}
                                aria-pressed={textSearchMode === mode}
                                aria-label={label}
                                aria-hidden={!signalPickerExpanded && textSearchMode !== mode}
                                tabIndex={!signalPickerExpanded && textSearchMode !== mode ? -1 : 0}
                                className={`flex h-10 w-10 shrink-0 items-center justify-center transition-colors ${textSearchMode === mode ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
                              ><span className="relative flex size-4 items-center justify-center">{mode !== "clear" && <Signal aria-hidden="true" strokeWidth={2.5} className="absolute inset-0 size-4 text-muted-foreground/35" />}<Icon aria-hidden="true" strokeWidth={2.5} className="absolute inset-0 size-4" /></span></button>
                            } />
                            <TooltipContent>{label}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  </ButtonGroup>
  );

  // Analyze Table projects the immediate successors of the live focus, not
  // the focus's siblings. The first column is always the current focus's
  // result set; each direct relationship child becomes another column.
  const tableSlot = activePropertyPath[activePropertyPath.length - 1];
  // Keep Analyze's path identical to Browse, including retained muted ghost suffixes.
  const analyzeBreadcrumbTrail = tutorialBreadcrumbPath;
  const tableFocusNode = tableSlot ? findQueryNode(queryTree.children, tableSlot.id) : queryTree;
  const analyzeTableHeaderNodes = (tableFocusNode?.children ?? [])
    .filter((node) => (node.name === "property" || node.name === "property-of") && Boolean(node.attributes.iri))
    .map((node) => ({
      id: node.id,
      uri: node.attributes.iri || "",
      name: node.name,
    }));
  const analyzeTableHeadersKey = [tableSlot?.id ?? "query-root", ...analyzeTableHeaderNodes.map((node) => `${node.id}:${node.name}:${node.uri}`)].join("\u0000");
  // Compare Table retains its facet picker and independent value projection.
  // The regular Table only asks for the relationships represented by its headers.
  // Compare can select only relationships explicitly present at this focus
  // in the live <query>, not all discoverable Properties/Roles facets.
  const compareFacetCandidates = Array.from(new Map(analyzeTableHeaderNodes.map((node) => {
    const key = `${node.name === "property-of" ? "reverse" : "forward"}|${node.uri}`;
    return [key, { key, label: `${toLabel(node.uri, "Property")}${node.name === "property-of" ? " of" : ""}` }];
  })).values());
  const availableCompareFacets = compareFacetCandidates;
  const analyzeFacets = selectedAnalysisUri.includes("compare-table")
    ? availableCompareFacets
    : Array.from(new Map(analyzeTableHeaderNodes.map((node) => {
        const key = `${node.name === "property-of" ? "reverse" : "forward"}|${node.uri}`;
        return [key, {key, label: toLabel(node.uri, "Property") + (node.name === "property-of" ? " of" : "")}];
      })).values());
  const analysisFacetKey = analyzeFacets.map((item) => item.key).join("\u0000");
  const analysisResources = visibleResultsPage.filter((item) => item.termType !== "bnode").map((item) => ({
    value: item.uri, type: item.termType ?? "uri",
    ...(item.datatype && item.datatype !== "string" && item.termType !== "uri" ? { datatype: item.datatype } : {}),
    ...(item.lang ? { lang: item.lang } : {}),
  }));
  const analysisResourceKey = JSON.stringify(analysisResources);
  const analysisRequestKey = JSON.stringify([selectedEndpointId, queryXml, analysisFacetKey, analysisResourceKey]);
  const readyAnalysisValues = analysisValuesState?.requestKey === analysisRequestKey ? analysisValuesState.byUri : null;
  const effectiveCompareFacet = availableCompareFacets.some((facet) => facet.key === compareFacet)
    ? compareFacet : availableCompareFacets[0]?.key ?? "";
  const analysisPageKey = JSON.stringify(visibleResultsPage.map((item) => [item.uri, item.title, item.scopeValues]));
  // Column edits do not change the identity of the page's result rows. Keep the
  // XSLT-created table mounted and reconcile its children by their query node IDs.
  const analysisBaseKey = JSON.stringify([selectedEndpointId, selectedAnalysisUri, tableSlot?.id ?? "query-root",
    resultsUiPage, resultsPageSize, visibleResultsPage.map((item) => [item.uri, item.title, item.termType]),
    selectedAnalysisUri.includes("compare-table") ? effectiveCompareFacet : ""]);
  const analysisSelectionPageKey = JSON.stringify([queryXml, resultsUiPage, resultsPageSize, visibleResultsPage.map((item) => [item.uri, item.termType, item.datatype, item.lang])]);
  const analysisSelectedKeys = analysisSelection.pageKey === analysisSelectionPageKey ? analysisSelection.keys : [];
  const analysisRowKeys = visibleResultsPage.map((item, index) => `${index}:${item.uri}:${item.termType ?? "uri"}`);
  const analysisAllSelected = analysisRowKeys.length > 0 && analysisRowKeys.every((key) => analysisSelectedKeys.includes(key));
  // Discover View policies for class bindings at the active FCT focus.
  // No built-in class names or endpoint-registry membership are assumed.
  const viewScopeNodes = [queryTree, ...activePropertyPath.map((crumb) => findQueryNode(queryTree.children, crumb.id)).filter((node): node is FctQueryNode => Boolean(node))];
  const viewScopeClasses = Array.from(new Set(viewScopeNodes.flatMap((node) => node.children
    .filter((child) => child.name === "class")
    .map((child) => child.attributes.iri ?? "")
    .filter(Boolean))));
  const viewClassKey = JSON.stringify(viewScopeClasses);
  const [policyApprovalRevision, setPolicyApprovalRevision] = useState(0);
  // Analyze providers operate on the current focus resources. An ancestor
  // Bookmark class does not make a tag/text property view a Bookmark analysis.
  const analyzeFocusClasses = (() => {
    const find = (nodes: FctQueryNode[]): FctQueryNode[] | null => {
      if (nodes.some(node => node.id === "query-view")) return nodes;
      for (const node of nodes) { const found = find(node.children); if (found) return found; }
      return null;
    };
    return [...new Set((find(queryTree.children) ?? []).filter(node => node.name === "class")
      .map(node => node.attributes.iri ?? "").filter(Boolean))];
  })();
  const analyzeClassKey = JSON.stringify(analyzeFocusClasses);
  type DiscoveredView = { uri: string; label: string; icon?: string; template: string; matchedClass: string; stylesheet: string };
  const [discoveredViews, setDiscoveredViews] = useState<DiscoveredView[]>([]);
  
  
  
  
  
  
  
  
  
  
  
  
  
  useEffect(() => {
    if (workspaceTab !== "view") return;
    const classes = JSON.parse(viewClassKey) as string[];
    const controller = new AbortController();
    setDiscoveredViews([]);
    setViewDiscoveryError("");
    if (!classes.length) { setViewDiscoveryLoading(false); return; }
    setViewDiscoveryLoading(true);
    // Discovery is read-only. Do not leave View waiting indefinitely when a
    // personal SPARQL server is slow or a proxy request stalls.
    const timeout = setTimeout(() => {
      controller.abort();
      setViewDiscoveryLoading(false);
      setViewDiscoveryError("Locating views timed out. Check the personal SPARQL server and try again.");
    }, 15000);
    void (async () => {
      try {
        const response = await fetch("/proxy/api/views", { method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classes }) });
        const payload = await response.json() as { views?: DiscoveredView[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not discover Views.");
        if (!controller.signal.aborted) {
          const views = payload.views ?? [];
          setDiscoveredViews(views);
          setSelectedViewUri((current) => current || (views[0]?.uri ?? ""));
        }
      } catch (error) {
        if (controller.signal.aborted) {
          // Ignore stale requests after changing scope or leaving the View tab.
          // For the active request, the timeout callback below sets the error.
        } else {
          setViewDiscoveryError(error instanceof Error ? error.message : "Could not locate views.");
        }
      } finally {
        clearTimeout(timeout);
        if (!controller.signal.aborted) setViewDiscoveryLoading(false);
      }
    })();
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [workspaceTab, viewClassKey]);
  // Feature browsing is read-only: displaying a library NEVER records a policy
  // discovery. Only a successful resource-policy match can create Pending and
  // update mui:lastRequestedBy; a library list is not a SHACL eligibility ASK.
  const featurePageUrisKey = visibleResultsPage.map(item => item.uri).join("\u0000");
  useEffect(() => {
    if (workspaceTab !== "view" || !viewFeature) return;
    // The ordinary FCT query owns the displayed population. While it is
    // executing, never display a stale Features catalog from the prior query.
    if (isSearching) { setViewFeatureHtml(""); setViewFeatureLoading(true); return; }
    const featureUris = [...new Set(featurePageUrisKey.split("\u0000").filter(Boolean))];
    const controller = new AbortController();
    setViewFeatureLoading(true);
    setViewFeatureError("");
    setViewFeatureHtml("");
    // Hierarchy discovery may query the graph server and dereference linked ontology RDF.
    const timer = setTimeout(() => controller.abort(), 28000);
    void (async () => {
      try {
        const response = await fetch("/proxy/api/view-features", {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: controller.signal,
          body: JSON.stringify({ feature: viewFeature, featureQuery: true, queryXml: String(queryXml) }),
        });
        const data = await response.json() as { items?: FeatureItem[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not locate feature definitions.");
        if (controller.signal.aborted) return;
        const catalogByUri = new Map((data.items ?? []).map(item => [item.uri, item]));
        // FCT Results is authoritative even when a remotely discovered policy
        // lacks a local shape-graph description: render an IRI fallback rather
        // than silently dropping a resource that matches the live query.
        const items: FeatureItem[] = featureUris.map(uri => catalogByUri.get(uri) ?? { uri, label: toLabel(uri) });
        setViewFeatureCount(items.length);
        // The policy-management stylesheet receives persisted approval status,
        // never implicit authority from the discovery result.
        let decorated = items.map(item => ({ ...item, label: item.label }));
        if (viewFeature === "policies" && items.length) {
          // The personal graph, not a transient client bookmark ID, determines
          // whether approval controls may be shown. The server verifies the
          // saved query identity before returning or updating policy status.
          const approvalAction = "list";
          const approvals: { uri: string; status: string | null; triggeredBy?: string[]; lastRequestedBy?: string; lastRequestDate?: string; matchedRecord?: string; lastRequestHistory?: string; lastRequestComponent?: string }[] = [];
          const policyUris = [...new Set(items.map(item => item.uri))];
          let savedQuery = false;
          for (let offset = 0; offset < policyUris.length; offset += 500) {
            const approvalResponse = await fetch("/proxy/api/policy-approvals", {
              method: "POST", cache: "no-store", signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: approvalAction, queryXml, policies: policyUris.slice(offset, offset + 500) }),
            });
            const responseBody = await approvalResponse.json() as { entries?: typeof approvals; error?: string; bookmarkRequired?: boolean; bookmarked?: boolean };
            if (!approvalResponse.ok && responseBody.bookmarkRequired) { savedQuery = false; break; }
            if (!approvalResponse.ok) throw new Error(responseBody.error || "Could not load policy approval status.");
            savedQuery = Boolean(responseBody.bookmarked);
            approvals.push(...(responseBody.entries ?? []));
          }

          const byUri = new Map(approvals.map(entry => [entry.uri, entry]));
          // The Policies registry contains only resources actually discovered
          // during browsing. Never turn a catalog listing into Pending items.
          decorated = items.filter(item => Boolean(byUri.get(item.uri)?.lastRequestComponent) &&
              (byUri.get(item.uri)?.status === "Pending" || byUri.get(item.uri)?.status === "Approved"))
            .map(item => ({ ...item, label: item.label,
            bookmarked: savedQuery ? "true" : "false", status: byUri.get(item.uri)?.status ?? "",
            triggeredBy: (byUri.get(item.uri)?.triggeredBy ?? []).join(", "), lastRequestedBy: byUri.get(item.uri)?.lastRequestedBy ?? "", lastRequestDate: byUri.get(item.uri)?.lastRequestDate ?? "",
            lastRequestHistory: byUri.get(item.uri)?.lastRequestHistory ?? "",
            lastRequestComponent: byUri.get(item.uri)?.lastRequestComponent ?? "",
            matchedRecord: byUri.get(item.uri)?.matchedRecord ?? "" }));
          setViewFeatureCount(decorated.length);
        } else if (viewFeature === "policies") decorated = decorated.map(item => ({ ...item, bookmarked: "false" }));
        const featureHtml = await renderDiscoveredViewXslt(FEATURE_VIEW_XSLT[viewFeature], decorated);
        if (!controller.signal.aborted) setViewFeatureHtml(featureHtml);
      } catch (error) {
        if (!controller.signal.aborted) setViewFeatureError(error instanceof Error ? error.message : "Feature lookup failed.");
      } finally {
        clearTimeout(timer);
        if (!controller.signal.aborted) setViewFeatureLoading(false);
      }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceTab, viewFeature, queryXml, featurePageUrisKey, isSearching, policyApprovalRevision, isQueryBookmarked, matchingBookmarkId]);
  const selectedView = discoveredViews.find((view) => view.uri === selectedViewUri);
  // Registry keys are internal slugs, while FCT results contain RDF resource IRIs.
  // Join on endpoint URL first; also accept the registry's display label for
  // entries whose RDF subject is not their HTTP endpoint URL (e.g. personal).
  const endpointForViewResult = (uri: string, label: string): EndpointOption | undefined => {
    const normalized = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
    const exact = fctEndpoints.find((endpoint) => normalized(endpoint.url) === normalized(uri) || endpoint.id === uri);
    if (exact) return exact;
    const labelMatches = fctEndpoints.filter((endpoint) => normalized(endpoint.label) === normalized(label));
    if (labelMatches.length === 1) return labelMatches[0];
    // Graph-server resources sometimes use the site origin instead of /sparql.
    try {
      const candidate = new URL(uri);
      const hostMatches = fctEndpoints.filter((endpoint) => {
        try { return new URL(endpoint.url).host === candidate.host; } catch { return false; }
      });
      if (hostMatches.length === 1) return hostMatches[0];
    } catch { /* RDF identifiers need not be HTTP URLs. */ }
    return undefined;
  };
  
  const viewSoftwareIds = Array.from(new Set(visibleResultsPage.map((result) => endpointForViewResult(result.uri, result.title)?.id).filter((id): id is string => Boolean(id))));
  const viewSoftwareKey = JSON.stringify(viewSoftwareIds);
  useEffect(() => {
    if (workspaceTab !== "view" || !selectedView) return;
    const controller = new AbortController();
    for (const id of JSON.parse(viewSoftwareKey) as string[]) {
      if (viewServerSoftware[id]) continue;
      void (async () => {
        try {
          const response = await fetch(`/proxy/api/server-software?endpointId=${encodeURIComponent(id)}`, { signal: controller.signal });
          if (!response.ok) return;
          const data = await response.json() as { product?: string; version?: string };
          if (!controller.signal.aborted) setViewServerSoftware((current) => ({ ...current, [id]: { product: data.product || "Unknown", version: data.version || "" } }));
        } catch { /* Product detection is optional and must never gate the View. */ }
      })();
    }
    return () => controller.abort();
  }, [workspaceTab, selectedView?.uri, viewSoftwareKey, viewServerSoftware]);
  
  useEffect(() => {
    if (workspaceTab !== "view" || !selectedView) return;
    const controller = new AbortController();
    for (const id of JSON.parse(viewSoftwareKey) as string[]) {
      if (Object.prototype.hasOwnProperty.call(viewServerDescriptions, id)) continue;
      void (async () => {
        try {
          const response = await fetch(`/proxy/api/server-description?endpointId=${encodeURIComponent(id)}`, { signal: controller.signal });
          if (!response.ok) return;
          const data = await response.json() as { description?: string };
          if (!controller.signal.aborted) setViewServerDescriptions((current) => ({ ...current, [id]: data.description ?? "" }));
        } catch { /* Optional descriptions must not block View rendering. */ }
      })();
    }
    return () => controller.abort();
  }, [workspaceTab, selectedView?.uri, viewSoftwareKey, viewServerDescriptions]);
  const viewResultDomains = Array.from(new Set(visibleResultsPage.map((result) => {
    const endpoint = endpointForViewResult(result.uri, result.title);
    try { return new URL(endpoint?.url ?? result.uri).hostname.replace(/^www\./i, "").toLowerCase(); }
    catch { return ""; }
  }).filter(Boolean)));
  const viewDomainKey = JSON.stringify(viewResultDomains);
  useEffect(() => {
    if (workspaceTab !== "view" || !selectedView) return;
    const domains = JSON.parse(viewDomainKey) as string[];
    const controller = new AbortController();
    // The server-side proxy caches rankings. Unknown domains are shown as unranked.
    void Promise.all(domains.slice(0, 30).map(async (domain) => {
      try {
        const response = await fetch(`/proxy/api/site-rank?domain=${encodeURIComponent(domain)}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { rank?: number | null };
        if (!controller.signal.aborted) setViewDomainRanks((prev) => ({ ...prev, [domain]: data.rank ? `#${data.rank.toLocaleString()}` : "Unranked" }));
      } catch { /* Optional ranking must never block the View. */ }
    }));
    return () => controller.abort();
  }, [workspaceTab, selectedView?.uri, viewDomainKey]);
  const viewPageKey = JSON.stringify(allLoadedResults.map((item) => [item.uri, item.title]));
  useEffect(() => {
    if (workspaceTab !== "view" || !selectedView) { setViewHtml(""); setViewRenderError(""); return; }
    let canceled = false;
    void (async () => {
    try {
      const rows = (JSON.parse(viewPageKey) as [string,string][]).map(([uri,label]) => {
        const endpoint = endpointForViewResult(uri, label);
        const endpointUrl = endpoint?.url ?? uri;
        let domain = "";
        let favicon = "";
        try {
          const url = new URL(endpointUrl);
          domain = url.hostname.replace(/^www\./i, "").toLowerCase();
          if (["https:", "http:"].includes(url.protocol)) favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
        } catch { /* A non-HTTP resource URI has no web favicon. */ }
        const health = endpoint ? endpointStatuses[endpoint.id] : undefined;
        const software = endpoint ? viewServerSoftware[endpoint.id] : undefined;
        const healthText = checkingEndpointIds[endpoint?.id ?? ""] ? "Checking…" : health?.status !== null && health?.status !== undefined ? `HTTP ${health.status}` : health ? health.state : "Not yet pinged";
        const healthColor = !health ? "unknown" : health.status === 200 ? "green" : health.status !== null && health.status >= 500 ? "red" : "amber";
        return { uri, label, endpoint: endpointUrl, endpointId: endpoint?.id ?? "", selected: Boolean(endpoint && endpoint.id === selectedEndpointId), group: endpoint?.group ?? "",
          favicon, rank: domain ? (viewDomainRanks[domain] ?? "Checking…") : "Unranked",
          health: healthText, healthState: healthColor, pinging: Boolean(endpoint && checkingEndpointIds[endpoint.id]), product: software?.product ?? "Unknown", version: software?.version ?? "",
          description: endpoint ? (viewServerDescriptions[endpoint.id] ?? "") : "" };
      });
      const start = resultsUiPage * effectivePageSize;
      const html = await renderDiscoveredViewXslt(selectedView.stylesheet, rows.slice(start, start + effectivePageSize), {
        availableRows: rows, page: resultsUiPage, pageSize: effectivePageSize,
      });
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const meta = parsed.querySelector("section[data-view-title], section[data-view-icon]");
      const icon = meta?.getAttribute("data-view-icon") ?? undefined;
      if (canceled) return;
      setViewXsltMetadata({ title: meta?.getAttribute("data-view-title") ?? undefined, icon });
      setViewHtml(html);
      setViewRenderError("");
    } catch (error) { if (!canceled) { setViewHtml(""); setViewRenderError(error instanceof Error ? error.message : "View translation failed."); } }
    })();
    return () => { canceled = true; };
  }, [workspaceTab, selectedView?.uri, selectedView?.stylesheet, viewPageKey, endpointStatuses, fctEndpoints, viewDomainRanks, viewServerSoftware, viewServerDescriptions, checkingEndpointIds, selectedEndpointId, resultsUiPage, effectivePageSize]);
  const isCompareAnalysis = selectedAnalysisUri.includes("compare-table");
  const histogramColumns = isCompareAnalysis && analysisTable ? analysisTable.columns.slice(1).map((column, index) => ({
    label: /^[a-z][a-z0-9+.-]*:/i.test(column.label) ? toLabel(column.label, "OBJECT") : column.label,
    count: analysisTable.rows.reduce((sum, row) => sum + (row.cells[index]?.checked ? 1 : 0), 0),
  })) : [];

  function toggleAnalysisRow(key: string, checked: boolean) {
    setAnalysisSelection((current) => {
      const keys = current.pageKey === analysisSelectionPageKey ? current.keys : [];
      return { pageKey: analysisSelectionPageKey, keys: checked ? Array.from(new Set([...keys, key])) : keys.filter((existing) => existing !== key) };
    });
  }

  // Fetch per-record values through the existing FCT list-values extension.
  // This is a separate Analyze projection, never a change to the live <query>
  // and never gated by the Results badges setting.
  useEffect(() => {
    if (workspaceTab !== "analyze" || !endpointReadyForQuery || !analysisResourceKey || !analysisFacetKey) return;
    const controller = new AbortController();
    setAnalysisValuesError("");
    void (async () => {
      try {
        const columns: ListValueProjection[] = analysisFacetKey.split("\u0000").map((key) => {
          const separator = key.indexOf("|");
          return {
            direction: key.slice(0, separator) === "reverse" ? "reverse" as const : "forward" as const,
            property: key.slice(separator + 1),
          };
        });
        const projectionQueryXml = listValuesQueryClone(queryXml);
        // Virtuoso's list-values extension accepts at most 100 RDF terms per
        // request. Analyze pages may contain more; preserve the page selection
        // while projecting its terms through bounded, deduplicated requests.
        const uniqueResources = Array.from(new Map(analysisResources.map((term) => [
          JSON.stringify([term.value, term.type, term.datatype ?? "", term.lang ?? ""]), term,
        ])).values());
        const byUri = new Map<string, ScopeValue[]>();
        const maxResourcesPerRequest = LIST_VALUES_MAX_RESOURCES;
        for (let start = 0; start < uniqueResources.length; start += maxResourcesPerRequest) {
          if (controller.signal.aborted) return;
          const resources = uniqueResources.slice(start, start + maxResourcesPerRequest);
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: {"Content-Type": "application/json", ...proxyDebugHeaders("analyze-values", `AnalyzeListValues:${proxyDebugFingerprint(analysisRequestKey)}:${start / maxResourcesPerRequest + 1}`)},
            body: JSON.stringify({queryXml: projectionQueryXml, resources, projections: columns}),
          });
          const xml = await response.text();
          if (!response.ok) throw new Error(`Analyze list-values batch ${start / maxResourcesPerRequest + 1} returned HTTP ${response.status}: ${xml.slice(0, 300)}`);
          for (const [uri, values] of parseListValuesXml(xml)) byUri.set(uri, values);
        }
        if (!controller.signal.aborted) setAnalysisValuesState({requestKey: analysisRequestKey, byUri});
      } catch (error) {
        if (!controller.signal.aborted) {
          setAnalysisValuesError(error instanceof Error ? error.message : "Could not load Analyze facet values.");
          console.warn("Analyze facet values failed:", error);
        }
      }
    })();
    return () => controller.abort();
  }, [workspaceTab, endpointReadyForQuery, analysisRequestKey, analysisFacetKey, analysisResourceKey, queryXml]);

  useEffect(() => {
    if (workspaceTab !== "analyze") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/proxy/api/analyze?classes=${encodeURIComponent(analyzeClassKey)}`, {cache:"no-store",signal:controller.signal});
        const payload = await response.json() as {analyses?: AnalysisDefinition[]; error?:string};
        if (!response.ok) throw new Error(payload.error || "Could not discover Analyze policies.");
        if (!controller.signal.aborted) {
          const definitions = payload.analyses ?? [];
          setAnalysisDefinitions(definitions);
          setSelectedAnalysisUri((current) => definitions.some((item) => item.uri === current) ? current : (definitions[0]?.uri ?? ""));
        }
      } catch (error) {
        if (!controller.signal.aborted) setAnalysisError(error instanceof Error ? error.message : "Analysis discovery failed.");
      }
    })();
    return () => controller.abort();
  }, [workspaceTab, analyzeClassKey]);

  useEffect(() => {
    if (workspaceTab !== "analyze") return;
    if (selectedAnalysisUri === "gttp://ggg.maestro.ecosys/analyze/bookmark-activity" ||
        selectedAnalysisUri === "gttp://ggg.maestro.ecosys/analyze/bookmark-tags") {
      setAnalysisTable(null);
      setAnalysisLoading(false);
      analysisRenderedBaseRef.current = "";
      return;
    }
    const definition = analysisDefinitions.find((item) => item.uri === selectedAnalysisUri);
    if (!definition) { setAnalysisTable(null); analysisRenderedBaseRef.current = ""; return; }
    // Structural edits to the live focus's immediate children only add/remove
    // a column. Reuse all existing result rows, cells, DOM and handlers.
    if (!selectedAnalysisUri.includes("compare-table") && analysisRenderedBaseRef.current === analysisBaseKey) {
      setAnalysisTable((previous) => {
        if (!previous) return previous;
        const existing = new Map(previous.columns.filter((column) => column.kind === "breadcrumb").map((column) => [column.nodeId, column]));
        const resultColumn = previous.columns.find((column) => column.kind === "result") ?? {
          kind: "result", nodeId: "", label: "Results", breadcrumbStyle: {}, headerStyle: {},
        };
        // New headers inherit XSLT presentation-only styles from an existing
        // breadcrumb column. The interaction comes from the shared renderer.
        const stylesheetColumn = previous.columns.find((column) => column.kind === "breadcrumb");
        const columns = [resultColumn, ...analyzeTableHeaderNodes.map((node) => existing.get(node.id) ?? {
          kind: "breadcrumb", nodeId: node.id, label: toLabel(node.uri, "Property"),
          breadcrumbStyle: stylesheetColumn?.breadcrumbStyle ?? {},
          headerStyle: stylesheetColumn?.headerStyle ?? {},
        })];
        if (columns.length === previous.columns.length && columns.every((column, index) => column === previous.columns[index])) return previous;
        const oldCellByNode = new Map(previous.columns.slice(1).map((column, index) => [column.nodeId, index]));
        return { ...previous, columns, rows: previous.rows.map((row) => ({
          ...row,
          cells: columns.slice(1).map((column) => {
            const index = oldCellByNode.get(column.nodeId);
            return index === undefined
              ? { checked: false, badgeStyle: row.cells[0]?.badgeStyle ?? {}, cellStyle: row.cells[0]?.cellStyle ?? {}, values: [] }
              : row.cells[index];
          }),
        })) };
      });
      return;
    }
    const controller = new AbortController();
    // Keep the previous table visible while a genuinely new page/focus loads.
    setAnalysisLoading(true);
    setAnalysisError("");
    void (async () => {
      try {
        const ns = "gttp://ggg.maestro.ecosys/ns/xslt/context#";
        const doc = document.implementation.createDocument(ns, "mctx:context", null);
        const root = doc.documentElement;
        const add = (parent: Element, name: string) => {
          const element = doc.createElementNS(ns, `mctx:${name}`);
          parent.appendChild(element);
          return element;
        };
        const liveQuery = add(root,"live-query");
        const query = new DOMParser().parseFromString(queryXml, "application/xml");
        if (query.getElementsByTagName("parsererror").length) throw new Error("The FCT query is not well-formed XML.");
        liveQuery.appendChild(doc.importNode(query.documentElement, true));
        const breadcrumbRoot = add(root,"breadcrumbs");
        // The Table XSLT receives only immediate child relationship references.
        // The first (focus/result) header is rendered separately by Maestro.
        // Each child ID resolves to the existing live breadcrumb renderer.
        analyzeTableHeaderNodes.forEach((crumb) => {
          const node = add(breadcrumbRoot,"breadcrumb");
          node.setAttribute("id",crumb.id);
          node.setAttribute("iri",crumb.uri);
          node.setAttribute("direction",crumb.name === "property-of" ? "reverse" : "forward");
          node.setAttribute("label",toLabel(crumb.uri, "Property"));
        });
        // No generic facet columns in Table: only direct children of the
        // live focus. Keep the element for backwards compatibility with XSLT.
        add(root,"extra-facets");
        const selection = add(root,"selection");
        const [direction,facet] = effectiveCompareFacet.split("|",2);
        selection.setAttribute("direction",direction || "forward");
        selection.setAttribute("facet",facet || "");
        const resultRoot = add(root,"results");
        visibleResultsPage.forEach((result) => {
          const resultElement = add(resultRoot,"result");
          resultElement.setAttribute("uri",result.uri);
          resultElement.setAttribute("label",result.title || result.uri);
          // The independent Analyze projection supplies values even if Results
          // badges are disabled. Keep already-known badge values as a fallback.
          const byFacet = new Map<string, ScopeValue>();
          for (const scope of result.scopeValues ?? []) byFacet.set(`${scope.direction}|${scope.property}`, scope);
          for (const scope of readyAnalysisValues?.get(result.uri) ?? []) byFacet.set(`${scope.direction}|${scope.property}`, scope);
          Array.from(byFacet.values()).forEach((scope) => scope.values.forEach((value) => {
            if (!value.value || value.value === "-") return;
            const element = add(resultElement,"value");
            element.setAttribute("property",scope.property);
            element.setAttribute("direction",scope.direction);
            element.setAttribute("termType",value.type || "literal");
            element.textContent = value.value;
          }));
        });
        const xml = await transformWithMaestroSaxon(
          definition.stylesheet,
          new XMLSerializer().serializeToString(doc),
          { outputLimit: 100000, signal: controller.signal },
        );
        const transformed = new DOMParser().parseFromString(xml,"application/xml");
        const analysis = transformed.documentElement;
        if (analysis.localName !== "analysis" || transformed.getElementsByTagName("parsererror").length) throw new Error("Analysis XSLT must return an analysis element.");
        const columns = Array.from(analysis.getElementsByTagName("columns")[0]?.children ?? []).map((node) => ({
          kind:node.getAttribute("kind") ?? "",nodeId:node.getAttribute("node-id") ?? "",label:node.getAttribute("label") ?? "",breadcrumbStyle:analysisPresentationStyle(node.getAttribute("breadcrumb-style")),headerStyle:analysisPresentationStyle(node.getAttribute("header-style")),
        }));
        const rows = Array.from(analysis.getElementsByTagName("rows")[0]?.children ?? []).map((node) => ({
          uri:node.getAttribute("uri") ?? "",label:node.getAttribute("label") ?? "",
          cells:Array.from(node.children).map((cell) => ({checked:cell.getAttribute("checked") === "yes", badgeStyle:analysisPresentationStyle(cell.getAttribute("badge-style") ?? analysis.getAttribute("badge-style")), cellStyle:analysisPresentationStyle(cell.getAttribute("cell-style")), values:Array.from(cell.children).map((value) => value.textContent || "")})),
        }));
        if (!controller.signal.aborted) { analysisRenderedBaseRef.current = analysisBaseKey; setAnalysisTable({
          trailStyle: analysisPresentationStyle(analysis.getAttribute("trail-style")),
          tableStyle: analysisPresentationStyle(analysis.getAttribute("table-style")),
          headerStyle: analysisPresentationStyle(analysis.getAttribute("header-style")),
          cellStyle: analysisPresentationStyle(analysis.getAttribute("cell-style")),
          rowStyle: analysisPresentationStyle(analysis.getAttribute("row-style")),
          columns, rows,
        }); }
      } catch (error) {
        if (!controller.signal.aborted) setAnalysisError(error instanceof Error ? error.message : "Analysis transformation failed.");
      } finally { if (!controller.signal.aborted) setAnalysisLoading(false); }
    })();
    return () => controller.abort();
  }, [workspaceTab, analysisDefinitions, selectedAnalysisUri, queryXml, analyzeTableHeadersKey, analysisPageKey, effectiveCompareFacet, analysisRequestKey, analysisValuesState, analysisBaseKey]);

  // One interactive value badge renderer for Browse cards and Analyze cells.
  // Navigation and tooltip semantics must remain identical in both layouts.
  

  // A single root breadcrumb control is shared by Browse and Analyze.
  // Keep all search, class, preview, and navigation interactions in one JSX tree.
  

  // Single breadcrumb implementation for both Browse and Analyze table headers.
  // All query mutations, sibling menus, preview metadata and active state stay here.
  

    return {
    buildCurrentShareUrl,
    queryActivityPending: isSearching || isCountingResults || isLoadingProperties || isLoadingRoles || isLoadingClasses || isLoadingCategoryTree || isLoadingGraphs || isLoadingAlphabet || groupValuesLoading || loadingRecordGraphs || loadingRecordAuthors || isLoadingRecordPolicy || isDescribing || viewDiscoveryLoading || viewFeatureLoading || isValidatingRecord,
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
    personalStoreReady,
    recordStatus,
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
    graphRegistryReady,
    endpointReadyForQuery,
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
    isLoadingCategoryTree,
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
    setLeftWidgetLimit,
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
    navigatePropertyUsage,
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
    cancelMaestroPage,
    refreshQuery,
    renderQueryNode,
    resetQuery: resetHomeQuery,
    startCategoryNameSearch,
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
    setPersonalDateRange,
    removeProperty,
    getPropertyPath,
    setRootSearchExpanded,
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
    selectViewFeature,
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
    policyApprovalRevision,
    setPolicyApprovalRevision,
    viewFeatureLoading,
    viewHtml,
    viewPanel,
    viewRenderError,
    visibleClassDisplayFacets,
    visibleGroupValues,
    visibleResultsPage,
    widgetTimeouts,
    queryConcurrency,
    changeQueryConcurrency,
    workspaceTab,
    findPropertyPathNode,
    personalWidgetCardRefs,
    setFacetCandidateCounts,
    ActiveSignalIcon,
    activeBreadcrumbButtonRef,
    boundValueLabel,
    boundValueNodes,
    breadcrumbBadgeMode,
    breadcrumbPreviewPendingIds,
    breadcrumbPreviewSummaries,
    classBreadcrumbLabels,
    compactIri,
    getBreadcrumbSiblings,
    handleBreadcrumbClick,
    handleRootBreadcrumbClick,
    hoveredBreadcrumbBadgeId,
    namePropertyMenuOpen,
    openBreadcrumbDropdownId,
    popBreadcrumbOrBinding,
    renderBreadcrumbMenuHeader,
    renderBreadcrumbNodeMenuItem,
    rootBadgePossessive,
    rootLabelPossessive,
    rootSearchExpanded,
    rootSearchText,
    rootUriLabel,
    rootUriValues,
    searchInputGroup,
    setHoveredBreadcrumbBadgeId,
    setOpenBreadcrumbDropdownId,
    signalOptions,
    textSearchMode,
    toggleBreadcrumbBadgeMode,
    tutorialBreadcrumbTargetId,
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
