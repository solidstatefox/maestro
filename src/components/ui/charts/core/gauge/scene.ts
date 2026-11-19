import { el } from "../markup/node";
import type { MarkupAttrs, MarkupChild, MarkupNode } from "../markup/node";
import type { StyleObject } from "../style";
import type {
  GaugeArcStyle,
  GaugeCenterDiscOptions,
  GaugeDotsOptions,
  GaugeGlowOptions,
  GaugeNeedleOptions,
  GaugeNeedleVariant,
  GaugeProgressRingOptions,
  GaugeRulerOptions,
  GaugeSectorOptions,
  GaugeZone,
  GaugeZoneDisplay,
} from "../types/gauge";
import { THEME_GRADIENT, nonEmpty, notchFills, TRACK_FILL, usesThemeGradient } from "./fills";
import type { FillOptions } from "./fills";
import { annularSectorPath, arcLayout, arcNotchPoints, arcStrokePath, clamp01, linearNotchPoints, notchPath, polar, r3, rulerFontSize, rulerLabelsOf, ZONE_BAND_WIDTH, zoneColorAt } from "./geometry";
import type { ArcLayout, NotchPoints } from "./geometry";
import { fitSectorToDisc } from "./options";

/** Everything the drawing needs but its size and progress (model.ts builds it from the props). */
export interface GaugeSpec {
  readonly linear: boolean;
  readonly total: number;
  readonly spacing: number;
  readonly cornerRadius: number;
  readonly uniformWidth: boolean;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly notchLengthPercent: number;
  readonly notchWidthPercent: number;
  readonly fills: FillOptions;
  readonly inactiveOpacity: number;
  readonly activeOpacity: number;
  readonly arcStyle: GaugeArcStyle;
  readonly arcThickness: number;
  readonly ruler: GaugeRulerOptions | null;
  readonly needle: GaugeNeedleOptions | null;
  readonly ring: GaugeProgressRingOptions | null;
  readonly dots: GaugeDotsOptions | null;
  readonly glow: GaugeGlowOptions | null;
  readonly disc: GaugeCenterDiscOptions | null;
  readonly sector: GaugeSectorOptions | null;
  readonly zones: readonly GaugeZone[] | undefined;
  readonly zoneDisplay: GaugeZoneDisplay;
  /** The mount's id: the defs' ids start with it. */
  readonly idPrefix: string;
}

/** The svg's accessible name and description (they follow the value, so they are not part of the spec: a new value redraws nothing). */
export interface GaugeAria {
  readonly label: string;
  readonly description: string | undefined;
}

/** One animated attribute: `name` (an attribute, or a `--` property on the node's style) is `at(fill, value)`. */
export interface ScenePart {
  readonly node: MarkupNode;
  readonly name: string;
  readonly at: (fill: number, value: number) => string;
}

export interface GaugeScene {
  readonly svg: MarkupNode;
  /** The conic sector's layer, drawn behind the svg; null without a conic sector. */
  readonly conic: MarkupNode | null;
  /** The groups that fade in on mount (the track notches and the overlay). */
  readonly fade: readonly MarkupNode[];
  readonly parts: readonly ScenePart[];
}

/** The notch count the fill lights at `value` (notch tracks only; the other layers ride `value`). */
export const activeNotchCount = (spec: Pick<GaugeSpec, "linear" | "arcStyle" | "total">, value: number): number =>
  (spec.linear || spec.arcStyle === "notches" ? Math.round((value / 100) * spec.total) : 0);

const op = (v: number): string => String(Math.round(v * 10_000) / 10_000);

const NEEDLE_WIDTH: Readonly<Record<GaugeNeedleVariant, number>> = { gradient: 4, line: 2.5, polygon: 8, triangle: 10 };
const RULER_OPACITY = { majorDim: 0.32, majorLit: 0.95, minorDim: 0.16, minorLit: 0.55 } as const;

