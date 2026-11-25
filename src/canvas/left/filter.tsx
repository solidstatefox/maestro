"use client";
import { browserLog } from "@/lib/maestro-client-logging";

import { ErrorDetails } from "@/components/ui/error-details";
import { FacetItemDecoration } from "@/lib/facet-decoration-contract";
import { readAutoConfiguredFacetKeys, type FacetAutofillCandidates, type AutoConfiguredFacetKey } from "@/canvas/left/configure";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";
import { findGroupCarrier } from "@/lib/fct-groups-carrier";
import { toLabel, rememberShortforms } from "@/lib/uri-labels";
import { proxyDebugHeaders, proxyDebugFingerprint } from "@/lib/proxy-debug";
import { UI_COMPONENT, dynamicUiComponentUrn } from "@/lib/maestro-ui-component-ids";
import { buildFctCountSparql } from "@/lib/fct-count-sparql";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { cachedFetchFct, maestroQueryFetch } from "@/lib/client-query-cache";
import { setMaestroIncompleteResults } from "@/lib/maestro-incomplete-results";
import { componentRetryHeaders, useMaestroComponentRetry } from "@/lib/maestro-component-retry";
import { resetMaestroQueryExecutionScope } from "@/lib/maestro-query-execution-clock";
import { watchPersonalFacetDeadline } from "@/lib/personal-facet-deadline";
import { configuredTimeoutMs } from "@/lib/maestro-query-timeouts";
import { shortenCount } from "@/lib/utils";
import { useFctQuery, serializeFctQuery, createPersonalFacetValuesQuery, createDistinctCountQuery } from "@/lib/fct-query-api";
import type { FctQueryTree, FctQueryNode, DistinctCountKind } from "@/lib/fct-query-api";
import { readFctResponse, presentServerError, groupValueBinding, fctTermKey, facetValueKey, countedFacetValues, facetMembershipCount, type FctResult, type RelationshipDirection } from "@/canvas/utils/fct-response";


export type FacetItem = {
  uri: string;
  label: string;
  count: number;
  /** Immediate superclass, present on rows of a tree="yes" classes view (one row per parent). */
  parent?: string;
  example?: { uri: string; label: string; termType?: "uri" | "literal" | "bnode" };
};

export function createFacetItem(
  uri: string,
  label: string,
  count: number | null | undefined = 0,
  example?: FacetItem["example"],
): FacetItem {
  return {
    uri,
    label,
    count: count ?? 0,
    ...(example ? { example } : {}),
  };
}


export type FacetName = string;

export type OntologyClassMetadata = { uri: string; ontology: string; parent?: string; ontologyLabel?: string };
export type CategoryTreeNode = { item: FacetItem; children: CategoryTreeNode[] };

/** At most this many distinct leaf categories are listed on one page of the Categories tree. */
export const CATEGORY_TREE_LEAVES_PER_PAGE = 10;
/** A node is identified by its path, because a class with several parents appears once under each. */
export const categoryTreeNodeKey = (parentKey: string, uri: string) => (parentKey ? `${parentKey}\u0000${uri}` : uri);

/** Every node that has children (the ones that can be collapsed), by path key. */
export function collectCategoryTreeParentKeys(roots: CategoryTreeNode[]): string[] {
  const keys: string[] = [];
  const visit = (node: CategoryTreeNode, parentKey: string) => {
    const key = categoryTreeNodeKey(parentKey, node.item.uri);
    if (node.children.length > 0) { keys.push(key); node.children.forEach((child) => visit(child, key)); }
  };
  roots.forEach((root) => visit(root, ""));
  return keys;
}

/**
 * Split the tree into pages holding at most CATEGORY_TREE_LEAVES_PER_PAGE distinct leaf categories each.
 * Leaves are taken in tree order; a page shows its leaves together with the ancestor path leading to each
 * of them, so a subtree larger than one page continues on the next page under the same ancestors.
 */
export function paginateCategoryTree(roots: CategoryTreeNode[]): CategoryTreeNode[][] {
  const pageLeaves: Array<Set<string>> = [new Set()];
  const pagesOfNode = new Map<string, Set<number>>();
  const assign = (node: CategoryTreeNode, parentKey: string): Set<number> => {
    const key = categoryTreeNodeKey(parentKey, node.item.uri);
    const pages = new Set<number>();
    if (node.children.length === 0) {
      let current = pageLeaves[pageLeaves.length - 1];
      if (!current.has(node.item.uri) && current.size >= CATEGORY_TREE_LEAVES_PER_PAGE) { current = new Set(); pageLeaves.push(current); }
      current.add(node.item.uri);
      pages.add(pageLeaves.length - 1);
    } else {
      for (const child of node.children) assign(child, key).forEach((page) => pages.add(page));
    }
    pagesOfNode.set(key, pages);
    return pages;
  };
  roots.forEach((root) => assign(root, ""));
  const prune = (node: CategoryTreeNode, parentKey: string, page: number): CategoryTreeNode | null => {
    const key = categoryTreeNodeKey(parentKey, node.item.uri);
    if (!pagesOfNode.get(key)?.has(page)) return null;
    return { item: node.item, children: node.children.flatMap((child) => prune(child, key, page) ?? []) };
  };
  if (roots.length === 0) return [[]];
  return pageLeaves.map((_, page) => roots.flatMap((root) => prune(root, "", page) ?? []));
}



