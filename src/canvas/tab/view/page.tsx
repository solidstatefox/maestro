"use client";
import { MaestroSelect } from "@/components/ui/maestro-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { Ban, Telescope } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchesAlphabetSelection, parseAlphabetSelections, toggleAlphabetSelection } from "@/lib/alphabet-selections";
import { RESULTS_PAGE_SIZE_STORAGE_KEY } from "@/canvas/sheet/settings";
import { IncompleteWidgetIndicator } from "@/canvas/utils/incomplete-widget";

import { ViewPage } from "@/canvas/tab/view/view-components";
import { canRefreshApprovedProvider } from "@/lib/app-lifecycle/context-guards";
import { changeApprovals } from "@/lib/approval-update";
import { facetValueKey, fctTermKey } from "@/canvas/utils/fct-response";
import { PerspectiveProviderRuntime } from "@/canvas/tab/view/perspective-provider-runtime";
import { PersonalPerspectives } from "@/canvas/tab/view/personal-perspectives";
import { type EndpointCandidate } from "@/lib/client-endpoint-discovery";
import { GraphServerManager } from "@/canvas/tab/view/graph-server-manager";
import { GraphServerHistoryScope } from "@/canvas/tab/view/graph-server-status-history";
import { personalPerspectiveFromUri, personalPerspectiveMatchesQuery } from "@/lib/personal-perspective-ids";

import { Separator } from "@/components/ui/separator";

import { toast } from "@/components/ui/toast";

import { shortenCount } from "@/lib/utils";
import { formatPagePosition } from "@/canvas/utils/pagination";

import { maestroStorageSet } from "@/lib/maestro-storage";

import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

