import { link } from "@tanstack/charts/link";
import { textWidth } from "../text-width";
import { resumeEnter } from "../motion/resume-enter";
import { rect } from "@tanstack/charts/rect";
import { text } from "@tanstack/charts/text";
import { sankeyDiagram } from "@tanstack/charts/network/sankey";
import { BUMP_CURVE } from "./bump";
import type {
  ChartLinearGradient,
  ChartMotionContext,
  ChartMotionTiming,
  ChartMotionTransition,
} from "@tanstack/charts";

interface SankeyNodeInput {
  readonly name: string;
  readonly category?: string;
  readonly [key: string]: unknown;
}

interface SankeyLinkInput {
  readonly source: number;
  readonly target: number;
  readonly value: number;
  readonly [key: string]: unknown;
}

interface SankeyInputData {
  readonly nodes: readonly SankeyNodeInput[];
  readonly links: readonly SankeyLinkInput[];
}

type LabelOrientation = "horizontal" | "vertical";

interface SankeyMarkConfig {
  readonly data: SankeyInputData;
  readonly nodeWidth: number;
  readonly nodePadding: number;
  /** bklit's side margins: the diagram is laid out in the full chart width and mapped into the area they leave (see `layoutColumns`). */
  readonly sideMargin: { readonly left: number; readonly right: number };
  readonly nodeColor: (index: number) => string;
  readonly linkStroke: (link: SankeyInputLinkRow, sourceColor: string, gradientId: string | null) => string;
  readonly useGradient: boolean;
  readonly strokeOpacity: number;
  readonly lineCap: number;
  readonly showLabels: boolean;
  readonly showValueLabels: boolean;
  /** Text of a node's value label, from the node's value (the larger of its inflow and outflow). */
  readonly formatNodeValue: (value: number) => string;
  readonly labelOrientation: LabelOrientation;
  readonly enter: SankeyEnter;
}

// The slice of a laid-out link row the mark callbacks read.
interface SankeyInputLinkRow {
  readonly key: unknown;
  readonly sourceKey: number;
  readonly targetKey: number;
  readonly x1: number;
  readonly x2: number;
  readonly y1: number;
  readonly y2: number;
  readonly width: number;
  readonly data: SankeyInputLink;
}
type SankeyInputLink = SankeyLinkInput;

interface SankeyEnter {
  readonly durationMs: number;
  readonly transition: ChartMotionTransition;
}

const SANKEY_LABEL_FILL = "var(--bkm-foreground)";
const NAME_FONT_SIZE = 13;
const VALUE_FONT_SIZE = 11;
const LABEL_OFFSET = 12;
const VALUE_LABEL_GAP = 16;
// 0.9, not bklit's 0.6: a value label over a flow keeps 4.5:1 against shadcn's default palette in light and dark (hover-css.ts's rest).
const VALUE_LABEL_OPACITY = 0.9;
// A horizontal flow has a zero-height bounding box, which an objectBoundingBox gradient cannot paint; give it a sub-pixel one.
const FLAT_LINK_RISE = 0.001;
// bklit anchors text on the alphabetic baseline with dy=0.35em; the package text mark centres on a
// middle baseline, leaving 0.0844em (Geist, measured) to add back.
const BASELINE_RESIDUAL_EM = 0.0844;
const ROTATE_CW = 90;
// bklit label enter delay: node stagger + nodeAnim(0.6) * 0.6 * 0.3 of the duration, value labels another 60ms.
const LABEL_NAME_START = 0.108;
const VALUE_AFTER_MS = 60;

const flowGradientId = (index: number): string => `sankey-flow-${index}`;

const mix = (color: string, percent: number): string => `color-mix(in srgb, ${color} ${Math.round(percent * 100)}%, transparent)`;

// Gradients live on the chart definition (objectBoundingBox 0..1); `reversed` puts the source colour at the right end when the
// area between the side margins is narrower than a node (columns run right to left, as in bklit's userSpace gradient).
const buildSankeyGradients = (data: SankeyInputData, nodeColor: (index: number) => string, reversed: boolean): readonly ChartLinearGradient[] =>
  data.links.map((linkDatum, index) => ({
    id: flowGradientId(index),
    stops: [
      { color: nodeColor(reversed ? linkDatum.target : linkDatum.source), offset: 0 },
      { color: nodeColor(reversed ? linkDatum.source : linkDatum.target), offset: 1 },
    ],
    x1: 0,
    x2: 1,
    y1: 0,
    y2: 0,
  }));

