import { assign, createActor, setup } from "xstate";

/** Phase D: the provider discovery response is already SHACL-validated and
 * approval-filtered by the personal graph server. Never infer applicability
 * from property names, result-page values or a previous unrelated query. */
export type DateProviderMatch = { uri: string; property: string; label: string };
export type NumericProviderMatch = {
  uri: string;
  eligibleProperties: string[];
  projections: Array<{
    aggregate: "MIN" | "MAX" | "AVG" | "SUM";
    expression: "xsd:decimal(?facetValue)" | "?facetNumber";
    alias: string;
  }>;
};
export type TagProviderMatch = { uri: string; property: string };
export type ProviderMatches = {
  temporal: DateProviderMatch[];
  numeric: NumericProviderMatch[];
  tags: TagProviderMatch[];
};
export type ProviderDiscoveryPhase = "inactive" | "discovering" | "ready" | "empty" | "failed";
const noMatches = (): ProviderMatches => ({ temporal: [], numeric: [], tags: [] });
type DiscoveryContext = {
  requestKey: string;
  applicabilityKey: string;
  matches: ProviderMatches;
  validatedKey: string;
  validatedEvidenceKey: string;
  error: string;
};
export type ProviderDiscoveryEvent =
  | { type: "DISCOVERY_INACTIVE" }
  | { type: "DISCOVERY_STARTED"; requestKey: string; applicabilityKey: string; evidenceKey: string }
  | { type: "DISCOVERY_RESOLVED"; requestKey: string; matches: ProviderMatches; evidenceKey: string }
  | { type: "DISCOVERY_TAGS_RESOLVED"; requestKey: string; tags: TagProviderMatch[] }
  | { type: "DISCOVERY_FAILED"; requestKey: string; error: string };
const empty: DiscoveryContext = {
  requestKey: "", applicabilityKey: "", matches: noMatches(), validatedKey: "", validatedEvidenceKey: "", error: "",
};
function compatibleEvidence(currentKey: string, validatedKey: string): boolean {
  const current = JSON.parse(currentKey) as Record<string, string[]>;
  const validated = JSON.parse(validatedKey || "{}") as Record<string, string[]>;
  return Object.entries(current).every(([property, datatypes]) => !datatypes.length ||
    JSON.stringify([...datatypes].sort()) === JSON.stringify([...(validated[property] ?? [])].sort()));
}

/** Retain a previously SHACL-validated numeric match only when the *same*
 * scoped property has no new positive datatype evidence. This covers editing
 * a numeric range, which may temporarily suppress its own value evidence.
 * Explicit new evidence always causes fresh validation to replace the match. */
function settleMatches(context: DiscoveryContext, event: Extract<ProviderDiscoveryEvent, { type: "DISCOVERY_RESOLVED" }>): ProviderMatches {
  if (context.validatedKey !== context.applicabilityKey || !compatibleEvidence(event.evidenceKey, context.validatedEvidenceKey)) return event.matches;
  const evidence = JSON.parse(event.evidenceKey) as Record<string, string[]>;
  const numeric = event.matches.numeric.map(provider => ({ ...provider, eligibleProperties: [...provider.eligibleProperties] }));
  for (const previous of context.matches.numeric) {
    const retained = previous.eligibleProperties.filter(property => !(evidence[property]?.length));
    if (!retained.length) continue;
    const current = numeric.find(provider => provider.uri === previous.uri);
    if (current) current.eligibleProperties = [...new Set([...current.eligibleProperties, ...retained])];
    else numeric.push({ ...previous, eligibleProperties: retained });
  }
  return { ...event.matches, numeric };
}

