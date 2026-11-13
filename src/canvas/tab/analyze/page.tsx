"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { createBreadcrumbRenderers } from "@/canvas/top/breadcrumb-renderers";
import { RESULTS_PAGE_SIZE_STORAGE_KEY } from "@/canvas/sheet/settings";

import { AnalyzeHistogram } from "@/canvas/tab/analyze/analysis-utils";
import { BookmarkCharts, isBookmarkAnalysis } from "@/canvas/tab/analyze/bookmark-charts";

import { toLabel } from "@/lib/uri-labels";

import { MaestroAnalysisDataTable, type MaestroDataColumn, type MaestroDataRow } from "@/components/maestro-analysis-data-table";

import { Check, Download } from "lucide-react";
import { formatPagePosition } from "@/canvas/utils/pagination";
import { shortenCount } from "@/lib/utils";

import { maestroStorageSet } from "@/lib/maestro-storage";

import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

export function AnalyzeTabCanvas({ workspace }: { workspace: WorkspaceController }) {
 const { activeBreadcrumbIndex, analysisColumnWidths, analysisError, analysisLoading, analysisRowKeys, analysisSelectedKeys, analysisSelectionPageKey, analysisTable, analysisValuesError, analyzeBreadcrumbTrail, analyzeHistogram, analyzeTableHeaderNodes, availableCompareFacets, changeResultsPage, effectiveCompareFacet, effectivePageSize, effectiveResultsTotalCount, histogramColumns, isCompareAnalysis, isSearching, readyAnalysisValues, results, resultsBatchRequestPending, resultsPageComplete, resultsPageSize, resultsPageSizeOptions, resultsUiPage, selectedAnalysisUri, setAnalysisSelection, setCentralTab, setCompareFacet, setResultsPageSize, setResultsUiPage, setSelectedUri, setWorkspaceTab, toggleAnalysisRow, visibleResultsPage, workspaceTab } = workspace;
 const { renderScopeValueBadge, renderRootBreadcrumb, renderPathBreadcrumb } = createBreadcrumbRenderers(workspace);
 return <>
{workspaceTab === "analyze" && <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Analyze canvas">
                {(
                  <nav aria-label="Analyze breadcrumbs" className="flex shrink-0 flex-wrap items-start justify-start gap-2 border-b bg-background px-4 py-2">
                    {renderRootBreadcrumb(false, analysisTable?.trailStyle, false)}
                    {analyzeBreadcrumbTrail.map((crumb, index) => renderPathBreadcrumb(crumb, index, false, analysisTable?.trailStyle, false))}
                  </nav>
                )}
                {selectedAnalysisUri.includes("compare-table") && <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
                  <label htmlFor="maestro-compare-facet">Compare facet</label>
                  <select id="maestro-compare-facet" value={effectiveCompareFacet} onChange={(event) => setCompareFacet(event.target.value)} className="min-w-0 max-w-md flex-1 rounded-md border bg-background px-2 py-1">
                    {availableCompareFacets.map((facet) => <option key={facet.key} value={facet.key}>{facet.label}</option>)}
                  </select>
                </div>}
                {<div role="toolbar" aria-label="Analyze table actions" className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-1 text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground disabled:cursor-not-allowed" title="Export (coming soon)" aria-label="Export" disabled><Download aria-hidden="true" className="size-4"/>Export</button>
                </div>}
                {analysisError && !isBookmarkAnalysis(selectedAnalysisUri) && <ErrorDetails prefix="Analysis" error={analysisError} className="m-3" />}
                {analysisValuesError && <ErrorDetails prefix="Analysis facet values" error={analysisValuesError} className="m-3" />}
                {analysisLoading && !analysisTable && !isBookmarkAnalysis(selectedAnalysisUri) && <p className="p-3 text-xs text-muted-foreground"><ElapsedStatus label="Building analysis" category="other" clockScope="analysis" /></p>}
                <div className="min-h-0 flex-1 overflow-auto">
                  {isBookmarkAnalysis(selectedAnalysisUri) && <BookmarkCharts queryXml={workspace.queryXml} providerUri={selectedAnalysisUri} />}
                  {analysisTable && isCompareAnalysis && analyzeHistogram && <AnalyzeHistogram histogramColumns={histogramColumns} visibleCount={analysisTable.rows.length} />}
                  {analysisTable && !(isCompareAnalysis && analyzeHistogram) && <MaestroAnalysisDataTable
                    label={isCompareAnalysis ? "Compare Table" : "Table"}
                    tableStyle={analysisTable.tableStyle} headerStyle={analysisTable.headerStyle} cellStyle={analysisTable.cellStyle}
                    selectedKeys={analysisSelectedKeys}
                    onToggle={toggleAnalysisRow}
                    onToggleAll={(checked) => setAnalysisSelection({ pageKey: analysisSelectionPageKey, keys: checked ? analysisRowKeys : [] })}
                    columns={analysisTable.columns.map((col, i): MaestroDataColumn => ({
                      id: col.nodeId || `${col.kind}:${col.label}:${i}`,
                      label: col.label,
                      width: analysisColumnWidths[col.nodeId || `${col.kind}:${col.label}`] ?? (i === 0 ? 240 : 190),
                      headerStyle: col.headerStyle,
                      heading: col.kind === "result" && !isCompareAnalysis ? "Results" : col.kind === "breadcrumb" ? (() => {
                        const header = analyzeTableHeaderNodes.find((crumb) => crumb.id === col.nodeId);
                        return header ? renderPathBreadcrumb(header, activeBreadcrumbIndex + 1, true, col.breadcrumbStyle) : col.label;
                      })() : col.kind === "value" && /^[a-z][a-z0-9+.-]*:/i.test(col.label) ? toLabel(col.label, "OBJECT") : col.label,
                    }))}
                    rows={analysisTable.rows.map((row, rowIndex): MaestroDataRow => ({
                      key: analysisRowKeys[rowIndex] ?? `${rowIndex}:${row.uri}`,
                      sortValues: [row.label, ...row.cells.map((cell) => cell.values.join(" "))],
                      rowStyle: analysisTable.rowStyle,
                      cells: [<button key="result" type="button" className="max-w-full break-words text-left text-primary hover:underline" onClick={() => { setSelectedUri(row.uri); setWorkspaceTab("browse"); setCentralTab("results"); }}>{row.label}</button>,
                        ...row.cells.map((cell, index) => {
                          if (isCompareAnalysis) return cell.checked ? <Check key={index} className="size-4 text-emerald-600" aria-label="Present"/> : null;
                          const column = analysisTable.columns[index + 1];
                          const header = analyzeTableHeaderNodes.find((crumb) => crumb.id === column?.nodeId);
                          if (!header) return <span key={index} className="text-muted-foreground">—</span>;
                          const direction = header.name === "property-of" ? "reverse" : "forward";
                          const currentResult = visibleResultsPage.find((item) => item.uri === row.uri);
                          const scopes = [...(currentResult?.scopeValues ?? []), ...(readyAnalysisValues?.get(row.uri) ?? [])];
                          const scope = [...scopes].reverse().find((value) => value.property === header.uri && value.direction === direction);
                          const values = scope?.values.filter((value) => value.value && value.value !== "-") ?? [];
                          return values.length && scope ? <div key={index} className="flex flex-wrap gap-0.5">{values.map((value, j) => renderScopeValueBadge(scope, value, j, {valueOnly: true, style: cell.badgeStyle}))}</div>
                            : <span key={index} className="text-muted-foreground">—</span>;
                        })],
                    }))}
                  />}
                  {!isBookmarkAnalysis(selectedAnalysisUri) && !analysisLoading && !analysisTable && !analysisError && <p className="p-3 text-sm text-muted-foreground">Choose an analysis from the ribbon.</p>}
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background px-3 py-2 text-xs">
                  <span className="text-muted-foreground">{formatPagePosition(resultsUiPage, effectiveResultsTotalCount === null ? null : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize)))}{effectiveResultsTotalCount !== null ? ` · ${shortenCount(effectiveResultsTotalCount)} results` : " · many results"}</span>
                  <div className="flex items-center gap-2"><label htmlFor="analyze-page-size">Per page</label>
                    <select id="analyze-page-size" value={effectivePageSize} onChange={(event) => { const n = Number(event.target.value); maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY, String(n)); setResultsPageSize(n);setResultsUiPage(0);}} className="rounded border bg-background px-2 py-1">
                      {resultsPageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={resultsUiPage===0 || isSearching} onClick={() => changeResultsPage(-1)}>Previous</button>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={isSearching || (effectiveResultsTotalCount === null ? (results.length <= (resultsUiPage+1)*resultsPageSize && (resultsPageComplete || resultsBatchRequestPending.current)) : resultsUiPage+1 >= Math.ceil(effectiveResultsTotalCount/resultsPageSize))} onClick={() => changeResultsPage(1)}>Next</button>
                  </div>
                </div>
              </div>}
</>;
}
