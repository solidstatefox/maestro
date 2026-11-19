import { createMark } from "@tanstack/charts";
import type { ChartBounds, ChartLayoutOptions, ChartLinearGradient, ChartMark, ChartPoint, MarkRenderContext, MarkScene, SceneArea, SceneNode } from "@tanstack/charts";
import { fontContext, textWidth } from "../text-width";
import type { FunnelDatum } from "./focus";

const SSR_WIDTH_RATIO = 0.58;
const FALLBACK_FONT = "ui-sans-serif, system-ui, sans-serif";

/** One colour stop of a stage gradient. */
interface FunnelGradientStopInput {
  /** Position of the stop along the gradient: a percentage string such as `"50%"`, or a fraction from 0 to 1. */
  readonly offset: string | number;
  /** Colour of the stop. */
  readonly color: string;
}

/** One stage of a funnel. */
interface FunnelStageInput {
  /** Name of the stage, shown with its segment. */
  readonly label: string;
  /** Size of the stage. The first stage counts as 100% and each segment is sized relative to it. */
  readonly value: number;
  /** Text to show instead of the formatted `value`, for example `"12.4k"`. */
  readonly displayValue?: string;
  /** Colour of this stage, overriding the chart-level `color`. */
  readonly color?: string;
  /**
   * Colour stops for a linear gradient on this stage, for example `[{ offset: "0%", color: "#8b5cf6" }, { offset: "100%", color: "#3b82f6" }]`. Takes precedence over `color` for the innermost ring; the outer halo rings use the first stop as a solid colour.
   */
  readonly gradient?: readonly FunnelGradientStopInput[];
}

type FunnelMark = ChartMark<FunnelDatum, number, number>;
type FunnelPoint = ChartPoint<FunnelDatum, number, number>;
type LabelAnchor = "start" | "middle" | "end";

interface FunnelMarkConfig {
  readonly stages: readonly FunnelStageInput[];
  readonly horizontal: boolean;
  readonly color: string;
  readonly layers: number;
  readonly gapPx: number;
  readonly curved: boolean;
  readonly showLabels: boolean;
  readonly showValues: boolean;
  readonly showPercentage: boolean;
  readonly formatValue: (value: number) => string;
  readonly formatPercentage: (pct: number) => string;
  readonly labelLayout: "spread" | "grouped";
  readonly labelOrientation?: "vertical" | "horizontal" | undefined;
  readonly labelAlign: "center" | "start" | "end";
  /** Resource-host id prefix: the innermost ring of stage i paints `url(#<prefix>-<i>)` (bklit renderPattern). */
  readonly patternPrefix?: string | undefined;
  /** False while hydrating: labels use the server's fallback measurements so the first client render matches the server markup. */
  readonly measureText: boolean;
  readonly grid: { readonly bands: boolean; readonly bandColor: string; readonly lines: boolean; readonly lineColor: string; readonly lineOpacity: number; readonly lineWidth: number } | null;
}

// bklit's segment edge: one cubic per edge, control points at 55% of the stage length along the stage axis (d3 bump: 50%).
// Written as path strings, so the funnel needs neither TanStack's d3 curve adapters nor d3-shape.
const BKLIT_CONTROL = 0.55;
type Pt = readonly [number, number];
const edgeRun = (points: readonly Pt[], axis: "x" | "y", first: "M" | "L"): string => {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i] as Pt;
    if (i === 0) { d = `${first}${x},${y}`; continue; }
    const [px, py] = points[i - 1] as Pt;
    const dx = (x - px) * BKLIT_CONTROL;
    const dy = (y - py) * BKLIT_CONTROL;
    d += axis === "x" ? `C${px + dx},${py},${x - dx},${y},${x},${y}` : `C${px},${py + dy},${x},${y - dy},${x},${y}`;
  }
  return d;
};
// d3's area order: the first edge forward, the second back, closed.
const edgeArea = (forward: readonly Pt[], back: readonly Pt[], axis: "x" | "y"): string => `${edgeRun(forward, axis, "M")}${edgeRun([...back].reverse(), axis, "L")}Z`;

