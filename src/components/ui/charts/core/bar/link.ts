import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import type { FocusedRow } from "../cartesian/context";
import type { Row } from "../cartesian/series";
import { clearAttribute, raiseAttribute } from "../host-write";
import type { FocusStore } from "../hover/focus-store";
import { linkGroup } from "../link/group";
import type { LinkGroup } from "../link/group";
import type { ChartLinkProps } from "../types/link";

export interface BarLinkOptions {
  /** The latest pass: the reader's link props, the rows and their categories (`String(row[xDataKey])`). */
  readonly input: () => { readonly props: ChartLinkProps; readonly data: readonly Row[]; readonly categories: readonly string[] };
  /** The chart's focused row: the indicator, the dims and the custom children follow it (core/bar/host.ts `follow`). */
  readonly focus: FocusStore<FocusedRow>;
}

export interface BarLink {
  /** The chart's own focus changed (the renderer's `onFocusChange`). */
  focused(row: FocusedRow | null): void;
  rendered(context: ChartRendererRenderContext<never, never, never>): void;
  applied(): void;
  attach(host: HTMLElement): () => void;
}

const SYNCED = "data-bkm-synced";
const HELD = "data-bkm-held";

export function createBarLink(options: BarLinkOptions): BarLink {
  const self = {};
  let group: LinkGroup | undefined;
  let host: HTMLElement | null = null;
  let off: (() => void) | undefined;
  let own: number | null = null;
  let reported: number | null = null;
  let remote = false;
  let controlling = false;
  let appliedIndex: number | null | undefined;
  let interaction: ChartRendererRenderContext<never, never, never>["interaction"] | undefined;
  let points: readonly ChartPoint[] = [];

  const onCursor = (): void => {
    const cursor = group?.cursor.get() ?? null;
    if (cursor === null || cursor.from === self || typeof cursor.value !== "string") {
      if (remote) {
        remote = false;
        clearAttribute(host, SYNCED);
        if (own === null) { options.focus.set(null); }
      }
      return;
    }
    if (own !== null) {
      return;
    }
    const { data, categories } = options.input();
    const index = categories.indexOf(cursor.value);
    const row = index < 0 ? undefined : data[index];
    remote = row !== undefined;
    if (row) { raiseAttribute(host, SYNCED); } else { clearAttribute(host, SYNCED); }
    options.focus.set(row ? { row, index } : null);
  };
  const join = (): void => {
    const id = options.input().props.syncId;
    const next = id === undefined || id === "" ? undefined : linkGroup(id);
    if (next === group) {
      return;
    }
    off?.();
    off = undefined;
    group = next;
    if (group && host) { off = group.cursor.subscribe(onCursor); }
  };

  return {
    focused(row) {
      own = row?.index ?? null;
      if (!controlling) { clearAttribute(host, HELD); }
      remote = false;
      clearAttribute(host, SYNCED);
      const g = group;
      if (g) {
        const cursor = g.cursor.get();
        const category = row === null ? null : options.input().categories[row.index];
        if (category !== null && category !== undefined) {
          if (cursor?.value !== category || cursor.from !== self) { g.cursor.set({ value: category, from: self }); }
        } else if (cursor?.from === self) {
          g.cursor.set(null);
        }
      }
      if (own !== reported) {
        reported = own;
        options.input().props.onActiveIndexChange?.(own);
      }
    },
    rendered(context) {
      interaction = context.interaction;
      points = context.scene.points;
    },
    applied() {
      join();
      const wanted = options.input().props.activeIndex;
      if (wanted === undefined || wanted === appliedIndex || !interaction) {
        return;
      }
      appliedIndex = wanted;
      if (wanted === own) {
        return;
      }
      // A bar's datum is `{ index, source }` (core/bar/host.ts `barFocusedRow`).
      const point = wanted === null ? undefined : points.find((p) => (p.datum as { index?: number } | null)?.index === wanted);
      controlling = true;
      try {
        interaction.setControlledFocus(point ? (point as ChartPoint<never, never, never>) : null);
      } finally {
        controlling = false;
      }
      if (point) { raiseAttribute(host, HELD); } else { clearAttribute(host, HELD); }
    },
    attach(el) {
      host = el;
      group = undefined;
      join();
      onCursor();
      return (): void => {
        off?.();
        off = undefined;
        if (group?.cursor.get()?.from === self) { group.cursor.set(null); }
        group = undefined;
        clearAttribute(el, SYNCED);
        clearAttribute(el, HELD);
        host = null;
        interaction = undefined;
        appliedIndex = undefined;
        remote = false;
      };
    },
  };
}
