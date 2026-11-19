import { fitSectorPush } from "./push";
import type { SectorExtent, SectorPush } from "./push";
import { erase } from "../erased-types";
import { joinClasses } from "../cn";
import { TAU } from "../polar/tau";
import { sunburst } from "@tanstack/charts/hierarchy/sunburst";
import type { SunburstNode as NativeNode, SunburstParentOptions } from "@tanstack/charts/hierarchy/sunburst";
import type { PolarMark, PolarLayoutContext } from "@tanstack/charts/polar";
import type { ChartPoint, SceneArea, SceneLabel, SceneNode } from "@tanstack/charts";
import { collapsedArc } from "./geometry";
import type { ArcValues } from "./geometry";
import { LABEL_BOX_CLASS } from "./sunburst-layer";
import type { SectorFeed } from "./sunburst-layer";

export interface SunburstRowShape {
  readonly id: string;
  readonly parentId: string | null;
  readonly value: number;
}

export type SunburstNativeNode = NativeNode<SunburstRowShape>;

type Rank = readonly [number, number];

interface TrailEntry {
  readonly area: SceneArea;
  readonly rank: Rank;
  readonly arc: ArcValues;
  readonly ghost: boolean;
  readonly label?: SceneLabel;
}

export type SectorTrail = Map<string, TrailEntry>;

interface SunburstLabelStyle {
  readonly fontSize: number;
  readonly fill: string;
  readonly fontWeight: number;
  /** Halo color and width; painted behind the glyphs through `.bk-sunburst-label` (paint-order: stroke). */
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly nameOf: (node: SunburstNativeNode) => string;
  /** Extra class per label; the chart addresses labels by it from a scoped hover rule. */
  readonly classOf?: (node: SunburstNativeNode) => string;
  /** The reader's class on the group holding the labels. */
  readonly className?: string | undefined;
}

export interface SunburstDecorations {
  /** Pop-out distance in px for the focused sector; 0 disables the overlay layer. */
  readonly popOut: number;
  /** Receives point identity by node id on every render so a controlled hover can address a sector. */
  readonly registry?: Map<string, ChartPoint<SunburstNativeNode, number, number>>;
  /** Receives each sector's radial-push fit by node id on every render (see push.ts); the hover effect turns it into CSS vars. */
  readonly pushes?: Map<string, SectorPush>;
  /** Arc index the fixed push rules address (`bk-sb-a<i>` on sectors, `bk-sb-p<i>` on their overlays). */
  readonly arcIndexOf?: (node: SunburstNativeNode) => number | undefined;
  /** A pattern or gradient sector's `fill-opacity` (its depth fade, which a colour carries in its fill); undefined for none. */
  readonly fillOpacityOf?: (node: SunburstNativeNode) => number | undefined;
  /** Ring depth from the data root (bklit's `arc.depth`). The native node's `ancestorIds` restart at `rootId`, so ranking by them
   * re-orders the sectors on every zoom; see the sort below. */
  readonly depthOf?: (node: SunburstNativeNode) => number | undefined;
  /** Label style; omit to render no labels. */
  readonly labels?: SunburstLabelStyle;
  /** Sectors of the previous render by key, so a zoom can collapse the ones that leave (owned by the chart, survives definition rebuilds). */
  readonly trail?: SectorTrail;
  /** The chart's own geometry of a sector in the current layout: partition share, ring and radii (geometry.ts `sectorArc`). */
  readonly arcOf: (node: SunburstNativeNode, layout: Readonly<PolarLayoutContext>) => ArcValues | undefined;
  /** Intro delay (ms) of a sector's enter sweep. */
  readonly delayOf: (node: SunburstNativeNode) => number;
  /** What the sector layer paints and tweens (see SectorFeed). */
  readonly feed: SectorFeed;
  /** Id of the view's root; a change makes the layer tween the geometry (a zoom). */
  readonly view: string;
  readonly sweepMs: number;
  readonly sweepEase: (t: number) => number;
}

const HALF_TURN = Math.PI;