// Label type (Tailwind text-sm / text-xs): the size/weight each kind is drawn and measured in.
const LABEL_FONT = { name: { size: 12, weight: 500 }, pct: { size: 12, weight: 700 }, value: { size: 14, weight: 600 } } as const;
// bklit: ring half-extent as a share of the chart cross axis.
const HALF_EXTENT = 0.44;
const RING_SHRINK = 0.35;
const HOVER_POP = 0.12;
// bklit label metrics (Tailwind text-sm / text-xs line heights, pill padding, grouped gap-1.5).
const VALUE_LINE = 20;
const SMALL_LINE = 16;
const PILL_PAD_X = 12;
const PILL_PAD_Y = 4;
const GROUP_GAP = 6;
const GROUP_PAD = 0.08;
const SPREAD_BAND = 0.16;
// The painted inset TanStack's rect mark gives a band (rect `inset` default).
const BAND_INSET = 0.75;

const funnelGradientId = (stage: number): string => `funnel-stage-${stage}`;
const ringOpacity = (layer: number, layers: number): number => 0.18 + (layer / (layers - 1 || 1)) * 0.65;
const ringScale = (layer: number, layers: number): number => 1 - (layer / layers) * RING_SHRINK;
const popExtra = (layer: number, layers: number): number => (layer / Math.max(layers - 1, 1)) * HOVER_POP;

const stageColor = (stage: FunnelStageInput, fallback: string): string => stage.gradient?.[0]?.color ?? stage.color ?? fallback;

interface FontMetrics {
  /** Rounded font ascent / descent: what an HTML line box centres (the baseline sits (ascent - descent) / 2 below the line centre). */
  readonly ascent: number;
  readonly descent: number;
  /** SVG `dominant-baseline: middle` puts the baseline half an x-height below the y attribute. */
  readonly xHeight: number;
}
// A loaded face's metrics never change: measured once per face for the page (every redraw, resize and funnel on it asks for the same three).
const measuredFonts = /* @__PURE__ */ new Map<string, FontMetrics>();
const fontMetrics = (fontSize: number, fontWeight: number, fontFamily: string, measure: boolean): FontMetrics => {
  const fallback = { ascent: fontSize, descent: fontSize / 3, xHeight: fontSize * 0.53 };
  if (!measure) { return fallback; }
  const key = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const known = measuredFonts.get(key);
  if (known !== undefined) { return known; }
  const metrics = fontContext(fontSize, fontWeight, fontFamily)?.measureText("x");
  if (metrics === undefined) { return fallback; }
  const measured = { ascent: metrics.fontBoundingBoxAscent, descent: metrics.fontBoundingBoxDescent, xHeight: metrics.actualBoundingBoxAscent };
  // Kept only once the page's fonts have loaded: a face still loading measures as its fallback, and the next draw must measure again.
  if (document.fonts.status === "loaded") { measuredFonts.set(key, measured); }
  return measured;
};

const buildFunnelGradients = (stages: readonly FunnelStageInput[], horizontal: boolean): readonly ChartLinearGradient[] =>
  stages.flatMap((stage, index) => {
    const stops = stage.gradient;
    if (!stops || stops.length === 0) {return [];}
    return [{
      id: funnelGradientId(index),
      stops: stops.map((stop) => ({
        color: stop.color,
        // oxlint-disable-next-line unicorn/prefer-number-coercion -- offsets like "50%" need parseFloat; Number("50%") is NaN.
        offset: typeof stop.offset === "string" ? Number.parseFloat(stop.offset) / 100 : stop.offset,
      })),
      x1: 0, x2: horizontal ? 1 : 0, y1: 0, y2: horizontal ? 0 : 1,
    }];
  });

interface LabelItem {
  readonly kind: "value" | "pct" | "name";
  readonly text: string;
  readonly width: number;
  readonly height: number;
}

interface Placed {
  readonly item: LabelItem;
  readonly anchor: LabelAnchor;
  readonly px: number;
  readonly py: number;
}

/** A stage cell in px: its origin, size and centre. */
interface LabelBox {
  readonly cxPx: number;
  readonly cyPx: number;
  readonly cellPxStart: number;
  readonly cellPyStart: number;
  readonly cellW: number;
  readonly cellH: number;
}

type Put = (item: LabelItem, px: number, py: number, anchor: LabelAnchor) => void;

interface RingFillInput {
  readonly base: string;
  readonly gradientId: string | undefined;
  readonly index: number;
  readonly innermost: boolean;
  readonly patternPrefix: string | undefined;
}

