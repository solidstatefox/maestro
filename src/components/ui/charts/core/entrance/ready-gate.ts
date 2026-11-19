import { clearAttribute, raiseAttribute } from "../host-write";
import { writable } from "../store";
import type { Writable } from "../store";
import { alignEntranceStart } from "./entrance-origin";

const READY_ATTR = "data-bkm-ready";
/** The chart takes the pointer: raised when the data starts to show (a gate run starts), dropped when the gate is disposed. */
export const INTERACTIVE_ATTR = "data-bkm-interactive";

/** Entrances that start at the reveal timer's flip (bklit isLoaded): the background fade, the terminal marker's opacity (WAAPI) and scale (JS: its last write lands ~5 ms after the WAAPI end, measured on projection, so no extra frame step). */
const READY_ORIGINS = { "bkm-bg-in": "frame", "bkm-terminal-fade": "frame", "bkm-terminal-grow": "frame" } as const;

/** The gate's ready flag as a store: subscribers re-render at the flip without the gate's owner doing so. */
export type ReadyStore = Writable<boolean>;

/** One run of the gate's timer. */
export interface ReadyGateRun {
  /** The reveal timer in ms (the chart's animationDuration, or its family's entrance span). */
  readonly duration: number;
  /** Set when the owner lands the flip in its own commit (React `viaState`): called with false as the timer starts and true at the flip;
   * the owner then mirrors its committed flag with `reflect`. Otherwise the gate raises the attribute itself. */
  readonly land?: (ready: boolean) => void;
  /** Called at the flip. */
  readonly onReady?: () => void;
}

export interface ReadyGateMachine {
  readonly store: ReadyStore;
  /** Starts the timer and keeps the gate armed; the host takes the pointer from here. */
  arm(run: ReadyGateRun): void;
  /** Starts the timer again once armed (a new duration or reset key); a no-op before `arm`. */
  restart(run: ReadyGateRun): void;
  /** `land`'s committed flag -> `data-bkm-ready`. */
  reflect(ready: boolean): void;
  /** Stops the timer, drops both attributes and the flag. */
  dispose(): void;
}

/** The gate over `host` (read when a run starts). */
export function createReadyGate(host: () => HTMLElement | null): ReadyGateMachine {
  const store = writable(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armed = false;
  const start = ({ duration, land, onReady }: ReadyGateRun): void => {
    const el = host();
    clearTimeout(timer);
    // The data is on screen from here: hover lands on the final positions while the entrance plays.
    raiseAttribute(el, INTERACTIVE_ATTR);
    clearAttribute(el, READY_ATTR);
    store.set(false);
    land?.(false);
    const flip = (): void => {
      if (land) {
        land(true);
      } else {
        raiseAttribute(el, READY_ATTR);
      }
      store.set(true);
      onReady?.();
    };
    if (duration <= 0) {
      flip();
      return;
    }
    // Reproduces bklit's reveal timer, setTimeout(animationDuration): use-chart-phase-orchestrator.ts:164-169.
    timer = setTimeout(() => {
      flip();
      // The Background fade (background.tsx:119-125,208) and the terminal marker start with isLoaded, the same moment.
      if (el && !land) { alignEntranceStart(el, READY_ORIGINS); }
    }, duration);
  };
  return {
    store,
    arm(run) {
      armed = true;
      start(run);
    },
    restart(run) {
      if (armed) { start(run); }
    },
    reflect(ready) {
      if (ready) { raiseAttribute(host(), READY_ATTR); } else { clearAttribute(host(), READY_ATTR); }
    },
    dispose() {
      clearTimeout(timer);
      clearAttribute(host(), INTERACTIVE_ATTR);
      clearAttribute(host(), READY_ATTR);
      store.set(false);
    },
  };
}
