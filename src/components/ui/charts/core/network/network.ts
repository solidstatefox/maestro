import { forceLayout } from "@tanstack/charts/network/force";
import type { ChartTooltipContent, SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { intFmt } from "../format";
import { drawIn, fadeIn, popIn } from "../mark-chart/enter";
import { paletteColor, tint } from "../mark-chart/paint";
import { boneDot, boneLink, boneShare } from "../mark-chart/skeleton";
import type { MarkChartBuild, MarkChartFamily, MarkDatum, MarkEnter, MarkFrame, MarkLayout } from "../mark-chart/types";
import { memoCell } from "../memo";
import { parseAspectRatio } from "../theme";
import type { NetworkChartProps, NetworkData, NetworkLabelsProps, NetworkNode, NetworkPoint } from "../types/network";
import { describeFlows } from "../a11y/describe";
import type { ChartDescription } from "../a11y/describe";


/** The graph's description (core/a11y/describe.ts): one row per link, its two nodes by label, its weight when the links carry one. */
const networkDescription = (data: NetworkData, format: (value: number) => string, valueLabel: string | undefined): ChartDescription => {
  const label = new Map(data.nodes.map((n) => [n.id, n.label ?? n.id]));
  const weighted = data.links.some((l) => l.value !== undefined);
  return describeFlows({
    kind: "Network graph",
    unit: "links",
    links: data.links,
    nodeCount: data.nodes.length,
    source: (l) => label.get(l.source) ?? l.source,
    target: (l) => label.get(l.target) ?? l.target,
    ...(weighted ? { value: (l: NetworkData["links"][number]) => l.value ?? null, valueLabel, format } : {}),
  });
};
export const NETWORK_ROLES = { labels: "networkLabels" } as const;

const NODE_STAGGER_MS = 420;
const LINK_DELAY_MS = 320;
const SETTLE_ITERATIONS = 60;
const LABEL_SIZE = 11;

type Point = readonly [number, number];

interface Graph {
  readonly nodes: readonly NetworkNode[];
  readonly links: readonly { readonly source: number; readonly target: number; readonly value: number }[];
  readonly groups: readonly string[];
  readonly groupOf: readonly number[];
  readonly degree: readonly number[];
  readonly neighbors: readonly (readonly number[])[];
  readonly incident: readonly (readonly number[])[];
  readonly radius: readonly number[];
  readonly width: readonly number[];
}

const buildGraph = (data: NetworkData, sizes: readonly [number, number]): Graph => {
  const index = new Map(data.nodes.map((node, i) => [node.id, i]));
  const links = data.links.flatMap((link) => {
    const source = index.get(link.source);
    const target = index.get(link.target);
    return source === undefined || target === undefined || source === target ? [] : [{ source, target, value: Math.max(0, Number(link.value ?? 1) || 0) }];
  });
  const groups: string[] = [];
  const groupOf = data.nodes.map((node) => {
    if (node.group === undefined) { return -1; }
    let at = groups.indexOf(node.group);
    if (at < 0) { at = groups.push(node.group) - 1; }
    return at;
  });
  const degree = data.nodes.map(() => 0);
  const neighbors: number[][] = data.nodes.map(() => []);
  const incident: number[][] = data.nodes.map(() => []);
  links.forEach((link, i) => {
    degree[link.source] = (degree[link.source] ?? 0) + 1;
    degree[link.target] = (degree[link.target] ?? 0) + 1;
    neighbors[link.source]?.push(link.target);
    neighbors[link.target]?.push(link.source);
    incident[link.source]?.push(i);
    incident[link.target]?.push(i);
  });
  const hasValues = data.nodes.some((node) => node.value !== undefined);
  const sizeOf = data.nodes.map((node, i) => (hasValues ? Math.max(0, Number(node.value ?? 0) || 0) : (degree[i] ?? 0)));
  const maxSize = Math.max(1e-9, ...sizeOf);
  const [min, max] = sizes;
  const radius = sizeOf.map((size) => min + (max - min) * Math.sqrt(size / maxSize));
  const maxLink = Math.max(1e-9, ...links.map((link) => link.value));
  const width = links.map((link) => 1 + 2.25 * (link.value / maxLink));
  return { degree, groupOf, groups, incident, links, neighbors, nodes: data.nodes, radius, width };
};

interface Settle {
  readonly distance: number;
  readonly repulsion: number;
  readonly aspect: number;
}

/** The force layout, from `seed` positions when given (a settle after a drop), the `pinned` nodes held where they are. */
const simulate = (graph: Graph, data: NetworkData, settle: Settle, seed: readonly Point[] | null, pinned: ReadonlyMap<number, Point>, iterations: number): Point[] => {
  const nodes = data.nodes.map((node, i) => {
    const at = pinned.get(i) ?? seed?.[i];
    const pin = pinned.get(i);
    return { ...node, ...(at === undefined ? {} : { x: at[0], y: at[1] }), ...(pin === undefined ? {} : { fx: pin[0], fy: pin[1] }) };
  });
  const links = graph.links.map((link) => ({ source: data.nodes[link.source]?.id ?? "", target: data.nodes[link.target]?.id ?? "", value: link.value }));
  const maxLink = Math.max(1e-9, ...graph.links.map((link) => link.value));
  const laid = forceLayout(nodes, links, {
    forces: [
      { distance: (link) => settle.distance * (1.15 - 0.3 * (link.value / maxLink)), type: "link" },
      { strength: -settle.repulsion, type: "manyBody" },
      { type: "center" },
      { radius: (node) => (graph.radius[data.nodes.findIndex((other) => other.id === node.id)] ?? 6) + 3, strength: 0.9, type: "collide" },
      { strength: 0.04, type: "x" },
      { strength: 0.04 * Math.max(1, settle.aspect), type: "y" },
    ],
    iterations,
    nodeKey: "id",
    source: "source",
    target: "target",
  });
  return laid.nodes.map((node): Point => [node.x, node.y]);
};

/** Layout coordinates to scene pixels: one scale, the base layout centred in the frame. */
interface Transform {
  readonly kx: number;
  readonly ky: number;
  readonly ox: number;
  readonly oy: number;
}

/** How far one axis may stretch past the other to fill the plot (a force layout has no orientation of its own). */
const MAX_STRETCH = 1.6;

interface Resolved {
  readonly graph: Graph;
  readonly base: readonly Point[];
  readonly positions: readonly Point[];
  readonly labels: NetworkLabelsProps | null;
  readonly colors: readonly string[] | undefined;
}

const colorOf = (r: Resolved, i: number): string => paletteColor(r.colors, Math.max(0, r.graph.groupOf[i] ?? 0));

const nodeKey = (i: number): string => `nw:n:${i}`;
const linkKey = (i: number): string => `nw:l:${i}`;

function layoutNetwork(r: Resolved, frame: MarkFrame, transform: { current: Transform }, enters: Map<string, MarkEnter>, animate: boolean): MarkLayout {
  const { graph } = r;
  const labelRoom = r.labels === null ? 0 : Math.max(0, ...graph.nodes.map((node) => frame.measure(node.label ?? node.id, LABEL_SIZE, 500))) + 8;
  const maxR = Math.max(0, ...graph.radius);
  const xs = r.base.map((p) => p[0]);
  const ys = r.base.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const padX = maxR + 4 + labelRoom / 2;
  const padY = maxR + 6;
  const fitX = Math.max(0.05, (frame.width - 2 * padX) / Math.max(1, x1 - x0));
  const fitY = Math.max(0.05, (frame.height - 2 * padY) / Math.max(1, y1 - y0));
  const k = Math.min(fitX, fitY);
  const kx = Math.min(fitX, k * MAX_STRETCH);
  const ky = Math.min(fitY, k * MAX_STRETCH);
  const t: Transform = { kx, ky, ox: frame.x + frame.width / 2 - ((x0 + x1) / 2) * kx, oy: frame.y + frame.height / 2 - ((y0 + y1) / 2) * ky };
  transform.current = t;
  const at = (i: number): Point => {
    const p = r.positions[i] ?? [0, 0];
    return [t.ox + p[0] * t.kx, t.oy + p[1] * t.ky];
  };
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const reach = Math.max(1, Math.hypot(frame.width, frame.height) / 2);
  enters.clear();
  const links: SceneNode[] = graph.links.map((link, i) => {
    const [ax, ay] = at(link.source);
    const [bx, by] = at(link.target);
    if (animate) { enters.set(linkKey(i), { delay: LINK_DELAY_MS + (Math.hypot((ax + bx) / 2 - cx, (ay + by) / 2 - cy) / reach) * NODE_STAGGER_MS, duration: 0, easing: "", keyframes: [] }); }
    return { className: "bkm-mc-item bkm-nw-link", key: linkKey(i), kind: "rule", style: { stroke: tint("var(--chart-foreground-muted)", 85), strokeWidth: graph.width[i] ?? 1 }, x1: ax, x2: bx, y1: ay, y2: by };
  });
  const nodes: SceneNode[] = [];
  const points: MarkDatum[] = [];
  graph.nodes.forEach((node, i) => {
    const [x, y] = at(i);
    const radius = graph.radius[i] ?? 5;
    const color = colorOf(r, i);
    const label = node.label ?? node.id;
    const children: SceneNode[] = [{ className: "bkm-nw-dot", key: `${nodeKey(i)}:dot`, kind: "dot", radius, style: { fill: color, stroke: "var(--chart-background)", strokeWidth: 1.5 }, x, y }];
    if (r.labels !== null && radius >= (r.labels.minRadius ?? 0)) {
      children.push({ anchor: "start", baseline: "middle", className: "bkm-nw-label", fontSize: LABEL_SIZE, fontWeight: 500, key: `${nodeKey(i)}:label`, kind: "label", style: { fill: "var(--chart-tooltip-foreground)", stroke: "var(--chart-background)", strokeWidth: 3 }, text: label, x: x + radius + 4, y: y + 1 });
    }
    nodes.push({ children, className: "bkm-mc-item bkm-nw-node", key: nodeKey(i), kind: "group" });
    if (animate) {
      const delay = (Math.hypot(x - cx, y - cy) / reach) * NODE_STAGGER_MS;
      enters.set(`${nodeKey(i)}:dot`, popIn(delay, 0));
      enters.set(`${nodeKey(i)}:label`, fadeIn(delay + 200, 360));
    }
    const neighbors = graph.neighbors[i] ?? [];
    const group = node.group ?? null;
    const row: NetworkPoint = {
      color, degree: graph.degree[i] ?? 0, group, id: node.id, label, neighbors: neighbors.map((other) => graph.nodes[other]?.label ?? graph.nodes[other]?.id ?? ""), value: node.value ?? null,
    };
    const hit = Math.max(radius + 4, 9);
    points.push({
      color, hit: { cx: x, cy: y, kind: "circle", r: hit }, index: i, item: nodeKey(i), label,
      related: [...neighbors.map(nodeKey), ...(graph.incident[i] ?? []).map(linkKey)], row, series: Math.max(0, graph.groupOf[i] ?? 0), x, y,
    });
  });
  return { nodes: [...links, ...nodes], points };
}

/** The skeleton's clusters, and the members around each hub. */
const SKELETON_CLUSTERS = 3;
const SKELETON_MEMBERS = 5;

/** The loading skeleton: three clusters around the plot's centre (spread wide on a wide plot, as the force layout stretches), each a hub
 * and its members at seeded places, linked to their hub, the hubs to each other; dots between the chart's node sizes. */
const networkSkeleton = (sizes: readonly [number, number], frame: MarkFrame): SceneNode[] => {
  const [small, large] = sizes;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const reach = Math.min(frame.width, frame.height) * 0.27;
  const stretch = Math.min(MAX_STRETCH, Math.max(1, frame.width / Math.max(1, frame.height)));
  const links: SceneNode[] = [];
  const dots: SceneNode[] = [];
  const line = (key: string, a: Point, b: Point): SceneNode => boneLink(key, `M${a[0]},${a[1]}L${b[0]},${b[1]}`, [a, b], 1.25);
  const hubs: Point[] = [];
  for (let cluster = 0; cluster < SKELETON_CLUSTERS; cluster += 1) {
    const a = -Math.PI / 2 + (cluster * Math.PI * 2) / SKELETON_CLUSTERS + 0.35;
    const hub: Point = [cx + Math.cos(a) * reach * stretch, cy + Math.sin(a) * reach];
    hubs.push(hub);
    for (let member = 0; member < SKELETON_MEMBERS; member += 1) {
      const index = cluster * SKELETON_MEMBERS + member;
      const angle = a + ((member - (SKELETON_MEMBERS - 1) / 2) / SKELETON_MEMBERS) * Math.PI * 1.5 + boneShare(index, 51) * 0.4;
      const distance = reach * (0.42 + boneShare(index, 53) * 0.22);
      const at: Point = [hub[0] + Math.cos(angle) * distance * Math.sqrt(stretch), hub[1] + Math.sin(angle) * distance];
      links.push(line(`nw:l:${index}`, hub, at));
      dots.push(boneDot(`nw:n:${index}`, at[0], at[1], small + (large - small) * 0.35 * boneShare(index, 57)));
    }
    dots.push(boneDot(`nw:h:${cluster}`, hub[0], hub[1], large * 0.85));
  }
  hubs.forEach((hub, cluster) => { links.push(line(`nw:hh:${cluster}`, hub, hubs[(cluster + 1) % hubs.length] as Point)); });
  return [...links, ...dots];
};

interface DragState {
  readonly index: number;
  readonly point: Point;
}

/** The network family: one builder per chart. */
export const NETWORK_FAMILY: MarkChartFamily<NetworkChartProps> = {
  chart: "network",
  props: {
    booleans: ["draggable", "animate"],
    names: ["data", "status", "loadingLabel", "draggable", "linkDistance", "repulsion", "nodeSize", "colors", "formatValue", "valueLabel", "onHoverChange", "aspectRatio", "height", "animate", "ariaLabel", "ariaDescription"],
  },
  placeholder: { data: { links: [], nodes: [] } },
  createBuilder: () => {
    const graphCell = memoCell<Graph>();
    const baseCell = memoCell<Point[]>();
    const buildCell = memoCell<MarkChartBuild>();
    // The latest layout's transform (a drag converts the pointer with it) and the entrance per element.
    const transform: { current: Transform } = { current: { kx: 1, ky: 1, ox: 0, oy: 0 } };
    const enters = new Map<string, MarkEnter>();
    // The node being dragged and the pointer's offset from its centre: the chart's, across the builds each move makes.
    let grab: { readonly index: number; readonly dx: number; readonly dy: number } | null = null;
    return ({ props, table, state, setState }) => {
      const sizes = props.nodeSize ?? [4, 13];
      const graph = graphCell([props.data, sizes[0], sizes[1]], () => buildGraph(props.data, sizes));
      const aspect = props.height === undefined ? parseAspectRatio(props.aspectRatio ?? "16 / 10") : 1.6;
      const settle: Settle = { aspect, distance: props.linkDistance ?? 46, repulsion: props.repulsion ?? 120 };
      const base = baseCell([graph, settle.distance, settle.repulsion, settle.aspect], () => simulate(graph, props.data, settle, null, new Map(), 300));
      // A settled layout from a previous drop is kept while the data holds.
      const settled = state.data === props.data ? (state.positions as readonly Point[] | undefined) : undefined;
      const drag = state.data === props.data ? (state.drag as DragState | null | undefined) : undefined;
      const pinned = state.data === props.data ? ((state.pinned as ReadonlyMap<number, Point> | undefined) ?? new Map<number, Point>()) : new Map<number, Point>();
      const labels = propsFor<NetworkLabelsProps>(table, NETWORK_ROLES.labels).at(-1) ?? null;
      const animate = props.animate !== false;
      return buildCell([graph, base, settled, drag, labels, props.draggable, props.colors, props.formatValue, props.valueLabel, props.onHoverChange, props.aspectRatio, props.height, animate, props.ariaLabel, props.ariaDescription], () => {
        const positions = (settled ?? base).map((p, i): Point => (drag?.index === i ? drag.point : p));
        const resolved: Resolved = { base, colors: props.colors, graph, labels, positions };
        const format = props.formatValue ?? intFmt;
        const enter = (key: string, element: Element): MarkEnter | undefined => {
          const spec = enters.get(key);
          if (spec === undefined) { return undefined; }
          return key.startsWith("nw:l:") ? drawIn(element, spec.delay, 480) : spec;
        };
        const tooltip = (datum: MarkDatum): ChartTooltipContent => {
          const point = datum.row as NetworkPoint;
          const rows = [
            ...(point.group === null ? [] : [{ color: point.color, label: "Group", value: point.group }]),
            ...(point.value === null ? [] : [{ label: props.valueLabel ?? "Value", value: format(point.value) }]),
            { label: "Links", value: String(point.degree) },
          ];
          return { rows, title: point.label };
        };
        const toLayout = (x: number, y: number): Point => [(x - transform.current.ox) / transform.current.kx, (y - transform.current.oy) / transform.current.ky];
        return {
          ariaDescription: props.ariaDescription,
          describe: () => networkDescription(props.data, format, props.valueLabel),
          ariaLabel: props.ariaLabel ?? "Network graph",
          ...(props.height === undefined ? { aspectRatio: aspect } : { height: props.height }),
          ...(animate ? { enter } : {}),
          ...(props.onHoverChange === undefined ? {} : { hover: (datum: MarkDatum | null) => props.onHoverChange?.(datum?.series ?? null) }),
          ...(props.draggable === false
            ? {}
            : {
                drag: {
                  end: () => {
                    const held = grab;
                    grab = null;
                    if (held === null) { return; }
                    const current = (state.drag as DragState | null | undefined)?.point;
                    const drop = current ?? positions[held.index] ?? [0, 0];
                    const nextPinned = new Map(pinned);
                    nextPinned.set(held.index, drop);
                    const seed = positions.map((p, i): Point => (i === held.index ? drop : p));
                    setState({ data: props.data, drag: null, pinned: nextPinned, positions: simulate(graph, props.data, settle, seed, nextPinned, SETTLE_ITERATIONS) });
                  },
                  move: (x, y) => {
                    if (grab === null) { return; }
                    setState({ data: props.data, drag: { index: grab.index, point: toLayout(x - grab.dx, y - grab.dy) } });
                  },
                  start: (datum, x, y) => {
                    grab = { dx: x - datum.x, dy: y - datum.y, index: datum.index };
                    return true;
                  },
                },
              }),
          glide: true,
          layout: (frame) => layoutNetwork(resolved, frame, transform, enters, animate),
          skeleton: (frame) => networkSkeleton(sizes, frame),
          seriesItems: (series) => graph.nodes.flatMap((_, i) => (Math.max(0, graph.groupOf[i] ?? 0) === series ? [nodeKey(i), ...(graph.incident[i] ?? []).map(linkKey)] : [])),
          tooltip,
        };
      });
    };
  },
};
