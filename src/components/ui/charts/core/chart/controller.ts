import type { ChildTable } from "../carriers/table";
import type { LegendHover } from "../legend/store";
import type { Readable } from "../store";
import type { TooltipTarget } from "../surface/tooltip-target";
import type { ChartConfigValue } from "../types/context";

/** What a chart's surroundings give its controller once, at creation. */
export interface ChartEnv {
  /** The chart's id: the `data-bkm-kit` scope of its owned CSS and the prefix of its svg ids (stable across server and client). */
  readonly uid: string;
  /** A static docs preview: no entrance (React: `StaticChartPreviewProvider`). */
  readonly staticPreview: boolean;
  /** The nearest chart config (React: `ChartConfigProvider`). */
  readonly config: ChartConfigValue;
  /** The legend hover the chart shows on its host (`data-bkm-legend`, `data-bkm-pl`); left out when the adapter writes it itself. */
  readonly legendHover?: Readable<LegendHover>;
  /** A development warning (once per message). */
  warn(message: string): void;
}

/** The elements an adapter rendered: the chart's host and the surface element the renderer mounts into (inside the host). */
export interface ChartDom {
  readonly host: HTMLElement;
  readonly surface: HTMLElement;
}

/** When the mounting pass started (`performance.now()`): motion's clock origin for the entrances a family aligns. */
export interface ChartClock {
  readonly renderStart: number;
}

/** What the adapter hands `update`: the chart's props and the carrier table it read (React) or its registry built (the ports). */
export interface ChartInput<Props> {
  readonly props: Props;
  readonly table: ChildTable;
}

export interface ChartController<Props, View, Ctx = never> {
  /** Phase-rate state the adapter renders (host attributes and style, surface box, loading chrome, resources); identity changes only with content. */
  readonly view: Readable<View>;
  /** The hovered tooltip target `{ element, body }`: the adapter's tooltip leaf portals the body into `element`. */
  readonly tooltip: Readable<TooltipTarget | null>;
  /** The chart's public context (`useChart()`, `usePie()`, …), built when read. */
  readonly context: Readable<Ctx | null>;
  /** The latest props and table. Synchronous; never calls back into a framework. */
  update(input: ChartInput<Props>): void;
  /** Mounts the renderer into `dom.surface` and takes over the host: its owned style, overlay, size variables and listeners, in today's
   * effect order, both draws before the first paint. Re-attachable after `detach` (StrictMode). */
  attach(dom: ChartDom, clock: ChartClock): void;
  /** The first post-paint moment after `attach`: arms the reveal. */
  mounted(): void;
  /** Undoes `attach` (and any timer it started); the controller can attach again. */
  detach(): void;
  /** The surface's server markup (React hydrates it). */
  prerender(): string;
}