// ---------------------------------------------------------------- entrance choreography
// Per-mark native motion mirroring bklit's staged reveal; flows are not motion marks (CSS clip reveal on bklit's schedule, sankey.css).
/** Clock of a definition build's first motion call: the entrance start every mark's schedule (and its resume) counts from. */
interface EntranceClock {
  at: number | null;
}
type MarkMotion<TDatum> = (context: ChartMotionContext<TDatum>) => false | ChartMotionTiming<TDatum> | undefined;
const enterMotion = <TDatum>(
  enter: SankeyEnter,
  timing: { readonly start: number; readonly spread: number },
  clock: EntranceClock,
): MarkMotion<TDatum> => {
  const { durationMs, transition } = enter;
  const resolved: ChartMotionTransition = transition;
  return (context: ChartMotionContext<TDatum>): false | ChartMotionTiming<TDatum> | undefined => {
    clock.at ??= performance.now();
    const delay = durationMs * timing.start + (context.datumIndex / Math.max(1, context.datumCount)) * durationMs * timing.spread;
    // A render forced mid-entrance (web-font swap) arrives as an update: resume the schedule rather than restarting it.
    if (context.phase === "update" && resolved.type === "tween" && resolved.duration !== undefined && typeof resolved.easing === "function") {
      const resumed = resumeEnter({ delay, duration: resolved.duration, easing: resolved.easing }, clock.at);
      if (resumed !== false) {
        return resumed;
      }
    }
    return { delay, transition: resolved };
  };
};

// ---------------------------------------------------------------- labels
interface LabelRow {
  readonly key: number;
  readonly name: string;
  readonly value: string;
  readonly anchor: "start" | "middle" | "end";
  readonly rotate: number;
  readonly nameX: number;
  readonly nameY: number;
  readonly valueX: number;
  readonly valueY: number;
}

interface NodeLayoutRow {
  readonly key: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly data: SankeyNodeInput;
}
interface NodeRowShape extends NodeLayoutRow {
  readonly labelBoxes: readonly HitBox[];
  readonly radius: number;
}

const intFmt = /* @__PURE__ */ new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** bklit's node value label: the value as an integer, then " sessions". */
const formatSessions = (value: number): string => `${intFmt.format(value)} sessions`;

// Divergence from bklit, which sums a node's outflow when its `category` is "source" and its inflow otherwise: a source node without a
// category (bklit's own docs examples) read "0 sessions". The total is the larger of the two, d3-sankey's node value, as the tooltip shows.
const nodeTotal = (key: number, links: readonly SankeyInputLinkRow[]): number => {
  let inflow = 0;
  let outflow = 0;
  for (const row of links) {
    if (row.targetKey === key) {inflow += row.data.value;}
    if (row.sourceKey === key) {outflow += row.data.value;}
  }
  return Math.max(inflow, outflow);
};

const placeLabels = (
  nodes: readonly NodeLayoutRow[],
  links: readonly SankeyInputLinkRow[],
  chart: { readonly x: number; readonly width: number },
  config: Pick<SankeyMarkConfig, "formatNodeValue" | "labelOrientation" | "showValueLabels">,
): LabelRow[] =>
  nodes.map((node) => {
    const { formatNodeValue, labelOrientation: orientation, showValueLabels: showValue } = config;
    const nodeW = Math.max(0, node.x1 - node.x0);
    const centerY = node.y0 + (node.y1 - node.y0) / 2;
    const isLeft = node.x0 - chart.x < chart.width / 2;
    const edge = isLeft ? node.x0 - LABEL_OFFSET : node.x0 + nodeW + LABEL_OFFSET;
    const base = { key: node.key, name: node.data.name, value: formatNodeValue(nodeTotal(node.key, links)) };
    if (orientation === "vertical") {
      const half = VALUE_LABEL_GAP / 2;
      const signedHalf = isLeft ? half : -half;
      const shift = showValue ? signedHalf : 0;
      return {
        ...base,
        anchor: "middle",
        nameX: edge + shift,
        nameY: centerY,
        rotate: isLeft ? -ROTATE_CW : ROTATE_CW,
        valueX: edge + (isLeft ? -half : half),
        valueY: centerY,
      };
    }
    return {
      ...base,
      anchor: isLeft ? "end" : "start",
      nameX: edge,
      nameY: centerY,
      rotate: 0,
      valueX: edge,
      valueY: centerY + VALUE_LABEL_GAP,
    };
  });

interface BaselineShift {
  readonly dx: number;
  readonly dy: number;
}

