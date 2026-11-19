import { markupToString } from "../markup/node";
import { patternPresetTree } from "../markup/patterns";
import type { ChoroplethBackgroundProps } from "../types/choropleth";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_FADE = 10;
const MAX_FADE = 45;

const fadeEdge = (on = true, len = DEFAULT_FADE): number => (on ? Math.min(MAX_FADE, Math.max(0, len)) : 0);

export interface Backdrop {
  /** Draws `props` (none: removes it) as the host's first child. */
  readonly draw: (host: HTMLElement, props: ChoroplethBackgroundProps | undefined, uid: string) => void;
  readonly remove: () => void;
}

export function createBackdrop(): Backdrop {
  let root: SVGSVGElement | null = null;
  let drawn: ChoroplethBackgroundProps | undefined = undefined;
  const remove = (): void => {
    root?.remove();
    root = null;
    drawn = undefined;
  };
  return {
    draw: (host, props, uid) => {
      if (props === drawn && root?.parentNode === host) {return;}
      remove();
      drawn = props;
      if (props === undefined || props.showFill === false || props.pattern === "none") {return;}
      const { color = "var(--chart-grid)", complement, dotFill, fill, pattern = "diagonal", radius, scale = 1, strokeWidth, tileBackground, opacity = 1 } = props;
      const id = `${uid}-backdrop`;
      const tile = patternPresetTree(pattern, id, { color, complement, dotFill, fill, radius, scale, strokeWidth, tileBackground });
      if (tile === undefined) {return;}
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("class", "bkm-choro-bg");
      if (props.hideOnFocus === true) {svg.setAttribute("data-hide-on-focus", "");}
      const h = fadeEdge(props.fadeHorizontal, props.fadeHorizontalLength);
      const v = fadeEdge(props.fadeVertical, props.fadeVerticalLength);
      svg.innerHTML = `<defs>${markupToString(tile)}</defs><g class="bkm-bg" style="--bkm-bg-h:${h}%;--bkm-bg-v:${v}%"><rect width="100%" height="100%" style="fill:url(#${id});opacity:${opacity}"></rect></g>`;
      host.prepend(svg);
      root = svg;
    },
    remove,
  };
}
