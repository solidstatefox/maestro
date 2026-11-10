"use client";
import { readAutoConfiguredFacetKeys, type FacetAutofillCandidates, type AutoConfiguredFacetKey } from "@/canvas/left/configure";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";
import { toLabel, rememberShortforms } from "@/lib/uri-labels";
import { proxyDebugHeaders, proxyDebugFingerprint } from "@/lib/proxy-debug";
import { buildFctCountSparql } from "@/lib/fct-count-sparql";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { cachedFetchFct, maestroQueryFetch } from "@/lib/client-query-cache";
import { setMaestroIncompleteResults } from "@/lib/maestro-incomplete-results";
import { shortenCount } from "@/lib/utils";
import { useFctQuery, serializeFctQuery, createPropertyWidgetQuery, createPersonalRoleValuesQuery, createGroupValuesQuery, createDistinctCountQuery, setQueryViewAttributes } from "@/lib/fct-query-api";
import type { FctQueryTree, FctQueryNode, DistinctCountKind } from "@/lib/fct-query-api";
import { readFctResponse, presentServerError, groupValueBinding, fctTermKey, facetValueKey, type FctResult, type RelationshipDirection } from "@/canvas/utils/fct-response";


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

export type PersonalWidget = {
  uri: string;
  label: string;
  excluded: boolean;
  values: FctResult[];
  selectedValues: string[];
  page: number;
  loading: boolean;
  error: string;
};


export type ScopeRelationship = { uri: string; direction: RelationshipDirection };
export type GroupByOption = ScopeRelationship & { key: string; label: string; nodeId: string; memberBindingNodeId?: string; ancestorRole?: boolean };

export type GroupMembersState = { results: FctResult[]; count?: number; loading: boolean; error: string };
export type RoleWidgetStatus = { count: number; loading: boolean; error: string; sampleValue?: FctResult };