const baselineShift = (fontSize: number, rotate: number): BaselineShift => {
  const shift = fontSize * BASELINE_RESIDUAL_EM;
  if (rotate === -ROTATE_CW) {return { dx: shift, dy: 0 };}
  if (rotate === ROTATE_CW) {return { dx: -shift, dy: 0 };}
  return { dx: 0, dy: shift };
};

// bklit hovers a node from its whole <g>, labels included; the focus strategy reads these boxes so a label hover resolves to its node.
interface HitBox {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

const LINE_BOX = 1.2;
const SSR_WIDTH_RATIO = 0.55;

const leftEdge = (anchor: LabelRow["anchor"], x: number, length: number): number => {
  if (anchor === "end") { return x - length; }
  return anchor === "middle" ? x - length / 2 : x;
};

const labelHitBoxes = (label: LabelRow, showValue: boolean, family: string): readonly HitBox[] => {
  const one = (content: string, fontSize: number, fontWeight: number, x: number, y: number): HitBox => {
    const length = textWidth(content, fontSize, fontWeight, family, SSR_WIDTH_RATIO);
    const thick = fontSize * LINE_BOX;
    if (label.rotate !== 0) {return { x0: x - thick / 2, x1: x + thick / 2, y0: y - length / 2, y1: y + length / 2 };}
    const left = leftEdge(label.anchor, x, length);
    return { x0: left, x1: left + length, y0: y - thick / 2, y1: y + thick / 2 };
  };
  const boxes = [one(label.name, NAME_FONT_SIZE, 500, label.nameX, label.nameY)];
  if (showValue) {boxes.push(one(label.value, VALUE_FONT_SIZE, 400, label.valueX, label.valueY));}
  return boxes;
};

// bklit's inner width goes negative on narrow hosts and sankeyDiagram refuses an extent narrower than its node: the native layout gives
// y, heights and layers at a 1px node, and columns use d3-sankey's x0 = left + layer * (inner - nodeWidth) / (columns - 1).
interface LayoutNode {
  readonly key: number;
  readonly layer: number;
  readonly x0: number;
  readonly x1: number;
}
interface LayoutLink {
  readonly sourceKey: number;
  readonly targetKey: number;
  readonly x1: number;
  readonly x2: number;
}
interface ColumnArea {
  readonly x: number;
  readonly width: number;
}
interface ColumnLayout<Node, Link> {
  readonly nodes: readonly Node[];
  readonly links: readonly Link[];
  readonly area: ColumnArea;
}
const layoutColumns = <Node extends LayoutNode, Link extends LayoutLink>(
  nodes: readonly Node[],
  links: readonly Link[],
  chart: ColumnArea,
  config: Pick<SankeyMarkConfig, "nodeWidth" | "sideMargin">,
): ColumnLayout<Node, Link> => {
  const area = { width: chart.width - config.sideMargin.left - config.sideMargin.right, x: chart.x + config.sideMargin.left };
  let lastLayer = 0;
  for (const node of nodes) { lastLayer = Math.max(lastLayer, node.layer); }
  const step = lastLayer > 0 ? (area.width - config.nodeWidth) / lastLayer : 0;
  const placed = nodes.map((node) => ({ ...node, x0: area.x + node.layer * step, x1: area.x + node.layer * step + config.nodeWidth }));
  const byKey = new Map(placed.map((node) => [node.key, node]));
  const joined = links.map((row) => ({ ...row, x1: byKey.get(row.sourceKey)?.x1 ?? row.x1, x2: byKey.get(row.targetKey)?.x0 ?? row.x2 }));
  return { area, links: joined, nodes: placed };
};

// ---------------------------------------------------------------- the mark
const createSankeyMark = (config: Readonly<SankeyMarkConfig>): ReturnType<typeof sankeyDiagram> => {
  // One clock per definition build: the `marks` callback re-runs on every render, the entrance must outlive it.
  const clock: EntranceClock = { at: null };
  return sankeyDiagram({
    align: "center",
    id: "sankey",
    links: config.data.links,
    marks: ({ chart: bounds, nodes: laidNodes, links: laidLinks }) => {
      // SAFETY: sankeyDiagram's laid-out rows carry key/layer/x0..y2/width/data exactly as NodeLayoutRow and SankeyInputLinkRow declare (package row types are looser).
      const columns = layoutColumns(laidNodes as unknown as readonly (NodeLayoutRow & { readonly layer: number })[], laidLinks as unknown as readonly SankeyInputLinkRow[], bounds, config);
      const chart = columns.area;
      const fullNodes: readonly NodeLayoutRow[] = columns.nodes;
      const fullLinks = columns.links;
      const labels = config.showLabels ? placeLabels(fullNodes, fullLinks, chart, config) : [];
      // One computed-style read per layout (not per label): it is a style flush right after the resize invalidated it.
      const family = typeof document === "undefined" || labels.length === 0 ? "sans-serif" : getComputedStyle(document.body).fontFamily;
      const hitBoxesOf = new Map(labels.map((label) => [label.key, labelHitBoxes(label, config.showValueLabels, family)]));
      const nodeRows: NodeRowShape[] = fullNodes.map((row) => ({ ...row, labelBoxes: hitBoxesOf.get(row.key) ?? [], radius: config.lineCap }));
      const linkRows: SankeyInputLinkRow[] = [];
      for (const row of fullLinks) {
        linkRows.push(Math.abs(row.y1 - row.y2) < FLAT_LINK_RISE ? { ...row, y2: row.y1 + FLAT_LINK_RISE } : row);
      }
      const flow = link(linkRows, {
          curve: BUMP_CURVE,
          id: "flow",
          lineCap: "butt",
          // Drawn in by a static clip reveal (sankey.css), not a geometry tween.
          motion: false,
          stroke: (row, { index }: { readonly index: number }) => {
            const sourceColor = config.nodeColor(row.sourceKey);
            return config.linkStroke(row, sourceColor, config.useGradient ? flowGradientId(index) : null);
          },
          strokeOpacity: config.strokeOpacity,
          strokeWidth: (row) => Math.max(1, row.width),
          x1: "x1",
          x2: "x2",
          y1: "y1",
          y2: "y2",
        });

      // One rect mark per node: rect `fill` is a constant, and a per-node color needs a per-node mark.
      const nodeMarks = nodeRows.map((row, nodeIndex) => rect([row], {
        fill: config.nodeColor(row.key),
        id: `sankey-node-${nodeIndex}`,
        inset: 0,
        key: "key",
        // The node grow and fade are CSS (sankey.css): the scene is laid out at full height on the first build.
        motion: false,
        radius: config.lineCap,
        x1: "x0",
        x2: "x1",
        y1: "y0",
        y2: "y1",
      }));
      if (!config.showLabels) {return [flow, ...nodeMarks] as const;}

      const nameMark = text(labels, {
        anchor: (row) => row.anchor,
        dx: (row) => baselineShift(NAME_FONT_SIZE, row.rotate).dx,
        dy: (row) => baselineShift(NAME_FONT_SIZE, row.rotate).dy,
        fill: SANKEY_LABEL_FILL,
        fontSize: NAME_FONT_SIZE,
        fontWeight: 500,
        id: "nlabel",
        key: "key",
        motion: enterMotion(config.enter, { spread: 0.24, start: LABEL_NAME_START }, clock),
        rotate: (row) => row.rotate,
        text: "name",
        x: "nameX",
        y: "nameY",
      });
      if (!config.showValueLabels) {return [flow, ...nodeMarks, nameMark] as const;}
      const valueMark = text(labels, {
        anchor: (row) => row.anchor,
        dx: (row) => baselineShift(VALUE_FONT_SIZE, row.rotate).dx,
        dy: (row) => baselineShift(VALUE_FONT_SIZE, row.rotate).dy,
        fill: mix(SANKEY_LABEL_FILL, VALUE_LABEL_OPACITY),
        fontSize: VALUE_FONT_SIZE,
        id: "vlabel",
        key: "key",
        motion: enterMotion(config.enter, { spread: 0.24, start: LABEL_NAME_START + VALUE_AFTER_MS / config.enter.durationMs }, clock),
        rotate: (row) => row.rotate,
        text: "value",
        x: "valueX",
        y: "valueY",
      });
      return [flow, ...nodeMarks, nameMark, valueMark] as const;
    },
    nodeKey: (_node, { index }) => index,
    nodePadding: config.nodePadding,
    // Layout only: columns and node widths are placed by layoutColumns.
    nodeWidth: 1,
    nodes: config.data.nodes,
    source: (row) => row.source,
    target: (row) => row.target,
    value: (row) => row.value,
  });
};

type SankeyDatum = SankeyInputLinkRow | NodeRowShape | LabelRow;

export { buildSankeyGradients, createSankeyMark, formatSessions, intFmt };
export type { SankeyDatum, LabelOrientation, SankeyInputData, SankeyInputLinkRow };