const FACET_ITEM_GAP_CLASS = "space-y-0.5";

import type { TransportedFacet } from "@/lib/fct-facet-alias";
import { activeTransportedFacets } from "@/lib/fct-facet-alias";

export type PersonalWidget = {
  /** Unique occurrence key, distinct from a repeated RDF predicate URI. */
  key?: string;
  /** Alias metadata passed through the SAME Personal widget pipeline. */
  anchor?: TransportedFacet;
  /** Exact XML submitted by the ordinary Personal listener. */
  valuesQueryXml?: string;
  valuesQuerySparql?: string;
  uri: string;
  label: string;
  excluded: boolean;
  values: FctResult[];
  datatypeEvidence?: string[];
  /** Exact live FCT query whose complete facet population produced the evidence. */
  datatypeEvidenceScope?: string;
  selectedValues: string[];
  page: number;
  loading: boolean;
  error: string;
};


export type ScopeRelationship = { uri: string; direction: RelationshipDirection };
export type GroupByOption = ScopeRelationship & { key: string; label: string; nodeId: string; memberBindingNodeId?: string; ancestorRole?: boolean; anchorId?: string; parentId?: string };

export type GroupMembersState = { results: FctResult[]; count?: number; loading: boolean; error: string };
export type RoleWidgetStatus = { count: number; loading: boolean; error: string; sampleValue?: FctResult; valuesQueryXml?: string; valuesQuerySparql?: string };



/** Build the exact count query used as the identity for a candidate's live-scope count. */
export function distinctCountQueryFor(
  tree: FctQueryTree,
  kind: DistinctCountKind,
  uri: string,
  propertyUri?: string,
  candidateValue?: FctResult,
  valueRelationship?: { direction: "forward" | "reverse"; nodeId?: string; href?: string },
): string {
  const viewType =
    kind === "property" ? FCT_VIEW_TYPES.PROPERTIES
      : kind === "role" ? FCT_VIEW_TYPES.PROPERTIES_IN
        : kind === "class" ? FCT_VIEW_TYPES.CLASSES
          : FCT_VIEW_TYPES.LIST_COUNT;
  return buildFctCountSparql(
    createDistinctCountQuery(tree, kind, uri, propertyUri, candidateValue, viewType, valueRelationship),
  ) ?? "";
}

/** The primary XML tab and this SPARQL tab inspect one counted LIST request. */
export function personalFacetInspectorQueries(valuesXml: string, executedSparql?: string): { id: string; label: string; query: string; filename: string; language: "sparql" }[] {
  let query: string;
  try { query = executedSparql || compileFctXmlToSparql(valuesXml).query; }
  catch (error) { query = `# Unable to compile the facet query: ${error instanceof Error ? error.message : String(error)}`; }
  return [{ id: "personal-list-sparql", label: "SPARQL", query, filename: "personal-values.sparql", language: "sparql" }];
}

/** Reuse complete scalar counts between simultaneous facet mounts (one minute).
 * Keys include addr and exact scoped SPARQL; errors and incomplete counts are
 * never stored. The server cache remains authoritative beyond this window. */
const completedFacetCounts = new Map<string, { count: number; expires: number }>();
const FACET_COUNT_REUSE_MS = 60_000;

