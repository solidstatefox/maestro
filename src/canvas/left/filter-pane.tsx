"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";

import { renderPersonalWidgetCards } from "@/canvas/left/personal-widget-cards";
import { PersonalStatesWidget } from "@/canvas/left/states-widget";
import { FACET_ITEM_GAP_CLASS } from "@/canvas/left/facet-layout";

import { IncompleteWidgetIndicator } from "@/canvas/utils/incomplete-widget";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";

import { personalFacetInspectorQueries, PersonalRoleWidget } from "@/canvas/left/filter";
import { RDF_TYPE_URI, GROUP_BY_FACET_HIGHLIGHT_CLASSES } from "@/canvas/utils/query-controller";

import { categoryTreeNodeKey, type CategoryTreeNode } from "@/canvas/left/filter";

import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";

import { toLabel } from "@/lib/uri-labels";

import { buildFctCountSparql } from "@/lib/fct-count-sparql";

import { useMemo, useState, type ReactNode } from "react";
import { GraphUriTree, buildGraphUriTree, graphTreeParentKeys } from "@/canvas/left/graph-uri-tree";
import { ButtonGroup } from "@/components/ui/button-group";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { Toggle } from "@/components/ui/toggle";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Bot, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleSlash, List, Network, Trash2, UsersRound, Search, X, ArrowDownAZ, ArrowDownZA, ClipboardList } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { formatPagePosition } from "@/canvas/utils/pagination";

import { ALL_GRAPHS } from "@/lib/graph-address-mode";

import { serializeFctQuery, createPersonalRoleValuesQuery, createDistinctCountQuery, setQueryViewAttributes } from "@/lib/fct-query-api";

import type { FilterPaneWorkspace } from "@/canvas/controllers/workspace-interfaces";

