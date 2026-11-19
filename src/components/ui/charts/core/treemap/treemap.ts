import { hierarchy, treemap as tileTreemap, treemapBinary, treemapSliceDice, treemapSquarify } from "d3-hierarchy";
import type { HierarchyRectangularNode } from "d3-hierarchy";
import type { ChartTooltipContent, SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { intFmt } from "../format";
import { fadeIn, popIn } from "../mark-chart/enter";
import { fitText, paletteColor, percentText, tint } from "../mark-chart/paint";
import { boneRect, boneShare } from "../mark-chart/skeleton";
import type { MarkChartBuild, MarkChartFamily, MarkDatum, MarkEnter, MarkFrame, MarkLayout } from "../mark-chart/types";
import { memoCell } from "../memo";
import { parseAspectRatio } from "../theme";
import type { TreemapChartProps, TreemapLabelsProps, TreemapNode, TreemapPoint } from "../types/treemap";
import { describeHierarchy } from "../a11y/describe";
import { contrastingText, STRONG_LABEL } from "../theme";

/** The carrier roles a TreemapChart reads (besides `ChartTooltip`'s). */
export const TREEMAP_ROLES = { labels: "treemapLabels" } as const;

const HEADER = 24;
const CRUMB = 30;
const NAME_SIZE = 12;
const VALUE_SIZE = 11;
const PAD_X = 8;
const SWEEP_MS = 420;
const NO_ATTRS: Readonly<Record<string, string>> = {};
const ZOOMED_ATTRS: Readonly<Record<string, string>> = { "data-bkm-zoomed": "" };

/** One node of the data, indexed: its id is its path. */
interface Info {
  readonly id: string;
  readonly path: readonly string[];
  readonly node: TreemapNode;
  readonly total: number;
  readonly color: string;
  readonly depth: number;
  readonly parent: Info | null;
  readonly children: Info[];
}

interface TreemapDatum extends MarkDatum {
  readonly info: Info;
  /** The breadcrumb (zooms out), not a cell. */
  readonly crumb: boolean;
}

const indexTree = (data: TreemapNode, colors: readonly string[] | undefined): Map<string, Info> => {
  const byId = new Map<string, Info>();
  const visit = (node: TreemapNode, parent: Info | null, branchColor: string | undefined, index: number): Info => {
    const path = parent === null ? [] : [...parent.path, node.name];
    const depth = path.length;
    const color = node.color ?? branchColor ?? (depth === 1 ? paletteColor(colors, index) : paletteColor(colors, 0));
    const info: Info = { children: [], color, depth, id: path.join("/"), node, parent, path, total: 0 };
    byId.set(info.id, info);
    let total = 0;
    (node.children ?? []).forEach((child, childIndex) => {
      const made = visit(child, info, depth === 0 ? undefined : color, childIndex);
      info.children.push(made);
      total += made.total;
    });
    // SAFETY: a fresh object this function owns; its total is final once its children are summed.
    (info as { total: number }).total = info.children.length > 0 ? total : Math.max(0, Number(node.value ?? 0) || 0);
    return info;
  };
  visit(data, null, undefined, 0);
  return byId;
};

const TILES = { binary: treemapBinary, "slice-dice": treemapSliceDice, squarify: treemapSquarify } as const;

interface Resolved {
  readonly infos: Map<string, Info>;
  readonly root: Info;
  readonly top: Info;
  readonly depth: number;
  readonly gap: number;
  readonly radius: number;
  readonly tile: keyof typeof TILES;
  readonly drillDown: boolean;
  readonly format: (value: number) => string;
  readonly labels: TreemapLabelsProps | null;
  readonly zoom: (target: Info) => void;
}

/** The keys a legend row lights: the shown items under the top-level branch at `series` (by position in the data). */
const seriesKeys = (series: Map<number, string[]>) => (index: number): readonly string[] => series.get(index) ?? [];

/** The position of an item's top-level branch among the data root's children. */
const seriesOf = (info: Info): number => {
  let branch: Info = info;
  while (branch.parent !== null && branch.parent.parent !== null) { branch = branch.parent; }
  return branch.parent === null ? 0 : branch.parent.children.indexOf(branch);
};

const keyOf = (info: Info): string => `tm:${info.id}`;

const pointOf = (info: Info, root: Info): TreemapPoint => ({
  branch: info.children.length > 0,
  color: info.color,
  depth: info.depth,
  group: info.path[0] ?? info.node.name,
  name: info.node.name,
  path: info.path,
  share: root.total > 0 ? info.total / root.total : 0,
  value: info.total,
});

/** The tinted strength of a cell: its rank among its siblings, the largest strongest. */
const cellTint = (rank: number, count: number): number => 62 - (count <= 1 ? 0 : (rank / (count - 1)) * 26);

function layoutTreemap(r: Resolved, frame: MarkFrame, delays: Map<string, number>, series: Map<number, string[]>): MarkLayout<TreemapDatum> {
  const { root, gap, radius, labels } = r;
  const zoomed = r.drillDown && root.parent !== null;
  const top = zoomed ? CRUMB : 0;
  const width = Math.max(0, frame.width);
  const height = Math.max(0, frame.height - top);
  const showHeaders = labels !== null && labels.showHeaders !== false;
  const shown = hierarchy<Info>(root, (info) => (info.depth - root.depth < r.depth && info.children.length > 0 ? info.children : undefined))
    .sum((info) => (info.depth - root.depth < r.depth && info.children.length > 0 ? 0 : info.total))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const headerOf = (node: HierarchyRectangularNode<Info>): number =>
    node.depth === 0 ? 0 : showHeaders && node.children !== undefined && node.x1 - node.x0 >= 64 && node.y1 - node.y0 >= HEADER * 2 ? HEADER : gap;
  const side = (node: HierarchyRectangularNode<Info>): number => (node.depth === 0 ? 0 : gap);
  const laid = tileTreemap<Info>()
    .tile(r.tile === "squarify" ? treemapSquarify.ratio(1.3) : TILES[r.tile])
    .size([width, height])
    .paddingInner(gap)
    .paddingTop(headerOf)
    .paddingRight(side)
    .paddingBottom(side)
    .paddingLeft(side)
    .round(true)(shown);
  const ox = frame.x;
  const oy = frame.y + top;
  const branches: SceneNode[] = [];
  const leaves: SceneNode[] = [];
  const branchPoints: TreemapDatum[] = [];
  const leafPoints: TreemapDatum[] = [];
  const extent = Math.max(1, width + height);
  delays.clear();
  series.clear();
  const minWidth = labels?.minWidth ?? 36;
  for (const node of laid.descendants()) {
    if (node.depth === 0) { continue; }
    const info = node.data;
    const x0 = ox + node.x0;
    const y0 = oy + node.y0;
    const w = Math.max(0, node.x1 - node.x0);
    const h = Math.max(0, node.y1 - node.y0);
    if (w <= 0 || h <= 0) { continue; }
    const key = keyOf(info);
    const isBranch = node.children !== undefined;
    const ancestors = node.ancestors().slice(1, -1).map((ancestor) => keyOf(ancestor.data));
    const rx = Math.min(radius, w / 2, h / 2);
    const hit = { kind: "rect", x0, x1: x0 + w, y0, y1: y0 + h } as const;
    const datum: TreemapDatum = {
      color: info.color,
      crumb: false,
      hit,
      index: 0,
      info,
      item: key,
      label: info.node.name,
      series: seriesOf(info),
      related: isBranch ? [...ancestors, ...node.descendants().slice(1).map((child) => keyOf(child.data))] : ancestors,
      row: pointOf(info, root),
      x: x0 + w / 2,
      y: y0 + h / 2,
    };
    delays.set(key, ((node.x0 + node.y0) / extent) * SWEEP_MS);
    const branchIndex = seriesOf(info);
    series.set(branchIndex, [...(series.get(branchIndex) ?? []), key]);
    if (isBranch) {
      const children: SceneNode[] = [{
        className: "bkm-tm-frame", height: h, key: `${key}:frame`, kind: "rect", radius: rx + 2, width: w, x: x0, y: y0,
        style: { fill: tint(info.color, 12), stroke: tint(info.color, 38), strokeWidth: 1 },
      }];
      if (showHeaders && node.y0 + HEADER <= (node.children?.[0]?.y0 ?? node.y1)) {
        const value = labels?.showValues === false ? null : r.format(info.total);
        const valueWidth = value === null ? 0 : frame.measure(value, VALUE_SIZE, 500) + 8;
        const name = fitText(info.node.name, w - PAD_X * 2 - valueWidth, NAME_SIZE, 600, frame.measure);
        if (name !== null) {
          children.push({ anchor: "start", baseline: "middle", className: "bkm-tm-header", fontSize: NAME_SIZE, fontWeight: 600, key: `${key}:name`, kind: "label", style: { fill: "var(--chart-tooltip-foreground)" }, text: name, x: x0 + PAD_X, y: y0 + HEADER / 2 + 1 });
          if (value !== null) {
            children.push({ anchor: "end", baseline: "middle", className: "bkm-tm-header-value", fontSize: VALUE_SIZE, fontWeight: 500, key: `${key}:value`, kind: "label", style: { fill: STRONG_LABEL }, text: value, x: x0 + w - PAD_X, y: y0 + HEADER / 2 + 1 });
          }
        }
      }
      branches.push({ children, className: "bkm-mc-item bkm-tm-branch", key, kind: "group" });
      branchPoints.push(datum);
    } else {
      const siblings = node.parent?.children ?? [node];
      const rank = siblings.indexOf(node);
      const children: SceneNode[] = [{
        className: "bkm-tm-cell", height: h, key: `${key}:cell`, kind: "rect", radius: rx, width: w, x: x0, y: y0,
        style: { fill: tint(info.color, cellTint(rank, siblings.length)), stroke: tint(info.color, 78), strokeWidth: 1 },
      }];
      if (labels !== null && w >= minWidth && h >= 26) {
        const name = fitText(info.node.name, w - PAD_X * 2, NAME_SIZE, 500, frame.measure);
        if (name !== null) {
          children.push({ anchor: "start", baseline: "middle", className: "bkm-tm-label", fontSize: NAME_SIZE, fontWeight: 500, key: `${key}:name`, kind: "label", style: { fill: contrastingText(tint(info.color, cellTint(rank, siblings.length))) }, text: name, x: x0 + PAD_X, y: y0 + 15 });
          if (labels.showValues !== false && h >= 42) {
            const value = r.format(info.total);
            if (frame.measure(value, VALUE_SIZE, 500) <= w - PAD_X * 2) {
              children.push({ anchor: "start", baseline: "middle", className: "bkm-tm-value", fontSize: VALUE_SIZE, fontWeight: 500, key: `${key}:value`, kind: "label", style: { fill: contrastingText(tint(info.color, cellTint(rank, siblings.length))) }, text: value, x: x0 + PAD_X, y: y0 + 31 });
            }
          }
        }
      }
      leaves.push({ children, className: "bkm-mc-item bkm-tm-leaf", key, kind: "group" });
      leafPoints.push(datum);
    }
  }
  const nodes: SceneNode[] = [...branches, ...leaves];
  const points: TreemapDatum[] = [...branchPoints, ...leafPoints];
  if (zoomed) {
    const crumbKey = "tm:crumb";
    const trail = `‹  ${[r.top.node.name, ...root.path].join(" / ")}`;
    const text = fitText(trail, frame.width - PAD_X * 2, NAME_SIZE, 500, frame.measure) ?? "‹";
    nodes.unshift({
      children: [
        { className: "bkm-tm-crumb-hit", height: CRUMB - 6, key: `${crumbKey}:hit`, kind: "rect", radius: 6, width: Math.min(frame.width, frame.measure(text, NAME_SIZE, 500) + PAD_X * 2), x: frame.x, y: frame.y, style: { fill: "var(--chart-segment-background)" } },
        { anchor: "start", baseline: "middle", className: "bkm-tm-crumb", fontSize: NAME_SIZE, fontWeight: 500, key: `${crumbKey}:text`, kind: "label", style: { fill: "var(--chart-foreground)" }, text, x: frame.x + PAD_X, y: frame.y + (CRUMB - 6) / 2 + 1 },
      ],
      className: "bkm-mc-item bkm-tm-crumb-group",
      key: crumbKey,
      kind: "group",
    });
    const parent = root.parent as Info;
    points.unshift({
      color: parent.color, crumb: true, hit: { kind: "rect", x0: frame.x, x1: frame.x + frame.width, y0: frame.y, y1: frame.y + CRUMB - 6 },
      index: 0, info: parent, item: crumbKey, label: `Back to ${parent.node.name}`, row: pointOf(parent, parent), x: frame.x + PAD_X, y: frame.y + CRUMB / 2,
    });
    delays.set(crumbKey, 0);
  }
  return { nodes, points: points.map((point, index) => ({ ...point, index })) };
}

/** The skeleton's branches and their leaves without data. */
const SKELETON_BRANCHES: readonly number[] = [4, 3, 3, 2];

/** The loading skeleton: leaf tiles squarified in the plot, one branch per top-level branch of the data (with as many leaves), sizes
 * seeded. */
const treemapSkeleton = (root: Info, gap: number, radius: number, frame: MarkFrame): SceneNode[] => {
  const shape = root.children.length > 0 ? root.children.map((branch) => Math.min(8, Math.max(1, branch.children.length))) : SKELETON_BRANCHES;
  interface Tile { readonly value: number; readonly children?: readonly Tile[] }
  let leaf = 0;
  const tiles: Tile = {
    children: shape.map((count, branch) => ({
      children: Array.from({ length: count }, () => {
        leaf += 1;
        return { value: (1 + boneShare(leaf, 3) * 3) * (1.6 - branch * 0.2) };
      }),
      value: 0,
    })),
    value: 0,
  };
  const laid = tileTreemap<Tile>()
    .tile(treemapSquarify.ratio(1.3))
    .size([Math.max(0, frame.width), Math.max(0, frame.height)])
    .paddingInner(gap)
    .paddingOuter((node) => (node.depth === 0 ? 0 : gap))
    .round(true)(hierarchy<Tile>(tiles, (tile) => tile.children).sum((tile) => tile.value).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)));
  return laid.leaves().map((node, index) => boneRect(`tm:${index}`, frame.x + node.x0, frame.y + node.y0, node.x1 - node.x0, node.y1 - node.y0, radius));
};

