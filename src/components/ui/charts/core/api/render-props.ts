export type RenderPropArgs =
  /** With one object of these fields: `content({ point, index })`. */
  | { readonly kind: "object"; readonly fields: readonly string[] }
  /** With these arguments, in order: `renderPattern(id, color)`, `children(layout)`. */
  | { readonly kind: "positional"; readonly names: readonly string[] };

export interface RenderPropSpec {
  /** What React calls it with, or `null` for a node prop (markup, not a function). */
  readonly args: RenderPropArgs | null;
  /** A render prop that may be markup instead (SunburstHint's children: its content, or a function of the hint context). */
  readonly orNode?: true;
  /** Vue's slot for it. */
  readonly vue: string;
  /** Svelte's snippet prop for it. */
  readonly svelte: string;
}

const fields = (...names: string[]): RenderPropArgs => ({ kind: "object", fields: names });
const positional = (...names: string[]): RenderPropArgs => ({ kind: "positional", names });

/** A render prop called with `args`: Vue's slot `vue`, Svelte's snippet `svelte` (React's prop name). */
const render = (prop: string, args: RenderPropArgs, vue: string): RenderPropSpec => ({ args, svelte: prop, vue });
/** Markup in a prop: Vue's slot `vue`, Svelte's snippet `svelte` (React's prop name). */
const node = (prop: string, vue: string): RenderPropSpec => ({ args: null, svelte: prop, vue });
/** Markup children the component renders as its content: Vue's default slot, Svelte's `children`. */
const content: RenderPropSpec = /* @__PURE__ */ node("children", "default");

/** The point a cartesian tooltip's `content` is called with: the hovered row and its index (a live line passes `point` only). */
const TOOLTIP_CONTENT = /* @__PURE__ */ fields("point", "index");
/** What `PieCenter` (at rest and on hover) and `RingCenter` (on hover) call their function child with. */
const CENTER = /* @__PURE__ */ fields("value", "label", "isHovered", "data");
/** `ChartBrushLayout`'s `ChartBrushLayoutState`. */
const BRUSH_LAYOUT = /* @__PURE__ */ positional("layout");

