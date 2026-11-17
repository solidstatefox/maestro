"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { LIFECYCLE_DOMAINS, type MaestroLifecycleRegistry } from "@/lib/app-lifecycle/coordinator";
import { type MaestroAccessController } from "@/lib/app-lifecycle/access";
import type { MaestroOperationsController } from "@/lib/app-lifecycle/operations";
import type { MaestroProviderCatalogController } from "@/lib/app-lifecycle/provider-catalog";

/** Developer-only opt-in: ?maestroLifecycle=1, without normal-UI side effects.
 * No credentials, query XML, Record URIs, or endpoint URLs are ever displayed. */
export function AppLifecycleDiagnostics({ registry, access, operations, providerCatalog }: { registry: MaestroLifecycleRegistry; access: MaestroAccessController; operations: MaestroOperationsController; providerCatalog: MaestroProviderCatalogController }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    setEnabled(new URLSearchParams(window.location.search).get("maestroLifecycle") === "1");
  }, []);
  if (!enabled) return null;
  return <LifecycleInspector registry={registry} access={access} operations={operations} providerCatalog={providerCatalog} />;
}

function LifecycleInspector({ registry, access, operations, providerCatalog }: { registry: MaestroLifecycleRegistry; access: MaestroAccessController; operations: MaestroOperationsController; providerCatalog: MaestroProviderCatalogController }) {
  const [expanded, setExpanded] = useState(false);
  const snapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const accessSnapshot = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const operationsSnapshot = useSyncExternalStore(operations.subscribe, operations.getSnapshot, operations.getSnapshot);
  const providerSnapshot = useSyncExternalStore(providerCatalog.subscribe, providerCatalog.getSnapshot, providerCatalog.getSnapshot);
  return <aside className="fixed bottom-3 right-3 z-[250] max-w-[min(24rem,90vw)] rounded-md border bg-popover text-popover-foreground shadow-lg" aria-label="Maestro XState lifecycle diagnostics">
    <button type="button" className="flex w-full items-center justify-between gap-4 px-3 py-2 text-xs font-medium hover:bg-accent" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
      <span>XState · Phase E</span><span>{snapshot.observations} changes {expanded ? "▾" : "▴"}</span>
    </button>
    {expanded && <div className="max-h-80 overflow-auto border-t px-3 py-2 text-xs">
      <div className="mb-2 space-y-1 border-b pb-2" aria-label="Access machine snapshot">
        <div>Authentication: {String(accessSnapshot.value)}</div>
        <div>Bookmark verification: {accessSnapshot.context.bookmark}</div>
        <div>Personal-store UI: {accessSnapshot.value === "signedIn" ? "enabled" : "disabled"}</div>
      </div>
      <div className="mb-2 space-y-1 border-b pb-2" aria-label="Operations and provider lifecycles">
        <div>Graph: {operationsSnapshot.graph.phase}</div>
        <div>Live query: {operationsSnapshot.query.phase}</div>
        <div>Navigation: {operationsSnapshot.navigation.hydrated ? operationsSnapshot.navigation.tab : "restoring"}</div>
        <div>Browse Return: {operationsSnapshot.navigation.returnUrl ? "available" : "unavailable"}</div>
        <div>History navigation: {operationsSnapshot.navigation.historyPending ?? "idle"}</div>
        <div>Requests: {operationsSnapshot.requests.queued + operationsSnapshot.requests.active} pending</div>
        <div>Provider catalog: {String(providerSnapshot.value)}</div>
        <div>Facet provider discovery: {snapshot.observed.providers.state}</div>
        <div>Configure transaction: {snapshot.observed.configure.state}</div>
        <div>Browse Record lifecycle: {snapshot.observed.record.state}</div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {LIFECYCLE_DOMAINS.map(domain => <div key={domain} className="col-span-2 grid grid-cols-subgrid gap-x-4">
          <dt className="font-medium">{domain}</dt><dd className="text-muted-foreground">{snapshot.observed[domain].state}</dd>
        </div>)}
      </dl>
      <div className="mt-2 border-t pt-2 font-medium">Recent transitions</div>
      <ol className="mt-1 space-y-1 text-muted-foreground" aria-label="Recent lifecycle state changes">
        {snapshot.changes.slice(-12).reverse().map(item => <li key={item.ordinal}>{item.domain}: {item.from} → {item.to}</li>)}
      </ol>
    </div>}
  </aside>;
}
