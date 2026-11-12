"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";

import { EndpointStatusIcon } from "@/canvas/top/appbar";

import maestroLanguages from "@/data/maestro-languages.json";

import { Fragment, useEffect, useState } from "react";
import { subscribePendingMaestroQueries, subscribePendingMaestroQueryDetails, cancelIndividualMaestroQuery, type PendingMaestroQuery } from "@/lib/client-query-cache";

import { rememberNamespaceMetadata } from "@/lib/uri-labels";
import { proxyDebugHeaders } from "@/lib/proxy-debug";

import { ButtonGroup } from "@/components/ui/button-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback, AvatarBadge } from "@/components/ui/avatar";
import { Toggle } from "@/components/ui/toggle";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Check, ChevronDown, Network, Link, CirclePlay, AtSign, X, LoaderCircle, ArrowLeft, ArrowRight, ClockArrowRight, Clock1, Clock2, Clock3, Clock4, Clock5, Clock6, Clock7, Clock8, Clock9, Clock10, Clock11, Clock12, Home, RotateCw, RefreshCw, Bookmark, User, LogOut, KeyRound, Eye, EyeOff, Info, WandSparkles } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { AuthType, clearPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";
import { ALL_GRAPHS } from "@/lib/graph-address-mode";

import { Button } from "@/components/ui/button";

import { serializeFctQuery } from "@/lib/fct-query-api";

// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.

const MAESTRO_ALPHABET_LANGUAGES = maestroLanguages;
// Runtime bookmark shortcuts use Lucide's dynamic loader instead of importing
// every icon into the appbar's initial bundle. Validate persisted names too.
const availableAppbarIconNames = new Set<string>(iconNames);
const BOOKMARK_CLOCKS = [Clock1, Clock2, Clock3, Clock4, Clock5, Clock6, Clock7, Clock8, Clock9, Clock10, Clock11, Clock12] as const;

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

import { SettingsPane } from "@/canvas/sheet/settings-pane";
import type { AppBarWorkspace } from "@/canvas/controllers/workspace-interfaces";

/** UI owned by AppBarSection. State and commands come from the shared workspace controller. */
export function AppBarSection({ workspace }: { workspace: AppBarWorkspace }) {
  const [pendingQueryCount, setPendingQueryCount] = useState(0);
  const [pendingQueryDetails, setPendingQueryDetails] = useState<PendingMaestroQuery[]>([]);
  const [appbarButtons, setAppbarButtons] = useState<{uri:string;action:string;icon:string;tooltip:string;url:string}[]>([]);
  // Use the bookmark's authoritative FCT query, not the full URL: UI state,
  // History cursor and parameter order can differ for the same saved query.
  const matchedAppbarButton = (workspace.isQueryBookmarked && workspace.matchingBookmarkId
    ? appbarButtons.find(button => button.action === workspace.matchingBookmarkId)
    : undefined) ?? (typeof window === "undefined" ? undefined : appbarButtons.find(button => {
    try {
      const bookmarkedQuery = new URL(button.url, window.location.origin).searchParams.get("q");
      return bookmarkedQuery !== null && canonicalQueryIdentityXml(bookmarkedQuery) === canonicalQueryIdentityXml(workspace.queryXml);
    } catch { return false; }
  }));
  useEffect(() => {
    if (!workspace.authSession) { setAppbarButtons([]); return; }
    let mounted = true;
    const refresh = async () => {
      try {
        const response = await fetch("/proxy/api/appbar-buttons", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list"}),cache:"no-store"});
        if (!response.ok) return;
        const payload = await response.json() as {buttons?:typeof appbarButtons};
        if (mounted) setAppbarButtons(payload.buttons ?? []);
      } catch { /* Loading optional appbar providers must not block the appbar. */ }
    };
    void refresh();
    window.addEventListener("maestro:appbar-buttons-updated", refresh);
    return () => { mounted = false; window.removeEventListener("maestro:appbar-buttons-updated", refresh); };
  }, [workspace.authSession]);
  const [bookmarkAttention, setBookmarkAttention] = useState(false);
  const [policyBookmarkVisible, setPolicyBookmarkVisible] = useState(false);
  const [bookmarkBounce, setBookmarkBounce] = useState(false);
  // The existing bookmark workflow can await History persistence and a metadata read.
  // Show its elapsed wall time on the button until the dialog becomes available.
  const [bookmarkOpening, setBookmarkOpening] = useState(false);
  const [bookmarkOpeningTenths, setBookmarkOpeningTenths] = useState(0);
  const BookmarkLoadingClock = BOOKMARK_CLOCKS[Math.floor(bookmarkOpeningTenths / 5) % BOOKMARK_CLOCKS.length];
  useEffect(() => {
    if (!bookmarkOpening) return;
    const startedAt = performance.now();
    setBookmarkOpeningTenths(0);
    const timer = window.setInterval(() => {
      setBookmarkOpeningTenths(Math.floor((performance.now() - startedAt) / 100));
    }, 100);
    return () => window.clearInterval(timer);
  }, [bookmarkOpening]);
  useEffect(() => {
    const policyRequest = (event: Event) => {
      const active = Boolean((event as CustomEvent<{ active: boolean }>).detail?.active);
      setPolicyBookmarkVisible(active);
      setBookmarkAttention(active);
      setBookmarkBounce(active);
    };
    window.addEventListener("maestro:policy-bookmark-attention", policyRequest);
    return () => window.removeEventListener("maestro:policy-bookmark-attention", policyRequest);
  }, []);
  useEffect(() => {
    if (workspace.isQueryBookmarked) setBookmarkBounce(false);
  }, [workspace.isQueryBookmarked]);
  useEffect(() => { if (workspace.isQueryBookmarked) setBookmarkAttention(false); }, [workspace.isQueryBookmarked]);
  useEffect(() => subscribePendingMaestroQueries(setPendingQueryCount), []);
  useEffect(() => subscribePendingMaestroQueryDetails(setPendingQueryDetails), []);
  const {
    applyGraphText,
    authRestoreIssue,
    authSession,
    bookmarkDescription,
    bookmarkDialogOpen,
    bookmarkImportFileRef,
    bookmarkSaving,
    bookmarkTagVocabulary,
    bookmarkTags,
    effectiveResultsTotalCount,
    recordStatus,
    bookmarkTitle,
    bookmarkTitleInputRef,
    browserLogLevel,
    browserLogging,
    changeWidgetTimeout,
    chooseFctEndpoint,
    clearGraph,
    clearTutorialPreview,
    controlsSheetOpen,
    deleteBookmarks,
    deleteCurrentQueryHistory,
    endpointChecksCompleted,
    endpointChecksTotal,
    endpointStatuses,
    exitEverywhere,
    exportBookmarks,
    fctEndpoints,
    fetchedAvatarUrl,
    findEndpointsEnabled,
    formatHistoryAction,
    graphAlreadySelected,
    graphAutoFill,
    graphInfo,
    graphInfoOpen,
    graphProbe,
    graphProbeIdentity,
    graphText,
    groupBatchSize,
    handleFetchProfile,
    handleLoginSubmit,
    handleTestConnection,
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
    importBookmarks,
    isCheckingEndpoints,
    isDeletingCurrentHistory,
    isDeletingHistory,
    isExportingBookmarks,
    isFetchingAvatar,
    isImportingBookmarks,
    isLoadingHistoryQuery,
    isQueryBookmarked,
    leftPanelLimit,
    loadHistoryQuery,
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
    matchingBookmarkId,
    navigateQueryHistory,
    openGraphInfo,
    orderResults,
    panelLimitsOpen,
    pendingCenterBatchLimit,
    pendingGroupsBatchLimit,
    pendingHistoryVisitRef,
    pendingLeftPanelLimit,
    pendingRecordDescriptionLimit,
    personalSparqlEndpoint,
    preferredAlphabetLanguage,
    prefixSource,
    prefixStatus,
    queryTree,
    queryTreeHeightDbRef,
    queryXml,
    recordDescriptionPageSize,
    recordDescriptionQueryLimit,
    refreshMaestroPage,
    cancelMaestroPage,
    queryActivityPending,
    refreshQuery,
    resetQuery,
    setSearch,
    setGroupByPropertyUri,
    setSearchPipelineRun,
    centralTab,
    restoreHistoryActionItem,
    resultsBatchSize,
    selectedEndpointId,
    selectedEndpointStatus,
    setAuthRestoreIssue,
    setAuthSession,
    setAutoConfiguredFacetKeys,
    setBookmarkCheckRevision,
    setBookmarkDescription,
    setBookmarkDialogOpen,
    setBookmarkSaving,
    setBookmarkTagVocabulary,
    setBookmarkTags,
    setBookmarkTitle,
    setBrowserLogLevel,
    setBrowserLogging,
    setCentralTab,
    setClearCacheDialogOpen,
    setControlsSheetOpen,
    setDeleteHistoryDialogOpen,
    setEndpointReloadRevision,
    setFacetAutofillCandidates,
    setFacetUsageRevision,
    setFindEndpointsEnabled,
    setGraphAutoFill,
    setGraphInfoOpen,
    setGraphText,
    setHistoryBookmarkId,
    setIsQueryBookmarked,
    setIsRdfLoaderOpen,
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
    setOrderResults,
    setPanelLimitsOpen,
    setPendingCenterBatchLimit,
    setPendingGroupsBatchLimit,
    setPendingLeftPanelLimit,
    setPendingRecordDescriptionLimit,
    setPersonalPoliciesReady,
    setPersonalPoliciesSeedError,
    setPreferredAlphabetLanguage,
    setPrefixSource,
    setQueryAttribute,
    setRecordDescriptionPage,
    setRecordDescriptionPageSize,
    setShareLinkCopied,
    setTimeoutEditorOpen,
    setTutorialMode,
    setWidgetTimeouts,
    setWorkspaceTab,
    shareLinkCopied,
    startHistoryActionHover,
    stopHistoryActionHover,
    timeoutEditorOpen,
    tutorialMode,
    widgetTimeouts,
    workspaceTab,
  } = workspace;
  const showCancel = pendingQueryCount > 0 || queryActivityPending;
  return (
<header className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-2">
          <ButtonGroup aria-label="Graph navigation" className="shrink-0 border-0 shadow-none">
            {authSession && (<>
            <Tooltip disableHoverablePopup={false}><TooltipTrigger render={<button type="button" onMouseEnter={() => startHistoryActionHover("backward")} onMouseLeave={stopHistoryActionHover} onClick={() => void navigateQueryHistory("backward")} aria-label="Previous query in history" aria-busy={historyNavigationPending === "backward"} disabled={!historyHasOlder || historyNavigationPending !== null} className={`inline-flex size-9 items-center justify-center rounded-none border-0 px-2 hover:bg-accent active:bg-black/25 disabled:cursor-not-allowed disabled:opacity-40 ${historyNavigationPending !== null ? "bg-muted text-muted-foreground" : ""}`}><span className="inline-flex" aria-hidden="true">{historyNavigationPending === "backward" ? <ClockArrowRight className="size-4 scale-x-[-1]" /> : <ArrowLeft className="size-4" />}</span></button>} /><TooltipContent className={historyActionMenu === "backward" ? "!max-w-none max-w-[min(36rem,calc(100vw-1rem))] p-2" : ""} onMouseEnter={() => { if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current); }} onMouseLeave={stopHistoryActionHover}>{historyActionMenu === "backward" ? <div className="w-[min(34rem,calc(100vw-2rem))] text-background"><div className="px-1 pb-2 text-xs font-semibold">Earlier in History</div><div className="max-h-64 overflow-auto">{historyActionItems.map((item) => <button type="button" key={item.historyId} onClick={() => void restoreHistoryActionItem(item.historyId)} className="block w-full border-t border-background/20 px-1 py-2 text-left text-xs hover:bg-background/10"><div className="break-all font-mono">{formatHistoryAction(item.action, "backward")}</div><div className="mt-1 opacity-70">{item.created ? new Date(item.created).toLocaleString() : ""}</div></button>)}</div></div> : historyNavigationPending === "backward" ? "Loading previous query…" : "Previous query in History"}</TooltipContent></Tooltip>
            <Tooltip disableHoverablePopup={false}><TooltipTrigger render={<button type="button" onMouseEnter={() => startHistoryActionHover("forward")} onMouseLeave={stopHistoryActionHover} onClick={() => void navigateQueryHistory("forward")} aria-label="Next query in history" aria-busy={historyNavigationPending === "forward"} disabled={!historyHasNewer || historyNavigationPending !== null} className={`inline-flex size-9 items-center justify-center rounded-none border-0 px-2 hover:bg-accent active:bg-black/25 disabled:cursor-not-allowed disabled:opacity-40 ${historyNavigationPending !== null ? "bg-muted text-muted-foreground" : ""}`}>{historyNavigationPending === "forward" ? <ClockArrowRight className="size-4" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}</button>} /><TooltipContent className={historyActionMenu === "forward" ? "!max-w-none max-w-[min(36rem,calc(100vw-1rem))] p-2" : ""} onMouseEnter={() => { if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current); }} onMouseLeave={stopHistoryActionHover}>{historyActionMenu === "forward" ? <div className="w-[min(34rem,calc(100vw-2rem))] text-background"><div className="px-1 pb-2 text-xs font-semibold">Later in History</div><div className="max-h-64 overflow-auto">{historyActionItems.map((item) => <button type="button" key={item.historyId} onClick={() => void restoreHistoryActionItem(item.historyId)} className="block w-full border-t border-background/20 px-1 py-2 text-left text-xs hover:bg-background/10"><div className="break-all font-mono">{formatHistoryAction(item.action, "forward")}</div><div className="mt-1 opacity-70">{item.created ? new Date(item.created).toLocaleString() : ""}</div></button>)}</div></div> : historyNavigationPending === "forward" ? "Loading next query…" : "Next query in History"}</TooltipContent></Tooltip>
            </>)}
            <Tooltip><TooltipTrigger render={<button type="button" onClick={() => {
              resetQuery();
              setSearch("");
              setGroupByPropertyUri("");
              if (centralTab === "groups") setCentralTab("results");
              setSearchPipelineRun((current) => current + 1);
            }} aria-label="Reset query to home" className="inline-flex size-9 items-center justify-center rounded-none border-0 px-2 hover:bg-accent active:bg-black/25"><Home className="size-4" aria-hidden="true" /></button>} /><TooltipContent>Reset query</TooltipContent></Tooltip>
            <Tooltip disableHoverablePopup={false}><TooltipTrigger render={<button type="button" onClick={() => { if (showCancel) cancelMaestroPage(); else void refreshMaestroPage(); }} aria-label={showCancel ? "Cancel pending queries" : "Refresh current query"} className="inline-flex size-9 items-center justify-center rounded-none border-0 px-2 hover:bg-accent active:bg-black/25">{showCancel ? <X className="size-4" aria-hidden="true" /> : <RotateCw className="size-4" aria-hidden="true" />}</button>} /><TooltipContent className={showCancel ? "!max-w-none max-w-[min(32rem,calc(100vw-1rem))] p-2" : ""}>{showCancel ? <div className="w-[min(29rem,calc(100vw-2rem))]"><div className="px-1 pb-2 text-xs font-semibold">Pending queries</div><div className="max-h-64 overflow-y-auto">{pendingQueryDetails.length ? pendingQueryDetails.map((query) => <div key={query.id} className="flex items-center gap-2 border-t border-border/40 px-1 py-1.5"><span className="min-w-0 flex-1 truncate text-xs" title={query.label}>{query.label}</span><button type="button" className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent" aria-label={`Cancel ${query.label}`} title={`Cancel ${query.label}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); cancelIndividualMaestroQuery(query.id); }}><X className="size-3.5" aria-hidden="true" /></button></div>) : <span className="px-1 text-xs text-muted-foreground">Loading before dispatch</span>}</div></div> : "Refresh query (check selected graph server only if not green)"}</TooltipContent></Tooltip>
          </ButtonGroup>

          {graphProbe.identity === graphProbeIdentity && graphProbe.state === "error" && !graphAlreadySelected &&
            <span className="text-xs text-destructive" role="alert" title={graphProbe.error}>Graph discovery failed — queries paused</span>}
          {/* One address: [graph]@[graph server], with no gap around the at-sign. */}
          <div role="group" aria-label="Graph address: graphsite at graph server" className="flex w-fit max-w-full min-w-0 flex-none items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
            <Tooltip><TooltipTrigger render={<button
              type="button"
              role="switch"
              aria-checked={graphAutoFill}
              aria-label="Auto-fill graph"
              onClick={() => setGraphAutoFill((current) => !current)}
              className={`group/autofill inline-flex shrink-0 items-center justify-center gap-1 border-r border-input px-2 text-xs transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${graphAutoFill
  ? "bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900"
  : "text-muted-foreground"}`}
            >
              <WandSparkles aria-hidden="true" className="size-4" />
              
            </button>} /><TooltipContent>{graphAutoFill ? "Auto-fill enabled: empty graph addresses are discovered; X switches to Everywhere" : "Auto-fill off: X clears the graph without selecting Everywhere. Click to enable."}</TooltipContent></Tooltip>
            <div className="group/graph-input flex min-w-[12rem] max-w-[min(32rem,42vw)] flex-none items-stretch overflow-hidden bg-transparent"
              style={{ width: queryTree.attributes.graph === ALL_GRAPHS ? "12rem" : `clamp(12rem, ${Math.max(18, graphText.length + 7)}ch, min(32rem, 42vw))` }}>
              <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={() => void openGraphInfo()}
                aria-label="Graph info"
                className="inline-flex shrink-0 items-center justify-center px-2.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              ><Info aria-hidden="true" className="size-4" /></button>} /><TooltipContent>{"Graph info"}</TooltipContent></Tooltip>
              {queryTree.attributes.graph === ALL_GRAPHS ? (
                <button
                  type="button"
                  aria-label="Everywhere; click to choose a graph"
                  onClick={exitEverywhere}
                  className="min-w-0 flex-1 px-3 py-2 text-left text-sm text-foreground hover:bg-accent/40"
                >Everywhere</button>
              ) : (
              <input
                id="maestro-graph-input"
                value={graphText}
                onChange={(event) => setGraphText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") applyGraphText(); }}
                placeholder="Enter graph URI"
                aria-label="Site URI"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
              />
              )}
              {queryTree.attributes.graph !== ALL_GRAPHS && <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={clearGraph}
                aria-label={graphAutoFill ? "Everywhere (all graphs)" : "Clear graph"}
                className="inline-flex max-w-0 shrink-0 items-center justify-center overflow-hidden px-0 opacity-0 transition-all duration-200 group-hover/graph-input:max-w-10 group-hover/graph-input:px-2.5 group-hover/graph-input:opacity-100 group-focus-within/graph-input:max-w-10 group-focus-within/graph-input:px-2.5 group-focus-within/graph-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 hover:bg-accent hover:text-accent-foreground"
              ><X aria-hidden="true" className="size-4" /></button>} /><TooltipContent>{graphAutoFill ? "Everywhere (all graphs)" : "Clear graph (leave address graphless)"}</TooltipContent></Tooltip>}
              {queryTree.attributes.graph !== ALL_GRAPHS && <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={applyGraphText}
                aria-label="Go"
                className="inline-flex max-w-0 shrink-0 items-center justify-center overflow-hidden px-0 opacity-0 transition-all duration-200 group-hover/graph-input:max-w-10 group-hover/graph-input:px-2.5 group-hover/graph-input:opacity-100 group-focus-within/graph-input:max-w-10 group-focus-within/graph-input:px-2.5 group-focus-within/graph-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 hover:bg-accent hover:text-accent-foreground"
              ><CirclePlay aria-hidden="true" className="size-4" /></button>} /><TooltipContent>{"Go"}</TooltipContent></Tooltip>}
            </div>
            <Dialog open={graphInfoOpen} onOpenChange={setGraphInfoOpen}>
              <DialogContent className="max-w-md p-5">
                <DialogHeader>
                  <DialogTitle>Graph info</DialogTitle>
                  <DialogDescription className="break-all font-mono text-xs">{graphInfo.graph || "No graph URI entered"}</DialogDescription>
                </DialogHeader>
                <dl className="mt-3 flex flex-col gap-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Subjects: </dt>
                    <dd className="text-right tabular-nums">
                      {graphInfo.subjectCountLoading ? <LoaderCircle className="size-4 animate-spin" aria-label="Loading" />
                        : graphInfo.subjectCountError ? <span role="alert" className="break-words text-xs text-destructive">{graphInfo.subjectCountError}</span>
                        : graphInfo.subjectCount !== null ? shortenCount(graphInfo.subjectCount) : "—"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Graph server(s): </dt>
                    <dd className="text-right tabular-nums">1</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{authSession?.userName ? `${authSession.userName}’s Access: ` : "Access: "}</dt>
                    <dd className="text-right">
                      {graphInfo.accessLoading ? <LoaderCircle className="size-4 animate-spin" aria-label="Testing write access" />
                        : graphInfo.access === null ? "—"
                        : <span className="font-mono">{String(graphInfo.access)}</span>}
                      {!graphInfo.accessLoading && graphInfo.accessError ? <span role="alert" className="mt-1 block break-words text-xs text-destructive">{graphInfo.accessError}</span> : null}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Access is true when a test triple of ephemeral URIs could be inserted into, then deleted from, this graph.</p>
              </DialogContent>
            </Dialog>
            <Label htmlFor="fct-endpoint" aria-label="Graph server" className="flex shrink-0 items-center border-x border-border/60 px-2 text-muted-foreground">
              <AtSign aria-hidden="true" className="size-4" />
            </Label>
            <div className="flex min-w-0 items-stretch">
              <ButtonGroup aria-label="Graph server selection, discovery, and refresh" className="group/graph-server-input max-w-full border-0 shadow-none [&>select]:min-w-0 [&>select]:flex-1 [&>select]:rounded-none [&>select]:border-0 [&>select]:bg-background [&>select]:px-2 [&>select]:py-2 [&>select]:text-sm">
                    <DropdownMenu>
                      <Tooltip><TooltipTrigger render={<DropdownMenuTrigger asChild><button
                        id="fct-endpoint"
                        type="button"
                        disabled={isCheckingEndpoints || fctEndpoints.length === 0}
                        aria-label="Choose graph server"
                        className="flex w-max min-w-0 max-w-[min(28rem,38vw)] items-center gap-2 rounded-none bg-transparent px-4 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <EndpointStatusIcon status={selectedEndpointStatus} />
                        <span className="min-w-0 truncate">{fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.label ?? (fctEndpoints.length ? "Select a graph server" : "No endpoints configured")}</span>
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      </button></DropdownMenuTrigger>} /><TooltipContent>{"Choose which FCT endpoint receives queries"}</TooltipContent></Tooltip>
                      <DropdownMenuContent align="start" className="z-50 w-max min-w-80 max-w-[calc(100vw-2rem)]">
                        {fctEndpoints.length === 0 ? <DropdownMenuLabel>{isCheckingEndpoints ? "Loading endpoints…" : "No endpoints configured"}</DropdownMenuLabel> : [...new Set(fctEndpoints.map((endpoint) => endpoint.group || "Endpoints"))].map((group) => (
                          <Fragment key={group}>
                            <DropdownMenuLabel>{group}</DropdownMenuLabel>
                            {fctEndpoints.filter((endpoint) => (endpoint.group || "Endpoints") === group).map((endpoint) => {
                              const status = endpointStatuses[endpoint.id];
                              const statusText = status?.status != null ? `HTTP ${status.status}` : status ? status.state : "Not yet pinged";
                              return <DropdownMenuItem key={endpoint.id} onSelect={() => void chooseFctEndpoint(endpoint.id)} className="flex min-w-0 items-center gap-2">
                                <EndpointStatusIcon status={status} />
                                <span className="min-w-0 flex-1 truncate">{endpoint.label}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">{statusText}</span>
                                {endpoint.id === selectedEndpointId ? <Check className="size-3.5 shrink-0" aria-label="Selected" /> : null}
                              </DropdownMenuItem>;
                            })}
                          </Fragment>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                <Tooltip>
                  <TooltipTrigger render={
                    <Toggle
                      type="button"
                      pressed={findEndpointsEnabled}
                      onPressedChange={setFindEndpointsEnabled}
                      aria-label={findEndpointsEnabled ? "Find Graph Servers On" : "Find Graph Servers Off"}
                      className="max-w-0 shrink-0 overflow-hidden rounded-none px-0 opacity-0 transition-all duration-200 group-hover/graph-server-input:max-w-10 group-hover/graph-server-input:px-2.5 group-hover/graph-server-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 data-[state=on]:bg-green-100 data-[state=on]:text-green-800 data-[state=on]:hover:bg-green-200 dark:data-[state=on]:bg-green-950 dark:data-[state=on]:text-green-300 dark:data-[state=on]:hover:bg-green-900"
                    ><Network aria-hidden="true" /></Toggle>
                  } />
                  <TooltipContent>{findEndpointsEnabled ? "Find Graph Servers On" : "Find Graph Servers Off"}</TooltipContent>
                </Tooltip>
                <Tooltip><TooltipTrigger render={<button
                  type="button"
                  onClick={() => void refreshQuery()}
                  disabled={isCheckingEndpoints || fctEndpoints.length === 0}
                  aria-label={isCheckingEndpoints ? "Checking server" : "Refresh query"}
                  className="inline-flex max-w-0 shrink-0 items-center justify-center overflow-hidden px-0 py-2 text-sm opacity-0 transition-all duration-200 hover:bg-accent group-hover/graph-server-input:max-w-10 group-hover/graph-server-input:px-2.5 group-hover/graph-server-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 disabled:opacity-50"
                ><RefreshCw aria-hidden="true" className={`size-4 ${isCheckingEndpoints ? "animate-spin" : ""}`} /></button>} /><TooltipContent>{isCheckingEndpoints ? "Checking selected server…" : "Refresh the query"}</TooltipContent></Tooltip>
              </ButtonGroup>
                  {isCheckingEndpoints && (
                    <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                      <span className="sr-only">{fctEndpoints.length === 0 ? "Loading graph servers" : "Updating graph servers"}</span>
                      {fctEndpoints.length === 0 ? <ElapsedStatus label="Loading graph servers" category="other" /> : <ElapsedStatus label={`Updating ${endpointChecksCompleted}/${endpointChecksTotal}`} category="other" />}
                    </span>
                  )}
            </div>
          </div>
          <div className="ml-auto shrink-0">
        <Tabs value={workspaceTab} onValueChange={(tab) => { if (tab === "browse" || tab === "view" || tab === "analyze") { setWorkspaceTab(tab); if (tab !== "browse") setCentralTab("results"); } }} className="shrink-0" aria-label="Maestro ribbon">
          <TabsList aria-label="Maestro ribbon tabs">
            <TabsTrigger value="browse" className="cursor-pointer">Browse</TabsTrigger>
            <TabsTrigger value="view" className="cursor-pointer">View</TabsTrigger>
            <TabsTrigger value="analyze" className="cursor-pointer">Analyze</TabsTrigger>
            <Tooltip><TooltipTrigger render={<TabsTrigger value="publish" disabled className="cursor-pointer">Publish</TabsTrigger>} /><TooltipContent>{"Coming soon"}</TooltipContent></Tooltip>
          </TabsList>
        </Tabs>
          </div>
        </div>
        {authSession && (
        <div className="flex shrink-0 items-center gap-1">
        {/* The native bookmark toggle represents the live query's saved state.
            Custom providers are navigation shortcuts, not bookmark state. */}
        <ToggleGroup type="single" value={isQueryBookmarked ? "bookmark" : ""} aria-label="Current query bookmark" className="shrink-0 rounded-md border">
        <Tooltip>
          <TooltipTrigger render={
            <ToggleGroupItem
              value="bookmark"
              type="button"
              id="maestro-bookmark-button"
              disabled={bookmarkOpening}
              aria-label={bookmarkOpening ? "Opening bookmark dialog" : isQueryBookmarked ? "Remove this query bookmark" : "Bookmark this query"}
              className={`${bookmarkOpening ? "h-9 w-auto min-w-20 px-2.5" : "size-9"} data-[state=on]:text-amber-500 ${bookmarkBounce && policyBookmarkVisible && !isQueryBookmarked && !bookmarkOpening ? "animate-bounce ring-2 ring-amber-400 ring-offset-2" : ""}`}
              onAnimationIteration={() => {
                // Recheck the three requirements on EACH bounce, not just when a request arrives.
                const visible = Boolean(document.querySelector('[data-policy-bookmark-banner="true"]'));
                if (!visible || !policyBookmarkVisible || isQueryBookmarked) setBookmarkBounce(false);
              }}
              onClick={async () => {
                setBookmarkAttention(false);
                setBookmarkBounce(false);
                if (isQueryBookmarked) {
                  try {
                    const response = await fetch("/proxy/api/query-favorites", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "RemoveBookmarkHash") },
                      body: JSON.stringify({ action: "unbookmark", queryXml, historyId: matchingBookmarkId || historyBookmarkId || undefined }),
                      cache: "no-store",
                    });
                    const payload = await response.json() as { removed?: boolean; error?: string };
                    if (!response.ok || !payload.removed) throw new Error(payload.error ?? `HTTP ${response.status}`);
                    setIsQueryBookmarked(false);
                    setMatchingBookmarkId("");
                    setBookmarkCheckRevision((revision) => revision + 1);
                    toast.add({ title: "Bookmark removed", description: "The query hash was removed from the bookmark in your personal RDF store.", type: "success" });
                  } catch (error) {
                    toast.add({ title: "Could not remove bookmark", description: error instanceof Error ? error.message : "The bookmark hash could not be removed.", type: "error" });
                  }
                  return;
                }
                setBookmarkOpening(true);
                try {
                // Wait until the queued visit write has finished before opening
                // metadata for the current query. Otherwise a fast click after
                // editing can race the visit and leave the dialog at "Saved query".
                await historyWriteQueueRef.current;
                let currentHistoryId = historyVisitQueryRef.current === queryXml ? historyVisitIdRef.current : "";
                if (!currentHistoryId && historyBookmarkId && historyVisitQueryRef.current === queryXml) currentHistoryId = historyBookmarkId;
                const metadataId = currentHistoryId || matchingBookmarkId;
                setBookmarkTitle(metadataId ? metadataId.slice(metadataId.lastIndexOf("#") + 1) : "");
                setBookmarkDescription("");
                setBookmarkTags("");
                setBookmarkTagVocabulary("skos");
                if (metadataId) {
                  try {
                    const response = await fetch("/proxy/api/query-favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", historyId: metadataId }), cache: "no-store" });
                    const payload = await response.json() as { found?: boolean; title?: string; description?: string; tags?: string[]; tagVocabulary?: "skos" | "dcterms" | "scot"; error?: string };
                    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
                    if (payload.found) {
                      setBookmarkTitle(payload.title || metadataId.slice(metadataId.lastIndexOf("#") + 1));
                      setBookmarkDescription(payload.description ?? "");
                      setBookmarkTags((payload.tags ?? []).join(", "));
                      setBookmarkTagVocabulary(payload.tagVocabulary ?? "skos");
                    }
                  } catch (error) {
                    toast.add({ title: "Could not load bookmark metadata", description: error instanceof Error ? error.message : "The generated name is available to edit.", type: "error" });
                  }
                }
                setBookmarkDialogOpen(true);
                } finally {
                  setBookmarkOpening(false);
                }
              }}
            >{bookmarkOpening ? <span className="inline-flex min-w-0 items-center justify-center gap-1 whitespace-nowrap text-xs tabular-nums" aria-label={`Opening bookmark dialog, ${Math.floor(bookmarkOpeningTenths / 10)} seconds elapsed`}><BookmarkLoadingClock className="size-3.5 shrink-0" aria-hidden="true" /><span>{Math.floor(bookmarkOpeningTenths / 10)}s</span></span> : <Bookmark aria-hidden="true" className={isQueryBookmarked ? "fill-current text-amber-500" : ""} />}</ToggleGroupItem>
          } />
          <TooltipContent>{bookmarkAttention && !isQueryBookmarked ? "Bookmark this query to continue" : isQueryBookmarked ? "Remove this query bookmark" : "Bookmark this query"}</TooltipContent>
        </Tooltip>
        </ToggleGroup>
        {appbarButtons.length > 0 && (
        <ToggleGroup type="single" value={matchedAppbarButton?.uri ?? ""} aria-label="Pinned bookmark shortcuts" className="shrink-0 rounded-md border"> 
        {appbarButtons.map(item => {
          const iconName = availableAppbarIconNames.has(item.icon) ? item.icon as IconName : null;
          return <Tooltip key={item.uri}><TooltipTrigger render={<ToggleGroupItem value={item.uri} aria-label={item.tooltip} title={item.tooltip} className="rounded-none border-l data-[state=on]:text-amber-500" onClick={() => {
            try { const destination = new URL(item.url,window.location.origin); if (destination.origin === window.location.origin && /^https?:$/.test(destination.protocol) && destination.searchParams.has("q")) { window.location.assign(destination.href); } else toast.add({title:"Invalid bookmark share URL",type:"error"}); }
            catch { toast.add({title:"Bookmark has no valid share URL",type:"error"}); }
          }}>{iconName ? <DynamicIcon name={iconName} className="size-4" aria-hidden="true" fallback={() => <Bookmark className="size-4" aria-hidden="true" />} /> : <Bookmark className="size-4" aria-hidden="true" />}</ToggleGroupItem>} /><TooltipContent>{item.tooltip}</TooltipContent></Tooltip>;
        })}
        </ToggleGroup>
        )}
        </div>
        )}
        <Dialog open={bookmarkDialogOpen} onOpenChange={(open) => { if (!bookmarkSaving) setBookmarkDialogOpen(open); }}>
            <DialogContent className="max-w-lg p-5" showCloseButton={false}>
              <div className="mb-4 flex items-start justify-between gap-4">
                <DialogHeader>
                  <DialogTitle id="maestro-bookmark-dialog-title">Edit History bookmark</DialogTitle>
                  <DialogDescription>Edit the title, description, and optional tags for this History item.</DialogDescription>
                </DialogHeader>
                <Button type="button" variant="ghost" size="icon" aria-label="Close bookmark dialog" disabled={bookmarkSaving} onClick={() => setBookmarkDialogOpen(false)}><X className="size-4" /></Button>
              </div>
              <form className="flex flex-col gap-4" onSubmit={async (event) => {
                event.preventDefault();
                setBookmarkSaving(true);
                try {
                  // Serialize against pending query visits so a save never races
                  // the RDF insert for the current query's History item.
                  await historyWriteQueueRef.current;
                  let currentHistoryId = historyVisitQueryRef.current === queryXml ? historyVisitIdRef.current : "";
                  if (!currentHistoryId && historyBookmarkId && historyVisitQueryRef.current === queryXml) currentHistoryId = historyBookmarkId;
                  const targetHistoryId = currentHistoryId || matchingBookmarkId;
                  if (!targetHistoryId) throw new Error("The current query's History item could not be resolved. Please wait for History to synchronize and retry.");
                  const tags = bookmarkTags.split(/[,;\n]/u).map((tag) => tag.trim()).filter(Boolean);
                  const response = await fetch("/proxy/api/query-favorites", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "update", historyId: targetHistoryId, title: bookmarkTitle.trim() || targetHistoryId.slice(targetHistoryId.lastIndexOf("#") + 1), description: bookmarkDescription.trim(), tags, tagVocabulary: bookmarkTagVocabulary, queryXml: serializeFctQuery(queryTree), stateUrl: workspace.buildCurrentShareUrl(),
                      lastResultCount: effectiveResultsTotalCount,
                      lastNewCount: recordStatus.enabled && recordStatus.countsReady && !recordStatus.loading && !recordStatus.error ? recordStatus.counts.New : null }),
                  });
                  const payload = await response.json() as { error?: string; namespaces?: unknown; historyId?: string; shareUrl?: string };
                  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
                  if (payload.namespaces) rememberNamespaceMetadata(payload.namespaces);
                  setIsQueryBookmarked(true);
                  setMatchingBookmarkId(payload.historyId || matchingBookmarkId || historyBookmarkId);
                  setBookmarkCheckRevision((revision) => revision + 1);
                  const shareUrl = payload.shareUrl;
                  const savedAt = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
                  const savedName = bookmarkTitle.trim() || targetHistoryId.slice(targetHistoryId.lastIndexOf("#") + 1);
                  toast.add({
                    title: "Bookmark saved",
                    description: (
                      <div className="flex min-w-0 flex-col gap-1">
                        <div><span className="font-medium">Name:</span> {savedName}</div>
                        <div><span className="font-medium">Date:</span> {savedAt}</div>
                        {shareUrl && <div className="min-w-0"><span className="font-medium">Link:</span> <a href={shareUrl} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-2">Open bookmark</a></div>}
                      </div>
                    ),
                    type: "success",
                  });
                  setBookmarkDialogOpen(false);
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Could not save query bookmark.";
                  toast.add({ title: "Could not save bookmark", description: message, type: "error" });
                } finally {
                  setBookmarkSaving(false);
                }
              }}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maestro-bookmark-title">Title</Label>
                  <input id="maestro-bookmark-title" ref={bookmarkTitleInputRef} value={bookmarkTitle} onChange={(event) => setBookmarkTitle(event.target.value)} maxLength={300} required className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maestro-bookmark-description">Description</Label>
                  <textarea id="maestro-bookmark-description" value={bookmarkDescription} onChange={(event) => setBookmarkDescription(event.target.value)} maxLength={5000} rows={3} placeholder="Describe what this query finds or why you saved it" className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maestro-bookmark-tags">Tags</Label>
                  <input id="maestro-bookmark-tags" value={bookmarkTags} onChange={(event) => setBookmarkTags(event.target.value)} maxLength={2000} placeholder="linked data, publications, people" className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <p className="text-xs text-muted-foreground">Separate tags with commas, semicolons, or new lines.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maestro-bookmark-tag-vocabulary">Tag vocabulary</Label>
                  <select id="maestro-bookmark-tag-vocabulary" value={bookmarkTagVocabulary} onChange={(event) => setBookmarkTagVocabulary(event.target.value as "skos" | "dcterms" | "scot")} className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="skos">SKOS concept — skos:Concept / skos:prefLabel</option>
                    <option value="dcterms">Dublin Core subject — dcterms:subject literal</option>
                    <option value="scot">SCOT tag — scot:Tag / scot:has_tag</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" disabled={bookmarkSaving} onClick={() => setBookmarkDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={bookmarkSaving}>{bookmarkSaving ? <ElapsedStatus label="Updating…" category="other" /> : "Update bookmark"}</Button>
                </div>
              </form>
            </DialogContent>
        </Dialog>
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
                  toast.add({ title: "Share link copied", description: "The query URL is on your clipboard.", type: "success" });
                  window.setTimeout(() => setShareLinkCopied(false), 2500);
                } catch {
                  setShareLinkCopied(false);
                  toast.add({ title: "Could not copy share link", description: "The browser denied clipboard access.", type: "error" });
                }
              }}
            >{shareLinkCopied ? <Check aria-hidden="true" /> : <Link aria-hidden="true" />}</Button>
          } />
          <TooltipContent>{shareLinkCopied ? "Share link copied" : "Copy share link"}</TooltipContent>
        </Tooltip>
        {authSession ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Logged in as ${authSession.userName || "User"}`}
                className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="size-9 ring-1 ring-border hover:ring-primary transition-all">
                  {authSession.avatarUrl && (
                    <AvatarImage src={authSession.avatarUrl} alt={authSession.userName || "User avatar"} />
                  )}
                  <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-xs uppercase">
                    {(authSession.userName || "U")[0]}
                  </AvatarFallback>
                  <AvatarBadge className="bg-emerald-500 ring-2 ring-background">
                    <span className="sr-only">Logged in</span>
                  </AvatarBadge>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-2">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-8">
                      {authSession.avatarUrl && (
                        <AvatarImage src={authSession.avatarUrl} alt={authSession.userName || "User"} />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-xs uppercase">
                        {(authSession.userName || "U")[0]}
                      </AvatarFallback>
                      <AvatarBadge className="bg-emerald-500 ring-2 ring-background">
                        <span className="sr-only">Logged in</span>
                      </AvatarBadge>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{authSession.userName || "Personal Account"}</p>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        <span className="text-[10px] text-muted-foreground uppercase font-mono font-medium tracking-wide">
                          Connected
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs leading-none text-muted-foreground truncate" title={authSession.graphPrefix}>
                    {authSession.graphPrefix}
                  </p>
                  <span className="inline-block text-[10px] font-mono uppercase bg-muted px-1.5 py-0.5 rounded w-fit text-muted-foreground">
                    {authSession.authType}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setLoginDialogOpen(true)}
                className="cursor-pointer gap-2"
              >
                <KeyRound className="size-4" />
                <span>Connection settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await clearPersonalAuthSession();
                  setAuthSession(null);
                  setPersonalPoliciesReady(true);
                  setPersonalPoliciesSeedError("");
                  setAuthRestoreIssue(false);
                  // Back to a plain, personal-store-free page: drop History tracking and reload the public Datasites list.
                  historyVisitQueryRef.current = "";
                  historyVisitIdRef.current = "";
                  pendingHistoryVisitRef.current = null;
                  setHistoryBookmarkId("");
                  setEndpointReloadRevision((r) => r + 1);
                  toast.add({
                    title: "Logged out",
                    description: "Personal graph server session cleared.",
                    type: "info",
                  });
                  setBookmarkCheckRevision((r) => r + 1);
                }}
                className="cursor-pointer text-destructive focus:text-destructive gap-2"
              >
                <LogOut className="size-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Tooltip>
            <TooltipTrigger render={
              <button
                type="button"
                aria-label="Log in to personal graph server"
                onClick={() => setLoginDialogOpen(true)}
                className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className={`size-9 ring-1 ${authRestoreIssue ? "ring-destructive" : "ring-border"} hover:ring-primary transition-all`}>
                  <AvatarFallback className="bg-muted text-muted-foreground hover:text-foreground">
                    <User className="size-4" aria-hidden="true" />
                  </AvatarFallback>
                  {authRestoreIssue && <AvatarBadge className="bg-destructive text-destructive-foreground ring-2 ring-background"><span className="text-xs font-bold">!</span></AvatarBadge>}
                </Avatar>
              </button>
            } />
            <TooltipContent>{authRestoreIssue ? "Your previous personal graph server login could not be restored. Please log in again." : "Log in to personal graph server"}</TooltipContent>
          </Tooltip>
        )}

        <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
          <DialogContent className="max-w-lg p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <DialogHeader>
                <DialogTitle id="personal-server-login-title">Personal Graph Server</DialogTitle>
                <DialogDescription>
                  Authenticate to your personal Virtuoso SPARQL server for bookmarks, history, and queries.
                </DialogDescription>
              </DialogHeader>
              <Button type="button" variant="ghost" size="icon" aria-label="Close dialog" onClick={() => setLoginDialogOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>

            <form onSubmit={handleLoginSubmit} autoComplete="on" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="personal-graph-store">Personal Graph Store (SPARQL endpoint)</Label>
                <Input
                  id="personal-graph-store"
                  name="graph_store"
                  type="url"
                  required
                  value={loginGraphStore}
                  onChange={(e) => setLoginGraphStore(e.target.value)}
                  placeholder="http://demo.openlinksw.com/sparql"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">Enter your /sparql endpoint. Maestro reads from it and switches to /sparql-auth automatically for writes.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="personal-graph-prefix">Personal Graph Prefix</Label>
                <Input
                  id="personal-graph-prefix"
                  name="graph_prefix"
                  type="url"
                  required
                  value={loginGraphPrefix}
                  onChange={(e) => setLoginGraphPrefix(e.target.value)}
                  placeholder="http://demo.openlinksw.com/ods/home/acme"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  History graph: <span className="font-mono">{loginGraphPrefix ? graphForPrefix(loginGraphPrefix) : "USER_SITE/query"}</span>
                </p>
              </div>

              <div className="flex flex-col gap-1.5 pt-1">
                <Label>Authentication Method</Label>
                <Tabs value={loginTab} onValueChange={(val) => setLoginTab(val as AuthType)} className="w-full">
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="sparql-auth">sparql-auth</TabsTrigger>
                    <TabsTrigger value="sparql-oauth">sparql-oauth</TabsTrigger>
                    <TabsTrigger value="sparql-webid">sparql-webid</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sparql-auth" className="flex flex-col gap-3 mt-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="personal-username">Username</Label>
                      <Input
                        id="personal-username"
                        name="username"
                        type="text"
                        autoComplete="username"
                        value={loginUsername}
                        onChange={(e) => setLoginUsername(e.target.value)}
                        placeholder="acme"
                        required={loginTab === "sparql-auth"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="personal-password">Password</Label>
                      <div className="relative">
                        <Input
                          id="personal-password"
                          name="password"
                          type={loginShowPassword ? "text" : "password"}
                          autoComplete="current-password"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          placeholder="••••••••"
                          required={loginTab === "sparql-auth"}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setLoginShowPassword((shown) => !shown)}
                          aria-label={loginShowPassword ? "Hide password" : "Show password"}
                          aria-pressed={loginShowPassword}
                          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {loginShowPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="sparql-oauth" className="flex flex-col gap-3 mt-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="oauth-token">Bearer / OAuth Access Token</Label>
                      <Input
                        id="oauth-token"
                        name="oauth_token"
                        type="password"
                        autoComplete="off"
                        value={loginOauthToken}
                        onChange={(e) => setLoginOauthToken(e.target.value)}
                        placeholder="Bearer token"
                        required={loginTab === "sparql-oauth"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="oauth-profile-url">OpenID Profile / UserInfo URL (optional)</Label>
                        <button
                          type="button"
                          onClick={handleFetchProfile}
                          disabled={isFetchingAvatar || !loginOauthProfileUrl}
                          className="text-xs text-primary hover:underline disabled:opacity-50"
                        >
                          {isFetchingAvatar ? <ElapsedStatus label="Fetching" category="other" /> : "Grab Avatar & Name"}
                        </button>
                      </div>
                      <Input
                        id="oauth-profile-url"
                        name="oauth_profile_url"
                        type="url"
                        autoComplete="url"
                        value={loginOauthProfileUrl}
                        onChange={(e) => setLoginOauthProfileUrl(e.target.value)}
                        placeholder="https://openid.example.com/userinfo"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="oauth-username">User / Display Name</Label>
                      <Input
                        id="oauth-username"
                        name="oauth_username"
                        type="text"
                        autoComplete="name"
                        value={loginOauthUserName}
                        onChange={(e) => setLoginOauthUserName(e.target.value)}
                        placeholder="e.g. John Doe"
                      />
                    </div>
                    {fetchedAvatarUrl && (
                      <div className="flex items-center gap-3 p-2 rounded-md border bg-muted/40">
                        <Avatar size="sm">
                          <AvatarImage src={fetchedAvatarUrl} alt="Avatar" />
                          <AvatarFallback className="text-xs uppercase">
                            {(loginOauthUserName || "U")[0]}
                          </AvatarFallback>
                          <AvatarBadge className="bg-emerald-500 ring-2 ring-background" />
                        </Avatar>
                        <span className="text-xs text-muted-foreground">Grabbed OpenID avatar</span>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="sparql-webid" className="flex flex-col gap-3 mt-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="webid-uri">WebID URI</Label>
                        <button
                          type="button"
                          onClick={handleFetchProfile}
                          disabled={isFetchingAvatar || !loginWebIdUri}
                          className="text-xs text-primary hover:underline disabled:opacity-50"
                        >
                          {isFetchingAvatar ? <ElapsedStatus label="Fetching" category="other" /> : "Grab Avatar & Name"}
                        </button>
                      </div>
                      <Input
                        id="webid-uri"
                        name="webid_uri"
                        type="url"
                        autoComplete="url"
                        value={loginWebIdUri}
                        onChange={(e) => setLoginWebIdUri(e.target.value)}
                        placeholder="http://id.myopenlink.net/dataspace/person/dba#this"
                        required={loginTab === "sparql-webid"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="webid-token">WebID Bearer Token (optional)</Label>
                      <Input
                        id="webid-token"
                        name="webid_token"
                        type="password"
                        autoComplete="off"
                        value={loginOauthToken}
                        onChange={(e) => setLoginOauthToken(e.target.value)}
                        placeholder="Optional bearer token if required by endpoint"
                      />
                    </div>
                    {fetchedAvatarUrl && (
                      <div className="flex items-center gap-3 p-2 rounded-md border bg-muted/40">
                        <Avatar size="sm">
                          <AvatarImage src={fetchedAvatarUrl} alt="WebID Avatar" />
                          <AvatarFallback className="text-xs uppercase">
                            {(loginWebIdUri.split("#").pop() || "U")[0]}
                          </AvatarFallback>
                          <AvatarBadge className="bg-emerald-500 ring-2 ring-background" />
                        </Avatar>
                        <span className="text-xs text-muted-foreground">Grabbed WebID avatar</span>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              <p className="pt-1 text-xs text-muted-foreground">Maestro keeps you signed in across browser and server restarts until you log out, subject to your graph server's credential validity.</p>

              {loginError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                  {loginError}
                </div>
              )}

              <div className="flex justify-between items-center pt-2">
                <Button type="button" variant="outline" disabled={loginTesting} onClick={() => setLoginDialogOpen(false)}>
                  Cancel
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" disabled={loginTesting} onClick={handleTestConnection}>
                    {loginTesting ? "Testing…" : "Test Connection"}
                  </Button>
                  <Button type="submit" disabled={loginTesting}>
                    {loginTesting ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <SettingsPane workspace={workspace} />
      </header>
  );
}