/** Component → prop → how it ports. Components missing here take no markup in a prop and read their children as carriers. */
export const RENDER_PROPS = /* @__PURE__ */ (() => ({
  ChartBrushLayout: {
    brushStrip: /* @__PURE__ */ render("brushStrip", BRUSH_LAYOUT, "brush-strip"),
    children: /* @__PURE__ */ render("children", BRUSH_LAYOUT, "default"),
  },
  ChartLegend: {
    renderItem: /* @__PURE__ */ render("renderItem", /* @__PURE__ */ fields("item", "index", "isHovered", "isFaded", "percentage"), "render-item"),
  },
  ChartStatFlow: { icon: /* @__PURE__ */ node("icon", "icon") },
  ChartTooltip: {
    content: /* @__PURE__ */ render("content", TOOLTIP_CONTENT, "content"),
    /** Extra content below the default panel's rows. */
    children: content,
  },
  ChoroplethFeatureComponent: { patterns: /* @__PURE__ */ node("patterns", "patterns") },
  ChoroplethTooltip: { content: /* @__PURE__ */ render("content", /* @__PURE__ */ fields("feature", "index"), "content") },
  /** The distribution charts' tooltips (core/types/distribution.ts): `content({ point, index })` replaces the default body. */
  HistogramTooltip: { content: /* @__PURE__ */ render("content", TOOLTIP_CONTENT, "content") },
  RidgelineTooltip: { content: /* @__PURE__ */ render("content", TOOLTIP_CONTENT, "content") },
  EcdfTooltip: { content: /* @__PURE__ */ render("content", TOOLTIP_CONTENT, "content") },
  BeeswarmTooltip: { content: /* @__PURE__ */ render("content", TOOLTIP_CONTENT, "content") },
  ViolinTooltip: { content: /* @__PURE__ */ render("content", TOOLTIP_CONTENT, "content") },
  BoxPlotTooltip: { content: /* @__PURE__ */ render("content", TOOLTIP_CONTENT, "content") },
  DensityTooltip: { content: /* @__PURE__ */ render("content", /* @__PURE__ */ fields("point", "index"), "content") },
  BubbleMapTooltip: { content: /* @__PURE__ */ render("content", /* @__PURE__ */ fields("bubble", "index"), "content") },
  RouteMapTooltip: { content: /* @__PURE__ */ render("content", /* @__PURE__ */ fields("route", "place", "index"), "content") },
  GlobeTooltip: { content: /* @__PURE__ */ render("content", /* @__PURE__ */ fields("marker", "index"), "content") },
  VectorFieldTooltip: { content: /* @__PURE__ */ render("content", /* @__PURE__ */ fields("vector", "index"), "content") },
  HexbinTooltip: { content: /* @__PURE__ */ render("content", /* @__PURE__ */ fields("bin", "index"), "content") },
  FunnelChart: { renderPattern: /* @__PURE__ */ render("renderPattern", /* @__PURE__ */ positional("id", "color"), "render-pattern") },
  /** The gauge's label (accepted for bklit-ui compatibility). */
  Gauge: { children: content },
  LegendItemComponent: { children: content },
  /** The tile's own artwork (its `<path>`s), drawn in its viewBox. */
  PatternTile: { children: content },
  PieCenter: { children: /* @__PURE__ */ render("children", CENTER, "default") },
  /** `RadialCenter`'s content: a function of its `RadialCenterState`. */
  RadialCenter: { children: /* @__PURE__ */ render("children", /* @__PURE__ */ fields("index", "datum", "label", "isFuture", "totals", "values"), "default") },
  RingCenter: { children: /* @__PURE__ */ render("children", CENTER, "default") },
  SankeyLink: { patterns: /* @__PURE__ */ node("patterns", "patterns") },
  SankeyTooltip: {
    linkContent: /* @__PURE__ */ render("linkContent", /* @__PURE__ */ fields("link", "index"), "link-content"),
    nodeContent: /* @__PURE__ */ render("nodeContent", /* @__PURE__ */ fields("node", "index"), "node-content"),
  },
  SunburstBreadcrumb: { children: content },
  SunburstHint: { children: { .../* @__PURE__ */ render("children", /* @__PURE__ */ fields("hintText", "hoveredArc", "focus"), "default"), orNode: true } },
  TooltipBox: { children: content },
  TooltipContent: { children: content },
  /** The detail a pinned tooltip unfolds. */
  TooltipDetail: { children: content },
} as const satisfies Readonly<Record<string, Readonly<Record<string, RenderPropSpec>>>>))();

export type RenderPropComponent = keyof typeof RENDER_PROPS;

/**
 * Components whose children are a template rendered once per item, not carriers or content: `Legend` renders its child (a
 * `LegendItemComponent`) for each of its items. React clones it per item under a Provider; Vue renders its default slot per item
 * inside `LegendItemScope`; Svelte `{#each}`es its `children` snippet inside the item's scope; Solid `<For>`s `props.children`
 * under a Provider. The markup passes through unchanged.
 */
export const PER_ITEM_CHILDREN = ["Legend"] as const;

/**
 * Gradient carriers whose `<stop>` children are read as data: the ports take them as the `stops` prop instead (owner decision 2:
 * Svelte's snippets can't be inspected for `<stop>` children). A `<stop offset stopColor stopOpacity>` is the stop
 * `{ offset, color, opacity }`, its offset a fraction ("55%" is 0.55, as core/gradients.ts's `unit` reads it); a stop without a
 * `stopColor` is dropped, as React drops it.
 */
export const STOP_GRADIENTS = [
  "GradientDarkgreenGreen",
  "GradientLightgreenGreen",
  "GradientOrangeRed",
  "GradientPinkBlue",
  "GradientPinkRed",
  "GradientPurpleOrange",
  "GradientPurpleTeal",
  "GradientSteelPurple",
  "GradientTealBlue",
  "LinearGradient",
  "RadialGradient",
] as const;

const BY_COMPONENT: Readonly<Partial<Record<string, Readonly<Partial<Record<string, RenderPropSpec>>>>>> = RENDER_PROPS;

/** The render prop or node prop `prop` of `component`, if it is one. */
export const renderPropOf = (component: string, prop: string): RenderPropSpec | undefined => BY_COMPONENT[component]?.[prop];
