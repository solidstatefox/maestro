"use client";

import { useEffect, useState } from "react";
import {
  createMaestroLifecycleRegistry,
  type LifecycleObservations,
} from "@/lib/app-lifecycle/coordinator";

/** Read-only diagnostics of the authoritative XState controllers and FCT
 * workspace. These never enable controls, dispatch queries or gate requests. */
export type AppLifecycleFacts = Readonly<{
  authRestored: boolean;
  signedIn: boolean;
  personalStoreReady: boolean;
  graphRegistryReady: boolean;
  selectedServerExists: boolean;
  selectedServerReady: boolean;
  selectedServerFailed: boolean;
  queryHydrated: boolean;
  queryStarted: boolean;
  queryReady: boolean;
  queryLoading: boolean;
  queryError: boolean;
  bookmarkVerified: boolean;
  queryBookmarked: boolean;
  presentationTab: "browse" | "view" | "analyze";
  viewProvidersOpen: boolean;
  providerCatalogLoading: boolean;
  providerCatalogError: boolean;
  providerPhase?: string;
  configurePhase?: string;
  returnAvailable: boolean;
  recordSelected: boolean;
  recordPhase?: string;
  recordLoading: boolean;
  recordReady: boolean;
  recordError: boolean;
  requestBusy: boolean;
}>;

/** Pure mapping for deterministic diagnostics and lifecycle assertions. */
export function projectAppLifecycle(facts: AppLifecycleFacts): LifecycleObservations {
  return {
    authentication: { state: !facts.authRestored ? "restoring" : facts.signedIn ? "signedIn" : "signedOut" },
    personalStore: { state: !facts.authRestored ? "checking" : !facts.signedIn ? "unavailable" : facts.personalStoreReady ? "ready" : "checking" },
    graphServer: { state: !facts.graphRegistryReady || !facts.selectedServerExists ? "checking" : facts.selectedServerReady ? "ready" : facts.selectedServerFailed ? "unavailable" : "checking" },
    liveQuery: { state: !facts.queryHydrated ? "hydrating" : !facts.queryReady ? "waitingForServer" : facts.queryLoading ? "executing" : facts.queryError ? "failed" : facts.queryStarted ? "ready" : "idle" },
    bookmark: { state: !facts.personalStoreReady ? "unavailable" : !facts.bookmarkVerified ? "checking" : facts.queryBookmarked ? "bookmarked" : "unbookmarked" },
    navigation: { state: !facts.queryHydrated ? "restoring" : facts.returnAvailable ? "returnAvailable" : "ready" },
    providerCatalog: { state: !facts.viewProvidersOpen ? "inactive" : facts.providerCatalogLoading ? "loading" : facts.providerCatalogError ? "error" : "ready" },
    presentation: { state: facts.presentationTab },
    record: { state: !facts.recordSelected ? "empty" : facts.recordPhase ||
      (facts.recordLoading ? "loading" : facts.recordError ? "failed" : facts.recordReady ? "ready" : "loading") },
    requests: { state: facts.requestBusy ? "busy" : "idle" },
    ...(facts.providerPhase ? { providers: { state: facts.providerPhase } } : {}),
    ...(facts.configurePhase ? { configure: { state: facts.configurePhase } } : {}),
  };
}

export function useAppLifecycleObserver(facts: AppLifecycleFacts) {
  const [registry] = useState(createMaestroLifecycleRegistry);
  useEffect(() => {
    registry.start();
    return () => registry.stop();
  }, [registry]);
  // Intentionally observe every committed render: source React state remains
  // authoritative, and registry.observe deduplicates identical samples.
  useEffect(() => { registry.observe(projectAppLifecycle(facts)); });
  return registry;
}