const wrapDelta = (delta: number): number => {
  let d = delta;
  while (d > HALF_TURN) {
    d -= TAU;
  }
  while (d < -HALF_TURN) {
    d += TAU;
  }
  return d;
};

// bklit's exiting sector collapses to a point while the zoom tween runs; the sector stays one more render as a keyed, non-interactive
// area whose published geometry is that point, so the layer shrinks it. Keeps its arc classes (push and emphasis rules still reach it); only the pointer cursor goes.
const ghostOf = (area: Readonly<SceneArea>): SceneArea => {
  const kept = area.className?.split(" ").filter((name) => name !== "bk-sunburst-branch").join(" ");
  return { ...area, className: kept === "" ? undefined : kept, pointOwner: undefined };
};

const isArea = (node: SceneNode): node is SceneArea => node.kind === "area";

const labelText = (area: Readonly<SceneArea>, node: SunburstNativeNode, style: SunburstLabelStyle): SceneLabel => ({
  anchor: "middle",
  baseline: "middle",
  fontSize: style.fontSize,
  fontWeight: style.fontWeight,
  key: `${area.key}:label`,
  kind: "label",
  className: `bk-sunburst-label ${style.classOf?.(node) ?? ""}`.trim(),
  style: { fill: style.fill, stroke: style.strokeWidth > 0 ? style.stroke : undefined, strokeWidth: style.strokeWidth > 0 ? style.strokeWidth : undefined },
  text: style.nameOf(node),
  x: 0,
  y: 0,
});

// The label's box: a group whose opacity the layer steps at bklit's fit rule; the text inside is posed by the layer from the same geometry.
const labelBox = (text: SceneLabel): SceneNode => ({ ariaHidden: true, children: [text], className: LABEL_BOX_CLASS, key: `${text.key}-box`, kind: "group" });

// Every sector's point owner carries a SunburstNativeNode datum.
const nativeNodeOf = (area: Readonly<SceneArea>): SunburstNativeNode | undefined => erase(area.pointOwner?.datum);

const depthOf = (area: Readonly<SceneArea>): number => nativeNodeOf(area)?.ancestorIds.length ?? 0;

// A sector's radial and angular extent around its mid angle.
const radialExtent = (area: Readonly<SceneArea>, mid: number): SectorExtent => {
  let minR = Number.POSITIVE_INFINITY;
  let maxR = 0;
  let minD = Number.POSITIVE_INFINITY;
  let maxD = Number.NEGATIVE_INFINITY;
  for (const [x, y] of area.points) {
    const r = Math.hypot(x, y);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
    if (r > 0) {
      const d = wrapDelta(Math.atan2(x, -y) - mid);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
    }
  }
  return { maxD, maxR, minD, minR };
};

// The overlay is the sector itself under its own key, hidden until its node is on the hovered path; the layer gives it the sector's geometry, so it morphs with the sector under it
// (bklit's popped segment is its morphing geometry grown, sunburst-segment.tsx:58-69). Grow and ancestors' push are CSS transforms from host vars (push.ts).
const popFor = (sector: Readonly<SceneArea>, point: Readonly<ChartPoint<SunburstNativeNode, number, number>> | undefined, className: string | undefined): SceneArea => ({
  ...sector,
  ariaHidden: true,
  className,
  key: `${sector.key}:pop`,
  pointOwner: point,
  style: { ...sector.style, opacity: 0 },
});

type SunburstPoint = ChartPoint<SunburstNativeNode, number, number>;
type SceneGroup = Extract<SceneNode, { readonly kind: "group" }>;

interface GroupBuild {
  readonly areas: SceneArea[];
  readonly pops: SceneArea[];
  readonly labels: [rank: Rank, box: SceneNode][];
  readonly entries: Map<string, Omit<TrailEntry, "ghost">>;
  /** Paint rank of each sector: bklit's `sortSunburstSegments` draws deeper rings first, later arcs first within a ring (inner rings last). */
  readonly rank: Map<SceneArea, Rank>;
  readonly layout: Readonly<PolarLayoutContext>;
}