export function FilterWorkspaceContent({ workspace }: { workspace: FilterPaneWorkspace }) {
  const [graphTreeMode, setGraphTreeMode] = useState(false);
  const [expandedGraphNodes, setExpandedGraphNodes] = useState<Set<string>>(() => new Set());
  const {
    FACET_PAGE_SIZE,
    activeLeafId,
    activeRoleFilters,
    autoConfiguredFacetKeys,
    beginFacetHoverPreview,
    bindGraph,
    categoriesIncomplete,
    categoriesTreeMode,
    startCategoryNameSearch,
    categoriesWidgetRef,
    categoryPageCount,
    categoryTreeAllCollapsed,
    categoryTreePages,
    categoryTreeParentKeys,
    centralTab,
    classFacetError,
    classFacetWarning,
    classFacets,
    classesPage,
    clearGraph,
    clearTutorialPreview,
    defaultLeftTab,
    deleteNode,
    endpointReadyForQuery,
    expandedCategoryNodes,
    facetHoverPreview,
    focusWidgetsSuppressed,
    graphFacets,
    graphHasMore,
    graphListSparql,
    graphPageCount,
    graphSort,
    graphSortPickerExpanded,
    graphsPage,
    groupBatchSize,
    groupByOptions,
    groupByPropertyUri,
    workspaceTab,
    groupedRoleUri,
    handleFacetShiftClick,
    isFacetExcluded,
    isGroupByCategory,
    isLoadingClasses,
    isLoadingCategoryTree,
    isLoadingGraphs,
    leftPanelLimit,
    leftWidgetLimits,
    navigateToPropertyPath,
    pagedUnselectedClasses,
    personalRoleFacetNodes,
    queryRefreshRevision,
    queryTree,
    recordStates,
    queryWithoutPagingXml,
    roleWidgetCardRefs,
    roleWidgetStatuses,
    scrollToGroupForFacetValue,
    selectedClassDisplayFacets,
    selectedClasses,
    selectedGroupByOption,
    setCentralTab,
    setClassesPage,
    setExpandedCategoryNodes,
    setGraphSort,
    setGraphSortPickerExpanded,
    setGraphsPage,
    setGroupByPropertyUri,
    setQueryAttribute,
    setRoleWidgetStatuses,
    showClassResults,
    toggleClass,
    visibleClassDisplayFacets,
  } = workspace;
  // Sorting is presentation-only. Do not rerun the SPARQL query when a sort
  // control changes; the lightweight graph projection does not fetch counts.
  const sortedGraphFacets = useMemo(() => [...graphFacets].sort((a, b) => {
    const comparison = (a.label || a.uri).localeCompare(b.label || b.uri);
    return graphSort === "label-desc" ? -comparison : comparison;
  }), [graphFacets, graphSort]);
  const graphTreeNodes = useMemo(() => buildGraphUriTree(sortedGraphFacets), [sortedGraphFacets]);
  const graphParentKeys = useMemo(() => graphTreeParentKeys(graphTreeNodes), [graphTreeNodes]);
  const graphTreeAllCollapsed = graphParentKeys.length > 0 && graphParentKeys.every((key) => !expandedGraphNodes.has(key));
  const activeGraphPageCount = graphTreeMode ? Math.max(1, Math.ceil(graphTreeNodes.length / FACET_PAGE_SIZE)) : graphPageCount;
  return <>
{defaultLeftTab === "personal" && (
                  <div className="space-y-3">
                    {recordStates.enabled && recordStates.hasStates && <PersonalStatesWidget states={recordStates} />}
                    <article ref={categoriesWidgetRef} className={`flex min-w-0 flex-col ${isGroupByCategory ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : ""}`}>
                      <header className={`group/header flex items-start justify-between gap-2 border-b px-2 py-2 ${isGroupByCategory ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""}`}>
                        <div className="flex min-w-0 items-center gap-1">{isGroupByCategory && <UsersRound className="size-4 shrink-0" aria-label="Group by Category" />}<IncompleteWidgetIndicator source="categories" /><h2 className="text-sm font-semibold">Categories</h2><Tooltip><TooltipTrigger render={<button type="button" onClick={startCategoryNameSearch} aria-label="Search for categories by name" className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"><Search className="size-4" aria-hidden="true" /></button>} /><TooltipContent>Start a new search for resources by Category name</TooltipContent></Tooltip><QueryInspectorButton query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.CLASSES, false, false)}\n<!-- FCT API option: view=classes; tree relationships are loaded separately -->`} filename="categories-fct-query.xml" countQuery={visibleClassDisplayFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "class", visibleClassDisplayFacets[0].uri, undefined, undefined, FCT_VIEW_TYPES.CLASSES)) : undefined} countFilename="categories-first-item-count.sparql" /><Tooltip><TooltipTrigger render={<button
                          type="button"
                          aria-pressed={categoriesTreeMode}
                          onClick={() => { setQueryAttribute("classTree", categoriesTreeMode ? "false" : "true"); setExpandedCategoryNodes(new Set()); setClassesPage(0); }}
                          className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 ${categoriesTreeMode ? "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100" : ""}`}
                          aria-label={categoriesTreeMode ? "Show categories as a flat list" : "Show categories as a superclass tree"}
                        >{categoriesTreeMode ? <List className="size-4" aria-hidden="true" /> : <Network className="size-4" aria-hidden="true" />}</button>} /><TooltipContent>{categoriesTreeMode ? "Show flat category list" : "Show category tree (superclass path of each category, up to the root)"}</TooltipContent></Tooltip>{categoriesTreeMode && <Tooltip><TooltipTrigger render={<button
                          type="button"
                          disabled={categoryTreeParentKeys.length === 0}
                          onClick={() => setExpandedCategoryNodes(categoryTreeAllCollapsed ? new Set(categoryTreeParentKeys) : new Set())}
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover/header:disabled:opacity-40"
                          aria-label={categoryTreeAllCollapsed ? "Open all categories" : "Collapse all categories"}
                        >{categoryTreeAllCollapsed ? <ChevronsUpDown className="size-4" aria-hidden="true" /> : <ChevronsDownUp className="size-4" aria-hidden="true" />}</button>} /><TooltipContent>{categoryTreeAllCollapsed ? "Open all" : "Collapse all"}</TooltipContent></Tooltip>}<Tooltip><TooltipTrigger render={<button
                          type="button"
                          aria-pressed={isGroupByCategory}
                          onClick={() => {
                            if (isGroupByCategory) {
                              setGroupByPropertyUri("");
                              setCentralTab("results");
                            } else {
                              setGroupByPropertyUri(`forward:${RDF_TYPE_URI}`);
                              setCentralTab("groups");
                            }
                          }}
                          className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 ${isGroupByCategory ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}
                          aria-label={isGroupByCategory ? "Stop grouping by Category" : "Group results by Category"}
                        ><UsersRound className="size-4" aria-hidden="true" /></button>} /><TooltipContent>{isGroupByCategory ? "Stop grouping by Category" : "Group results by Category"}</TooltipContent></Tooltip></div>
                        <Tooltip><TooltipTrigger render={<span
                          className={`text-xs ${classFacetError ? "text-destructive" : "text-muted-foreground"}`}
                          aria-live="polite"
                        >
                          {isLoadingClasses || (categoriesTreeMode && isLoadingCategoryTree)
                            ? <span className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                                {isLoadingClasses ? <ElapsedStatus label="Fetching categories" category="categories" clockScope="categories" requestWaves={2} /> : null}
                                {categoriesTreeMode && isLoadingCategoryTree ? <ElapsedStatus label="Building tree" category="categories" clockScope="categoryTree" /> : null}
                              </span>
                            : classFacetError
                              ? "Update failed"
                              : shortenCount(visibleClassDisplayFacets.length)}
                        </span>} /><TooltipContent>{classFacetError || classFacetWarning || undefined}</TooltipContent></Tooltip>
                      </header>
                      {classFacetError && endpointReadyForQuery ? (
                        <p className="text-xs text-destructive">{classFacetError}</p>
                      ) : visibleClassDisplayFacets.length === 0 && !isLoadingClasses && !categoriesIncomplete ? (
                        <p className="text-xs text-muted-foreground">No classes found for this query.</p>
                      ) : (
                        <>
                          {selectedClassDisplayFacets.length > 0 && (
                            <div className="mx-2 mt-2 mb-2 rounded-md border border-border/70 bg-background/80 p-2">
                              <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">Selected</div>
                              <div className={FACET_ITEM_GAP_CLASS}>
                                {selectedClassDisplayFacets.map((item) => {
                                  const count = classFacets.some((facet) => facet.uri === item.uri) ? item.count : null;
                                  return (
                                    <div key={item.uri} className="flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-sm">
                                      <input
                                        type="checkbox"
                                        checked
                                        data-excluded={isFacetExcluded("Classes", item.uri) ? "true" : undefined}
                                        aria-invalid={count === 0 ? true : undefined}
                                        onClick={(event) => {
                                          if (event.shiftKey) {
                                            event.preventDefault();
                                            handleFacetShiftClick("Classes", item.uri, true);
                                          }
                                        }}
                                        onChange={(event) => toggleClass(item.uri, event.currentTarget.checked)}
                                        aria-label={`Unselect category ${toLabel(item.uri, "Class")}`}
                                        className={isFacetExcluded("Classes", item.uri)
                                          ? "relative size-4 shrink-0 appearance-none rounded-[3px] border border-black bg-white checked:border-black checked:bg-black checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-[14px] checked:after:font-bold checked:after:leading-none checked:after:text-white checked:after:content-['×'] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:!border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:!border-destructive/50 dark:aria-invalid:ring-destructive/40"
                                          : "size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"}
                                      />
                                      <Tooltip><TooltipTrigger render={<button
                                        type="button"
                                        className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${count === 0 ? "text-destructive" : ""}`}
                                        onClick={() => isGroupByCategory ? scrollToGroupForFacetValue({ uri: item.uri, title: toLabel(item.uri, "Class"), matches: [], termType: "uri" }) : showClassResults(item.uri, activeLeafId)}
                                      >
                                        {isFacetExcluded("Classes", item.uri) && <CircleSlash className="mr-1 inline size-3.5" aria-label="Excluded" />}
                                        {toLabel(item.uri, "Class")}
                                      </button>} /><TooltipContent>{item.uri}</TooltipContent></Tooltip>
                                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count === null ? "—" : shortenCount(count)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {categoryPageCount > 1 && (
                            <div className="mt-2 mb-2 flex items-center justify-between gap-2 text-xs">
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.max(0, page - 1))}
                                disabled={classesPage === 0}
                              >
                                Previous
                              </button>
                              <span className="text-muted-foreground">
                                {formatPagePosition(Math.min(classesPage, categoryPageCount - 1), categoryPageCount)}
                              </span>
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.min(categoryPageCount - 1, page + 1))}
                                disabled={classesPage >= categoryPageCount - 1}
                              >
                                Next
                              </button>
                            </div>
                          )}
                          <div className={FACET_ITEM_GAP_CLASS}>
                            {categoriesTreeMode ? (
                              <div className={FACET_ITEM_GAP_CLASS}>
                                  {(() => {
                                    const renderTreeNode = (node: CategoryTreeNode, depth: number, parentKey: string): ReactNode => {
                                      const item = node.item;
                                      const nodeKey = categoryTreeNodeKey(parentKey, item.uri);
                                      const isExpanded = expandedCategoryNodes.has(nodeKey);
                                      const isZeroCount = item.count === 0;
                                      return <Collapsible key={nodeKey} open={isExpanded} onOpenChange={(open) => setExpandedCategoryNodes((current) => { const next = new Set(current); if (open) next.add(nodeKey); else next.delete(nodeKey); return next; })} className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50" style={depth ? { paddingLeft: `${8 + depth * 14}px` } : undefined}>
                                          <input type="checkbox" checked={selectedClasses.has(item.uri)} onChange={(event) => toggleClass(item.uri, event.target.checked)} aria-label={`Filter by class ${toLabel(item.uri, "Class")}`} className="size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40" aria-invalid={isZeroCount ? true : undefined} />
                                          <div className="flex min-w-0 flex-1 items-center gap-1">
                                            <Tooltip><TooltipTrigger render={<button type="button" className={`min-w-0 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`} onClick={() => { if (isGroupByCategory) scrollToGroupForFacetValue({ uri: item.uri, title: toLabel(item.uri, "Class"), matches: [], termType: "uri" }); else { if (!selectedClasses.has(item.uri)) toggleClass(item.uri, true); showClassResults(item.uri, activeLeafId); } }}>{toLabel(item.uri, "Class")}</button>} /><TooltipContent>{item.uri}</TooltipContent></Tooltip>
                                            {node.children.length > 0 && <CollapsibleTrigger aria-label={`${isExpanded ? "Collapse" : "Expand"} ${toLabel(item.uri, "Class")}`} className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">{isExpanded ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}</CollapsibleTrigger>}
                                          </div>
                                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{shortenCount(item.count)}</span>
                                        </div>
                                        {node.children.length > 0 && <CollapsibleContent className={`mt-0.5 ${FACET_ITEM_GAP_CLASS}`}>{node.children.map((child) => renderTreeNode(child, depth + 1, nodeKey))}</CollapsibleContent>}
                                      </Collapsible>;
                                    };
                                    return (categoryTreePages[Math.min(classesPage, categoryPageCount - 1)] ?? []).map((node) => renderTreeNode(node, 0, ""));
                                  })()}
                              </div>
                            ) : pagedUnselectedClasses.map((item) => {
                                const isZeroCount = item.count === 0;
                                return (
                                <div key={item.uri} className="flex items-center gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50">
                                  <input
                                    type="checkbox"
                                    checked={selectedClasses.has(item.uri)}
                                    onChange={(event) => toggleClass(item.uri, event.target.checked)}
                                    aria-label={`Filter by class ${toLabel(item.uri, "Class")}`}
                                    className="size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                                    aria-invalid={isZeroCount ? true : undefined}
                                  />
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}
                                    onClick={() => {
                                      if (isGroupByCategory) {
                                        scrollToGroupForFacetValue({ uri: item.uri, title: toLabel(item.uri, "Class"), matches: [], termType: "uri" });
                                      } else {
                                        if (!selectedClasses.has(item.uri)) toggleClass(item.uri, true);
                                        showClassResults(item.uri, activeLeafId);
                                      }
                                    }}
                                  >
                                    {toLabel(item.uri, "Class")}
                                  </button>} /><TooltipContent>{item.uri}</TooltipContent></Tooltip>
                                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{shortenCount(item.count)}</span>
                                </div>
                                );
                              })}
                          </div>
                        </>
                      )}
                    </article>
                    {!focusWidgetsSuppressed && personalRoleFacetNodes.map((roleNode) => {
                      const uri = roleNode.attributes.iri ?? "";
                      const roleLabel = `${toLabel(uri, "Role")} of`;
                      const excluded = roleNode.attributes.exclude?.trim().toLowerCase() === "yes";
                      const label = `${roleLabel} `;
                      const isGroupByRole = groupByPropertyUri === `reverse:${uri}`;
                      const canGroupByRole = !excluded && groupByOptions.some((option) => option.key === `reverse:${uri}`);
                      return (
                        <article key={roleNode.id} ref={(element) => { if (element) roleWidgetCardRefs.current.set(uri, element); else roleWidgetCardRefs.current.delete(uri); }} className={`flex min-w-0 flex-col ${isGroupByRole ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : ""}`} style={facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === uri && facetHoverPreview.direction === "reverse" ? { borderColor: "rgb(168 85 247)" } : undefined}>
                          <header className={`group/header flex items-start justify-between gap-2 border-b px-3 py-2 ${isGroupByRole ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""}`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <Tooltip><TooltipTrigger render={<button
                                  type="button"
                                  className={`cursor-pointer text-left text-sm font-semibold underline-offset-2 hover:underline ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === uri && facetHoverPreview.direction === "reverse" ? "text-purple-700 dark:text-purple-300" : ""}`}
                                  onMouseEnter={() => beginFacetHoverPreview(uri, "reverse", label.trim(), "personal")}
                                  onMouseLeave={clearTutorialPreview}
                                  onClick={() => navigateToPropertyPath(roleNode.id)}
                                >
                                  <IncompleteWidgetIndicator source={`personal-role:${uri}`} />
                                  {activeRoleFilters.some((node) => node.attributes.iri === uri && node.attributes.src === "shacl") && <ClipboardList className="mr-1 inline size-4 shrink-0" aria-label="SHACL-discovered facet" />}
                                  {isGroupByRole && <UsersRound className="mr-1 inline size-4 shrink-0" aria-label="Group by" />}
                                  {excluded && <CircleSlash className="mr-1 inline size-3.5" aria-label="Excluded" />}
                                  {label}
                                </button>} /><TooltipContent>{`Navigate to role scope ${label}`}</TooltipContent></Tooltip>
                                {autoConfiguredFacetKeys.has(`property-in::${uri}`) && (
                                  <Bot className="size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                )}
                                <div className="flex shrink-0 items-center gap-1">
                                  <QueryInspectorButton
                                    query={serializeFctQuery(setQueryViewAttributes(
                                      createPersonalRoleValuesQuery(queryTree, roleNode),
                                      { ...(isGroupByRole ? { sort: "count" } : {}), limit: String(leftWidgetLimits.roles) },
                                    ))}
                                    filename="personal-role-values-fct-query.xml"
                                    label="View Personal role values query"
                                    primaryTabLabel="XML"
                                    extraQueries={personalFacetInspectorQueries(
                                      queryTree,
                                      serializeFctQuery(setQueryViewAttributes(
                                        createPersonalRoleValuesQuery(queryTree, roleNode),
                                        { ...(isGroupByRole ? { sort: "count" } : {}), limit: String(leftWidgetLimits.roles) },
                                      )),
                                      uri,
                                      roleWidgetStatuses[roleNode.id]?.sampleValue,
                                      { direction: "reverse", nodeId: roleNode.id },
                                    )}
                                  />
                                  {workspaceTab === "browse" && !excluded && (
                                    <Tooltip><TooltipTrigger render={<button
                                      type="button"
                                      disabled={!canGroupByRole}
                                      aria-pressed={isGroupByRole}
                                      onClick={() => {
                                        if (isGroupByRole) {
                                          setGroupByPropertyUri("");
                                          setCentralTab("results");
                                        } else {
                                          setGroupByPropertyUri(`reverse:${uri}`);
                                          setCentralTab("groups");
                                        }
                                      }}
                                      className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:pointer-events-none disabled:opacity-30 ${isGroupByRole ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}
                                      aria-label={isGroupByRole ? `Stop grouping by ${roleLabel}` : `Group results by ${roleLabel}`}
                                    >
                                      <UsersRound className="size-4" aria-hidden="true" />
                                    </button>} /><TooltipContent>{isGroupByRole ? `Stop grouping by ${roleLabel}` : canGroupByRole ? `Group results by ${roleLabel}` : "Select this role in the active query before grouping by it"}</TooltipContent></Tooltip>
                                  )}
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                                    onClick={() => deleteNode(roleNode.id)}
                                    aria-label={`Remove role filter ${label}`}
                                  >
                                    <Trash2 className="size-4" aria-hidden="true" />
                                  </button>} /><TooltipContent>{`Remove role filter ${roleLabel}`}</TooltipContent></Tooltip>
                                </div>
                              </div>
                              <Tooltip><TooltipTrigger render={<p className="mt-1 break-all text-xs text-muted-foreground">{uri}</p>} /><TooltipContent>{uri}</TooltipContent></Tooltip>
                            </div>
                            <Tooltip><TooltipTrigger render={<span
                              className={`shrink-0 text-xs ${roleWidgetStatuses[roleNode.id]?.error ? "text-destructive" : "text-muted-foreground"}`}
                              aria-live="polite"
                            >
                              {roleWidgetStatuses[roleNode.id]?.loading ?? true
                                ? <ElapsedStatus label="Updating…" category="roles" />
                                : roleWidgetStatuses[roleNode.id]?.error
                                  ? "Update failed"
                                  : shortenCount(roleWidgetStatuses[roleNode.id]?.count ?? 0)}
                            </span>} /><TooltipContent>{roleWidgetStatuses[roleNode.id]?.error || undefined}</TooltipContent></Tooltip>
                          </header>
                          {endpointReadyForQuery && <PersonalRoleWidget tree={queryTree} roleNode={roleNode} label={label.trim()} isGroupByRole={groupedRoleUri === uri} groupBy={centralTab === "groups" && selectedGroupByOption && groupedRoleUri === uri ? { option: selectedGroupByOption, limit: groupBatchSize } : undefined} limit={leftWidgetLimits.roles} onGroupValueClick={scrollToGroupForFacetValue} setRoleWidgetStatuses={setRoleWidgetStatuses} endpointReady={endpointReadyForQuery} refreshRevision={queryRefreshRevision} />}
                        </article>
                      );
                    })}
                    {!focusWidgetsSuppressed && renderPersonalWidgetCards(workspace, "column")}
                    <article className="flex min-w-0 flex-col">
                      <header className="group/header flex items-center gap-2 px-2 py-2">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <IncompleteWidgetIndicator source="graphs" /><h2 className="text-sm font-semibold">Graphs</h2>
                          <QueryInspectorButton query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.GRAPHS)}\n<!-- FCT API option: graphOnly=true -->`} filename="graphs-fct-query.xml" extraQueries={[{ id: "graph-list-sparql", label: "GraphList SPARQL", query: graphListSparql || "# GraphList SPARQL will appear after the endpoint returns a query.", filename: "graph-list.sparql", language: "sparql" }]} />
                          <Tooltip><TooltipTrigger render={<button
                            type="button" aria-pressed={graphTreeMode}
                            onClick={() => { setGraphTreeMode((mode) => !mode); setGraphsPage(0); setExpandedGraphNodes(new Set()); }}
                            className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 ${graphTreeMode ? "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100" : ""}`}
                            aria-label={graphTreeMode ? "Show graphs as a flat list" : "Show graphs as a URI-prefix tree"}
                          >{graphTreeMode ? <List className="size-4" aria-hidden="true" /> : <Network className="size-4" aria-hidden="true" />}</button>} /><TooltipContent>{graphTreeMode ? "Show flat graph list" : "Show graph tree"}</TooltipContent></Tooltip>
                          {graphTreeMode && <Tooltip><TooltipTrigger render={<button
                            type="button" disabled={graphParentKeys.length === 0}
                            onClick={() => setExpandedGraphNodes(graphTreeAllCollapsed ? new Set(graphParentKeys) : new Set())}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover/header:disabled:opacity-40"
                            aria-label={graphTreeAllCollapsed ? "Open all graphs" : "Collapse all graphs"}
                          >{graphTreeAllCollapsed ? <ChevronsUpDown className="size-4" aria-hidden="true" /> : <ChevronsDownUp className="size-4" aria-hidden="true" />}</button>} /><TooltipContent>{graphTreeAllCollapsed ? "Open all" : "Collapse all"}</TooltipContent></Tooltip>}
                          {queryTree.attributes.graph && (
                            <Tooltip><TooltipTrigger render={<button
                              type="button"
                              onClick={clearGraph}
                              className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                              aria-label="Clear graph selection"
                            ><X className="size-4" aria-hidden="true" /></button>} /><TooltipContent>{"Clear graph selection and Graph field"}</TooltipContent></Tooltip>
                          )}
                          <div
                            aria-label="Sort graphs"
                            className={`invisible ml-1 shrink-0 overflow-hidden opacity-0 transition-[width,opacity] duration-200 group-hover/header:visible group-hover/header:opacity-100 focus-within:visible focus-within:opacity-100 ${graphSortPickerExpanded ? "w-28" : "w-7"}`}
                            onMouseEnter={() => setGraphSortPickerExpanded(true)}
                            onMouseLeave={() => setGraphSortPickerExpanded(false)}
                            onFocusCapture={() => setGraphSortPickerExpanded(true)}
                            onBlurCapture={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGraphSortPickerExpanded(false);
                            }}
                          >
                            <ButtonGroup className="inline-flex w-28 shrink-0 items-center [&>*+*]:border-l [&>*+*]:border-input">
                              {[...([
                                { value: "label-asc", label: "Label: A to Z", Icon: ArrowDownAZ },
                                { value: "label-desc", label: "Label: Z to A", Icon: ArrowDownZA },
                              ] as const)].sort((left, right) => left.value === graphSort ? -1 : right.value === graphSort ? 1 : 0).map(({ value, label, Icon }) => (
                                <Tooltip key={value}>
                                  <TooltipTrigger render={
                                    <Toggle
                                      pressed={graphSort === value}
                                      onPressedChange={(pressed) => {
                                        if (!pressed) return;
                                        setGraphsPage(0);
                                        setGraphSort(value);
                                        setGraphSortPickerExpanded(false);
                                      }}
                                      aria-hidden={!graphSortPickerExpanded && graphSort !== value}
                                      tabIndex={!graphSortPickerExpanded && graphSort !== value ? -1 : 0}
                                      className={`size-7 shrink-0 border-0 p-0 transition-colors ${graphSort === value ? "bg-black text-white dark:bg-black dark:text-white" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
                                      aria-label={label}
                                    >
                                      <Icon aria-hidden="true" className="size-4" />
                                    </Toggle>
                                  } />
                                  <TooltipContent>{label}</TooltipContent>
                                </Tooltip>
                              ))}
                            </ButtonGroup>
                          </div>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground" aria-live="polite">
                            {isLoadingGraphs ? <ElapsedStatus label="Updating…" category="graphs" /> : shortenCount(graphFacets.length)}
                          </span>
                        </div>
                      </header>
                      {queryTree.attributes.graph && queryTree.attributes.graph !== ALL_GRAPHS && (
                        <div className="mb-2 rounded-md border border-input bg-background px-2 py-1 text-sm" aria-label="Selected graph">
                          <label className="flex min-w-0 items-start gap-2 cursor-pointer">
                            <input type="radio" name="maestro-query-graph-personal" checked readOnly aria-label="Selected graph" className="mt-0.5 size-4 shrink-0 accent-current" />
                            <span className="min-w-0 flex-1">
                              <span className="block break-words">{graphFacets.find((item) => item.uri === queryTree.attributes.graph)?.label || toLabel(queryTree.attributes.graph, "Class")}</span>
                              <span className="block break-all text-xs text-muted-foreground">{queryTree.attributes.graph}</span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">Selected</span>
                          </label>
                        </div>
                      )}
                      {graphFacets.length === 0 ? (
                        <p className="px-2 text-xs text-muted-foreground">
                          {isLoadingGraphs ? <ElapsedStatus label="Loading graphs" category="graphs" /> : "No graph rows returned. Check the incomplete indicator for timeout details."}
                        </p>
                      ) : (
                        <>
                          {(activeGraphPageCount > 1) && (
                            <div className="mt-2 mb-2 flex items-center justify-between gap-2 text-xs">
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setGraphsPage((page) => Math.max(0, page - 1))}
                                disabled={graphsPage === 0 || isLoadingGraphs}
                              >
                                Previous
                              </button>
                              <span className="text-muted-foreground">
                                {formatPagePosition(graphsPage, activeGraphPageCount)}
                              </span>
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setGraphsPage((page) => Math.min(activeGraphPageCount - 1, page + 1))}
                                disabled={isLoadingGraphs || graphsPage >= activeGraphPageCount - 1}
                              >
                                Next
                              </button>
                            </div>
                          )}
                          <div className={FACET_ITEM_GAP_CLASS}>
                            {(() => {
                              const pageGraphs = sortedGraphFacets.slice(graphsPage * FACET_PAGE_SIZE, (graphsPage + 1) * FACET_PAGE_SIZE)
                                .filter((item) => item.uri !== queryTree.attributes.graph);
                              const graphRow = (item: (typeof graphFacets)[number]) => (
                                <label key={item.uri} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50">
                                  <input type="radio" name="maestro-query-graph-personal" checked={queryTree.attributes.graph === item.uri}
                                    onChange={() => bindGraph(item.uri)} aria-label={`Bind graph ${item.label}`}
                                    className="mt-0.5 size-4 shrink-0 accent-current" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block break-words">{item.label}</span>
                                    <Tooltip><TooltipTrigger render={<span className="block break-all text-xs text-muted-foreground">{item.uri}</span>} /><TooltipContent>{item.uri}</TooltipContent></Tooltip>
                                  </span>
                                  {item.count > 0 && <Tooltip><TooltipTrigger render={<span className="shrink-0 text-xs text-muted-foreground">{shortenCount(item.count)}</span>} /><TooltipContent>{`${item.count} matching resources`}</TooltipContent></Tooltip>}
                                </label>
                              );
                              return graphTreeMode ? <GraphUriTree nodes={graphTreeNodes.slice(graphsPage * FACET_PAGE_SIZE, (graphsPage + 1) * FACET_PAGE_SIZE)} expanded={expandedGraphNodes} setExpanded={setExpandedGraphNodes} selectedUri={queryTree.attributes.graph ?? ""} onSelect={bindGraph} /> : pageGraphs.map(graphRow);
                            })()}
                          </div>
                        </>
                      )}
                    </article>
                  </div>
                )}
</>;
}
