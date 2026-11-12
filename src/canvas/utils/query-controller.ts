"use client";

import { FCT_VIEW_TYPES } from "@/lib/fct-view-types";
import { useFctQuery, fctQueryTreeApi } from "@/lib/fct-query-api";
import type { FctQueryTree, FctQueryNode } from "@/lib/fct-query-api";
import type { FacetName } from "@/canvas/left/filter";

export function findQueryNode(
  nodes: FctQueryNode[],
  nodeId: string,
): FctQueryNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const found = findQueryNode(node.children, nodeId);
    if (found) return found;
  }
  return undefined;
}

export function queryTreeHasStatuses(tree: FctQueryTree): boolean {
  const visit = (nodes: FctQueryNode[]): boolean => nodes.some((node) => node.name === "status" || visit(node.children));
  return visit(tree.children);
}

export const RDF_TYPE_URI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** Cap example ("e.g.") text at a character limit so one long value cannot stretch a row or badge. */
export function ellipsize(text: string, limit = 40): string {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("").trimEnd()}…` : characters.join("");
}
export const GROUP_BY_FACET_HIGHLIGHT_CLASSES = "border-sky-300 bg-sky-100/80 dark:border-sky-800 dark:bg-sky-950/50";

export type ShareableUiState = {
  selectedFacet?: FacetName;
  propertiesPage?: number;
  classesPage?: number;
  graphsPage?: number;
  rolesPage?: number;
  findEndpointsEnabled?: boolean;
  centralTab?: "results" | "groups" | "query-tree" | "view-query" | "chat";
  workspaceTab?: "browse" | "view" | "analyze";
  viewPanel?: "trail" | "perspectives" | "features";
  selectedViewUri?: string;
  viewFeature?: "policies" | "formats" | "transcoders" | null;
  selectedAnalysisUri?: string;
  analyzeHistogram?: boolean;
  /** Explicit state for the Results/Query toolbar toggle. */
  queryToggle?: boolean;
  showResultBadges?: boolean;
  /** Explicit state for the Badges toolbar toggle. */
  badgesToggle?: boolean;
  querySourceFormat?: "xml" | "sparql" | "alphabet-xml" | "alphabet-sparql" | "list-values-xml" | "list-values-sparql" | "response";
  defaultLeftTab?: "facets" | "personal" | "community";
  focusListOrder?: "Properties" | "Roles";
  focusWidgetsSuppressed?: boolean;
  groupByPropertyUri?: string;
  resultsUiPage?: number;
  groupUiPage?: number;
  groupBatchSize?: number;
  groupBatchOffset?: number;
  resultsPageSize?: number;
  selectedUri?: string;
  graphText?: string;
  graphAutoFill?: boolean;
  rdfSourceUrl?: string;
  rdfTargetGraph?: string;
  /** Root breadcrumb signal (URI / Name / All fields / Clear Terms). */
  selectedSignalMode?: "uri" | "exact" | "name" | "all" | "clear";
  /** The text currently shown in the root breadcrumb field (URI or search term, depending on the signal). */
  searchDraft?: string;
  /** Last text-search term retained while another signal is active. */
  savedSearchDraft?: string;
  /** Last fixed-subject URI retained independently from the text-search term. */
  savedUriDraft?: string;
  /** Selected name/label predicates, retained even while another signal is active. */
  selectedNamePropertyUris?: string[];
  /** Backward-compatible single-predicate state from older shared URLs. */
  selectedNamePropertyUri?: string;
  /** Metadata badge view mode: records (default) or classes. */
  breadcrumbBadgeMode?: "records" | "classes";
};

/** Compact URL indices for the appbar and View accordion. Publish is reserved. */
export const APPBAR_TAB_NUMBER = { browse: 0, view: 1, analyze: 2, publish: 3 } as const;
export const VIEW_RIBBON_TAB_NUMBER = { trail: 0, perspectives: 1, features: 2 } as const;

export function decodeAppbarTab(value: string | null): "browse" | "view" | "analyze" | null {
  switch (value) {
    case "0": case "browse": return "browse";
    case "1": case "view": return "view";
    case "2": case "analyze": return "analyze";
    default: return null; // Publish (3) is not implemented yet.
  }
}

export function decodeViewRibbonTab(value: string | null): "trail" | "perspectives" | "features" | null {
  switch (value) {
    case "0": case "trail": return "trail";
    case "1": case "perspectives": return "perspectives";
    case "2": case "features": return "features";
    default: return null;
  }
}

export function validRibbonProviderUri(value: string | null): string | null {
  return value !== null && value.length <= 2048 && /^(?:https?:|gttp:|gttps:|urn:)/.test(value)
    ? value : null;
}

/** Copy authoritative ribbon parameters from a stored bookmark/history URL. */
export function copyRibbonUrlParams(source: URLSearchParams, target: URLSearchParams): void {
  for (const key of ["tab", "ribbonTab", "ribbonButton"]) {
    if (source.has(key)) target.set(key, source.get(key) ?? "");
    else target.delete(key);
  }
}

/** Read the graph-server URI from the query's authoritative addr attribute. */
export function readGraphServerFromQueryXml(xml: string | null | undefined): string | null {
  if (!xml || typeof DOMParser === "undefined") return null;
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const root = document.documentElement;
  if (document.querySelector("parsererror") || root?.localName !== "query") return null;
  const address = root.getAttribute("addr") ?? "";
  const delimiter = address.indexOf("@");
  const graphServer = delimiter >= 0 ? address.slice(delimiter + 1).trim() : "";
  return graphServer || null;
}

export function readShareableUiState(search?: string): ShareableUiState | null {
  if (typeof window === "undefined" && search === undefined) return null;
  const params = new URLSearchParams(search ?? window.location.search);
  const encodedState = params.get("state");
  let result: ShareableUiState | null = null;
  if (encodedState) {
    try {
      const parsed: unknown = JSON.parse(encodedState);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = parsed as ShareableUiState;
    } catch { /* A malformed legacy state must not discard valid ribbon parameters. */ }
  }
  const appbar = decodeAppbarTab(params.get("tab"));
  const ribbon = decodeViewRibbonTab(params.get("ribbonTab"));
  const button = validRibbonProviderUri(params.get("ribbonButton"));
  // Explicit top-level ribbon parameters override older values embedded in state.
  // An empty ribbonButton explicitly means no selected provider for this ribbon.
  if (appbar || ribbon || params.has("ribbonButton")) {
    result = { ...(result ?? {}) };
    if (appbar) result.workspaceTab = appbar;
    if (ribbon) result.viewPanel = ribbon;
    if (params.has("ribbonButton")) result.selectedViewUri = button ?? "";
  }
  return result;
}

/** Parse the share URL's serialized FCT XML into a fresh tree with unique client-only node IDs. */
export function parseFctQueryXml(xml: string): FctQueryTree | null {
  if (typeof DOMParser === "undefined") return null;
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror") || document.documentElement?.localName !== "query") return null;
  const root = document.documentElement;
  const rootAttributes: Record<string, string> = {};
  for (const attribute of Array.from(root.attributes)) rootAttributes[attribute.name] = attribute.value;
  const usedIds = new Set<string>();
  let hasQueryText = false;
  let hasQueryView = false;
  const elementChildren = (element: Element) => Array.from(element.children);
  const parseNode = (element: Element, path: string, isRootChild: boolean): FctQueryNode => {
    const name = element.localName;
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) attributes[attribute.name] = attribute.value;
    const iri = attributes.iri ?? "";
    let id: string;
    if (name === "text" && isRootChild && !hasQueryText) {
      id = "query-text";
      hasQueryText = true;
    } else if (name === "view" && !hasQueryView) {
      id = "query-view";
      hasQueryView = true;
    } else if (name === "property" && iri) {
      const containsView = (candidate: Element): boolean => candidate.localName === "view" || elementChildren(candidate).some(containsView);
      id = `${containsView(element) ? "property-path" : "property-filter"}-${encodeURIComponent(iri)}-${path}`;
    } else if (name === "property-of" && iri) {
      id = `role-filter-${path}-${encodeURIComponent(iri)}`;
    } else if (name === "class" && iri) {
      id = `class-${path}-${encodeURIComponent(iri)}`;
    } else if (name === "status") {
      id = `status-${path}-${encodeURIComponent((element.textContent ?? "").trim())}`;
    } else {
      id = `url-${path}-${name}`;
    }
    const baseId = id;
    let suffix = 1;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    const children = name === "view" ? [] : elementChildren(element).map((child, index) => parseNode(child, `${path}.${index}`, false));
    const text = name === "text" || name === "value" || name === "status" ? (element.textContent ?? "") : undefined;
    return { id, name, attributes, ...(text !== undefined ? { text } : {}), children };
  };
  const children = elementChildren(root).map((child, index) => parseNode(child, String(index), true));
  if (!hasQueryView) {
    children.push({ id: "query-view", name: "view", attributes: { type: FCT_VIEW_TYPES.TEXT, limit: "30", offset: "0" }, children: [] });
  }
  return { name: "query", attributes: rootAttributes, children };
}


/** Exposes Maestro's existing single query tree controller to the wireframe. */
export function useWorkbenchQueryController() {
  return useFctQuery();
}

/** Pure immutable query operations; no duplicate query state is created. */
export const workbenchQueryTreeApi = fctQueryTreeApi;
