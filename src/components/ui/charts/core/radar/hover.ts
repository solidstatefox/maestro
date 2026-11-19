import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import { clearAttribute, raiseAttribute, readHoverIndex, writeAttribute, writeHoverIndex, writeVar } from "../host-write";
import { createHoverSource } from "../polar/hover";
import type { HoverSource } from "../polar/hover";
import { radarAreaColor } from "./area";
import type { RadarAreaProps } from "./area";
import { isAreaPoint, LABEL_MARK_ID } from "./definition";
import { MAX_SERIES } from "./hover-css";
import { springRadarHover } from "./hover-springs";
import type { RadarData, RadarRow } from "./rows";

const GLOW_ATTR = "data-bkm-glow";
/** The metric index of the axis label under the pointer (interactive labels brighten it, hover-css.ts). */
const LABEL_ATTR = "data-bkm-label";

type RadarRenderContext = ChartRendererRenderContext<RadarRow, string | number, number>;
type RadarPoint = ChartPoint<RadarRow, string | number, number>;

/** What the hover reads of the chart's latest input. */
interface RadarHoverProps {
  /** Defined: the hover is controlled. */
  readonly hoveredIndex?: number | null;
  readonly onHoverChange?: (index: number | null) => void;
  /** The RadarArea carriers' props: the hovered series' glow. */
  readonly areas: readonly RadarAreaProps[];
  readonly data: readonly RadarData[];
}

interface RadarHover {
  readonly source: HoverSource;
  /** The chart's latest input, on every input (each pass, as React's refs held them). */
  readonly update: (props: Readonly<RadarHoverProps>) => void;
  /** The renderer's `onRender`: the scene and interaction controller the setters focus through. */
  readonly onRender: (context: RadarRenderContext) => void;
  /** The renderer's interaction controller, once it has rendered (tap focus, keyboard hold). */
  readonly interaction: () => RadarRenderContext["interaction"] | undefined;
  /** The native `onFocusChange`: a change of series reaches an uncontrolled store and `onHoverChange`. */
  readonly focusChange: (point: RadarPoint | null) => void;
  /** Mirrors the store onto the host now and on every change (imperative: no render). Returns the unsubscribe. */
  readonly mirror: (host: () => HTMLElement | null) => () => void;
  /** A controlled `hoveredIndex` into the store (the controller's passive half, on the prop's change). */
  readonly control: (hoveredIndex: number | null | undefined) => void;
  /** A controlled `hoveredIndex` into the renderer's focus, unless the renderer reported it (the controller's passive half, on the prop's change). */
  readonly focusControlled: (hoveredIndex: number | null | undefined) => void;
  /** `useRadar().setHoveredIndex`: focuses series `index` (null clears) through the renderer. */
  readonly setHoveredIndex: (index: number | null) => void;
}

export const createRadarHover = (): RadarHover => {
  const source = createHoverSource();
  let props: Readonly<RadarHoverProps> = { areas: [], data: [] };
  let scene: RadarRenderContext | null = null;
  // The series the renderer last reported (or a controlled index last pushed to it): nothing at first.
  let lastReported: number | null = null;
  // The mirrored host (from `mirror`), where the label under the pointer is written.
  let mirrored: (() => HTMLElement | null) | null = null;
  let lastLabel: number | null = null;
  const writeLabel = (label: number | null): void => {
    if (label === lastLabel) { return; }
    lastLabel = label;
    const el = mirrored?.() ?? null;
    if (el === null) { return; }
    if (label === null) { clearAttribute(el, LABEL_ATTR); } else { writeAttribute(el, LABEL_ATTR, String(label)); }
  };
  const focusSeries = (index: number | null): void => {
    if (!scene) { return; }
    const point = index === null ? null : scene.scene.points.find((p) => isAreaPoint(p) && p.datum.series === index) ?? null;
    scene.interaction.setControlledFocus(point, { source: "pointer" });
  };
  return {
    source,
    update: (next) => { props = next; },
    onRender: (context) => { scene = context; },
    interaction: () => scene?.interaction,
    focusChange: (point) => {
      writeLabel(point?.markId === LABEL_MARK_ID ? point.datumIndex : null);
      const next = point && isAreaPoint(point) ? point.datum.series : null;
      if (lastReported === next) { return; }
      lastReported = next;
      if (props.hoveredIndex === undefined) { source.setHovered(next); }
      props.onHoverChange?.(next);
    },
    mirror: (host) => {
      mirrored = host;
      const apply = (): void => {
        const el = host();
        if (!el) { return; }
        const raw = source.getHovered();
        const index = raw === null || raw >= MAX_SERIES ? null : raw;
        const previous = readHoverIndex(el);
        writeHoverIndex(el, index);
        springRadarHover(el, previous, index);
        if (index === null) {
          clearAttribute(el, GLOW_ATTR);
          return;
        }
        const area = props.areas.find((a) => a.index === index);
        // Host glow attribute (UPSTREAM-GAPS #31: a mark `states` glow would repaint the scene on hover).
        // bklit #294: off unless the RadarArea asks for it.
        if (area?.showGlow === true) { raiseAttribute(el, GLOW_ATTR); } else { clearAttribute(el, GLOW_ATTR); }
        if (area !== undefined) { writeVar(el, "--bkm-radar-glow", radarAreaColor(area, props.data)); }
      };
      apply();
      const off = source.subscribe(apply);
      return (): void => {
        off();
        if (mirrored === host) { mirrored = null; }
        lastLabel = null;
      };
    },
    control: (hoveredIndex) => {
      if (hoveredIndex !== undefined) { source.setHovered(hoveredIndex); }
    },
    focusControlled: (hoveredIndex) => {
      if (hoveredIndex === undefined || lastReported === hoveredIndex) { return; }
      lastReported = hoveredIndex;
      focusSeries(hoveredIndex);
    },
    setHoveredIndex: focusSeries,
  };
};
