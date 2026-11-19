import { clearAttribute, raiseAttribute } from "../host-write";
import { REST_PX, springOf } from "../motion/spring-curve";
import { CROSSHAIR_FOLLOW, DATE_PILL_SPRING } from "../motion/springs";
import type { Spring } from "../motion/springs";
import type { ChartMargin } from "../theme";
import { PILL_LIVE_X, pillMoveFadesAt, readTickVar, writeTickVar } from "./date-pill";
import type { PillLayout } from "./date-pill";
import type { PlotSnapshot } from "./plot-size";

/** What the overlay reads of a draw: the host height, the plot size and the resolved domains (x in ms). */
export interface OverlayPlot {
  readonly height: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly xDomain: readonly [number, number];
  readonly yDomains: Readonly<Record<string, readonly [number, number]>>;
}

export const overlayPlotOf = ({ built, size }: PlotSnapshot): OverlayPlot => ({
  height: size.height,
  innerWidth: size.innerWidth,
  innerHeight: size.innerHeight,
  xDomain: [built.domains.x[0].getTime(), built.domains.x[1].getTime()],
  yDomains: built.domains.y,
});
import type { Row } from "./series";

/** One shape of a dot, centred on the point, SVG-style (stroke centred on the edge): a circle of radius `r`, or with `corner` a rounded square of half-extent `r` (bklit's "ring" tooltip dot). */
export interface OverlayShape {
  readonly r: number;
  readonly corner?: number;
  readonly fill: string;
  /** The fill for a focused row, when it depends on the row (a function `dotColor`, a ProfitLossLine's sign); `fill` stands until the first focus. */
  readonly fillOf?: (row: Row) => string;
  readonly stroke: string;
  readonly strokeWidth: number;
  /** Fill opacity (bklit's dot halo, 0.3). */
  readonly opacity?: number;
  /** Gaussian blur in px (the halo's `dotHaloBlur`). */
  readonly blur?: number;
}

/** A marker that follows the focused row of one series: bklit's TooltipDot (glides, `glide`) or the 1.35x active marker (jumps). */
export interface OverlayDot {
  readonly yAxis: string;
  readonly valueOf: (row: Row) => number | undefined;
  /** Shapes in paint order; a function when they depend on the plot size (a bar's band width). */
  readonly shapes: readonly OverlayShape[] | ((plot: OverlayPlot) => readonly OverlayShape[]);
  /** Where a category chart puts the dot: an x offset from the focus line and a y within the plot, or undefined to hide it. Replaces `valueOf` and the y domain. */
  readonly at?: (row: Row, plot: OverlayPlot, key: number) => { readonly dx: number; readonly y: number } | undefined;
  readonly glide: boolean;
  /** A series' tooltip dot (not an active marker): the crosshair's `indicatorEnd="point"` stops at the topmost one. */
  readonly series?: boolean;
}

/** bklit TooltipIndicator (tooltip-indicator.tsx): a `width`px rule with its vertical fade stops (`indicatorFadeEdges` / `indicatorFadeLength`) and an optional colour ramp down to
 * `endColor`, or a plain dashed line; `toPoint` stops it at the topmost series dot, `colorOf` recolours it per focused row (bklit's function `indicatorColor`). */
export interface OverlayCrosshair {
  readonly color: string;
  readonly colorOf?: (row: Row) => string;
  readonly endColor?: string;
  readonly width: number;
  readonly dash: string | undefined;
  /** The fade's opacity stops; bklit's 0/10/90/100% when absent. */
  readonly stops?: readonly { readonly offset: string; readonly opacity: number }[];
  readonly toPoint?: boolean;
}

/** bklit's default crosshair fade (indicatorFadeGradientStops, both ends at 10%). */
const DEFAULT_FADE_STOPS = [
  { offset: "0%", opacity: 0 },
  { offset: "10%", opacity: 1 },
  { offset: "90%", opacity: 1 },
  { offset: "100%", opacity: 0 },
] as const;