/** Builds a scene, its parts collected as the nodes are made (each node starts at the progress it is built at). */
class Builder {
  readonly parts: ScenePart[] = [];
  readonly defs: MarkupChild[] = [];
  private readonly fill0: number;
  private readonly value0: number;
  // Fields assigned by hand, not parameter properties: a project's `erasableSyntaxOnly` (Vite's template) refuses those.
  constructor(fill0: number, value0: number) {
    this.fill0 = fill0;
    this.value0 = value0;
  }
  /** A node whose `name` attribute animates. */
  anim(tag: string, attrs: MarkupAttrs, name: string, at: ScenePart["at"], children: readonly MarkupChild[] = []): MarkupNode {
    const node = el(tag, { ...attrs, [name]: at(this.fill0, this.value0) }, children);
    this.parts.push({ at, name, node });
    return node;
  }
}

const glowFilter = (id: string, o: GaugeGlowOptions): MarkupNode =>
  el("filter", { height: "200%", id, width: "200%", x: "-50%", y: "-50%" }, [
    el("feGaussianBlur", { in: "SourceGraphic", result: "blur", stdDeviation: o.blur ?? 6 }),
    el("feComponentTransfer", { in: "blur", result: "glow" }, [el("feFuncA", { slope: o.intensity ?? 0.8, type: "linear" })]),
    el("feMerge", {}, [el("feMergeNode", { in: "glow" }), el("feMergeNode", { in: "SourceGraphic" })]),
  ]);

const linearGradient = (id: string, attrs: MarkupAttrs, stops: readonly (readonly [string, string, number?])[]): MarkupNode =>
  el("linearGradient", { id, ...attrs }, stops.map(([offset, color, opacity]) => el("stop", { offset, "stop-color": color, "stop-opacity": opacity })));

const url = (id: string): string => `url(#${id})`;

/** The track notches (fading in) and the lit ones, each lit notch's opacity `clamp01(fill - index)` of the active opacity. */
const notches = (b: Builder, spec: GaugeSpec, points: readonly NotchPoints[], cornerDepth: number, activeFill: (index: number) => string, filter: string | undefined): { bg: MarkupNode; lit: MarkupNode } => {
  const paths = points.map((p) => notchPath(p, spec.cornerRadius, cornerDepth));
  const bg = el("g", {}, paths.map((d, i) => el("path", { d, fill: notchFills(i, spec.fills).track, "fill-opacity": spec.inactiveOpacity })));
  const lit = el("g", { filter }, paths.map((d, i) => b.anim("path", { d, fill: activeFill(i) }, "fill-opacity", (fill) => op(clamp01(fill - i) * spec.activeOpacity))));
  return { bg, lit };
};

interface Arc {
  readonly cx: number;
  readonly cy: number;
  readonly size: number;
  readonly a0: number;
  readonly a1: number;
  readonly layout: ArcLayout;
  /** The angle the value progress `v` points at. */
  readonly at: (v: number) => number;
}

