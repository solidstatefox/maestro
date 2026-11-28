"use client";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Sparkle, Sparkles } from "lucide-react";
import { createFacetProviderQueueController, createFacetProviderProgressController, FACET_PROVIDER_FRAMES, type FacetProviderActivity } from "@/lib/app-lifecycle/facet-provider-progress";
import { observeQueryQueueAdmission } from "@/lib/query-queue-observation";

/** The caller's existing discovery effect owns cancellation. This hook merely
 * observes its actual admission; waiting for a Digest lock is not queueing. */
export function useFacetProviderQueue(key: string) {
  const [controller] = useState(createFacetProviderQueueController);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  const watch = useCallback((signal: AbortSignal) => {
    controller.send({ type: "BEGIN", key });
    const run = controller.getSnapshot().context.run;
    const close = observeQueryQueueAdmission(signal, () => controller.send({ type: "ADMITTED", run }));
    return () => { close(); controller.send({ type: "END", run }); };
  }, [controller, key]);
  const current = Boolean(key && snapshot.context.key === key);
  return { attempt: current ? String(snapshot.context.run) : "", queued: current && snapshot.matches("queued"), watch };
}
const EMPTY_ACTIVITY: FacetProviderActivity = { attempt: "", queued: false, discovering: false };
type RenderObservation = { identity: string; ready: boolean };
type ProgressContext = {
  controller: ReturnType<typeof createFacetProviderProgressController>;
  attempt: string; identity: string; enabled: boolean;
  report: (observation: RenderObservation) => void;
};
const Context = createContext<ProgressContext | null>(null);

/** One progress actor per facet instance. No DOM wrapper or provider remount.
 * Only the tiny header indicator subscribes to the 150 ms frame clock. */
export function FacetProviderProgress({ activity = EMPTY_ACTIVITY, provider, enabled, waitingForData = false, children }: {
  activity?: FacetProviderActivity; provider: string; enabled: boolean; waitingForData?: boolean; children: ReactNode;
}) {
  const [controller] = useState(createFacetProviderProgressController);
  const latest = useRef<RenderObservation>({ identity: "", ready: false });
  const identity = provider && activity.attempt ? JSON.stringify([activity.attempt, provider]) : "";
  const report = useCallback((observation: RenderObservation) => {
    if (observation.ready || latest.current.identity === observation.identity) latest.current = observation;
    controller.send({ type: "RENDER", ...observation });
  }, [controller]);
  useLayoutEffect(() => {
    controller.start(); controller.send({ type: "RENDER", ...latest.current });
    return () => controller.stop();
  }, [controller]);
  useLayoutEffect(() => {
    controller.send({ type: "SYNC", input: { attempt: activity.attempt, queued: activity.queued,
      discovering: activity.discovering, enabled, renderer: identity, waitingForData } });
  }, [controller, activity.attempt, activity.queued, activity.discovering, enabled, identity, waitingForData]);
  const context = useMemo(() => ({ controller, attempt: activity.attempt, identity, enabled, report }), [controller, activity.attempt, identity, enabled, report]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
/** Called only by the selected renderer, after its current content commits.
 * A failed renderer is also terminal; its existing error UI remains in place. */
export function useFacetProviderRendered(ready: boolean) {
  const context = useContext(Context);
  const identity = context?.identity ?? "";
  const report = context?.report;
  useLayoutEffect(() => {
    if (!identity || !report) return;
    report({ identity, ready });
    return () => report({ identity, ready: false });
  }, [identity, report, ready]);
}
function ProgressGlyph({ context }: { context: ProgressContext }) {
  const snapshot = useSyncExternalStore(context.controller.subscribe, context.controller.getSnapshot, context.controller.getSnapshot);
  if (!context.enabled || !context.attempt || snapshot.context.input.attempt !== context.attempt || !snapshot.matches("animating")) return null;
  const frame = FACET_PROVIDER_FRAMES[snapshot.context.frame];
  return <span className="maestro-facet-provider-spectrum inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground" role="status" aria-label="Loading facet provider" title="Loading facet provider">
    <span aria-hidden="true" className="relative inline-flex size-full motion-reduce:hidden">
      {frame.layers.map((layer, index) => {
        const Icon = layer.icon === "sparkles" ? Sparkles : Sparkle;
        return <Icon key={`${layer.icon}-${layer.transform}-${index}`} aria-hidden="true" className="absolute inset-0 size-full" style={{ transform: layer.transform, transformOrigin: "center" }} />;
      })}
    </span>
    <Sparkle aria-hidden="true" className="hidden size-full motion-reduce:block" />
  </span>;
}
export function FacetProviderIndicator() {
  const context = useContext(Context);
  return context ? <ProgressGlyph context={context} /> : null;
}
