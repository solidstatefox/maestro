import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { clearAttribute, raiseAttribute } from "../host-write";
import { linkGroup, privateLinkGroup } from "../link/group";
import type { LinkGroup, LinkWindow } from "../link/group";
import { memoCell } from "../memo";
import type { ChartLinkProps, ChartZoomProps } from "../types/link";
import type { PlotSnapshot } from "./plot-size";
import type { ResolvedSeries, Row } from "./series";
import type { Span } from "./zoom";
import { getZoom } from "./zoom-factory";

/** What the link reads of one pass. */
export interface LinkInput {
  readonly props: ChartLinkProps & { readonly xDomain?: [Date, Date] };
  readonly table: ChildTable;
  readonly data: readonly Row[];
  /** The rows' x values (ms), in data order. */
  readonly times: readonly number[];
  readonly series: readonly ResolvedSeries[];
}

/** What the pass draws with because of the link. */
export interface LinkModel {
  /** The followed window, the zoom's full range, or the reader's `xDomain` (undefined: the data's extent). */
  readonly xDomain: [Date, Date] | undefined;
  /** Values the y domain must span: the group's union (`syncY`) and, with a ChartZoom, the full data's extent (the y axis holds while panning). */
  readonly extraYValues: readonly number[];
  /** A ChartZoom is in the chart: a window change redraws at once (no glide). */
  readonly zoom: boolean;
  /** With a ChartZoom: the data's extent, where the lines' edge fade stays (a pan's transform then shows the data past the window). */
  readonly fadeDomain: readonly [Date, Date] | undefined;
  /** Whether a window is followed (the main chart of a brush or a zoom): the slot count is the data's. */
  readonly windowed: boolean;
}

export interface CartesianLinkOptions {
  readonly host: () => HTMLElement | null;
  readonly surface: () => HTMLElement | null;
  /** The latest draw. */
  readonly plot: () => PlotSnapshot | null;
  /** The plot's margins (svg px) of the latest pass. */
  readonly margin: () => { readonly left: number; readonly top: number };
  /** The latest pass's input. */
  readonly input: () => LinkInput;
  /** Shows the crosshair, dots and date pill at a row (null hides them): host-sync's `sync` and the overlay's `focus`. */
  readonly showCursor: (time: number | null, row: Row | null) => void;
  /** Something the passes read changed (a followed window, the group's y extent): derive again and redraw. */
  readonly changed: () => void;
}

export interface CartesianLink {
  model(input: LinkInput): LinkModel;
  drawn(snapshot: PlotSnapshot): void;
  focused(time: number | null, index: number | null): void;
  rendered(context: ChartRendererRenderContext<never, never, never>): void;
  applied(): void;
  /** A ChartBrush in this chart moved (`phase` "preview" while dragging): the group's other charts follow it. */
  brushed(range: { readonly start: Date; readonly end: Date } | null, phase: "preview" | "commit"): void;
  /** Before the first draw: true when the group changed since the pass was derived (another member registered its extent). */
  stale(): boolean;
  attach(host: HTMLElement): () => void;
}

const NONE: readonly number[] = [];
const SYNCED = "data-bkm-synced";
/** A focus `activeIndex` holds (styles.css keeps its tooltip while the pointer is elsewhere, on the table that drives it). */
const HELD = "data-bkm-held";

/** Index of the row nearest `time` in ascending `times`, or -1 when `time` is off the rows by more than half a step. */
function nearestIndex(times: readonly number[], time: number): number {
  const last = times.length - 1;
  if (last < 0) {
    return -1;
  }
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < time) { lo = mid + 1; } else { hi = mid; }
  }
  const index = lo > 0 && time - times[lo - 1] < times[lo] - time ? lo - 1 : lo;
  const step = last > 0 ? (times[last] - times[0]) / last : 0;
  return Math.abs(times[index] - time) <= step / 2 + 1 ? index : -1;
}

const extentOf = (values: readonly number[]): Span | null => {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return lo <= hi ? [lo, hi] : null;
};

const sameSpan = (a: Span | null | undefined, b: Span | null | undefined): boolean => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);

