"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { PersonalAuthSession } from "@/lib/personal-auth";
import { loadClientStatusMachines } from "@/lib/status-machine-client";
import { machineForTarget } from "@/lib/status-machine-runtime";
import { createMaestroAccessController } from "@/lib/app-lifecycle/access";

/** The session resolver is the authentication authority. XState owns all UI
 * gates and bookmark verification; credentials never enter machine context. */
export function useMaestroAccess(session: PersonalAuthSession | null, restored: boolean, policiesReady = true, seedError = "") {
  const [controller] = useState(createMaestroAccessController);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // An auth session with freshly rotated credentials is distinct even if its
  // public store URI/user name is unchanged. Do not store credentials in XState.
  const [sessionInstanceId] = useState(() => {
    const ids = new WeakMap<PersonalAuthSession, number>();
    let next = 0;
    return (value: PersonalAuthSession) => {
      let id = ids.get(value);
      if (!id) { id = ++next; ids.set(value, id); }
      return id;
    };
  });
  const sessionKey = restored && session?.graphStore && session?.graphPrefix && session?.authHeader
    ? [session.graphStore, session.graphPrefix, session.authType, session.username ?? session.userName ?? "", String(sessionInstanceId(session))].join("|")
    : "";
  useLayoutEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useLayoutEffect(() => {
    controller.send({ type: "SESSION_OBSERVED", restored, sessionKey });
  }, [controller, restored, sessionKey]);
  useLayoutEffect(() => {
    if (!sessionKey) return;
    if (seedError) {
      controller.send({ type: "POLICY_STATUS_OBSERVED", sessionKey, stage: "failed", error: seedError });
      return;
    }
    if (!policiesReady) {
      controller.send({ type: "POLICY_STATUS_OBSERVED", sessionKey, stage: "seeding" });
      return;
    }
    // On browser restore, verification must not be confused with a fresh
    // login or silently trigger graph reseeding. The current personal graph
    // must actually contain a provider before policy-dependent Providers run.
    const abort = new AbortController();
    controller.send({ type: "POLICY_STATUS_OBSERVED", sessionKey, stage: "verifying" });
    void (async () => {
      try {
        // One arbitrary mui:Provider is NOT evidence that /graph has been
        // seeded. The Status/approval policies are needed for write controls;
        // read-only provider catalog discovery remains independently usable.
        const machines = await loadClientStatusMachines(abort.signal);
        for (const target of [
          "http://www.w3.org/2000/01/rdf-schema#Resource",
          "gttp://ggg.maestro.ecosys/ns/ui#Provider",
          "gttp://ggg.maestro.ecosys/ns/ui#ClassPolicy",
          "gttp://ggg.maestro.ecosys/ns/ui#CurationProvider",
        ]) machineForTarget(machines, target);
        if (!abort.signal.aborted) controller.send({ type: "POLICY_STATUS_OBSERVED", sessionKey,
          stage: "ready", error: "" });
      } catch (error) {
        if (!abort.signal.aborted) controller.send({ type: "POLICY_STATUS_OBSERVED", sessionKey,
          stage: "failed", error: error instanceof Error ? error.message : "Could not verify policy providers." });
      }
    })();
    return () => abort.abort();
  }, [controller, sessionKey, policiesReady, seedError]);
  return { controller, snapshot, sessionKey };
}
