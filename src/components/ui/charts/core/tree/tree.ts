import { treeLayout } from "@tanstack/charts/hierarchy/tree";
import type { ChartTooltipContent, SceneNode } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { intFmt } from "../format";
import { drawIn, fadeIn, popIn } from "../mark-chart/enter";
import { paletteColor, tint } from "../mark-chart/paint";
import { boneDot, boneLabel, boneLink, boneShare } from "../mark-chart/skeleton";
import type { MarkChartBuild, MarkChartFamily, MarkDatum, MarkEnter, MarkFrame, MarkLayout, MarkState } from "../mark-chart/types";
import { memoCell } from "../memo";
import { parseAspectRatio } from "../theme";
import type { TreeChartProps, TreeLabelsProps, TreeNode, TreePoint } from "../types/tree";
import { describeHierarchy } from "../a11y/describe";

export const TREE_ROLES = { labels: "treeLabels" } as const;

const LABEL_SIZE = 12;
const LABEL_GAP = 8;
/** The closest a horizontal tree sets two leaves' labels, centre to centre. */
const LEAF_LINE = LABEL_SIZE + 3;
const DEPTH_STAGGER_MS = 160;
const PAD = 14;

interface Info {
  readonly id: string;
  readonly path: readonly string[];
  readonly node: TreeNode;
  readonly total: number;
  readonly descendants: number;
  readonly color: string;
  readonly depth: number;
  readonly parent: Info | null;
  readonly children: Info[];
}

/** Whether any node of the tree carries a value (the description's value column). */
const hasValues = (node: TreeNode): boolean => node.value !== undefined || (node.children ?? []).some(hasValues);

const indexTree = (data: TreeNode, colors: readonly string[] | undefined): Map<string, Info> => {
  const byId = new Map<string, Info>();
  const visit = (node: TreeNode, parent: Info | null, inherited: string | undefined, index: number): Info => {
    const path = parent === null ? [] : [...parent.path, node.name];
    const depth = path.length;
    const color = node.color ?? inherited ?? (depth === 0 ? "var(--chart-foreground)" : paletteColor(colors, index));
    const info: Info = { children: [], color, depth, descendants: 0, id: path.join("/"), node, parent, path, total: 0 };
    byId.set(info.id, info);
    let total = 0;
    let descendants = 0;
    (node.children ?? []).forEach((child, childIndex) => {
      const made = visit(child, info, depth === 0 ? undefined : color, childIndex);
      info.children.push(made);
      total += made.total;
      descendants += 1 + made.descendants;
    });
    // SAFETY: a fresh object this function owns; its sums are final once its children are visited.
    Object.assign(info as { total: number; descendants: number }, { descendants, total: info.children.length > 0 ? total : Math.max(0, Number(node.value ?? 0) || 0) });
    return info;
  };
  visit(data, null, undefined, 0);
  return byId;
};

/** A visible node in unit space: its breadth (0 to 1 across the tree) and depth (0 at the root, 1 at the deepest shown level). */
interface Placed {
  readonly info: Info;
  readonly breadth: number;
  readonly depth: number;
  readonly collapsed: boolean;
}

const visibleNodes = (root: Info, collapsed: ReadonlySet<string>): Info[] => {
  const out: Info[] = [];
  const walk = (info: Info): void => {
    out.push(info);
    if (!collapsed.has(info.id)) { info.children.forEach(walk); }
  };
  walk(root);
  return out;
};