const sectorSvg = (b: Builder, arc: Arc, o: GaugeSectorOptions, id: string): MarkupNode => {
  const color = o.color ?? "var(--chart-1)";
  const opacity = o.opacity ?? 0.85;
  const radius = arc.layout.outerRadius;
  const r0 = radius * clamp01(o.innerRadius ?? 0);
  const radial = o.gradient === "radial";
  if (radial) {
    b.defs.push(el("radialGradient", { cx: r3(arc.cx), cy: r3(arc.cy), gradientUnits: "userSpaceOnUse", id, r: r3(radius) }, [
      el("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0 }),
      el("stop", { offset: `${Math.round((r0 / radius) * 100)}%`, "stop-color": color, "stop-opacity": 0.04 }),
      el("stop", { offset: "100%", "stop-color": color, "stop-opacity": opacity }),
    ]));
  }
  return b.anim("path", { fill: radial ? url(id) : color, "fill-opacity": radial ? 1 : opacity }, "d", (_f, v) => annularSectorPath(arc.cx, arc.cy, r0, radius, arc.a0, arc.at(v)));
};

/** The conic sector: SVG has no conic gradient, so it is an HTML layer behind the svg. bklit rewrites its background and clip path every frame;
 * here the clip is the whole sweep (the gradient is transparent past the value) and a frame writes one property, `--bkm-gc` (the lit degrees). */
const conicLayer = (b: Builder, arc: Arc, o: GaugeSectorOptions): MarkupNode => {
  const color = o.color ?? "var(--chart-1)";
  const radius = arc.layout.outerRadius;
  const r0 = radius * clamp01(o.innerRadius ?? 0);
  const clip = annularSectorPath(arc.cx, arc.cy, r0, radius, arc.a0, arc.a1);
  const lit = "calc(var(--bkm-gc,0) * 1deg)";
  const style: StyleObject = {
    background: `conic-gradient(from ${arc.a0 + 90}deg at ${r3(arc.cx)}px ${r3(arc.cy)}px, transparent 0deg, ${color} ${lit}, transparent ${lit})`,
    "clip-path": clip === "" ? "inset(50%)" : `path("${clip}")`,
    inset: 0,
    opacity: o.opacity ?? 0.85,
    "pointer-events": "none",
    position: "absolute",
  };
  const at = (_f: number, v: number): string => String(r3(Math.max((arc.at(v) - arc.a0), 0.01)));
  const node: MarkupNode = { attrs: { "aria-hidden": "true" }, children: [], style: { ...style, "--bkm-gc": at(0, 0) }, tag: "div" };
  b.parts.push({ at, name: "--bkm-gc", node });
  return node;
};

const dotsLayer = (b: Builder, arc: Arc, o: GaugeDotsOptions): MarkupNode => {
  const step = Math.max(4, arc.size * (o.spacing ?? 0.03));
  const sweep = arc.a1 - arc.a0;
  const rings = Math.max(1, Math.round(o.rings ?? 5));
  const dim = o.dimOpacity ?? 0.12;
  const lit = o.litOpacity ?? 0.9;
  const color = o.color ?? "var(--chart-1)";
  const radius = o.radius ?? 1.6;
  const dots: MarkupNode[] = [];
  for (let k = 0; k < rings; k += 1) {
    const r = arc.layout.dotsRadius - k * step;
    if (r <= step) { break; }
    const count = Math.max(2, Math.round((sweep * (Math.PI / 180) * r) / step));
    const weight = o.fadeInward === false ? 1 : 1 - (k / rings) * 0.6;
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const [cx, cy] = polar(arc.cx, arc.cy, r, arc.a0 + t * sweep);
      dots.push(b.anim("circle", { cx, cy, fill: color, r: radius }, "fill-opacity", (_f, v) => op((dim + (lit - dim) * clamp01((v - t) * 60 + 1)) * weight)));
    }
  }
  return el("g", {}, dots);
};

const solidArc = (b: Builder, arc: Arc, spec: GaugeSpec, fill: string, filter: string | undefined): MarkupNode => {
  const { cx, cy, a0, a1, layout } = arc;
  const radius = layout.outerRadius - layout.solidThickness / 2;
  const width = r3(layout.solidThickness);
  const track = nonEmpty(spec.fills.inactiveFill) ? spec.fills.inactiveFill : TRACK_FILL;
  const zones = (layout.zoneFill ?? []).map((z) => {
    const from = clamp01(z.from / 100);
    const to = clamp01(z.to / 100);
    return b.anim("path", { fill: "none", stroke: z.color, "stroke-opacity": spec.activeOpacity, "stroke-width": width }, "d", (_f, v) => {
      const end = Math.min(to, v);
      return end > from ? arcStrokePath(cx, cy, radius, a0 + from * (a1 - a0), a0 + end * (a1 - a0)) : "";
    });
  });
  return el("g", {}, [
    el("path", { d: arcStrokePath(cx, cy, radius, a0, a1), fill: "none", stroke: track, "stroke-linecap": "round", "stroke-opacity": spec.inactiveOpacity, "stroke-width": width }),
    el("g", { filter }, [
      b.anim("path", { fill: "none", stroke: fill, "stroke-linecap": "round", "stroke-opacity": spec.activeOpacity, "stroke-width": width }, "d", (_f, v) => arcStrokePath(cx, cy, radius, a0, arc.at(v))),
      ...zones,
    ]),
  ]);
};

const progressRing = (b: Builder, arc: Arc, o: GaugeProgressRingOptions, filter: string | undefined): MarkupNode => {
  const { cx, cy, a1, layout } = arc;
  const width = r3(Math.max(1, arc.size * (o.width ?? 0.01)));
  return el("g", {}, [
    b.anim("path", { fill: "none", stroke: o.trackColor ?? "var(--muted-foreground)", "stroke-opacity": o.trackOpacity ?? 0.35, "stroke-width": width }, "d", (_f, v) => arcStrokePath(cx, cy, layout.ringRadius, arc.at(v), a1)),
    b.anim("path", { fill: "none", filter, stroke: o.color ?? "var(--chart-1)", "stroke-width": width }, "d", (_f, v) => arcStrokePath(cx, cy, layout.ringRadius, arc.a0, arc.at(v))),
  ]);
};

