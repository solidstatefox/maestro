import { Glide, Ticker } from "./hover-overlay";
import { CROSSHAIR_FOLLOW, criticalSpring } from "../motion/springs";
import type { Spring } from "../motion/springs";
import type { ChartMargin } from "../theme";
import type { ChartCrosshairProps } from "../types/range-overlays";
import { axisId } from "./series";
import { hostPointerMove } from "../interaction/host-pointer";

const SVG_NS = "http://www.w3.org/2000/svg";
/** The pill's text lines up with the YAxis labels (8px gutter) and its 16px padding overlaps the plot (bklit PILL_TEXT_INSET). */
const PILL_TEXT_INSET = 8 - 16;
/** bklit TICK_FADE_BUFFER: the ticks fade back in over this many px past the pill's edge. */
const TICK_FADE_BUFFER = 20;
/** The pill's half-height (32px capsule). */
const PILL_HALF = 16;
const DIGIT_ROW = 20;
/** A digit column's roll: about NumberFlow's 350ms spin (bklit NUMBER_FLOW_TIMING), critically damped. */
const DIGIT_SPRING: Spring = /* @__PURE__ */ criticalSpring(22);
const DEFAULT_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 2 };

/** What the crosshair reads of a draw. */
export interface CrosshairPlot {
  readonly margin: ChartMargin;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly yDomains: Readonly<Record<string, readonly [number, number]>>;
}

const translateX = (v: readonly number[]): string => `translateX(${v[0] ?? 0}px)`;
const translateY = (v: readonly number[]): string => `translateY(${v[0] ?? 0}px)`;

const formatterOf = (props: ChartCrosshairProps): ((value: number) => string) => {
  if (props.formatValue && props.numberFlow !== true) {
    return props.formatValue;
  }
  const intl = new Intl.NumberFormat(undefined, props.format ?? DEFAULT_FORMAT);
  return (value) => `${props.prefix ?? ""}${intl.format(value)}${props.suffix ?? ""}`;
};

/** The pill's label: plain text, or one rolling column per digit (`numberFlow`), rebuilt when the label's shape (its non-digit characters and length) changes. */
class PillLabel {
  private shape = "";
  private columns: Glide[] = [];
  private last = "";
  private readonly el: HTMLElement;
  private readonly roll: boolean;
  private readonly ticker: Ticker;
  // Fields assigned by hand, not parameter properties: a project's `erasableSyntaxOnly` (Vite's template) refuses those.
  constructor(el: HTMLElement, roll: boolean, ticker: Ticker) {
    this.el = el;
    this.roll = roll;
    this.ticker = ticker;
  }

  set(text: string, jump: boolean): void {
    if (text === this.last) {
      return;
    }
    this.last = text;
    if (!this.roll) {
      this.el.textContent = text;
      return;
    }
    const shape = text.replaceAll(/\d/gu, "0");
    if (shape !== this.shape) {
      this.build(text, shape);
      return;
    }
    let column = 0;
    for (const ch of text) {
      if (ch >= "0" && ch <= "9") {
        this.columns[column]?.[jump ? "jump" : "glide"]([-Number(ch) * DIGIT_ROW]);
        column += 1;
      }
    }
  }

  private build(text: string, shape: string): void {
    this.shape = shape;
    this.columns = [];
    this.el.replaceChildren();
    for (const ch of text) {
      if (ch < "0" || ch > "9") {
        const span = document.createElement("span");
        span.textContent = ch;
        this.el.append(span);
        continue;
      }
      const col = document.createElement("span");
      col.className = "bkm-xh-digit";
      const stack = document.createElement("span");
      stack.className = "bkm-xh-digit-stack";
      for (let digit = 0; digit <= 9; digit += 1) {
        const row = document.createElement("span");
        row.textContent = String(digit);
        stack.append(row);
      }
      col.append(stack);
      this.el.append(col);
      const glide = new Glide(stack, DIGIT_SPRING, 1, translateY, this.ticker);
      glide.jump([-Number(ch) * DIGIT_ROW]);
      this.columns.push(glide);
    }
  }

  reset(): void {
    this.last = "";
  }
}

/** A YAxis tick label and the y it sits at (host px), with the opacity last written. */
interface Tick {
  readonly el: SVGElement;
  readonly y: number;
  opacity: number;
}

