"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";

import { FACET_GROUPS as facets, FACET_ITEM_GAP_CLASS, PROPERTY_ROLE_ITEM_GAP_CLASS } from "@/canvas/left/facet-layout";

import { IncompleteWidgetIndicator } from "@/canvas/utils/incomplete-widget";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";

import { DistinctCount, distinctCountQueryFor } from "@/canvas/left/filter";
import { ellipsize, RDF_TYPE_URI } from "@/canvas/utils/query-controller";

import { createFacetItem, type FacetItem, type FacetName } from "@/canvas/left/filter";
import { CONFIGURE_HEADER_BACKGROUND_COLOR, CONFIGURE_HEADER_BORDER_COLOR } from "@/canvas/left/configure";

import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";

import { toLabel } from "@/lib/uri-labels";
import { selectedFacetCount, selectedFacetLabel } from "@/lib/selected-facet-presentation";

import { buildFctCountSparql } from "@/lib/fct-count-sparql";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Bot, SquarePlus, SquareX, SquareCheck } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { formatPagePosition } from "@/canvas/utils/pagination";

import { createDistinctCountQuery } from "@/lib/fct-query-api";
import type { DistinctCountKind } from "@/lib/fct-query-api";
import type { ConfigurePaneWorkspace } from "@/canvas/controllers/workspace-interfaces";

