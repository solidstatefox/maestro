"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
  createMaestroProviderInstanceController,
  type ProviderInstancePhase,
} from "@/lib/app-lifecycle/providers";

/** One instance per mounted SHACL-approved provider widget. This observes
 * the existing FCT/SPARQL domain request without issuing a duplicate query. */
export function useProviderWidgetLifecycle(identity: string, status: {
  loading: boolean; ready: boolean; error: string;
}): ProviderInstancePhase {
  const [controller] = useState(createMaestroProviderInstanceController);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useLayoutEffect(() => {
    if (!identity) { controller.send({ type: "INSTANCE_INACTIVE" }); return; }
    controller.send({ type: "INSTANCE_APPLICABLE", identity });
    return () => controller.send({ type: "INSTANCE_INACTIVE" });
  }, [controller, identity]);
  useLayoutEffect(() => {
    if (!identity) return;
    if (status.error) controller.send({ type: "INSTANCE_FAILED", identity, error: status.error });
    else if (status.loading) controller.send({ type: "INSTANCE_LOADING", identity });
    else if (status.ready) controller.send({ type: "INSTANCE_READY", identity });
  }, [controller, identity, status.loading, status.ready, status.error]);
  return snapshot.context.identity === identity ? snapshot.value as ProviderInstancePhase : "inactive";
}
