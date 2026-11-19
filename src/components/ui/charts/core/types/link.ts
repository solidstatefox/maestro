export interface ChartWindow {
  readonly start: Date;
  readonly end: Date;
}

/** Props a `LineChart`, `AreaChart` or `BarChart` takes to link with other charts and to be driven from outside (a table, a list). */
export interface ChartLinkProps {
  /**
   * Charts with the same `syncId` move together: hovering or keyboard-focusing one shows the crosshair, dots and date pill at the same
   * date on the others (the same category, for bar charts), and a `ChartBrush` or `ChartZoom` in a time chart zooms the time charts of
   * the group to its window.
   */
  readonly syncId?: string;
  /**
   * With `syncId`: every chart of the group draws on one y scale (the union of their data), so small multiples compare at a glance.
   * Read by `LineChart` and `AreaChart`.
   * @default false
   */
  readonly syncY?: boolean;
  /** Index into `data` of the row to focus (crosshair, dots and tooltip), for example the row a table has under the pointer. `null` clears it. */
  readonly activeIndex?: number | null;
  /** Called with the index into `data` of the row the pointer or keyboard focuses, and with `null` when the focus leaves. */
  readonly onActiveIndexChange?: (index: number | null) => void;
}

/** Props of `ChartZoom`. */
export interface ChartZoomProps {
  /**
   * What the mouse wheel does. `"modifier"`: Ctrl or ⌘ with the wheel (and a trackpad pinch) zooms, a plain wheel scrolls the page.
   * `"always"`: the wheel always zooms. `"none"`: no wheel zoom. A horizontal wheel or swipe pans, except with `"none"`.
   * @default "modifier"
   */
  readonly wheel?: "modifier" | "always" | "none";
  /**
   * Furthest zoom, as a multiple of the full time range.
   * @default 24
   */
  readonly maxZoom?: number;
  /** Window shown on mount. Defaults to the full time range. */
  readonly initialWindow?: ChartWindow | null;
  /** Called when a zoom or pan settles, with the shown window (`null` once it is back to the full range). */
  readonly onWindowChange?: (window: ChartWindow | null) => void;
}