/** TanStack's tidy tree, or a dendrogram (leaves evenly spaced at the deepest level, a branch centred over its children). */
const place = (root: Info, collapsed: ReadonlySet<string>, variant: NonNullable<TreeChartProps["variant"]>): Placed[] => {
  const shown = visibleNodes(root, collapsed);
  const isLeaf = (info: Info): boolean => info.children.length === 0 || collapsed.has(info.id);
  const maxDepth = Math.max(1, ...shown.map((info) => info.depth));
  const raw = new Map<string, { breadth: number; depth: number }>();
  if (variant === "cluster") {
    let leaf = 0;
    const walk = (info: Info): number => {
      if (isLeaf(info)) {
        raw.set(info.id, { breadth: leaf, depth: maxDepth });
        leaf += 1;
        return leaf - 1;
      }
      const breadths = info.children.map(walk);
      const breadth = breadths.reduce((a, b) => a + b, 0) / breadths.length;
      raw.set(info.id, { breadth, depth: info.depth });
      return breadth;
    };
    walk(root);
  } else {
    const rows = shown.map((info) => ({ id: info.id === "" ? "\u0000root" : info.id, parentId: info.parent === null ? null : info.parent.id === "" ? "\u0000root" : info.parent.id }));
    const laid = treeLayout(rows, { id: "id", orientation: "left", parentId: "parentId" });
    for (const node of laid.nodes) {
      raw.set(node.id === "\u0000root" ? "" : node.id, { breadth: -node.y, depth: node.x });
    }
  }
  const breadths = [...raw.values()].map((value) => value.breadth);
  const lo = Math.min(...breadths);
  const span = Math.max(...breadths) - lo;
  return shown.map((info) => {
    const at = raw.get(info.id) ?? { breadth: 0, depth: info.depth };
    return { breadth: span > 0 ? (at.breadth - lo) / span : 0.5, collapsed: collapsed.has(info.id) && info.children.length > 0, depth: at.depth / maxDepth, info };
  });
};

interface Resolved {
  readonly root: Info;
  readonly collapsed: ReadonlySet<string>;
  readonly variant: NonNullable<TreeChartProps["variant"]>;
  readonly layout: NonNullable<TreeChartProps["layout"]>;
  readonly nodeSize: number;
  readonly labels: TreeLabelsProps | null;
  readonly format: (value: number) => string;
}

/** The least height a horizontal tree's leaf labels read at: the closest two leaves a label's line apart (a narrow chart's aspect ratio
 * would set them on top of each other). */
const leafLabelsHeight = (r: Resolved): number => {
  const leaves = place(r.root, r.collapsed, r.variant).filter((p) => p.info.children.length === 0 || p.collapsed).map((p) => p.breadth).sort((a, b) => a - b);
  let closest = 1;
  for (let i = 1; i < leaves.length; i += 1) {
    const gap = (leaves[i] ?? 0) - (leaves[i - 1] ?? 0);
    if (gap > 0) { closest = Math.min(closest, gap); }
  }
  return Math.ceil(LEAF_LINE / closest + 2 * PAD);
};

const nodeKey = (info: Info): string => `tr:n:${info.id}`;
const linkKey = (info: Info): string => `tr:l:${info.id}`;

const pointOf = (placed: Placed): TreePoint => ({
  children: placed.info.children.length,
  collapsed: placed.collapsed,
  color: placed.info.color,
  depth: placed.info.depth,
  descendants: placed.info.descendants,
  name: placed.info.node.name,
  path: placed.info.path,
  value: placed.info.total,
});

