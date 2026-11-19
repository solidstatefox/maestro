"use client";
// bklit's tooltip building blocks as plain DOM for the native tooltip body; the native tooltip owns positioning, flip, portal and motion.
// The crosshair and focus-dot primitives are config carriers (see tooltip-carriers.ts).
import { useMemo } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { intFmt } from "../../core/format";
import { hasText, isNumber } from "../../core/guards";
import type { DateTickerProps, TooltipContentProps as CoreTooltipContentProps, TooltipBoxProps as CoreTooltipBoxProps, MarkerTooltipItem as CoreMarkerTooltipItem, MarkerTooltipContentProps as CoreMarkerTooltipContentProps } from "../../core/types/tooltip";

/** Props of `TooltipContent`. */
export interface TooltipContentProps extends CoreTooltipContentProps<ReactNode> {}

/**
 * Props of `TooltipBox`. Only `visible`, `className`, `children`, `panelStyle` and `backgroundColor` change anything; the rest exist so bklit-ui code compiles.
 */
export interface TooltipBoxProps extends CoreTooltipBoxProps<ReactNode, CSSProperties> {}

/** One marker shown by `MarkerTooltipContent`. */
export interface MarkerTooltipItem extends CoreMarkerTooltipItem<ReactNode> {}

/** Props of `MarkerTooltipContent`. */
export interface MarkerTooltipContentProps extends CoreMarkerTooltipContentProps<MarkerTooltipItem> {}

const MUTED = "var(--chart-tooltip-muted, var(--chart-foreground-muted))";

/** bklit's truthiness test on a node: `0`, `""`, `false`, `null` and `undefined` render nothing. */
const hasNode: (node: ReactNode) => boolean = Boolean;

const CONTENT_STYLE: CSSProperties = { minWidth: 140, padding: "10px 12px", fontSize: 14 };
const TITLE_STYLE: CSSProperties = { fontSize: 12, lineHeight: "16px", fontWeight: 500, marginBottom: 8, textAlign: "left" };
const ROWS_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 };
const ROW_LABEL_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
// bklit `text-sm`: 14px / 20px.
const LABEL_TEXT_STYLE: CSSProperties = { color: MUTED, lineHeight: "20px" };
const VALUE_STYLE: CSSProperties = { fontVariantNumeric: "tabular-nums", fontWeight: 500, lineHeight: "20px" };
const CHILDREN_STYLE: CSSProperties = { marginTop: 8 };

const dotStyle = (color: string): CSSProperties => ({ width: 10, height: 10, flexShrink: 0, borderRadius: "50%", background: color });

/**
 * The standard tooltip body: an optional title, one row per series and optional extra content below. Use it inside `ChartTooltip`'s `content` to keep the default look.
 */
export const TooltipContent = /* @__PURE__ */ Object.assign(
  ({ title, rows, children, className }: Readonly<TooltipContentProps>): ReactElement => (
    <div className={className} style={CONTENT_STYLE}>
      {hasText(title) ? <div style={TITLE_STYLE}>{title}</div> : null}
      <div style={ROWS_STYLE}>
        {/* Rows by position: a new set of rows updates the ones there in place, so a hover from one item to the next inserts no DOM in the
            tooltip (an insertion there restyles the whole chart surface: styles.css' `:has()` presence rules). */}
        {rows.map((row, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- positional on purpose, see above
          <div key={index} style={ROW_STYLE}>
            <span style={ROW_LABEL_STYLE}>
              <span style={dotStyle(row.color)} />
              <span style={LABEL_TEXT_STYLE}>{row.label}</span>
            </span>
            <span style={VALUE_STYLE}>{isNumber(row.value) ? intFmt(row.value) : row.value}</span>
          </div>
        ))}
      </div>
      {hasNode(children) ? <div style={CHILDREN_STYLE}>{children}</div> : null}
    </div>
  ),
  { displayName: "TooltipContent" },
);

/**
 * A wrapper for custom tooltip content that applies a minimum width and optional style overrides. The chart positions and animates the tooltip panel itself.
 */