/** Each visible item requests its own distinct-row count through the same-origin SPARQL proxy. */
export function DistinctCount({
  tree,
  kind,
  uri,
  propertyUri,
  candidateValue,
  valueRelationship,
  onCountChange,
  enabled = true,
}: {
  tree: FctQueryTree;
  kind: DistinctCountKind;
  uri: string;
  propertyUri?: string;
  candidateValue?: FctResult;
  valueRelationship?: { direction: "forward" | "reverse"; nodeId?: string; href?: string };
  onCountChange?: (query: string, count: number | null) => void;
  enabled?: boolean;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Key this effect by the compiled scalar count query, not the full browsing
  // query. The compiler deliberately ignores <view> limit/offset, so Results
  // pagination does not refetch every facet count.
  const countSparqlQuery = distinctCountQueryFor(
    tree, kind, uri, propertyUri, candidateValue, valueRelationship,
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelled = false;

    async function loadCount() {
      let stage = "building a native FCT distinct count";
      let responseDiagnostics: unknown;
      try {
        if (!countSparqlQuery) {
          throw new Error("The current FCT query tree contains a condition that cannot be compiled safely to SPARQL.");
        }
        stage = "executing FCT count";
        // Reuse a recent verified count for this exact address and query.
        const memoKey = `${tree.attributes.addr ?? ""}\u0000${countSparqlQuery}`;
        const recent = completedFacetCounts.get(memoKey);
        if (recent && recent.expires > Date.now()) {
          if (!cancelled) {
            setCount(recent.count);
            onCountChange?.(countSparqlQuery, recent.count);
          }
          return;
        }
        if (recent) completedFacetCounts.delete(memoKey);
        // Count the native facet projection. Properties, Roles and Categories
        // retain their established countOnly semantics; no SELECT is inspected.
        const viewType = kind === "property" ? FCT_VIEW_TYPES.PROPERTIES
          : kind === "role" ? FCT_VIEW_TYPES.PROPERTIES_IN
          : kind === "class" ? FCT_VIEW_TYPES.CLASSES : FCT_VIEW_TYPES.LIST_COUNT;
        const countTree = createDistinctCountQuery(tree, kind, uri, propertyUri,
          candidateValue, viewType, valueRelationship);
        const countXml = serializeFctQuery(countTree);
        const fctResponse = await maestroQueryFetch("/proxy/api/fct", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("distinct-count-fct", `DistinctCount:${kind}:${propertyUri ?? ""}:${uri}`) },
          body: JSON.stringify({ queryXml: countXml, countOnly: true }),
        });
        const fctData = await readFctResponse(fctResponse);
        responseDiagnostics = { view: fctData.viewType, complete: !fctData.incomplete };
        stage = "validating FCT count response";
        const lexicalCount = fctData.rows[0]?.[0]?.value;
        const parsedCount = lexicalCount?.trim() ? Number(lexicalCount) : NaN;
        if (fctData.incomplete || fctData.viewType !== "count" || !Number.isSafeInteger(parsedCount) || parsedCount < 0)
          throw new Error("FCT returned an incomplete or invalid distinct facet count.");
        if (!cancelled) {
          if (completedFacetCounts.size > 1000) completedFacetCounts.clear();
          completedFacetCounts.set(memoKey, { count: parsedCount, expires: Date.now() + FACET_COUNT_REUSE_MS });
          setCount(parsedCount);
          onCountChange?.(countSparqlQuery, parsedCount);
        }
      } catch (requestError) {
        if (
          cancelled ||
          (requestError instanceof Error && requestError.name === "AbortError")
        )
          return;
        const message = requestError instanceof Error ? requestError.message : "Could not load distinct count.";
        browserLog.warn("facet.item-count.failed", {
          kind,
          uri,
          propertyUri,
          stage,
          error: message,
          component: `DistinctCount:${kind}:${propertyUri ?? ""}:${uri}`,
          sparql: countSparqlQuery,
          proxyResponse: responseDiagnostics,
          cause: requestError instanceof Error ? requestError.cause : undefined,
        });
        setError(`${stage}: ${presentServerError(message)}`);
      }
    }

    // Query-tree edits can be emitted as a short sequence of intermediate states
    // (for example, deleting a bespoke facet). Wait for that sequence to settle so
    // one user action does not issue/flicker through several obsolete count queries.
    browserLog.debug("facet.distinct-count.scheduled", {
      kind,
      uri,
      propertyUri,
      countSparqlLength: countSparqlQuery?.length ?? 0,
      countQueryFingerprint: countSparqlQuery ? proxyDebugFingerprint(countSparqlQuery) : "unsupported-query-tree",
    });
    const refreshTimer = window.setTimeout(() => {
      if (cancelled) return;
      browserLog.debug("facet.distinct-count.started", { kind, uri, propertyUri });
      // Keep the last completed count visible while this independent count query refreshes.
      setError("");
      void loadCount();
    }, 45);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      controller.abort();
      browserLog.debug("facet.distinct-count.cleanup", { kind, uri, propertyUri });
    };
    // The compiled scalar count query is the semantic identity. Results paging,
    // parent object identity, and other non-count UI changes do not restart it.
  }, [countSparqlQuery, enabled]);

  return (
    <Tooltip><TooltipTrigger render={<span
      className={`shrink-0 text-xs ${error || count === 0 ? "text-destructive" : "text-muted-foreground"}`}
      aria-live="polite"
      aria-invalid={count === 0 ? true : undefined}
    >
      {error
        ? "!"
        : count === null
          ? "…"
          : shortenCount(count)}
    </span>} /><TooltipContent>{error
          ? `Could not load distinct count: ${error}`
          : kind === "property"
            ? "Distinct property values"
            : kind === "role"
              ? "Distinct role values"
              : "Distinct results"}</TooltipContent></Tooltip>
  );
}

/** Return property filters that are actual siblings of the active <view>.
 * Scope is represented by the query tree itself: recurse through each node's
 * children until the array containing the active view is found, then inspect
 * only that array. Ancestors on the navigation path are not scope members.
 */
export function getActiveViewPropertyFilters(tree: FctQueryTree): FctQueryNode[] {
  function findViewSiblings(nodes: FctQueryNode[]): FctQueryNode[] | null {
    if (nodes.some((node) => node.name === "view")) return nodes;
    for (const node of nodes) {
      const nested = findViewSiblings(node.children);
      if (nested) return nested;
    }
    return null;
  }
  // A groups view moves <view> into the grouped relationship. The facet
  // widgets still describe the incoming resource selection (the parent scope),
  // NOT the grouped term, so discover them beside the grouping carrier.
  const scope = findViewSiblings(tree.children) ?? [];
  return scope.filter((node) =>
    node.name === "property" && typeof node.attributes.iri === "string" && node.attributes.iri.length > 0,
  );
}