function layoutTree(r: Resolved, frame: MarkFrame, depths: Map<string, number>): MarkLayout {
  const placed = place(r.root, r.collapsed, r.variant);
  const labelOf = (p: Placed): string => {
    const base = p.collapsed ? `${p.info.node.name} +${p.info.descendants}` : p.info.node.name;
    return r.labels?.showValues === true && p.info.children.length === 0 ? `${base}  ${r.format(p.info.total)}` : base;
  };
  const isLeaf = (p: Placed): boolean => p.info.children.length === 0 || p.collapsed;
  const widths = new Map(placed.map((p) => [p.info.id, r.labels === null ? 0 : frame.measure(labelOf(p), LABEL_SIZE, isLeaf(p) ? 400 : 500)]));
  const leafRoom = Math.max(0, ...placed.filter(isLeaf).map((p) => widths.get(p.info.id) ?? 0));
  const rootRoom = widths.get(r.root.id) ?? 0;
  const pos = new Map<string, readonly [number, number]>();
  const angle = new Map<string, number>();
  let cx = 0;
  let cy = 0;
  if (r.layout === "radial") {
    cx = frame.x + frame.width / 2;
    cy = frame.y + frame.height / 2;
    const room = r.labels === null ? PAD : Math.min(leafRoom + LABEL_GAP + 4, Math.min(frame.width, frame.height) * 0.3);
    const radius = Math.max(10, Math.min(frame.width, frame.height) / 2 - room);
    const leaves = placed.filter(isLeaf).length;
    const sweep = Math.PI * 2 * (leaves > 1 ? (leaves - 1) / leaves : 1);
    for (const p of placed) {
      const a = p.breadth * sweep;
      angle.set(p.info.id, a);
      pos.set(p.info.id, [cx + Math.sin(a) * radius * p.depth, cy - Math.cos(a) * radius * p.depth]);
    }
  } else if (r.layout === "vertical") {
    const top = frame.y + PAD + (r.labels === null ? 0 : LABEL_SIZE + 4);
    const bottom = frame.y + frame.height - PAD - (r.labels === null ? 0 : LABEL_SIZE + 6);
    const left = frame.x + PAD + Math.min(leafRoom / 2, frame.width * 0.1);
    const width = Math.max(0, frame.width - 2 * (left - frame.x));
    for (const p of placed) { pos.set(p.info.id, [left + p.breadth * width, top + p.depth * (bottom - top)]); }
  } else {
    const left = frame.x + PAD + (r.labels === null ? 0 : rootRoom + LABEL_GAP);
    const right = frame.x + frame.width - PAD - (r.labels === null ? 0 : Math.min(leafRoom + LABEL_GAP, frame.width * 0.35));
    const top = frame.y + PAD;
    const height = Math.max(0, frame.height - 2 * PAD);
    for (const p of placed) { pos.set(p.info.id, [left + p.depth * (right - left), top + p.breadth * height]); }
  }
  const links: SceneNode[] = [];
  const nodes: SceneNode[] = [];
  const points: MarkDatum[] = [];
  depths.clear();
  const polar = (a: number, radius: number): readonly [number, number] => [cx + Math.sin(a) * radius, cy - Math.cos(a) * radius];
  for (const p of placed) {
    const { info } = p;
    const [x, y] = pos.get(info.id) ?? [0, 0];
    depths.set(nodeKey(info), info.depth);
    if (info.parent !== null) {
      const [px, py] = pos.get(info.parent.id) ?? [x, y];
      let path: string;
      if (r.layout === "radial") {
        const pr = Math.hypot(px - cx, py - cy);
        const nr = Math.hypot(x - cx, y - cy);
        const mid = (pr + nr) / 2;
        const [c1x, c1y] = polar(angle.get(info.parent.id) ?? 0, mid);
        const [c2x, c2y] = polar(angle.get(info.id) ?? 0, mid);
        path = `M${px},${py}C${c1x},${c1y} ${c2x},${c2y} ${x},${y}`;
      } else if (r.layout === "vertical") {
        path = `M${px},${py}C${px},${(py + y) / 2} ${x},${(py + y) / 2} ${x},${y}`;
      } else {
        path = `M${px},${py}C${(px + x) / 2},${py} ${(px + x) / 2},${y} ${x},${y}`;
      }
      links.push({ className: "bkm-mc-item bkm-tr-link", key: linkKey(info), kind: "polyline", path, points: [[px, py], [x, y]], style: { stroke: tint(info.color, 55), strokeWidth: 1.5 } });
      depths.set(linkKey(info), info.depth);
    }
    const leaf = isLeaf(p);
    const size = r.nodeSize;
    let labelBox: readonly [number, number, number, number] | null = null;
    const fill = info.parent === null ? "var(--chart-foreground)" : leaf ? info.color : "var(--chart-background)";
    const children: SceneNode[] = [{
      className: "bkm-tr-dot", key: `${nodeKey(info)}:dot`, kind: "dot", radius: p.collapsed ? size + 1.5 : size, x, y,
      style: { fill, stroke: info.parent === null ? "var(--chart-background)" : info.color, strokeWidth: leaf && !p.collapsed ? 0 : 2 },
    }];
    if (r.labels !== null) {
      const text = labelOf(p);
      let anchor: "start" | "middle" | "end";
      let lx: number;
      let ly: number;
      let rotate: number | undefined;
      if (r.layout === "radial") {
        const a = angle.get(info.id) ?? 0;
        if (info.parent === null) {
          anchor = "middle";
          lx = x;
          ly = y - size - 9;
        } else if (leaf) {
          // A leaf's name runs outward along its spoke, flipped on the left half to read left to right.
          const flip = a > Math.PI;
          [lx, ly] = polar(a, Math.hypot(x - cx, y - cy) + size + LABEL_GAP);
          anchor = flip ? "end" : "start";
          rotate = ((a * 180) / Math.PI) - 90 + (flip ? 180 : 0);
        } else {
          // A branch's name sits level, just outside its node.
          anchor = "middle";
          [lx, ly] = polar(a, Math.hypot(x - cx, y - cy) + size + LABEL_SIZE);
        }
      } else if (r.layout === "vertical") {
        anchor = "middle";
        lx = x;
        ly = leaf ? y + size + LABEL_SIZE : y - size - 8;
      } else {
        anchor = leaf ? "start" : "end";
        lx = leaf ? x + size + LABEL_GAP : x - size - LABEL_GAP;
        ly = y + 1;
      }
      children.push({
        anchor, baseline: "middle", className: "bkm-tr-label", fontSize: LABEL_SIZE, fontWeight: leaf ? 400 : 500, key: `${nodeKey(info)}:label`, kind: "label",
        ...(rotate === undefined ? {} : { rotate }), style: { fill: leaf ? "var(--chart-tooltip-foreground)" : "var(--chart-label)", stroke: "var(--chart-background)", strokeWidth: 3 }, text, x: lx, y: ly,
      });
      const width = widths.get(info.id) ?? 0;
      if (rotate === undefined) {
        const x0 = anchor === "start" ? lx : anchor === "end" ? lx - width : lx - width / 2;
        labelBox = [x0 - 2, ly - LABEL_SIZE / 2 - 3, x0 + width + 2, ly + LABEL_SIZE / 2 + 3];
      }
    }
    nodes.push({ children, className: "bkm-mc-item bkm-tr-node", key: nodeKey(info), kind: "group" });
    const reach = Math.max(12, size + 7);
    const lineage: string[] = [];
    for (let up: Info | null = info; up !== null; up = up.parent) {
      if (up !== info) { lineage.push(nodeKey(up)); }
      if (up.parent !== null) { lineage.push(linkKey(up)); }
    }
    points.push({ color: info.color, hit: { kind: "rects", rects: [[x - reach, y - reach, x + reach, y + reach], ...(labelBox === null ? [] : [labelBox])] }, index: points.length, item: nodeKey(info), label: info.node.name, related: lineage, row: pointOf(p), x, y });
  }
  return { nodes: [...links, ...nodes], points };
}

