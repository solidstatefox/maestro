"use client";
import { createBreadcrumbRenderers } from "@/canvas/top/breadcrumb-renderers";

import { QueryInspectorButton } from "@/canvas/utils/query-inspector";
import { groupValueKey, groupValueBinding } from "@/canvas/utils/fct-response";

import { findQueryNode, RDF_TYPE_URI } from "@/canvas/utils/query-controller";

import { MaestroChatPane } from "@/canvas/center/chat";

import { BrowseResults } from "@/canvas/tab/browse/results-view";

import { Fragment } from "react";

import { toLabel } from "@/lib/uri-labels";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { shortenCount } from "@/lib/utils";

import { serializeFctQuery, createGroupMemberQuery } from "@/lib/fct-query-api";

import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

/** BrowseResultsCanvas: Browse-only content, using the shared query and result state. */
export function BrowseResultsCanvas({ workspace }: { workspace: WorkspaceController }) {
 const { activeQueryIdentityRef, centralTab, endpointReadyForQuery, expandedUris, facetHoverPreview, initialBrowseTriggered, isRootView, isSearching, liveQueryHasText, navigateResultBadge, results, resultsLoadedQueryIdentityRef, search, searchError, selectedUri, setExpandedUris, setSelectedUri, showResultBadges, tutorialMode, urlStateInitialized, visibleResultsPage, workspaceTab } = workspace;
 const { recordStates } = workspace;
 const stateFilteredResults = visibleResultsPage; // Server applies state filters before LIMIT/OFFSET.
 const { renderScopeValueBadge } = createBreadcrumbRenderers(workspace);
 return <>
{workspaceTab === "browse" && centralTab === "results" && (
                <div
                  id="central-panel-results"
                  role="tabpanel"
                  aria-labelledby="central-tab-results"
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                >

              <BrowseResults results={stateFilteredResults} selectedUri={selectedUri} expandedUris={expandedUris} setExpandedUris={setExpandedUris} showResultBadges={showResultBadges} isRootView={isRootView} liveQueryHasText={liveQueryHasText} search={search} searchError={searchError} isLoading={isSearching || !urlStateInitialized || !endpointReadyForQuery || !initialBrowseTriggered || resultsLoadedQueryIdentityRef.current !== activeQueryIdentityRef.current} facetHoverPreview={facetHoverPreview} tutorialMode={tutorialMode} onSelectResult={setSelectedUri} onNavigateClass={(iri) => navigateResultBadge(RDF_TYPE_URI, { value: iri, type: "uri" }, "forward", true)} renderBadge={(scope, term, index) => renderScopeValueBadge(scope, term, index)} />
                </div>
              )}
</>;
}

/** BrowseChatCanvas: Browse-only content, using the shared query and result state. */
export function BrowseChatCanvas({ workspace }: { workspace: WorkspaceController }) {
 const { assistantPendingPrompt, assistantPromptDraft, authSession, centralTab, setAssistantPendingPrompt, setAssistantPromptDraft, setCentralTab, workspaceTab } = workspace;
 return <>
{workspaceTab === "browse" && centralTab === "chat" && (
                <MaestroChatPane
                  authSession={authSession}
                  assistantPromptDraft={assistantPromptDraft}
                  assistantPendingPrompt={assistantPendingPrompt}
                  onShowResults={() => { setAssistantPromptDraft(""); setCentralTab("results"); }}
                  onPendingPromptConsumed={(id) => setAssistantPendingPrompt((current) => current?.id === id ? null : current)}
                />
              )}
</>;
}

