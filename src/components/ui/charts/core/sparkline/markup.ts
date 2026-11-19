import { el, markupToString } from "../markup/node";
import type { MarkupChild, MarkupNode } from "../markup/node";
import type { AnySparklineProps } from "../types/sparkline";
import { computeSparklineDomain, computeSparklineLayout, describeSparkline, resolveSparklineValues } from "./geometry";
import type { SparklineLayout } from "./geometry";
import { SPARKLINE_LINE_DASH, sparklineDotAttrs, sparklineLook, sparklineStrokeAttrs } from "./look";
import type { SparklineKind, SparklineLook } from "./look";
import { sparklineAreaPath, sparklineBarsPath, sparklineLinePath } from "./paths";

/** The host's attributes the controller writes on attach (`listen`), for the server to write first. */
export interface SparklineHostAttrs {
  readonly role: "img";
  readonly "aria-label": string;
  readonly tabindex?: 0;
  readonly "data-interactive"?: "";
}

const UNSAFE_ID = /[^\w-]/g;

/** The area's gradient id from the framework's hydration-stable id (React's `useId`, Vue's `useId`, Svelte's `$props.id()`, Solid's `createUniqueId`). */
export const sparklineFillId = (idPrefix: string): string => `bkm-sp-${idPrefix.replaceAll(UNSAFE_ID, "_")}-fill`;

/** The host's role, label and tab stop, as the controller's `listen` writes them. */
export function sparklineHostAttrs<T>(props: AnySparklineProps<T>): SparklineHostAttrs {
  const label = props["aria-label"] ?? props.ariaLabel ?? describeSparkline(resolveSparklineValues(props.data, props.dataKey));
  return props.interactive === false ? { role: "img", "aria-label": label } : { role: "img", "aria-label": label, tabindex: 0, "data-interactive": "" };
}

const lastDefined = (l: SparklineLayout) => l.points.findLast((point) => Number.isFinite(point.y));

/** The series: the line's path, the area's group (fill, then stroke) or the bars' group. */
const series = (kind: SparklineKind, look: SparklineLook, layout: SparklineLayout, fillId: string): MarkupNode => {
  if (kind === "bar") {
    return el("g", {}, [el("path", { "data-fade": "", fill: look.color, d: sparklineBarsPath(layout, look.barGap, look.barRadius) })]);
  }
  const line = sparklineLinePath(layout.points, look.curve);
  if (kind === "line") {
    return el("path", { "data-fade": "", ...sparklineStrokeAttrs(look), ...SPARKLINE_LINE_DASH, d: line });
  }
  const fill = look.fill === "gradient" ? { fill: `url(#${fillId})`, "fill-opacity": 1 } : { fill: look.color, "fill-opacity": look.fillOpacity };
  return el("g", { "data-fade": "" }, [
    el("path", { ...fill, d: sparklineAreaPath(layout.points, look.curve, layout.baselineY) }),
    el("path", { ...sparklineStrokeAttrs(look), d: line }),
  ]);
};

/**
 * The svg a sparkline of `props.width` draws at rest, or `null` without a fixed width (it is measured on the client). The enter is not in
 * it: a hydrated sparkline is already on screen, so the controller doesn't play it again. A controlled `hoverIndex` is drawn by the
 * client after it adopts the svg; the server writes the resting sparkline (with its end dot).
 */
export function sparklineSvgTree<T>(kind: SparklineKind, props: AnySparklineProps<T>, idPrefix: string): MarkupNode | null {
  const width = props.width;
  if (width === undefined || !(width > 0)) {
    return null;
  }
  const look = sparklineLook(kind, props);
  const values = resolveSparklineValues(props.data, props.dataKey);
  const layout = computeSparklineLayout(values, width, look.height, look.padding, computeSparklineDomain(values, look.yMin, look.yMax, kind === "bar"), kind === "bar" ? "band" : "point");
  const fillId = sparklineFillId(idPrefix);
  const children: MarkupChild[] = [];
  if (kind === "area" && look.fill === "gradient") {
    children.push(
      el("defs", {}, [
        el("linearGradient", { id: fillId, x1: 0, x2: 0, y1: 0, y2: 1 }, [
          el("stop", { "stop-color": look.color, "stop-opacity": look.fillOpacity }),
          el("stop", { offset: 1, "stop-opacity": 0, "stop-color": look.color }),
        ]),
      ]),
    );
  }
  children.push(series(kind, look, layout, fillId));
  const last = lastDefined(layout);
  const hovering = props.hoverIndex !== undefined && props.hoverIndex !== null && layout.points[props.hoverIndex] !== undefined;
  if (look.endDot && !hovering && last !== undefined) {
    children.push(el("circle", { ...sparklineDotAttrs(look), cx: last.x, cy: last.y }));
  }
  return el("svg", { "aria-hidden": "true", width, height: look.height }, children);
}

/** `sparklineSvgTree` as markup, `""` without a fixed width: what a framework writes into the host on the server. */
export const sparklineServerMarkup = <T>(kind: SparklineKind, props: AnySparklineProps<T>, idPrefix: string): string => {
  const tree = sparklineSvgTree(kind, props, idPrefix);
  return tree === null ? "" : markupToString(tree);
};