const NO_COLLAPSED: readonly string[] = [];
const NONE_COLLAPSED: ReadonlySet<string> = /* @__PURE__ */ new Set();

/** The skeleton's tree without data: a root, three branches, eight leaves. */
const SKELETON_TREE: TreeNode = {
  children: [
    { children: [{ name: "a1" }, { name: "a2" }, { name: "a3" }], name: "a" },
    { children: [{ name: "b1" }, { name: "b2" }], name: "b" },
    { children: [{ name: "c1" }, { name: "c2" }, { name: "c3" }], name: "c" },
  ],
  name: "",
};

/** The loading skeleton: the tree's nodes as dots and its links as curves, placed as the chart places them (`layout`, `variant`), with
 * room and stubs for the names when the chart shows them. */
const treeSkeleton = (r: Resolved, fallback: () => Info, frame: MarkFrame): SceneNode[] => {
  const root = r.root.children.length > 0 ? r.root : fallback();
  const placed = place(root, root === r.root ? r.collapsed : NONE_COLLAPSED, r.variant);
  const labelled = r.labels !== null;
  const isLeaf = (p: Placed): boolean => p.info.children.length === 0 || p.collapsed;
  const pos = new Map<string, readonly [number, number]>();
  const angle = new Map<string, number>();
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const polar = (a: number, radius: number): readonly [number, number] => [cx + Math.sin(a) * radius, cy - Math.cos(a) * radius];
  let ring = 0;
  if (r.layout === "radial") {
    ring = Math.max(10, Math.min(frame.width, frame.height) / 2 - (labelled ? Math.min(64, Math.min(frame.width, frame.height) * 0.3) : PAD));
    const leaves = placed.filter(isLeaf).length;
    const sweep = Math.PI * 2 * (leaves > 1 ? (leaves - 1) / leaves : 1);
    for (const p of placed) {
      angle.set(p.info.id, p.breadth * sweep);
      pos.set(p.info.id, polar(p.breadth * sweep, ring * p.depth));
    }
  } else if (r.layout === "vertical") {
    const top = frame.y + PAD + (labelled ? LABEL_SIZE + 4 : 0);
    const bottom = frame.y + frame.height - PAD - (labelled ? LABEL_SIZE + 6 : 0);
    const left = frame.x + PAD + (labelled ? Math.min(28, frame.width * 0.1) : 0);
    const width = Math.max(0, frame.width - 2 * (left - frame.x));
    for (const p of placed) { pos.set(p.info.id, [left + p.breadth * width, top + p.depth * (bottom - top)]); }
  } else {
    const left = frame.x + PAD + (labelled ? 44 + LABEL_GAP : 0);
    const right = frame.x + frame.width - PAD - (labelled ? Math.min(84 + LABEL_GAP, frame.width * 0.35) : 0);
    const top = frame.y + PAD;
    const height = Math.max(0, frame.height - 2 * PAD);
    for (const p of placed) { pos.set(p.info.id, [left + p.depth * (right - left), top + p.breadth * height]); }
  }
  const links: SceneNode[] = [];
  const dots: SceneNode[] = [];
  placed.forEach((p, index) => {
    const { info } = p;
    const [x, y] = pos.get(info.id) ?? [cx, cy];
    if (info.parent !== null) {
      const [px, py] = pos.get(info.parent.id) ?? [x, y];
      let path: string;
      if (r.layout === "radial") {
        const mid = (Math.hypot(px - cx, py - cy) + Math.hypot(x - cx, y - cy)) / 2;
        const [c1x, c1y] = polar(angle.get(info.parent.id) ?? 0, mid);
        const [c2x, c2y] = polar(angle.get(info.id) ?? 0, mid);
        path = `M${px},${py}C${c1x},${c1y} ${c2x},${c2y} ${x},${y}`;
      } else if (r.layout === "vertical") {
        path = `M${px},${py}C${px},${(py + y) / 2} ${x},${(py + y) / 2} ${x},${y}`;
      } else {
        path = `M${px},${py}C${(px + x) / 2},${py} ${(px + x) / 2},${y} ${x},${y}`;
      }
      links.push(boneLink(`tr:l:${index}`, path, [[px, py], [x, y]]));
    }
    const size = info.parent === null ? r.nodeSize + 1.5 : r.nodeSize + 0.5;
    dots.push(boneDot(`tr:n:${index}`, x, y, size));
    if (!labelled) { return; }
    const width = (isLeaf(p) ? 34 : 26) + boneShare(index, 37) * 26;
    if (r.layout === "radial") {
      if (info.parent !== null) {
        const [lx, ly] = polar(angle.get(info.id) ?? 0, Math.hypot(x - cx, y - cy) + size + (isLeaf(p) ? 14 : LABEL_SIZE));
        dots.push(boneLabel(`tr:t:${index}`, lx, ly, isLeaf(p) ? width * 0.6 : width * 0.5));
      }
    } else if (r.layout === "vertical") {
      dots.push(boneLabel(`tr:t:${index}`, x, isLeaf(p) ? y + size + LABEL_SIZE : y - size - 8, Math.min(width, 40)));
    } else {
      dots.push(boneLabel(`tr:t:${index}`, isLeaf(p) ? x + size + LABEL_GAP : x - size - LABEL_GAP, y + 1, width, isLeaf(p) ? "start" : "end"));
    }
  });
  return [...links, ...dots];
};