const ringFill = ({ base, gradientId, index, innermost, patternPrefix }: Readonly<RingFillInput>): string => {
  if (innermost && patternPrefix !== undefined) { return `url(#${patternPrefix}-${index})`; }
  if (innermost && gradientId !== undefined) { return `url(#${gradientId})`; }
  return base;
};

const labelItems = (config: FunnelMarkConfig, fontFamily: string, stage: FunnelStageInput, pct: number): LabelItem[] => {
  const items: LabelItem[] = [];
  const width = (t: string, size: number, weight: number): number =>
    config.measureText ? textWidth(t, size, weight, fontFamily, SSR_WIDTH_RATIO) : t.length * size * SSR_WIDTH_RATIO;
  if (config.showValues) {
    const t = stage.displayValue ?? config.formatValue(stage.value);
    items.push({ height: VALUE_LINE, kind: "value", text: t, width: width(t, 14, 600) });
  }
  if (config.showPercentage) {
    const t = config.formatPercentage(pct);
    items.push({ height: SMALL_LINE + PILL_PAD_Y * 2, kind: "pct", text: t, width: width(t, 12, 700) + PILL_PAD_X * 2 });
  }
  if (config.showLabels) {
    items.push({ height: SMALL_LINE, kind: "name", text: stage.label, width: width(stage.label, 12, 500) });
  }
  return items;
};

const findItem = (items: readonly LabelItem[], kind: LabelItem["kind"]): LabelItem | undefined => items.find((it) => it.kind === kind);

const placeSpread = (items: readonly LabelItem[], box: LabelBox, horizontal: boolean, put: Put): void => {
  const value = findItem(items, "value");
  const pctItem = findItem(items, "pct");
  const name = findItem(items, "name");
  const { cxPx, cyPx, cellPxStart, cellPyStart, cellW, cellH } = box;
  if (horizontal) {
    if (value) {put(value, cxPx, cellPyStart + cellH * SPREAD_BAND - 4 - VALUE_LINE / 2, "middle");}
    if (pctItem) {put(pctItem, cxPx, cyPx, "middle");}
    if (name) {put(name, cxPx, cellPyStart + cellH * (1 - SPREAD_BAND) + 4 + SMALL_LINE / 2, "middle");}
  } else {
    if (value) {put(value, cellPxStart + cellW * SPREAD_BAND - 8, cyPx, "end");}
    if (pctItem) {put(pctItem, cxPx, cyPx, "middle");}
    if (name) {put(name, cellPxStart + cellW * (1 - SPREAD_BAND) + 8, cyPx, "start");}
  }
};

// bklit pads the group by 8% of the cell WIDTH on both axes (CSS percentage padding is width-relative).
const groupOffset = (align: FunnelMarkConfig["labelAlign"], size: number, total: number, cellW: number): number => {
  const pad = cellW * GROUP_PAD;
  if (align === "start") {return pad;}
  if (align === "end") {return total - pad - size;}
  return (total - size) / 2;
};

const alignedLeft = (align: FunnelMarkConfig["labelAlign"], left: number, groupWidth: number, width: number): number => {
  if (align === "start") { return left; }
  return align === "end" ? left + groupWidth - width : left + (groupWidth - width) / 2;
};

// Grouped: a tight stack (gap-1.5) placed within the cell by labelAlign.
const placeGrouped = (items: readonly LabelItem[], box: LabelBox, config: Pick<FunnelMarkConfig, "horizontal" | "labelAlign" | "labelOrientation">, put: Put): void => {
  const { horizontal, labelAlign } = config;
  const { cxPx, cyPx, cellPxStart, cellPyStart, cellW, cellH } = box;
  const stackVertical = (config.labelOrientation ?? (horizontal ? "vertical" : "horizontal")) === "vertical";
  const gapTotal = GROUP_GAP * Math.max(0, items.length - 1);
  const gw = stackVertical ? Math.max(0, ...items.map((it) => it.width)) : items.reduce((sum, it) => sum + it.width, 0) + gapTotal;
  const gh = stackVertical ? items.reduce((sum, it) => sum + it.height, 0) + gapTotal : Math.max(0, ...items.map((it) => it.height));
  // bklit: horizontal funnels place the group vertically; vertical funnels place it horizontally.
  const left = horizontal ? cxPx - gw / 2 : cellPxStart + groupOffset(labelAlign, gw, cellW, cellW);
  const top = horizontal ? cellPyStart + groupOffset(labelAlign, gh, cellH, cellW) : cyPx - gh / 2;
  const itemAlign = horizontal ? "center" : labelAlign;
  let cursor = stackVertical ? top : left;
  for (const item of items) {
    if (stackVertical) {
      put(item, alignedLeft(itemAlign, left, gw, item.width) + item.width / 2, cursor + item.height / 2, "middle");
      cursor += item.height + GROUP_GAP;
    } else {
      put(item, cursor + item.width / 2, top + (gh - item.height) / 2 + item.height / 2, "middle");
      cursor += item.width + GROUP_GAP;
    }
  }
};