export function ViewTabCanvas({ workspace }: { workspace: WorkspaceController }) {
 const { alphabetCounts, alphabetError, alphabetIndex, alphabetLabelUris, alphabetPreflight, changeResultsPage, checkSelectedGraphServer, checkingEndpointIds, chooseFctEndpoint, discoveredViews, effectivePageSize, effectiveResultsTotalCount, fctEndpoints, isLoadingAlphabet, isSearching, preferredAlphabetLanguage, results, resultsBatchRequestPending, resultsBatchSize, resultsPageComplete, resultsPageSize, resultsPageSizeOptions, resultsUiPage, selectedEndpointId, selectedView, selectedViewUri, setNodeAttribute, setResults, setResultsPage, setResultsPageSize, setResultsUiPage, setSelectedViewUri, viewDiscoveryError, viewDiscoveryLoading, viewProvider, viewProviderCount, viewProviderError, viewProviderHtml, viewProviderLoading, viewHtml, viewRenderError, visibleResultsPage, workspaceTab } = workspace;
 const [selectedGraphCardUri, setSelectedGraphCardUri] = useState("");
 useEffect(() => { setSelectedGraphCardUri(""); }, [workspace.queryXml]);
 const isGraphServerPerspective = workspace.viewPanel === "perspectives" &&
   selectedViewUri === "gttp://ggg.maestro.ecosys/shacl/provider/entrypoint";
 const pageUriRows = workspace.visibleResultsPage.filter(row => !row.termType || row.termType === "uri");
 const pageKey = JSON.stringify([workspace.queryXml,workspace.queryRefreshRevision,resultsUiPage,resultsPageSize,pageUriRows.map(row=>[row.uri,row.title])]);
 const [registerCandidate, setRegisterCandidate] = useState<EndpointCandidate | null>(null);
 useEffect(() => { setRegisterCandidate(null); }, [pageKey, selectedViewUri]);
 const graphServerCardRows = useMemo(() => workspace.graphServerViewRows.map((row,index) => {
   const endpoint = fctEndpoints.find(option => option.id === row.endpointId);
   const status = endpoint ? workspace.endpointStatuses[endpoint.id] : undefined;
   let domain = "";
   try { domain = new URL(row.endpoint).hostname.replace(/^www\./i, "").toLowerCase(); } catch {}
   const software = endpoint ? workspace.viewServerSoftware[endpoint.id] : undefined;
   return { ...row, label: row.title,
     description: row.description || (endpoint ? workspace.viewServerDescriptions[endpoint.id] : undefined),
     software: software && software.product !== "Unknown" ? [software.product,software.version].filter(Boolean).join(" · ") : undefined,
     rank: workspace.viewDomainRanks[domain],
     selected: Boolean(index===0 && endpoint && endpoint.id === selectedEndpointId),
     health: endpoint && checkingEndpointIds[endpoint.id] ? "Checking…" : status?.status === 200 && status.state === "ok" ? "Healthy" : status?.state ?? (row.endpoint ? "Not yet pinged" : "No endpoint URL"),
     healthState: status?.status === 200 && status.state === "ok" ? "green" : !status ? "unknown" : status.state === "degraded" || status.state === "probe-error" || status.status === null || (status.status >= 400 && status.status < 500) ? "amber" : status.status >= 500 ? "red" : "unknown" };
 }), [workspace.graphServerViewRows, fctEndpoints, workspace.endpointStatuses, selectedEndpointId, checkingEndpointIds, workspace.viewServerSoftware, workspace.viewServerDescriptions, workspace.viewDomainRanks]);
 const toggleGraphCard = (uri: string) => setSelectedGraphCardUri(previous => previous === uri ? "" : uri);
 const [providerLetter, setProviderLetter] = useState("");
 const [selectAllPendingKey, setSelectAllPendingKey] = useState("");
 const selectAllContextKey = `${workspace.queryXml}\u0000${workspace.viewProvider ?? ""}`;
 const selectAllPending = Boolean(selectAllPendingKey && selectAllPendingKey === selectAllContextKey);
 // Async completion may update approval metadata, but must not refresh a new
 // query/perspective that replaced the originating Providers session.
 const approvalContextRef = useRef({ query: workspace.queryXml, panel: workspace.viewPanel, providerKind: workspace.viewProvider, tab: workspace.workspaceTab });
 approvalContextRef.current = { query: workspace.queryXml, panel: workspace.viewPanel, providerKind: workspace.viewProvider, tab: workspace.workspaceTab };
 const approvalCurrent = (query: string, providerKind: typeof workspace.viewProvider) => {
   return canRefreshApprovedProvider(approvalContextRef.current, query, providerKind);
 };
 // The approval endpoint verifies the saved query identity; client bookmark ID
 // synchronization must not hide controls for an already saved query.
 const approvalReady = Boolean(viewProvider && viewProviderHtml.includes('data-policy-action="toggle"'));
 const policyVisible = workspaceTab === "view" && workspace.viewPanel === "providers" && Boolean(viewProvider);
 const policyBookmarkNeeded = policyVisible && !workspace.accessCapabilities.canApproveProvider && viewProviderCount > 0 && !viewProviderLoading;
 useEffect(() => {
   window.dispatchEvent(new CustomEvent("maestro:policy-bookmark-attention", { detail: { active: policyBookmarkNeeded } }));
   return () => { window.dispatchEvent(new CustomEvent("maestro:policy-bookmark-attention", { detail: { active: false } })); };
 }, [policyBookmarkNeeded]);
 const personalKind = selectedView && personalPerspectiveMatchesQuery(selectedViewUri, workspace.queryTree) ? personalPerspectiveFromUri(selectedViewUri) : null;
 const selectedRdfProvider = selectedView;
 const providerSelected = Boolean(!personalPerspectiveFromUri(selectedViewUri) && selectedRdfProvider?.queryStylesheet && selectedRdfProvider?.resultStylesheet && workspace.viewPanel !== "providers");
 // Include the actual Personal facet values, not just geocoded marker values.
 // Some values in a facet have no corresponding mapped resource and must still
 // receive an item decoration when that facet is selected for Color By.
 const visibleFacetTerms = useMemo(() => ({
   ...Object.fromEntries(workspace.personalWidgets.map(widget => [
     widget.anchor ? `alias:${widget.anchor.id}` : `forward|${widget.uri}`, widget.values.map(facetValueKey),
   ])),
   "class|http://www.w3.org/1999/02/22-rdf-syntax-ns#type": workspace.classFacets.map(facet => fctTermKey(facet.uri, "uri")),
 }), [workspace.personalWidgets, workspace.classFacets]);
 useEffect(() => { setProviderLetter(""); }, [viewProvider]);
 const providerCards = useMemo(() => {
   if (!viewProvider || viewProviderLoading || !viewProviderHtml || typeof DOMParser === "undefined") return [] as { letter: string; uri: string; approved: boolean; hasStatus: boolean }[];
   const doc = new DOMParser().parseFromString(viewProviderHtml, "text/html");
   return Array.from(doc.querySelectorAll("article")).map((card) => {
     const label = card.querySelector("h3, strong")?.textContent?.trim() ?? "";
     return { letter: /^[a-z]/i.test(label) ? label[0].toUpperCase() : "#", uri: card.getAttribute("data-provider-uri") ?? "", approved: Boolean(card.querySelector('input[data-policy-action="toggle"]:checked')), hasStatus: Boolean(card.querySelector('input[data-policy-action="toggle"]')) };
   });
 }, [viewProvider, viewProviderHtml, viewProviderLoading]);
 const providerLetters = useMemo(() => {
   const counts: Record<string, number> = {};
   for (const card of providerCards) counts[card.letter] = (counts[card.letter] ?? 0) + 1;
   return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
 }, [providerCards]);
 const visibleProviderCards = providerCards.filter((card) => matchesAlphabetSelection(providerLetter, card.letter));
 const visibleProviderCount = viewProvider ? visibleProviderCards.length : viewProviderCount;
 const selectedVisibleCount = visibleProviderCards.filter(card => card.approved).length;
 async function selectAllProviders() {
   if (!viewProvider || selectAllPending || !visibleProviderCards.length) return;
   if (!workspace.accessCapabilities.canApproveProvider || !approvalReady) {
     window.dispatchEvent(new Event("maestro:bookmark-query-request"));
     return;
   }
   const pending = [...new Set(visibleProviderCards.filter(card => card.hasStatus && !card.approved).map(card => card.uri).filter(Boolean))];
   if (!pending.length) return;
   const originQuery = workspace.queryXml;
   const originProvider = workspace.viewProvider;
   const startedKey = `${originQuery}\u0000${originProvider ?? ""}`;
   setSelectAllPendingKey(startedKey);
   try {
     await changeApprovals(pending, "Approved", workspace.authSession?.graphPrefix ?? "", originQuery);
     workspace.setPolicyApprovalRevision(current => current + 1);
     if (approvalCurrent(originQuery, originProvider)) workspace.refreshQuery();
   } catch (error) {
     toast.add({ title: "Approve All failed", description: error instanceof Error ? error.message : "Unable to approve policies.", type: "error" });
   } finally { setSelectAllPendingKey(current => current === startedKey ? "" : current); }
 }
 const visibleProviderHtml = !viewProvider || typeof DOMParser === "undefined" ? viewProviderHtml : (() => {
   const doc = new DOMParser().parseFromString(viewProviderHtml, "text/html");
   for (const article of Array.from(doc.querySelectorAll('article[data-provider-uri]'))) {
     const label = article.querySelector("h3, strong")?.textContent?.trim() ?? "";
     const letter = /^[a-z]/i.test(label) ? label[0].toUpperCase() : "#";
     if (providerLetter && !matchesAlphabetSelection(providerLetter, letter)) { article.remove(); continue; }
     const uri = article.getAttribute("data-provider-uri") ?? "";

   }
   return doc.body.innerHTML;
 })();
 const viewPagination = <div className="flex min-w-0 items-center gap-3 text-xs"><span className="text-muted-foreground">{formatPagePosition(resultsUiPage, effectiveResultsTotalCount === null ? (resultsPageComplete ? Math.max(1, Math.ceil(results.length / resultsPageSize)) : null) : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize)))}</span>
                  <div className="flex items-center gap-2"><label htmlFor="view-page-size">Per page</label>
                    <MaestroSelect id="view-page-size" className="rounded border bg-background px-2 py-1" value={effectivePageSize} onChange={(event) => { const n=Number(event.currentTarget.value); setResultsPageSize(n); maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY,String(n)); setResultsUiPage(0); }}>
                      {resultsPageSizeOptions.map((n) => <option value={n} key={n}>{n}</option>)}
                    </MaestroSelect>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={resultsUiPage===0 || isSearching} onClick={() => changeResultsPage(-1)}>Previous</button>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={isSearching || (effectiveResultsTotalCount === null ? (results.length <= (resultsUiPage+1)*resultsPageSize && (resultsPageComplete || resultsBatchRequestPending.current)) : resultsUiPage+1 >= Math.ceil(effectiveResultsTotalCount/resultsPageSize))} onClick={() => changeResultsPage(1)}>Next</button>
                  </div>
                </div>;
 return <GraphServerHistoryScope active={isGraphServerPerspective && workspaceTab === "view" && workspace.accessCapabilities.canUsePersonalStore} account={JSON.stringify([workspace.authSession?.graphStore,workspace.authSession?.graphPrefix,workspace.authSession?.username])} queryXml={workspace.queryXml}>
{workspaceTab === "view" && <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Views">
                {personalKind && !viewProvider && selectedView && workspace.viewPanel !== "providers" ? <>
                  {workspace.perspectivePageReady ? <PersonalPerspectives key={selectedViewUri} active={workspace.accessCapabilities.canUsePersonalStore} kind={personalKind} provider={selectedView} queryXml={workspace.queryXml} pageRows={pageUriRows} pageKey={pageKey} onReload={workspace.refreshQuery} onBrowse={() => workspace.setWorkspaceTab("browse")} onOpenShareUrl={workspace.openPinnedShareUrl}/> : <p role="status" className="flex-1 p-4 text-sm text-muted-foreground">{workspace.searchError || "Waiting for live Results…"}</p>}
                  <div className="flex shrink-0 justify-end border-t px-4 py-2">{viewPagination}</div>
                </> : providerSelected && selectedRdfProvider && !viewProvider ? <>
                  {workspace.perspectivePageReady ? <PerspectiveProviderRuntime key={selectedRdfProvider.uri} provider={selectedRdfProvider} queryXml={workspace.queryXml} pageRows={pageUriRows} pageKey={pageKey} queryTree={workspace.queryTree} addr={workspace.queryTree.attributes.addr ?? ""} visibleFacetTerms={visibleFacetTerms}/> : <p role="status" className="flex-1 p-4 text-sm text-muted-foreground">{workspace.searchError || "Waiting for live Results…"}</p>}
                  <div className="flex shrink-0 justify-end border-t px-4 py-2">{viewPagination}</div>
                </> : <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3">
                  {viewProvider ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="group" aria-label={`Alphabet for ${viewProvider}`}>
                    <ToggleGroup type="multiple" value={parseAlphabetSelections(providerLetter).map(value => value.replace(/^!/, ""))} onValueChange={() => {}} className="flex flex-wrap items-center gap-1">{providerLetters.map(([letter, count]) => <ToggleGroupItem unstyled key={letter} value={letter} type="button" aria-label={`${letter}: ${count} ${viewProvider}; Shift-click excludes the letter`}
                      aria-pressed={parseAlphabetSelections(providerLetter).some((value) => value === letter || value === `!${letter}`)}
                      onClick={(event) => setProviderLetter((current) => toggleAlphabetSelection(current, letter, event.shiftKey))}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${parseAlphabetSelections(providerLetter).some((value) => value === letter || value === `!${letter}`) ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                      <span>{parseAlphabetSelections(providerLetter).includes(`!${letter}`) ? <><span className="inline-flex items-center gap-1.5"><Ban aria-label="Excluded" className="size-3.5 shrink-0" />{letter}</span></> : letter}</span><Separator orientation="vertical" className="mx-1 h-4"/><span>{count}</span>
                    </ToggleGroupItem>)}
                  </ToggleGroup></div> : null}
                  {!viewProvider && (alphabetPreflight === "available" || Boolean(alphabetIndex) || isLoadingAlphabet) && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="group" aria-label="Alphabetical filter for View results">                    {!isLoadingAlphabet && <IncompleteWidgetIndicator source="alphabet" />}
                    {(alphabetPreflight === "available" || Boolean(alphabetIndex)) ? <>
                      <ToggleGroup type="multiple" value={parseAlphabetSelections(alphabetIndex).map(value => value.replace(/^!/, ""))} onValueChange={() => {}} className="flex flex-wrap items-center gap-1">{Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").filter((letter) => (alphabetCounts[letter] ?? 0) > 0 || parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`)).map((letter) => (
                        <ToggleGroupItem unstyled key={letter} value={letter} type="button" title={`Letter ${letter}; Shift-click excludes it; multiple selections are OR`} aria-label={`Letter ${letter}: ${alphabetCounts[letter] ?? 0} results`} aria-pressed={parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`)}
                          disabled={isLoadingAlphabet || (!alphabetCounts[letter] && !parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`))}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`) ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "border-border hover:bg-accent hover:text-accent-foreground"}`}
                          onClick={(event) => {
                            setNodeAttribute("query-view", "indexLabels", alphabetLabelUris);
                            setNodeAttribute("query-view", "index", toggleAlphabetSelection(alphabetIndex, letter, event.shiftKey) || null);
                            setResultsUiPage(0); setResults([]); setResultsPage(resultsBatchSize, 0);
                          }}>
                          <span className="font-medium">{parseAlphabetSelections(alphabetIndex).includes(`!${letter}`) ? <><span className="inline-flex items-center gap-1.5"><Ban aria-label="Excluded" className="size-3.5 shrink-0" />{letter}</span></> : letter}</span>
                          <Separator orientation="vertical" className="mx-1 h-4 bg-current opacity-30 data-vertical:self-center" />
                          <span className={`tabular-nums font-normal ${parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`) ? "text-primary-foreground/65" : "text-muted-foreground"}`}>{shortenCount(alphabetCounts[letter] ?? 0)}</span>
                        </ToggleGroupItem>
                      ))}</ToggleGroup>
                    </> : null}
                    {isLoadingAlphabet && <span className="text-xs text-muted-foreground"><ElapsedStatus label="Fetching alphabet" category="alphabet" clockScope="alphabet" requestWaves={26} /></span>}
                    
                  </div>}
                  {!viewProvider && selectedView && <span className="text-xs text-muted-foreground">{selectedView.label} · {visibleResultsPage.length} results on this page</span>}
                </div>
                {viewProvider && <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs" role="toolbar" aria-label={`${viewProvider} actions`}>
                  {viewProvider && <button type="button" disabled={!workspace.accessCapabilities.canApproveProvider || viewProviderLoading || selectAllPending || !visibleProviderCards.some(card => card.hasStatus && !card.approved)}
                    className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void selectAllProviders()}>
                    {selectAllPending ? "Selecting…" : "Approve All"}
                  </button>}
                  <span className="text-muted-foreground">{selectedVisibleCount} / {visibleProviderCount} approved</span>
                  <div className="ml-auto">{viewPagination}</div>

                </div>}
                {isGraphServerPerspective && <>
                  <GraphServerManager canMutate={workspace.accessCapabilities.canMutatePersonalStore}
                    account={JSON.stringify([workspace.authSession?.graphStore,workspace.authSession?.graphPrefix,workspace.authSession?.username])} configuredEndpoints={fctEndpoints}
                    registrationCandidate={registerCandidate}
                    onCandidateConsumed={() => setRegisterCandidate(null)}
                    onRegistryChange={() => workspace.setEndpointReloadRevision(revision => revision + 1)} />

                </>}
                {<ViewPage graphServerCards={isGraphServerPerspective ? graphServerCardRows : []}
                  selectedGraphCardUri={selectedGraphCardUri} onSelectGraphCard={toggleGraphCard} onRegisterEndpoint={workspace.accessCapabilities.canMutatePersonalStore ? setRegisterCandidate : undefined} canReadGraphHistory={workspace.accessCapabilities.canUsePersonalStore}
                  onBrowse={() => workspace.setWorkspaceTab("browse")} queryXml={workspace.queryXml} requiresBookmark={policyBookmarkNeeded} viewProvider={viewProvider} viewProviderLoading={viewProviderLoading} viewProviderError={viewProviderError} viewProviderCount={visibleProviderCount} viewProviderHtml={visibleProviderHtml} viewDiscoveryLoading={viewDiscoveryLoading} viewDiscoveryError={viewDiscoveryError} selectedView={selectedView} selectedViewUri={selectedViewUri} viewSelectionPending={viewDiscoveryLoading || workspace.queryContextLoading} viewRenderError={viewRenderError} viewHtml={viewHtml} viewRenderPhase={workspace.viewRenderPhase} kanbanGroupingOptions={workspace.kanbanGroupingOptions} kanbanGroupKey={workspace.kanbanGroupKey} onKanbanGroupChange={workspace.setKanbanGroupChoice} onKanbanMoveCard={workspace.kanbanMoveCard} onSelectEndpoint={(id) => { const endpoint = fctEndpoints.find((item) => item.id === id); if (endpoint && endpoint.id !== selectedEndpointId) void chooseFctEndpoint(endpoint.id); }} onRefreshEndpoint={(id) => { const endpoint = fctEndpoints.find((item) => item.id === id); if (!endpoint || checkingEndpointIds[id]) return; void checkSelectedGraphServer(endpoint).catch((error) => { toast.add({ title: "Could not refresh graph server health", description: error instanceof Error ? error.message : "Health check failed.", type: "error" }); }); }} onOpenResource={(uri) => {
                    // Provider cards are FCT result items. Selecting their Record
                    // must preserve the bookmarked live Providers query, rather
                    // than replacing it with an unbookmarked URI-root query.
                    if (workspaceTab === "view" && workspace.viewPanel === "providers" && viewProvider) {
                      workspace.setSelectedUri(uri);
                    } else workspace.openRecordPropertyUri(uri);
                  }} onPolicyAction={(uri, action, checked) => {
                    if (action === "bookmark" || !workspace.accessCapabilities.canApproveProvider || !approvalReady) {
                      window.dispatchEvent(new Event("maestro:bookmark-query-request"));
                      return;
                    }
                    const statusAction = action === "forget" ? "forget" : checked ? "approve" : "pending";
                    const originQuery = workspace.queryXml;
                    const originProvider = workspace.viewProvider;
                    void changeApprovals([uri], statusAction === "forget" ? null : statusAction === "approve" ? "Approved" : "Pending",
                      workspace.authSession?.graphPrefix ?? "", originQuery).then(() => {
                      workspace.setPolicyApprovalRevision(current => current + 1);
                      // A late approval may update shared metadata but must not
                      // refresh a different live FCT context.
                      if (approvalCurrent(originQuery, originProvider)) workspace.refreshQuery();
                    }).catch(error => toast.add({ title: "Policy approval failed", description: error instanceof Error ? error.message : "The change could not be saved.", type: "error" }));
                  }} />}
                {!viewProvider && selectedView && <div className="flex shrink-0 items-center justify-end border-t px-4 py-2">{viewPagination}</div>}
              </>}
              </div>}
</GraphServerHistoryScope>;
}
