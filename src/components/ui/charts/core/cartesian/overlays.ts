import { createMark, dot, lineY, rect } from "@tanstack/charts";
import type { ChartBounds, ChartGradient, SceneNode } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { pushDecorative, yScaleForAxis } from "./build-state";
import { curveLinear } from "d3-shape";
import type { CurveFactory } from "d3-shape";
import { declaredBefore, propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { userGradients } from "../gradients";
import { axisId, toDate } from "./series";
import type { Row } from "./series";
import { erase } from "../erased-types";
import type { AnyMark } from "../erased-types";
import type { ChartMarkersProps, MarkerGroupProps } from "../types/cartesian";
import { scopePaintUrl } from "../resource-ids";
import { referencePatternId, usesReferencePattern } from "./reference-pattern";
import type { ReferencePatternProps } from "./reference-pattern";

// bklit buildHorizontalTangentBezierPath (tension 0.45): horizontal tangents with control points 0.45·dx in from each end.
// curveBumpX is the same shape at 0.5·dx, which lengthens the curve and drifts the dash phase.
const PROJECTION_TENSION = 0.45;
const noop = (): void => undefined;
const curveProjectionBezier: CurveFactory = (context) => {
  let point = 0;
  let px = 0;
  let py = 0;
  return {
    areaStart: noop,
    areaEnd: noop,
    lineStart() {
      point = 0;
    },
    lineEnd: noop,
    point(x: number, y: number) {
      if (point === 0) {
        context.moveTo(x, y);
      } else {
        const dx = (x - px) * PROJECTION_TENSION;
        context.bezierCurveTo(px + dx, py, x - dx, y, x, y);
      }
      point = 1;
      px = x;
      py = y;
    },
  };
};

interface ProjectionProps {
  data: { date: Date; value: number }[];
  stroke?: string;
  strokeStyle?: "solid" | "gradient";
  gradientStart?: string;
  gradientEnd?: string;
  strokeWidth?: number;
  curveKind?: "linear" | "bezier";
  strokeDasharray?: string;
  strokeOpacity?: number;
  showEndMarker?: boolean;
  /** bklit's deprecated alias of `showEndMarker`. */
  showEndpoints?: boolean;
  endpointRadius?: number;
  yAxisId?: string | number;
}
interface TerminalProps {
  dataKey: string;
  yAxisId?: string | number;
  stroke?: string;
  ringGap?: number;
  radius?: number;
  strokeWidth?: number;
  fill?: string;
}
interface ReferenceProps extends ReferencePatternProps {
  x1?: Date | number;
  x2?: Date | number;
  y1?: number;
  y2?: number;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed";
  strokeDasharray?: string;
  fadeEdges?: boolean;
  showMarkers?: boolean;
  markerColor?: string;
  markerSize?: number;
  yAxisId?: string | number;
}
interface MarkerItem {
  date: Date;
  icon?: unknown;
  color?: string;
  onClick?: () => void;
  href?: string;
  target?: "_blank" | "_self";
}
interface MarkerGroup {
  date: Date;
  items: MarkerItem[];
}

/** ChartMarkers children plus bklit MarkerGroup children (one marker group each), in one list. */
export function chartMarkerProps(table: ChildTable): readonly MarkerSetProps[] {
  return [
    ...propsFor<ChartMarkersProps>(table, "chartMarkers"),
    ...propsFor<MarkerGroupProps>(table, "markerGroup").map((g) => ({ items: g.markers, size: g.size, showLines: g.showLine, maxFanned: g.maxFanned, forceOpen: g.forceOpen, marginLeft: g.marginLeft, marginTop: g.marginTop, borderColor: g.borderColor, borderWidth: g.borderWidth, isMuted: g.isMuted })),
  ];
}

/** bklit MarkerGroup's grouping (markers/chart-markers.tsx): same-date markers, in first-seen order. Shared by the scene and the click handler (marker-springs.ts). */
export function groupMarkerItems<T extends { readonly date: Date | number }>(items: readonly T[]): T[][] {
  const byDate = new Map<number, T[]>();
  for (const it of items) {
    const k = toDate(it.date).getTime();
    byDate.set(k, [...(byDate.get(k) ?? []), it]);
  }
  return [...byDate.values()];
}

// The roles drawn as series by the cartesian kit (series.ts).
const SERIES_ROLES = ["line", "area", "patternArea"] as const;
const SHADOW_FILL = "black";
const MARKER_BORDER = "var(--chart-marker-border)";
const FAN_RADIUS = 50;
const FAN_ANGLE = 160;
// bklit draws marker icons as HTML flex-centred in a 28px disc box; its glyph lands 1px below the SVG middle-baseline text (measured, /charts/markers and /charts/line at 390: 423 -> 22 diff px).
const ICON_DY = 1;
/** ChartMarkers props plus the MarkerGroup styling props bklit's ChartMarkers does not forward (marker-group.tsx:140-143). */
type MarkerSetProps = ChartMarkersProps & Pick<MarkerGroupProps, "borderColor" | "borderWidth" | "isMuted" | "forceOpen" | "marginLeft" | "marginTop">;
interface EventMarkerOptions {
  readonly id: string;
  readonly mi: number;
  readonly groups: readonly MarkerGroup[];
  readonly set: MarkerSetProps;
}

// bklit MarkerGroup as one custom mark: a scene group per same-date marker group (`evtmarker:<mi>:g<gi>`), translated to the marker centre (8px above the plot top); the 1.0 scene has no per-node number hooks, so CSS derives group and fan item index from sibling-index() (Chromium-only, 138+: styles.css keeps the indices at 0 outside `@supports`).
// styles.css has the generic rules (entrance, hover rule lift, cluster fan-out), all :hover on the group.
interface OverlayScene {
  readonly nodes: SceneNode[];
  readonly points: [];
}

function eventMarkers({ id, mi, groups, set }: EventMarkerOptions): AnyMark {
  const size = set.size ?? 28;
  const showLines = set.showLines !== false;
  const { maxFanned } = set;
  // bklit MarkerGroup `portalX = x + marginLeft`, `portalY = y + marginTop` (marker-group.tsx:185-186): the fan anchors off the marker by the gap to the chart margin (zero when unset, as ChartMarkers passes it).
  const r = size / 2;
  const icon = (x: number, y: number, v: unknown): SceneNode => ({
    kind: "label",
    key: `${id}:icon`,
    x,
    y,
    text: String(v ?? ""),
    anchor: "middle",
    baseline: "middle",
    fontSize: size * 0.5,
    style: { fill: "var(--chart-marker-foreground)" },
  });
  const disc = (x: number, y: number, color?: string): SceneNode => ({
    kind: "dot",
    key: `${id}:disc`,
    x,
    y,
    radius: r,
    style: { fill: color ?? "var(--chart-marker-background)", stroke: set.borderColor ?? MARKER_BORDER, strokeWidth: set.borderWidth ?? 1.5 },
  });
  // bklit's fan disc is `rounded-full shadow-lg` (box-shadow 0 10px 15px -3px / 0 4px 6px -4px, rgb 0 0 0 / .1); a CSS drop-shadow has no negative spread, so each layer is a blurred, shrunk circle behind the disc (radius attribute = rest radius, disc radius minus the spread, so any `size` works).
  // Offset and blur come from styles.css `.bkm-evt-sh*`; core/motion/marker-springs.ts springs them to bklit's hover shadow (hot radius = the disc radius, the `.bkm-evt-act:hover` rule in styles.css).
  const shadows = (key: string): SceneNode[] =>
    [1, 2].map((layer) => ({ kind: "dot", key: `${key}:sh${layer}`, className: `bkm-evt-sh bkm-evt-sh${layer}`, x: 0, y: 0, radius: r - (layer === 1 ? 3 : 4), style: { fill: SHADOW_FILL } }));
  const fanItem = (key: string, k: number, a: number, it: MarkerItem, gi: number): SceneNode => {
    const itemKey = `${key}:item${k}`;
    const discNodes = [...shadows(itemKey), { ...disc(0, 0, it.color), key: `${itemKey}:disc`, className: "bkm-evt-item-disc" }, { ...icon(0, ICON_DY, it.icon), key: `${itemKey}:icon` }];
    // bklit MarkerCircleHTML `hasAction` (marker-group.tsx:473): hover 1.15 / press 0.95 springs (marker-springs.ts), pointer cursor, click.
    const hasAction = Boolean(it.onClick ?? it.href);
    const press: SceneNode = { kind: "group", key: `${itemKey}:press`, className: `bkm-evt-act bkm-evt-act-${mi}-${gi}-${k}`, children: discNodes };
    return {
      kind: "group",
      key: itemKey,
      className: "bkm-evt-item",
      children: [{ kind: "group", key: `${itemKey}:at`, translateX: Math.cos(a) * FAN_RADIUS, translateY: Math.sin(a) * FAN_RADIUS, children: hasAction ? [press] : discNodes }],
    };
  };
  const badge = (key: string, n: number): SceneNode => {
    const bx = r + 2;
    return {
      kind: "group",
      key: `${key}:badge`,
      className: "bkm-evt-badge",
      children: [
        { kind: "dot", key: `${key}:badge-disc`, x: bx, y: -bx, radius: 9, style: { fill: "var(--chart-marker-badge-background)" } },
        {
          kind: "label",
          key: `${key}:badge-count`,
          x: bx,
          y: -bx,
          text: String(n),
          anchor: "middle",
          baseline: "middle",
          fontSize: 11,
          fontWeight: 600,
          style: { fill: "var(--chart-marker-badge-foreground)" },
        },
      ],
    };
  };
  const groupScene = (g: MarkerGroup, gi: number, x: number, chart: ChartBounds): SceneNode => {
    const key = `${id}:g${gi}`;
    const n = g.items.length;
    const first = g.items.at(0);
    const children: SceneNode[] = [];
    if (showLines) {
      children.push({
        kind: "rule",
        key: `${key}:rule`,
        className: "bkm-evt-rule",
        x1: 0,
        x2: 0,
        y1: r + 4,
        y2: chart.height + 8,
        style: { stroke: MARKER_BORDER, strokeOpacity: 0.6, strokeWidth: 1, strokeDasharray: "4 4", lineCap: "round" },
      });
    }
    const body: SceneNode[] = [
      { kind: "dot", key: `${key}:shadow`, x: 0, y: 2, radius: r, style: { fill: SHADOW_FILL, fillOpacity: 0.15 } },
      { ...disc(0, 0, first?.color), key: `${key}:disc` },
      { ...icon(0, ICON_DY, first?.icon), key: `${key}:icon` },
    ];
    if (n > 1) {
      body.push(badge(key, n));
    }
    const bodyGroup: SceneNode = { kind: "group", key: `${key}:body`, className: "bkm-evt-body", children: body };
    // bklit MarkerGroup `isMuted` (marker-group.tsx:153, 114-118): the resting body sits at opacity 0.4; the fan hides it, so only the resting state shows it.
    const restBody: SceneNode = set.isMuted === true ? { kind: "group", key: `${key}:muted`, style: { opacity: 0.4 }, children: [bodyGroup] } : bodyGroup;
    // bklit's transparent hover rect (covers the disc with room for the badge); a cluster's grows to the fan area. It sits under the fan so an actionable fan disc takes the pointer first.
    children.push(restBody, { kind: "rect", key: `${key}:hit`, className: "bkm-evt-hit", x: -size * 0.75, y: -size, width: size * 1.5, height: size * 1.5, style: { fill: "transparent" } });
    if (n > 1) {
      // bklit MarkerGroup `maxFanned` (marker-group.tsx:148-149): only the first N fan out; the badge keeps the full count.
      const fanned = maxFanned === undefined ? g.items : g.items.slice(0, maxFanned);
      const angleAt = (k: number): number => ((-90 - FAN_ANGLE / 2 + (fanned.length > 1 ? (k * FAN_ANGLE) / (fanned.length - 1) : 0)) * Math.PI) / 180;
      const fan: SceneNode[] = [
        { kind: "dot", key: `${key}:core`, className: "bkm-evt-core", x: 0, y: 0, radius: r / 2, style: { fill: MARKER_BORDER } },
        ...fanned.map((it, k) => fanItem(key, k, angleAt(k), it, gi)),
      ];
      children.push({ kind: "group", key: `${key}:fan`, translateX: (set.marginLeft ?? chart.x) - chart.x, translateY: (set.marginTop ?? chart.y) - chart.y, children: fan });
    }
    const openSuffix = set.forceOpen === true ? " bkm-evt-open" : "";
    return {
      kind: "group",
      key,
      className: n > 1 ? `bkm-evt bkm-evt-cluster${openSuffix}` : "bkm-evt",
      ariaHidden: true,
      translateX: x,
      translateY: chart.y - 8,
      children,
    };
  };
  return erase(createMark<unknown, Date, number>(() => ({
    id,
    channels: {},
    render: ({ scales, chart }): OverlayScene => {
      const nodes = groups.flatMap((g, gi) => {
        const x = scales.x.map(g.date);
        return Number.isFinite(x) ? [groupScene(g, gi, x, chart)] : [];
      });
      return { nodes: [{ kind: "group", key: id, ariaHidden: true, children: nodes }], points: [] };
    },
  })));
}

interface ReferenceMarkerOptions {
  readonly id: string;
  readonly mid: Date;
  readonly size: number;
  readonly fill: string;
  readonly yScaleId: string;
  readonly top: number;
  readonly bottom: number;
}

function referenceMarkers({ id, mid, size, fill, yScaleId, top, bottom }: ReferenceMarkerOptions): AnyMark {
  const h = size / 2;
  const tri = (cx: number, key: string, edgeY: number, dir: 1 | -1): SceneNode => ({
    kind: "area",
    key: `${id}:${key}`,
    points: [[cx - h, edgeY], [cx + h, edgeY], [cx, edgeY + dir * size]],
    style: { fill, stroke: "none" },
  });
  return erase(createMark<unknown, Date, number>(() => ({
    id,
    channels: {},
    render: ({ scales }): OverlayScene => {
      const cx = scales.x.map(mid);
      const yScale = scales[yScaleId] ?? scales.y;
      const topY = yScale.map(top);
      const bottomY = yScale.map(bottom);
      if (!Number.isFinite(cx) || !Number.isFinite(topY) || !Number.isFinite(bottomY)) {
        return { nodes: [], points: [] };
      }
      return { nodes: [{ kind: "group", key: id, ariaHidden: true, children: [tri(cx, "top", topY, 1), tri(cx, "bottom", bottomY, -1)] }], points: [] };
    },
  })));
}

interface Overlays {
  readonly xValues: Date[];
  readonly yValues: number[];
  /** Projection path values: bklit merges these AFTER nicing the data domain (`mergeProjectionYDomain`). */
  readonly projectionYValues: Map<string, number[]>;
  readonly gradients: ChartGradient[];
  /** Marks need the final y-domain (markers sit on the top edge). */
  readonly marks: (yDomain: readonly [number, number], xDomain: readonly [Date, Date], innerWidth?: number, under?: AnyMark[]) => AnyMark[];
}

/** Wraps a mark in the native reveal groups (definition.ts wipeWrap); absent when the chart does not reveal. */
export type WipeMark = <M>(mark: M, tag: string) => M;

interface ReferenceAreaContext {
  readonly index: number;
  readonly uid: string;
  readonly xDomain: readonly [Date, Date];
  readonly yDomain: readonly [number, number];
}

/** bklit ReferenceArea: fill band, dashed top/bottom edges (both faded at the left/right ends, see styles.css `refarea`), optional bracket markers at the centre, 420ms fade-in. */
function referenceAreaMarks(r: ReferenceProps, { index: i, uid, xDomain, yDomain }: ReferenceAreaContext): AnyMark[] {
  const out: AnyMark[] = [];
  const stroke = r.stroke ?? "var(--chart-foreground-muted)";
  const x1 = r.x1 === undefined ? xDomain[0] : toDate(r.x1);
  const x2 = r.x2 === undefined ? xDomain[1] : toDate(r.x2);
  const top = r.y2 ?? yDomain[1];
  const bottom = r.y1 ?? yDomain[0];
  const onAxis = yScaleForAxis(r.yAxisId);
  const fade = r.fadeEdges === false ? "-solid" : "";
  const dash = (r.strokeStyle ?? "dashed") === "dashed" ? (r.strokeDasharray ?? "4,4").replace(",", " ") : undefined;
  pushDecorative(
    out,
    rect([r], {
      id: `refarea${fade}:${i}:fill`,
      ...onAxis,
      x1: () => x1,
      x2: () => x2,
      y1: () => bottom,
      y2: () => top,
      // A pattern replaces the solid fill (bklit reference-area.tsx:200); its tile is in the chart's defs host (markup/resources.ts).
      fill: usesReferencePattern(r) ? scopePaintUrl(`url(#${referencePatternId(i)})`, uid) : (r.fill ?? "color-mix(in oklch, var(--chart-foreground-muted) 12%, transparent)"),
      fillOpacity: r.fillOpacity ?? 1,
      inset: 0,
    }),
  );
  for (const [edge, y] of [["top", top], ["bottom", bottom]] as const) {
    pushDecorative(
      out,
      lineY([x1, x2], erase({
        id: `refarea${fade}:${i}:${edge}`,
        ...onAxis,
        x: (d: Date) => d,
        y: () => y,
        stroke,
        strokeWidth: r.strokeWidth ?? 1,
        strokeDasharray: dash,
        lineCap: "butt",
      })),
    );
  }
  if (r.showMarkers === true) {
    // bklit bracketMarkerPath: a size x size triangle based on the band edge with its tip pointing inward.
    const mid = new Date((x1.getTime() + x2.getTime()) / 2);
    pushDecorative(out, referenceMarkers({ id: `refarea-marker:${i}`, mid, size: r.markerSize ?? 6, fill: r.markerColor ?? "var(--chart-1)", yScaleId: onAxis.yScale ?? "y", top, bottom }));
  }
  return out;
}

interface ProjectionContext {
  readonly index: number;
  readonly uid: string;
  readonly xDomain: readonly [Date, Date];
  readonly innerWidth: number;
  readonly gradients: ChartGradient[];
  readonly wipe: WipeMark | undefined;
}

/** The projection's data with its end pulled in from the plot edge: bklit resolveVisibleEndX stops the tail short by endpointRadius + strokeWidth / 2 + 1 (radius 0 without the end marker); the end y is kept, so the last point just moves left (gradient follows). */
function visibleTail(p: ProjectionProps, xDomain: readonly [Date, Date], innerWidth: number): ProjectionProps["data"] {
  const last = p.data.at(-1);
  const spanMs = xDomain[1].getTime() - xDomain[0].getTime();
  if (!last || innerWidth <= 0 || spanMs <= 0) {
    return p.data;
  }
  const radius = p.showEndpoints === false || p.showEndMarker === false ? 0 : (p.endpointRadius ?? 5);
  const endX = ((toDate(last.date).getTime() - xDomain[0].getTime()) / spanMs) * innerWidth;
  const visibleEndX = Math.min(endX, Math.max(0, innerWidth - (radius + (p.strokeWidth ?? 2) * 0.5 + 1)));
  if (visibleEndX >= endX) {
    return p.data;
  }
  return [...p.data.slice(0, -1), { ...last, date: new Date(xDomain[0].getTime() + (visibleEndX / innerWidth) * spanMs) }];
}

function projectionMark(p: ProjectionProps, { index: i, uid, xDomain, innerWidth, gradients, wipe }: ProjectionContext): AnyMark {
  const stroke = p.stroke ?? "var(--chart-3)";
  let paint = stroke;
  if (p.strokeStyle === "gradient") {
    const id = `${uid}-proj-${i}`;
    gradients.push({
      id,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [
        { offset: 0, color: p.gradientStart ?? stroke },
        // bklit projection-line.tsx:107-108: the end defaults to --chart-5, the start to the stroke.
        { offset: 1, color: p.gradientEnd ?? "var(--chart-5)" },
      ],
    });
    paint = `url(#${id})`;
  }
  const wrap = wipe ?? (<M>(m: M): M => m);
  const options = erase({
    id: `projection:${i}`,
    ...yScaleForAxis(p.yAxisId),
    x: (d: { date: Date }) => toDate(d.date),
    y: (d: { value: number }) => d.value,
    curve: d3Curve(p.curveKind === "bezier" ? curveProjectionBezier : curveLinear),
    stroke: paint,
    strokeWidth: p.strokeWidth ?? 2,
    strokeOpacity: p.strokeOpacity ?? 1,
    // bklit projection-line.tsx:112: dashed "6,4" unless the caller overrides it.
    strokeDasharray: (p.strokeDasharray ?? "6,4").replaceAll(",", " "),
    lineCap: "round",
  });
  return wrap(lineY(visibleTail(p, xDomain, innerWidth), options), `p${i}`);
}

/** bklit StaticSeriesPointMarker: filled core (default transparent) plus an outer ring, on the last row. */
function terminalMarks(t: TerminalProps, ti: number, last: Row, xKey: string): AnyMark[] {
  const out: AnyMark[] = [];
  const stroke = t.stroke ?? "var(--chart-1)";
  const r = t.radius ?? 5;
  const gap = t.ringGap ?? 0;
  const sw = t.strokeWidth ?? 1.5;
  const xy = {
    ...yScaleForAxis(t.yAxisId),
    x: (d: Row): Date => toDate(d[xKey]),
    y: (d: Row): number => Number(d[t.dataKey]),
  };
  pushDecorative(out, dot([last], erase({ id: `terminal:${ti}:ring`, ...xy, r: r + gap + sw / 2, fill: "none", stroke, strokeWidth: sw })));
  if (t.fill !== undefined && t.fill !== "" && t.fill !== "transparent") {
    pushDecorative(out, dot([last], erase({ id: `terminal:${ti}:core`, ...xy, r, fill: t.fill })));
  }
  return out;
}

export function buildOverlays(table: ChildTable, rows: readonly Row[], xKey: string, uid: string, wipe?: WipeMark): Overlays {
  const xValues: Date[] = [];
  const yValues: number[] = [];
  const projectionYValues = new Map<string, number[]>();
  const gradients: ChartGradient[] = [...userGradients(table)];
  const projections = propsFor<ProjectionProps>(table, "projectionLine");
  for (const p of projections) {
    for (const pt of p.data) {
      xValues.push(toDate(pt.date));
      const axis = axisId(p.yAxisId);
      projectionYValues.set(axis, [...(projectionYValues.get(axis) ?? []), pt.value]);
    }
  }
  const terminals = propsFor<TerminalProps>(table, "terminalMarker");
  const references = propsFor<ReferenceProps>(table, "referenceArea");
  for (const r of references) {
    if (r.y1 !== undefined) {
      yValues.push(r.y1);
    }
    if (r.y2 !== undefined) {
      yValues.push(r.y2);
    }
  }
  const markers = chartMarkerProps(table);

  const marks = (yDomain: readonly [number, number], xDomain: readonly [Date, Date], innerWidth = 0, under?: AnyMark[]): AnyMark[] => {
    const out: AnyMark[] = [];
    for (const [i, r] of references.entries()) {
      // bklit paints children in JSX order: a ReferenceArea declared before the series sits beneath them (callers that pass `under`).
      const bandOut = under !== undefined && declaredBefore(table, r, SERIES_ROLES) ? under : out;
      bandOut.push(...referenceAreaMarks(r, { index: i, uid, xDomain, yDomain }));
    }
    for (const [i, p] of projections.entries()) {
      pushDecorative(out, projectionMark(p, { index: i, uid, xDomain, innerWidth, gradients, wipe }));
    }
    const last = rows.at(-1);
    if (last !== undefined) {
      for (const [ti, t] of terminals.entries()) {
        out.push(...terminalMarks(t, ti, last, xKey));
      }
    }
    for (const [mi, m] of markers.entries()) {
      const groups: MarkerGroup[] = groupMarkerItems(m.items).map((items) => ({ date: toDate(items[0].date), items }));
      out.push(eventMarkers({ id: `evtmarker:${mi}`, mi, groups, set: m }));
    }
    return out;
  };
  return { xValues, yValues, projectionYValues, gradients, marks };
}
