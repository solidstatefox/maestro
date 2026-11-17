"use client";
import { MAESTRO_KIND_IDS, getMaestroKindsRevision, subscribeMaestroKinds } from "@/lib/maestro-kinds";
import { browserLog } from "@/lib/maestro-client-logging";

import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { readMaestroWidgetTimeouts } from "@/lib/maestro-query-timeouts";

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

import { buildFctCountSparql, buildFctKindAvailabilitySparql } from "@/lib/fct-count-sparql";

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useFctQuery, fctQueryTreeApi } from "@/lib/fct-query-api";
import { OrUidLabel } from "@/components/ui/or-uid-label";
import { LeftWidgetButtonTray } from "@/components/ui/left-widget-button-tray";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { serializeFctQuery } from "@/lib/fct-query-api";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Bot, SquarePlus, SquareX, SquareCheck, Split, Code2 } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { formatPagePosition } from "@/canvas/utils/pagination";

import { createDistinctCountQuery } from "@/lib/fct-query-api";
import type { DistinctCountKind } from "@/lib/fct-query-api";
import type { ConfigurePaneWorkspace } from "@/canvas/controllers/workspace-interfaces";
import { createMaestroConfigureController, selectConfigure } from "@/lib/app-lifecycle/configure";
import { createMaestroKindDiscoveryController, selectKinds } from "@/lib/app-lifecycle/kind-discovery";

