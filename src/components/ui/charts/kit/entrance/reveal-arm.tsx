import { useEffect, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { revealArmStep } from "../../core/entrance/arm";
import type { ReadyStore } from "../../core/entrance/ready-gate";

/** Arms the reveal (`onArm`) in the commit after the mount's (the mount effect's setState), so the shell never re-renders (core/entrance/arm.ts).
 * `onArm` opens the native wipe (and starts the composed bar grow) on that trigger. */
export const RevealArm = ({ hostRef, onArm }: { readonly hostRef: RefObject<HTMLElement | null>; readonly onArm?: () => void }): null => {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (revealArmStep(stage, hostRef.current, onArm)) { setStage(stage + 1); }
  }, [stage, hostRef, onArm]);
  return null;
};

/** Reads a gate's ready flag: false until the gate flips, false again while it re-arms. */
export const useGateReady = (store: ReadyStore): boolean => useSyncExternalStore(store.subscribe, store.get, () => false);
