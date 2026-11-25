"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWorkbenchQueryController } from "@/canvas/utils/query-controller";
import { createRootBreadcrumbController, rootBreadcrumbEditing, rootBreadcrumbSignalsOpen } from "@/lib/app-lifecycle/root-breadcrumb";
import type { FctUiResultSummary } from "@/lib/fct-query-api";

/** State owned by the query-session subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useQuerySessionState() {
  const [selectedUri, setSelectedUri] = useState("");
  const [urlStateInitialized, setUrlStateInitialized] = useState(false);
  // Diagnostic only. The XState query actor owns the terminal failure phase;
  // this message lets the shell offer recovery without exposing raw query XML.
  const [urlRestoreError, setUrlRestoreError] = useState("");
  const [querySourceFormat, setQuerySourceFormat] = useState<"xml" | "sparql" | "alphabet-xml" | "alphabet-sparql" | "list-values-xml" | "list-values-sparql" | "response" | "perspectives-sparql" | "providers-sparql" | "analysis-sparql">("xml");
  const [sparqlQuery, setSparqlQuery] = useState("");
  const [sparqlExecutionAddr, setSparqlExecutionAddr] = useState("");
  const [breadcrumbTrail, setBreadcrumbTrail] = useState<
  { id: string; uri: string; name: string }[]
>([]);
  const ancestorGhostRetainedRef = useRef(false);
  const previousActiveGhostPathRef = useRef<string[]>([]);
  const previousScopeRelationshipsRef = useRef<Map<string, string[]>>(new Map());
  const [rootBreadcrumb] = useState(createRootBreadcrumbController);
  const rootBreadcrumbSnapshot = useSyncExternalStore(rootBreadcrumb.subscribe, rootBreadcrumb.getSnapshot, rootBreadcrumb.getSnapshot);
  useEffect(() => { rootBreadcrumb.start(); return () => rootBreadcrumb.stop(); }, [rootBreadcrumb]);
  const rootSearchExpanded = rootBreadcrumbEditing(rootBreadcrumbSnapshot);
  const signalPickerExpanded = rootBreadcrumbSignalsOpen(rootBreadcrumbSnapshot);
  // Existing navigation and query actions retain their public setter contract,
  // but both values now derive exclusively from the root XState actor.
  const setRootSearchExpanded = (next: boolean) => rootBreadcrumb.send({ type: "SET_EDITOR", open: next });
  const setSignalPickerExpanded = (next: boolean) => rootBreadcrumb.send({ type: "SET_SIGNAL", open: next });
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
    urlRestoreError,
    setUrlRestoreError,
    querySourceFormat,
    setQuerySourceFormat,
    sparqlQuery,
    setSparqlQuery,
    sparqlExecutionAddr,
    setSparqlExecutionAddr,
    breadcrumbTrail,
    setBreadcrumbTrail,
    ancestorGhostRetainedRef,
    previousActiveGhostPathRef,
    previousScopeRelationshipsRef,
    rootBreadcrumb,
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
