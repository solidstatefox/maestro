"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Network, RefreshCw } from "lucide-react";
import { ErrorDetails } from "@/components/ui/error-details";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { providerStorage, subscribeProviderStorageChanges } from "@/lib/maestro-storage";
import { snapshotFctQueryXml } from "@/lib/fct-query-api";
import { parseFctResponse } from "@/canvas/utils/fct-response";
import { createMaestroViewDiscoveryController } from "@/lib/app-lifecycle/view-discovery";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { componentRetryHeaders, retryMaestroComponent, useMaestroComponentRetry } from "@/lib/maestro-component-retry";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { joinPredicateClusterViews, PREDICATE_CLUSTER_VIEW_NAMES,
  PREDICATE_CLUSTERS_ANALYSIS_URI, type AnalyticPage, type PredicateClusterAnalysis, type PredicateClusterView } from "@/lib/predicate-clusters-provider";
import type { AnalysisProvider } from "@/lib/personal-sparql-reads";
import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

const CONTEXT_NS = "gttp://ggg.maestro.ecosys/ns/xslt/context#";
const FCT_NS = "http://openlinksw.com/services/facets/1.0";
const RETRY_ID = "predicate-clusters";

// These settings belong to this RDF provider, not to the generic Maestro Sheet.
const DEFAULT_SETTINGS = { timeoutMs: 120000, maxCandidates: 500, maxIncidenceRows: 50000, cutoff: 0.55 } as const;
type PredicateClusterSettings = { timeoutMs: number; maxCandidates: number; maxIncidenceRows: number; cutoff: number };
const settingFields = ["timeoutMs", "maxCandidates", "maxIncidenceRows", "cutoff"] as const;
const validSetting = (key: keyof PredicateClusterSettings, value: number): boolean =>
  Number.isFinite(value) && (key === "timeoutMs" ? Number.isSafeInteger(value) && value >= 1000 && value <= 600000 :
    key === "maxCandidates" ? Number.isSafeInteger(value) && value >= 1 && value <= 1000 :
    key === "maxIncidenceRows" ? Number.isSafeInteger(value) && value >= 1 && value <= 500000 :
    value >= 0 && value <= 1);
async function readSettings(storage: ReturnType<typeof providerStorage>): Promise<PredicateClusterSettings> {
  const raw = await Promise.all(settingFields.map(key => storage.get(key)));
  const settings = { ...DEFAULT_SETTINGS } as PredicateClusterSettings;
  for (let i=0;i<settingFields.length;i++) {
    const key = settingFields[i];
    const text = raw[i];
    if (text === null) {
      await storage.set(key, String(settings[key]));
    } else {
      const value = Number(text);
      if (!text.trim() || !validSetting(key, value))
        throw new Error(`Invalid provider cubby property ${key}: ${text}. Edit it in Sheet → Provider properties.`);
      settings[key] = value;
    }
  }
  return settings;
}

function detachedProviderSource(liveQuery: string): string {
  const query = new DOMParser().parseFromString(snapshotFctQueryXml(liveQuery, "data"), "application/xml");
  if (query.querySelector("parsererror") || query.documentElement.localName !== "query")
    throw new Error("Invalid FCT query for Predicate Clusters.");
  const doc = document.implementation.createDocument(CONTEXT_NS, "m:context", null);
  const wrapper = doc.createElementNS(CONTEXT_NS, "m:query");
  wrapper.appendChild(doc.importNode(query.documentElement, true));
  doc.documentElement.appendChild(wrapper);
  return new XMLSerializer().serializeToString(doc);
}

/** The RDF provider's XSLT owns the projections, like the D3 Sankey program.
 * The input is detached; no mutation of live Query/History is possible. */
