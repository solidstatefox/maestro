"use client";
import { RESULTS_PAGE_SIZE_STORAGE_KEY } from "@/canvas/sheet/settings";
import { IncompleteWidgetIndicator } from "@/canvas/utils/incomplete-widget";

import { ViewPage } from "@/canvas/tab/view/view-components";

import { Separator } from "@/components/ui/separator";

import { toast } from "@/components/ui/toast";

import { shortenCount } from "@/lib/utils";
import { formatPagePosition } from "@/canvas/utils/pagination";

import { maestroStorageSet } from "@/lib/maestro-storage";

import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

export function ViewTabCanvas({ workspace }: { workspace: WorkspaceController }) {
 const { alphabetCounts, alphabetError, alphabetIndex, alphabetLabelUris, alphabetPreflight, changeResultsPage, checkSelectedGraphServer, checkingEndpointIds, chooseFctEndpoint, discoveredViews, effectivePageSize, effectiveResultsTotalCount, fctEndpoints, isLoadingAlphabet, isSearching, preferredAlphabetLanguage, results, resultsBatchRequestPending, resultsBatchSize, resultsPageComplete, resultsPageSize, resultsPageSizeOptions, resultsUiPage, selectedEndpointId, selectedView, selectedViewUri, setNodeAttribute, setResults, setResultsPage, setResultsPageSize, setResultsUiPage, setSelectedViewUri, viewDiscoveryError, viewDiscoveryLoading, viewFeature, viewFeatureCount, viewFeatureError, viewFeatureHtml, viewFeatureLoading, viewHtml, viewRenderError, visibleResultsPage, workspaceTab } = workspace;
 return <>
{workspaceTab === "view" && <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Views">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="group" aria-label="Alphabetical filter for View results">
                    <IncompleteWidgetIndicator source="alphabet" />
                    {(alphabetPreflight === "available" || Boolean(alphabetIndex)) ? <>
                      {Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").filter((letter) => (alphabetCounts[letter] ?? 0) > 0 || alphabetIndex === letter).map((letter) => (
                        <button key={letter} type="button" title={`Letter ${letter}`} aria-label={`Letter ${letter}: ${alphabetCounts[letter] ?? 0} results`} aria-pressed={alphabetIndex === letter}
                          disabled={alphabetIndex !== letter && (isLoadingAlphabet || !alphabetCounts[letter])}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${alphabetIndex === letter ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "border-border hover:bg-accent hover:text-accent-foreground"}`}
                          onClick={() => {
                            setNodeAttribute("query-view", "indexLabels", alphabetLabelUris);
                            setNodeAttribute("query-view", "indexLang", preferredAlphabetLanguage);
                            setNodeAttribute("query-view", "index", alphabetIndex === letter ? null : letter);
                            setResultsUiPage(0); setResults([]); setResultsPage(resultsBatchSize, 0);
                          }}>
                          <span className="font-medium">{letter}</span>
                          <Separator orientation="vertical" className="mx-1 h-4 bg-current opacity-30 data-vertical:self-center" />
                          <span className={`tabular-nums font-normal ${alphabetIndex === letter ? "text-primary-foreground/65" : "text-muted-foreground"}`}>{shortenCount(alphabetCounts[letter] ?? 0)}</span>
                        </button>
                      ))}
                    </> : null}
                    {isLoadingAlphabet && <span className="text-xs text-muted-foreground">Fetching letter filters...</span>}
                    {alphabetError && !Object.values(alphabetCounts).some((count) => count > 0) && <span className="text-xs text-destructive" title={alphabetError}>Alphabet unavailable</span>}
                  </div>
                  {!viewFeature && discoveredViews.length > 1 && <select aria-label="Select view" className="rounded border bg-background px-2 py-1 text-sm" value={selectedViewUri} onChange={(event) => setSelectedViewUri(event.currentTarget.value)}>
                    {discoveredViews.map((view) => <option key={view.uri} value={view.uri}>{view.label}</option>)}
                  </select>}
                  {!viewFeature && selectedView && <span className="text-xs text-muted-foreground">{selectedView.label} · {visibleResultsPage.length} results on this page</span>}
                </div>
                <ViewPage viewFeature={viewFeature} viewFeatureLoading={viewFeatureLoading} viewFeatureError={viewFeatureError} viewFeatureCount={viewFeatureCount} viewFeatureHtml={viewFeatureHtml} viewDiscoveryLoading={viewDiscoveryLoading} viewDiscoveryError={viewDiscoveryError} selectedView={selectedView} viewRenderError={viewRenderError} viewHtml={viewHtml} onSelectEndpoint={(id) => { const endpoint = fctEndpoints.find((item) => item.id === id); if (endpoint && endpoint.id !== selectedEndpointId) void chooseFctEndpoint(endpoint.id); }} onRefreshEndpoint={(id) => { const endpoint = fctEndpoints.find((item) => item.id === id); if (!endpoint || checkingEndpointIds[id]) return; void checkSelectedGraphServer(endpoint).catch((error) => { toast.add({ title: "Could not refresh graph server health", description: error instanceof Error ? error.message : "Health check failed.", type: "error" }); }); }} />
                {!viewFeature && selectedView && <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2 text-xs">
                  <span className="text-muted-foreground">{formatPagePosition(resultsUiPage, effectiveResultsTotalCount === null ? (resultsPageComplete ? Math.max(1, Math.ceil(results.length / resultsPageSize)) : null) : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize)))}</span>
                  <div className="flex items-center gap-2"><label htmlFor="view-page-size">Per page</label>
                    <select id="view-page-size" className="rounded border bg-background px-2 py-1" value={effectivePageSize} onChange={(event) => { const n=Number(event.currentTarget.value); setResultsPageSize(n); maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY,String(n)); setResultsUiPage(0); }}>
                      {resultsPageSizeOptions.map((n) => <option value={n} key={n}>{n}</option>)}
                    </select>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={resultsUiPage===0 || isSearching} onClick={() => changeResultsPage(-1)}>Previous</button>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={isSearching || (effectiveResultsTotalCount === null ? (results.length <= (resultsUiPage+1)*resultsPageSize && (resultsPageComplete || resultsBatchRequestPending.current)) : resultsUiPage+1 >= Math.ceil(effectiveResultsTotalCount/resultsPageSize))} onClick={() => changeResultsPage(1)}>Next</button>
                  </div>
                </div>}
              </div>}
</>;
}