export const maestroProviderDiscoveryMachine = setup({
  types: { context: {} as DiscoveryContext, events: {} as ProviderDiscoveryEvent },
}).createMachine({
  id: "maestro-facet-provider-discovery", initial: "inactive", context: empty,
  on: {
    DISCOVERY_INACTIVE: { target: ".inactive", actions: assign(() => ({ ...empty, matches: noMatches() })) },
    DISCOVERY_STARTED: { target: ".discovering", actions: assign(({ context, event }) => ({
      requestKey: event.requestKey,
      applicabilityKey: event.applicabilityKey,
      // Retain the last confirmed provider for the same structural facet scope
      // during evidence refresh; DISCOVERY_RESOLVED replaces it authoritatively.
      // Discovery is an observation, never a temporary renderer-removal event.
      matches: context.validatedKey === event.applicabilityKey ? context.matches : noMatches(),
      validatedKey: context.validatedKey === event.applicabilityKey ? context.validatedKey : "",
      validatedEvidenceKey: context.validatedKey === event.applicabilityKey ? context.validatedEvidenceKey : "",
      error: "",
    })) },
    // Tag clouds depend on the selected predicate and provider approval, not
    // numeric/date datatype probing. Publish them independently while optional
    // Calendar/Numeric discovery continues in its own async work.
    DISCOVERY_TAGS_RESOLVED: {
      guard: ({ context, event }) => context.requestKey === event.requestKey,
      actions: assign(({ context, event }) => ({
        matches: { ...context.matches, tags: event.tags },
        validatedKey: context.applicabilityKey,
      })),
    },
    DISCOVERY_RESOLVED: [
      { guard: ({ context, event }) => context.requestKey === event.requestKey &&
          (() => { const matches = settleMatches(context, event); return matches.temporal.length + matches.numeric.length + matches.tags.length > 0; })(),
        target: ".ready", actions: assign(({ context, event }) => ({
          matches: settleMatches(context, event), validatedKey: context.applicabilityKey,
          validatedEvidenceKey: event.evidenceKey, error: "",
        })) },
      { guard: ({ context, event }) => context.requestKey === event.requestKey,
        target: ".empty", actions: assign(({ context, event }) => ({ matches: noMatches(), validatedKey: context.applicabilityKey, validatedEvidenceKey: event.evidenceKey, error: "" })) },
    ],
    DISCOVERY_FAILED: { guard: ({ context, event }) => context.requestKey === event.requestKey,
      target: ".failed", actions: assign(({ event }) => ({
        // A failed refresh is not a SHACL nonconformance report. Retain the
        // last validated presentation for the same facet structural scope.
        error: event.error,
      })) },
  },
  states: { inactive: {}, discovering: {}, ready: {}, empty: {}, failed: {} },
});
function newDiscoveryActor() { return createActor(maestroProviderDiscoveryMachine); }
export function createMaestroProviderDiscoveryController() {
  let actor: ReturnType<typeof newDiscoveryActor> | null = null;
  let subscription: { unsubscribe(): void } | null = null;
  let snapshot = newDiscoveryActor().getSnapshot();
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = newDiscoveryActor();
      subscription = actor.subscribe(next => { snapshot = next; publish(); });
      actor.start();
    },
    stop() {
      subscription?.unsubscribe(); subscription = null;
      actor?.stop(); actor = null;
      snapshot = newDiscoveryActor().getSnapshot(); publish();
    },
    send(event: ProviderDiscoveryEvent) { actor?.send(event); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MaestroProviderDiscoveryController = ReturnType<typeof createMaestroProviderDiscoveryController>;

/** Pure selector checks the desired scope before React's effect runs. This
 * closes stale-provider gates immediately on a graph, class or focus change. */
export function selectProviderMatches(
  snapshot: ReturnType<MaestroProviderDiscoveryController["getSnapshot"]>,
  requestKey: string, applicabilityKey: string, evidenceKey = "{}",
): ProviderMatches & { phase: ProviderDiscoveryPhase; error: string } {
  const phase: ProviderDiscoveryPhase = !requestKey ? "inactive" :
    snapshot.context.requestKey === requestKey ? snapshot.value as ProviderDiscoveryPhase : "discovering";
  const verified = Boolean(applicabilityKey) && snapshot.context.applicabilityKey === applicabilityKey &&
    snapshot.context.validatedKey === applicabilityKey &&
    (phase === "discovering" || phase === "failed" || phase === "ready") &&
    compatibleEvidence(evidenceKey, snapshot.context.validatedEvidenceKey);
  const matches = verified ? snapshot.context.matches : noMatches();
  // Independent tag discovery has no datatype-evidence prerequisite. The
  // numeric/temporal compatibility check may invalidate their projections,
  // but must not make an already approved Tag Cloud disappear in that gap.
  const tags = snapshot.context.applicabilityKey === applicabilityKey &&
    snapshot.context.validatedKey === applicabilityKey && phase !== "inactive" && phase !== "empty"
    ? snapshot.context.matches.tags : [];
  return { ...matches, tags, phase, error: phase === "failed" ? snapshot.context.error : "" };
}

/** FCT scope identity for provider metadata. Selected literal/range values
 * on the configured facet properties are deliberately not SHACL applicability
 * inputs; other FCT filters, focus, graph, and classes remain in the key. */
export function facetProviderApplicabilityKey(queryXml: string, propertyIris: string[]): string {
  if (!queryXml || !propertyIris.length) return "";
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return queryXml;
  const doc = new DOMParser().parseFromString(queryXml, "application/xml");
  if (doc.querySelector("parsererror")) return queryXml;
  const properties = new Set(propertyIris);
  const nodes = Array.from(doc.getElementsByTagName("*"));
  for (const node of nodes) {
    // XML node and query ids are internal mutation counters, never scope.
    // Allocation counters, provenance IDs, and viewer-only grouping are not
    // SHACL applicability constraints. A revisit can allocate new IDs while
    // preserving the identical facet population and approved Tag Cloud.
    for (const attribute of ["id", "uid", "ctr", "uctr", "rid", "rctr", "pid", "group"]) node.removeAttribute(attribute);
    if (node.localName === "value") {
      node.removeAttribute("uiResolution"); node.removeAttribute("uiCell");
    }
    if (node.localName === "view") {
      node.removeAttribute("offset"); node.removeAttribute("limit");
    }
    if (node.localName === "property" && properties.has(node.getAttribute("iri") ?? "")) {
      for (const child of Array.from(node.children)) if (child.localName === "value") child.remove();
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

/** Widget instance lifecycle is distinct from SHACL eligibility. The widget
 * reports its actual domain request and renderer readiness; status is local
 * and never persisted into RDF. */
export type ProviderInstancePhase = "inactive" | "applicable" | "loading" | "ready" | "failed";
type InstanceContext = { identity: string; error: string };
export type ProviderInstanceEvent =
  | { type: "INSTANCE_APPLICABLE"; identity: string }
  | { type: "INSTANCE_LOADING" | "INSTANCE_READY"; identity: string }
  | { type: "INSTANCE_FAILED"; identity: string; error: string }
  | { type: "INSTANCE_INACTIVE" };
const providerInstanceMachine = setup({
  types: { context: {} as InstanceContext, events: {} as ProviderInstanceEvent },
}).createMachine({
  id: "maestro-provider-widget-instance", initial: "inactive", context: { identity: "", error: "" },
  on: {
    INSTANCE_INACTIVE: { target: ".inactive", actions: assign({ identity: "", error: "" }) },
    INSTANCE_APPLICABLE: { target: ".applicable", actions: assign(({ event }) => ({ identity: event.identity, error: "" })) },
    INSTANCE_LOADING: { guard: ({ context, event }) => context.identity === event.identity,
      target: ".loading", actions: assign({ error: "" }) },
    INSTANCE_READY: { guard: ({ context, event }) => context.identity === event.identity,
      target: ".ready", actions: assign({ error: "" }) },
    INSTANCE_FAILED: { guard: ({ context, event }) => context.identity === event.identity,
      target: ".failed", actions: assign(({ event }) => ({ error: event.error })) },
  },
  states: { inactive: {}, applicable: {}, loading: {}, ready: {}, failed: {} },
});
function newInstanceActor() { return createActor(providerInstanceMachine); }
export function createMaestroProviderInstanceController() {
  let actor: ReturnType<typeof newInstanceActor> | null = null;
  let subscription: { unsubscribe(): void } | null = null;
  let snapshot = newInstanceActor().getSnapshot();
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = newInstanceActor();
      subscription = actor.subscribe(next => { snapshot = next; publish(); });
      actor.start();
    },
    stop() {
      subscription?.unsubscribe(); subscription = null;
      actor?.stop(); actor = null;
      snapshot = newInstanceActor().getSnapshot(); publish();
    },
    send(event: ProviderInstanceEvent) { actor?.send(event); },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
