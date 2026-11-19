import { browserLog } from "@/lib/maestro-client-logging";
import { carrierEqual, isPlain, trampolined } from "../carrier-props";
import type { Props } from "../carrier-props";
import { writable } from "../store";
import type { Readable } from "../store";
import { declarationOf, declareAt, keepDeclarationIndex } from "./table";
import type { ChildTable } from "./table";

interface RegisteredCarrier {
  readonly role: string;
  /** Top-level position of the user element that rendered it, plus the fraction (below 1) of its registration order. */
  readonly position: number;
  readonly props: Props;
}

interface Entry {
  role: string;
  slot: number;
  seq: number;
  raw: Props;
  latest: Props;
  props: Props;
}

/** A carrier a port registered: `update` with each new props (only a structural change bumps `version`), `remove` when it unmounts. */
export interface CarrierHandle {
  update(props: Props): void;
  remove(): void;
}

export interface CarrierRegistry {
  // React's nested carriers (react/kit/carrier-registry.tsx): registered from a layout effect at their element's top-level `slot`.
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => readonly RegisteredCarrier[];
  readonly settled: () => boolean;
  readonly settle: () => void;
  readonly set: (id: string, role: string, slot: number, props: Props) => void;
  readonly remove: (id: string) => void;
  /** A port's carrier: `anchor` is the node that marks its place among the chart's children (registration order until it is in the DOM). */
  register(role: string, props: Props, anchor?: () => Node | null): CarrierHandle;
  /** The carriers read from the element tree (React, each render; never notifies: the caller reads `table()` in the same pass). */
  setStatic(table: ChildTable): void;
  /** The static table plus the registered carriers in declaration / DOM order, stabilised (the same object while structurally equal). */
  table(): ChildTable;
  /** Bumped when a registered carrier is added, removed or structurally changed: a port re-reads `table()`. */
  readonly version: Readable<number>;
}

const NONE: readonly RegisteredCarrier[] = [];
const EMPTY_TABLE: ChildTable = /* @__PURE__ */ new Map();
/** Node.DOCUMENT_POSITION_FOLLOWING (no DOM global in the core). */
const FOLLOWING = 4;

interface PortEntry {
  readonly role: string;
  readonly seq: number;
  readonly anchor: (() => Node | null) | undefined;
  raw: Props;
  latest: Props;
  props: Props;
}

const connectedAnchor = (entry: PortEntry): Node | null => {
  const node = entry.anchor?.() ?? null;
  return node?.isConnected === true ? node : null;
};

/** Registration order, then the entries whose anchor is in the DOM re-ordered among their own places by document position, so a carrier
 * toggled back on keeps its declared place and one not yet connected keeps its registration slot. */
const portOrder = (entries: Iterable<PortEntry>): PortEntry[] => {
  const bySeq = [...entries].toSorted((a, b) => a.seq - b.seq);
  const placed = bySeq.filter((entry) => connectedAnchor(entry) !== null);
  // SAFETY: `placed` holds only entries whose anchor is connected (filtered above).
  const byDom = placed.toSorted((a, b) => ((connectedAnchor(a) as Node).compareDocumentPosition(connectedAnchor(b) as Node) & FOLLOWING ? -1 : 1));
  let next = 0;
  return bySeq.map((entry) => {
    if (connectedAnchor(entry) === null) {
      return entry;
    }
    const at = byDom[next];
    next += 1;
    return at;
  });
};

export const createCarrierRegistry = (): CarrierRegistry => {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let sequence = 0;
  let cached: readonly RegisteredCarrier[] = NONE;
  let isSettled = false;
  const ports = new Map<number, PortEntry>();
  const version = writable(0);
  let portSequence = 0;
  let staticTable: ChildTable = EMPTY_TABLE;
  let source: ChildTable | null = null;
  let stable: ChildTable | null = null;
  const latest: Latest = { current: null };
  const bump = (): void => { version.set(version.get() + 1); };
  const changed = (): void => {
    cached = [...entries.values()]
      .toSorted((a, b) => a.slot - b.slot || a.seq - b.seq)
      .map((entry) => ({ role: entry.role, position: entry.slot + entry.seq / (entry.seq + 1), props: entry.props }));
    listeners.forEach((listener) => { listener(); });
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => cached,
    settled: () => isSettled,
    settle: () => {
      if (!isSettled) {
        isSettled = true;
        listeners.forEach((listener) => { listener(); });
      }
    },
    set: (id, role, slot, props) => {
      const entry = entries.get(id);
      if (entry !== undefined) {
        // Inline callbacks change identity every render: the trampolines read the latest, and only a structural change notifies.
        entry.latest = props;
        if (entry.role === role && entry.slot === slot && carrierEqual(entry.raw, props)) {
          return;
        }
      }
      const next: Entry = entry ?? { role, slot, seq: sequence, raw: props, latest: props, props };
      if (entry === undefined) {
        sequence += 1;
        entries.set(id, next);
      }
      next.role = role;
      next.slot = slot;
      next.raw = props;
      // SAFETY: trampolining a record of props yields a record of the same shape.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      next.props = trampolined(props, [], () => next.latest) as Props;
      changed();
    },
    remove: (id) => {
      if (entries.delete(id)) {
        changed();
      }
    },
    register(role, props, anchor) {
      const seq = portSequence;
      portSequence += 1;
      const entry: PortEntry = { role, seq, anchor, raw: props, latest: props, props };
      // SAFETY: trampolining a record of props yields a record of the same shape.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      entry.props = trampolined(props, [], () => entry.latest) as Props;
      ports.set(seq, entry);
      bump();
      return {
        update(next) {
          entry.latest = next;
          if (!ports.has(seq) || carriersEqualFor(role, entry.raw, next)) {
            return;
          }
          entry.raw = next;
          // SAFETY: as in `register`.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
          entry.props = trampolined(next, [], () => entry.latest) as Props;
          bump();
        },
        remove() {
          if (ports.delete(seq)) {
            bump();
          }
        },
      };
    },
    setStatic(table) {
      staticTable = table;
    },
    table() {
      const registered = portOrder(ports.values()).map((entry, position) => ({ role: entry.role, position, props: entry.props }));
      const next = withRegistered(withRegistered(staticTable, cached), registered);
      latest.current = next;
      if (stable === null || source === null || !tablesEqual(source, next)) {
        source = next;
        stable = stabilise(next, latest);
      }
      return stable;
    },
    version: { get: version.get, subscribe: version.subscribe },
  };
};

