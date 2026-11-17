import { assign, createActor, setup } from "xstate";

/** Diagnostics are a passive projection, not twelve shadow domain machines.
 * The authoritative access, graph/query, Record, provider catalog, and RDF status actors
 * continue to own transitions; this one actor only records observations. */
export const LIFECYCLE_DOMAINS = [
  "authentication", "personalStore", "graphServer", "liveQuery", "bookmark",
  "navigation", "providerCatalog", "presentation", "providers", "configure",
  "record", "requests",
] as const;
export type LifecycleDomain = (typeof LIFECYCLE_DOMAINS)[number];
export type LifecycleObservation = Readonly<{ state: string; note?: string }>;
export type LifecycleObservations = Partial<Record<LifecycleDomain, LifecycleObservation>>;
export type LifecycleChange = Readonly<{
  ordinal: number;
  domain: LifecycleDomain;
  from: string;
  to: string;
}>;
export type LifecycleSnapshot = Readonly<{
  running: boolean;
  observed: Readonly<Record<LifecycleDomain, LifecycleObservation>>;
  changes: readonly LifecycleChange[];
  observations: number;
}>;
type DiagnosticContext = Pick<LifecycleSnapshot, "observed" | "changes" | "observations">;
const HISTORY_LIMIT = 48;
const DEFAULT_OBSERVATION: LifecycleObservation = Object.freeze({ state: "unobserved" });
const initialContext = (): DiagnosticContext => Object.freeze({
  observed: Object.freeze(Object.fromEntries(
    LIFECYCLE_DOMAINS.map(domain => [domain, DEFAULT_OBSERVATION]),
  ) as Record<LifecycleDomain, LifecycleObservation>),
  changes: Object.freeze([]) as readonly LifecycleChange[],
  observations: 0,
});

/** One projection function shared by the running actor and the stopped registry.
 * A sample which introduces no changes returns the identical context. */
function applyObservations(context: DiagnosticContext, sample: LifecycleObservations): DiagnosticContext {
  let observed: Record<LifecycleDomain, LifecycleObservation> | null = null;
  const changes: LifecycleChange[] = [];
  for (const domain of LIFECYCLE_DOMAINS) {
    const next = sample[domain];
    if (!next) continue;
    const previous = context.observed[domain];
    if (previous.state === next.state && previous.note === next.note) continue;
    const observation = Object.freeze({ state: next.state, ...(next.note ? { note: next.note } : {}) });
    observed ??= { ...context.observed };
    observed[domain] = observation;
    changes.push(Object.freeze({ ordinal: context.observations + changes.length + 1,
      domain, from: previous.state, to: next.state }));
  }
  if (!observed) return context;
  return Object.freeze({
    observed: Object.freeze(observed),
    changes: Object.freeze([...context.changes, ...changes].slice(-HISTORY_LIMIT)),
    observations: context.observations + changes.length,
  });
}

const diagnosticsMachine = setup({
  types: {
    context: {} as DiagnosticContext,
    input: {} as DiagnosticContext,
    events: {} as { type: "OBSERVED"; sample: LifecycleObservations },
  },
}).createMachine({
  id: "maestro-lifecycle-diagnostics",
  initial: "observing",
  context: ({ input }) => input,
  states: { observing: {
    on: { OBSERVED: { actions: assign(({ context, event }) => applyObservations(context, event.sample)) } },
  } },
});

type DiagnosticsActor = ReturnType<typeof createDiagnosticsActor>;
const createDiagnosticsActor = (context: DiagnosticContext) => createActor(diagnosticsMachine, { input: context });

/** Per-workspace diagnostic registry. Never a global singleton; no authority
 * over FCT requests, RDF statuses, credentials or UI capability gates. */
export function createMaestroLifecycleRegistry() {
  let actor: DiagnosticsActor | null = null;
  let subscription: { unsubscribe(): void } | null = null;
  let context: DiagnosticContext = initialContext();
  let running = false;
  let snapshot: LifecycleSnapshot = Object.freeze({ running, ...context });
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = Object.freeze({ running, ...context });
    for (const listener of listeners) listener();
  };
  return {
    start() {
      if (running) return;
      running = true;
      actor = createDiagnosticsActor(context);
      subscription = actor.subscribe(next => {
        if (next.context === context) return;
        context = next.context;
        publish();
      });
      actor.start();
      publish();
    },
    stop() {
      if (!running) return;
      context = actor?.getSnapshot().context ?? context;
      subscription?.unsubscribe(); subscription = null;
      actor?.stop(); actor = null;
      running = false;
      publish();
    },
    observe(sample: LifecycleObservations) {
      const next = applyObservations(context, sample);
      if (next === context) return;
      if (actor) actor.send({ type: "OBSERVED", sample });
      else { context = next; publish(); }
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Diagnostics only. There are no longer duplicate per-domain actors. */
    observationSnapshot(domain: LifecycleDomain) { return context.observed[domain]; },
    coordinatorSnapshot() { return actor?.getSnapshot() ?? null; },
  };
}
export type MaestroLifecycleRegistry = ReturnType<typeof createMaestroLifecycleRegistry>;