export interface HoverOverlayModel {
  readonly crosshair: OverlayCrosshair | null;
  /** Date ticker: the measured rolling layout, or null for the compact text-sized pill (above 60 labels, bklit date-ticker.tsx:12). */
  readonly pill: { readonly layout: PillLayout | null; readonly labels: readonly string[] } | null;
  /** Markers in paint order (active markers first, dots last). */
  readonly dots: readonly OverlayDot[];
  /** Position of a focused row's time in the pill's label list. */
  readonly indexOf: (time: number) => number;
  /** x within the plot of a focus key; time charts omit it and the x domain maps the time. */
  readonly xOf?: (key: number, plot: OverlayPlot) => number;
}

let gradientCount = 0;
const SVG_NS = "http://www.w3.org/2000/svg";
const PILL_ROW = 24;

interface Axis {
  target: number;
  /** Displacement from `target` and velocity (px/s) at `t0`. */
  x0: number;
  v0: number;
  t0: number;
}

/** One animation-frame loop for every Glide of an overlay: a single rAF callback writes each moving element's transform, as motion's frame loop does for bklit's springs (date-ticker.tsx:81-82, tooltip-dot.tsx). */
export class Ticker {
  private readonly active = new Set<Glide>();
  private frame = 0;

  start(glide: Glide): void {
    this.active.add(glide);
    if (this.frame === 0) {
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  stop(glide: Glide): void {
    this.active.delete(glide);
  }

  clear(): void {
    this.active.clear();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    for (const glide of this.active) {
      if (glide.step(now)) {
        this.active.delete(glide);
      }
    }
    if (this.active.size > 0) {
      this.frame = requestAnimationFrame(this.tick);
    }
  };
}

interface Sink {
  readonly el: HTMLElement | SVGElement;
  readonly css: (values: readonly number[]) => string;
  last: string;
}

/** Within this many px of its target a spring is in its tail: the element looks at rest while the value still creeps in. */
const NEAR_PX = 1;

/** An element whose `transform` follows a spring on each axis, velocity kept across retargets (motion's `useSpring`, as bklit's tooltip dots and date ticker do).
 * `onMove` receives the values on every frame they are written (and on a jump), `near` when they are where the element rests or within `NEAR_PX` of it
 * on every axis (a jump, the spring's tail, the frame it comes to rest). */
export class Glide {
  public onMove: ((values: readonly number[], near: boolean) => void) | null = null;
  private readonly axes: Axis[];
  private readonly sinks: Sink[] = [];
  /** null: no motion, every move lands at once (CROSSHAIR_FOLLOW). */
  private readonly spring: Spring | null;
  private readonly ticker: Ticker;
  // Fields assigned by hand, not parameter properties: a project's `erasableSyntaxOnly` (Vite's template) refuses those.
  constructor(
    el: HTMLElement | SVGElement,
    spring: Spring | null,
    count: number,
    css: (values: readonly number[]) => string,
    ticker: Ticker,
  ) {
    this.spring = spring;
    this.ticker = ticker;
    this.axes = Array.from({ length: count }, () => ({ t0: 0, target: 0, v0: 0, x0: 0 }));
    this.sinks.push({ css, el, last: "" });
  }

  private write(values: readonly number[], near: boolean): void {
    for (const sink of this.sinks) {
      const next = sink.css(values);
      // A spring settling on its target repeats the last value; an identical write still dirties the element's style.
      if (next !== sink.last) {
        sink.last = next;
        sink.el.style.transform = next;
      }
    }
    // Outside the dedupe: a device-px-rounded transform can stop changing before the value lands on its target.
    this.onMove?.(values, near);
  }

  /** Places the element at `values` with no motion. */
  jump(values: readonly number[]): void {
    this.ticker.stop(this);
    this.axes.forEach((axis, i) => { axis.target = values[i] ?? 0; axis.x0 = 0; axis.v0 = 0; });
    this.write(values, true);
  }

  /** Springs from wherever the element is (and however fast it moves) to `values`. */
  glide(values: readonly number[]): void {
    if (this.spring === null) {
      this.jump(values);
      return;
    }
    const now = performance.now();
    const motion = springOf(this.spring, REST_PX);
    this.axes.forEach((axis, i) => {
      const live = motion.sample(now - axis.t0, { from: axis.x0, to: 0, velocity: axis.v0 });
      const target = values[i] ?? 0;
      axis.x0 = axis.target + live.value - target;
      axis.v0 = live.velocity;
      axis.target = target;
      axis.t0 = now;
    });
    this.ticker.start(this);
  }

  /** Writes the position at frame time `now`; true once every axis is at rest. */
  step(now: number): boolean {
    if (this.spring === null) {
      return true;
    }
    const motion = springOf(this.spring, REST_PX);
    let rest = true;
    const at = this.axes.map((axis) => {
      const s = motion.sample(Math.max(0, now - axis.t0), { from: axis.x0, to: 0, velocity: axis.v0 });
      rest &&= s.done;
      return axis.target + (s.done ? 0 : s.value);
    });
    this.write(rest ? this.axes.map((axis) => axis.target) : at, rest || this.axes.every((axis, i) => Math.abs((at[i] ?? 0) - axis.target) < NEAR_PX));
    return rest;
  }
}

/** bklit `verticalRampColor`: the colour at a stop `offset` ("40%") on a top -> bottom ramp, or `top` without an end colour. */
const rampColor = (top: string, end: string | undefined, offset: string): string => {
  if (end === undefined) {
    return top;
  }
  const percent = Number.parseFloat(offset);
  if (percent <= 0) {
    return top;
  }
  return percent >= 100 ? end : `color-mix(in srgb, ${end} ${percent}%, ${top})`;
};

const translate = (v: readonly number[]): string => `translate(${v[0] ?? 0}px,${v[1] ?? 0}px)`;
const translateX = (v: readonly number[]): string => `translateX(${v[0] ?? 0}px)`;
/** The pill's own layer sits on whole device pixels, where `left` used to snap it (bklit places its pill by `left`, chart-tooltip.tsx:422-423); a fractional layer offset would resample the text. */
const translateXDevicePx = (v: readonly number[]): string => {
  const dpr = window.devicePixelRatio || 1;
  return `translateX(${Math.round((v[0] ?? 0) * dpr) / dpr}px)`;
};
const translateY = (v: readonly number[]): string => `translateY(${v[0] ?? 0}px)`;

const div = (cls: string, parent?: HTMLElement): HTMLDivElement => {
  const el = document.createElement("div");
  el.className = cls;
  parent?.append(el);
  return el;
};

/** A shape whose fill follows the focused row (`OverlayShape.fillOf`), with the last fill written. */
interface RowPaint {
  readonly el: SVGElement;
  readonly fillOf: (row: Row) => string;
  last: string;
}

interface DotView {
  readonly dot: OverlayDot;
  readonly el: HTMLElement;
  readonly glide: Glide | null;
  readonly paints: readonly RowPaint[];
}

interface PillView {
  readonly el: HTMLElement;
  readonly glide: Glide;
  readonly months: Glide | null;
  readonly days: Glide | null;
  readonly text: HTMLElement | null;
}

/** Imperative hover indicator for one chart host. `mount` once, `update` after each draw, `focus` on every focus change. */
export class HoverOverlay {
  private el: HTMLDivElement | null = null;
  private model: HoverOverlayModel | null = null;
  private plot: OverlayPlot | null = null;
  private margin: ChartMargin | null = null;
  private ruleGlide: Glide | null = null;
  /** The rule's shape and paint stops, for `indicatorEnd="point"` (its height) and a function `indicatorColor` (its colour per row). */
  private rule: { readonly mark: SVGElement; readonly stops: readonly SVGStopElement[]; readonly height: number; lastHeight: number; lastColor: string } | null = null;
  private dots: DotView[] = [];
  private pill: PillView | null = null;
  private focused: { readonly time: number; readonly row: Row } | null = null;
  private entered = false;
  /** Whether the elements of the latest model are built: they are on the first focus after a draw, so a chart at rest carries the empty root only (the date pill's
   * stacks alone are a row per label: line-default's 55 elements). */
  private built = false;
  private monthRun = -1;
  /** What reads the pill's live x on the x tick labels (see `update`). */
  private pillFade: number | null | undefined = undefined;
  /** The pill's live x as last stepped (svg px, as written), which the labels a move could not fade did not take (`pillGlide`). */
  private pillX: string | null = null;
  private readonly ticker = new Ticker();

  /** Built on first client use: the overlay is created during render, which also runs on the server. */
  get root(): HTMLDivElement {
    if (!this.el) {
      this.el = div("bkm-hov");
      this.el.setAttribute("aria-hidden", "true");
    }
    return this.el;
  }

  /** The model and plot of the latest draw; drops the elements (a draw is a resize or a data change, never a hover move), which the next focus builds, and replays the current
   * focus without motion.
   * `pillFade` says what reads the pill's live x (`--bkm-pill-x`): the x tick fade's half-width (date-pill.ts `pillFadeHalf` of the reach `pillTickStaticCss` was given), null when
   * the chart has no such rule, undefined when unknown (every frame is written). */
  update(model: HoverOverlayModel | null, plot: OverlayPlot, margin: ChartMargin, pillFade?: number | null): void {
    this.model = model;
    this.plot = plot;
    this.margin = margin;
    this.pillFade = pillFade;
    // A server render draws during render (onBuilt): no DOM and no frames there; the client builds on its own first draw.
    if (typeof document === "undefined") {
      return;
    }
    // A glide stopped here leaves the tick labels where its last frame put them.
    this.writePillX(this.pillX);
    this.pillX = null;
    const host = this.root.parentElement;
    if (host && (!model?.pill || pillFade === null)) {
      // No overlay pill (or nothing reading it): the tick rule, if any, reads the focus x again.
      writeTickVar(host, PILL_LIVE_X, null);
    }
    this.root.replaceChildren();
    this.ticker.clear();
    this.ruleGlide = null;
    this.rule = null;
    this.dots = [];
    this.pill = null;
    this.monthRun = -1;
    this.entered = false;
    this.built = false;
    if (!model) {
      return;
    }
    const held = this.focused;
    this.focused = null;
    this.focus(held?.time ?? null, held?.row ?? null);
  }

  /** Moves the indicator to the focused row (`null` hides it at once, like bklit unmounting the crosshair and dots). */
  focus(time: number | null, row: Row | null): void {
    const { model, plot, margin } = this;
    if (time === null || row === null || !model || !plot || !margin) {
      this.focused = null;
      this.entered = false;
      clearAttribute(this.root, "data-on");
      return;
    }
    if (this.focused?.row === row && this.focused.time === time) {
      return;
    }
    this.build(model, plot, margin);
    this.focused = { row, time };
    const enter = !this.entered;
    this.entered = true;
    const [xStart, xEnd] = plot.xDomain;
    const span = xEnd - xStart;
    const x = margin.left + (model.xOf ? model.xOf(time, plot) : span > 0 ? ((time - xStart) / span) * plot.innerWidth : 0);
    this.ruleGlide?.[enter ? "jump" : "glide"]([x]);
    let topY = Number.POSITIVE_INFINITY;
    for (const view of this.dots) {
      const spot = this.spotOf(view.dot, row, plot, time, margin.top);
      view.el.style.display = spot ? "" : "none";
      if (spot && view.dot.series) {
        topY = Math.min(topY, spot.y);
      }
      if (spot) {
        const at = [x + spot.dx, spot.y];
        view.glide?.[enter ? "jump" : "glide"](at);
        if (!view.glide) { view.el.style.transform = translate(at); }
        for (const paint of view.paints) {
          const fill = paint.fillOf(row);
          if (fill !== paint.last) {
            paint.last = fill;
            paint.el.style.fill = fill;
          }
        }
      }
    }
    this.focusRule(model, row, topY - margin.top);
    this.focusPill(model, time, x, enter);
    raiseAttribute(this.root, "data-on");
  }

  /** The latest model's crosshair rule, dots and date pill, once per draw. */
  private build(model: HoverOverlayModel, plot: OverlayPlot, margin: ChartMargin): void {
    if (this.built) {
      return;
    }
    this.built = true;
    if (model.crosshair) {
      this.buildRule(model.crosshair, plot, margin);
    }
    for (const dot of model.dots) {
      this.dots.push(this.buildDot(dot, plot));
    }
    if (model.pill) {
      this.pill = this.buildPill(model.pill, plot);
    }
  }

  /** `indicatorEnd="point"`: the rule's height down to the topmost dot; a function `indicatorColor`: its colour for the row. One attribute or style write each, only on a change. */
  private focusRule(model: HoverOverlayModel, row: Row, pointY: number): void {
    const rule = this.rule;
    const spec = model.crosshair;
    if (!rule || !spec) {
      return;
    }
    if (spec.toPoint) {
      const height = Math.max(0, Math.min(rule.height, Number.isFinite(pointY) ? pointY : rule.height));
      if (height !== rule.lastHeight) {
        rule.lastHeight = height;
        rule.mark.setAttribute(spec.dash ? "y2" : "height", String(height));
      }
    }
    if (spec.colorOf) {
      const color = spec.colorOf(row);
      if (color !== rule.lastColor) {
        rule.lastColor = color;
        if (spec.dash) {
          rule.mark.style.stroke = color;
        }
        rule.stops.forEach((stop) => {
          stop.style.stopColor = rampColor(color, spec.endColor, stop.getAttribute("offset") ?? "0%");
        });
      }
    }
  }

  private spotOf(dot: OverlayDot, row: Row, plot: OverlayPlot, key: number, top: number): { readonly dx: number; readonly y: number } | undefined {
    if (dot.at) {
      const spot = dot.at(row, plot, key);
      return spot && Number.isFinite(spot.y) ? { dx: spot.dx, y: top + spot.y } : undefined;
    }
    const value = dot.valueOf(row);
    const domain = plot.yDomains[dot.yAxis];
    if (value === undefined || !Number.isFinite(value) || !domain) {
      return undefined;
    }
    return { dx: 0, y: top + plot.innerHeight - ((value - domain[0]) / (domain[1] - domain[0] || 1)) * plot.innerHeight };
  }

  private focusPill(model: HoverOverlayModel, time: number, x: number, enter: boolean): void {
    const pill = this.pill;
    if (!pill || !model.pill) {
      return;
    }
    pill.glide[enter ? "jump" : "glide"]([x]);
    const index = model.indexOf(time);
    const layout = model.pill.layout;
    if (pill.text) {
      pill.text.textContent = model.pill.labels[index] ?? "";
      return;
    }
    if (!layout) {
      return;
    }
    const run = layout.monthOf[index] ?? 0;
    // bklit's stacks mount at row 0 and spring to the focused row on every hover start (date-ticker.tsx:81-92); the month stack only moves when its run changes.
    if (enter) {
      pill.days?.jump([0]);
      pill.months?.jump([0]);
      this.monthRun = -1;
    }
    pill.days?.glide([-index * PILL_ROW]);
    if (this.monthRun !== run) {
      pill.months?.glide([-run * PILL_ROW]);
      this.monthRun = run;
    }
  }

  private buildRule(rule: OverlayCrosshair, plot: OverlayPlot, margin: ChartMargin): void {
    const height = Math.max(0, plot.innerHeight);
    const wrap = div("bkm-hov-x", this.root);
    wrap.style.top = `${margin.top}px`;
    wrap.style.height = `${height}px`;
    // An svg rect like bklit's TooltipIndicator (tooltip-indicator.tsx:163-200), moved by an in-svg transform so it rasterizes at the same subpixel position
    // (an HTML div or a composited layer antialiases the 1px edge differently).
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "1");
    svg.setAttribute("height", String(height));
    svg.style.overflow = "visible";
    let mark: SVGElement;
    const stops: SVGStopElement[] = [];
    if (rule.dash) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("y2", String(height));
      line.style.stroke = rule.color;
      line.style.strokeWidth = String(rule.width);
      line.style.strokeDasharray = rule.dash.replace(",", " ");
      mark = line;
    } else {
      // bklit gradient: the fade's opacity stops (indicatorFadeGradientStops: transparent -> colour at 10% -> colour at 90% -> transparent by default), each stop's colour on the
      // ramp down to `endColor` when there is one.
      const id = `bkm-hov-grad-${gradientCount++}`;
      const defs = document.createElementNS(SVG_NS, "defs");
      const gradient = document.createElementNS(SVG_NS, "linearGradient");
      gradient.id = id;
      gradient.setAttribute("x1", "0%");
      gradient.setAttribute("x2", "0%");
      gradient.setAttribute("y1", "0%");
      gradient.setAttribute("y2", "100%");
      const given = rule.stops ?? DEFAULT_FADE_STOPS;
      const fadeStops = rule.endColor && given.length === 1 ? [...given, { offset: "100%", opacity: 1 }] : given;
      for (const { offset, opacity } of fadeStops) {
        const stop = document.createElementNS(SVG_NS, "stop");
        stop.setAttribute("offset", offset);
        stop.style.stopColor = rampColor(rule.color, rule.endColor, offset);
        stop.style.stopOpacity = String(opacity);
        gradient.append(stop);
        stops.push(stop);
      }
      defs.append(gradient);
      svg.append(defs);
      const bar = document.createElementNS(SVG_NS, "rect");
      bar.setAttribute("x", String(-rule.width / 2));
      bar.setAttribute("width", String(rule.width));
      bar.setAttribute("height", String(height));
      bar.style.fill = `url(#${id})`;
      mark = bar;
    }
    svg.append(mark);
    wrap.append(svg);
    this.rule = { mark, stops, height, lastHeight: height, lastColor: rule.color };
    // bklit's crosshair rides the tooltipSpring (charts/chart-config-context.tsx:20); here it lands at once (CROSSHAIR_FOLLOW).
    this.ruleGlide = new Glide(mark, CROSSHAIR_FOLLOW, 1, translateX, this.ticker);
  }