/** Return reverse-property filters attached to the active view's scope only.
 * Ancestor <property-of> nodes are navigation breadcrumbs, not filters for the
 * current result set; every direct <property-of> child of the view scope
 * is a candidate, regardless of how that relationship was introduced.
 */
export function getActiveViewRoleFilters(tree: FctQueryTree): FctQueryNode[] {
  function findViewScope(nodes: FctQueryNode[]): FctQueryNode[] | null {
    for (const node of nodes) {
      if (node.children.some((child) => child.name === "view")) {
        return node.children;
      }
      const nested = findViewScope(node.children);
      if (nested) return nested;
    }
    // The active view can be at the root.
    if (nodes.some((node) => node.name === "view")) return nodes;
    return null;
  }
  const scope = findViewScope(tree.children) ?? [];
  return scope.filter(
    (node) => node.name === "property-of" &&
      typeof node.attributes.iri === "string",
  );
}

/** Personal Roles facets are ONLY the explicit reverse relationships in the
 * current view carrier's children. The carrier itself is the result focus,
 * not a facet, even when it is a <property-of>. */
export function getPersonalRoleFacetNodes(tree: FctQueryTree): FctQueryNode[] {
  return getActiveViewRoleFilters(tree);
}

/** Value-selection lookup may also inspect the carrier's own <value> bindings,
 * but that must never manufacture a facet card. */
