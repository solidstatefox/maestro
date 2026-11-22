"use client";
import { ConfigureWorkspaceContent } from "@/canvas/left/configure-pane";
import { FilterWorkspaceContent } from "@/canvas/left/filter-pane";

import { CONFIGURE_LIST_BACKGROUND_COLOR } from "@/canvas/left/configure";

import maestroLanguages from "@/data/maestro-languages.json";




import { LeftPaneFrame, LeftPaneBody } from "@/canvas/workspace-pane-shells";
import { LeftPaneNavigation } from "@/canvas/left/pane-navigation";

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
              <LeftPaneNavigation workspace={workspace} />
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
