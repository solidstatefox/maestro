import { assign, createActor, setup } from "xstate";

/** A queue latch is scoped to one discovery invocation, not to the transport
 * lifetime: approvals, validation and the renderer can still be pending when
 * the last discovery HTTP request has already left the scheduler. */
export const facetProviderQueueMachine = setup({
  types: {
    context: {} as { key: string; run: number },
    events: {} as { type: "BEGIN"; key: string } | { type: "ADMITTED"; run: number } | { type: "END"; run: number },
  },
}).createMachine({
  id: "facet-provider-queue", initial: "idle", context: { key: "", run: 0 },
  on: {
    BEGIN: { target: ".waiting", actions: assign(({ context, event }) => ({ key: event.key, run: context.run + 1 })) },
    ADMITTED: { guard: ({ context, event }) => context.run === event.run && Boolean(context.key), target: ".queued" },
    END: { guard: ({ context, event }) => context.run === event.run, target: ".idle", actions: assign({ key: "" }) },
  },
  states: { idle: {}, waiting: {}, queued: {} },
});

export const FACET_PROVIDER_FRAME_MS = 150;
/** CSS transforms are applied about the center of the 24x24 Lucide viewBox.
 * User-requested sequence: Sparkle, Sparkles, Sparkles reflected about the
 * descending diagonal, Sparkle, Sparkles reflected about the vertical axis,
 * Sparkles then reflected about the ascending diagonal, Sparkle, then a final
 * composite Sparkles frame with both the normal and vertically reflected
 * glyphs so the small stars occupy all four corners. */
export const FACET_PROVIDER_FRAMES = [
  { layers: [{ icon: "sparkle", transform: "none" }] },
  { layers: [{ icon: "sparkles", transform: "none" }] },
  { layers: [{ icon: "sparkles", transform: "matrix(0,1,1,0,0,0)" }] },
  { layers: [{ icon: "sparkle", transform: "none" }] },
  { layers: [{ icon: "sparkles", transform: "scaleX(-1)" }] },
  { layers: [{ icon: "sparkles", transform: "matrix(0,-1,-1,0,0,0)" }] },
  { layers: [{ icon: "sparkle", transform: "none" }] },
  { layers: [
    { icon: "sparkles", transform: "none" },
    { icon: "sparkles", transform: "scaleX(-1)" },
  ] },
] as const;
export type FacetProviderActivity = { attempt: string; queued: boolean; discovering: boolean };
export type FacetProviderProgressInput = FacetProviderActivity & { enabled: boolean; renderer: string; waitingForData: boolean };
type ProgressContext = { input: FacetProviderProgressInput; rendered: string; completed: string; frame: number };
const emptyInput: FacetProviderProgressInput = { attempt: "", queued: false, discovering: false, enabled: false, renderer: "", waitingForData: false };
const terminal = ({ input, rendered }: ProgressContext) => !input.enabled ||
  (!input.discovering && (!input.renderer || rendered === input.renderer && !input.waitingForData));
const outstanding = ({ input, completed }: ProgressContext) => Boolean(input.attempt && input.queued && input.attempt !== completed);
export const facetProviderProgressMachine = setup({
  types: {
    context: {} as ProgressContext,
    events: {} as { type: "SYNC"; input: FacetProviderProgressInput } | { type: "RENDER"; identity: string; ready: boolean },
  },
  guards: {
    pending: ({ context }) => outstanding(context) && !terminal(context),
    settled: ({ context }) => outstanding(context) && terminal(context),
    hidden: ({ context }) => !outstanding(context) || terminal(context),
  },
  actions: {
    complete: assign(({ context }) => ({ completed: context.input.attempt, frame: 0 })),
    advance: assign(({ context }) => ({ frame: (context.frame + 1) % FACET_PROVIDER_FRAMES.length })),
  },
}).createMachine({
  id: "facet-provider-progress", initial: "idle",
  context: { input: emptyInput, rendered: "", completed: "", frame: 0 },
  on: {
    SYNC: [
      { guard: ({ context, event }) => context.input.attempt !== event.input.attempt,
        target: ".idle", actions: assign(({ event }) => ({ input: event.input, frame: 0 })) },
      { actions: assign(({ event }) => ({ input: event.input })) },
    ],
    // A child's layout effect may run before its parent's SYNC. Exact render
    // identity is compared against the current attempt, never a loose URI.
    RENDER: { actions: assign(({ context, event }) => ({ rendered: event.ready ? event.identity :
      context.rendered === event.identity ? "" : context.rendered })) },
  },
  states: {
    idle: { always: [ { guard: "settled", actions: "complete" }, { guard: "pending", target: "animating" } ] },
    animating: {
      always: [ { guard: "settled", target: "idle", actions: "complete" }, { guard: "hidden", target: "idle" } ],
      after: { [FACET_PROVIDER_FRAME_MS]: { target: "animating", reenter: true, actions: "advance" } },
    },
  },
});

// Restartable controllers follow the established workspace Strict Mode pattern.
function restartable<A extends { start(): unknown; stop(): unknown; getSnapshot(): S; subscribe(listener: (snapshot: S) => void): { unsubscribe(): void }; send(event: E): void }, S, E>(make: () => A) {
  let actor: A | null = null;
  let snapshot = make().getSnapshot();
  let subscription: { unsubscribe(): void } | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    start() {
      if (actor) return;
      actor = make(); subscription = actor.subscribe(next => { snapshot = next; publish(); }); actor.start();
    },
    stop() { subscription?.unsubscribe(); subscription = null; actor?.stop(); actor = null; snapshot = make().getSnapshot(); publish(); },
    getSnapshot: () => snapshot,
    send: (event: E) => actor?.send(event),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
const makeQueueActor = () => createActor(facetProviderQueueMachine);
const makeProgressActor = () => createActor(facetProviderProgressMachine);
export const createFacetProviderQueueController = () => restartable<ReturnType<typeof makeQueueActor>, ReturnType<ReturnType<typeof makeQueueActor>["getSnapshot"]>, Parameters<ReturnType<typeof makeQueueActor>["send"]>[0]>(makeQueueActor);
export const createFacetProviderProgressController = () => restartable<ReturnType<typeof makeProgressActor>, ReturnType<ReturnType<typeof makeProgressActor>["getSnapshot"]>, Parameters<ReturnType<typeof makeProgressActor>["send"]>[0]>(makeProgressActor);
