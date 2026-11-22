"use client";
import { currentBootstrapButtons } from "@/lib/client-auth-bootstrap";
import { clientQueryFavorites } from "@/lib/client-query-favorites";
import { manageAppbarButtons } from "@/lib/client-appbar-buttons";
import { ErrorDetails } from "@/components/ui/error-details";
import { Skeleton } from "@/components/ui/skeleton";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { UI_COMPONENT } from "@/lib/maestro-ui-component-ids";

import { EndpointStatusIcon, endpointHealthDetails } from "@/canvas/top/appbar";

import maestroLanguages from "@/data/maestro-languages.json";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { subscribePendingMaestroQueries, subscribePendingMaestroQueryDetails, cancelIndividualMaestroQuery, type PendingMaestroQuery } from "@/lib/client-query-cache";

import { rememberNamespaceMetadata, toLabel } from "@/lib/uri-labels";
import { proxyDebugHeaders } from "@/lib/proxy-debug";

import { ButtonGroup } from "@/components/ui/button-group";
import { ViewDiagnosticsHover } from "@/canvas/top/view-diagnostics-hover";
import { pendingApprovalController, selectPendingApprovalBadge } from "@/lib/app-lifecycle/pending-approvals";
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
import { Check, ChevronDown, Network, Link, CirclePlay, AtSign, X, LoaderCircle, ArrowLeft, ArrowRight, ClockArrowRight, Clock1, Clock2, Clock3, Clock4, Clock5, Clock6, Clock7, Clock8, Clock9, Clock10, Clock11, Clock12, Home, CornerDownLeft, RotateCw, RefreshCw, Bookmark, User, LogOut, KeyRound, Eye, EyeOff, Info, WandSparkles } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { AuthType, clearPersonalAuthSession, disconnectPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";
import { cancelPersonalInitialization } from "@/lib/personal-initialization";
import { ALL_GRAPHS } from "@/lib/graph-address-mode";
import { graphServerUrlMatches } from "@/lib/graph-server-health";

import { Button } from "@/components/ui/button";
import { noteMaestroClipboardCopy } from "@/lib/recent-clipboard";

import { serializeFctQuery } from "@/lib/fct-query-api";

// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.

const MAESTRO_ALPHABET_LANGUAGES = maestroLanguages;
// Runtime bookmark shortcuts use Lucide's dynamic loader instead of importing
// every icon into the appbar's initial bundle. Validate persisted names too.
const availableAppbarIconNames = new Set<string>(iconNames);
const BOOKMARK_CLOCKS = [Clock1, Clock2, Clock3, Clock4, Clock5, Clock6, Clock7, Clock8, Clock9, Clock10, Clock11, Clock12] as const;

/** Queue presentation is factual, not an invented global queue rank.
 * Proxy numbered lanes are *projected waiting addresses*, not worker IDs. */
function pendingQueryAddress(query: PendingMaestroQuery): { text: string; detail: string } {
  if (query.serverQueueIndex && query.serverQueueIndex > 0 && query.serverQueueLane &&
      query.serverQueueLaneNumber && query.serverQueueLanePosition) {
    const lane = query.serverQueueLane === "heavy" ? "H" : "L";
    return { text: `${lane}${query.serverQueueLaneNumber}:${query.serverQueueLanePosition} · ${query.serverQueueLane}`,
      detail: `Proxy queue #${query.serverQueueIndex}; projected ${query.serverQueueLane} lane ${query.serverQueueLaneNumber}, position ${query.serverQueueLanePosition}, class-local ordinal ${query.serverQueueLaneIndex ?? "unknown"}. This is a queue projection, not a running socket or worker ID. Server: ${query.queueServer || "unreported"}` };
  }
  if (query.state === "queued" && query.queueIndex > 0) {
    return { text: `B:${query.queueIndex} · browser`, detail: `Browser waiting position ${query.queueIndex}. Not admitted to proxy scheduling: no proxy lane ID exists yet.` };
  }
  if (query.proxyDispatchConfirmed) return { text: "Dispatched", detail: "Proxy telemetry confirmed dispatch; this request has no waiting-queue address." };
  if (query.state === "active") return { text: "Browser admitted", detail: "Left the browser waiting queue. Telemetry and request setup may still be in progress; proxy position and dispatch are not yet confirmed." };
  return { text: "Preparing", detail: "Request setup in progress; it has not entered a waiting queue." };
}


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
  const pendingApprovalSnapshot=useSyncExternalStore(pendingApprovalController.subscribe,
    pendingApprovalController.getSnapshot,pendingApprovalController.getSnapshot);
  const pendingBadge=selectPendingApprovalBadge(pendingApprovalSnapshot);
  const matchedContextProviders=workspace.queryMatchedProviders.join("\u0000");
  useEffect(()=>{
    if(!workspace.accessCapabilities.canUsePersonalStore){pendingApprovalController.clear();return;}
    pendingApprovalController.activate(workspace.queryXml,workspace.selectedUri??"");
  },[workspace.accessCapabilities.canUsePersonalStore,workspace.queryXml,workspace.selectedUri]);
  useEffect(()=>{
    if(workspace.accessCapabilities.canUsePersonalStore&&workspace.queryMatchedProviders.length)
      pendingApprovalController.match(workspace.queryXml,workspace.queryMatchedProviders);
  },[workspace.accessCapabilities.canUsePersonalStore,workspace.queryXml,matchedContextProviders]);
  useEffect(()=>{
    if(workspace.accessCapabilities.canUsePersonalStore)pendingApprovalController.refresh();
  },[workspace.policyApprovalRevision]);
  const viewBadge=pendingBadge.total>0?<span aria-label={`${pendingBadge.total} matched providers awaiting approval: ${pendingBadge.policies} policies, ${pendingBadge.providers} other providers`}
      title={`Sum of pending approvals on View > Providers ribbons`}
      className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-5 text-destructive-foreground tabular-nums">{pendingBadge.total}</span>:null;
  // One edit state for BOTH the address input and the discovery preflight.
  // A local-only flag previously let graph discovery run while the user typed.
  const { graphFieldEditing: graphAddressEditing, setGraphFieldEditing: setGraphAddressEditing } = workspace;
  const headerLayoutRef = useRef<HTMLElement>(null);
  const graphAddressLayoutRef = useRef<HTMLDivElement>(null);
  const [compactRibbonTabs, setCompactRibbonTabs] = useState(false);
  useEffect(() => {
    const header = headerLayoutRef.current;
    const graph = graphAddressLayoutRef.current;
    if (!header || !graph) return;
    const measure = () => {
      // Reserve room for graph navigation, the full tab row, and the appbar
      // actions. Use actual graph width rather than a viewport breakpoint.
      const graphWidth = graph.getBoundingClientRect().width;
      const available = header.getBoundingClientRect().width;
      const nav = header.querySelector('[aria-label="Graph navigation"]');
      const navigationWidth = nav?.getBoundingClientRect().width ?? 180;
      setCompactRibbonTabs(available < graphWidth + navigationWidth + 450);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(graph);
    measure();
    return () => observer.disconnect();
  }, []);
  const graphAddressInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!graphAddressEditing) return;
    const input = graphAddressInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, 0);
    input.scrollLeft = 0;
  }, [graphAddressEditing]);
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
    if (!workspace.authSession || !workspace.accessCapabilities.canUsePersonalStore) { setAppbarButtons([]); return; }
    let mounted = true;
    const update = () => { if (mounted) setAppbarButtons(currentBootstrapButtons()); };
    const refresh = async () => {
      try {
        const payload = await manageAppbarButtons({action:"list"});
        if (mounted) setAppbarButtons(payload.buttons ?? []);
      } catch (error) {
        if (mounted) toast.add({title:"Could not refresh appbar",description:error instanceof Error?error.message:String(error),type:"error"});
      }
    };
    update();
    window.addEventListener("maestro:auth-bootstrap-updated",update);
    window.addEventListener("maestro:appbar-buttons-updated",refresh);
    return () => { mounted=false;window.removeEventListener("maestro:auth-bootstrap-updated",update);
      window.removeEventListener("maestro:appbar-buttons-updated",refresh); };
  }, [workspace.authSession, workspace.accessCapabilities.canUsePersonalStore]);
  const openPinnedBookmark = (url: string) => {
    try {
      const destination = new URL(url, window.location.origin);
      if (destination.origin === window.location.origin && /^https?:$/.test(destination.protocol) && destination.searchParams.has("q"))
        { if (!workspace.openPinnedShareUrl(destination.href)) toast.add({ title: "Could not restore bookmark", type: "error" }); }
      else toast.add({ title: "Invalid bookmark share URL", type: "error" });
    } catch (error) { toast.add({ title: "Bookmark has no valid share URL", description: error instanceof Error ? error.message : String(error), type: "error" }); }
  };
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
    checkingEndpointIds,
    endpointMenuError,
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
    graphServerDirectoryHydrated,
    groupBatchSize,
    handleFetchProfile,
    handleRetryPersonalInitialization,
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
    returnButtonVisible,
    recordDescriptionPageSize,
    recordDescriptionQueryLimit,
    refreshMaestroPage,
    cancelMaestroPage,
    queryActivityPending,
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
    confirmQueryBookmark,
    revokeQueryBookmark,
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
  // Graph auto-fill is not the graph-server health probe. A healthy (green)
  // endpoint can still exceed the separate named-graph discovery deadline.
  // Notify outside the crowded address/navigation row and only on transitions
  // into a new discovery error, never on every render.
  const lastGraphProbeToastRef = useRef("");
  useEffect(() => {
    if (graphProbe.identity !== graphProbeIdentity || graphProbe.state !== "error" || graphAlreadySelected || !graphAutoFill) {
      if (graphProbe.state !== "error") lastGraphProbeToastRef.current = "";
      return;
    }
    const key = `${graphProbeIdentity}\u0000${graphProbe.error ?? ""}`;
    if (lastGraphProbeToastRef.current === key) return;
    lastGraphProbeToastRef.current = key;
    const timeout = /timed? out|timeout|signal timed out/i.test(graphProbe.error ?? "");
    toast.add({
      title: timeout ? "Graph auto-fill timed out" : "Graph auto-fill unavailable",
      description: timeout
        ? "Automatic graph selection timed out. Browsing continues using the server's default dataset. Refresh to retry, or select a graph."
        : "Automatic graph selection is unavailable. Browsing continues using the server's default dataset. Refresh to retry, or select a graph.",
      type: "warning",
    });
  }, [graphProbe.identity, graphProbe.state, graphProbe.error, graphProbeIdentity, graphAlreadySelected, graphAutoFill]);

  // When a session has been published but the XState actor has not yet
  // observed it, show amber rather than flashing an incorrect green Ready.
  const graphInitializationPending = Boolean(authSession) &&
    !workspace.accessCapabilities.canUsePersonalStore &&
    workspace.accessCapabilities.policyStage !== "failed";
  const showCancel = pendingQueryCount > 0 || queryActivityPending;
  const liveServer = (queryTree.attributes.addr ?? "").split("@").slice(1).join("@");
  const activeGraphServer = fctEndpoints.find(endpoint => liveServer &&
    (endpoint.id === liveServer || graphServerUrlMatches(endpoint.url, liveServer, endpoint.schemeInferred)));
  const displayedEndpointId = activeGraphServer?.id ?? "";
  const displayedEndpointStatus = activeGraphServer ? endpointStatuses[activeGraphServer.id] : undefined;
  const displayedEndpointLabel = activeGraphServer?.label ?? (liveServer.trim() || "Select a graph server");
  const displayedEndpointChecking = Boolean(activeGraphServer && checkingEndpointIds[activeGraphServer.id]);
  return (
<header ref={headerLayoutRef} id={UI_COMPONENT.appbar} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-2">
          <ButtonGroup aria-label="Graph navigation" className="shrink-0 [&>button:not(:first-child)]:!ml-0 [&>button:not(:first-child)]:!border-l-0">
            {returnButtonVisible && <Tooltip><TooltipTrigger render={<Button type="button" variant="outline" size="icon"
              aria-label="Return to previous context" onClick={() => { if (!workspace.returnToPreviousContext()) toast.add({ title: "Could not restore the previous context", type: "error" }); }}
              className="h-9 w-auto gap-1.5 border-blue-500/60 bg-blue-600 px-3 text-white hover:bg-blue-700 hover:text-white focus-visible:ring-blue-500">
              <CornerDownLeft className="size-4" aria-hidden="true" />Return
            </Button>} /><TooltipContent>Return to previous context</TooltipContent></Tooltip>}

            {workspace.accessCapabilities.canUsePersonalStore && (<>
            <Tooltip disableHoverablePopup={false}><TooltipTrigger render={<Button type="button" variant="outline" size="icon" onMouseEnter={() => startHistoryActionHover("backward")} onMouseLeave={stopHistoryActionHover} onClick={() => void navigateQueryHistory("backward")} aria-label="Previous query in history" aria-busy={historyNavigationPending === "backward"} disabled={!historyHasOlder || historyNavigationPending !== null} className={`size-9 text-muted-foreground hover:text-foreground active:bg-accent/80 ${historyNavigationPending !== null ? "bg-muted text-muted-foreground" : ""}`}><span className="inline-flex" aria-hidden="true">{historyNavigationPending === "backward" ? <ClockArrowRight className="size-4 scale-x-[-1]" /> : <ArrowLeft className="size-4" />}</span></Button>} /><TooltipContent className={historyActionMenu === "backward" ? "!max-w-none max-w-[min(36rem,calc(100vw-1rem))] p-2" : ""} onMouseEnter={() => { if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current); }} onMouseLeave={stopHistoryActionHover}>{historyActionMenu === "backward" ? <div className="w-[min(34rem,calc(100vw-2rem))] text-background"><div className="px-1 pb-2 text-xs font-semibold">Earlier in History</div><div className="max-h-64 overflow-auto">{historyActionItems.map((item) => <button type="button" key={item.historyId} onClick={() => void restoreHistoryActionItem(item.historyId)} className="block w-full border-t border-background/20 px-1 py-2 text-left text-xs hover:bg-background/10"><div className="break-all font-mono">{formatHistoryAction(item.action, "backward")}</div><div className="mt-1 opacity-70">{item.created ? new Date(item.created).toLocaleString() : ""}</div></button>)}</div></div> : historyNavigationPending === "backward" ? "Loading previous query…" : "Previous query in History"}</TooltipContent></Tooltip>
            <Tooltip disableHoverablePopup={false}><TooltipTrigger render={<Button type="button" variant="outline" size="icon" onMouseEnter={() => startHistoryActionHover("forward")} onMouseLeave={stopHistoryActionHover} onClick={() => void navigateQueryHistory("forward")} aria-label="Next query in history" aria-busy={historyNavigationPending === "forward"} disabled={!historyHasNewer || historyNavigationPending !== null} className={`size-9 text-muted-foreground hover:text-foreground active:bg-accent/80 ${historyNavigationPending !== null ? "bg-muted text-muted-foreground" : ""}`}>{historyNavigationPending === "forward" ? <ClockArrowRight className="size-4" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}</Button>} /><TooltipContent className={historyActionMenu === "forward" ? "!max-w-none max-w-[min(36rem,calc(100vw-1rem))] p-2" : ""} onMouseEnter={() => { if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current); }} onMouseLeave={stopHistoryActionHover}>{historyActionMenu === "forward" ? <div className="w-[min(34rem,calc(100vw-2rem))] text-background"><div className="px-1 pb-2 text-xs font-semibold">Later in History</div><div className="max-h-64 overflow-auto">{historyActionItems.map((item) => <button type="button" key={item.historyId} onClick={() => void restoreHistoryActionItem(item.historyId)} className="block w-full border-t border-background/20 px-1 py-2 text-left text-xs hover:bg-background/10"><div className="break-all font-mono">{formatHistoryAction(item.action, "forward")}</div><div className="mt-1 opacity-70">{item.created ? new Date(item.created).toLocaleString() : ""}</div></button>)}</div></div> : historyNavigationPending === "forward" ? "Loading next query…" : "Next query in History"}</TooltipContent></Tooltip>
            </>)}
            <Tooltip><TooltipTrigger render={<Button type="button" variant="outline" size="icon" onClick={() => {
              resetQuery();
              setSearch("");
              if (centralTab === "groups") setCentralTab("results");
              setSearchPipelineRun((current) => current + 1);
            }} aria-label="Reset query to home" className="size-9 text-muted-foreground hover:bg-accent hover:text-foreground"><Home className="size-4" aria-hidden="true" /></Button>} /><TooltipContent>Reset query</TooltipContent></Tooltip>
            <Tooltip disableHoverablePopup={false}><TooltipTrigger render={<Button type="button" variant="outline" size="icon" onClick={() => { if (showCancel) cancelMaestroPage(); else void refreshMaestroPage(); }} aria-label={showCancel ? "Cancel pending queries" : "Refresh current query"} className="size-9 text-muted-foreground hover:bg-accent hover:text-foreground">{showCancel ? <X className="size-4" aria-hidden="true" /> : <RotateCw className="size-4" aria-hidden="true" />}</Button>} /><TooltipContent className={showCancel ? "!max-w-none max-w-[min(32rem,calc(100vw-1rem))] p-2" : ""}>{showCancel ? <div className="w-[min(29rem,calc(100vw-2rem))]"><div className="px-1 pb-2 text-xs font-semibold">Pending queries</div><div className="max-h-64 overflow-y-auto">{pendingQueryDetails.length ? pendingQueryDetails.map((query) => <div key={query.id} className="flex items-center gap-2 border-t border-border/40 px-1 py-1.5"><span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" aria-label={pendingQueryAddress(query).detail} title={pendingQueryAddress(query).detail}>{pendingQueryAddress(query).text}</span><span className="min-w-0 flex-1 truncate text-xs" title={query.label}>{query.label}</span><button type="button" className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent" aria-label={`Cancel ${query.label}`} title={`Cancel ${query.label}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); cancelIndividualMaestroQuery(query.id); }}><X className="size-3.5" aria-hidden="true" /></button></div>) : <span className="px-1 text-xs text-muted-foreground">Loading before dispatch</span>}</div></div> : "Refresh query (check selected graph server only if not green)"}</TooltipContent></Tooltip>
          </ButtonGroup>

          {/* One address: [graph]@[graph server], with no gap around the at-sign. */}
          <div ref={graphAddressLayoutRef} className="relative z-20 min-w-0 flex-[1_1_auto] self-stretch">
          <div role="group" aria-label="Graph address: graph at graph server"
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGraphAddressEditing(false); }}
            className={`relative flex h-full w-full min-w-0 items-stretch rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring ${graphAddressEditing ? "z-50 shadow-lg" : ""}`}>

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
            <div className="group/graph-input flex min-w-0 flex-1 items-stretch overflow-hidden bg-transparent">
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
              graphAddressEditing ? <input
                ref={graphAddressInputRef}
                id="maestro-graph-input"
                value={graphText}
                onChange={(event) => setGraphText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") applyGraphText(); }}
                placeholder="Enter graph URI"
                aria-label="Site URI"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
              /> : <button type="button"
                aria-label={`Edit graph: ${queryTree.attributes.graph ? toLabel(queryTree.attributes.graph) : "Everywhere"}`}
                onClick={() => setGraphAddressEditing(true)}
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm hover:bg-accent/40">
                {queryTree.attributes.graph
                  ? toLabel(queryTree.attributes.graph)
                  : <span className="text-muted-foreground">Everywhere</span>}
              </button>
              )}
              {queryTree.attributes.graph !== ALL_GRAPHS && <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={clearGraph}
                aria-label={graphAutoFill ? "Everywhere (all graphs)" : "Clear graph"}
                className="inline-flex max-w-0 shrink-0 items-center justify-center overflow-hidden px-0 opacity-0 transition-all duration-200 group-focus-within/graph-input:max-w-10 group-focus-within/graph-input:px-2.5 group-focus-within/graph-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 hover:bg-accent hover:text-accent-foreground"
              ><X aria-hidden="true" className="size-4" /></button>} /><TooltipContent>{graphAutoFill ? "Everywhere (all graphs)" : "Clear graph (leave address graphless)"}</TooltipContent></Tooltip>}
              {queryTree.attributes.graph !== ALL_GRAPHS && <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={applyGraphText}
                aria-label="Go"
                className="inline-flex max-w-0 shrink-0 items-center justify-center overflow-hidden px-0 opacity-0 transition-all duration-200 group-focus-within/graph-input:max-w-10 group-focus-within/graph-input:px-2.5 group-focus-within/graph-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 hover:bg-accent hover:text-accent-foreground"
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
                        : graphInfo.subjectCountError ? <ErrorDetails prefix="Graph count" error={graphInfo.subjectCountError} />
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
                      {!graphInfo.accessLoading && graphInfo.accessError ? <ErrorDetails prefix="Graph access" error={graphInfo.accessError} /> : null}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Access is true when a test triple of ephemeral URIs could be inserted into, then deleted from, this graph.</p>
              </DialogContent>
            </Dialog>
            <Label htmlFor="fct-endpoint" aria-label="Graph server" className="flex shrink-0 items-center border-x border-border/60 px-2 text-muted-foreground">
              <AtSign aria-hidden="true" className="size-4" />
            </Label>
            <div className="flex min-w-0 basis-[30ch] max-w-[min(54%,34rem)] shrink items-stretch">
              <ButtonGroup aria-label="Graph server selection, discovery, and refresh" className="group/graph-server-input min-w-0 flex-1 border-0 shadow-none [&>select]:min-w-0 [&>select]:flex-1 [&>select]:rounded-none [&>select]:border-0 [&>select]:bg-background [&>select]:px-2 [&>select]:py-2 [&>select]:text-sm">
                    {!graphServerDirectoryHydrated ? (
                      endpointMenuError ? <button type="button" className="px-2 text-xs text-destructive hover:underline" onClick={() => setEndpointReloadRevision((revision) => revision + 1)}>Retry graph servers</button>
                      : <div role="status" aria-busy="true" aria-label="Loading graph servers" className="flex h-9 min-w-32 items-center gap-2 px-2">
                          <Skeleton className="size-4 rounded-full" /><Skeleton className="h-4 w-24" />
                        </div>
                    ) : <DropdownMenu>
                      <DropdownMenuTrigger asChild><button
                        id="fct-endpoint"
                        title="Choose which FCT endpoint receives queries"
                        type="button"
                        disabled={fctEndpoints.length === 0}
                        aria-label="Choose graph server"
                        className="flex w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-none bg-transparent px-2 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span title={displayedEndpointChecking ? "Checking current FCT graph server…" : endpointHealthDetails(displayedEndpointStatus)}>{displayedEndpointChecking ? <LoaderCircle aria-label="Checking graph server" className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <EndpointStatusIcon status={displayedEndpointStatus} />}</span>
                        <span className="min-w-0 truncate whitespace-nowrap">{displayedEndpointLabel}</span>
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      </button></DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="z-50 w-max min-w-max max-w-[calc(100vw-2rem)]">
                        {fctEndpoints.length === 0 ? <DropdownMenuLabel>{isCheckingEndpoints ? "Loading endpoints…" : "No endpoints configured"}</DropdownMenuLabel> : [...new Set(fctEndpoints.map((endpoint) => endpoint.group || "Endpoints"))].map((group) => (
                          <Fragment key={group}>
                            <DropdownMenuLabel>{group}</DropdownMenuLabel>
                            {fctEndpoints.filter((endpoint) => (endpoint.group || "Endpoints") === group).map((endpoint) => {
                              const status = endpointStatuses[endpoint.id];
                              const statusText = status?.status != null ? `HTTP ${status.status}` : status ? status.state : "Not yet pinged";
                              return <DropdownMenuItem key={endpoint.id} title={endpointHealthDetails(status)} onSelect={() => void chooseFctEndpoint(endpoint.id)} className="flex min-w-0 items-center gap-2">
                                <EndpointStatusIcon status={status} />
                                <span className="min-w-0 flex-1 whitespace-nowrap">{endpoint.label}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">{statusText}</span>
                                {endpoint.id === displayedEndpointId ? <Check className="size-3.5 shrink-0" aria-label="Selected" /> : null}
                              </DropdownMenuItem>;
                            })}
                          </Fragment>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>}
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
                  onClick={() => void refreshMaestroPage()}
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
          </div>
          <div className="ml-auto shrink-0">
            {compactRibbonTabs ? <div className="inline-flex items-center rounded-md border bg-muted p-0.5" aria-label="Maestro ribbon tabs">
              <Button variant={workspaceTab === "browse" ? "secondary" : "ghost"} size="sm" onClick={() => workspace.navigateWorkspaceTab("browse")}>Browse</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More Maestro tabs"><span className="text-lg leading-none" aria-hidden="true">…</span></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="bottom" sideOffset={6} collisionPadding={12} avoidCollisions className="max-w-[calc(100vw-1.5rem)]">
                  <DropdownMenuItem disabled={!workspace.accessCapabilities.canUsePersonalStore} onSelect={() => {
                    workspace.navigateWorkspaceTab("view"); setCentralTab("results");
                  }}>View{workspaceTab === "view" ? " ✓" : ""}{viewBadge}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!workspace.accessCapabilities.canUsePersonalStore} onSelect={() => { workspace.navigateWorkspaceTab("analyze"); setCentralTab("results"); }}>Analyze{workspaceTab === "analyze" ? " ✓" : ""}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>Publish (coming soon)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div> : <Tabs value={workspaceTab} onValueChange={(tab) => { if (tab === "browse" || ((tab === "view" || tab === "analyze") && workspace.accessCapabilities.canUsePersonalStore)) { workspace.navigateWorkspaceTab(tab); if (tab !== "browse") setCentralTab("results");
               } }} className="shrink-0" aria-label="Maestro ribbon">
              <TabsList aria-label="Maestro ribbon tabs">
                <TabsTrigger value="browse" className="cursor-pointer">Browse</TabsTrigger>
                <ViewDiagnosticsHover enabled={workspace.accessCapabilities.canUsePersonalStore}>
                  <TabsTrigger value="view" disabled={!workspace.accessCapabilities.canUsePersonalStore} className="cursor-pointer">View{viewBadge}</TabsTrigger>
                </ViewDiagnosticsHover>
                <TabsTrigger value="analyze" disabled={!workspace.accessCapabilities.canUsePersonalStore} className="cursor-pointer">Analyze</TabsTrigger>
                <Tooltip><TooltipTrigger render={<TabsTrigger value="publish" disabled className="cursor-pointer">Publish</TabsTrigger>} /><TooltipContent>Coming soon</TooltipContent></Tooltip>
              </TabsList>
            </Tabs>}
          </div>
        </div>
        {workspace.accessCapabilities.canUsePersonalStore && (
        <div className="flex shrink-0 items-center gap-1">
        {/* The native bookmark toggle represents the live query's saved state.
            Custom providers are navigation shortcuts, not bookmark state. */}
        <ButtonGroup aria-label="Current query bookmark" className="shrink-0">
        <Tooltip>
          <TooltipTrigger render={
            <Button
              type="button" variant="outline" size="icon"
              aria-pressed={isQueryBookmarked}
              id="maestro-bookmark-button"
              disabled={bookmarkOpening}
              aria-label={bookmarkOpening ? "Opening bookmark dialog" : isQueryBookmarked ? "Remove this query bookmark" : "Bookmark this query"}
              className={`${bookmarkOpening ? "h-9 w-auto min-w-20 px-2.5" : "size-9"} text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:text-amber-500 ${bookmarkBounce && policyBookmarkVisible && !isQueryBookmarked ? "animate-bounce !border-amber-400 text-amber-500" : ""}`}
              onClick={async () => {
                setBookmarkAttention(false);
                setBookmarkBounce(false);
                if (isQueryBookmarked) {
                  try {
                    const response = await clientQueryFavorites( {
                      method: "POST",
                      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "RemoveBookmarkHash") },
                      body: JSON.stringify({ action: "unbookmark", queryXml, historyId: matchingBookmarkId || historyBookmarkId || undefined }),
                      cache: "no-store",
                    });
                    const payload = await response.json() as { removed?: boolean; error?: string };
                    if (!response.ok || !payload.removed) throw new Error(payload.error ?? `HTTP ${response.status}`);
                    revokeQueryBookmark();
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
                const currentHistoryId = await workspace.ensureHistoryVisitForBookmark();
                const metadataId = currentHistoryId || matchingBookmarkId;
                setBookmarkTitle(metadataId ? metadataId.slice(metadataId.lastIndexOf("#") + 1) : "");
                setBookmarkDescription("");
                setBookmarkTags("");
                setBookmarkTagVocabulary("skos");
                if (metadataId) {
                  try {
                    const response = await clientQueryFavorites( { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", historyId: metadataId }), cache: "no-store" });
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
            >{bookmarkOpening ? <span className="inline-flex min-w-0 items-center justify-center gap-1 whitespace-nowrap text-xs tabular-nums" aria-label={`Opening bookmark dialog, ${Math.floor(bookmarkOpeningTenths / 10)} seconds elapsed`}><BookmarkLoadingClock className="size-3.5 shrink-0" aria-hidden="true" /><span>{Math.floor(bookmarkOpeningTenths / 10)}s</span></span> : <Bookmark aria-hidden="true"
              className={isQueryBookmarked ? "fill-current text-amber-500" : bookmarkBounce && policyBookmarkVisible ? "text-amber-500" : ""}
              onAnimationIteration={() => {
                const visible = Boolean(document.querySelector('[data-policy-bookmark-banner="true"]'));
                if (!visible || !policyBookmarkVisible || isQueryBookmarked) setBookmarkBounce(false);
              }} />}</Button>
          } />
          <TooltipContent>{bookmarkAttention && !isQueryBookmarked ? "Bookmark this query to continue" : isQueryBookmarked ? "Remove this query bookmark" : "Bookmark this query"}</TooltipContent>
        </Tooltip>
        </ButtonGroup>
        {appbarButtons.length > 0 && (
        <ButtonGroup className="shrink-0" aria-label="Pinned bookmark shortcuts">
          {appbarButtons.slice(0, 2).map(item => {
            const iconName = availableAppbarIconNames.has(item.icon) ? item.icon as IconName : null;
            return <Tooltip key={item.uri}><TooltipTrigger render={<Button type="button" size="icon" variant="outline" aria-label={item.tooltip} title={item.tooltip} aria-current={matchedAppbarButton?.uri === item.uri ? "page" : undefined} className={matchedAppbarButton?.uri === item.uri ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"} onClick={() => openPinnedBookmark(item.url)}>{iconName ? <DynamicIcon name={iconName} className="size-4" aria-hidden="true" fallback={() => <Bookmark className="size-4" aria-hidden="true" />} /> : <Bookmark className="size-4" aria-hidden="true" />}</Button>} /><TooltipContent>{item.tooltip}</TooltipContent></Tooltip>;
          })}
          {appbarButtons.length > 2 && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon" aria-label="More pinned bookmarks" title="More pinned bookmarks" className="text-muted-foreground hover:text-foreground"><span className="text-lg leading-none" aria-hidden="true">…</span></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {appbarButtons.slice(2).map(item => {
                const iconName = availableAppbarIconNames.has(item.icon) ? item.icon as IconName : null;
                return <DropdownMenuItem key={item.uri} onSelect={() => openPinnedBookmark(item.url)}>
                  {iconName ? <DynamicIcon name={iconName} className="size-4" aria-hidden="true" fallback={() => <Bookmark className="size-4" aria-hidden="true" />} /> : <Bookmark className="size-4" aria-hidden="true" />}
                  <span>{item.tooltip}</span>
                  {matchedAppbarButton?.uri === item.uri ? <Check className="ml-auto size-4" /> : null}
                </DropdownMenuItem>;
              })}
            </DropdownMenuContent>
          </DropdownMenu>}
        </ButtonGroup>
        )}
        </div>
        )}
        <Dialog open={workspace.accessCapabilities.canUsePersonalStore && bookmarkDialogOpen} onOpenChange={(open) => { if (!bookmarkSaving) setBookmarkDialogOpen(open); }}>
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
                  const currentHistoryId = await workspace.ensureHistoryVisitForBookmark();
                  const targetHistoryId = currentHistoryId || matchingBookmarkId;
                  if (!targetHistoryId) throw new Error("The current query's History item could not be resolved. Please wait for History to synchronize and retry.");
                  const tags = bookmarkTags.split(/[,;\n]/u).map((tag) => tag.trim()).filter(Boolean);
                  const response = await clientQueryFavorites( {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "update", historyId: targetHistoryId, title: bookmarkTitle.trim() || targetHistoryId.slice(targetHistoryId.lastIndexOf("#") + 1), description: bookmarkDescription.trim(), tags, tagVocabulary: bookmarkTagVocabulary, queryXml: serializeFctQuery(queryTree), stateUrl: workspace.buildCurrentShareUrl(),
                      lastResultCount: effectiveResultsTotalCount,
                      lastNewCount: recordStatus.enabled && recordStatus.countsReady && !recordStatus.loading && !recordStatus.error ? recordStatus.counts.New : null }),
                  });
                  const payload = await response.json() as { error?: string; namespaces?: unknown; historyId?: string; shareUrl?: string };
                  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
                  if (payload.namespaces) rememberNamespaceMetadata(payload.namespaces);
                  confirmQueryBookmark(payload.historyId || matchingBookmarkId || historyBookmarkId);
                  setBookmarkCheckRevision((revision) => revision + 1);
                  const shareUrl = payload.shareUrl;
                  const savedAt = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
                  const savedName = bookmarkTitle.trim() || targetHistoryId.slice(targetHistoryId.lastIndexOf("#") + 1);
                  toast.add({
                    title: "Bookmark saved",
                    description: (
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="block"><span className="font-medium">Name:</span> {savedName}</span>
                        <span className="block"><span className="font-medium">Date:</span> {savedAt}</span>
                        {shareUrl && <span className="block min-w-0"><span className="font-medium">Link:</span> <a href={shareUrl} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-2">Open bookmark</a></span>}
                      </span>
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
              className="text-muted-foreground hover:text-foreground"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  noteMaestroClipboardCopy(window.location.href);
                  setShareLinkCopied(true);
                  toast.add({ title: "Share link copied", description: "The query URL is on your clipboard.", type: "success" });
                  window.setTimeout(() => setShareLinkCopied(false), 2500);
                } catch (error) {
                  setShareLinkCopied(false);
                  toast.add({ title: "Could not copy share link", description: error instanceof Error ? error.message : String(error), type: "error" });
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
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex rounded-full">
                    <Avatar className="size-9 ring-1 ring-border hover:ring-primary transition-all">
                      {authSession.avatarUrl && (
                        <AvatarImage src={authSession.avatarUrl} alt={authSession.userName || "User avatar"} />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-xs uppercase">
                        {(authSession.userName || "U")[0]}
                      </AvatarFallback>
                      <AvatarBadge className={`${graphInitializationPending ? "bg-amber-500 animate-pulse motion-reduce:animate-none" : workspace.accessCapabilities.policyStage === "failed" ? "bg-destructive" : "bg-emerald-500"} ring-2 ring-background`}>
                        <span className="sr-only">{graphInitializationPending ? "Graph loading in progress" : workspace.accessCapabilities.policyStage === "failed" ? "Personal initialization failed" : "Logged in"}</span>
                      </AvatarBadge>
                    </Avatar>
                  </span>} />
                  <TooltipContent>{graphInitializationPending ? "Graph loading in progress" : workspace.accessCapabilities.policyStage === "failed" ? `Personal initialization failed: ${workspace.accessCapabilities.policyError || "Verification unavailable"}` : "Connected"}</TooltipContent>
                </Tooltip>
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
                      <AvatarBadge className={`${graphInitializationPending ? "bg-amber-500 animate-pulse motion-reduce:animate-none" : workspace.accessCapabilities.policyStage === "failed" ? "bg-destructive" : "bg-emerald-500"} ring-2 ring-background`}>
                        <span className="sr-only">{workspace.accessCapabilities.policyStage === "ready" ? "Connected" : "Graph loading in progress"}</span>
                      </AvatarBadge>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{authSession.userName || "Personal Account"}</p>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className={`size-1.5 rounded-full ${graphInitializationPending ? "bg-amber-500 animate-pulse motion-reduce:animate-none" : workspace.accessCapabilities.policyStage === "failed" ? "bg-destructive" : "bg-emerald-500"}`} />
                        <span className="text-[10px] text-muted-foreground uppercase font-mono font-medium tracking-wide">
                          {workspace.accessCapabilities.policyStage === "ready" ? "Connected" : workspace.accessCapabilities.policyStage === "failed" ? `Initialization failed: ${workspace.accessCapabilities.policyError || "Unknown reason"}` : "Graph loading in progress"}
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
              {workspace.accessCapabilities.policyStage === "failed" && <DropdownMenuItem
                onClick={() => void handleRetryPersonalInitialization()}
                className="cursor-pointer gap-2"
              ><RotateCw className="size-4"/><span>Retry initialization</span></DropdownMenuItem>}
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
                  cancelPersonalInitialization();
                  disconnectPersonalAuthSession();
                  setAuthSession(null);
                  setPersonalPoliciesReady(true);
                  setPersonalPoliciesSeedError("");
                  setAuthRestoreIssue(false);
                  // Logout withdraws personal write capabilities; public reads and
                  // the browser-owned Shared/courtesy server directory are unchanged.
                  historyVisitQueryRef.current = "";
                  historyVisitIdRef.current = "";
                  pendingHistoryVisitRef.current = null;
                  setHistoryBookmarkId("");
                  toast.add({
                    title: "Disconnected",
                    description: "Personal access paused. Remembered credentials are kept for automatic reconnection.",
                    type: "info",
                  });
                  setBookmarkCheckRevision((r) => r + 1);
                }}
                className="cursor-pointer text-destructive focus:text-destructive gap-2"
              >
                <LogOut className="size-4" />
                <span>Disconnect</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  cancelPersonalInitialization();
                  clearPersonalAuthSession();
                  setAuthSession(null);
                  setPersonalPoliciesReady(true);
                  setPersonalPoliciesSeedError("");
                  setAuthRestoreIssue(false);
                  setHistoryBookmarkId("");
                  setBookmarkCheckRevision(r => r + 1);
                  toast.add({ title: "Account forgotten", description: "Remembered personal credentials were erased from this browser.", type: "info" });
                }}
                className="cursor-pointer text-destructive focus:text-destructive gap-2"
              >
                <KeyRound className="size-4" />
                <span>Forget Account</span>
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
                <p className="text-xs text-muted-foreground">Enter your read-only /sparql endpoint. Updates use the authenticated endpoint matching the method selected below.</p>
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
                <ErrorDetails prefix="Login" error={loginError} />
              )}

              <div className="flex justify-between items-center pt-2">
                <Button type="button" variant="outline" disabled={loginTesting} onClick={() => setLoginDialogOpen(false)}>
                  Cancel
                </Button>
                <div className="flex gap-2">
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