function getRoleSelectionNodes(tree: FctQueryTree, uri: string): FctQueryNode[] {
  const facets = getActiveViewRoleFilters(tree).filter(node => node.attributes.iri === uri);
  const findCarrier = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
    for (const node of nodes) {
      if (node.children.some(child => child.name === "view" || child.name === "view")) return node;
      const nested = findCarrier(node.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const carrier = findCarrier(tree.children);
  return carrier?.name === "property-of" && carrier.attributes.iri === uri &&
    !facets.some(node => node.id === carrier.id) ? [carrier, ...facets] : facets;
}

/** The carrier of <view> is the focus, not an extra facet to invent. It can,
 * however, already have an existing Personal widget whose values must survive
 * navigation into that property. Traverse the live tree, not cached labels. */
export function getActiveViewPropertyCarrier(tree: FctQueryTree): FctQueryNode | null {
  const visit = (nodes: FctQueryNode[]): FctQueryNode | null => {
    for (const node of nodes) {
      if (node.children.some(child => child.name === "view")) return node;
      const found = visit(node.children);
      if (found) return found;
    }
    return null;
  };
  return visit(tree.children);
}
export function treeHasPropertyFilter(
  tree: FctQueryTree,
  propertyUri: string,
): boolean {
  const carrier = getActiveViewPropertyCarrier(tree);
  return getActiveViewPropertyFilters(tree).some(node => node.attributes.iri === propertyUri) ||
    Boolean(carrier?.name === "property" && carrier.attributes.iri === propertyUri);
}

/**
 * Canonical Group By ordering, used by BOTH the Results group cards and the Personal facet widget that is being
 * grouped on: facet-equivalent count (column 2) descending, then label. One comparator keeps the two lists in the
 * same order, so a facet value always sits at the same position as its group card.
 */
export function compareGroupValues(a: FctResult, b: FctResult): number {
  const aCount = facetMembershipCount(a) ?? Number(a.columns?.[1]?.value ?? 0);
  const bCount = facetMembershipCount(b) ?? Number(b.columns?.[1]?.value ?? 0);
  return bCount - aCount || (a.title || a.uri).localeCompare(b.title || b.uri);
}

/** Each widget owns a real subscription to the authoritative query store. */
export function PersonalWidgetQueryListener({
  propertyUri,
  widgetKey,
  anchorId,
  href,
  limit,
  setPersonalWidgets,
  endpointReady,
  refreshRevision,
}: {
  propertyUri: string;
  widgetKey?: string;
  anchorId?: string;
  href?: string;
  endpointReady: boolean;
  refreshRevision: number;
  limit: number;
  setPersonalWidgets: Dispatch<SetStateAction<PersonalWidget[]>>;
}) {
  const { tree } = useFctQuery();
  // Datatype evidence is produced by the derived property widget query, but
  // its validity belongs to the ORIGINAL live FCT scope. Never store the
  // derived XML here: the Personal pane compares against the live query XML,
  // so storing widgetQueryXml made every numeric facet look ineligible.
  const liveQueryScopeXml = serializeFctQuery(tree);
  const identity = widgetKey ?? propertyUri;
  const alias = anchorId ? activeTransportedFacets(tree).find(item => item.id === anchorId) : undefined;
  const retryRevision = useMaestroComponentRetry(`personal:${identity}`);
  const widgetTree = createPersonalFacetValuesQuery(tree, propertyUri,
    alias?.target.name === "property-of" ? "reverse" : "forward", { limit, offset: 0 }, undefined,
    alias?.href === href ? href : undefined);
  const queryTimeoutMs = configuredTimeoutMs("personal") || Number(widgetTree.attributes.timeout) || 60_000;
  const widgetQueryXml = serializeFctQuery({ ...widgetTree, attributes: { ...widgetTree.attributes, timeout: String(queryTimeoutMs) } });

  useEffect(() => {
    // A restored query can mount this widget before its graph server is loaded.
    // Never dispatch speculative FCT requests during endpoint initialization.
    if (!endpointReady) return;
    // Reconcile every mounted widget against the active <view> scope. A widget
    // whose filter belongs to another breadcrumb scope must not retain stale
    // values while the parent pane catches up with the new query revision.
    if (anchorId ? !alias || alias.href !== href : !treeHasPropertyFilter(tree, propertyUri)) {
      setPersonalWidgets((current) =>
        current.filter((widget) => (widget.key ?? widget.uri) !== identity),
      );
      return;
    }
    let cancelled = false;
    let timeoutReason = "";
    const controller = new AbortController();
    const clockScope = `component:personal:${identity}` as const;
    resetMaestroQueryExecutionScope(clockScope);
    const stopDeadline = watchPersonalFacetDeadline(clockScope, queryTimeoutMs, reason => {
      timeoutReason = reason;
      controller.abort(new DOMException(reason, "TimeoutError"));
    });
    setPersonalWidgets((current) =>
      current.map((widget) =>
        (widget.key ?? widget.uri) === identity
          ? { ...widget, valuesQueryXml: widgetQueryXml, valuesQuerySparql: undefined, loading: true, error: "" }
          : widget,
      ),
    );

    async function refreshWidget() {
      const sourceNode = alias?.target ?? getActiveViewPropertyFilters(tree).find(node => node.attributes.iri === propertyUri);
      const sourceUrn = sourceNode?.id ? dynamicUiComponentUrn("property", sourceNode.id) : UI_COMPONENT.personalPane;
      const attribution = proxyDebugHeaders(sourceUrn, `PersonalWidgetQueryListener:${propertyUri}`);
      let httpInfo = "No HTTP response received";
      try {
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...attribution,
            "X-Maestro-Clock-Component": `component:personal:${identity}`, ...componentRetryHeaders(retryRevision) },
          body: widgetQueryXml,
          signal: controller.signal,
        });
        httpInfo = `HTTP ${response.status} ${response.statusText}; content-type: ${response.headers.get("content-type") || "not reported"}`;
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!response.ok)
          throw new Error(data.error ?? `Failed to load ${propertyUri}.`);
        if (!cancelled) setMaestroIncompleteResults(`personal:${identity}`, { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        const fetchedValues = countedFacetValues(Array.isArray(data.results)
          ? data.results
          : []);
        // The derived FCT query retains the value constraints on this
        // relationship and the FCT server has *already* applied them. Do not
        // filter valid server rows a second time by an inferred RDF datatype:
        // email_sha1 and other typed/plain-literal facets can have binding
        // metadata different from the <value> lexical form, causing an empty
        // Selected widget even when FCT returned rows. Trust the authoritative
        // server selection and let facet item keys handle checkbox state.
        const filteredValues = fetchedValues;
        const values = filteredValues.slice().sort(compareGroupValues);
        if (cancelled) return;
        setPersonalWidgets((current) =>
          current.map((widget) =>
            (widget.key ?? widget.uri) === identity
              ? {
                  ...widget,
                  values,
                  valuesQuerySparql: data.sparql,
                  datatypeEvidence: [...new Set((data.datatypeEvidence ?? []).map(item => item.datatype))],
                  datatypeEvidenceScope: liveQueryScopeXml,
                  loading: false,
                  error: "",
                  page: Math.min(
                    widget.page,
                    Math.max(0, Math.ceil(values.length / 10) - 1),
                  ),
                }
              : widget,
          ),
        );
      } catch (error) {
        if (cancelled) return;
        if (!timeoutReason && error instanceof Error && error.name === "AbortError") {
          // Individual/global transport cancellation is terminal for this live
          // widget. Only effect cleanup belongs to a superseded query.
          setPersonalWidgets((current) => current.map(widget =>
            (widget.key ?? widget.uri) === identity ? { ...widget, loading: false } : widget));
          return;
        }
        setPersonalWidgets((current) =>
          current.map((widget) =>
            (widget.key ?? widget.uri) === identity
              ? {
                  ...widget,
                  loading: false,
                  error: [
                    timeoutReason ||
                      `Personal facet update failed: ${error instanceof Error ? error.message : String(error)}`,
                    `Component: PersonalWidgetQueryListener:${propertyUri}`,
                    `RDF property: ${propertyUri}`,
                    `x-maestro-debug-source: ${attribution["X-Maestro-Debug-Source"]}`,
                    `x-maestro-debug-component: ${attribution["X-Maestro-Debug-Component"]}`,
                    `x-maestro-debug-request: ${attribution["X-Maestro-Debug-Request"]}`,
                    `Transport: POST /proxy/api/fct; ${httpInfo}`,
                    `FCT endpoint: ${tree.attributes.addr || "not selected"}`,
                    `Retry revision: ${retryRevision}`,
                    `Cloned FCT XML (verbatim):\n${widgetQueryXml}`,
                  ].join("\n"),
                }
              : widget,
          ),
        );
      } finally {
        stopDeadline();
      }
    }

    void refreshWidget();
    return () => {
      cancelled = true;
      stopDeadline();
      controller.abort();
    };
  }, [widgetQueryXml, identity, propertyUri, anchorId, href, setPersonalWidgets, endpointReady, refreshRevision, retryRevision]);

  return null;
}