/** Plot geometry in px from the plot's top-left, shared by rings, grid and labels. */
interface FunnelGeometry {
  readonly W: number;
  readonly H: number;
  readonly count: number;
  readonly norms: readonly number[];
  /** Stage cell length and the gap after it, along the stage axis. */
  readonly cellPx: number;
  readonly gapPx: number;
  readonly cellStart: (index: number) => number;
  readonly stageStart: (index: number) => number;
}

const funnelGeometry = (config: FunnelMarkConfig, width: number, height: number): FunnelGeometry => {
  const { stages, horizontal } = config;
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const count = stages.length;
  const first = stages[0]?.value ?? 1;
  const norms = stages.map((stage) => {
    const norm = stage.value / first;
    return Number.isFinite(norm) && norm > 0 ? norm : 0;
  });
  const unitPx = (horizontal ? W : H) / count;
  const gapData = Math.min(0.5, config.gapPx / unitPx);
  const cellPx = (1 - (gapData * (count - 1)) / count) * unitPx;
  const gapPx = gapData * unitPx;
  const cellStart = (index: number): number => index * (cellPx + gapPx);
  // bklit paints each stage in its own svg, whose origin Chrome snaps to a whole pixel while the shape keeps its fractional size, so
  // stage edges (and the 1px gap columns between them) land on pixel boundaries.
  return { H, W, cellPx, cellStart, count, gapPx, norms, stageStart: (index) => Math.round(cellStart(index)) };
};

interface Frame {
  readonly x: number;
  readonly y: number;
}

const group = (key: string, className: string, children: readonly SceneNode[]): SceneNode => ({ children, className, key, kind: "group" });

// Spread/grouped label nodes of one stage: the pill, then value, percentage and name text, in one group that fades as a layer (bklit's label overlay).
const labelNodes = (config: FunnelMarkConfig, geo: FunnelGeometry, frame: Frame, fonts: Readonly<Record<LabelItem["kind"], FontMetrics>>, index: number, items: readonly LabelItem[]): SceneNode[] => {
  const { horizontal } = config;
  const cellPxStart = horizontal ? geo.cellStart(index) : 0;
  const cellW = horizontal ? geo.cellPx : geo.W;
  const cellPyStart = horizontal ? 0 : geo.cellStart(index);
  const cellH = horizontal ? geo.H : geo.cellPx;
  const box: LabelBox = { cellH, cellPxStart, cellPyStart, cellW, cxPx: cellPxStart + cellW / 2, cyPx: cellPyStart + cellH / 2 };
  const placed: Placed[] = [];
  const put: Put = (item, px, py, anchor) => { placed.push({ anchor, item, px, py }); };
  if (config.labelLayout === "spread") { placeSpread(items, box, horizontal, put); } else { placeGrouped(items, box, config, put); }
  // HTML line boxes put the baseline (ascent - descent) / 2 below the line centre and paint it on a whole pixel; SVG text is placed by
  // its x-height centre, so each label's y is that rounded baseline minus half the x-height.
  const textY = (kind: LabelItem["kind"], centre: number): number => {
    const metrics = fonts[kind];
    return Math.round(centre + (metrics.ascent - metrics.descent) / 2) - metrics.xHeight / 2;
  };
  const FILL: Record<LabelItem["kind"], string> = { name: "var(--bkm-muted-foreground)", pct: "var(--bkm-background)", value: "var(--bkm-foreground)" };
  const nodes: SceneNode[] = [];
  const pill = placed.find((entry) => entry.item.kind === "pct");
  if (pill) {
    const { item, px, py } = pill;
    nodes.push({
      className: "bkm-pill", height: Math.round(py + item.height / 2) - Math.round(py - item.height / 2), key: `funnel-pill-${index}`, kind: "rect",
      radius: (PILL_PAD_Y * 2 + SMALL_LINE) / 2, style: { fill: "var(--bkm-foreground)" },
      width: Math.round(px + item.width / 2) - Math.round(px - item.width / 2),
      x: frame.x + Math.round(px - item.width / 2), y: frame.y + Math.round(py - item.height / 2),
    });
  }
  for (const kind of ["value", "pct", "name"] as const) {
    const entry = placed.find((candidate) => candidate.item.kind === kind);
    if (entry) {
      nodes.push({
        anchor: entry.anchor, baseline: "middle", fontSize: LABEL_FONT[kind].size, fontWeight: LABEL_FONT[kind].weight, key: `funnel-${kind}-${index}`, kind: "label",
        style: { fill: FILL[kind] }, text: entry.item.text, x: frame.x + entry.px, y: frame.y + textY(kind, entry.py),
      });
    }
  }
  return nodes;
};