  private buildDot(dot: OverlayDot, plot: OverlayPlot): DotView {
    const el = div("bkm-hov-dot", this.root);
    const svg = document.createElementNS(SVG_NS, "svg");
    const shapes = typeof dot.shapes === "function" ? dot.shapes(plot) : dot.shapes;
    // Sized to hold every shape (a halo, its blur), centred on the point: ink past a promoted layer's box rasterised as stray pixels at its edges.
    const reach = Math.ceil(Math.max(1, ...shapes.map((c) => c.r + c.strokeWidth / 2 + 3 * (c.blur ?? 0))));
    svg.setAttribute("width", String(2 * reach));
    svg.setAttribute("height", String(2 * reach));
    svg.setAttribute("viewBox", `${-reach} ${-reach} ${2 * reach} ${2 * reach}`);
    svg.style.margin = `${-reach}px 0 0 ${-reach}px`;
    svg.style.overflow = "visible";
    const paints: RowPaint[] = [];
    for (const c of shapes) {
      let shape: SVGElement;
      if (c.corner === undefined) {
        shape = document.createElementNS(SVG_NS, "circle");
        shape.setAttribute("r", String(c.r));
      } else {
        shape = document.createElementNS(SVG_NS, "rect");
        shape.setAttribute("x", String(-c.r));
        shape.setAttribute("y", String(-c.r));
        shape.setAttribute("width", String(c.r * 2));
        shape.setAttribute("height", String(c.r * 2));
        shape.setAttribute("rx", String(c.corner));
      }
      // style, not attributes: presentation attributes do not resolve var().
      shape.style.fill = c.fill;
      shape.style.stroke = c.stroke;
      shape.style.strokeWidth = String(c.strokeWidth);
      if (c.opacity !== undefined) {
        shape.style.fillOpacity = String(c.opacity);
      }
      if (c.blur !== undefined && c.blur > 0) {
        // bklit's halo filter: a gaussian blur over three times the halo's box (tooltip-dot.tsx), so the falloff is not cropped square.
        const filter = document.createElementNS(SVG_NS, "filter");
        filter.id = `bkm-hov-blur-${gradientCount++}`;
        filter.setAttribute("x", "-100%");
        filter.setAttribute("y", "-100%");
        filter.setAttribute("width", "300%");
        filter.setAttribute("height", "300%");
        const blur = document.createElementNS(SVG_NS, "feGaussianBlur");
        blur.setAttribute("stdDeviation", String(c.blur));
        filter.append(blur);
        const defs = document.createElementNS(SVG_NS, "defs");
        defs.append(filter);
        svg.append(defs);
        shape.setAttribute("filter", `url(#${filter.id})`);
      }
      if (c.fillOf) {
        paints.push({ el: shape, fillOf: c.fillOf, last: c.fill });
      }
      svg.append(shape);
    }
    el.append(svg);
    return { dot, el, glide: dot.glide ? new Glide(el, CROSSHAIR_FOLLOW, 2, translate, this.ticker) : null, paints };
  }