export function ConfigureWorkspaceContent({ workspace }: { workspace: ConfigurePaneWorkspace }) {
  const {
    FACET_PAGE_SIZE,
    activeLeafId,
    activePropertyFilters,
    activeRoleFilters,
    autoConfiguredFacetKeys,
    beginFacetHoverPreview,
    bindGraph,
    classFacetError,
    classFacetWarning,
    classFacets,
    classesPage,
    clearTutorialPreview,
    defaultLeftTab,
    facetCandidateCounts,
    facetHoverPreview,
    focusListOrder,
    graphFacets,
    graphsPage,
    handleFacetShiftClick,
    handlePropertyCheckboxChange,
    handleRoleCheckboxChange,
    hoveredFacetKey,
    isFacetExcluded,
    isLoadingClasses,
    isLoadingProperties,
    isLoadingRoles,
    isRootView,
    navigateIntoRelationship,
    propertiesPage,
    propertyFacetError,
    propertyFacetWarning,
    propertyFacets,
    queryTree,
    queryWithoutPagingXml,
    roleFacetError,
    roleFacetWarning,
    roleFacets,
    rolesPage,
    selectedClasses,
    selectedProperties,
    selectedRoles,
    setClassesPage,
    setGraphsPage,
    setHoveredFacetKey,
    setPropertiesPage,
    setRolesPage,
    setSelectedFacet,
    shiftKeyDown,
    showClassResults,
    toggleClass,
  } = workspace;
  return <>
{defaultLeftTab === "facets" && (
                  <>
                    {((Object.keys(facets) as FacetName[]).filter((group) => group !== "Classes" && group !== "Graphs") as FacetName[]).sort((a, b) => {
                      const order = focusListOrder === "Properties" ? ["Properties", "Roles", "Graphs"] : ["Roles", "Properties", "Graphs"];
                      return order.indexOf(a) - order.indexOf(b);
                    }).map((group) => {
let items: { key: string; label: string; count: number; example?: FacetItem["example"] }[] =
  group === "Properties"
    ? propertyFacets.map((item) => {
        const facet = createFacetItem(
          item.uri,
          toLabel(item.uri, "Property"),
          item.count,
          item.example,
        );
        return {
          key: facet.uri,
          label: facet.label,
          count: facet.count,
          example: facet.example,
        };
      })
    : group === "Classes"
      ? classFacets.map((item) => {
          const facet = createFacetItem(
            item.uri,
            `${toLabel(item.uri, "Class")}s`,
            item.count,
          );
          return {
            key: facet.uri,
            label: facet.label,
            count: facet.count,
          };
        })
      : group === "Roles"
        ? roleFacets.map((item) => {
            const facet = createFacetItem(
              item.uri,
              toLabel(item.uri, "Role"),
              item.count,
              item.example,
            );
            return {
              key: facet.uri,
              label: facet.label,
              count: facet.count,
              example: facet.example,
            };
          })
        : group === "Graphs"
          ? graphFacets.map((item) => {
              const facet = createFacetItem(
                item.uri,
                toLabel(item.uri, "Class"),
                item.count,
              );
              return {
                key: facet.uri,
                label: facet.label,
                count: facet.count,
              };
            })
          : [];
                      // Keep checked Properties/Roles in a separate pane above
                      // pagination. Only unchecked items participate in paging;
                      // preserve query order for selected items and FCT order below.
                      const exampleForFacetItem = (key: string, fallback?: FacetItem["example"]) => {
                        if (group !== "Properties" && group !== "Roles") return fallback;
                        const selectedNode = (group === "Properties" ? activePropertyFilters : activeRoleFilters).find((node) => node.attributes.iri === key);
                        const bound = selectedNode?.children.find((child) => child.name === "value" && Boolean(child.text));
                        if (!bound?.text) return fallback;
                        const isUri = bound.attributes.datatype === "uri";
                        return { uri: bound.text, termType: isUri ? "uri" as const : "literal" as const, label: isUri ? toLabel(bound.text, "Class") : bound.text };
                      };
                      const selectedItems =
  group === "Properties" || group === "Roles"
    ? Array.from(
        group === "Properties" ? Array.from(selectedProperties).filter((key) => key !== RDF_TYPE_URI) : selectedRoles,
        (key) => {
          const facet = items.find((item) => item.key === key);
          return {
            key,
            label: selectedFacetLabel(key, group === "Properties" ? "Property" : "Role", facet?.label),
            count: selectedFacetCount(facet?.count),
            example: exampleForFacetItem(key, facet?.example),
          };
        },
      )
    : [];
                      const selectedKeys = new Set(selectedItems.map((item) => item.key));
                      // On the wholly unbound root, the per-candidate count
                      // probes cannot reliably suppress the returned facet
                      // enumeration. Keep the actual list from FCT instead.
                      const emptyRootFacetScope = isRootView && !queryTree.children.some((node) =>
                        (node.name === "text" && Boolean(node.text?.trim())) ||
                        ["class", "property", "property-of", "value"].includes(node.name));
                      const facetListStale = group === "Classes" ? isLoadingClasses : false;
                      const unselectedItems = items.filter((item) => {
                        if (selectedKeys.has(item.key)) return false;
                        if (group !== "Properties" && group !== "Roles") return true;
                        const countKind: DistinctCountKind = group === "Properties" ? "property" : "role";
                        const countQuery = distinctCountQueryFor(queryTree, countKind, item.key);
                        return emptyRootFacetScope || facetCandidateCounts[countQuery] !== 0;
                      });

                      const currentPage =
                        group === "Properties"
                          ? propertiesPage
                          : group === "Classes"
                            ? classesPage
                            : group === "Graphs"
                              ? graphsPage
                              : rolesPage;
                      const pageCount = Math.max(
                        1,
                        Math.ceil(
                          (group === "Properties" || group === "Roles"
                            ? unselectedItems.length
                            : items.length) / FACET_PAGE_SIZE,
                        ),
                      );
                      const pageItems =
                        group === "Properties" || group === "Roles"
                          ? unselectedItems.slice(
                              currentPage * FACET_PAGE_SIZE,
                              (currentPage + 1) * FACET_PAGE_SIZE,
                            )
                          : group === "Classes" || group === "Graphs"
                            ? items.slice(
                                currentPage * FACET_PAGE_SIZE,
                                (currentPage + 1) * FACET_PAGE_SIZE,
                              )
                            : items;
                      const setPage =
                        group === "Properties"
                          ? setPropertiesPage
                          : group === "Classes"
                            ? setClassesPage
                            : group === "Graphs"
                              ? setGraphsPage
                              : setRolesPage;

                      if ((group === "Properties" || group === "Roles") && items.length === 0 && selectedItems.length === 0) return null;

                      return (
                        <section
                          key={group}
                          className="mb-5"
                        >
                          <div
                            className={`group/header flex w-full items-center gap-1 rounded-t-md border-b overflow-hidden ${group === "Properties" || group === "Roles" ? "mb-2" : ""}`}
                            style={{ backgroundColor: CONFIGURE_HEADER_BACKGROUND_COLOR, borderColor: CONFIGURE_HEADER_BORDER_COLOR }}
                          >
                            <div className="min-w-0">
                              <button
                                type="button"
                                className="flex min-w-0 items-center gap-1 px-3 py-2 text-left text-white hover:brightness-90"
                                style={{ backgroundColor: CONFIGURE_HEADER_BACKGROUND_COLOR }}
                                onClick={() => setSelectedFacet(group)}
                              >
                                <IncompleteWidgetIndicator source={group === "Properties" ? "properties" : group === "Roles" ? "roles" : "graphs"} />
                                <h2 className="truncate text-sm font-semibold">{group}</h2>
                              </button>
                            </div>
                            {group === "Properties" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES)}\n<!-- FCT API option: view=properties -->`}
                                filename="properties-fct-query.xml"
                                label="View Properties widget query"
                                headerTone
                                countQuery={propertyFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "property", propertyFacets[0].uri, undefined, undefined, FCT_VIEW_TYPES.PROPERTIES)) : undefined}
                                countFilename="properties-first-item-count.sparql"
                              />
                            )}
                            {group === "Roles" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES_IN)}\n<!-- FCT API option: view=properties-in -->`}
                                filename="roles-fct-query.xml"
                                label="View Roles widget query"
                                headerTone
                                countQuery={roleFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "role", roleFacets[0].uri, undefined, undefined, FCT_VIEW_TYPES.PROPERTIES_IN)) : undefined}
                                countFilename="roles-first-item-count.sparql"
                              />
                            )}
                            <Tooltip><TooltipTrigger render={<span
                              className={`ml-auto shrink-0 px-2 text-xs font-normal ${(group === "Properties" && propertyFacetError) || (group === "Classes" && classFacetError) || (group === "Roles" && roleFacetError) ? "text-red-100" : "text-white/90"}`}
                              aria-live="polite"
                            >
                              {/* A configured facet count remains valid while its next request is queued.
                                  Mounting this pane must never create a new execution timer:
                                  only proxy dispatch events start a scoped clock. */}
                              {(group === "Properties" ? propertyFacets.length : group === "Roles" ? roleFacets.length : group === "Classes" ? classFacets.length : items.length) > 0
                                ? shortenCount(group === "Properties" ? propertyFacets.length : group === "Roles" ? roleFacets.length : group === "Classes" ? classFacets.length : items.length)
                                : (group === "Properties" && isLoadingProperties) || (group === "Classes" && isLoadingClasses) || (group === "Roles" && isLoadingRoles)
                                  ? <ElapsedStatus label="Updating" category={group === "Properties" ? "properties" : group === "Roles" ? "roles" : "categories"}
                                      clockScope={group === "Properties" ? "properties" : group === "Roles" ? "roles" : "categories"}
                                      requestWaves={group === "Classes" ? 2 : 1} />
                                  : (group === "Properties" && propertyFacetError) || (group === "Classes" && classFacetError) || (group === "Roles" && roleFacetError)
                                    ? "Update failed"
                                    : "0"}
                            </span>} /><TooltipContent>
  {group === "Properties"
    ? propertyFacetError || propertyFacetWarning
    : group === "Roles"
      ? roleFacetError || roleFacetWarning
      : group === "Classes"
        ? classFacetError || classFacetWarning
        : undefined}
</TooltipContent></Tooltip>
                          </div>

                          {(group === "Properties" || group === "Roles") &&
                            selectedItems.length > 0 && (
                              <div className={`mb-2 rounded-md border border-border/70 bg-background/80 p-2 ${facetListStale ? "opacity-45" : ""}`} aria-disabled={facetListStale || undefined}>
                                <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">Selected</div>
                                <div className={PROPERTY_ROLE_ITEM_GAP_CLASS}>
                                  {selectedItems.map((item) => (
                                    <div
                                      key={item.key}
                                      className={`flex w-full min-w-0 items-start gap-2 py-[1px] ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && ((group === "Properties" && facetHoverPreview.direction === "forward") || (group === "Roles" && facetHoverPreview.direction === "reverse")) ? "!border-purple-500" : "border-transparent"}`}
                                    >
                                      <button
  type="button"
  disabled={facetListStale}
  data-excluded={isFacetExcluded(group, item.key) ? "true" : undefined}
  aria-invalid={item.count === 0 ? true : undefined}
  aria-label={`Unselect ${item.label}`}
  title={`Unselect ${item.label}`}
  onClick={(event) => {
    clearTutorialPreview();

    if (event.shiftKey) {
      handleFacetShiftClick(group, item.key, true);
    } else if (group === "Properties") {
      handlePropertyCheckboxChange(item.key, false);
    } else {
      handleRoleCheckboxChange(item.key, false);
    }
  }}
  //className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded bg-black text-white hover:bg-gray-800 disabled:cursor-not-allowed"
  className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded disabled:cursor-not-allowed"
>
  {isFacetExcluded(group, item.key) ? (
    <SquareX className="size-4 rounded-[3px] bg-black text-white overflow-hidden" aria-hidden="true" />
  ) : (
    <SquareCheck className="size-4 rounded-[3px] bg-black text-white overflow-hidden" aria-hidden="true" />
  )}
</button>
									  <div className="min-w-0 flex-1 flex flex-col items-start gap-0">
                                      {group === "Properties" ? (
                                        <Tooltip><TooltipTrigger render={<button
                                          type="button"
                                          className={`min-w-0 break-all text-sm text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "forward" ? "text-purple-700 dark:text-purple-300" : item.count === 0 ? "text-destructive" : ""}`}
                                          onMouseEnter={() => beginFacetHoverPreview(item.key, "forward", item.label, "configure")}
                                          onMouseLeave={clearTutorialPreview}
                                          onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "forward"); }}
                                        >
                                          {item.label}
                                          {autoConfiguredFacetKeys.has(`property::${item.key}`) && (
                                            <Bot className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                          )}
                                        </button>} /><TooltipContent>{`Drill down through ${item.label}`}</TooltipContent></Tooltip>
                                      ) : (
                                        <Tooltip><TooltipTrigger render={<button
                                          type="button"
                                          className={`min-w-0 break-all text-sm text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "reverse" ? "text-purple-700 dark:text-purple-300" : item.count === 0 ? "text-destructive" : ""}`}
                                          onMouseEnter={() => beginFacetHoverPreview(item.key, "reverse", item.label, "configure")}
                                          onMouseLeave={clearTutorialPreview}
                                          onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "reverse"); }}
                                        >
                                          {item.label}
                                          {autoConfiguredFacetKeys.has(`property-in::${item.key}`) && (
                                            <Bot className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                          )}
                                        </button>} /><TooltipContent>{`Filter by role ${item.label}`}</TooltipContent></Tooltip>
                                      )}
                                      {item.example && !(group === "Properties" ? activePropertyFilters : activeRoleFilters).some((node) => node.attributes.iri === item.key && node.children.some((child) => child.name === "value")) && <button type="button" title={item.example.label} disabled={facetListStale || item.example.termType !== "uri"} onClick={() => showClassResults(item.example!.uri, activeLeafId)} className="block break-words text-[10px] leading-4 text-muted-foreground italic hover:text-foreground hover:underline disabled:cursor-not-allowed"><em>e.g.</em> {ellipsize(item.example.label)}</button>}
									  </div>
                                      <span className="shrink-0 text-xs text-muted-foreground">{item.count === null
                                        ? <DistinctCount tree={queryTree} kind={group === "Properties" ? "property" : "role"} uri={item.key} />
                                        : shortenCount(item.count)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                          {(group === "Properties" ||
                            group === "Classes" ||
                            group === "Roles") &&
                            (group === "Properties" || group === "Roles" ? unselectedItems.length : items.length) > FACET_PAGE_SIZE && (
                              <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs">
                                <button
                                  type="button"
                                  className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() =>
                                    setPage((page) => Math.max(0, page - 1))
                                  }
                                  disabled={currentPage === 0}
                                >
                                  Previous
                                </button>
                                <span className="text-muted-foreground">
                                  {formatPagePosition(Math.min(currentPage, pageCount - 1), pageCount)}
                                </span>
                                <button
                                  type="button"
                                  className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() =>
                                    setPage((page) =>
                                      Math.min(pageCount - 1, page + 1),
                                    )
                                  }
                                  disabled={currentPage >= pageCount - 1}
                                >
                                  Next
                                </button>
                              </div>
                            )}

                          <div className={group === "Properties" || group === "Roles" ? PROPERTY_ROLE_ITEM_GAP_CLASS : FACET_ITEM_GAP_CLASS}>
                            {pageItems.map((item) => {
                              const itemExample = exampleForFacetItem(item.key, item.example);
                              const countKind: DistinctCountKind | null =
                                group === "Properties" ? "property" : group === "Roles" ? "role" : group === "Classes" ? "class" : null;
                              const countQuery = countKind ? distinctCountQueryFor(queryTree, countKind, item.key) : null;
                              const isZeroCount = countQuery ? facetCandidateCounts[countQuery] === 0 : item.count === 0;
                              const isExcluded = group === "Properties" || group === "Classes" || group === "Roles"
                                ? isFacetExcluded(group, item.key)
                                : false;
                              return (
                              <div
                                key={item.key}
                                aria-disabled={facetListStale || undefined}
								onMouseEnter={() => {
  if (group === "Properties" || group === "Roles") {
    setHoveredFacetKey(item.key);
  }
}}
onMouseLeave={() => {
  if (group === "Properties" || group === "Roles") {
    setHoveredFacetKey(null);
  }
}}
                                className={`flex w-full items-start gap-2 rounded-md border px-2 ${group === "Properties" || group === "Roles" ? "py-[1px]" : "py-0.5"} text-sm hover:bg-accent/50 ${facetListStale ? "opacity-45" : ""} ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && ((group === "Properties" && facetHoverPreview.direction === "forward") || (group === "Roles" && facetHoverPreview.direction === "reverse")) ? "!border-purple-500" : "border-transparent"}`}
                              >
                                {group === "Graphs" ? (
                                  <input
                                    type="radio"
                                    name="maestro-query-graph"
                                    checked={queryTree.attributes.graph === item.key}
                                    onChange={() => bindGraph(item.key)}
                                    aria-label={`Bind graph ${item.label}`}
                                    className="size-4 shrink-0 accent-current"
                                  />
                                ) : group === "Properties" || group === "Roles" ? (
  <button
    type="button"
    disabled={facetListStale}
    aria-invalid={isZeroCount ? true : undefined}
    aria-label={`Filter by ${item.label}`}
    title={`Filter by ${item.label}`}
    onClick={(event) => {
      clearTutorialPreview();

      if (event.shiftKey) {
        handleFacetShiftClick(group, item.key, false);
      } else if (group === "Properties") {
        handlePropertyCheckboxChange(item.key, true);
      } else {
        handleRoleCheckboxChange(item.key, true);
      }
    }}
    //className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-black hover:bg-black hover:text-white disabled:cursor-not-allowed"
	className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded disabled:cursor-not-allowed"
  >
    {shiftKeyDown && hoveredFacetKey === item.key ? (
      <SquareX className="size-4 rounded bg-black text-white" aria-hidden="true" />
    ) : (
      <SquarePlus className="size-4 rounded text-black hover:bg-black hover:text-white" aria-hidden="true" />
    )}
  </button>
) : group === "Classes" ? (
  <input
    type="checkbox"
    disabled={facetListStale}
    aria-invalid={isZeroCount ? true : undefined}
    checked={selectedClasses.has(item.key)}
    data-excluded={isFacetExcluded("Classes", item.key) ? "true" : undefined}
    onClick={(event) => {
      if (event.shiftKey) {
        event.preventDefault();
        handleFacetShiftClick("Classes", item.key, selectedClasses.has(item.key));
      }
    }}
    onChange={(event) => toggleClass(item.key, event.currentTarget.checked)}
    aria-label={`Filter by ${item.label}`}
    className="size-4 shrink-0 accent-current"
  />
                                ) : null}
								<div className="min-w-0 flex-1 flex flex-col items-start gap-0">
                                {group === "Properties" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 break-all text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "forward" ? "text-purple-700 dark:text-purple-300" : isZeroCount ? "text-destructive" : ""}`}
                                    onMouseEnter={() => beginFacetHoverPreview(item.key, "forward", item.label, "configure")}
                                    onMouseLeave={clearTutorialPreview}
                                    onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "forward"); }}
                                  >
                                    {item.label}
                                  </button>} /><TooltipContent>{`Drill down through ${item.label}`}</TooltipContent></Tooltip>
                                ) : group === "Roles" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 break-all text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "reverse" ? "text-purple-700 dark:text-purple-300" : isZeroCount ? "text-destructive" : ""}`}
                                    onMouseEnter={() => beginFacetHoverPreview(item.key, "reverse", item.label, "configure")}
                                    onMouseLeave={clearTutorialPreview}
                                    onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "reverse"); }}
                                  >
                                    {item.label}
                                  </button>} /><TooltipContent>{`Filter by role ${item.label}`}</TooltipContent></Tooltip>
                                ) : group === "Classes" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}
                                    onClick={() => {
                                      if (!selectedClasses.has(item.key)) toggleClass(item.key, true);
                                      showClassResults(item.key, activeLeafId);
                                    }}
                                  >
                                    {toLabel(item.key)}
                                  </button>} /><TooltipContent>{`Show results for class ${toLabel(item.key)}`}</TooltipContent></Tooltip>
                                ) : group === "Graphs" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => bindGraph(item.key)}
                                  >
                                    {item.label}
                                  </button>} /><TooltipContent>{`Bind graph ${item.key}`}</TooltipContent></Tooltip>
                                ) : (
                                  <span className="min-w-0 flex-1 break-all">{item.label}</span>
                                )}
                                {(group === "Properties" || group === "Roles") && itemExample && <button type="button" title={itemExample.label} disabled={facetListStale || itemExample.termType !== "uri"} onClick={() => showClassResults(itemExample.uri, activeLeafId)} className="max-w-full break-words text-left text-[10px] leading-4 text-muted-foreground italic hover:text-foreground hover:underline disabled:cursor-not-allowed"><em>{(group === "Properties" ? activePropertyFilters : activeRoleFilters).some((node) => node.attributes.iri === item.key && node.children.some((child) => child.name === "value")) ? "i.e." : "e.g."}</em> {ellipsize(itemExample.label)}</button>}
								</div>
                                {(group === "Properties" ||
                                  group === "Roles") && (
                                  <span className="shrink-0 text-xs text-muted-foreground">{shortenCount(item.count)}</span>
                                )}
                                {group === "Classes" && (
  <span className="shrink-0 text-xs text-muted-foreground">
    {shortenCount(item.count)}
  </span>
)}
                              </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </>
                )}
</>;
}