const zoneBands = (arc: Arc, zones: readonly GaugeZone[]): MarkupNode =>
  el("g", {}, zones.map((z) => el("path", {
    d: arcStrokePath(arc.cx, arc.cy, arc.layout.zoneBandRadius, arc.a0 + clamp01(z.from / 100) * (arc.a1 - arc.a0), arc.a0 + clamp01(z.to / 100) * (arc.a1 - arc.a0)),
    fill: "none",
    stroke: z.color,
    "stroke-opacity": 0.9,
    "stroke-width": r3(arc.size * ZONE_BAND_WIDTH),
  })));

const ruler = (b: Builder, arc: Arc, o: GaugeRulerOptions): MarkupNode => {
  const { cx, cy, size, a0, a1, layout } = arc;
  const outside = o.position === "outside";
  const intervals = Math.max(1, Math.round(o.ticks ?? 50));
  const every = Math.max(1, Math.round(o.majorEvery ?? 5));
  const majorLength = o.majorLength ?? 0.05;
  const minorLength = o.minorLength ?? 0.028;
  const color = o.color ?? "var(--foreground)";
  const highlight = o.highlightActive !== false;
  const dir = outside ? 1 : -1;
  const anchor = outside ? layout.outsideRulerAnchor : layout.innerRadius;
  const rStart = anchor + dir * size * (o.gap ?? 0.028);
  const sweep = a1 - a0;
  const ticks: MarkupNode[] = [];
  for (let j = 0; j <= intervals; j += 1) {
    const major = j % every === 0;
    const angle = a0 + (j / intervals) * sweep;
    const [x1, y1] = polar(cx, cy, rStart, angle);
    const [x2, y2] = polar(cx, cy, rStart + dir * size * (major ? majorLength : minorLength), angle);
    const dim = major ? RULER_OPACITY.majorDim : RULER_OPACITY.minorDim;
    const lit = major ? RULER_OPACITY.majorLit : RULER_OPACITY.minorLit;
    const attrs = { stroke: color, "stroke-linecap": "round", "stroke-width": major ? 1.75 : 1, x1, x2, y1, y2 };
    // Ramps over half an interval so a tick lights as the fill reaches it.
    ticks.push(highlight ? b.anim("line", attrs, "stroke-opacity", (_f, v) => op(dim + (lit - dim) * clamp01((v - j / intervals) * intervals * 2 + 1))) : el("line", { ...attrs, "stroke-opacity": dim }));
  }
  const labels = rulerLabelsOf(o.labels);
  if (labels !== null) {
    const fontSize = r3(rulerFontSize(size));
    const labelRadius = rStart + dir * (size * majorLength + fontSize * (dir > 0 ? 1 : 1.1));
    const min = labels.min ?? 0;
    const max = labels.max ?? 100;
    const format = labels.format ?? ((v: number) => String(Math.round(v * 100) / 100));
    for (let j = 0; j <= intervals; j += 1) {
      const end = j === 0 || j === intervals;
      if (labels.show === "ends" ? end : j % every === 0 || end) {
        const t = j / intervals;
        const [x, y] = polar(cx, cy, labelRadius, a0 + t * sweep);
        ticks.push(el("text", { "dominant-baseline": "central", fill: labels.color ?? "var(--foreground)", "fill-opacity": labels.color === undefined ? 0.72 : 1, "font-size": fontSize, "text-anchor": "middle", x, y }, [format(min + t * (max - min))], { style: { "font-variant-numeric": "tabular-nums" } }));
      }
    }
  }
  return el("g", {}, ticks);
};