/** BrowseGroupsCanvas: Browse-only content, using the shared query and result state. */
export function BrowseGroupsCanvas({ workspace }: { workspace: WorkspaceController }) {
 const { activeLeafId, centralTab, groupByOptions, groupCardRefs, groupMembers, groupValues, groupValuesError, groupValuesLoading, queryTree, results, selectedGroupByOption, selectedUri, setPropertyValue, setRoleValue, setSelectedUri, visibleGroupValues, workspaceTab } = workspace;
 return <>
{workspaceTab === "browse" && centralTab === "groups" && selectedGroupByOption && (
                <div id="central-panel-groups" role="tabpanel" aria-labelledby="central-tab-groups" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {groupByOptions.length > 0 ? (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      {groupValuesLoading ? <p className="shrink-0 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading group values from Virtuoso FCT…</p> : null}
                      {groupValuesError ? <p className="shrink-0 rounded-md border border-destructive/40 p-3 text-sm text-destructive">{groupValuesError}</p> : null}
                      {!groupValuesLoading && !groupValuesError && groupValues.length === 0 ? <p className="shrink-0 rounded-md border border-dashed p-4 text-sm text-muted-foreground">No values found for this relationship in the current scope.</p> : null}
                      <div className="min-w-0 flex-1 overflow-y-auto p-3">
                        <div className="flex flex-col gap-3">
                        {visibleGroupValues.map((groupValue) => {
                          const groupValueLabel = groupValue.termType === "uri" ? toLabel(groupValue.uri, "OBJECT") : groupValue.title || groupValue.uri;
                          const memberKey = `${selectedGroupByOption!.key}::${groupValueKey(groupValue)}`;
                          // A missing member state is not evidence of an active request.
                          // In particular, an aborted request must not leave this card spinning forever.
                          const members = groupMembers[memberKey] ?? { results: [], loading: false, error: "Group members have not been loaded." };
                          const selectedRelationshipNode = findQueryNode(queryTree.children, selectedGroupByOption!.nodeId);
                          const expectedBinding = groupValueBinding(groupValue);
                          const bound = (selectedRelationshipNode?.children ?? []).some((child) => child.name === "value" && child.text === expectedBinding.text && (child.attributes.datatype ?? "uri") === expectedBinding.datatype && (child.attributes["xml:lang"] ?? "") === (expectedBinding.lang ?? ""));
                          return <article key={memberKey} ref={(element) => { if (element) groupCardRefs.current.set(memberKey, element); else groupCardRefs.current.delete(memberKey); }} data-group-card="true" className="flex min-w-0 flex-col rounded-md border border-border">
                            <header className="group/header flex items-start gap-2 border-b border-border bg-muted px-3 py-2">
                              <input type="checkbox" checked={bound} onChange={(event) => {
                                if (selectedGroupByOption!.direction === "forward") setPropertyValue(activeLeafId, selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                                else setRoleValue(selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                              }} aria-label={`Filter ${selectedGroupByOption!.label} by ${groupValueLabel}`} className="mt-0.5 size-4 shrink-0 accent-current" />
                              <div className="min-w-0 flex-1">
                                <Tooltip><TooltipTrigger render={<button type="button" onClick={() => setSelectedUri(groupValue.uri)} className="block max-w-full cursor-pointer break-words text-left text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{groupValueLabel}</button>} /><TooltipContent>{"Load this group value in the Record viewer"}</TooltipContent></Tooltip>
                                <p className="mt-0.5 break-all text-xs text-muted-foreground">{groupValue.uri}</p>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">{shortenCount(Number(groupValue.columns?.[1]?.value ?? 0))} in group</span>
                              <QueryInspectorButton query={serializeFctQuery(createGroupMemberQuery(queryTree, selectedGroupByOption!, groupValue))} filename={`group-${groupValueLabel.replace(/[^a-z0-9_-]+/gi, "-")}.xml`} />
                            </header>
                            <div className="flex flex-col gap-1 p-2">
                              {members.error ? <p className="px-2 py-2 text-xs text-destructive">{members.error}</p> : members.loading ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading matching Results items…</p> : members.results.length > 0 ? members.results.map((item) => <button key={item.uri} type="button" onClick={() => setSelectedUri(item.uri)} className={`flex min-w-0 flex-col rounded-md px-2 py-2 text-left hover:bg-accent/50 ${selectedUri === item.uri ? "bg-accent/40" : ""}`}><span className="break-words text-sm font-medium cursor-pointer">{item.termType === "uri" ? toLabel(item.uri, "Class") : item.title || item.uri}</span><span className="mt-0.5 break-all text-xs text-muted-foreground">{item.uri}</span></button>) : <p className="px-2 py-2 text-xs text-muted-foreground">No Results items match this value.</p>}
                            </div>
                          </article>;
                        })}
                        </div>
                      </div>
                    </div>
                  ) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Select a property or role in Focus, then choose it from Group by.</p>}
                </div>
              )}
</>;
}

/** BrowseQueryTreeCanvas: Browse-only content, using the shared query and result state. */
export function BrowseQueryTreeCanvas({ workspace }: { workspace: WorkspaceController }) {
 const { queryTree, queryTreeHeightPercent, queryTreeOpen, renderQueryNode, search, searchNode, uriNode, workspaceTab } = workspace;
 return <>
{workspaceTab === "browse" && <div
                id="central-panel-query-tree"
                role="region"
                aria-label="Query Tree"
                aria-hidden={!queryTreeOpen}
                style={{ height: queryTreeOpen ? `${queryTreeHeightPercent}%` : "0%" }}
                className={`shrink-0 overflow-hidden bg-background ${queryTreeOpen ? "visible border-t" : "invisible"}`}
              >
                <div className="h-full overflow-auto p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Live query structure. Changes in Filters, Focus, navigation, and bindings appear here immediately.
                    </p>
                  </div>
                  <ul className="space-y-1">
                    {!search.trim() && !searchNode && !uriNode?.text?.trim() && renderQueryNode({
                      id: "query-everything",
                      name: "everything",
                      attributes: {},
                      children: [],
                    })}
                    {/* <text> and <value> always lead the tree; the sort is stable, so the rest keep query order. */}
                    {queryTree.children
                      .filter((node) => node.name !== "class")
                      .sort((left, right) => Number(right.name === "text" || right.name === "value") - Number(left.name === "text" || left.name === "value"))
                      .map((node) => <Fragment key={node.id}>{renderQueryNode(node)}</Fragment>)}
                  </ul>
                </div>
              </div>}
</>;
}
