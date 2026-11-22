"use client";

import { assign, createActor, setup } from "xstate";
import type { EndpointStatus } from "@/canvas/top/appbar";

/** One XState-owned health ledger for all configured endpoints. This actor is
 * observational: it never sends queries, changes query identity or cancels
 * work. The proxy scheduler and the existing health probe retain those jobs. */
type Ledger = { statuses: Record<string, EndpointStatus>; lastTransportFailure: Record<string, number> };
type HealthEvent =
  | { type: "RESTORE"; statuses: Record<string, EndpointStatus>; lastTransportFailure: Record<string, number> }
  | { type: "STATUS_REPLACED"; statuses: Record<string, EndpointStatus> }
  | { type: "TRANSPORT_FAILED"; id: string; endpointUrl: string; diagnostic: string; at: number }
  | { type: "PROBE_REPORTED"; status: EndpointStatus; startedAt: number };

const empty: Ledger = { statuses: {}, lastTransportFailure: {} };
const machine = setup({ types: { context: {} as Ledger, events: {} as HealthEvent } }).createMachine({
  id: "maestro-graph-server-health", initial: "observing", context: empty,
  states: { observing: {} },
  on: {
    RESTORE: { actions: assign(({ event }) => ({
      statuses: event.statuses, lastTransportFailure: event.lastTransportFailure,
    })) },
    STATUS_REPLACED: {
      actions: assign(({ context, event }) => {
        // A separately launched, older probe must not turn a newly degraded
        // endpoint green. PROBE_REPORTED is the only path for probe results.
        if (context.statuses === event.statuses) return {};
        return { statuses: event.statuses };
      }),
    },
    TRANSPORT_FAILED: {
      actions: assign(({ context, event }) => {
        if ((context.lastTransportFailure[event.id] ?? 0) > event.at) return {};
        const previous = context.statuses[event.id];
        const status: EndpointStatus = {
          id: event.id, status: null, state: "degraded", testedUrl: event.endpointUrl,
          diagnostic: event.diagnostic,
        };
        if (previous?.state === "degraded" && previous.diagnostic === status.diagnostic &&
            previous.testedUrl === status.testedUrl) {
          return { lastTransportFailure: { ...context.lastTransportFailure, [event.id]: event.at } };
        }
        return { statuses: { ...context.statuses, [event.id]: status },
          lastTransportFailure: { ...context.lastTransportFailure, [event.id]: event.at } };
      }),
    },
    PROBE_REPORTED: {
      actions: assign(({ context, event }) => {
        if ((context.lastTransportFailure[event.status.id] ?? 0) > event.startedAt) return {};
        const current = context.statuses[event.status.id];
        // A proxy error does not establish endpoint unreachability. Keep the
        // transport warning until a real endpoint verification resolves it.
        if (event.status.state === "probe-error" && current?.state === "degraded") return {};
        const status: EndpointStatus = current?.state === "degraded" &&
          event.status.state !== "ok" && event.status.state !== "probe-error"
          ? { ...event.status, state: "unreachable", diagnostic: event.status.diagnostic ?? current.diagnostic }
          : event.status;
        if (JSON.stringify(current) === JSON.stringify(status)) return {};
        return { statuses: { ...context.statuses, [status.id]: status } };
      }),
    },
  },
});

/** Mirrors Maestro's existing Strict Mode-safe actor controller contract. */
const makeHealthActor = () => createActor(machine);
type HealthActor = ReturnType<typeof makeHealthActor>;

export function createGraphServerHealthController() {
  let actor: HealthActor | null = null;
  let statuses: Record<string, EndpointStatus> = {};
  let failures: Record<string, number> = {};
  const listeners = new Set<() => void>();
  let subscription: { unsubscribe(): void } | null = null;
  const publish = () => {
    if (!actor) return;
    const next = actor.getSnapshot().context;
    failures = next.lastTransportFailure;
    if (next.statuses === statuses) return;
    statuses = next.statuses;
    for (const listener of listeners) listener();
  };
  return {
    start() {
      if (actor) return;
      actor = makeHealthActor();
      // Restore evidence before subscribing: XState publishes its empty initial
      // snapshot on start, which must not erase the previous Strict Mode mount.
      actor.start();
      actor.send({ type: "RESTORE", statuses, lastTransportFailure: failures });
      subscription = actor.subscribe(publish);
      publish();
    },
    stop() { subscription?.unsubscribe(); subscription = null; actor?.stop(); actor = null; },
    getSnapshot: () => statuses,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    send(event: HealthEvent) {
      if (actor) actor.send(event);
      else if (event.type === "STATUS_REPLACED") statuses = event.statuses;
      // Keep failed observations until actor is started, without a parallel
      // React state transition table.
      else if (event.type === "TRANSPORT_FAILED") {
        failures = { ...failures, [event.id]: event.at };
        statuses = { ...statuses, [event.id]: { id: event.id, status: null, state: "degraded",
          testedUrl: event.endpointUrl, diagnostic: event.diagnostic } };
      }
    },
    replace(next: Record<string, EndpointStatus> | ((current: Record<string, EndpointStatus>) => Record<string, EndpointStatus>)) {
      const updated = typeof next === "function" ? next(statuses) : next;
      if (updated !== statuses) this.send({ type: "STATUS_REPLACED", statuses: updated });
    },
    reportProbe(status: EndpointStatus, startedAt: number) { this.send({ type: "PROBE_REPORTED", status, startedAt }); },
  };
}