export function createCartesianLink(options: CartesianLinkOptions): CartesianLink {
  // This chart, as the group knows it.
  const self = {};
  let own: LinkGroup | undefined;
  let group: LinkGroup | undefined;
  let groupId: string | undefined;
  let attachedTo: HTMLElement | null = null;
  let offGroup: (() => void) | undefined;
  let offGestures: (() => void) | undefined;
  /** The window this chart draws (null: its full range), and whether a preview transform waits for the redraw that draws it. */
  let window: Span | null = null;
  let clearPreview = false;
  let mountWindow: Span | null | undefined;
  let usedUnion: Span | null = null;
  /** This chart's own y extent (the series over the data), which it adds to the group's while attached and `syncY`. */
  let ownExtent: Span | null = null;
  let showingRemote = false;
  let focusedIndex: number | null = null;
  let reportedIndex: number | null = null;
  let appliedIndex: number | null | undefined;
  let controlling = false;
  let interaction: ChartRendererRenderContext<never, never, never>["interaction"] | undefined;
  let points: readonly ChartPoint[] = [];
  let model: { readonly zoom: ChartZoomProps | undefined; readonly brush: boolean; readonly extent: Span | null; readonly syncY: boolean; readonly explicit: boolean } = { zoom: undefined, brush: false, extent: null, syncY: false, explicit: false };
  const yCell = memoCell<Span | null>();
  const extraCell = memoCell<readonly number[]>();
  const domainCell = memoCell<[Date, Date] | undefined>();
  const fadeCell = memoCell<readonly [Date, Date] | undefined>();

  const groupFor = (id: string | undefined): LinkGroup => {
    if (id === undefined || id === "") {
      own ??= privateLinkGroup();
      return own;
    }
    return linkGroup(id);
  };
  const zoomOn = (): boolean => model.zoom !== undefined && getZoom() !== undefined;

  // --- The cursor: another member's focus, shown here without a framework or TanStack's focus ------------------------------------------
  const onCursor = (): void => {
    const cursor = group?.cursor.get() ?? null;
    if (cursor === null || cursor.from === self) {
      if (showingRemote) {
        showingRemote = false;
        clearAttribute(attachedTo, SYNCED);
        if (focusedIndex === null) { options.showCursor(null, null); }
      }
      return;
    }
    // This chart's own focus wins (a keyboard focus held here while another chart is hovered).
    if (focusedIndex !== null) {
      return;
    }
    const { data, times } = options.input();
    // A bar chart's category has no place on a time axis.
    const index = typeof cursor.value === "number" ? nearestIndex(times, cursor.value) : -1;
    const row = index < 0 ? undefined : data[index];
    if (!row) {
      if (showingRemote) {
        showingRemote = false;
        clearAttribute(attachedTo, SYNCED);
        options.showCursor(null, null);
      }
      return;
    }
    showingRemote = true;
    raiseAttribute(attachedTo, SYNCED);
    options.showCursor(times[index], row);
  };

  // --- The window: a brush's range or a zoom's window, from this chart or another ----------------------------------------------------
  const preview = (span: Span | null): void => {
    const host = attachedTo;
    const snapshot = options.plot();
    const zoom = getZoom();
    if (!host || !snapshot || !zoom) {
      return;
    }
    const { built, size } = snapshot;
    const drawn: Span = [built.domains.x[0].getTime(), built.domains.x[1].getTime()];
    const { left, top } = options.margin();
    // The hover's band and dims are drawn for the old scene: they leave with the preview's first frame and come back with the redraw.
    if (span !== null) { options.showCursor(null, null); }
    zoom.preview(host, options.surface(), { left, top, innerWidth: size.innerWidth, innerHeight: size.innerHeight }, drawn, span);
  };
  /** The focus this chart holds (its own, or a remote cursor), shown again over the redrawn scene. */
  const restoreCursor = (): void => {
    if (focusedIndex !== null) {
      const { data, times } = options.input();
      const row = data[focusedIndex];
      if (row) { options.showCursor(times[focusedIndex], row); }
    } else if (showingRemote) {
      showingRemote = false;
      onCursor();
    }
  };
  const follow = (next: Span | null): void => {
    if (sameSpan(next, window)) {
      if (zoomOn() && attachedTo?.hasAttribute("data-bkm-zoompv") === true) {
        preview(null);
        restoreCursor();
      }
      return;
    }
    window = next;
    if (zoomOn()) {
      clearPreview = true;
      const report = model.zoom?.onWindowChange;
      report?.(next ? { start: new Date(next[0]), end: new Date(next[1]) } : null);
    }
    options.changed();
  };
  const onWindow = (): void => {
    if (model.brush || model.explicit) {
      return;
    }
    const w: LinkWindow | null = group?.window.get() ?? null;
    if (w === null) {
      follow(null);
      return;
    }
    const span: Span = [w.start, w.end];
    if (w.phase === "preview") {
      if (zoomOn()) {
        preview(span);
      } else if (w.source === "brush") {
        follow(span);
      }
      return;
    }
    follow(span);
  };
  const publishWindow = (span: Span | null, phase: "preview" | "commit", source: "brush" | "zoom"): void => {
    group?.window.set(span === null ? null : { start: Math.round(span[0]), end: Math.round(span[1]), from: self, phase, source });
  };

  const subscribe = (): void => {
    offGroup?.();
    const g = group;
    if (!g || !attachedTo) {
      offGroup = undefined;
      return;
    }
    const offs = [
      g.cursor.subscribe(onCursor),
      g.window.subscribe(onWindow),
      g.extent.subscribe(() => {
        if (model.syncY && !sameSpan(g.extent.get(), usedUnion)) { options.changed(); }
      }),
    ];
    offGroup = (): void => { for (const off of offs) { off(); } };
  };

  const installGestures = (): void => {
    offGestures?.();
    offGestures = undefined;
    const zoom = getZoom();
    const host = attachedTo;
    if (!host || !zoom || model.zoom === undefined) {
      return;
    }
    offGestures = zoom.gestures({
      geom: () => {
        const snapshot = options.plot();
        const { left, top } = options.margin();
        return snapshot ? { left, top, innerWidth: snapshot.size.innerWidth, innerHeight: snapshot.size.innerHeight } : null;
      },
      surface: options.surface,
      extent: () => model.extent,
      shown: () => window ?? model.extent,
      props: () => model.zoom ?? {},
      preview: (span) => { publishWindow(span, "preview", "zoom"); },
      commit: (span, cancel) => {
        if (cancel === true) {
          preview(null);
          restoreCursor();
          return;
        }
        publishWindow(span, "commit", "zoom");
      },
    }).attach(host);
  };

  return {
    model(input) {
      const { props, table, data, times, series } = input;
      const id = props.syncId;
      const next = groupFor(id);
      if (next !== group) {
        group?.setExtent(self, null);
        group = next;
        groupId = id;
        window = null;
        // A member joining late takes the group's settled window.
        const w = next.window.get();
        if (w && w.phase === "commit") { window = [w.start, w.end]; }
        if (attachedTo) { subscribe(); }
      }
      const zoom = propsFor<ChartZoomProps>(table, "zoom")[0];
      const brush = table.has("brush");
      const explicit = props.xDomain !== undefined;
      const extent = times.length > 0 ? extentOf(times) : null;
      const wasZoom = model.zoom !== undefined;
      model = { zoom, brush, extent, syncY: props.syncY === true && groupId !== undefined, explicit };
      if (zoom && mountWindow === undefined) {
        // ChartZoom's `initialWindow` is mount-only; it is published to the group once attached.
        const initial = zoom.initialWindow;
        mountWindow = initial ? [initial.start.getTime(), initial.end.getTime()] : null;
        if (mountWindow && window === null) { window = mountWindow; }
      }
      if (attachedTo && wasZoom !== (zoom !== undefined)) { installGestures(); }
      const ownY = yCell([data, series], () => extentOf(series.flatMap((s) => (s.kind === "pattern" ? [] : data.map((row) => Number(row[s.dataKey]))))));
      ownExtent = ownY;
      group.setExtent(self, model.syncY ? ownY : null);
      const union = model.syncY ? group.extent.get() : null;
      usedUnion = union;
      const pinY = zoomOn() ? ownY : null;
      const lo = Math.min(union?.[0] ?? Number.POSITIVE_INFINITY, pinY?.[0] ?? Number.POSITIVE_INFINITY);
      const hi = Math.max(union?.[1] ?? Number.NEGATIVE_INFINITY, pinY?.[1] ?? Number.NEGATIVE_INFINITY);
      const extraYValues = extraCell([lo, hi], () => (lo <= hi ? [lo, hi] : NONE));
      const shown: Span | null = explicit || brush ? null : (window ?? (zoomOn() ? extent : null));
      const domain = domainCell([shown?.[0], shown?.[1]], () => (shown ? [new Date(shown[0]), new Date(shown[1])] : undefined));
      return {
        // The reader's own array: its identity keys the definition.
        xDomain: props.xDomain ?? domain,
        extraYValues,
        zoom: zoomOn(),
        fadeDomain: fadeCell([zoomOn() ? extent?.[0] : undefined, zoomOn() ? extent?.[1] : undefined], () => (zoomOn() && extent ? [new Date(extent[0]), new Date(extent[1])] : undefined)),
        windowed: !explicit && !brush && window !== null,
      };
    },
    drawn(snapshot) {
      if (clearPreview) {
        const drawn = snapshot.built.domains.x;
        if (window === null || (Math.abs(drawn[0].getTime() - window[0]) < 1 && Math.abs(drawn[1].getTime() - window[1]) < 1)) {
          clearPreview = false;
          preview(null);
          restoreCursor();
        }
      }
    },
    focused(time, index) {
      focusedIndex = index;
      if (!controlling) { clearAttribute(attachedTo, HELD); }
      const g = group;
      if (g && groupId !== undefined) {
        const cursor = g.cursor.get();
        if (time !== null) {
          if (cursor?.value !== time || cursor.from !== self) { g.cursor.set({ value: time, from: self }); }
          if (showingRemote) {
            showingRemote = false;
            clearAttribute(attachedTo, SYNCED);
          }
        } else if (cursor?.from === self) {
          g.cursor.set(null);
        }
      }
      if (index !== reportedIndex) {
        reportedIndex = index;
        options.input().props.onActiveIndexChange?.(index);
      }
    },
    rendered(context) {
      interaction = context.interaction;
      points = context.scene.points;
    },
    applied() {
      const { props, data } = options.input();
      const wanted = props.activeIndex;
      if (wanted === undefined || wanted === appliedIndex || !interaction) {
        return;
      }
      appliedIndex = wanted;
      if (wanted === focusedIndex) {
        return;
      }
      const row = wanted === null ? undefined : data[wanted];
      const point = row === undefined ? undefined : points.find((p) => p.datum === row);
      controlling = true;
      try {
        interaction.setControlledFocus(point ? (point as ChartPoint<never, never, never>) : null);
      } finally {
        controlling = false;
      }
      if (point) { raiseAttribute(attachedTo, HELD); } else { clearAttribute(attachedTo, HELD); }
    },
    brushed(range, phase) {
      if (groupId === undefined) {
        return;
      }
      publishWindow(range ? [range.start.getTime(), range.end.getTime()] : null, phase, "brush");
    },
    stale: () => model.syncY && !sameSpan(group?.extent.get(), usedUnion),
    attach(host) {
      attachedTo = host;
      // Re-attached (a remount, React's StrictMode): this chart's extent joins the group's union again.
      if (model.syncY) { group?.setExtent(self, ownExtent); }
      subscribe();
      installGestures();
      // A ChartZoom's `initialWindow` zooms the group's other charts too.
      if (mountWindow && groupId !== undefined && group?.window.get() === null) {
        publishWindow(mountWindow, "commit", "zoom");
      }
      // A window or cursor another member set before this one mounted.
      onWindow();
      onCursor();
      return (): void => {
        offGroup?.();
        offGroup = undefined;
        offGestures?.();
        offGestures = undefined;
        if (groupId !== undefined && group?.cursor.get()?.from === self) { group.cursor.set(null); }
        // An unmounted panel no longer widens the others' shared scale.
        group?.setExtent(self, null);
        clearAttribute(host, SYNCED);
        clearAttribute(host, HELD);
        showingRemote = false;
        attachedTo = null;
        interaction = undefined;
        appliedIndex = undefined;
      };
    },
  };
}
