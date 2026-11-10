"use client";

import { useRef, useState } from "react";
import { useWorkbenchQueryController } from "@/canvas/utils/query-controller";
import type { FctUiResultSummary } from "@/lib/fct-query-api";

/** State owned by the query-session subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useQuerySessionState() {
  const [selectedUri, setSelectedUri] = useState("");
  const [urlStateInitialized, setUrlStateInitialized] = useState(false);
  const [querySourceFormat, setQuerySourceFormat] = useState<"xml" | "sparql" | "alphabet-xml" | "alphabet-sparql" | "list-values-xml" | "list-values-sparql" | "response">("xml");
  const [sparqlQuery, setSparqlQuery] = useState("");
  const [breadcrumbTrail, setBreadcrumbTrail] = useState<
  { id: string; uri: string; name: string }[]
>([]);
  const ancestorGhostRetainedRef = useRef(false);
  const previousActiveGhostPathRef = useRef<string[]>([]);
  const previousScopeRelationshipsRef = useRef<Map<string, string[]>>(new Map());
  const [signalPickerExpanded, setSignalPickerExpanded] = useState(false);
  const [rootSearchExpanded, setRootSearchExpanded] = useState(false);
  const rootUriLabelCacheRef = useRef<Map<string, string>>(new Map());
  const [namePropertyMenuOpen, setNamePropertyMenuOpen] = useState(false);
  const [breadcrumbPreviewSummaries, setBreadcrumbPreviewSummaries] = useState<Record<string, FctUiResultSummary>>({});
  const [breadcrumbMenuPreviewSummaries, setBreadcrumbMenuPreviewSummaries] = useState<Record<string, FctUiResultSummary>>({});
  const [breadcrumbPreviewPendingIds, setBreadcrumbPreviewPendingIds] = useState<Set<string>>(() => new Set());
  const metadataRegistryRef = useRef<Map<string, FctUiResultSummary>>(new Map());
  const [collapsedQueryNodeIds, setCollapsedQueryNodeIds] = useState<Set<string>>(() => new Set());

  return {
    selectedUri,
    setSelectedUri,
    urlStateInitialized,
    setUrlStateInitialized,
    querySourceFormat,
    setQuerySourceFormat,
    sparqlQuery,
    setSparqlQuery,
    breadcrumbTrail,
    setBreadcrumbTrail,
    ancestorGhostRetainedRef,
    previousActiveGhostPathRef,
    previousScopeRelationshipsRef,
    signalPickerExpanded,
    setSignalPickerExpanded,
    rootSearchExpanded,
    setRootSearchExpanded,
    rootUriLabelCacheRef,
    namePropertyMenuOpen,
    setNamePropertyMenuOpen,
    breadcrumbPreviewSummaries,
    setBreadcrumbPreviewSummaries,
    breadcrumbMenuPreviewSummaries,
    setBreadcrumbMenuPreviewSummaries,
    breadcrumbPreviewPendingIds,
    setBreadcrumbPreviewPendingIds,
    metadataRegistryRef,
    collapsedQueryNodeIds,
    setCollapsedQueryNodeIds,
  };
}

/** The canvas subscribes to the existing FCT tree; this does not create a second store. */
export function useQuerySessionController() {
  return useWorkbenchQueryController();
}
