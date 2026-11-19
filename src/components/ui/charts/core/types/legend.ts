export interface LegendItem {
  /** Name shown for the item. */
  readonly label: string;
  /** Current value of the item. */
  readonly value: number;
  /** Value that counts as 100%. Drives the percentage and `LegendProgress`; both are hidden when it is missing or zero. */
  readonly maxValue?: number;
  /** Color of the marker and the progress bar. */
  readonly color: string;
}

/** Props of `ChartLegend`. */
export interface ChartLegendProps<Node> {
  /** The items to list. */
  readonly items: LegendItem[];
  /**
   * Hovered item index (`null` for none). Pair it with `onHover` to share hover with a chart.
   * @default null
   */
  readonly hoveredIndex?: number | null;
  /** Called with the item index when the pointer enters a row, and `null` when it leaves. */
  readonly onHover?: (index: number | null) => void;
  /**
   * Show a progress bar under each item that has a `maxValue`.
   * @default false
   */
  readonly showProgress?: boolean;
  /**
   * Show the colored dot before each label.
   * @default true
   */
  readonly showMarker?: boolean;
  /**
   * Show each item's value.
   * @default true
   */
  readonly showValue?: boolean;
  /**
   * Show each item's percentage of `maxValue`, under its progress bar: it takes effect only with `showProgress` and an item `maxValue`, as in bklit-ui
   * (chart-legend.tsx:115, where the plain row has no percentage). For a percentage without a bar, compose `Legend` with `LegendValue showPercentage`.
   * @default the value of `showProgress`
   */
  readonly showPercentage?: boolean;
  /**
   * Formats each value.
   * @default en-US number format, for example "1,234"
   */
  readonly formatValue?: (value: number) => string;
  /** Heading shown above the items. */
  readonly title?: string;
  /** Class names added to the legend container. */
  readonly className?: string;
  /** Class names added to the title, on top of the default title style. */
  readonly titleClassName?: string;
  /** Class names added to each row. */
  readonly itemClassName?: string;
  /** Class names that replace the default label text style. */
  readonly labelClassName?: string;
  /** Class names that replace the default value text style. */
  readonly valueClassName?: string;
  /**
   * Renders a row yourself. Receives the item, its index, hover flags and its percentage of `maxValue`. When set, the `show*` options are ignored.
   */
  readonly renderItem?: (props: Readonly<{
    readonly item: LegendItem;
    readonly index: number;
    readonly isHovered: boolean;
    readonly isFaded: boolean;
    readonly percentage: number;
  }>) => Node;
}

/** One entry of a `Legend`. */
export interface LegendItemData {
  /** Name shown for the item. */
  label: string;
  /** Current value of the item. */
  value: number;
  /** Value that counts as 100%. Drives the percentage and `LegendProgress`; both are hidden when it is missing or zero. */
  maxValue?: number;
  /** Color of the marker and the progress bar. */
  color: string;
}

/** What `useLegend()` returns inside a `Legend`. */
export interface LegendContextValue {
  /** The items of the legend. */
  items: LegendItemData[];
  /** Index of the hovered item, or `null`. */
  hoveredIndex: number | null;
  /** Sets the hovered item. In a controlled legend it calls `onHoverChange` instead. */
  setHoveredIndex: (index: number | null) => void;
}

/** What `useLegendItem()` returns inside a `Legend` item. */
export interface LegendItemContextValue {
  /** The item being rendered. */
  item: LegendItemData;
  /** Position of the item. */
  index: number;
  /** Whether this item is hovered. */
  isHovered: boolean;
  /** Whether another item is hovered, so this one should be dimmed. */
  isFaded: boolean;
  /** `value / maxValue * 100`, or `0` when the item has no `maxValue`. */
  percentage: number;
}

/** Props of `Legend`. */
export interface LegendProps<Element> {
  /** The items to list. */
  items: LegendItemData[];
  /** Controlled hovered item index (`null` for none). The legend manages hover itself when this is left `undefined`. */
  hoveredIndex?: number | null;
  /** Called with the hovered item index, or `null` when the pointer leaves. Only used when `hoveredIndex` is controlled. */
  onHoverChange?: (index: number | null) => void;
  /** Heading shown above the items. */
  title?: string;
  /** Class names added to the title, on top of the default title style. */
  titleClassName?: string;
  /** Class names added to the legend container. */
  className?: string;
  /** A single element rendered once per item, usually a `LegendItemComponent`. */
  children: Element;
}

/** Props of `LegendItemComponent`. */
export interface LegendItemProps<Node> {
  /** Class names added to the row, on top of the default row style. */
  className?: string;
  /** Row content, for example `LegendMarker`, `LegendLabel`, `LegendValue` and `LegendProgress`. */
  children: Node;
}

/** Props of `LegendMarker`. */
export interface LegendMarkerProps {
  /** Class names that replace the default marker size. */
  className?: string;
}

/** Props of `LegendLabel`. */
export interface LegendLabelProps {
  /** Class names that replace the default label text style. */
  className?: string;
}

/** Props of `LegendValue`. */
export interface LegendValueProps {
  /** Class names that replace the default value text style. */
  className?: string;
  /**
   * Show the percentage of `maxValue` next to the value. Nothing is shown for items without a `maxValue`.
   * @default false
   */
  showPercentage?: boolean;
  /** Class names that replace the default percentage text style. */
  percentageClassName?: string;
  /**
   * Formats the value.
   * @default en-US number format, for example "1,234"
   */
  formatValue?: (value: number) => string;
  /**
   * Formats the percentage (a number from 0 to 100).
   * @default percentage rounded to a whole number followed by %
   */
  formatPercentage?: (percentage: number) => string;
}

/** Props of `LegendProgress`. */
export interface LegendProgressProps {
  /** Class names added to the progress track. */
  trackClassName?: string;
  /** Class names added to the filled bar. */
  indicatorClassName?: string;
  /** Height of the progress track. Defaults to a thin bar. */
  height?: string;
}

/** Props of `ProfitLossLegend`. */
export interface ProfitLossLegendProps {
  /**
   * Controlled hovered item: `0` is Profit, `1` is Loss, `null` is none.
   * @default null
   */
  hoveredIndex?: number | null;
  /** Called with the hovered item index (`0` Profit, `1` Loss), or `null` when the pointer leaves. */
  onHoverChange?: (index: number | null) => void;
  /**
   * Horizontal alignment of the legend.
   * @default "start"
   */
  align?: "start" | "center" | "end";
  /** Extra class names added to the legend wrapper. */
  className?: string;
}