/** Props a role reads only at mount (bklit/visx `initialBrushPosition`): the brush strip echoes every preview back into `initialSelection`, which must not rebuild its definition. */
const MOUNT_ONLY_PROPS = /* @__PURE__ */ new Map([["brush", "initialSelection"]]);

const without = (props: Props, skip: string): Props => Object.fromEntries(Object.entries(props).filter(([key]) => key !== skip));

const carriersEqualFor = (role: string, a: Props, b: Props): boolean => {
  const skip = MOUNT_ONLY_PROPS.get(role);
  if (skip === undefined) {
    return carrierEqual(a, b);
  }
  return carrierEqual(without(a, skip), without(b, skip));
};

/** Same carriers, structurally, at the same declaration places: a carrier that moved among the other roles' (a port's `<Line>` shown
 * again between two `<Area>`s, at its anchor's place) is a new table, as the paint order follows the declarations. */
const tablesEqual = (a: ChildTable, b: ChildTable): boolean => {
  if (a.size !== b.size) {
    return false;
  }
  for (const [role, list] of a) {
    const next = b.get(role);
    if (!next || next.length !== list.length || !list.every((props, i) => declarationOf(props) === declarationOf(next[i]) && carriersEqualFor(role, props, next[i]))) {
      return false;
    }
  }
  return true;
};

interface Latest { current: ChildTable | null }

// The latest table a stabilised one stands for: plain values in a stabilised table are the ones it was made from.
const latestOf = /* @__PURE__ */ new WeakMap<ChildTable, Latest>();

/** The table `table()` last read for this stabilised table, for the props a role reads at mount only (a brush's `initialSelection`, excluded from the identity). */
export const latestTable = (table: ChildTable): ChildTable => latestOf.get(table)?.current ?? table;

/** A copy of `table` whose callbacks are trampolines reading the table in `latest`, so the copy can stand for later structurally equal tables. */
const stabilise = (table: ChildTable, latest: Latest): ChildTable => {
  const out = new Map<string, readonly Record<string, unknown>[]>();
  latestOf.set(out, latest);
  for (const [role, list] of table) {
    out.set(
      role,
      list.map((props, i) =>
        keepDeclarationIndex(props, isPlain(props) ? Object.fromEntries(Object.entries(props).map(([key, item]) => [key, trampolined(item, [role, i, key], () => latest.current)])) : props),
      ),
    );
  }
  return out;
};

/** The static table plus the carriers registered from inside user components, each in JSX order. */
const withRegistered = (table: ChildTable, registered: readonly RegisteredCarrier[]): ChildTable => {
  if (registered.length === 0) {
    return table;
  }
  const out = new Map<string, readonly Record<string, unknown>[]>(table);
  for (const { role, position, props } of registered) {
    const merged = [...(out.get(role) ?? []), declareAt({ ...props }, position)];
    out.set(role, merged.toSorted((a, b) => declarationOf(a) - declarationOf(b)));
  }
  return out;
};

// The bundler's `process.env.NODE_ENV` (no Node types in a browser kit).
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

const warned = /* @__PURE__ */ new Set<string>();

/** Bundlers replace `process.env.NODE_ENV` with a literal; unbundled in a browser `process` is undefined, which counts as development. */
export const isProduction = (): boolean => {
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
};

/** Dev-only chart warning, once per message, through Maestro's Sheet-controlled logger. */
export const warnOnce = (message: string): void => {
  if (isProduction() || warned.has(message)) {
    return;
  }
  warned.add(message);
  browserLog.warn(`charts.${message}`);
};
