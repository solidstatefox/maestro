"use client";

import { assign, createActor, setup } from "xstate";
import { graphServerUrlMatches } from "@/lib/graph-server-health";
import type { EndpointOption } from "@/canvas/top/appbar";

/** A registry ID is an ephemeral menu key. The query's server URL is the
 * execution identity, even when login/logout replaces the registry entries. */
const sharedId = (url: string): string => {
  try {
    const normalized = new URL(url.trim());
    return ["http:", "https:"].includes(normalized.protocol) && !normalized.username && !normalized.password
      ? `shared:${encodeURIComponent(normalized.toString())}` : "";
  } catch { return ""; }
};
export function resolveGraphServerId(
  endpoints: readonly EndpointOption[], queryUrl: string, preferredUrl: string,
): string {
  const desired = queryUrl.trim() || preferredUrl.trim();
  if (desired) {
    const match = endpoints.find((entry) => entry.id === desired ||
      graphServerUrlMatches(entry.url, desired, entry.schemeInferred));
    // The server list is a courtesy: an unknown explicit query URL belongs in
    // the user's Shared group, never in a selection error or fallback group.
    if (match) return match.id;
    if (queryUrl.trim()) return sharedId(queryUrl);
    return sharedId(preferredUrl) || endpoints[0]?.id || "";
  }
  return endpoints[0]?.id ?? "";
}

export type GraphServerSelectionSnapshot = Readonly<{
  selectedId: string;
  queryUrl: string;
  preferredUrl: string;
}>;
type SelectionContext = {
  endpoints: EndpointOption[];
  queryUrl: string;
  preferredUrl: string;
  selectedId: string;
  preferenceHydrated: boolean;
};
type SelectionEvent =
  | { type: "REGISTRY_CHANGED"; endpoints: EndpointOption[] }
  | { type: "QUERY_ADDRESS_CHANGED"; serverUrl: string }
  | { type: "PREFERENCE_RESTORED"; serverUrl: string }
  | { type: "USER_SELECTED"; endpointId: string };

const initial: SelectionContext = { endpoints: [], queryUrl: "", preferredUrl: "", selectedId: "", preferenceHydrated: false };
const withPreference = (context: SelectionContext, endpoints: readonly EndpointOption[], queryUrl: string, preferredUrl: string) =>
  queryUrl || context.preferenceHydrated ? resolveGraphServerId(endpoints, queryUrl, preferredUrl) : "";
const machine = setup({
  types: { context: {} as SelectionContext, events: {} as SelectionEvent },
}).createMachine({
  id: "maestro-graph-server-selection", initial: "active", context: initial,
  states: { active: {} },
  on: {
    REGISTRY_CHANGED: { actions: assign(({ context, event }) => ({
      endpoints: event.endpoints,
      selectedId: withPreference(context, event.endpoints, context.queryUrl, context.preferredUrl),
    })) },
    QUERY_ADDRESS_CHANGED: { actions: assign(({ context, event }) => ({
      queryUrl: event.serverUrl,
      selectedId: withPreference(context, context.endpoints, event.serverUrl, context.preferredUrl),
    })) },
    PREFERENCE_RESTORED: { actions: assign(({ context, event }) => ({
      preferredUrl: event.serverUrl,
      preferenceHydrated: true,
      selectedId: resolveGraphServerId(context.endpoints, context.queryUrl, event.serverUrl),
    })) },
    USER_SELECTED: { actions: assign(({ context, event }) => {
      const endpoint = context.endpoints.find((item) => item.id === event.endpointId);
      if (!endpoint) return {};
      return {
        queryUrl: endpoint.url,
        preferredUrl: endpoint.url,
        selectedId: endpoint.id,
      };
    }) },
  },
});

const makeSelectionActor = () => createActor(machine);
type SelectionActor = ReturnType<typeof makeSelectionActor>;

/** Mirrors the Strict Mode-safe health-actor interface. The controller owns
 * selection and does not perform graph queries, authorization or health checks. */
export function createGraphServerSelectionController() {
  let actor: SelectionActor | null = null;
  let context = initial;
  let snapshot: GraphServerSelectionSnapshot = { selectedId: "", queryUrl: "", preferredUrl: "" };
  const listeners = new Set<() => void>();
  let subscription: { unsubscribe(): void } | null = null;
  const publish = () => {
    if (!actor) return;
    const next = actor.getSnapshot().context;
    context = next;
    if (snapshot.selectedId === next.selectedId && snapshot.queryUrl === next.queryUrl &&
        snapshot.preferredUrl === next.preferredUrl) return;
    snapshot = { selectedId: next.selectedId, queryUrl: next.queryUrl, preferredUrl: next.preferredUrl };
    listeners.forEach((listener) => listener());
  };
  const send = (event: SelectionEvent) => {
    if (actor) { actor.send(event); return; }
    // React effects attach after mount. Preserve input events during a Strict
    // Mode stop/start without reinitializing the source-of-truth query.
    if (event.type === "REGISTRY_CHANGED") context = { ...context,
      endpoints: event.endpoints,
      selectedId: withPreference(context, event.endpoints, context.queryUrl, context.preferredUrl) };
    else if (event.type === "QUERY_ADDRESS_CHANGED") context = { ...context,
      queryUrl: event.serverUrl,
      selectedId: withPreference(context, context.endpoints, event.serverUrl, context.preferredUrl) };
    else if (event.type === "PREFERENCE_RESTORED") context = { ...context,
      preferredUrl: event.serverUrl, preferenceHydrated: true,
      selectedId: resolveGraphServerId(context.endpoints, context.queryUrl, event.serverUrl) };
    else {
      const selected = context.endpoints.find((endpoint) => endpoint.id === event.endpointId);
      if (selected) context = { ...context, queryUrl: selected.url, preferredUrl: selected.url, selectedId: selected.id };
    }
    publishIfStopped();
  };
  const publishIfStopped = () => {
    if (actor) return;
    const next = { selectedId: context.selectedId, queryUrl: context.queryUrl, preferredUrl: context.preferredUrl };
    if (snapshot.selectedId === next.selectedId && snapshot.queryUrl === next.queryUrl &&
        snapshot.preferredUrl === next.preferredUrl) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    start() {
      if (actor) return;
      actor = makeSelectionActor();
      actor.start();
      // Reapply retained inputs before exposing the new actor's snapshot.
      actor.send({ type: "REGISTRY_CHANGED", endpoints: context.endpoints });
      if (context.preferenceHydrated) actor.send({ type: "PREFERENCE_RESTORED", serverUrl: context.preferredUrl });
      actor.send({ type: "QUERY_ADDRESS_CHANGED", serverUrl: context.queryUrl });
      subscription = actor.subscribe(publish);
      publish();
    },
    stop() { subscription?.unsubscribe(); subscription = null; actor?.stop(); actor = null; },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    updateRegistry(endpoints: EndpointOption[]) { send({ type: "REGISTRY_CHANGED", endpoints }); },
    observeQuery(serverUrl: string) { send({ type: "QUERY_ADDRESS_CHANGED", serverUrl }); },
    restorePreference(serverUrl: string) { send({ type: "PREFERENCE_RESTORED", serverUrl }); },
    choose(endpointId: string): string | null {
      const endpoint = context.endpoints.find((item) => item.id === endpointId);
      if (!endpoint) return null;
      send({ type: "USER_SELECTED", endpointId });
      return endpoint.url;
    },
  };
}