async function deriveQueries(liveQuery: string, stylesheet: string, settings: PredicateClusterSettings, signal: AbortSignal): Promise<Map<PredicateClusterView, string>> {
  const plan = await transformWithMaestroSaxon(stylesheet, detachedProviderSource(liveQuery), {signal, outputLimit: 600000});
  const doc = new DOMParser().parseFromString(plan, "application/xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || root.localName !== "analysis" || root.getAttribute("kind") !== "predicate-clusters")
    throw new Error("Unexpected Predicate Clusters provider program.");
  const wrappers = Array.from(root.getElementsByTagName("query")).filter(node => node.hasAttribute("view-type"));
  if (wrappers.length !== PREDICATE_CLUSTER_VIEW_NAMES.length) throw new Error("Predicate Clusters must declare three FCT views.");
  const output = new Map<PredicateClusterView, string>();
  for (const wrapper of wrappers) {
    const kind = wrapper.getAttribute("view-type");
    if (!PREDICATE_CLUSTER_VIEW_NAMES.some(name => name === kind) || output.has(kind as PredicateClusterView))
      throw new Error("Unexpected or repeated Predicate Clusters view.");
    const query = Array.from(wrapper.children).find(node => node.localName === "query" && node.namespaceURI === FCT_NS);
    const views = query ? Array.from(query.getElementsByTagNameNS(FCT_NS, "view")) : [];
    if (!query || views.length !== 1 || views[0].getAttribute("type") !== kind ||
        views[0].getAttribute("limit") !== "200" || views[0].getAttribute("offset") !== "0")
      throw new Error("The analytical projection is missing its complete FCT view.");
    // Cutoff is an ordinary FCT view parameter, shared across all three
    // projections; the source query and its History record stay untouched.
    views[0].setAttribute("cutoff", settings.cutoff.toFixed(2));
    views[0].setAttribute("limit", String(settings.maxCandidates));
    views[0].setAttribute("max-candidates", String(settings.maxCandidates));
    views[0].setAttribute("max-incidence-rows", String(settings.maxIncidenceRows));
    query.setAttribute("timeout", String(settings.timeoutMs));
    output.set(kind as PredicateClusterView, new XMLSerializer().serializeToString(query));
  }
  return output;
}

async function loadPredicateClusterAnalysis(liveQuery: string, stylesheet: string, settings: PredicateClusterSettings, retry: number, signal: AbortSignal): Promise<PredicateClusterAnalysis> {
  const queries = await deriveQueries(liveQuery, stylesheet, settings, signal);
  const views = await Promise.all(PREDICATE_CLUSTER_VIEW_NAMES.map(async kind => {
    const body = queries.get(kind);
    if (!body) throw new Error(`Missing ${kind} analytical projection.`);
    const response = await cachedFetchFct("/proxy/api/fct", {
      method: "POST", cache: "no-store", signal,
      headers: {"Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("predicate-clusters", `Analysis:${kind}`),
        "x-maestro-view-tab": "analyze", "x-maestro-view-ribbon": PREDICATE_CLUSTERS_ANALYSIS_URI,
        ...componentRetryHeaders(retry)},
      body,
    });
    const xml = await response.text();
    signal.throwIfAborted();
    // HTTP 206 is technically response.ok, but incomplete analytics must not
    // be accepted. Keep the ENTIRE FCT error document in ErrorDetails/Copy:
    // it contains Virtuoso's original headers, body and executed SPARQL.
    if (response.status !== 200) throw new Error(`${kind} failed (HTTP ${response.status}):\n${xml}`);
    const parsed = parseFctResponse(xml);
    if (parsed.viewType !== kind || parsed.incomplete || parsed.complete !== "yes")
      throw new Error(`${kind} returned incomplete or unexpected FCT data: ${parsed.error || parsed.warning || "unknown response"}\n${xml}`);
    return parsed as AnalyticPage;
  }));
  signal.throwIfAborted();
  return joinPredicateClusterViews(views[0], views[1], views[2]);
}

export function AnalyzePredicateClusters({workspace, definition}:{workspace:WorkspaceController;definition:AnalysisProvider}) {
  const retry = useMaestroComponentRetry(RETRY_ID);
  // Match the exact account scope used by Sunburst's existing cubby.
  const accountScope = JSON.stringify([workspace.authSession?.graphStore,
    workspace.authSession?.graphPrefix, workspace.authSession?.username ?? workspace.authSession?.userName]);
  const storage = useMemo(() => providerStorage(definition.uri, accountScope), [definition.uri, accountScope]);
  const [settingsState,setSettingsState] = useState<{owner: string; value: PredicateClusterSettings} | null>(null);
  const owner = JSON.stringify([definition.uri,accountScope]);
  const settings = settingsState?.owner === owner ? settingsState.value : null;
  const [settingsError,setSettingsError] = useState("");
  const [cutoffDraft,setCutoffDraft] = useState(0.55);
  useEffect(() => {
    let live = true;
    setSettingsState(null);
    let hydrated = false;
    const read = () => void readSettings(storage).then(value => {
      if (!live) return;
      setSettingsState(previous => previous?.owner === owner && settingFields.every(field=>previous.value[field]===value[field])
        ? previous : {owner, value});
      setCutoffDraft(value.cutoff); setSettingsError("");
    }).catch(cause=>{if(live)setSettingsError(cause instanceof Error ? cause.message : String(cause));})
      .finally(()=>{hydrated=true;});
    read();
    const unsubscribe = subscribeProviderStorageChanges(change => {
      if (hydrated && change.providerIri===definition.uri && change.accountScope===accountScope) read();
    });
    return () => {live=false;unsubscribe();};
  }, [storage,definition.uri,accountScope,owner]);
  const cutoff = settings?.cutoff ?? DEFAULT_SETTINGS.cutoff;
  const applyCutoff = (value: number) => {
    if (!validSetting("cutoff", value)) return;
    void storage.set("cutoff", String(value)).catch(cause =>
      setSettingsError(cause instanceof Error ? cause.message : String(cause)));
  };
  const [controller] = useState(() => createMaestroViewDiscoveryController<PredicateClusterAnalysis>("maestro-predicate-clusters-analysis"));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const key = useMemo(() => JSON.stringify([workspace.queryXml, workspace.queryRefreshRevision,
    workspace.policyApprovalRevision, workspace.authSession?.userName, workspace.authSession?.graphStore, definition.uri, definition.stylesheet, owner, settings?.timeoutMs, settings?.maxCandidates, settings?.maxIncidenceRows, cutoff, retry]),
    [workspace.queryXml, workspace.queryRefreshRevision, workspace.policyApprovalRevision, workspace.authSession?.userName, workspace.authSession?.graphStore, definition.uri, definition.stylesheet, owner, settings?.timeoutMs, settings?.maxCandidates, settings?.maxIncidenceRows, cutoff, retry]);
  const ready = settings !== null && workspace.endpointReadyForQuery && !workspace.queryExecutionCancelled;
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => {
    if (workspace.queryExecutionCancelled) {controller.cancel();return;}
    if (!ready || !settings) {controller.wait(key, settingsError || (settings ? "Waiting for the graph server" : "Loading provider settings"));return;}
    controller.discover(key, signal => loadPredicateClusterAnalysis(workspace.queryXml,definition.stylesheet,settings,retry,signal).then(item=>[item]));
  }, [controller, key, ready, workspace.queryExecutionCancelled,workspace.queryXml, definition.stylesheet, settings, settingsError, retry]);
  const current = snapshot.context.key === key;
  const phase = current ? String(snapshot.value) : "waiting";
  const result = current && phase === "ready" ? snapshot.context.items[0] : undefined;
  const error = current ? snapshot.context.error : "";
  const [selectedCluster, setSelectedCluster] = useState("");
  const [highlightedProperty, setHighlightedProperty] = useState("");
  const active = result?.clusters.find(cluster => cluster.id === selectedCluster) ?? result?.clusters[0];
  const onRetry = () => retryMaestroComponent(RETRY_ID);
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Predicate Clusters analysis">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-2"><Network className="size-5 text-muted-foreground" aria-hidden="true"/><div>
        <h2 className="font-semibold">Predicate Clusters</h2>
        <p className="text-xs text-muted-foreground">Properties ranked globally and grouped by shared-subject similarity</p>
        {settings && <p className="text-xs text-muted-foreground" title="Edit provider cubby values in Sheet → Provider properties">Timeout {settings.timeoutMs / 1000}s · Candidate ceiling {settings.maxCandidates} · Incidence budget {settings.maxIncidenceRows.toLocaleString()} · Sheet → Provider properties</p>}
      </div></div>
      <button type="button" title="Recompute predicate analysis" aria-label="Retry predicate analysis" onClick={onRetry}
        className="rounded-md border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="size-4"/></button>
    </header>
    <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-xs">
      <label htmlFor="maestro-predicate-cluster-cutoff" className="whitespace-nowrap text-muted-foreground">Similarity cutoff</label>
      <input id="maestro-predicate-cluster-cutoff" type="range" min="0" max="1" step="0.05" value={cutoffDraft}
        onChange={event => setCutoffDraft(Number(event.target.value))}
        onPointerUp={() => applyCutoff(cutoffDraft)} onKeyUp={() => applyCutoff(cutoffDraft)} onBlur={() => applyCutoff(cutoffDraft)}
        className="w-36 accent-primary"/>
      <span className="tabular-nums">{cutoffDraft.toFixed(2)}</span>
      {cutoffDraft !== cutoff && <button type="button" className="underline" onClick={() => applyCutoff(cutoffDraft)}>Apply</button>}
    </div>
    {settingsError && <div role="alert" className="p-4 text-sm text-destructive">{settingsError}</div>}
    {error && <div className="p-4"><ErrorDetails prefix="Predicate Clusters" error={error}/><button className="mt-2 text-sm underline" onClick={onRetry}>Retry analysis</button></div>}
    {(phase === "loading" || phase === "waiting" || !current) && !error && <p role="status" className="p-4 text-sm text-muted-foreground">{ready ? "Computing property ranking and clusters…" : "Waiting for the graph server…"}</p>}
    {phase === "cancelled" && <p role="status" className="p-4 text-sm text-muted-foreground">Analysis cancelled.</p>}
    {result && result.ranks.length === 0 && <p role="status" className="p-4 text-sm text-muted-foreground">No predicates in this FCT population.</p>}
    {result && result.ranks.length > 0 && <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-0 overflow-hidden lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.4fr)] lg:grid-rows-1">
      <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
        <div className="shrink-0 border-b px-4 py-3 text-sm font-semibold">Ranked properties <span className="ml-1 text-xs font-normal text-muted-foreground">({result.ranks.length})</span></div>
        <ol className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 py-2" aria-label="Globally ranked predicates">
          {result.ranks.map(property => <li key={property.uri}>
            <button type="button" title={property.uri} onClick={() => {setSelectedCluster(property.cluster);setHighlightedProperty(property.uri);}}
              aria-pressed={highlightedProperty === property.uri}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${highlightedProperty === property.uri ? "bg-accent font-semibold" : ""}`}>
              <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{property.rank}</span>
              <span className="min-w-0 flex-1 truncate">{property.label}</span>
              <span className="text-xs text-muted-foreground">{property.cluster}</span>
            </button>
          </li>)}
        </ol>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b px-4 py-3 text-sm font-semibold">Clusters <span className="ml-1 text-xs font-normal text-muted-foreground">({result.clusters.length})</span></div>
        <Tabs className="flex min-h-0 flex-1 flex-col overflow-hidden" value={active?.id || ""} onValueChange={setSelectedCluster}>
          <div className="shrink-0 overflow-x-auto border-b px-2 py-2">
            <TabsList aria-label="Predicate cluster tabs" className="w-max min-w-full justify-start">
              {result.clusters.map(cluster => <TabsTrigger key={cluster.id} value={cluster.id}
                title={`${cluster.id}: ${cluster.count} predicates; example ${cluster.sampleLabel}`}>
                {cluster.id} <span className="ml-1 tabular-nums text-muted-foreground">({cluster.count})</span>
                <span className="ml-2 max-w-36 truncate rounded border px-1 text-xs font-normal" title={cluster.sampleUri}>e.g. {cluster.sampleLabel}</span>
              </TabsTrigger>)}
            </TabsList>
          </div>
          {result.clusters.map(cluster => <TabsContent key={cluster.id} value={cluster.id} className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{cluster.id}</span>
              <span className="text-xs text-muted-foreground">{cluster.count} {cluster.count === 1 ? "property" : "properties"}</span>
              <Badge variant="outline" title={cluster.sampleUri}>e.g. {cluster.sampleLabel}</Badge>
            </div>
            <ul className="space-y-1" aria-label={`${cluster.id} ranked properties`}>
              {cluster.members.map(member => <li key={member.uri}>
                <button type="button" title={member.uri} onClick={() => setHighlightedProperty(member.uri)}
                  aria-pressed={highlightedProperty === member.uri}
                  className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${highlightedProperty === member.uri ? "border-ring bg-accent" : "border-transparent"}`}>
                  <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">#{member.rank}</span>
                  <span className="min-w-0 flex-1 truncate">{member.label}</span>
                </button>
              </li>)}
            </ul>
          </TabsContent>)}
        </Tabs>
      </div>
    </div>}
  </section>;
}
