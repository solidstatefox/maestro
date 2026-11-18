"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { assign, createActor, setup } from "xstate";
import { discoverMapProvider } from "@/lib/map-provider";
import { hasMapProviderInput } from "@/lib/client-map-eligibility";
import { effectiveMaestroLanguage } from "@/lib/maestro-language";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";

export type MapProviderDefinition = { uri: string; label: string; stylesheet: string; kind: "map"; icon: string; shapeUri: string; queryStylesheet: string; resultStylesheet: string; paletteStylesheet: string };
type Context = { provider: MapProviderDefinition | null; error: string };
type Event = { type: "START" } | { type: "RESOLVED"; provider: MapProviderDefinition | null }
  | { type: "FAILED"; message: string } | { type: "RESET" };

/** One XState-owned discovery per live-query scope, shared by Ribbon and Page.
 * Eligibility/approval and map point queries are runtime concerns; a valid
 * provider is not removed merely because its current result set has no points.
 * A failed discovery is reported instead of silently hiding the button. */
export const mapProviderDiscoveryMachine = setup({
  types: { context: {} as Context, events: {} as Event },
}).createMachine({
  id: "maestro-map-provider-discovery", initial: "idle",
  context: { provider: null, error: "" },
  states: {
    idle: { on: { START: "loading" } },
    loading: { on: {
      RESOLVED: { target: "ready", actions: assign(({ event }) => ({ provider: event.type === "RESOLVED" ? event.provider : null, error: "" })) },
      FAILED: { target: "error", actions: assign(({ event }) => ({ error: event.type === "FAILED" ? event.message : "Map discovery failed.", provider: null })) },
      RESET: "idle",
    } },
    ready: { on: { RESET: { target: "idle", actions: assign({ provider: null, error: "" }) } } },
    error: { on: { START: "loading", RESET: "idle" } },
  },
});

function createScope(queryXml: string) {
  const actor = createActor(mapProviderDiscoveryMachine);
  actor.start();
  let consumers = 0;
  let pending: AbortController | null = null;
  let attempted = false;
  function load() {
    if (pending || attempted) return;
    attempted = true;
    const controller = new AbortController();
    pending = controller;
    actor.send({ type: "START" });
    void discoverMapProvider(controller.signal)
      .then(async provider => {
        if (controller.signal.aborted) return;
        if (!provider) {
          actor.send({ type: "FAILED", message: "No registered Maps perspective provider was discovered in the personal policy graph." });
          return;
        }
        const approvals = await readClientPolicyApprovals([provider.uri], controller.signal);
        if (controller.signal.aborted) return;
        if (approvals[0]?.status !== "Approved") {
          actor.send({ type: "FAILED", message: "The registered Maps perspective provider has not been approved." });
          return;
        }
        const eligible = await hasMapProviderInput(provider, queryXml, controller.signal);
        if (controller.signal.aborted) return;
        // Ineligible Maps aren't a broken provider: don't add a ribbon button.
        actor.send({ type: "RESOLVED", provider: eligible ? provider : null });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        actor.send({ type: "FAILED", message: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => { if (pending === controller) pending = null; });
  }
  return {
    subscribe: (listener: () => void) => { const sub = actor.subscribe(listener); return () => sub.unsubscribe(); },
    getSnapshot: () => actor.getSnapshot(),
    retain: () => { consumers++; load(); return () => {
      consumers--;
      if (consumers === 0) {
        if (pending) { pending.abort(); pending = null; }
        // Error is retryable on a later View entry or after user approval;
        // a ready definition remains cached until its query scope changes.
        if (actor.getSnapshot().matches("error") || actor.getSnapshot().matches("loading")) {
          attempted = false; actor.send({ type: "RESET" });
        }
      }
    }; },
  };
}
const scopes = new Map<string, ReturnType<typeof createScope>>();
function scopeFor(key: string) {
  let scope = scopes.get(key);
  if (!scope) {
    scope = createScope(key.slice(0, key.lastIndexOf("\u0000"))); scopes.set(key, scope);
    // Bound old query-state retention; never evict the latest scope itself.
    if (scopes.size > 8) scopes.delete(scopes.keys().next().value!);
  }
  return scope;
}
export function useMapProviderDiscovery(enabled: boolean, queryXml: string) {
  const language = effectiveMaestroLanguage();
  const scope = useMemo(() => scopeFor(`${queryXml || ""}\u0000${language}`), [queryXml, language]);
  const snapshot = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot);
  useEffect(() => enabled && queryXml ? scope.retain() : undefined, [enabled, queryXml, scope]);
  return { provider: enabled ? snapshot.context.provider : null,
    error: enabled && snapshot.matches("error") ? snapshot.context.error : "",
    loading: enabled && snapshot.matches("loading") };
}
/** Backwards-compatible reader, still backed by the shared XState actor. */
export function useMapProviderDefinition(enabled: boolean, queryXml: string) {
  return useMapProviderDiscovery(enabled, queryXml).provider;
}