export const TooltipBox = /* @__PURE__ */ Object.assign(
  ({ visible = true, className, children, panelStyle, backgroundColor }: Readonly<TooltipBoxProps>): ReactElement | null => {
    const style = useMemo<CSSProperties>(() => {
      const base: CSSProperties = { minWidth: 140, overflow: "hidden" };
      if (hasText(backgroundColor)) {
        base.backgroundColor = backgroundColor;
      }
      return { ...base, ...panelStyle };
    }, [backgroundColor, panelStyle]);
    if (!visible) {
      return null;
    }
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  },
  { displayName: "TooltipBox" },
);

const DATE_PILL_STYLE: CSSProperties = {
  display: "inline-block",
  borderRadius: 9999,
  padding: "4px 16px",
  fontSize: 14,
  fontWeight: 500,
  whiteSpace: "nowrap",
  background: "var(--chart-date-pill-background)",
  color: "var(--chart-date-pill-foreground)",
};

/** A pill showing one of the chart's date labels, for use in custom tooltip content. */
export const DateTicker = /* @__PURE__ */ Object.assign(
  ({ currentIndex, labels, visible }: Readonly<DateTickerProps>): ReactElement | null => {
    if (!visible || labels.length === 0) {
      return null;
    }
    const label = labels[currentIndex] ?? labels[0];
    return <div style={DATE_PILL_STYLE}>{label}</div>;
  },
  { displayName: "DateTicker" },
);

const MAX_TOOLTIP_MARKERS = 2;
const LINK_ARROW = "\u2197";

const MARKERS_STYLE: CSSProperties = { marginTop: 8, display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${MUTED}`, paddingTop: 8 };
const MARKER_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8 };
const MARKER_ICON_FOREGROUND_STYLE: CSSProperties = { fontSize: 12, color: "var(--chart-marker-foreground)" };
const MARKER_BODY_STYLE: CSSProperties = { minWidth: 0, flex: 1 };
const MARKER_TITLE_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 500 };
const MARKER_LINK_STYLE: CSSProperties = { fontSize: 10, color: MUTED };
const MARKER_DESCRIPTION_STYLE: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: MUTED };
const MARKER_MORE_STYLE: CSSProperties = { paddingLeft: 28, fontSize: 12, color: MUTED };

const markerDiscStyle = (color: string | undefined): CSSProperties => ({
  display: "flex",
  width: 20,
  height: 20,
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
  backgroundColor: hasText(color) ? color : "var(--chart-marker-background)",
  border: "1px solid var(--chart-marker-border)",
});

/**
 * A list of event markers for the bottom of a tooltip, each with an icon disc, title and description. Shows the first two and "+N more..." for the rest.
 */
export const MarkerTooltipContent = /* @__PURE__ */ Object.assign(
  ({ markers }: Readonly<MarkerTooltipContentProps>): ReactElement | null => {
    if (markers.length === 0) {
      return null;
    }
    const hidden = markers.length - MAX_TOOLTIP_MARKERS;
    return (
      <div style={MARKERS_STYLE}>
        {markers.slice(0, MAX_TOOLTIP_MARKERS).map((marker) => (
          <div key={marker.title} style={MARKER_ROW_STYLE}>
            <div style={markerDiscStyle(marker.color)}>
              <span style={MARKER_ICON_FOREGROUND_STYLE}>{marker.icon}</span>
            </div>
            <div style={MARKER_BODY_STYLE}>
              {marker.content ?? (
                <>
                  <div style={MARKER_TITLE_STYLE}>
                    {marker.title}
                    {marker.onClick !== undefined || hasText(marker.href) ? <span style={MARKER_LINK_STYLE}>{LINK_ARROW}</span> : null}
                  </div>
                  {hasText(marker.description) ? <div style={MARKER_DESCRIPTION_STYLE}>{marker.description}</div> : null}
                </>
              )}
            </div>
          </div>
        ))}
        {hidden > 0 ? <div style={MARKER_MORE_STYLE}>{`+${hidden} more...`}</div> : null}
      </div>
    );
  },
  { displayName: "MarkerTooltipContent" },
);