  /** The pill's x spring (bklit's pill rides the crosshair's tooltipSpring); it writes the pill's live x (svg px) on the x tick labels, where the tick fade reads it (date-pill.ts
   * `pillTickStaticCss`, `writeTickVar`), and only on the labels whose opacity the move can change (`pillMoveFadesAt`): each one written is restyled. Nothing is written
   * without a tick rule (`pillFade` null). */
  private pillGlide(wrap: HTMLElement): Glide {
    const glide = new Glide(wrap, CROSSHAIR_FOLLOW, 1, translateXDevicePx, this.ticker);
    glide.onMove = ([x = 0]) => {
      const next = x.toFixed(1);
      this.pillX = next;
      const host = this.root.parentElement;
      const half = this.pillFade;
      if (!host || half === null) {
        return;
      }
      const prior = readTickVar(host, PILL_LIVE_X);
      if (prior !== next) {
        writeTickVar(host, PILL_LIVE_X, next, prior === "" || half === undefined ? undefined : pillMoveFadesAt(half, Number(prior), Number(next)));
      }
    };
    return glide;
  }

  /** The pill's live x onto every x tick label (a glide stopped by a redraw). */
  private writePillX(x: string | null): void {
    const host = this.root.parentElement;
    if (host && x !== null && this.pillFade !== null) {
      writeTickVar(host, PILL_LIVE_X, x);
    }
  }

