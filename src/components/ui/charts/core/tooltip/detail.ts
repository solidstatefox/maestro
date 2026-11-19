export interface TooltipDetailProps<Node> {
  /** Keep it unfolded whether or not the tooltip is pinned. */
  readonly open?: boolean;
  /** Extra class name for the detail's inner box (padding, a border, a gap). */
  readonly className?: string;
  /** The detail. */
  readonly children?: Node;
}

/** The outer element's class: it animates its one row, whose child clips, around the box that takes the reader's `className` (padding
 * in a collapsing row would still show). */
export const TOOLTIP_DETAIL_CLASS = "bkm-tt-detail";

/** The outer element's attributes: `data-open` forces it open. */
export const tooltipDetailAttrs = (open: boolean | undefined): Readonly<Record<string, string | undefined>> => ({ "data-open": open === true ? "" : undefined });
