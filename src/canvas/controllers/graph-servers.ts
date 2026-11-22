"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createGraphServerHealthController } from "@/lib/app-lifecycle/graph-server-health-actor";
import { createGraphServerSelectionController } from "@/lib/app-lifecycle/graph-server-selection-actor";
import { initializeMaestroStorage } from "@/lib/maestro-storage";
import { collectSharedGraphServer, flattenGraphServerDirectory, readGraphServerDirectory, validGraphServerUrl } from "@/lib/graph-server-directory";
import type { EndpointOption, EndpointStatus } from "@/canvas/top/appbar";

/** State owned by the graph-servers subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useGraphServersState() {
  const [endpointReloadRevision, setEndpointReloadRevision] = useState(0);
  const [queryRefreshRevision, setQueryRefreshRevision] = useState(0);
  // Courtesy entries and user-owned Shared entries are separate. A courtesy
  // digest refresh can never delete or overwrite a Shared server.
  const [courtesyEndpoints, setFctEndpoints] = useState<EndpointOption[]>([]);
  const [managedEndpoints, setManagedEndpoints] = useState<EndpointOption[]>([]);
  const [sharedEndpoints, setSharedEndpoints] = useState<EndpointOption[]>([]);
  const [graphServerDirectoryHydrated, setGraphServerDirectoryHydrated] = useState(false);
  const fctEndpoints = useMemo(() => {
    const seen = new Set<string>();
    return [...managedEndpoints, ...courtesyEndpoints, ...sharedEndpoints].filter((entry) => {
      if (seen.has(entry.url)) return false;
      seen.add(entry.url); return true;
    });
  }, [sharedEndpoints, courtesyEndpoints, managedEndpoints]);
  useEffect(() => {
    let live = true;
    void initializeMaestroStorage().then(() => {
      if (live) setSharedEndpoints(readGraphServerDirectory().groups.Shared);
    }).catch(() => {
      // The menu still becomes interactive when persistent storage is blocked.
    }).finally(() => {
      // Directory hydration (including a failed IndexedDB read) is separate
      // from an FCT query having a selected execution address.
      if (live) setGraphServerDirectoryHydrated(true);
    });
    return () => { live = false; };
  }, []);
  const [selectionController] = useState(createGraphServerSelectionController);
  const selection = useSyncExternalStore(selectionController.subscribe, selectionController.getSnapshot, selectionController.getSnapshot);
  const selectedEndpointId = selection.selectedId;
  useLayoutEffect(() => { selectionController.start(); return () => selectionController.stop(); }, [selectionController]);
  useLayoutEffect(() => { selectionController.updateRegistry(fctEndpoints); }, [selectionController, fctEndpoints]);
  const observeAndCollectGraphServerQuery = useCallback((url: string) => {
    selectionController.observeQuery(url);
    const normalized = validGraphServerUrl(url);
    if (!normalized) return;
    const shared: EndpointOption = { id: `shared:${encodeURIComponent(normalized)}`,
      url: normalized, label: normalized, group: "Shared" };
    setSharedEndpoints((current) => current.some((entry) => entry.url === normalized) ? current : [...current, shared]);
    void initializeMaestroStorage().then(() => {
      const directory = collectSharedGraphServer(normalized);
      setSharedEndpoints(directory.groups.Shared);
    });
  }, [selectionController]);
  const observeGraphServerQuery = observeAndCollectGraphServerQuery;
  // No direct menu-preference setter: the controller observes the committed
  // FCT execution address. A saved preference is read by query initialization,
  // never installed as a parallel menu-selected source of truth.
  // The health actor, not an independent React reducer, owns statuses.
  const [healthController] = useState(createGraphServerHealthController);
  const endpointStatuses = useSyncExternalStore(healthController.subscribe, healthController.getSnapshot, healthController.getSnapshot);
  useLayoutEffect(() => { healthController.start(); return () => healthController.stop(); }, [healthController]);
  const setEndpointStatuses = useCallback((next: Record<string, EndpointStatus> | ((current: Record<string, EndpointStatus>) => Record<string, EndpointStatus>)) =>
    healthController.replace(next), [healthController]);
  const reportGraphHealthFailure = useCallback((id: string, endpointUrl: string, diagnostic: string, at = Date.now()) =>
    healthController.send({ type: "TRANSPORT_FAILED", id, endpointUrl, diagnostic, at }), [healthController]);
  const reportGraphHealthProbe = useCallback((status: EndpointStatus, startedAt: number) =>
    healthController.reportProbe(status, startedAt), [healthController]);
  const [isCheckingEndpoints, setIsCheckingEndpoints] = useState(false);
  const [checkingEndpointIds, setCheckingEndpointIds] = useState<Record<string, boolean>>({});
  const [endpointChecksCompleted, setEndpointChecksCompleted] = useState(0);
  const [endpointChecksTotal, setEndpointChecksTotal] = useState(0);
  const [endpointMenuError, setEndpointMenuError] = useState("");
  const [endpointHealthToast, setEndpointHealthToast] = useState<{ endpointId: string; message: string } | null>(null);
  const [isRefreshingFailedEndpoint, setIsRefreshingFailedEndpoint] = useState(false);

  return {
    managedEndpoints, setManagedEndpoints,
    endpointReloadRevision,
    setEndpointReloadRevision,
    queryRefreshRevision,
    setQueryRefreshRevision,
    fctEndpoints,
    graphServerDirectoryHydrated,
    setFctEndpoints,
    selectedEndpointId,
    observeGraphServerQuery,
    endpointStatuses,
    setEndpointStatuses,
    reportGraphHealthFailure,
    reportGraphHealthProbe,
    isCheckingEndpoints,
    setIsCheckingEndpoints,
    checkingEndpointIds,
    setCheckingEndpointIds,
    endpointChecksCompleted,
    setEndpointChecksCompleted,
    endpointChecksTotal,
    setEndpointChecksTotal,
    endpointMenuError,
    setEndpointMenuError,
    endpointHealthToast,
    setEndpointHealthToast,
    isRefreshingFailedEndpoint,
    setIsRefreshingFailedEndpoint,
  };
}
