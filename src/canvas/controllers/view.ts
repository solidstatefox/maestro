"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createMaestroViewDiscoveryController } from "@/lib/app-lifecycle/view-discovery";
import { createMaestroProviderCatalogController } from "@/lib/app-lifecycle/provider-catalog";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";

/** State owned by the view subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useViewState() {
  const [selectedViewUri, setSelectedViewUri] = useState("");
  const [viewPanel, setViewPanel] = useState<"trail" | "perspectives" | "providers">("perspectives");
  const [viewProvider, setViewProvider] = useState<ProviderKind | null>(null);
  const [viewDiscoveryController] = useState(() => createMaestroViewDiscoveryController("maestro-view-discovery", "perspective-discovery"));
  const viewDiscoverySnapshot = useSyncExternalStore(viewDiscoveryController.subscribe, viewDiscoveryController.getSnapshot, viewDiscoveryController.getSnapshot);
  useLayoutEffect(() => { viewDiscoveryController.start(); return () => viewDiscoveryController.stop(); }, [viewDiscoveryController]);
  const [providerCatalogController] = useState(createMaestroProviderCatalogController);
  const providerCatalogSnapshot = useSyncExternalStore(providerCatalogController.subscribe, providerCatalogController.getSnapshot, providerCatalogController.getSnapshot);
  useLayoutEffect(() => { providerCatalogController.start(); return () => providerCatalogController.stop(); }, [providerCatalogController]);
  const [viewRenderController] = useState(createMaestroProviderCatalogController);
  const viewRenderSnapshot = useSyncExternalStore(viewRenderController.subscribe, viewRenderController.getSnapshot, viewRenderController.getSnapshot);
  useLayoutEffect(() => { viewRenderController.start(); return () => viewRenderController.stop(); }, [viewRenderController]);
  const [viewDomainRanks, setViewDomainRanks] = useState<Record<string, string>>({});
  const [viewServerSoftware, setViewServerSoftware] = useState<Record<string, { product: string; version: string }>>({});
  const [viewServerDescriptions, setViewServerDescriptions] = useState<Record<string, string>>({});

  return {
    selectedViewUri,
    setSelectedViewUri,
    viewPanel,
    setViewPanel,
    viewProvider,
    setViewProvider,
    viewDiscoveryController,
    viewDiscoverySnapshot,
    providerCatalogController,
    providerCatalogSnapshot,
    viewRenderController,
    viewRenderSnapshot,
    viewDomainRanks,
    setViewDomainRanks,
    viewServerSoftware,
    setViewServerSoftware,
    viewServerDescriptions,
    setViewServerDescriptions,
  };
}