interface RingInput {
  readonly config: FunnelMarkConfig;
  readonly geo: FunnelGeometry;
  readonly frame: Frame;
  readonly index: number;
  readonly layer: number;
}

const ringArea = ({ config, geo, frame, index, layer }: Readonly<RingInput>): SceneArea => {
  const { horizontal, layers, curved } = config;
  const stage = config.stages[index] as FunnelStageInput;
  const startNorm = geo.norms[index] ?? 0;
  const endNorm = index < geo.count - 1 ? (geo.norms[index + 1] ?? startNorm) : startNorm;
  const gradientId = stage.gradient && stage.gradient.length > 0 ? funnelGradientId(index) : undefined;
  const scale = ringScale(layer, layers) * HALF_EXTENT * (horizontal ? geo.H : geo.W);
  const mid = (horizontal ? geo.H : geo.W) / 2;
  const pos0 = geo.stageStart(index);
  const pos1 = pos0 + geo.cellPx;
  const half0 = startNorm * scale;
  const half1 = endNorm * scale;
  // Two edges along the stage axis: [low side, high side] of the cross axis.
  const at = (pos: number, cross: number): Pt => (horizontal ? [frame.x + pos, frame.y + cross] : [frame.x + cross, frame.y + pos]);
  const first: Pt[] = [at(pos0, mid - half0), at(pos1, mid - half1)];
  const second: Pt[] = [at(pos0, mid + half0), at(pos1, mid + half1)];
  return {
    className: `bkm-ring bkm-l${layer}`,
    key: `funnel-s${index}-l${layer}`,
    kind: "area",
    ...(curved ? { path: edgeArea(first, second, horizontal ? "x" : "y") } : {}),
    points: [...first, ...[...second].reverse()],
    style: {
      fill: ringFill({ base: stageColor(stage, config.color), gradientId, index, innermost: layer === layers - 1, patternPrefix: config.patternPrefix }),
      fillOpacity: ringOpacity(layer, layers),
    },
  };
};

// The focus points of a stage: its outer ring's two cell ends (focus.ts filters on `layer`).
const stagePoints = (config: FunnelMarkConfig, geo: FunnelGeometry, frame: Frame, id: string, index: number): FunnelPoint[] => {
  const stage = config.stages[index] as FunnelStageInput;
  const mid = (config.horizontal ? geo.H : geo.W) / 2;
  const pos0 = geo.stageStart(index);
  return [pos0, pos0 + geo.cellPx].map((pos, end) => ({
    color: stageColor(stage, config.color),
    datum: { layer: 0, stage: index },
    datumIndex: index * 2 + end,
    group: null,
    groupLabel: stage.label,
    key: `${id}:${index}:${end}`,
    markId: id,
    x: config.horizontal ? frame.x + pos : frame.x + mid,
    xValue: pos,
    y: config.horizontal ? frame.y + mid : frame.y + pos,
    yValue: mid,
  }));
};