/** One chart's ChartCrosshair: `attach` to the host, `update` after each draw, `snap` on every focus change (the hovered column's x). */
export class ChartCrosshairView {
  private el: HTMLDivElement | null = null;
  private readonly ticker = new Ticker();
  private host: HTMLElement | null = null;
  private props: ChartCrosshairProps | null = null;
  private plot: CrosshairPlot | null = null;
  private hLine: Glide | null = null;
  private vLine: Glide | null = null;
  private pill: Glide | null = null;
  private label: PillLabel | null = null;
  private format: (value: number) => string = String;
  private rect: DOMRect | null = null;
  private visible = false;
  /** The hovered column's x (host px), or null when no row is focused. */
  private snapped: number | null = null;
  private pointerX = 0;
  private ticks: Tick[] | null = null;

  /** Built on first client use, as the hover overlay's root is. */
  private get root(): HTMLDivElement {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "bkm-xh";
      this.el.setAttribute("aria-hidden", "true");
    }
    return this.el;
  }

  attach(host: HTMLElement): void {
    this.host = host;
    host.append(this.root);
    host.addEventListener(hostPointerMove(host), this.onMove, { passive: true });
    host.addEventListener("pointerleave", this.onLeave, { passive: true });
    window.addEventListener("scroll", this.invalidate, { capture: true, passive: true });
    window.addEventListener("resize", this.invalidate, { passive: true });
  }

  detach(): void {
    const { host } = this;
    if (host) {
      host.removeEventListener(hostPointerMove(host), this.onMove);
      host.removeEventListener("pointerleave", this.onLeave);
    }
    window.removeEventListener("scroll", this.invalidate, { capture: true });
    window.removeEventListener("resize", this.invalidate);
    this.hide();
    this.ticker.clear();
    this.root.remove();
    this.host = null;
  }

  /** The props and plot of the latest draw: rebuilds the lines and the pill (a draw is a resize or a data change, never a pointer move). */
  update(props: ChartCrosshairProps | null, plot: CrosshairPlot): void {
    this.restoreTicks();
    this.ticks = null;
    this.rect = null;
    this.props = props;
    this.plot = plot;
    this.root.replaceChildren();
    this.ticker.clear();
    this.hLine = null;
    this.vLine = null;
    this.pill = null;
    this.label = null;
    this.setVisible(false);
    if (!props) {
      return;
    }
    const { margin, innerWidth, innerHeight } = plot;
    const spring = props.springConfig ? { ...props.springConfig, mass: 1 } : CROSSHAIR_FOLLOW;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "bkm-xh-lines");
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("transform", `translate(${margin.left},${margin.top})`);
    group.setAttribute("shape-rendering", "crispEdges");
    group.style.stroke = props.stroke ?? "var(--chart-crosshair)";
    group.style.strokeWidth = String(props.strokeWidth ?? 1);
    group.style.strokeDasharray = (props.strokeDasharray ?? "3,3").replaceAll(",", " ");
    const line = (x2: number, y2: number): SVGLineElement => {
      const el = document.createElementNS(SVG_NS, "line");
      el.setAttribute("x2", String(x2));
      el.setAttribute("y2", String(y2));
      group.append(el);
      return el;
    };
    const horizontal = props.horizontal !== false;
    if (horizontal) {
      this.hLine = new Glide(line(innerWidth, 0), spring, 1, translateY, this.ticker);
    }
    if (props.vertical !== false) {
      this.vLine = new Glide(line(0, Math.max(0, innerHeight)), spring, 1, translateX, this.ticker);
    }
    svg.append(group);
    this.root.append(svg);
    if (horizontal && props.showValueLabel !== false) {
      const id = axisId(props.yAxisId);
      const side = props.side ?? (id === "right" ? "right" : "left");
      const wrap = document.createElement("div");
      wrap.className = "bkm-xh-pill";
      wrap.style.top = `${margin.top}px`;
      if (side === "right") {
        wrap.style.left = `${margin.left + innerWidth + PILL_TEXT_INSET}px`;
      } else {
        wrap.style.right = `calc(100% - ${margin.left - PILL_TEXT_INSET}px)`;
      }
      const box = document.createElement("div");
      box.className = "bkm-xh-pill-box";
      const text = document.createElement("span");
      text.className = "bkm-xh-pill-text";
      box.append(text);
      wrap.append(box);
      this.root.append(wrap);
      this.pill = new Glide(wrap, spring, 1, translateY, this.ticker);
      this.label = new PillLabel(text, props.numberFlow === true, this.ticker);
      this.format = formatterOf(props);
    }
  }

  /** The focused row's x within the plot (null: none focused); the vertical line snaps to it. */
  snap(x: number | null): void {
    this.snapped = x === null || !this.plot ? null : this.plot.margin.left + x;
    if (this.visible && this.props?.snap !== false) {
      this.vLine?.glide([(this.snapped ?? this.pointerX) - (this.plot?.margin.left ?? 0)]);
    }
  }

  private readonly invalidate = (): void => {
    this.rect = null;
  };

  private readonly onLeave = (): void => {
    this.rect = null;
    this.hide();
  };

  private readonly onMove = (event: PointerEvent): void => {
    const { host, plot, props } = this;
    if (!host || !plot || !props) {
      return;
    }
    // Read once per hover: every later move only writes.
    this.rect ??= host.getBoundingClientRect();
    const { margin, innerWidth, innerHeight } = plot;
    const x = event.clientX - this.rect.left;
    const y = event.clientY - this.rect.top - margin.top;
    if (x < margin.left || x > margin.left + innerWidth || y < 0 || y > innerHeight) {
      this.hide();
      return;
    }
    this.pointerX = x;
    // The first frame of a hover jumps, so the lines never sweep in from 0 (bklit `drive(..., instant)`).
    const enter = !this.visible;
    const how = enter ? "jump" : "glide";
    this.hLine?.[how]([y]);
    this.vLine?.[how]([(props.snap === false ? x : (this.snapped ?? x)) - margin.left]);
    if (this.pill && this.label) {
      this.pill[how]([y]);
      const domain = plot.yDomains[axisId(props.yAxisId)];
      if (domain && innerHeight > 0) {
        const value = domain[1] - (y / innerHeight) * (domain[1] - domain[0]);
        this.label.set(this.format(value), enter);
      }
      this.fadeTicks(margin.top + y);
    }
    this.setVisible(true);
  };

  private hide(): void {
    this.setVisible(false);
    this.label?.reset();
    this.restoreTicks();
  }

  private setVisible(next: boolean): void {
    if (this.visible === next) {
      return;
    }
    this.visible = next;
    if (next) {
      this.root.setAttribute("data-on", "");
    } else {
      this.root.removeAttribute("data-on");
    }
  }

  /** The YAxis tick labels on the pill's axis, read once per draw on the first move (attributes only, no layout). */
  private tickLabels(): Tick[] {
    if (this.ticks) {
      return this.ticks;
    }
    const { host, plot, props } = this;
    const out: Tick[] = [];
    if (host && plot && props) {
      const id = axisId(props.yAxisId);
      const side = props.side ?? (id === "right" ? "right" : "left");
      const edge = side === "right" ? plot.margin.left + plot.innerWidth : plot.margin.left;
      // The renderer keys every tick label (`y-tick-label:number:<value>`, UPSTREAM-GAPS #36); the pill's axis is the one in the gutter on its side.
      for (const el of host.querySelectorAll<SVGTextElement>('.ts-chart-surface svg text[data-ts-key*="tick-label:"]')) {
        const x = Number(el.getAttribute("x"));
        const y = Number(el.getAttribute("y"));
        const inGutter = side === "right" ? x >= edge : x <= edge;
        if (Number.isFinite(x) && Number.isFinite(y) && inGutter && y >= plot.margin.top - 1 && y <= plot.margin.top + plot.innerHeight + 1) {
          out.push({ el, y, opacity: 1 });
        }
      }
    }
    this.ticks = out;
    return out;
  }

  /** bklit `crosshairTickOpacity`: hidden under the pill, back in over 20px past its edge. */
  private fadeTicks(y: number): void {
    for (const tick of this.tickLabels()) {
      const distance = Math.abs(tick.y - y);
      let opacity = 1;
      if (distance < PILL_HALF) {
        opacity = 0;
      } else if (distance < PILL_HALF + TICK_FADE_BUFFER) {
        opacity = Math.round(((distance - PILL_HALF) / TICK_FADE_BUFFER) * 100) / 100;
      }
      if (opacity !== tick.opacity) {
        tick.opacity = opacity;
        tick.el.style.opacity = opacity === 1 ? "" : String(opacity);
      }
    }
  }

  private restoreTicks(): void {
    for (const tick of this.ticks ?? []) {
      if (tick.opacity !== 1) {
        tick.opacity = 1;
        tick.el.style.opacity = "";
      }
    }
  }
}
