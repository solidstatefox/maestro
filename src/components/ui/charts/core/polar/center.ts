import { writable } from "../store";
import type { Readable } from "../store";
import { px } from "../style";
import type { StyleObject } from "../style";
import type { CenterStatFormat } from "../types/polar";

export const defaultCenterStatFormat: CenterStatFormat = { maximumFractionDigits: 0, notation: "standard" };

/** The stat's classes: the container's (always set, a reader's `className` after it) and the value's and label's defaults. */
export const CENTER_STAT_CLASS = { container: "ts-bkm-center-stat", label: "ts-bkm-center-stat-label", value: "ts-bkm-center-stat-value" } as const;

/** Inset subtracted from the inner diameter so the stat box clears the arc edge. */
const CENTER_STAT_BOX_INSET_PX = 16;

interface CenterStatInput<Data> {
  readonly hoveredData: Data | undefined;
  readonly totalValue: number;
  readonly innerRadius: number;
  readonly defaultLabel: string;
}

interface CenterStat {
  readonly value: number;
  readonly label: string;
  /** The box's side in px. */
  readonly centerSize: number;
}

/** What the centre shows: the hovered datum's value and label, else the total over `defaultLabel`, in a box of the inner diameter less the inset. */
export const polarCenterStat = <Data extends { readonly label: string; readonly value: number }>({ hoveredData, totalValue, innerRadius, defaultLabel }: Readonly<CenterStatInput<Data>>): CenterStat => ({
  centerSize: innerRadius * 2 - CENTER_STAT_BOX_INSET_PX,
  label: hoveredData ? hoveredData.label : defaultLabel,
  value: hoveredData ? hoveredData.value : totalValue,
});

/** What a reader's render child is called with. */
export interface CenterRenderArgs<Data> {
  readonly value: number;
  readonly label: string;
  readonly isHovered: boolean;
  readonly data: Data;
}

/** A reader's render child's argument, or null where the default stat shows: the hovered datum's value and label, and at rest `restData`'s
 * (the total under `defaultLabel`, `isHovered` false) when the centre renders its child at rest too. bklit's PieCenter does (#264: its
 * render child is always called, `data` falling back to `{ label: defaultLabel, value: totalValue }`); its RingCenter calls it on hover only. */
export const centerRenderArgs = <Data>(stat: Readonly<CenterStat>, hoveredData: Data | undefined, restData: Data | undefined): CenterRenderArgs<Data> | null => {
  if (hoveredData !== undefined) { return { data: hoveredData, isHovered: true, label: stat.label, value: stat.value }; }
  return restData === undefined ? null : { data: restData, isHovered: false, label: stat.label, value: stat.value };
};

/** The stat's box: a centred flex box `centerSize` px square. The default stat stacks value over label; a reader's content (`custom`) lays out in a row. */
export const centerStatBox = (centerSize: number, custom: boolean): StyleObject => {
  const box: StyleObject = { "align-items": "center", display: "flex", height: px(centerSize), "justify-content": "center", width: px(centerSize) };
  return custom ? box : { ...box, "flex-direction": "column", "text-align": "center" };
};

/** A centre's roll-in from 0, as bklit's centres do (NumberFlow tweens from 0 to the value once it is set): false until `start()`, from the start
 * without an intro. Only the first value is deferred, so a later change is a single update. React starts it from its mount's passive effect
 * (react/kit/polar/center-shell.tsx `useFlowValue`); a port from its first post-paint moment (lifecycle/after-paint.ts). */
interface FlowIntro extends Readable<boolean> {
  readonly start: () => void;
}

export const createFlowIntro = (intro: boolean): FlowIntro => {
  const done = writable(!intro);
  return { get: done.get, start: () => { done.set(true); }, subscribe: done.subscribe };
};

/** The value NumberFlow shows: 0 until the intro is done. */
export const flowValue = (value: number, introDone: boolean): number => (introDone ? value : 0);

// --- The number's cadence ----------------------------------------------------------------------------------------------------------
// Each value NumberFlow is given starts a roll, and a roll is most of a pie's or ring's hover cost (its digits' layout reads and spans,
// then a restyle of its shadow tree every frame). A sweep across the slices would start one per slice crossed, so the number takes
// the hover's changes at a pace: one that comes after the number has been still shows at once (hovering slice by slice rolls exactly as
// before), and ones that come in quick succession wait for the hover to rest, then the number rolls once, to the latest. The label beside
// it, the slices and their dims follow the hover as they always did. Each framework's centre gives its NumberFlow a `CenterNumber` of its
// own (React: react/kit/polar/center-shell.tsx; vue/centre/center-shell.ts, svelte/centre/CenterNumber.svelte, solid/centre/center-shell.tsx).

/** A hover change this long after the number last changed shows at once. */
export const CENTER_NUMBER_STILL_MS = 150;
/** Sooner than that (a sweep), the number holds until the hover has rested this long, then shows the latest value. */
export const CENTER_NUMBER_REST_MS = 80;

/** The time a centre number paces itself by (tests hand in their own). */
export interface CenterNumberClock {
  /** Now, in ms. */
  readonly now: () => number;
  /** Runs `run` in `ms`; returns its cancel. */
  readonly after: (ms: number, run: () => void) => () => void;
}

const PAGE_CLOCK: CenterNumberClock = {
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => { clearTimeout(timer); };
  },
  now: () => performance.now(),
};

/** The value a centre's NumberFlow shows: `get` is it, `subscribe` hears it change. */
export interface CenterNumber extends Readable<number> {
  /** The centre's value now, and the label it shows under (the hovered datum's, or the total's): a new label is a hover change, paced;
   * a new value under the same label (the data's) shows at once, or joins the one held. */
  readonly set: (value: number, label: string) => void;
  /** Drops a held value (the number unmounts). */
  readonly cancel: () => void;
}

/** A centre number starting on `value` under `label`, made where its NumberFlow mounts (a stat that comes back starts on its value). */
export const createCenterNumber = (value: number, label: string, clock: CenterNumberClock = PAGE_CLOCK): CenterNumber => {
  const shown = writable(value);
  let latest = value;
  let latestLabel = label;
  let shownAt = Number.NEGATIVE_INFINITY;
  let release: (() => void) | null = null;
  const show = (next: number): void => {
    if (Object.is(next, shown.get())) { return; }
    shownAt = clock.now();
    shown.set(next);
  };
  const hold = (): void => {
    release?.();
    release = clock.after(CENTER_NUMBER_REST_MS, () => {
      release = null;
      show(latest);
    });
  };
  return {
    cancel: () => {
      release?.();
      release = null;
    },
    get: shown.get,
    set: (next, nextLabel) => {
      const hoverChange = nextLabel !== latestLabel;
      latest = next;
      latestLabel = nextLabel;
      if (release !== null) {
        // A sweep: it hasn't rested while the hover moves on.
        if (hoverChange) { hold(); }
        return;
      }
      if (Object.is(next, shown.get())) { return; }
      if (!hoverChange || clock.now() - shownAt >= CENTER_NUMBER_STILL_MS) {
        show(next);
        return;
      }
      hold();
    },
    subscribe: shown.subscribe,
  };
};
