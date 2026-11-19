import { sameRows } from "../data-updated";
import type { Row } from "./series";

type YDomains = Readonly<Record<string, readonly [number, number]>>;
export type UpdateStep = "snap" | "glide" | "window" | undefined;

/** What the next build draws with: its update step and the y domains a snap starts from. */
export interface UpdateSequence {
  readonly data: readonly Row[];
  readonly deps: readonly unknown[];
  readonly step: UpdateStep;
  readonly from: YDomains | undefined;
  readonly xWindow: unknown;
}

/** The domains a draw built: the y domains it drew with and the ones it aims at. */
export interface SettledBuild {
  readonly domains: { readonly y: YDomains };
  readonly targetY: YDomains;
}

const sameDeps = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

const sameDomains = (a: YDomains, b: YDomains): boolean =>
  Object.keys(a).every((id) => {
    const x = a[id];
    const y = b[id] ?? x;
    return x[0] === y[0] && x[1] === y[1];
  });

export interface DataUpdateStep {
  /** Render input: the sequence to build with. */
  update(data: readonly Row[], deps: readonly unknown[], xWindow?: unknown): UpdateSequence;
  /** A draw of a build made at `step`: a snap ends in a glide when its y domains still move. True when the sequence moved on (the owner re-renders). */
  settle(built: SettledBuild, step: UpdateStep): boolean;
}

export function createDataUpdateStep(data: readonly Row[], deps: readonly unknown[], xWindow?: unknown): DataUpdateStep {
  let seq: UpdateSequence = { data, deps, step: undefined, from: undefined, xWindow };
  let applied: YDomains | undefined;
  return {
    update(nextData, nextDeps, nextWindow) {
      if (!sameDeps(seq.deps, nextDeps)) {
        seq = { data: nextData, deps: nextDeps, step: undefined, from: undefined, xWindow: nextWindow };
      } else if (seq.data !== nextData) {
        const changed = !sameRows(seq.data, nextData);
        seq = { data: nextData, deps: nextDeps, step: changed && applied ? "snap" : undefined, from: changed ? applied : undefined, xWindow: nextWindow };
      } else if (!Object.is(seq.xWindow, nextWindow)) {
        seq = { data: nextData, deps: nextDeps, step: "window", from: undefined, xWindow: nextWindow };
      }
      return seq;
    },
    settle(built, step) {
      if (step !== "snap") {
        applied = built.domains.y;
        return false;
      }
      applied = built.targetY;
      if (seq.step !== "snap") {
        return false;
      }
      seq = { ...seq, step: sameDomains(built.domains.y, built.targetY) ? undefined : "glide", from: undefined };
      return true;
    },
  };
}