const needle = (b: Builder, arc: Arc, o: GaugeNeedleOptions, gradientId: string): MarkupNode => {
  const variant = o.variant ?? "gradient";
  const color = o.color ?? "var(--foreground)";
  const width = o.width ?? NEEDLE_WIDTH[variant];
  const tip = r3(arc.layout.needleReach);
  const base = r3(arc.layout.needleReach * (1 - Math.min(1, Math.max(0.05, o.length ?? 0.55))));
  const half = width / 2;
  let shape: MarkupNode;
  if (variant === "line") {
    // Round caps inside [base, tip], so the tip never overruns.
    shape = el("line", { stroke: color, "stroke-linecap": "round", "stroke-width": width, x1: r3(base + half), x2: r3(tip - half), y1: 0, y2: 0 });
  } else if (variant === "gradient") {
    b.defs.push(linearGradient(gradientId, { gradientUnits: "userSpaceOnUse", x1: base, x2: tip, y1: 0, y2: 0 }, [["0%", color, 0], ["70%", color, 0.7], ["100%", color, 1]]));
    // A tapered body, so the fade reads as light rather than a cut-off stroke.
    shape = el("path", { d: `M${base} ${r3(-half * 0.35)}L${r3(tip - half)} ${r3(-half)}A${r3(half)} ${r3(half)} 0 0 1 ${r3(tip - half)} ${r3(half)}L${base} ${r3(half * 0.35)}Z`, fill: url(gradientId) });
  } else {
    const shoulder = r3(base + (tip - base) * 0.22);
    const points = variant === "triangle" ? `${base},${r3(-half)} ${tip},0 ${base},${r3(half)}` : `${base},0 ${shoulder},${r3(-half)} ${tip},0 ${shoulder},${r3(half)}`;
    shape = el("polygon", { fill: color, points, stroke: color, "stroke-linejoin": "round", "stroke-width": 1.25 });
  }
  const pointer = b.anim("g", {}, "transform", (_f, v) => `translate(${r3(arc.cx)} ${r3(arc.cy)}) rotate(${r3(arc.at(v))})`, [shape]);
  const pivot = o.pivot === true
    ? [el("circle", { cx: r3(arc.cx), cy: r3(arc.cy), fill: color, r: Math.max(4, width * 0.9) }), el("circle", { cx: r3(arc.cx), cy: r3(arc.cy), fill: "var(--background)", r: Math.max(1.5, width * 0.35) })]
    : [];
  return el("g", {}, [pointer, ...pivot]);
};

const disc = (arc: Arc, o: GaugeCenterDiscOptions): MarkupNode =>
  el("circle", { cx: r3(arc.cx), cy: r3(arc.cy), fill: o.fill ?? "var(--background)", r: r3(arc.size * (o.radius ?? 0.19)), stroke: o.stroke ?? "var(--foreground)", "stroke-opacity": o.strokeOpacity ?? 0.75, "stroke-width": o.strokeWidth ?? 3 });

const svgRoot = (aria: GaugeAria, width: number, height: number, defs: readonly MarkupChild[], body: readonly MarkupChild[]): MarkupNode =>
  el("svg", { class: "ts-chart", width: "100%", height: "100%", viewBox: `0 0 ${r3(width)} ${r3(height)}`, role: "img", "aria-roledescription": "chart", "aria-label": aria.label }, [
    aria.description === undefined ? null : el("desc", {}, [aria.description]),
    defs.length === 0 ? null : el("defs", {}, defs),
    ...body,
  ], { style: { display: "block", overflow: "visible", position: "relative" } });

const themeGradient = (b: Builder, spec: GaugeSpec): void => {
  if (usesThemeGradient(spec.fills)) {
    b.defs.push(linearGradient(`${spec.idPrefix}-gauge-theme-active`, { x1: "0%", x2: "100%", y1: "0%", y2: "0%" }, [["0%", THEME_GRADIENT[0]], ["100%", THEME_GRADIENT[1]]]));
  }
};

const linearScene = (spec: GaugeSpec, aria: GaugeAria, width: number, height: number, b: Builder): GaugeScene => {
  themeGradient(b, spec);
  const { points, cornerDepth } = linearNotchPoints({ height, notchLengthPercent: spec.notchLengthPercent, notchWidthPercent: spec.notchWidthPercent, spacing: spec.spacing, total: spec.total, uniformWidth: spec.uniformWidth, width });
  const { bg, lit } = notches(b, spec, points, cornerDepth, (i) => notchFills(i, spec.fills).active, undefined);
  return { conic: null, fade: [bg], parts: b.parts, svg: svgRoot(aria, width, height, b.defs, [bg, lit]) };
};

