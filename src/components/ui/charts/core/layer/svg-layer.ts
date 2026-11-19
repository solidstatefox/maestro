import type { ChartLayerRenderer, ChartSurface, SceneGroup, SceneNode } from "@tanstack/charts";
import { composeChartLayers } from "@tanstack/charts/layers";

export const SVG_NS = "http://www.w3.org/2000/svg";

/** Scene style key to SVG property, for the layers' `applyStyle`. */
export const STYLE_PROPERTIES = [
  ["fill", "fill"], ["fillOpacity", "fill-opacity"], ["stroke", "stroke"], ["strokeOpacity", "stroke-opacity"],
  ["strokeWidth", "stroke-width"], ["opacity", "opacity"], ["lineJoin", "stroke-linejoin"],
] as const;

export const setOrRemove = (element: Element, name: string, value: string | number | undefined): void => {
  if (value === undefined) { element.removeAttribute(name); } else { element.setAttribute(name, String(value)); }
};

/** Puts `element` at `cursor` in `parent` and returns the next cursor. */
const place = (parent: Element, element: Element, cursor: ChildNode | null): ChildNode | null => {
  if (element === cursor) { return cursor.nextSibling; }
  if (cursor === null) { parent.append(element); } else { cursor.before(element); }
  return cursor;
};

export const translateOf = (group: SceneGroup): string | undefined => {
  const { translateX = 0, translateY = 0 } = group;
  return translateX === 0 && translateY === 0 ? undefined : `translate(${translateX} ${translateY})`;
};

/** Walks `nodes` in order under `parent`, keyed by scene path: `paint` returns each node's element (or null to skip), and it is placed and marked in `seen`. */
export const paintKeyed = (
  nodes: readonly SceneNode[],
  parent: SVGElement,
  path: string,
  seen: Set<string>,
  paint: (node: SceneNode, id: string, path: string) => SVGElement | null,
): void => {
  let cursor: ChildNode | null = parent.firstChild;
  for (const node of nodes) {
    const id = `${path}/${node.key}`;
    const element = paint(node, id, path);
    if (element !== null) {
      seen.add(id);
      cursor = place(parent, element, cursor);
    }
  }
};

type Surface<Row> = ChartSurface<Row, number, number>;

/** The svg id prefix of a chart's `index`-th layer, as TanStack's compositor gives it (canvas.js `createLayeredChartRenderer`): the host
 * renderer's resources (a definition's gradients) carry it on the first layer. */
export const layerIdPrefix = (idPrefix: string | undefined, index: number): string => `${idPrefix ?? "ts-chart"}-layer-${index}`;

/** What a layer supplies per mount: its teardown and its per-scene paint (the viewBox is set before `render`). */
export type SvgLayerParts<Row> = Pick<Surface<Row>, "destroy" | "render">;

/** A chart-layer renderer whose child surface is one owned `<svg>`; `mount` builds the layer's state over it. */
export const createSvgLayer = <Row>(id: string, mount: (svg: SVGSVGElement, layer: ChartLayerRenderer<Row, number, number>) => SvgLayerParts<Row>): ChartLayerRenderer<Row, number, number> => {
  const layer: ChartLayerRenderer<Row, number, number> = {
    // TanStack's compositor (1.5, `@tanstack/charts/layers`, no Canvas code) stacks the host layers with this layer; this layer only
    // supplies the child surface. It keeps one composed renderer per host renderer, so the host's per-render `compose` returns the same
    // renderer and the mounted layers are reused (a fresh renderer each call made the host destroy and remount every layer per render).
    compose: composeChartLayers,
    id,
    kind: "chart-layer-renderer",
    mount: (container): Surface<Row> => {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.style.cssText = "display:block;overflow:visible;position:absolute;inset:0;width:100%;height:100%";
      container.replaceChildren(svg);
      const { destroy, render } = mount(svg, layer);
      return {
        destroy,
        element: svg,
        paintFocus: (): void => undefined,
        render: (scene, ...rest): void => {
          svg.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
          render(scene, ...rest);
        },
        renderer: layer,
        supportsStateFocus: true,
      };
    },
    prerender: () => "",
  };
  return layer;
};