const sectorClassName = (point: SunburstPoint, arcIndex: number | undefined): string | undefined => {
  const arcClass = arcIndex === undefined ? undefined : `bk-sb-a${arcIndex}`;
  return joinClasses(point.datum.external ? undefined : "bk-sunburst-branch", arcClass) || undefined;
};

/** Publishes the geometry the layer paints for the sector under `keys` (its overlay, label and label box share it). */
const publish = (decorations: Readonly<SunburstDecorations>, keys: readonly (string | undefined)[], arc: ArcValues, delayMs: number): void => {
  for (const key of keys) {
    if (key !== undefined) {
      decorations.feed.geometry.set(key, { arc, delayMs });
    }
  }
};

const addSector = (build: GroupBuild, child: Readonly<SceneArea>, point: SunburstPoint, decorations: Readonly<SunburstDecorations>): void => {
  const arc = decorations.arcOf(point.datum, build.layout);
  if (arc === undefined) {
    return;
  }
  decorations.registry?.set(point.datum.id, point);
  const arcIndex = decorations.arcIndexOf?.(point.datum);
  const fillOpacity = decorations.fillOpacityOf?.(point.datum);
  const sector: SceneArea = { ...child, className: sectorClassName(point, arcIndex), ...(fillOpacity === undefined ? undefined : { style: { ...child.style, fillOpacity } }) };
  const sectorRank: Rank = [decorations.depthOf?.(point.datum) ?? point.datum.ancestorIds.length, arcIndex ?? build.areas.length + 1];
  build.rank.set(sector, sectorRank);
  build.areas.push(sector);
  decorations.pushes?.set(point.datum.id, fitSectorPush(radialExtent(child, point.xValue), point.xValue, point.xValue));
  const delayMs = decorations.delayOf(point.datum);
  const popKey = decorations.popOut > 0 ? `${sector.key}:pop` : undefined;
  if (popKey !== undefined) {
    // The overlay is the sector itself at rest; the hover grow and ancestor push are CSS transforms (push.ts).
    build.pops.push(popFor(sector, point, arcIndex === undefined ? undefined : `bk-sb-p${arcIndex}`));
  }
  publish(decorations, [sector.key, popKey], arc, delayMs);
  const label = decorations.labels === undefined ? undefined : labelText(child, point.datum, decorations.labels);
  if (label !== undefined) {
    const box = labelBox(label);
    publish(decorations, [label.key, box.key], arc, 0);
    build.labels.push([sectorRank, box]);
  }
  build.entries.set(sector.key, { arc, area: sector, label, rank: sectorRank });
};

const addGhost = (build: GroupBuild, trail: SectorTrail, [key, previous]: readonly [string, TrailEntry], decorations: Readonly<SunburstDecorations>): void => {
  const ghost = ghostOf(previous.area);
  const arc = previous.ghost ? previous.arc : collapsedArc(previous.arc);
  build.rank.set(ghost, previous.rank);
  build.areas.push(ghost);
  // Its label rides the collapse too and hides where bklit's would (the fit rule on the shrinking arc).
  const box = previous.label === undefined ? undefined : labelBox(previous.label);
  // Its overlay collapses with it under the same key, so a zoom that brings the sector back grows the overlay from the
  // point too instead of entering it at its final shape.
  const arcIndex = /(?:^| )bk-sb-a(\d+)(?: |$)/u.exec(ghost.className ?? "")?.[1];
  const popKey = decorations.popOut > 0 && arcIndex !== undefined ? `${ghost.key}:pop` : undefined;
  if (popKey !== undefined) {
    build.pops.push(popFor(ghost, undefined, `bk-sb-p${arcIndex}`));
  }
  publish(decorations, [ghost.key, popKey, previous.label?.key, box?.key], arc, 0);
  trail.set(key, { arc, area: ghost, ghost: true, label: previous.label, rank: previous.rank });
  if (box !== undefined) {
    build.labels.push([previous.rank, box]);
  }
};