/** The treemap family: one builder per chart, its memo cells holding each part while its inputs do. */
export const TREEMAP_FAMILY: MarkChartFamily<TreemapChartProps> = {
  chart: "treemap",
  props: {
    booleans: ["drillDown", "animate"],
    names: ["data", "status", "loadingLabel", "aspectRatio", "height", "depth", "gap", "radius", "tile", "colors", "drillDown", "formatValue", "valueLabel", "animate", "onDrillChange", "ariaLabel", "ariaDescription"],
  },
  placeholder: { ariaLabel: "Treemap chart", data: { children: [], name: "" } },
  createBuilder: () => {
    const indexCell = memoCell<Map<string, Info>>();
    const buildCell = memoCell<MarkChartBuild>();
    return ({ props, table, state, setState }) => {
      const infos = indexCell([props.data, props.colors], () => indexTree(props.data, props.colors));
      const top = infos.get("") as Info;
      const rootId = typeof state.root === "string" && infos.has(state.root) ? state.root : "";
      const root = infos.get(rootId) as Info;
      const labels = propsFor<TreemapLabelsProps>(table, TREEMAP_ROLES.labels).at(-1) ?? null;
      const { formatValue, valueLabel, onDrillChange } = props;
      const drillDown = props.drillDown !== false;
      const animate = props.animate !== false;
      return buildCell([infos, root, labels, props.depth, props.gap, props.radius, props.tile, drillDown, formatValue, valueLabel, onDrillChange, animate, props.aspectRatio, props.height, props.ariaLabel, props.ariaDescription], () => {
        const format = formatValue ?? intFmt;
        const zoom = (target: Info): void => {
          setState({ root: target.id });
          onDrillChange?.(target.path);
        };
        const resolved: Resolved = {
          depth: Math.max(1, props.depth ?? 2), drillDown, format, gap: Math.max(0, props.gap ?? 3), infos, labels, radius: Math.max(0, props.radius ?? 6), root, top, tile: props.tile ?? "squarify", zoom,
        };
        const delays = new Map<string, number>();
        const series = new Map<number, string[]>();
        const enter = (key: string): MarkEnter | undefined => {
          const delay = delays.get(key);
          if (delay === undefined) { return undefined; }
          return key === "tm:crumb" ? fadeIn(delay) : popIn(delay, 0.82);
        };
        const tooltip = (datum: MarkDatum): ChartTooltipContent => {
          const { info, crumb } = datum as TreemapDatum;
          if (crumb) {
            return { rows: [{ label: "Zoom out to", value: info.node.name }], title: "Back" };
          }
          const share = root.total > 0 ? info.total / root.total : 0;
          return {
            rows: [
              { color: info.color, label: valueLabel ?? "Value", value: format(info.total) },
              { label: `Share of ${root.node.name}`, value: percentText(share) },
            ],
            title: info.path.join(" / "),
          };
        };
        const select = (datum: MarkDatum | null): void => {
          if (!drillDown || datum === null) { return; }
          const { info, crumb } = datum as TreemapDatum;
          if (crumb) {
            zoom(info);
            return;
          }
          // A branch zooms in; a leaf zooms into its branch below the shown root.
          let target: Info | null = info;
          while (target !== null && target.children.length === 0) { target = target.parent; }
          if (target !== null && target !== root) { zoom(target); }
        };
        return {
          ariaDescription: props.ariaDescription,
          describe: () => describeHierarchy({ kind: "Treemap", root: props.data, name: (n: TreemapNode) => n.name, children: (n: TreemapNode) => n.children, value: (n: TreemapNode) => (n.children !== undefined && n.children.length > 0 ? null : (n.value ?? null)), valueLabel, format }),
          ariaLabel: props.ariaLabel ?? `Treemap of ${top.node.name}`,
          ...(props.height === undefined ? { aspectRatio: parseAspectRatio(props.aspectRatio ?? "16 / 9") } : { height: props.height }),
          ...(animate ? { enter } : {}),
          glide: true,
          hostAttrs: root.parent === null ? NO_ATTRS : ZOOMED_ATTRS,
          layout: (frame) => layoutTreemap(resolved, frame, delays, series),
          seriesItems: seriesKeys(series),
          select,
          selectable: drillDown,
          skeleton: (frame) => treemapSkeleton(top, resolved.gap, resolved.radius, frame),
          tooltip,
        };
      });
    };
  },
};
