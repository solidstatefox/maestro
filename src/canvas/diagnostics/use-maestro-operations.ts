"use client";

import { useLayoutEffect, useEffect, useState, useSyncExternalStore } from "react";
import { subscribePendingMaestroQueryDetails } from "@/lib/client-query-cache";
import {
  createMaestroOperationsController, selectMaestroExecution,
  type NavigationTab,
} from "@/lib/app-lifecycle/operations";

export function useMaestroOperations(facts: {
  graphKey: string;
  graphRegistryReady: boolean;
  graphSelected: boolean;
  graphReady: boolean; // Authoritative HTTP health probe, not named-graph discovery
  querySourceReady: boolean; // Health AND the independent graph-resolution preflight
  graphFailed: boolean;
  queryKey: string;
  queryHydrated: boolean;
  navigationKey: string;
  navigationUrl: string;
  navigationTab: NavigationTab;
  navigationIsProvider: boolean;
  restoringHistory: boolean;
}) {
  const [controller] = useState(createMaestroOperationsController);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useLayoutEffect(() => {
    controller.send({ type: "GRAPH_OBSERVED", key: facts.graphKey, registryReady: facts.graphRegistryReady,
      selected: facts.graphSelected, ready: facts.graphReady, failed: facts.graphFailed });
    controller.send({ type: "QUERY_OBSERVED", key: facts.queryKey, hydrated: facts.queryHydrated, graphReady: facts.querySourceReady });
    controller.send({ type: "NAVIGATION_OBSERVED", key: facts.navigationKey, url: facts.navigationUrl,
      tab: facts.navigationTab, hydrated: facts.queryHydrated, isProviderQuery: facts.navigationIsProvider,
      restoringHistory: facts.restoringHistory });
  }, [controller, facts.graphKey, facts.graphRegistryReady, facts.graphSelected, facts.graphReady,
    facts.querySourceReady, facts.graphFailed, facts.queryKey, facts.queryHydrated, facts.navigationKey, facts.navigationUrl,
    facts.navigationTab, facts.navigationIsProvider, facts.restoringHistory]);
  useEffect(() => subscribePendingMaestroQueryDetails((items) => {
    controller.send({ type: "REQUEST_ACTIVITY", queued: items.filter(item => item.state === "queued").length,
      active: items.filter(item => item.state === "active").length });
  }), [controller]);
  const execution = selectMaestroExecution(snapshot, { graphKey: facts.graphKey,
    queryKey: facts.queryKey, hydrated: facts.queryHydrated, sourceReady: facts.querySourceReady });
  return { controller, snapshot, execution };
}