const gridNodes = (config: FunnelMarkConfig, geo: FunnelGeometry, frame: Frame): { readonly bands: SceneNode[]; readonly lines: SceneNode[] } => {
  const { grid, horizontal } = config;
  const bands: SceneNode[] = [];
  const lines: SceneNode[] = [];
  if (grid?.bands === true) {
    for (let index = 0; index < geo.count; index += 2) {
      const start = geo.cellStart(index);
      bands.push(horizontal
        ? { height: geo.H - BAND_INSET * 2, key: `funnel-band-${index}`, kind: "rect", style: { fill: grid.bandColor }, width: geo.cellPx - BAND_INSET * 2, x: frame.x + start + BAND_INSET, y: frame.y + BAND_INSET }
        : { height: geo.cellPx - BAND_INSET * 2, key: `funnel-band-${index}`, kind: "rect", style: { fill: grid.bandColor }, width: geo.W - BAND_INSET * 2, x: frame.x + BAND_INSET, y: frame.y + start + BAND_INSET });
    }
  }
  // bklit: one line per gap between stages, at the gap centre, spanning the whole cross axis, above the stages.
  if (grid?.lines === true) {
    for (let index = 0; index < geo.count - 1; index += 1) {
      const centre = geo.cellStart(index) + geo.cellPx + geo.gapPx / 2;
      const style = { stroke: grid.lineColor, strokeOpacity: grid.lineOpacity, strokeWidth: grid.lineWidth };
      lines.push(horizontal
        ? { key: `funnel-line-${index}`, kind: "rule", style, x1: frame.x + centre, x2: frame.x + centre, y1: frame.y, y2: frame.y + geo.H }
        : { key: `funnel-line-${index}`, kind: "rule", style, x1: frame.x, x2: frame.x + geo.W, y1: frame.y + centre, y2: frame.y + centre });
    }
  }
  return { bands, lines };
};

const funnelScene = (config: FunnelMarkConfig, id: string, chart: ChartBounds, layout: ChartLayoutOptions): MarkScene<FunnelDatum, number, number> => {
  const geo = funnelGeometry(config, chart.width, chart.height);
  const frame: Frame = { x: chart.x, y: chart.y };
  // Label text is measured in the face it is drawn in: the host's computed font (the pill sizes from it).
  const fontFamily = layout.typography?.fontFamily ?? FALLBACK_FONT;
  const fonts = {
    name: fontMetrics(LABEL_FONT.name.size, LABEL_FONT.name.weight, fontFamily, config.measureText),
    pct: fontMetrics(LABEL_FONT.pct.size, LABEL_FONT.pct.weight, fontFamily, config.measureText),
    value: fontMetrics(LABEL_FONT.value.size, LABEL_FONT.value.weight, fontFamily, config.measureText),
  };
  const points: FunnelPoint[] = [];
  const stages: SceneNode[] = config.stages.map((_stage, index) => {
    const rings: SceneNode[] = [];
    for (let layer = 0; layer < config.layers; layer += 1) { rings.push(ringArea({ config, frame, geo, index, layer })); }
    points.push(...stagePoints(config, geo, frame, id, index));
    const labels = labelNodes(config, geo, frame, fonts, index, labelItems(config, fontFamily, config.stages[index] as FunnelStageInput, (geo.norms[index] ?? 0) * 100));
    return group(`funnel-s${index}`, "bkm-fs", labels.length === 0 ? [group(`funnel-s${index}:rings`, "bkm-fr", rings)] : [group(`funnel-s${index}:rings`, "bkm-fr", rings), group(`funnel-s${index}:labels`, "bkm-fl", labels)]);
  });
  const { bands, lines } = gridNodes(config, geo, frame);
  return { nodes: [{ ariaHidden: true, children: [...bands, group(`${id}:stages`, "bkm-stages", stages), ...lines], className: "bkm-funnel", key: id, kind: "group" }], points };
};

/** The funnel as one mark: its scene is built in `resolveLayout` from the final plot bounds, with no entrance or update motion of its own (funnel.css). */
const createFunnelMark = (config: FunnelMarkConfig): FunnelMark => {
  const id = "funnel";
  return createMark<FunnelDatum, number, number>(() => ({
    channels: {},
    id,
    resolveLayout: ({ chart, layout }) => ({ render: (_context: MarkRenderContext) => funnelScene(config, id, chart, layout) }),
  }), false);
};

export { buildFunnelGradients, createFunnelMark, popExtra, stageColor };
export type { FunnelGradientStopInput, FunnelMarkConfig, FunnelStageInput };