/** The tree family: one builder per chart. */
export const TREE_FAMILY: MarkChartFamily<TreeChartProps> = {
  chart: "tree",
  props: {
    booleans: ["collapsible", "animate"],
    names: ["data", "status", "loadingLabel", "variant", "layout", "collapsible", "defaultCollapsed", "nodeSize", "colors", "formatValue", "valueLabel", "aspectRatio", "height", "animate", "ariaLabel", "ariaDescription"],
  },
  placeholder: { ariaLabel: "Tree chart", data: { name: "" } },
  createBuilder: () => {
    const indexCell = memoCell<Map<string, Info>>();
    // The skeleton's tree without data, indexed once, on the first loading draw that needs it.
    let fallback: Info | undefined;
    const skeletonRoot = (): Info => {
      fallback ??= indexTree(SKELETON_TREE, undefined).get("") as Info;
      return fallback;
    };
    const collapsedCell = memoCell<ReadonlySet<string>>();
    const buildCell = memoCell<MarkChartBuild>();
    return ({ props, table, state, setState }) => {
      const infos = indexCell([props.data, props.colors], () => indexTree(props.data, props.colors));
      const root = infos.get("") as Info;
      const list = (state.collapsed as readonly string[] | undefined) ?? props.defaultCollapsed ?? NO_COLLAPSED;
      const collapsed = collapsedCell([list], () => new Set(list));
      const labels = propsFor<TreeLabelsProps>(table, TREE_ROLES.labels).at(-1) ?? null;
      const collapsible = props.collapsible !== false;
      const animate = props.animate !== false;
      return buildCell([infos, collapsed, labels, props.variant, props.layout, collapsible, props.nodeSize, props.formatValue, props.valueLabel, props.aspectRatio, props.height, animate, props.ariaLabel, props.ariaDescription], () => {
        const layout = props.layout ?? "horizontal";
        const format = props.formatValue ?? intFmt;
        const resolved: Resolved = { collapsed, format, labels, layout, nodeSize: Math.max(1, props.nodeSize ?? 4.5), root, variant: props.variant ?? "tidy" };
        const depths = new Map<string, number>();
        const enter = (key: string, element: Element): MarkEnter | undefined => {
          const owner = key.replace(/:(dot|label)$/u, "");
          const depth = depths.get(owner);
          if (depth === undefined) { return undefined; }
          if (key.startsWith("tr:l:")) { return drawIn(element, (depth - 1) * DEPTH_STAGGER_MS, 520); }
          if (key.endsWith(":dot")) { return popIn(depth * DEPTH_STAGGER_MS, 0); }
          if (key.endsWith(":label")) { return fadeIn(depth * DEPTH_STAGGER_MS + 120, 380); }
          return undefined;
        };
        const tooltip = (datum: MarkDatum): ChartTooltipContent => {
          const point = datum.row as TreePoint;
          const rows = [{ color: point.color, label: props.valueLabel ?? "Value", value: format(point.value) }];
          if (point.children > 0) {
            rows.push({ color: "", label: point.collapsed ? "Folded" : "Children", value: point.collapsed ? `${point.descendants} nodes` : String(point.children) });
          }
          return { rows, title: point.path.length === 0 ? point.name : point.path.join(" / ") };
        };
        const select = (datum: MarkDatum | null): void => {
          if (!collapsible || datum === null) { return; }
          const point = datum.row as TreePoint;
          if (point.children === 0 || point.depth === 0) { return; }
          const id = point.path.join("/");
          const next: MarkState = { collapsed: collapsed.has(id) ? [...collapsed].filter((other) => other !== id) : [...collapsed, id] };
          setState(next);
        };
        return {
          ariaDescription: props.ariaDescription,
          describe: () => describeHierarchy({ kind: "Tree", root: props.data, includeRoot: true, name: (n: TreeNode) => n.name, children: (n: TreeNode) => n.children, ...(hasValues(props.data) ? { value: (n: TreeNode) => n.value ?? null, valueLabel: props.valueLabel, format } : {}) }),
          ariaLabel: props.ariaLabel ?? `Tree of ${root.node.name}`,
          ...(props.height === undefined ? { aspectRatio: parseAspectRatio(props.aspectRatio ?? (layout === "radial" ? "1 / 1" : "16 / 9")) } : { height: props.height }),
          ...(layout === "horizontal" && labels !== null ? { minHeight: leafLabelsHeight(resolved) } : {}),
          ...(animate ? { enter } : {}),
          glide: true,
          layout: (frame) => layoutTree(resolved, frame, depths),
          select,
          selectable: collapsible,
          skeleton: (frame) => treeSkeleton(resolved, skeletonRoot, frame),
          tooltip,
        };
      });
    };
  },
};