/** Loads and renders the value list for a selected reverse-role facet in Filters. */
export function PersonalRoleWidget({
  tree,
  roleNode,
  label,
  isGroupByRole,
  limit,
  onGroupValueClick,
  setRoleWidgetStatuses,
  endpointReady,
  refreshRevision,
}: {
  tree: FctQueryTree;
  roleNode: FctQueryNode;
  label: string;
  isGroupByRole: boolean;
  limit: number;
  onGroupValueClick: (value: FctResult) => void;
  setRoleWidgetStatuses: Dispatch<SetStateAction<Record<string, RoleWidgetStatus>>>;
  endpointReady: boolean;
  refreshRevision: number;
}) {
  const { setRoleValue } = useFctQuery();
  const uri = roleNode.attributes.iri ?? "";
  const retryRevision = useMaestroComponentRetry(`personal-role:${uri}`);
  const [values, setValues] = useState<FctResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const widgetTree = createPersonalFacetValuesQuery(tree, uri, "reverse", { limit, offset: 0 }, roleNode.id);
  const queryTimeoutMs = configuredTimeoutMs("personal") || Number(widgetTree.attributes.timeout) || 60_000;
  const widgetQueryXml = serializeFctQuery({ ...widgetTree, attributes: { ...widgetTree.attributes, timeout: String(queryTimeoutMs) } });
  const [executed, setExecuted] = useState<{ xml: string; sparql: string } | null>(null);
  // The Configure role filter and the view-bearing role can have the same
  // predicate but different node IDs. Their selected values describe the same
  // binding and must be reflected in the Personal role facet.
  const roleSelectionNodes = getRoleSelectionNodes(tree, uri);
  const selectedValueNodes = roleSelectionNodes.flatMap((node) =>
    node.children.filter((child) => child.name === "value" && Boolean(child.text)));
  const selectedValueNodesByKey = new Map(selectedValueNodes.map((node) =>
    [fctTermKey(node.text ?? "", node.attributes.datatype ?? (node.attributes["xml:lang"] ? undefined : "string"), node.attributes["xml:lang"]), node] as const));
  const selectedKeys = [...selectedValueNodesByKey.keys()];
  const selectedValuesFromQuery: FctResult[] = [...selectedValueNodesByKey.values()].map((node) => {
    const term = node.text ?? "";
    const datatype = node.attributes.datatype;
    const lang = node.attributes["xml:lang"];
    const endpointValue = values.find((value) => fctTermKey(groupValueBinding(value).text, groupValueBinding(value).datatype, groupValueBinding(value).lang) ===
      fctTermKey(term, datatype ?? (lang ? undefined : "string"), lang));
    return endpointValue ?? { uri: term, title: term, termType: datatype === "uri" ? "uri" : "literal", ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}), matches: [] };
  });

  // Publish this widget's own result count and request status to its header.
  // The global Roles facet list is a different query and can have a different count.
  useEffect(() => {
    const nextStatus: RoleWidgetStatus = { count: values.length, loading, error, sampleValue: values[0], valuesQueryXml: widgetQueryXml, valuesQuerySparql: executed?.xml === widgetQueryXml ? executed.sparql : undefined };
    setRoleWidgetStatuses((current) => {
      const previous = current[roleNode.id];
      return previous && previous.count === nextStatus.count && previous.loading === nextStatus.loading && previous.error === nextStatus.error && previous.sampleValue?.uri === nextStatus.sampleValue?.uri && previous.sampleValue?.datatype === nextStatus.sampleValue?.datatype && previous.sampleValue?.lang === nextStatus.sampleValue?.lang && previous.valuesQueryXml === nextStatus.valuesQueryXml && previous.valuesQuerySparql === nextStatus.valuesQuerySparql
        ? current
        : { ...current, [roleNode.id]: nextStatus };
    });
  }, [roleNode.id, values, loading, error, widgetQueryXml, executed, setRoleWidgetStatuses]);

  useEffect(() => {
    if (!uri || !endpointReady) return;
    let cancelled = false;
    const controller = new AbortController();
    const clockScope = `component:personal-role:${uri}` as const;
    resetMaestroQueryExecutionScope(clockScope);
    let timeoutReason = "";
    const stopDeadline = watchPersonalFacetDeadline(clockScope, queryTimeoutMs, reason => {
      timeoutReason = reason; controller.abort(new DOMException(reason, "TimeoutError"));
    });
    setLoading(true);
    setError("");
    async function loadValues() {
      try {
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("personal-role-widget-values", `PersonalRoleWidget:${uri}`),
            "X-Maestro-Clock-Component": `component:personal-role:${uri}`, ...componentRetryHeaders(retryRevision) },
          body: widgetQueryXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!response.ok) throw new Error(data.error ?? `Failed to load role values for ${uri}.`);
        if (!cancelled) setMaestroIncompleteResults(`personal-role:${uri}`, { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        const fetchedRaw = countedFacetValues(Array.isArray(data.results) ? data.results as FctResult[] : []);
        const fetched = fetchedRaw.slice().sort(compareGroupValues);
        if (cancelled) return;
        setExecuted({ xml: widgetQueryXml, sparql: data.sparql });
        setValues((current) => current.length === fetched.length && current.every((item, index) => item.uri === fetched[index]?.uri && item.datatype === fetched[index]?.datatype && item.lang === fetched[index]?.lang && facetMembershipCount(item) === facetMembershipCount(fetched[index])) ? current : fetched);
        setPage((current) => Math.min(current, Math.max(0, Math.ceil(fetched.length / 10) - 1)));
      } catch (requestError) {
        if (cancelled || (!timeoutReason && requestError instanceof Error && requestError.name === "AbortError")) return;
        setError(timeoutReason || presentServerError(requestError instanceof Error ? requestError.message : "Failed to load role values."));
      } finally {
        stopDeadline();
        if (!cancelled) setLoading(false);
      }
    }
    void loadValues();
    return () => { cancelled = true; stopDeadline(); controller.abort(); };
  // widgetQueryXml already encodes the entire current FCT tree, role binding,
  // page limit, and group-by state. Depending on the *object identity* of tree
  // additionally re-dispatches an identical request when parent UI state
  // reconstructs an equivalent tree (and can hide a ready Role list).
  }, [uri, widgetQueryXml, endpointReady, refreshRevision, retryRevision]);

  const visibleValues = values.filter((value) => {
    const binding = groupValueBinding(value);
    const count = facetMembershipCount(value);
    const valueKey = fctTermKey(binding.text, binding.datatype, binding.lang);
    // Keep a selected value available to uncheck even if the current query has
    // become empty; hide only confirmed zero-count alternatives.
    return !selectedKeys.includes(valueKey) && count !== undefined && count > 0;
  });
  const pageCount = Math.max(1, Math.ceil(visibleValues.length / 10));
  const pageValues = visibleValues.slice(page * 10, (page + 1) * 10);
  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, pageCount - 1)));
  }, [pageCount]);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {error && <ErrorDetails prefix="Facet update" error={error} className="mx-2 my-1" />}
      {!loading && !error && visibleValues.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No matching values for this role.</p>}
      {visibleValues.length > 10 && (
        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs">
          <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
          <span className="text-muted-foreground">{page + 1}/{pageCount}</span>
          <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button>
        </div>
      )}
      {selectedValuesFromQuery.length > 0 && (
        <div className="mb-2 rounded-md border border-input bg-background p-2" aria-label="Selected role values">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Selected</div>
          <div className={FACET_ITEM_GAP_CLASS}>
            {selectedValuesFromQuery.map((value) => {
              const binding = groupValueBinding(value);
              return <label key={facetValueKey(value)} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50">
                <input type="checkbox" checked onChange={() => setRoleValue(uri, { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) }, false)}
                  className="mt-0.5 size-4 shrink-0 accent-current" aria-label={`Remove selected role value ${value.title || value.uri}`} />
                <FacetItemDecoration direction="reverse" iri={uri} value={facetValueKey(value)}/>
                <span className="min-w-0 flex-1 break-words">{value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{facetMembershipCount(value) === undefined ? "—" : shortenCount(facetMembershipCount(value)!)}</span>
              </label>;
            })}
          </div>
        </div>
      )}
      <div className={`${FACET_ITEM_GAP_CLASS} ${loading ? "opacity-45" : ""}`}>
        {pageValues.map((value, valueIndex) => {
          const binding = groupValueBinding(value);
          const valueKey = fctTermKey(binding.text, binding.datatype, binding.lang);
          const groupedCount = facetMembershipCount(value);
          const isZeroCount = groupedCount === 0;
          return (
            <div key={facetValueKey(value)} className={`flex w-full items-start gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50 ${isGroupByRole ? "" : "cursor-pointer"}`}>
              <input id={`personal-role-value-${roleNode.id}-${valueIndex}`} type="checkbox" disabled={loading} checked={selectedKeys.includes(valueKey)} onChange={(event) => setRoleValue(uri, { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) }, event.currentTarget.checked)} className="mt-0.5 size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40" aria-invalid={isZeroCount ? true : undefined} aria-label={`Filter ${label} by ${value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}`} />
              <FacetItemDecoration direction="reverse" iri={uri} value={facetValueKey(value)}/>
              {isGroupByRole ? (
                <Tooltip><TooltipTrigger render={<button type="button" onClick={() => onGroupValueClick(value)} className={`min-w-0 flex-1 cursor-pointer break-words text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isZeroCount ? "text-destructive" : ""}`}>{value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}</button>} /><TooltipContent>{`Scroll to group ${value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}`}</TooltipContent></Tooltip>
              ) : (
                <label htmlFor={`personal-role-value-${roleNode.id}-${valueIndex}`} className={`min-w-0 flex-1 break-words cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}>
                  {value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}
                </label>
              )}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-label="Matching resources">
                {groupedCount === undefined ? "—" : shortenCount(groupedCount)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/** State for the left Filters and Configure facet lists. */
export function useFacetListState() {
  const FACET_PAGE_SIZE = 10;
  const [propertyFacets, setPropertyFacets] = useState<FacetItem[]>([]);
  const [classFacets, setClassFacets] = useState<FacetItem[]>([]);
  // Class -> immediate superclass edges from the tree="yes" classes view (a class may have several parents).
  const [classTreeEdges, setClassTreeEdges] = useState<Array<{ uri: string; parent: string }>>([]);
  const [facetCandidateCounts, setFacetCandidateCounts] = useState<Record<string, number | null>>({});
  const [roleFacets, setRoleFacets] = useState<FacetItem[]>([]);
  const [roleWidgetStatuses, setRoleWidgetStatuses] = useState<Record<string, RoleWidgetStatus>>({});
  const [graphFacets, setGraphFacets] = useState<FacetItem[]>([]);
  const [graphHasMore, setGraphHasMore] = useState(false);
  const [graphTotalCount, setGraphTotalCount] = useState<number | null>(null);
  const [graphListIncomplete, setGraphListIncomplete] = useState(false);
  const [propertyFacetSparql, setPropertyFacetSparql] = useState("");
  const [roleFacetSparql, setRoleFacetSparql] = useState("");
  const [facetAutofillCandidates, setFacetAutofillCandidates] = useState<FacetAutofillCandidates>({ property: [], "property-in": [] });
  // localStorage mutations do not trigger React renders. This revision makes
  // additions to the live query observable to the Auto-configure candidate effects.
  const [facetUsageRevision, setFacetUsageRevision] = useState(0);
  const previousFacetQueryNodesRef = useRef<Map<string, { kind: "property" | "property-in"; uri: string; excluded: boolean }> | null>(null);
  const [autoConfiguredFacetKeys, setAutoConfiguredFacetKeys] = useState<Set<AutoConfiguredFacetKey>>(
    () => new Set(typeof window === "undefined" ? [] : readAutoConfiguredFacetKeys()),
  );
  const [rolesPage, setRolesPage] = useState(0);

  return { FACET_PAGE_SIZE, propertyFacets, setPropertyFacets, classFacets, setClassFacets, classTreeEdges, setClassTreeEdges, facetCandidateCounts, setFacetCandidateCounts, roleFacets, setRoleFacets, roleWidgetStatuses, setRoleWidgetStatuses, graphFacets, setGraphFacets, graphHasMore, setGraphHasMore, graphTotalCount, setGraphTotalCount, graphListIncomplete, setGraphListIncomplete, propertyFacetSparql, setPropertyFacetSparql, roleFacetSparql, setRoleFacetSparql, facetAutofillCandidates, setFacetAutofillCandidates, facetUsageRevision, setFacetUsageRevision, autoConfiguredFacetKeys, setAutoConfiguredFacetKeys, rolesPage, setRolesPage, previousFacetQueryNodesRef };
}

/** Graph scope and navigation for the left Filters pane; shared with the App Bar. */
export function useGraphFacetNavigationState() {
  const [selectedFacet, setSelectedFacet] = useState<FacetName>("Properties");
  const [propertiesPage, setPropertiesPage] = useState(0);
  const [classesPage, setClassesPage] = useState(0);
  const [graphsPage, setGraphsPage] = useState(0);
  const [graphSort, setGraphSort] = useState<"count-desc" | "count-asc" | "label-asc" | "label-desc">("label-asc");
  const [graphSortPickerExpanded, setGraphSortPickerExpanded] = useState(false);
  const [graphListSparql, setGraphListSparql] = useState("");
  const [graphText, setGraphText] = useState("");
  const [graphAutoFill, setGraphAutoFill] = useState(false);
  const [graphFieldEditing, setGraphFieldEditing] = useState(false);
  const lastManualGraphRef = useRef("");
  const [graphNavigationHistory, setGraphNavigationHistory] = useState<string[]>([""]);
  const [graphNavigationIndex, setGraphNavigationIndex] = useState(0);
  const restoredGraphTextRef = useRef<string | null>(null);
  const [findEndpointsEnabled, setFindEndpointsEnabled] = useState(false);
  return { selectedFacet, setSelectedFacet, propertiesPage, setPropertiesPage, classesPage, setClassesPage, graphsPage, setGraphsPage, graphSort, setGraphSort, graphSortPickerExpanded, setGraphSortPickerExpanded, graphListSparql, setGraphListSparql, graphText, setGraphText, graphAutoFill, setGraphAutoFill, graphFieldEditing, setGraphFieldEditing, graphNavigationHistory, setGraphNavigationHistory, graphNavigationIndex, setGraphNavigationIndex, findEndpointsEnabled, setFindEndpointsEnabled, lastManualGraphRef, restoredGraphTextRef };
}