const arcScene = (spec: GaugeSpec, aria: GaugeAria, width: number, height: number, b: Builder): GaugeScene => {
  const size = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const layout = arcLayout({ arcStyle: spec.arcStyle, arcThickness: spec.arcThickness, needleTip: spec.needle?.tip, notchLengthPercent: spec.notchLengthPercent, ring: spec.ring, ruler: spec.ruler, size, zoneDisplay: spec.zoneDisplay, zones: spec.zones });
  const a0 = spec.startAngle;
  const a1 = spec.endAngle;
  const arc: Arc = { a0, a1, at: (v) => a0 + v * (a1 - a0), cx, cy, layout, size };
  const id = (part: string): string => `${spec.idPrefix}-gauge-${part}`;
  const glowId = spec.glow === null ? undefined : id("glow");
  const filter = glowId === undefined ? undefined : url(glowId);
  if (spec.glow !== null && glowId !== undefined) { b.defs.push(glowFilter(glowId, spec.glow)); }
  themeGradient(b, spec);
  const sector = fitSectorToDisc(spec.sector, spec.disc, size, layout.outerRadius);
  const conic = sector !== null && (sector.gradient ?? "conic") === "conic" ? conicLayer(b, arc, sector) : null;

  // The solid arc's paint: the reader's active fill, else a left → right ramp with `useGradient`, else --chart-1.
  const customActive = nonEmpty(spec.fills.activeFill);
  let solidFill = "var(--chart-1)";
  if (customActive) { solidFill = spec.fills.activeFill ?? solidFill; } else if (spec.fills.useGradient) {
    const stops = spec.fills.activeGradient ?? THEME_GRADIENT;
    b.defs.push(linearGradient(id("solid"), { gradientUnits: "userSpaceOnUse", x1: r3(cx - layout.outerRadius), x2: r3(cx + layout.outerRadius), y1: r3(cy), y2: r3(cy) }, [["0%", stops[0]], ["100%", stops[1]]]));
    solidFill = url(id("solid"));
  }

  const underlay: MarkupChild[] = [
    sector !== null && conic === null ? sectorSvg(b, arc, sector, id("sector")) : null,
    spec.dots === null ? null : dotsLayer(b, arc, spec.dots),
    spec.arcStyle === "solid" ? solidArc(b, arc, spec, solidFill, filter) : null,
  ];
  let bg: MarkupNode | null = null;
  let lit: MarkupNode | null = null;
  if (spec.arcStyle === "notches") {
    const points = arcNotchPoints({ cx, cy, endAngle: a1, innerRadius: layout.innerRadius, notchLength: layout.notchLength, outerRadius: layout.outerRadius, spacing: spec.spacing, startAngle: a0, total: spec.total, uniformWidth: spec.uniformWidth });
    const total = Math.max(1, spec.total);
    ({ bg, lit } = notches(b, spec, points, layout.notchLength, (i) => zoneColorAt(layout.zoneFill, (i + 0.5) / total) ?? notchFills(i, spec.fills).active, filter));
  }
  const overlayChildren: MarkupChild[] = [
    spec.ring === null ? null : progressRing(b, arc, spec.ring, filter),
    layout.showZoneBand && spec.zones !== undefined ? zoneBands(arc, spec.zones) : null,
    spec.ruler === null ? null : ruler(b, arc, spec.ruler),
    spec.needle === null ? null : needle(b, arc, spec.needle, id("needle")),
    spec.disc === null ? null : disc(arc, spec.disc),
  ];
  const overlay = overlayChildren.some((child) => child !== null) ? el("g", {}, overlayChildren) : null;
  const body = [...underlay, bg, lit, overlay];
  const fade = [bg, overlay].filter((node): node is MarkupNode => node !== null);
  return { conic, fade, parts: b.parts, svg: svgRoot(aria, width, height, b.defs, body) };
};

/** The scene at `width` × `height` px, every part at the progress `fill` (lit notches) and `value` (0–1). */
export const buildGaugeScene = (spec: GaugeSpec, aria: GaugeAria, width: number, height: number, fill: number, value: number): GaugeScene =>
  (spec.linear ? linearScene : arcScene)(spec, aria, width, height, new Builder(fill, value));