// Sectors that left stay as collapsed, non-interactive areas (kept across renders, so the collapse is not cut short by the
// native exit fade); a later zoom that brings one back finds its element and grows it from the point.
const keepTrail = (build: GroupBuild, trail: SectorTrail, decorations: Readonly<SunburstDecorations>): void => {
  const live = new Set(build.areas.map((area) => area.key));
  const gone = [...trail].filter(([key]) => !live.has(key));
  trail.clear();
  for (const [key, entry] of build.entries) {
    trail.set(key, { ...entry, ghost: false });
  }
  for (const entry of gone) {
    addGhost(build, trail, entry, decorations);
  }
};

const paintOrder = ([depthA, indexA]: Rank, [depthB, indexB]: Rank): number => (depthA === depthB ? indexB - indexA : depthB - depthA);

const layers = (node: SceneGroup, { areas, pops, labels, rank }: GroupBuild, labelsClass: string | undefined): SceneNode[] => {
  pops.sort((a, b) => depthOf(a) - depthOf(b));
  // The order must not depend on the zoom: the layer keeps one element per key, and a node detached and re-attached
  // in one task starts no CSS transition, so a re-ordered dimmed sector would snap to full opacity. Absolute depth + bklit arc index (ghosts keep their last rank) is the same in every view.
  areas.sort((a, b) => paintOrder(rank.get(a) ?? [0, 0], rank.get(b) ?? [0, 0]));
  const out: SceneNode[] = [{ ...node, children: areas }];
  // Labels paint above the pop-out overlay (bklit draws labels last); unrelated labels hide through the host's CSS rules.
  // Same zoom-independent order as the sectors (see above), so no label box is re-inserted mid-zoom.
  labels.sort(([rankA], [rankB]) => paintOrder(rankA, rankB));
  if (pops.length > 0) {
    out.push({ ariaHidden: true, children: pops, className: "bk-sb-pops", key: `${node.key}:pop`, kind: "group", renderer: node.renderer });
  }
  if (labels.length > 0) {
    out.push({ ariaHidden: true, children: labels.map(([, box]) => box), className: labelsClass, key: `${node.key}:labels`, kind: "group", renderer: node.renderer });
  }
  return out;
};

const decorateGroup = (node: SceneGroup, pointByKey: ReadonlyMap<string, SunburstPoint>, layout: Readonly<PolarLayoutContext>, decorations: Readonly<SunburstDecorations>): SceneNode[] => {
  const build: GroupBuild = { areas: [], entries: new Map(), labels: [], layout, pops: [], rank: new Map() };
  for (const child of node.children) {
    const point = isArea(child) ? pointByKey.get(child.key) : undefined;
    if (point !== undefined && isArea(child)) {
      addSector(build, child, point, decorations);
    }
  }
  if (decorations.trail !== undefined) {
    keepTrail(build, decorations.trail, decorations);
  }
  return layers(node, build, decorations.labels?.className);
};

export const nativeSunburst = (
  rows: readonly SunburstRowShape[],
  options: SunburstParentOptions<SunburstRowShape>,
  decorations: Readonly<SunburstDecorations>,
  renderer: Parameters<typeof sunburst>[1]["renderer"],
): PolarMark<SunburstNativeNode, number, number, never, never> => {
  const base = sunburst(rows, { ...options, renderer });
  return {
    ...base,
    initialize: (context) => {
      const initialized = base.initialize(context);
      return {
        ...initialized,
        render: (renderContext) => {
          const scene = initialized.render(renderContext);
          decorations.pushes?.clear();
          decorations.feed.geometry.clear();
          decorations.feed.view = decorations.view;
          decorations.feed.sweepMs = decorations.sweepMs;
          decorations.feed.sweepEase = decorations.sweepEase;
          const pointByKey = new Map((scene.points ?? []).map((point) => [point.key, point]));
          const nodes = scene.nodes.flatMap((node): SceneNode[] => (node.kind === "group" ? decorateGroup(node, pointByKey, renderContext.layout, decorations) : [node]));
          return { ...scene, nodes };
        },
      };
    },
  };
};