  private buildPill(spec: NonNullable<HoverOverlayModel["pill"]>, plot: OverlayPlot): PillView {
    const wrap = div("bkm-hov-pill", this.root);
    // The native pill sat with its 32px capsule centred 20px above the host bottom (bklit date pill: bottom 4px, z-50).
    wrap.style.top = `${plot.height - 36}px`;
    const box = div("bkm-hov-pill-box", wrap);
    const layout = spec.layout;
    if (!layout) {
      const text = document.createElement("span");
      text.className = "bkm-hov-pill-text";
      div("bkm-hov-pill-row", box).append(text);
      return { days: null, el: wrap, glide: this.pillGlide(wrap), months: null, text };
    }
    const column = (values: readonly string[]): Glide => {
      const col = div("bkm-hov-pill-col", box);
      const stack = div("bkm-hov-pill-stack", col);
      for (const value of values) {
        const row = div("bkm-hov-pill-row", stack);
        row.textContent = value;
      }
      // bklit's ticker springs both stacks with useSpring(0, { stiffness: 400, damping: 35 }) (tooltip/date-ticker.tsx:81-82).
      return new Glide(stack, DATE_PILL_SPRING, 1, translateY, this.ticker);
    };
    const months = column(layout.months);
    // bklit always mounts the day stack, empty for month-only labels: its gap-1 keeps the capsule 4px wider (date-ticker.tsx:96-125).
    const days = column(layout.days);
    return { days, el: wrap, glide: this.pillGlide(wrap), months, text: null };
  }
}
