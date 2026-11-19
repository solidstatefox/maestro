import { createMark } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { scopePaintUrl } from "../resource-ids";
import type { BackgroundConfig } from "../types/cartesian";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";

const DEFAULT_FADE = 10;
const MAX_FADE = 45;
const NO_POINTS: [] = [];
/** The unscoped pattern id; the host scopes it to the chart (`scopeMarkupIds`). */
export const BACKGROUND_PATTERN_ID = "chart-background";

/** bklit `clampFadeLength`: the percent of the plot faded per edge, 0..45; an axis whose fade is off (`fadeHorizontal` / `fadeVertical` false) is 0. */
const fadeEdge = (on = true, len = DEFAULT_FADE): number => (on ? Math.min(MAX_FADE, Math.max(0, len)) : 0);

/** The Background child that paints: `showFill: false` or `pattern: "none"` leaves none (background.tsx:63,84). */
export const activeBackground = (table: ChildTable): Readonly<BackgroundConfig> | undefined => {
  const props = propsFor<BackgroundConfig>(table, "background").at(0);
  const paints = props?.showFill !== false && props?.pattern !== "none";
  return paints ? props : undefined;
};

/** The pattern rect, drawn under every series; the group sits at the plot origin so the tile starts there (bklit draws it in the plot group). */
export function backgroundMarks(table: ChildTable, uid: string): AnyMark[] {
  const props = activeBackground(table);
  if (!props) {
    return [];
  }
  const fill = scopePaintUrl(`url(#${BACKGROUND_PATTERN_ID})`, uid);
  return [erase(createMark<unknown, Date, number>(() => ({
    id: "background-fill",
    channels: {},
    render: ({ chart }) => ({
      nodes: [{
        kind: "group",
        key: "background:fill",
        className: "bkm-bg",
        ariaHidden: true,
        translateX: chart.x,
        translateY: chart.y,
        children: [{ kind: "rect", key: "background:rect", x: 0, y: 0, width: chart.width, height: chart.height, style: { fill, opacity: props.opacity ?? 1 } }],
      }],
      points: NO_POINTS,
    }),
  })))];
}

/** Scoped CSS vars for styles.css `.bkm-bg`: the edge fade lengths (% per edge). */
export function backgroundCss(scope: string, table: ChildTable): string {
  const props = activeBackground(table);
  if (!props) {
    return "";
  }
  const h = fadeEdge(props.fadeHorizontal, props.fadeHorizontalLength);
  const v = fadeEdge(props.fadeVertical, props.fadeVerticalLength);
  // Hidden until the ready gate flips (bklit isLoaded, background.tsx:119); styles.css `bkm-bg-in` then fades it in (:120-125,208).
  return `${scope} .bkm-bg{--bkm-bg-h:${h}%;--bkm-bg-v:${v}%}${scope}:not([data-bkm-ready]) .bkm-bg rect{opacity:0!important}`;
}