export function ConfigureWorkspaceContent({ workspace }: { workspace: ConfigurePaneWorkspace }) {
  const { tree: liveQuery, replaceTree: replaceLiveQuery } = useFctQuery();
  const [configureController] = useState(createMaestroConfigureController);
  const configureSnapshot = useSyncExternalStore(configureController.subscribe, configureController.getSnapshot, configureController.getSnapshot);
  const transaction = selectConfigure(configureSnapshot);
  const orEditing = transaction.group;
  const draftMembership = transaction.membership;
  const orPopupFor = transaction.menuFor;
  const sourceKey = serializeFctQuery(liveQuery);
  useEffect(() => {
    workspace.reportConfigureLifecycle(transaction.phase);
    return () => workspace.reportConfigureLifecycle("idle");
  }, [workspace.reportConfigureLifecycle, transaction.phase]);
  useLayoutEffect(() => {
    configureController.start();
    return () => configureController.stop();
  }, [configureController]);
  // An external breadcrumb, History, or URL restore invalidates the entire draft.
  useLayoutEffect(() => {
    configureController.send({ type: "SOURCE_CHANGED", sourceKey });
  }, [configureController, sourceKey]);
  const orCounter = liveQuery.attributes.uctr || "a";
  const orQuotaExceeded = parseInt(orCounter, 36) > 36;
  // Draft OR selections are intentionally isolated from the authoritative FCT tree.
  // A single replaceTree on Update preserves one query revision/History entry.
  const existingOrGroups = [...new Set([...workspace.activePropertyFilters, ...workspace.activeRoleFilters]
    .map(node => node.attributes.uid).filter((uid): uid is string => Boolean(uid)))].sort();
  const selectedOrNode = (group: "Properties" | "Roles", iri: string) =>
    (group === "Properties" ? workspace.activePropertyFilters : workspace.activeRoleFilters)
      .find(node => node.name === (group === "Properties" ? "property" : "property-of") && node.attributes.iri === iri);
  const orDraftKey = (group: "Properties" | "Roles", iri: string) =>
    selectedOrNode(group, iri)?.id ?? `${group === "Properties" ? "property" : "property-of"}:${iri}`;
  const effectiveOrId = (group: "Properties" | "Roles", iri: string) => {
    const node = selectedOrNode(group, iri);
    const key = orDraftKey(group, iri);
    return Object.prototype.hasOwnProperty.call(draftMembership, key)
      ? draftMembership[key] : node?.attributes.uid;
  };
  const beginOrGroup = (group: "Properties" | "Roles") => {
    if (orQuotaExceeded) return;
    configureController.send({ type: "BEGIN", group, sourceKey });
  };
  const assignOrNode = (group: "Properties" | "Roles", iri: string, uid: string | null) => {
    const key = orDraftKey(group, iri);
    configureController.send({ type: "ASSIGN", key, uid });
  };
  const selectOrNode = (group: "Properties" | "Roles", iri: string) => {
    if (orEditing !== group) return;
    const key = orDraftKey(group, iri);
    const uid = effectiveOrId(group, iri);
    if (uid) { assignOrNode(group, iri, null); return; }
    if (existingOrGroups.length > 1) { configureController.send({ type: "MENU", key }); return; }
    assignOrNode(group, iri, existingOrGroups[0] ?? orCounter);
  };
  const commitOrGroup = () => {
    if (!orEditing || orQuotaExceeded || transaction.phase !== "editing") return;
    if (sourceKey !== transaction.sourceKey) {
      configureController.send({ type: "SOURCE_CHANGED", sourceKey });
      return;
    }
    const changes = draftMembership;
    if (Object.keys(changes).length === 0) { configureController.send({ type: "CANCEL" }); return; }
    configureController.send({ type: "COMMIT", sourceKey });
    const direction = orEditing === "Properties" ? "property" : "property-of";
    try {
    // Configure may contain selected rows which are only staged, not yet
    // represented by relationship nodes. Materialize them on Update in the
    // active FCT scope, never during selection clicks.
    let next = liveQuery;
    for (const [key, uid] of Object.entries(changes)) {
      if (!uid || !key.startsWith(`${direction}:`)) continue;
      const iri = key.slice(direction.length + 1);
      if (direction === "property") next = fctQueryTreeApi.addProperty(next, iri);
      else next = fctQueryTreeApi.setRoleFilter(next, iri, true);
    }
    const byIri = new Map(Object.entries(changes).filter(([key]) => key.startsWith(`${direction}:`))
      .map(([key, value]) => [key.slice(direction.length + 1), value]));
    // Synthetic keys are scoped to the current view siblings. A property with
    // the same IRI at a different breadcrumb must never inherit this OR UID.
    const findViewScope = (nodes: typeof next.children): typeof next.children | null => {
      if (nodes.some(node => node.name === "view")) return nodes;
      for (const node of nodes) {
        const nested = findViewScope(node.children);
        if (nested) return nested;
      }
      return null;
    };
    const scopeIds = new Set((findViewScope(next.children) ?? []).map(node => node.id));
    const apply = (nodes: typeof next.children): typeof next.children => nodes.map(node => {
      const attributes = { ...node.attributes };
      if (node.name === direction) {
        const hasNodeChange = Object.prototype.hasOwnProperty.call(changes, node.id);
        const hasIriChange = scopeIds.has(node.id) && byIri.has(node.attributes.iri ?? "");
        if (hasNodeChange || hasIriChange) {
          const uid = hasNodeChange ? changes[node.id] : byIri.get(node.attributes.iri ?? "");
          if (uid) attributes.uid = uid;
          else delete attributes.uid;
        }
      }
      return { ...node, attributes, children: apply(node.children) };
    });
    const newIdUsed = Object.values(changes).includes(orCounter);
    replaceLiveQuery({ ...next,
      attributes: { ...next.attributes, uctr: (parseInt(orCounter, 36) + (newIdUsed ? 1 : 0)).toString(36) },
      children: apply(next.children),
    });
    configureController.send({ type: "COMMITTED" });
    } catch (error) {
      configureController.send({ type: "COMMIT_FAILED", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const {
    FACET_PAGE_SIZE,
    configurePropertyKind, setConfigurePropertyKind, configureRoleKind, setConfigureRoleKind,
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
    configureSelectedProperties: selectedProperties,
    configureSelectedRoles: selectedRoles,
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
  const [kindController] = useState(createMaestroKindDiscoveryController);
  const [kindRetry, setKindRetry] = useState(0);
  const kindsRevision = useSyncExternalStore(subscribeMaestroKinds, getMaestroKindsRevision, getMaestroKindsRevision);
  const kindSnapshot = useSyncExternalStore(kindController.subscribe, kindController.getSnapshot, kindController.getSnapshot);
  const kindScopeXml = serializeFctQuery(queryTree);
  const kindKey = defaultLeftTab === "facets" ? `${kindScopeXml}::patterns-${kindsRevision}::retry-${kindRetry}` : "";
  const kindState = selectKinds(kindSnapshot, kindKey);
  const checkingKinds = kindState.loading;
  const kindAvailability = kindState.availability;
  useEffect(() => { kindController.start(); return () => kindController.stop(); }, [kindController]);
  useEffect(() => {
    if (!kindKey) { kindController.clear(); return; }
    const snapshotTree = JSON.parse(JSON.stringify(queryTree));
    const address = queryTree.attributes.addr;
    kindController.execute(kindKey, async signal => {
      const timeoutMs = readMaestroWidgetTimeouts().kinds * 1000;
      const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
      const requestSignal = timeout ? AbortSignal.any([signal, timeout]) : signal;
      // Client owns Kind SPARQL generation using the in-memory RDF projection
      // populated once at login. The untouched /sparql route is only the transport.
      const entries = await Promise.all((["property", "role"] as const).map(async direction => {
        async function run(query: string): Promise<{ results?: {bindings?: Array<{maestroKind?:{value?:string}}>};boolean?:boolean;error?:string;incomplete?:boolean }> {
          const response = await maestroQueryFetch("/proxy/api/sparql", {
            method: "POST", signal: requestSignal, cache: "no-store",
            headers: { "Content-Type": "application/json", "X-Maestro-Query-Label": `Configure:Kinds:${direction}`,
              ...(timeoutMs ? { "X-Maestro-Query-Timeout-Ms": String(timeoutMs) } : {}) },
            body: JSON.stringify({ addr: address, query }),
          });
          const data = await response.json() as { results?: {bindings?: Array<{maestroKind?:{value?:string}}>};boolean?:boolean;error?:string;incomplete?:boolean };
          if (!response.ok || data.incomplete) throw new Error(data.error || `Kind discovery HTTP ${response.status}`);
          return data;
        }
        const query = buildFctKindAvailabilitySparql(snapshotTree, direction);
        if (!query) throw new Error(`Cannot compile ${direction} Kind scope.`);
        try {
          const batch = await run(query);
          if (Array.isArray(batch.results?.bindings)) {
            const found = new Set(batch.results.bindings.map(row => row.maestroKind?.value).filter((value): value is string => Boolean(value)));
            return [direction, MAESTRO_KIND_IDS.filter(kind => found.has(kind))] as const;
          }
        } catch (error) {
          if (requestSignal.aborted) throw error;
          // Older Virtuoso endpoints may reject the VALUES/EXISTS batching
          // idiom. Fall back to normal client-generated ASK queries.
          browserLog.warn("configure.kinds.batch-fallback", error);
        }
        const checks = await Promise.allSettled(MAESTRO_KIND_IDS.map(async kind => {
          const ask = buildFctKindAvailabilitySparql(snapshotTree, direction, kind);
          if (!ask) throw new Error(`Cannot compile ${kind} preflight.`);
          return (await run(ask)).boolean ? kind : null;
        }));
        const success = checks.filter(check => check.status === "fulfilled");
        if (!success.length) {
          const first = checks.find(check => check.status === "rejected");
          throw first && first.status === "rejected" ? first.reason : new Error("Kind availability queries failed.");
        }
        const found = success.flatMap(check => check.status === "fulfilled" && check.value ? [check.value] : []);
        return [direction, found] as const;
      }));
      return Object.fromEntries(entries) as { property: string[]; role: string[] };
    });
  }, [kindController, kindKey, queryTree.attributes.addr]);
  const availableKinds = (direction: "property" | "role", selected: string) => {
    const known = MAESTRO_KIND_IDS;
    const found = kindAvailability?.[direction];
    // Keep any selected kind visible until the user changes it.
    return known.filter(kind => !found || found.includes(kind) || kind === selected);
  };
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
                            {(group === "Properties" || group === "Roles") && checkingKinds && <span role="status" className="shrink-0 text-xs text-white/90"><ElapsedStatus label="Kinds" category="kinds" /></span>}
                            {(group === "Properties" || group === "Roles") && kindState.error && !checkingKinds && <button type="button" className="rounded border border-white/50 px-2 py-1 text-xs text-white" title={kindState.error} onClick={() => setKindRetry(value => value + 1)}>Kinds unavailable</button>}
                            {(group === "Properties" || group === "Roles") && kindState.ready && !checkingKinds && <select
                              aria-label={`${group} object kind`}
                              aria-busy={false}
                              value={group === "Properties" ? configurePropertyKind : configureRoleKind}
                              onChange={event => group === "Properties" ? setConfigurePropertyKind(event.target.value) : setConfigureRoleKind(event.target.value)}
                              className={`max-w-32 rounded border border-white/40 bg-transparent px-1 py-1 text-xs text-white ${((group === "Properties" ? configurePropertyKind : configureRoleKind) === "all") ? "opacity-0 group-hover/header:opacity-100 focus:opacity-100" : ""}`}
                            >
                              {["all", ...availableKinds(group === "Properties" ? "property" : "role", group === "Properties" ? configurePropertyKind : configureRoleKind)].map(kind => <option key={kind} className="bg-background text-foreground" value={kind}>{kind === "all" ? "All kinds" : kind}</option>)}
                            </select>}
                            {group === "Properties" && <LeftWidgetButtonTray threshold={3} actions={[{
                              id: "add-or-properties", label: orQuotaExceeded ? "Disjunction quota exceeded" : "Add OR", icon: <Split className="size-4" />,
                              when: selectedItems.length > 0 && orEditing !== "Properties", disabled: orQuotaExceeded || facetListStale,
                              onSelect: () => beginOrGroup("Properties"),
                            }, {
                              id: "inspect-properties", label: "Inspect Properties query", icon: <Code2 className="size-4" />,
                              render: <QueryInspectorButton
                                query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES)}\n<!-- FCT API option: view=properties -->`}
                                filename="properties-fct-query.xml"
                                label="View Properties widget query"
                                headerTone
                                countQuery={propertyFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "property", propertyFacets[0].uri, undefined, undefined, FCT_VIEW_TYPES.PROPERTIES)) : undefined}
                                countFilename="properties-first-item-count.sparql"
                              />,
                              }]} />}
                            {group === "Roles" && <LeftWidgetButtonTray threshold={3} actions={[{
                              id: "add-or-roles", label: orQuotaExceeded ? "Disjunction quota exceeded" : "Add OR", icon: <Split className="size-4" />,
                              when: selectedItems.length > 0 && orEditing !== "Roles", disabled: orQuotaExceeded || facetListStale,
                              onSelect: () => beginOrGroup("Roles"),
                            }, {
                              id: "inspect-roles", label: "Inspect Roles query", icon: <Code2 className="size-4" />,
                              render: <QueryInspectorButton
                                query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES_IN)}\n<!-- FCT API option: view=properties-in -->`}
                                filename="roles-fct-query.xml"
                                label="View Roles widget query"
                                headerTone
                                countQuery={roleFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "role", roleFacets[0].uri, undefined, undefined, FCT_VIEW_TYPES.PROPERTIES_IN)) : undefined}
                                countFilename="roles-first-item-count.sparql"
                              />,
                              }]} />}
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
                                <div className="mb-1 flex items-center justify-between gap-2 px-1">
                                  <span className={`text-xs font-medium ${orEditing === group ? "text-foreground" : "text-muted-foreground"}`}>
                                    {orEditing === group ? <>Selected · <span className="rounded bg-accent px-1.5 py-0.5 font-semibold">Add OR</span></> : "Selected"}
                                  </span>

                                </div>
                                <div className={PROPERTY_ROLE_ITEM_GAP_CLASS}>
                                  {selectedItems.map((item) => (
                                    <div
                                      key={item.key}
                                      onClick={(event) => {
                                        if (orEditing !== group || facetListStale || (event.target as HTMLElement).closest('[role="menu"]')) return;
                                        clearTutorialPreview();
                                        selectOrNode(group, item.key);
                                      }}
                                      onKeyDown={(event) => {
                                        if (orEditing !== group || facetListStale || event.target !== event.currentTarget) return;
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault(); selectOrNode(group, item.key);
                                        }
                                      }}
                                      role={orEditing === group ? "button" : undefined}
                                      tabIndex={orEditing === group && !facetListStale ? 0 : undefined}
                                      aria-label={orEditing === group ? `${effectiveOrId(group, item.key) ? "Remove from" : "Add to"} OR condition: ${item.label}` : undefined}
                                      className={`relative flex w-full min-w-0 items-start gap-2 rounded px-1.5 py-1 ${orEditing === group ? "cursor-pointer hover:bg-accent/70 focus-within:bg-accent/70" : ""} ${orEditing === group && effectiveOrId(group, item.key) ? "bg-accent/60 ring-1 ring-ring/30" : ""} ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && ((group === "Properties" && facetHoverPreview.direction === "forward") || (group === "Roles" && facetHoverPreview.direction === "reverse")) ? "!border-purple-500" : "border-transparent"}`}
                                    >
                                      {orEditing !== group && <button
  type="button"
  disabled={facetListStale}
  data-excluded={isFacetExcluded(group, item.key) ? "true" : undefined}
  aria-invalid={item.count === 0 ? true : undefined}
  aria-label={`Unselect ${item.label}`}
  title={`Unselect ${item.label}`}
  onClick={(event) => {
    clearTutorialPreview();

    if (orEditing === group) {
      selectOrNode(group as "Properties" | "Roles", item.key);
    } else if (event.shiftKey) {
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
</button>}
									  <div className="min-w-0 flex-1 flex flex-col items-start gap-0">
                                      {group === "Properties" ? (
                                        <Tooltip><TooltipTrigger render={<button
                                          type="button"
                                          className={`min-w-0 break-all text-sm text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "forward" ? "text-purple-700 dark:text-purple-300" : item.count === 0 ? "text-destructive" : ""}`}
                                          onMouseEnter={() => beginFacetHoverPreview(item.key, "forward", item.label, "configure")}
                                          onMouseLeave={clearTutorialPreview}
                                          onClick={(event) => { clearTutorialPreview(); if (orEditing === group) return; navigateIntoRelationship(item.key, "forward"); }}
                                        >
                                          <OrUidLabel uid={orEditing === group ? effectiveOrId("Properties", item.key) ?? undefined : activePropertyFilters.find(n => n.attributes.iri === item.key)?.attributes.uid}>{item.label}</OrUidLabel>
                                          {autoConfiguredFacetKeys.has(`property::${item.key}`) && (
                                            <Bot className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                          )}
                                        </button>} /><TooltipContent>{orEditing === group ? (effectiveOrId("Properties", item.key) ? "Remove from OR condition" : "Add to OR condition") : `Drill down through ${item.label}`}</TooltipContent></Tooltip>
                                      ) : (
                                        <Tooltip><TooltipTrigger render={<button
                                          type="button"
                                          className={`min-w-0 break-all text-sm text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "reverse" ? "text-purple-700 dark:text-purple-300" : item.count === 0 ? "text-destructive" : ""}`}
                                          onMouseEnter={() => beginFacetHoverPreview(item.key, "reverse", item.label, "configure")}
                                          onMouseLeave={clearTutorialPreview}
                                          onClick={(event) => { clearTutorialPreview(); if (orEditing === group) return; navigateIntoRelationship(item.key, "reverse"); }}
                                        >
                                          <OrUidLabel uid={orEditing === group ? effectiveOrId("Roles", item.key) ?? undefined : activeRoleFilters.find(n => n.attributes.iri === item.key)?.attributes.uid}>{item.label}</OrUidLabel>
                                          {autoConfiguredFacetKeys.has(`property-in::${item.key}`) && (
                                            <Bot className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                          )}
                                        </button>} /><TooltipContent>{orEditing === group ? (effectiveOrId("Roles", item.key) ? "Remove from OR condition" : "Add to OR condition") : `Filter by role ${item.label}`}</TooltipContent></Tooltip>
                                      )}
                                      {orEditing !== group && item.example && !(group === "Properties" ? activePropertyFilters : activeRoleFilters).some((node) => node.attributes.iri === item.key && node.children.some((child) => child.name === "value")) && <button type="button" title={item.example.label} disabled={facetListStale || item.example.termType !== "uri"} onClick={() => showClassResults(item.example!.uri, activeLeafId)} className="block break-words text-[10px] leading-4 text-muted-foreground italic hover:text-foreground hover:underline disabled:cursor-not-allowed"><em>e.g.</em> {ellipsize(item.example.label)}</button>}
									  </div>
                                      <span className="shrink-0 px-1 text-xs text-muted-foreground">{item.count === null
                                        ? <DistinctCount tree={queryTree} kind={group === "Properties" ? "property" : "role"} uri={item.key} />
                                        : shortenCount(item.count)}</span>
                                      {orEditing === group && orPopupFor === orDraftKey(group, item.key) &&
                                        <div role="menu" aria-label="Select OR condition" className="absolute right-0 top-full z-30 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                                          {existingOrGroups.map(uid => <button role="menuitem" key={uid} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={(event) => { event.stopPropagation(); assignOrNode(group, item.key, uid); }}><OrUidLabel uid={uid}>{`Join OR ${uid.toUpperCase()}`}</OrUidLabel></button>)}
                                          <button role="menuitem" type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={(event) => { event.stopPropagation(); assignOrNode(group, item.key, orCounter); }}>New OR condition</button>
                                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent" onClick={(event) => { event.stopPropagation(); configureController.send({ type: "MENU", key: null }); }}>Cancel</button>
                                        </div>}
                                    </div>
                                  ))}
                                </div>
                                {orEditing === group && transaction.error && <p role="alert" className="mt-2 text-xs text-destructive">{transaction.error}</p>}
                                {orEditing === group && <div className="mt-2 flex justify-end gap-2 border-t pt-2">
                                  <button type="button" className="rounded border px-2 py-1 text-xs hover:bg-accent" onClick={commitOrGroup}>Update</button>
                                  <button type="button" className="rounded border px-2 py-1 text-xs hover:bg-accent" onClick={() => configureController.send({ type: "CANCEL" })}>Close</button>
                                </div>}
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
                                  </button>} /><TooltipContent>{orEditing === group ? (effectiveOrId("Properties", item.key) ? "Remove from OR condition" : "Add to OR condition") : `Drill down through ${item.label}`}</TooltipContent></Tooltip>
                                ) : group === "Roles" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 break-all text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "reverse" ? "text-purple-700 dark:text-purple-300" : isZeroCount ? "text-destructive" : ""}`}
                                    onMouseEnter={() => beginFacetHoverPreview(item.key, "reverse", item.label, "configure")}
                                    onMouseLeave={clearTutorialPreview}
                                    onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "reverse"); }}
                                  >
                                    {item.label}
                                  </button>} /><TooltipContent>{orEditing === group ? (effectiveOrId("Roles", item.key) ? "Remove from OR condition" : "Add to OR condition") : `Filter by role ${item.label}`}</TooltipContent></Tooltip>
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
