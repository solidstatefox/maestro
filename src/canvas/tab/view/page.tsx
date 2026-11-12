"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { Ban } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { matchesAlphabetSelection, parseAlphabetSelections, toggleAlphabetSelection } from "@/lib/alphabet-selections";
import { RESULTS_PAGE_SIZE_STORAGE_KEY } from "@/canvas/sheet/settings";
import { IncompleteWidgetIndicator } from "@/canvas/utils/incomplete-widget";

import { ViewPage } from "@/canvas/tab/view/view-components";
import { facetValueKey, fctTermKey } from "@/canvas/utils/fct-response";
import { PerspectiveProviderRuntime } from "@/canvas/tab/view/perspective-provider-runtime";
import { useMapProviderDefinition } from "@/lib/map-provider-discovery";
import { PersonalPerspectives } from "@/canvas/tab/view/personal-perspectives";
import { personalPerspectiveFromUri } from "@/lib/personal-perspective-ids";

import { Separator } from "@/components/ui/separator";

import { toast } from "@/components/ui/toast";

import { shortenCount } from "@/lib/utils";
import { formatPagePosition } from "@/canvas/utils/pagination";

import { maestroStorageSet } from "@/lib/maestro-storage";

import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

export function ViewTabCanvas({ workspace }: { workspace: WorkspaceController }) {
 const { alphabetCounts, alphabetError, alphabetIndex, alphabetLabelUris, alphabetPreflight, changeResultsPage, checkSelectedGraphServer, checkingEndpointIds, chooseFctEndpoint, discoveredViews, effectivePageSize, effectiveResultsTotalCount, fctEndpoints, isLoadingAlphabet, isSearching, preferredAlphabetLanguage, results, resultsBatchRequestPending, resultsBatchSize, resultsPageComplete, resultsPageSize, resultsPageSizeOptions, resultsUiPage, selectedEndpointId, selectedView, selectedViewUri, setNodeAttribute, setResults, setResultsPage, setResultsPageSize, setResultsUiPage, setSelectedViewUri, viewDiscoveryError, viewDiscoveryLoading, viewFeature, viewFeatureCount, viewFeatureError, viewFeatureHtml, viewFeatureLoading, viewHtml, viewRenderError, visibleResultsPage, workspaceTab } = workspace;
 const [featureLetter, setFeatureLetter] = useState("");
 const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
 const [selectAllPending, setSelectAllPending] = useState(false);
 // The approval endpoint verifies the saved query identity; client bookmark ID
 // synchronization must not hide controls for an already saved query.
 const approvalReady = viewFeature === "policies" && viewFeatureHtml.includes('data-policy-action="toggle"');
 const policyVisible = workspaceTab === "view" && workspace.viewPanel === "features" && viewFeature === "policies";
 const policyBookmarkNeeded = policyVisible && !approvalReady && viewFeatureCount > 0 && !viewFeatureLoading;
 useEffect(() => {
   window.dispatchEvent(new CustomEvent("maestro:policy-bookmark-attention", { detail: { active: policyBookmarkNeeded } }));
   return () => { window.dispatchEvent(new CustomEvent("maestro:policy-bookmark-attention", { detail: { active: false } })); };
 }, [policyBookmarkNeeded]);
 const personalKind = personalPerspectiveFromUri(selectedViewUri);
 const mapProvider = useMapProviderDefinition(workspace.viewPanel === "perspectives", workspace.queryXml);
 const providerSelected = Boolean(mapProvider && selectedViewUri === mapProvider.uri && workspace.viewPanel === "perspectives");
 // Include the actual Personal facet values, not just geocoded marker values.
 // Some values in a facet have no corresponding mapped resource and must still
 // receive an item decoration when that facet is selected for Color By.
 const visibleFacetTerms = useMemo(() => ({
   ...Object.fromEntries(workspace.personalWidgets.map(widget => [
     `forward|${widget.uri}`, widget.values.map(facetValueKey),
   ])),
   "class|http://www.w3.org/1999/02/22-rdf-syntax-ns#type": workspace.classFacets.map(facet => fctTermKey(facet.uri, "uri")),
 }), [workspace.personalWidgets, workspace.classFacets]);
 useEffect(() => { setFeatureLetter(""); setSelectedFeatures([]); }, [viewFeature]);
 const featureCards = useMemo(() => {
   if (!viewFeature || viewFeatureLoading || !viewFeatureHtml || typeof DOMParser === "undefined") return [] as { letter: string; uri: string; approved: boolean }[];
   const doc = new DOMParser().parseFromString(viewFeatureHtml, "text/html");
   return Array.from(doc.querySelectorAll("article")).map((card) => {
     const label = card.querySelector("h3, strong")?.textContent?.trim() ?? "";
     return { letter: /^[a-z]/i.test(label) ? label[0].toUpperCase() : "#", uri: card.getAttribute("data-feature-uri") ?? "", approved: Boolean(card.querySelector('input[data-policy-action="toggle"]:checked')) };
   });
 }, [viewFeature, viewFeatureHtml, viewFeatureLoading]);
 const featureLetters = useMemo(() => {
   const counts: Record<string, number> = {};
   for (const card of featureCards) counts[card.letter] = (counts[card.letter] ?? 0) + 1;
   return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
 }, [featureCards]);
 const visibleFeatureCards = featureCards.filter((card) => matchesAlphabetSelection(featureLetter, card.letter));
 const visibleFeatureCount = viewFeature ? visibleFeatureCards.length : viewFeatureCount;
 const selectedVisibleCount = viewFeature === "policies" ? visibleFeatureCards.filter(card => card.approved).length : visibleFeatureCards.filter(card => selectedFeatures.includes(card.uri)).length;
 async function selectAllFeatures() {
   if (!viewFeature || selectAllPending || !visibleFeatureCards.length) return;
   if (viewFeature !== "policies") {
     const uris = [...new Set(visibleFeatureCards.map(card => card.uri).filter(Boolean))];
     setSelectedFeatures(current => [...new Set([...current, ...uris])]);
     return;
   }
   if (!approvalReady) {
     window.dispatchEvent(new Event("maestro:bookmark-query-request"));
     return;
   }
   const pending = [...new Set(visibleFeatureCards.filter(card => !card.approved).map(card => card.uri).filter(Boolean))];
   if (!pending.length) return;
   setSelectAllPending(true);
   try {
     const response = await fetch("/proxy/api/policy-approvals", {
       method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ action: "approve-all", queryXml: workspace.queryXml, policies: pending }),
     });
     const data = await response.json() as { error?: string; bookmarkRequired?: boolean };
     if (!response.ok) {
       if (data.bookmarkRequired) window.dispatchEvent(new Event("maestro:bookmark-query-request"));
       throw new Error(data.error ?? `Policy approval update returned ${response.status}.`);
     }
     workspace.setPolicyApprovalRevision(current => current + 1);
   } catch (error) {
     toast.add({ title: "Select All failed", description: error instanceof Error ? error.message : "Unable to approve policies.", type: "error" });
   } finally { setSelectAllPending(false); }
 }
 const visibleFeatureHtml = viewFeature && featureLetter && typeof DOMParser !== "undefined"
   ? (() => { const doc = new DOMParser().parseFromString(viewFeatureHtml, "text/html");
     for (const article of Array.from(doc.querySelectorAll("article"))) {
       const label = article.querySelector("h3, strong")?.textContent?.trim() ?? "";
       const letter = /^[a-z]/i.test(label) ? label[0].toUpperCase() : "#";
       if (!matchesAlphabetSelection(featureLetter, letter)) article.remove();
     }
     if (viewFeature !== "policies") {
     for (const card of Array.from(doc.querySelectorAll('article[data-feature-uri]'))) {
       const checkbox = card.querySelector('input[data-feature-select]');
       if (checkbox && selectedFeatures.includes(card.getAttribute('data-feature-uri') ?? '')) checkbox.setAttribute('checked', 'checked');
     }
   }
   return doc.body.innerHTML; })()
   : viewFeature === "policies" ? viewFeatureHtml : (() => {
     if (typeof DOMParser === "undefined") return viewFeatureHtml;
     const doc = new DOMParser().parseFromString(viewFeatureHtml, "text/html");
     for (const card of Array.from(doc.querySelectorAll('article[data-feature-uri]'))) {
       const checkbox = card.querySelector('input[data-feature-select]');
       if (checkbox && selectedFeatures.includes(card.getAttribute('data-feature-uri') ?? '')) checkbox.setAttribute('checked', 'checked');
     }
     return doc.body.innerHTML;
   })();
 return <>
{workspaceTab === "view" && <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Views">
                {providerSelected && mapProvider ? <PerspectiveProviderRuntime provider={mapProvider} queryXml={workspace.queryXml} queryTree={workspace.queryTree} addr={workspace.queryTree.attributes.addr ?? ""} visibleFacetTerms={visibleFacetTerms} /> : personalKind && workspace.viewPanel === "perspectives" ? <PersonalPerspectives active={true} kind={personalKind} providerUri={selectedViewUri} queryXml={workspace.queryXml} /> : <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3">
                  {viewFeature ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="group" aria-label={`Alphabet for ${viewFeature}`}>
                    {featureLetters.map(([letter, count]) => <button key={letter} type="button" aria-label={`${letter}: ${count} ${viewFeature}; Shift-click excludes the letter`}
                      aria-pressed={parseAlphabetSelections(featureLetter).some((value) => value === letter || value === `!${letter}`)}
                      onClick={(event) => setFeatureLetter((current) => toggleAlphabetSelection(current, letter, event.shiftKey))}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${parseAlphabetSelections(featureLetter).some((value) => value === letter || value === `!${letter}`) ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                      <span>{parseAlphabetSelections(featureLetter).includes(`!${letter}`) ? <><span className="inline-flex items-center gap-1.5"><Ban aria-label="Excluded" className="size-3.5 shrink-0" />{letter}</span></> : letter}</span><Separator orientation="vertical" className="mx-1 h-4"/><span>{count}</span>
                    </button>)}
                  </div> : null}
                  {!viewFeature && (alphabetPreflight === "available" || Boolean(alphabetIndex) || isLoadingAlphabet) && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="group" aria-label="Alphabetical filter for View results">                    {!isLoadingAlphabet && <IncompleteWidgetIndicator source="alphabet" />}
                    {(alphabetPreflight === "available" || Boolean(alphabetIndex)) ? <>
                      {Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").filter((letter) => (alphabetCounts[letter] ?? 0) > 0 || parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`)).map((letter) => (
                        <button key={letter} type="button" title={`Letter ${letter}; Shift-click excludes it; multiple selections are OR`} aria-label={`Letter ${letter}: ${alphabetCounts[letter] ?? 0} results`} aria-pressed={parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`)}
                          disabled={isLoadingAlphabet || (!alphabetCounts[letter] && !parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`))}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`) ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "border-border hover:bg-accent hover:text-accent-foreground"}`}
                          onClick={(event) => {
                            setNodeAttribute("query-view", "indexLabels", alphabetLabelUris);
                            setNodeAttribute("query-view", "indexLang", preferredAlphabetLanguage);
                            setNodeAttribute("query-view", "index", toggleAlphabetSelection(alphabetIndex, letter, event.shiftKey) || null);
                            setResultsUiPage(0); setResults([]); setResultsPage(resultsBatchSize, 0);
                          }}>
                          <span className="font-medium">{parseAlphabetSelections(alphabetIndex).includes(`!${letter}`) ? <><span className="inline-flex items-center gap-1.5"><Ban aria-label="Excluded" className="size-3.5 shrink-0" />{letter}</span></> : letter}</span>
                          <Separator orientation="vertical" className="mx-1 h-4 bg-current opacity-30 data-vertical:self-center" />
                          <span className={`tabular-nums font-normal ${parseAlphabetSelections(alphabetIndex).some((value) => value === letter || value === `!${letter}`) ? "text-primary-foreground/65" : "text-muted-foreground"}`}>{shortenCount(alphabetCounts[letter] ?? 0)}</span>
                        </button>
                      ))}
                    </> : null}
                    {isLoadingAlphabet && <span className="text-xs text-muted-foreground"><ElapsedStatus label="Fetching alphabet" category="alphabet" clockScope="alphabet" requestWaves={26} /></span>}
                    
                  </div>}
                  {!viewFeature && discoveredViews.length > 1 && <select aria-label="Select view" className="rounded border bg-background px-2 py-1 text-sm" value={selectedViewUri} onChange={(event) => setSelectedViewUri(event.currentTarget.value)}>
                    {discoveredViews.map((view) => <option key={view.uri} value={view.uri}>{view.label}</option>)}
                  </select>}
                  {!viewFeature && selectedView && <span className="text-xs text-muted-foreground">{selectedView.label} · {visibleResultsPage.length} results on this page</span>}
                </div>
                {viewFeature && <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs" role="toolbar" aria-label={`${viewFeature} actions`}>
                  <button type="button" disabled={viewFeatureLoading || selectAllPending || !visibleFeatureCards.length || (selectedVisibleCount === visibleFeatureCount && (viewFeature !== "policies" || approvalReady))}
                    className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void selectAllFeatures()}>
                    {selectAllPending ? "Selecting…" : "Select All"}
                  </button>
                  <span className="text-muted-foreground">{selectedVisibleCount} / {visibleFeatureCount} selected</span>
                </div>}
                <ViewPage queryXml={workspace.queryXml} requiresBookmark={policyBookmarkNeeded} viewFeature={viewFeature} viewFeatureLoading={viewFeatureLoading} viewFeatureError={viewFeatureError} viewFeatureCount={visibleFeatureCount} viewFeatureHtml={visibleFeatureHtml} viewDiscoveryLoading={viewDiscoveryLoading} viewDiscoveryError={viewDiscoveryError} selectedView={selectedView} viewRenderError={viewRenderError} viewHtml={viewHtml} onSelectEndpoint={(id) => { const endpoint = fctEndpoints.find((item) => item.id === id); if (endpoint && endpoint.id !== selectedEndpointId) void chooseFctEndpoint(endpoint.id); }} onRefreshEndpoint={(id) => { const endpoint = fctEndpoints.find((item) => item.id === id); if (!endpoint || checkingEndpointIds[id]) return; void checkSelectedGraphServer(endpoint).catch((error) => { toast.add({ title: "Could not refresh graph server health", description: error instanceof Error ? error.message : "Health check failed.", type: "error" }); }); }} onOpenResource={workspace.openRecordPropertyUri} onSelectFeature={(uri, checked) => setSelectedFeatures(current => checked ? [...new Set([...current, uri])] : current.filter(item => item !== uri))} onPolicyAction={(uri, action, checked) => {
                    if (action === "bookmark" || !approvalReady) {
                      window.dispatchEvent(new Event("maestro:bookmark-query-request"));
                      return;
                    }
                    const statusAction = action === "forget" ? "forget" : checked ? "approve" : "pending";
                    void fetch("/proxy/api/policy-approvals", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: statusAction, queryXml: workspace.queryXml, policy: uri }),
                    }).then(async response => {
                      const data = await response.json() as { error?: string; bookmarkRequired?: boolean };
                      if (!response.ok) {
                        if (data.bookmarkRequired) window.dispatchEvent(new Event("maestro:bookmark-query-request"));
                        throw new Error(data.error ?? `Policy approval update returned ${response.status}.`);
                      }
                      workspace.setPolicyApprovalRevision(current => current + 1);
                      if (statusAction === "forget") workspace.refreshQuery();
                    }).catch(error => toast.add({ title: "Policy approval failed", description: error instanceof Error ? error.message : "The change could not be saved.", type: "error" }));
                  }} />
                {(viewFeature || selectedView) && <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2 text-xs">
                  <span className="text-muted-foreground">{formatPagePosition(resultsUiPage, effectiveResultsTotalCount === null ? (resultsPageComplete ? Math.max(1, Math.ceil(results.length / resultsPageSize)) : null) : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize)))}</span>
                  <div className="flex items-center gap-2"><label htmlFor="view-page-size">Per page</label>
                    <select id="view-page-size" className="rounded border bg-background px-2 py-1" value={effectivePageSize} onChange={(event) => { const n=Number(event.currentTarget.value); setResultsPageSize(n); maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY,String(n)); setResultsUiPage(0); }}>
                      {resultsPageSizeOptions.map((n) => <option value={n} key={n}>{n}</option>)}
                    </select>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={resultsUiPage===0 || isSearching} onClick={() => changeResultsPage(-1)}>Previous</button>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={isSearching || (effectiveResultsTotalCount === null ? (results.length <= (resultsUiPage+1)*resultsPageSize && (resultsPageComplete || resultsBatchRequestPending.current)) : resultsUiPage+1 >= Math.ceil(effectiveResultsTotalCount/resultsPageSize))} onClick={() => changeResultsPage(1)}>Next</button>
                  </div>
                </div>}
              </>}
              </div>}
</>;
}
