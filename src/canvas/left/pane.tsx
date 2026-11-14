"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { ConfigureWorkspaceContent } from "@/canvas/left/configure-pane";
import { FilterWorkspaceContent } from "@/canvas/left/filter-pane";

import { CONFIGURE_LIST_BACKGROUND_COLOR } from "@/canvas/left/configure";

import maestroLanguages from "@/data/maestro-languages.json";

import { ButtonGroup } from "@/components/ui/button-group";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { MousePointerClick, LoaderCircle, ArrowLeft } from "lucide-react";
import { shortenCount } from "@/lib/utils";

import { LeftPaneFrame, LeftPaneBody } from "@/canvas/workspace-pane-shells";

// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.

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

import type { LeftPaneWorkspace } from "@/canvas/controllers/workspace-interfaces";

/** UI owned by LeftCanvasPanel. State and commands come from the shared workspace controller. */
export function LeftCanvasPanel({ workspace }: { workspace: LeftPaneWorkspace }) {
  const {
    FACET_PAGE_SIZE,
    activeLeafId,
    activePropertyFilters,
    activeRoleFilters,
    autoConfigureFacetCount,
    autoConfiguredFacetKeys,
    beginFacetHoverPreview,
    bindGraph,
    categoriesIncomplete,
    categoriesTreeMode,
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
    commitConfigureFacetChanges,
    clearTutorialPreview,
    defaultLeftTab,
    deleteNode,
    endpointReadyForQuery,
    expandedCategoryNodes,
    facetCandidateCounts,
    facetHoverPreview,
    focusListOrder,
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
    groupedRoleUri,
    handleFacetShiftClick,
    handlePropertyCheckboxChange,
    handleRoleCheckboxChange,
    hoveredFacetKey,
    isFacetExcluded,
    isGroupByCategory,
    isLoadingClasses,
    isLoadingGraphs,
    isLoadingProperties,
    isLoadingRoles,
    isRootView,
    leftPanelLimit,
    navigateIntoRelationship,
    navigateToPropertyPath,
    pagedUnselectedClasses,
    personalRoleFacetNodes,
    personalWidgets,
    propertiesPage,
    propertyFacetError,
    propertyFacetWarning,
    propertyFacets,
    queryRefreshRevision,
    queryTree,
    queryWithoutPagingXml,
    resultsBatchSize,
    roleFacetError,
    roleFacetWarning,
    roleFacets,
    roleWidgetCardRefs,
    roleWidgetStatuses,
    rolesPage,
    runAutoConfigure,
    scrollToGroupForFacetValue,
    selectedClassDisplayFacets,
    selectedClasses,
    selectedGroupByOption,
    selectedProperties,
    selectedRoles,
    setCentralTab,
    setClassesPage,
    setDefaultLeftTab,
    setExpandedCategoryNodes,
    setFocusListOrder,
    setGraphSort,
    setGraphSortPickerExpanded,
    setGraphsPage,
    setGroupByPropertyUri,
    setHoveredFacetKey,
    setPropertiesPage,
    setQueryAttribute,
    setResultsPage,
    setRoleWidgetStatuses,
    setRolesPage,
    setSelectedFacet,
    shiftKeyDown,
    showClassResults,
    showConfigureProperties,
    showConfigureRoles,
    showPropertiesSpinner,
    showRolesSpinner,
    toggleClass,
    visibleClassDisplayFacets,
  } = workspace;
  return (
<LeftPaneFrame>
            {/* Left pane navigation uses count links while retaining the existing panes. */}
            <LeftPaneBody>
              <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-sm whitespace-nowrap">
                {defaultLeftTab === "facets" ? (
                  <>
                    <ButtonGroup aria-label="Return to facets">
                      <button
  type="button"
  onClick={commitConfigureFacetChanges}
  className="inline-flex items-center gap-2 px-2 text-xs font-medium hover:bg-accent"
>
  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
  Return to Filters
</button>
                      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                      <Tooltip><TooltipTrigger render={<button
                        type="button"
                        onClick={commitConfigureFacetChanges}
                        className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent"
                        aria-label={`Show Filters, ${personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)} facets`}
                      >
                        {personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)}
                      </button>} /><TooltipContent>{"Show Filters"}</TooltipContent></Tooltip>
                    </ButtonGroup>
                  </>
                ) : (
                  <>
                    {(isLoadingProperties && propertyFacets.length === 0) ||
                    (isLoadingRoles && roleFacets.length === 0) ? (
                      <span role="status" aria-live="polite" className="px-2 text-xs text-muted-foreground">
                        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                          {isLoadingProperties && propertyFacets.length === 0 ? <ElapsedStatus label="Fetching properties" category="properties" clockScope="properties" /> : null}
                          {isLoadingRoles && roleFacets.length === 0 ? <ElapsedStatus label="Fetching roles" category="roles" clockScope="roles" /> : null}
                        </span>
                      </span>
                    ) : null}
                    {(!isLoadingProperties && propertyFacets.length === 0 && propertyFacetError) || (!isLoadingRoles && roleFacets.length === 0 && roleFacetError) ? (
                      <div role="alert" className="flex min-w-0 max-w-full flex-col gap-0.5 px-2 text-xs text-destructive">
                        {!isLoadingProperties && propertyFacets.length === 0 && propertyFacetError ? (
                          <ErrorDetails prefix="Properties" error={propertyFacetError} />
                        ) : null}
                        {!isLoadingRoles && roleFacets.length === 0 && roleFacetError ? (
                          <ErrorDetails prefix="Roles" error={roleFacetError} />
                        ) : null}
                      </div>
                    ) : null}
                    {showConfigureProperties && (
                      <ButtonGroup aria-label="Configure properties">
                        <button type="button" onClick={() => { setFocusListOrder("Properties"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="inline-flex items-center gap-1 px-2 text-xs font-medium hover:bg-accent" title="Configure Properties" aria-label="Configure Properties"><MousePointerClick className="size-3.5" aria-hidden="true" /> Properties</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <Tooltip><TooltipTrigger render={<button
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Properties");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Show Focus properties, ${propertyFacets.length} properties`}
                        >{showPropertiesSpinner ? <LoaderCircle className="size-4 animate-spin" aria-label="Loading properties" role="status" /> : shortenCount(propertyFacets.length)}</button>} /><TooltipContent>{"Show Focus properties first"}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                    {showConfigureRoles && (
                      <ButtonGroup aria-label="Configure roles">
                        <button type="button" onClick={() => { setFocusListOrder("Roles"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="inline-flex items-center gap-1 px-2 text-xs font-medium hover:bg-accent" title="Configure Roles" aria-label="Configure Roles"><MousePointerClick className="size-3.5" aria-hidden="true" /> Roles</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <Tooltip><TooltipTrigger render={<button
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Roles");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Show Focus roles, ${roleFacets.length} roles`}
                        >{showRolesSpinner ? <LoaderCircle className="size-4 animate-spin" aria-label="Loading roles" role="status" /> : shortenCount(roleFacets.length)}</button>} /><TooltipContent>{"Show Focus roles first"}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                    {autoConfigureFacetCount > 0 && (
                      <ButtonGroup aria-label="Auto-configure facets">
                        <Tooltip><TooltipTrigger render={<button
                          type="button"
                          onClick={runAutoConfigure}
                          className="px-2 text-xs font-medium hover:bg-accent"
                        >Auto-configure</button>} /><TooltipContent>{"Add high-frequency Properties and Roles that apply to the current query scope"}</TooltipContent></Tooltip>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <Tooltip><TooltipTrigger render={<button
                          type="button"
                          onClick={runAutoConfigure}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Auto-configure ${autoConfigureFacetCount} facets`}
                        >{shortenCount(autoConfigureFacetCount)}</button>} /><TooltipContent>{`${autoConfigureFacetCount} facets will be added`}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                  </>
                )}
              </div>
              <div
                className={`min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] p-3 ${defaultLeftTab === "facets" ? "" : "bg-background"}`}
                style={defaultLeftTab === "facets" ? { backgroundColor: CONFIGURE_LIST_BACKGROUND_COLOR } : undefined}
              >
                <ConfigureWorkspaceContent workspace={workspace} />

                <FilterWorkspaceContent workspace={workspace} />

                {defaultLeftTab === "community" && (
                  <div className="space-y-2">
                    <h2 className="text-sm font-semibold">Community</h2>
                    <p className="text-xs text-muted-foreground">
                      Community-shared views will appear here. This tab is a
                      placeholder for now.
                    </p>
                  </div>
                )}
              </div>
            </LeftPaneBody>

            </LeftPaneFrame>
  );
}
