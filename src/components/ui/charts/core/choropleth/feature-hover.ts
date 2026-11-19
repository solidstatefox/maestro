import type { ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import { erase } from "../erased-types";
import { writePresence } from "../host-write";
import type { GeoGeometry, ProjectionHolder } from "./focus";
import { FeatureHighlight } from "./highlight";
import { createHoverStore } from "./hover-store";
import { FEATURES_ID, MARKERS_ID } from "./projection";
import { baseTooltipPoint } from "./tooltip-anchor";
import type { ChoroplethFeature, ChoroplethMarkerTooltipData, HoverStore } from "../types/choropleth";

export type RenderedChart = Pick<ChartRendererRenderContext<ChoroplethFeature, number, number>, "scene" | "interaction">;

/** The chart size the renderer measured. */
export interface ChoroplethSize {
  readonly width: number;
  readonly height: number;
}

export const ZERO_SIZE: ChoroplethSize = { height: 0, width: 0 };

interface FeatureHoverDeps {
  /** The chart's host (read at each focus). */
  readonly host: () => HTMLElement | null;
  readonly holder: ProjectionHolder;
  readonly geometry: GeoGeometry;
  /** A render measured a size more than half a pixel off the last one reported (the first: off `ZERO_SIZE`). */
  readonly onSize: (size: ChoroplethSize) => void;
  /** The stage's map layer, where the highlight path is drawn (stage.ts). */
  readonly layer: () => SVGGElement;
  /** Whether the hovered feature gets its highlight path (not when a dot grid draws the map: it lights the region's dots instead). */
  readonly highlights: () => boolean;
  /** The focused feature's index (null off one), after the host and the hover store are written: the dot grid lights it. */
  readonly onFeature: (index: number | null) => void;
}

interface FeatureHover {
  readonly hoverStore: HoverStore;
  /** The latest rendered chart's interaction controller (undefined before the first render). */
  readonly interaction: () => RenderedChart["interaction"] | undefined;
  /** The renderer's `onRender`. */
  readonly render: (context: Partial<RenderedChart>) => void;
  /** The renderer's `onFocusChange`, once the keyboard hold has seen the point. */
  readonly focusChange: (point: ChartPoint<ChoroplethFeature> | null) => void;
  /** The context's `setHoveredFeatureIndex`: focuses a feature by index through the native controller; null clears the mirror. */
  readonly setHoveredFeatureIndex: (index: number | null) => void;
  /** After a pan / zoom: a held feature the zoom carried out of view loses the focus. */
  readonly clearHidden: () => void;
  /** Starts mirroring the host's focus; returns its end, which also drops the focus the host shows (the renderer it mirrored is destroyed with it). */
  readonly attach: (host: HTMLElement) => () => void;
}

export function createFeatureHover({ host, holder, geometry, onSize, layer, highlights, onFeature }: FeatureHoverDeps): FeatureHover {
  let size = ZERO_SIZE;
  const hoverStore = createHoverStore();
  let rendered: RenderedChart | null = null;
  const highlight = new FeatureHighlight(FEATURES_ID, layer);
  return {
    attach: (el) => {
      return () => {
        highlight.hide();
        writePresence(el, "data-bkm-idle", false);
        writePresence(el, "data-hover", false);
        writePresence(el, "data-bkm-marker", false);
        rendered = null;
        hoverStore.set(null, null);
        hoverStore.setMarker(null);
      };
    },
    // Pan/zoom hands the renderer its options again without touching the definition (controller.ts `layout`), which repaints the held focus and re-runs `tooltipAnchor` (as bklit's zoom.applyToPoint);
    // a held feature the zoom carries out of view is cleared like bklit's mouseleave, and the next arrow starts from the first visible stop.
    clearHidden: () => {
      const held = hoverStore.tooltip?.feature;
      if (held === undefined || geometry.visible(held)) {return;}
      rendered?.interaction.setControlledFocus(null);
    },
    focusChange: (point) => {
      // bklit removes the tooltip the instant the pointer leaves a country (no exit); the native exit spring would
      // keep it up for ~270ms, so an idle flag on the host lets CSS drop it at once (no definition/framework work).
      const isFeature = point?.markId === FEATURES_ID;
      const onMarker = point?.markId === MARKERS_ID;
      const el = host();
      writePresence(el, "data-bkm-idle", !(isFeature || onMarker));
      writePresence(el, "data-bkm-marker", onMarker);
      // Presence only: the dim is one group-level rule (fades on enter, snaps on leave; a feature-to-feature move leaves it alone, so
      // only the highlight swaps, like bklit's highlighted path). A marker dims nothing (bklit's marker enter clears the feature hover).
      writePresence(el, "data-hover", isFeature);
      if (!isFeature) {
        highlight.hide();
        if (onMarker) {
          // SAFETY: the markers mark's datum is its marker's tooltip data (definition.ts).
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
          hoverStore.setMarker((point.datum.properties as unknown as { readonly marker: ChoroplethMarkerTooltipData }).marker);
        } else {
          hoverStore.set(null, null);
          hoverStore.setMarker(null);
        }
        onFeature(null);
        return;
      }
      const scene = rendered?.scene;
      if (scene && highlights()) { highlight.show(erase(scene), point.key); }
      // bklit's tooltipData: the clamped centroid in unzoomed space (consumers apply the zoom transform, as bklit's tooltip does).
      const base = baseTooltipPoint(holder, point.datum) ?? { x: point.x, y: point.y };
      hoverStore.set(point.datumIndex, { feature: point.datum, featureIndex: point.datumIndex, ...base });
      onFeature(point.datumIndex);
    },
    hoverStore,
    interaction: () => rendered?.interaction,
    render: ({ scene, interaction }) => {
      if (!scene || !interaction) {return;}
      rendered = { interaction, scene };
      holder.renderedPoints = scene.points;
      if (highlights()) {highlight.refresh(erase(scene));}
      if (Math.abs(size.width - scene.width) > 0.5 || Math.abs(size.height - scene.height) > 0.5) {
        size = { height: scene.height, width: scene.width };
        onSize(size);
      }
    },
    setHoveredFeatureIndex: (index) => {
      if (index === null || !rendered) {hoverStore.set(index, null); return;}
      const candidate = rendered.scene.points.find((p) => p.markId === FEATURES_ID && p.datumIndex === index);
      if (candidate) {rendered.interaction.setControlledFocus(candidate, { source: "programmatic" });}
    },
  };
}
