import { writable } from "../store";
import type { Readable, Writable } from "../store";

/** The focused x value of one member: the others show their crosshair there. */
export interface LinkCursor {
  /** A time chart's focused x (ms), or a bar chart's focused category. */
  readonly value: number | string;
  /** The member that focused it (its own subscription skips it). */
  readonly from: object;
}

/** A shown x window (ms), with where it came from and how far its gesture is. */
export interface LinkWindow {
  readonly start: number;
  readonly end: number;
  readonly from: object;
  /** "preview" while a drag or wheel is live, "commit" once it settles. */
  readonly phase: "preview" | "commit";
  /** A ChartBrush's range ("brush": the others redraw with it) or a ChartZoom's window ("zoom": previews are transforms). */
  readonly source: "brush" | "zoom";
}

export interface LinkGroup {
  readonly id: string;
  readonly cursor: Writable<LinkCursor | null>;
  /** null: every member shows its full extent. */
  readonly window: Writable<LinkWindow | null>;
  /** A member's y extent (null leaves); the union is `extent`. Notifies in a microtask, so a member registering while it renders never re-enters another. */
  setExtent(member: object, extent: readonly [number, number] | null): void;
  readonly extent: Readable<readonly [number, number] | null>;
}

const unionOf = (extents: ReadonlyMap<object, readonly [number, number]>): readonly [number, number] | null => {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const [a, b] of extents.values()) {
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
};

function createLinkGroup(id: string): LinkGroup {
  const extents = new Map<object, readonly [number, number]>();
  let union: readonly [number, number] | null = null;
  const listeners = new Set<() => void>();
  let queued = false;
  const notify = (): void => {
    if (queued) {
      return;
    }
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const listener of [...listeners]) {
        listener();
      }
    });
  };
  return {
    id,
    cursor: writable<LinkCursor | null>(null),
    window: writable<LinkWindow | null>(null),
    setExtent(member, extent) {
      const known = extents.get(member);
      if (extent === null) {
        if (!known) {
          return;
        }
        extents.delete(member);
      } else if (known?.[0] === extent[0] && known[1] === extent[1]) {
        return;
      } else {
        extents.set(member, extent);
      }
      const next = unionOf(extents);
      if (next?.[0] === union?.[0] && next?.[1] === union?.[1]) {
        return;
      }
      union = next;
      notify();
    },
    extent: {
      get: () => union,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

// Built on first use (no module-scope work): a page holds a handful of ids, each a few closures, so groups are kept.
let groups: Map<string, LinkGroup> | undefined;

/** The group of `id`, created on first use. */
export function linkGroup(id: string): LinkGroup {
  groups ??= new Map();
  let group = groups.get(id);
  if (!group) {
    group = createLinkGroup(id);
    groups.set(id, group);
  }
  return group;
}

/** A group nobody else joins: a chart without a `syncId` keeps its ChartZoom window in one, so one path serves both. */
export const privateLinkGroup = (): LinkGroup => createLinkGroup("");