/** Build the exact count query used as the identity for a candidate's live-scope count. */
export function distinctCountQueryFor(
  tree: FctQueryTree,
  kind: DistinctCountKind,
  uri: string,
  propertyUri?: string,
  candidateValue?: FctResult,
  valueRelationship?: { direction: "forward" | "reverse"; nodeId?: string },
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

/** Expose the same Personal facet count input used by DistinctCount, without
 * changing the live query or requiring the counted item to remain visible. */
export function personalFacetInspectorQueries(
  tree: FctQueryTree,
  valuesXml: string,
  propertyUri: string,
  candidate?: FctResult,
  valueRelationship?: { direction: "forward" | "reverse"; nodeId?: string },
): { id: string; label: string; query: string; filename: string; language: "xml" | "sparql" }[] {
  const compile = (xml: string): string => {
    try {
      return compileFctXmlToSparql(xml).query;
    } catch (error) {
      return `# Unable to compile the facet query: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const unavailable = "No value returned yet; a candidate-specific count query is not available.";
  const countTree = candidate
    ? createDistinctCountQuery(tree, "value", candidate.uri, propertyUri, candidate, FCT_VIEW_TYPES.LIST_COUNT, valueRelationship)
    : null;
  const countXml = countTree ? serializeFctQuery(countTree) : `<!-- ${unavailable} -->`;
  // This is the *exact* scalar query that DistinctCount sends to /proxy/api/sparql.
  const countSparql = candidate
    ? distinctCountQueryFor(tree, "value", candidate.uri, propertyUri, candidate, valueRelationship)
    : `# ${unavailable}`;
  return [
    { id: "personal-list-sparql", label: "SPARQL", query: compile(valuesXml), filename: "personal-values.sparql", language: "sparql" },
    { id: "personal-count-xml", label: "Count XML", query: countXml, filename: "personal-first-value-count.xml", language: "xml" },
    { id: "personal-count-sparql", label: "Count SPARQL", query: countSparql || "# Count query could not be compiled.", filename: "personal-first-value-count.sparql", language: "sparql" },
  ];
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
  valueRelationship?: { direction: "forward" | "reverse"; nodeId?: string };
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
      let stage = "building scalar count SPARQL from the query tree";
      let responseDiagnostics: unknown;
      try {
        if (!countSparqlQuery) {
          throw new Error("The current FCT query tree contains a condition that cannot be compiled safely to SPARQL.");
        }
        stage = "executing scalar count SPARQL";
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
        // The selected graph server is encoded in addr, never inferred from a cookie.
        const sparqlResponse = await maestroQueryFetch("/proxy/api/sparql", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("distinct-count-sparql", `DistinctCount:${kind}:${propertyUri ?? ""}:${uri}`) },
          body: JSON.stringify({ facetValueCount: { sparql: countSparqlQuery, addr: tree.attributes.addr } }),
          signal: controller.signal,
        });
        const sparqlData = await sparqlResponse.json();
        responseDiagnostics = sparqlData;
        if (!sparqlResponse.ok) {
          throw new Error(sparqlData.error ?? "Failed to execute the item count against SPARQL.");
        }
        stage = "validating scalar count response";
        const parsedCount = Number(sparqlData.count);
        if (!Number.isFinite(parsedCount) || parsedCount < 0) {
          throw new Error("The SPARQL endpoint returned an invalid item count.");
        }
        if (sparqlData.incomplete) throw new Error("Virtuoso returned an incomplete facet count.");
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
        console.warn("Maestro facet item count failed", {
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
    console.info("Maestro DistinctCount effect scheduled", {
      kind,
      uri,
      propertyUri,
      countSparqlLength: countSparqlQuery?.length ?? 0,
      countQueryFingerprint: countSparqlQuery ? proxyDebugFingerprint(countSparqlQuery) : "unsupported-query-tree",
    });
    const refreshTimer = window.setTimeout(() => {
      if (cancelled) return;
      console.info("Maestro DistinctCount request starting", { kind, uri, propertyUri });
      // Keep the last completed count visible while this independent count query refreshes.
      setError("");
      void loadCount();
    }, 45);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      controller.abort();
      console.info("Maestro DistinctCount effect cleaned up", { kind, uri, propertyUri });
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
    if (nodes.some((node) => node.id === "query-view")) return nodes;
    for (const node of nodes) {
      const nested = findViewSiblings(node.children);
      if (nested) return nested;
    }
    return null;
  }
  return (findViewSiblings(tree.children) ?? []).filter((node) =>
    node.name === "property" && typeof node.attributes.iri === "string" && node.attributes.iri.length > 0,
  );
}

/** Return reverse-property filters attached to the active view's scope only.
 * Ancestor <property-of> nodes are navigation breadcrumbs, not filters for the
 * current result set; every direct <property-of> child of the view scope
 * is a candidate, including an existing relationship marked src="shacl".
 */
export function getActiveViewRoleFilters(tree: FctQueryTree): FctQueryNode[] {
  function findViewScope(nodes: FctQueryNode[]): FctQueryNode[] | null {
    for (const node of nodes) {
      if (node.children.some((child) => child.id === "query-view")) {
        return node.children;
      }
      const nested = findViewScope(node.children);
      if (nested) return nested;
    }
    // The active view can be at the root.
    if (nodes.some((node) => node.id === "query-view")) return nodes;
    return null;
  }
  return (findViewScope(tree.children) ?? []).filter(
    (node) => node.name === "property-of" &&
      typeof node.attributes.iri === "string",
  );
}

/** The Personal pane also lists values for the view-bearing reverse edge.
 * Keep this distinct from sibling-only filter discovery and badge selection. */
export function getPersonalRoleFacetNodes(tree: FctQueryTree): FctQueryNode[] {
  const siblings = getActiveViewRoleFilters(tree);
  const carrier = (nodes: FctQueryNode[]): FctQueryNode | null => {
    for (const node of nodes) {
      if (node.children.some((child) => child.id === "query-view")) return node;
      const found = carrier(node.children);
      if (found) return found;
    }
    return null;
  };
  const focus = carrier(tree.children);
  return focus?.name === "property-of" && focus.attributes.iri
    ? [focus, ...siblings]
    : siblings;
}

export function treeHasPropertyFilter(
  tree: FctQueryTree,
  propertyUri: string,
): boolean {
  return getActiveViewPropertyFilters(tree).some(
    (node) => node.attributes.iri === propertyUri,
  );
}

/**
 * Canonical Group By ordering, used by BOTH the Results group cards and the Personal facet widget that is being
 * grouped on: facet-equivalent count (column 2) descending, then label. One comparator keeps the two lists in the
 * same order, so a facet value always sits at the same position as its group card.
 */
export function compareGroupValues(a: FctResult, b: FctResult): number {
  const aCount = Number(a.columns?.[1]?.value ?? 0);
  const bCount = Number(b.columns?.[1]?.value ?? 0);
  return bCount - aCount || (a.title || a.uri).localeCompare(b.title || b.uri);
}

/** Each widget owns a real subscription to the authoritative query store. */
export function PersonalWidgetQueryListener({
  propertyUri,
  sortByCount,
  limit,
  groupBy,
  setPersonalWidgets,
  endpointReady,
  refreshRevision,
}: {
  propertyUri: string;
  sortByCount: boolean;
  endpointReady: boolean;
  refreshRevision: number;
  limit: number;
  /** When this facet is the active Group By, run the exact query the Results group pane runs. */
  groupBy?: { option: GroupByOption; limit: number };
  setPersonalWidgets: Dispatch<SetStateAction<PersonalWidget[]>>;
}) {
  const { tree } = useFctQuery();
  const widgetTree = createPropertyWidgetQuery(tree, propertyUri, "forward", undefined, true);
  const widgetQueryXml = groupBy
    ? serializeFctQuery(createGroupValuesQuery(tree, groupBy.option, { limit: groupBy.limit, offset: 0 }))
    : serializeFctQuery(setQueryViewAttributes(widgetTree, { sort: sortByCount ? "count" : "", limit: String(limit) }));
  const orderLikeGroups = Boolean(groupBy);

  useEffect(() => {
    // A restored query can mount this widget before its graph server is loaded.
    // Never dispatch speculative FCT requests during endpoint initialization.
    if (!endpointReady) return;
    // Reconcile every mounted widget against the active <view> scope. A widget
    // whose filter belongs to another breadcrumb scope must not retain stale
    // values while the parent pane catches up with the new query revision.
    if (!treeHasPropertyFilter(tree, propertyUri)) {
      setPersonalWidgets((current) =>
        current.filter((widget) => widget.uri !== propertyUri),
      );
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPersonalWidgets((current) =>
      current.map((widget) =>
        widget.uri === propertyUri
          ? { ...widget, loading: true, error: "" }
          : widget,
      ),
    );

    async function refreshWidget() {
      try {
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("personal-widget-values", `PersonalWidgetQueryListener:${propertyUri}`) },
          body: widgetQueryXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!response.ok)
          throw new Error(data.error ?? `Failed to load ${propertyUri}.`);
        if (!cancelled) setMaestroIncompleteResults(`personal:${propertyUri}`, { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        const fetchedValues: FctResult[] = Array.isArray(data.results)
          ? data.results
          : [];
        // Once this property has an active value binding, show only the selected
        // value(s) in its own widget. Other facets continue to be recomputed from
        // the filtered query, while this widget reflects its current selection.
        const activeFilter = getActiveViewPropertyFilters(tree).find(
          (node) => node.attributes.iri === propertyUri,
        );
        const selectedTerms = (activeFilter?.children ?? [])
          .filter((child) => child.name === "value")
          .map((child) => {
            const lang = child.attributes["xml:lang"];
            // FCT literal constraints default to datatype="string". If the
            // key defaults this missing datatype to "uri", a one-value
            // literal facet filters its only checkbox out after selection.
            const datatype = child.attributes.datatype ?? (lang ? undefined : "string");
            return fctTermKey(child.text ?? "", datatype, lang);
          });
        // Equality bindings can be matched by exact RDF-term identity.
        // For contains/regex/comparisons/ranges, the returned facet values
        // satisfy the predicate but need not equal its operand (e.g.
        // CONTAINS("1997-05-16", "1997")). Never drop those server matches.
        const valueBindings = (activeFilter?.children ?? []).filter((child) => child.name === "value");
        const equalityOnly = valueBindings.every((child) =>
          !Object.hasOwn(child.attributes, "rangeStart") &&
          !Object.hasOwn(child.attributes, "rangeEnd") &&
          ["", "=", "eq", "equal"].includes((child.attributes.op ?? "=").trim().toLowerCase()),
        );
        const filteredValues = equalityOnly && selectedTerms.length
          ? fetchedValues.filter((value) => selectedTerms.includes(facetValueKey(value)))
          : fetchedValues;
        const values = orderLikeGroups ? filteredValues.slice().sort(compareGroupValues) : filteredValues;
        if (cancelled) return;
        setPersonalWidgets((current) =>
          current.map((widget) =>
            widget.uri === propertyUri
              ? {
                  ...widget,
                  values,
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
        if (
          cancelled ||
          (error instanceof Error && error.name === "AbortError")
        )
          return;
        setPersonalWidgets((current) =>
          current.map((widget) =>
            widget.uri === propertyUri
              ? {
                  ...widget,
                  loading: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Failed to load property values.",
                }
              : widget,
          ),
        );
      }
    }

    void refreshWidget();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [widgetQueryXml, propertyUri, setPersonalWidgets, orderLikeGroups, endpointReady, refreshRevision]);

  return null;
}

/** Loads and renders the value list for a selected reverse-role facet in Filters. */
export function PersonalRoleWidget({
  tree,
  roleNode,
  label,
  isGroupByRole,
  groupBy,
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
  /** When this role is the active Group By, run the exact query the Results group pane runs. */
  groupBy?: { option: GroupByOption; limit: number };
  limit: number;
  onGroupValueClick: (value: FctResult) => void;
  setRoleWidgetStatuses: Dispatch<SetStateAction<Record<string, RoleWidgetStatus>>>;
  endpointReady: boolean;
  refreshRevision: number;
}) {
  const { setRoleValue } = useFctQuery();
  const uri = roleNode.attributes.iri ?? "";
  const [values, setValues] = useState<FctResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  // Counts are keyed by the full compiled query, so a new live query scope can
  // never accidentally reuse a candidate's stale count from the prior scope.
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number | null>>({});

  const roleWidgetTree = createPersonalRoleValuesQuery(tree, roleNode);
  const widgetQueryXml = groupBy
    ? serializeFctQuery(createGroupValuesQuery(tree, groupBy.option, { limit: groupBy.limit, offset: 0 }))
    : serializeFctQuery(setQueryViewAttributes(
      roleWidgetTree,
      { ...(isGroupByRole ? { sort: "count" } : {}), limit: String(limit) },
    ));
  const roleOrderLikeGroups = Boolean(groupBy);
  const selectedKeys = (roleNode.children ?? [])
    .filter((child) => child.name === "value" && Boolean(child.text))
    .map((child) => fctTermKey(child.text ?? "", child.attributes.datatype, child.attributes["xml:lang"]));

  // Publish this widget's own result count and request status to its header.
  // The global Roles facet list is a different query and can have a different count.
  useEffect(() => {
    const nextStatus: RoleWidgetStatus = { count: values.length, loading, error, sampleValue: values[0] };
    setRoleWidgetStatuses((current) => {
      const previous = current[roleNode.id];
      return previous && previous.count === nextStatus.count && previous.loading === nextStatus.loading && previous.error === nextStatus.error && previous.sampleValue?.uri === nextStatus.sampleValue?.uri && previous.sampleValue?.datatype === nextStatus.sampleValue?.datatype && previous.sampleValue?.lang === nextStatus.sampleValue?.lang
        ? current
        : { ...current, [roleNode.id]: nextStatus };
    });
  }, [roleNode.id, values, loading, error, setRoleWidgetStatuses]);

  useEffect(() => {
    if (!uri || !endpointReady) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    async function loadValues() {
      try {
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("personal-role-widget-values", `PersonalRoleWidget:${uri}`) },
          body: widgetQueryXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!response.ok) throw new Error(data.error ?? `Failed to load role values for ${uri}.`);
        if (!cancelled) setMaestroIncompleteResults(`personal-role:${uri}`, { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        const fetchedRaw = Array.isArray(data.results) ? data.results as FctResult[] : [];
        const fetched = roleOrderLikeGroups ? fetchedRaw.slice().sort(compareGroupValues) : fetchedRaw;
        if (cancelled) return;
        setValues((current) => current.length === fetched.length && current.every((item, index) => item.uri === fetched[index]?.uri && item.datatype === fetched[index]?.datatype && item.lang === fetched[index]?.lang) ? current : fetched);
        setPage((current) => Math.min(current, Math.max(0, Math.ceil(fetched.length / 10) - 1)));
      } catch (requestError) {
        if (cancelled || (requestError instanceof Error && requestError.name === "AbortError")) return;
        setError(presentServerError(requestError instanceof Error ? requestError.message : "Failed to load role values."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadValues();
    return () => { cancelled = true; controller.abort(); };
  }, [uri, widgetQueryXml, tree, roleOrderLikeGroups, endpointReady, refreshRevision]);

  const visibleValues = values.filter((value) => {
    const binding = groupValueBinding(value);
    const countQuery = distinctCountQueryFor(tree, "value", value.uri, uri, value, { direction: "reverse", nodeId: roleNode.id });
    const count = candidateCounts[countQuery];
    const valueKey = fctTermKey(binding.text, binding.datatype, binding.lang);
    // Keep a selected value available to uncheck even if the current query has
    // become empty; hide only confirmed zero-count alternatives.
    return selectedKeys.includes(valueKey) || count !== 0;
  });
  const pageCount = Math.max(1, Math.ceil(visibleValues.length / 10));
  const pageValues = visibleValues.slice(page * 10, (page + 1) * 10);
  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, pageCount - 1)));
  }, [pageCount]);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {loading && <p className="px-2 py-1 text-xs text-muted-foreground" aria-live="polite">Updating…</p>}
      {error && <Tooltip><TooltipTrigger render={<p className="px-2 py-1 text-xs text-destructive">Update failed: {error}</p>} /><TooltipContent>{error}</TooltipContent></Tooltip>}
      {!loading && !error && visibleValues.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No matching values for this role.</p>}
      {visibleValues.length > 10 && (
        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs">
          <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
          <span className="text-muted-foreground">{page + 1}/{pageCount}</span>
          <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button>
        </div>
      )}
      <div className={`${FACET_ITEM_GAP_CLASS} ${loading ? "opacity-45" : ""}`}>
        {pageValues.map((value, valueIndex) => {
          const binding = groupValueBinding(value);
          const valueKey = fctTermKey(binding.text, binding.datatype, binding.lang);
          const countQuery = distinctCountQueryFor(tree, "value", value.uri, uri, value, { direction: "reverse", nodeId: roleNode.id });
          const isZeroCount = candidateCounts[countQuery] === 0;
          return (
            <div key={`${value.uri}:${value.datatype ?? ""}:${value.lang ?? ""}`} className={`flex w-full items-start gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50 ${isGroupByRole ? "" : "cursor-pointer"}`}>
              <input id={`personal-role-value-${roleNode.id}-${valueIndex}`} type="checkbox" disabled={loading} checked={selectedKeys.includes(valueKey)} onChange={(event) => setRoleValue(uri, { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) }, event.currentTarget.checked)} className="mt-0.5 size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40" aria-invalid={isZeroCount ? true : undefined} aria-label={`Filter ${label} by ${value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}`} />
              {isGroupByRole ? (
                <Tooltip><TooltipTrigger render={<button type="button" onClick={() => onGroupValueClick(value)} className={`min-w-0 flex-1 cursor-pointer break-words text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isZeroCount ? "text-destructive" : ""}`}>{value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}</button>} /><TooltipContent>{`Scroll to group ${value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}`}</TooltipContent></Tooltip>
              ) : (
                <label htmlFor={`personal-role-value-${roleNode.id}-${valueIndex}`} className={`min-w-0 flex-1 break-words cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}>
                  {value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}
                </label>
              )}
              <DistinctCount
                enabled={endpointReady}
                tree={tree}
                kind="value"
                uri={value.uri}
                propertyUri={uri}
                candidateValue={value}
                valueRelationship={{ direction: "reverse", nodeId: roleNode.id }}
                onCountChange={(query, count) =>
                  setCandidateCounts((current) =>
                    current[query] === count ? current : { ...current, [query]: count },
                  )
                }
              />
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
  const [graphSort, setGraphSort] = useState<"count-desc" | "count-asc" | "label-asc" | "label-desc">("count-desc");
  const [graphSortPickerExpanded, setGraphSortPickerExpanded] = useState(false);
  const [graphListSparql, setGraphListSparql] = useState("");
  const [graphText, setGraphText] = useState("");
  const [graphAutoFill, setGraphAutoFill] = useState(true);
  const [graphFieldEditing, setGraphFieldEditing] = useState(false);
  const lastManualGraphRef = useRef("");
  const [graphNavigationHistory, setGraphNavigationHistory] = useState<string[]>([""]);
  const [graphNavigationIndex, setGraphNavigationIndex] = useState(0);
  const restoredGraphTextRef = useRef<string | null>(null);
  const [findEndpointsEnabled, setFindEndpointsEnabled] = useState(false);
  return { selectedFacet, setSelectedFacet, propertiesPage, setPropertiesPage, classesPage, setClassesPage, graphsPage, setGraphsPage, graphSort, setGraphSort, graphSortPickerExpanded, setGraphSortPickerExpanded, graphListSparql, setGraphListSparql, graphText, setGraphText, graphAutoFill, setGraphAutoFill, graphFieldEditing, setGraphFieldEditing, graphNavigationHistory, setGraphNavigationHistory, graphNavigationIndex, setGraphNavigationIndex, findEndpointsEnabled, setFindEndpointsEnabled, lastManualGraphRef, restoredGraphTextRef };
}
