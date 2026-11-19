import { clearAttribute, writeAttribute, writePresence } from "../host-write";
import { CLS, keyStarts } from "../renderer-dom";
import type { HeatmapHoverCoordinator } from "../types/heatmap";

const HOVER_ATTR = "data-hm-hover";
/** Present when a hover scales cells (`inactiveScale` or `activeScale` is not 1): only then do the cells take per-cell transforms. */
const SCALE_ATTR = "data-hm-scale";
/** Present while a cell is hovered on a chart whose hover scales cells: the other cells shrink (styles.css). Its own attribute, so the rule
 * reaching every cell is not keyed on `data-hm-hover`, whose every change would then restyle the grid. */
const SHRINK_ATTR = "data-hm-shrink";
/** Present when the marks group also holds separators or quarter labels, which never dim: the level groups dim instead (styles.css). */
const DECOR_ATTR = "data-hm-decor";

/** What the host attributes depend on beside the coordinator. */
export interface HeatmapHoverLook {
  /** A hover scales cells (`inactiveScale` or `activeScale` is not 1). */
  readonly scaled: boolean;
  /** The chart draws separators or quarter labels. */
  readonly decor: boolean;
}

/** Writes the coordinator's hover onto the host now and on every change (`data-hm-hover`, `data-hm-scale`, `data-hm-shrink`,
 * `data-hm-decor`); returns the unsubscribe. */
export const watchHeatmapHoverAttrs = (coordinator: HeatmapHoverCoordinator, host: () => HTMLElement | null, { scaled, decor }: HeatmapHoverLook): (() => void) => {
  const apply = (): void => {
    const el = host();
    if (el === null) {return;}
    writePresence(el, SCALE_ATTR, scaled);
    writePresence(el, DECOR_ATTR, decor);
    writePresence(el, SHRINK_ATTR, scaled && coordinator.getHoveredCell() !== null);
    if (coordinator.getHoveredCell() !== null) {
      writeAttribute(el, HOVER_ATTR, "cell");
    } else if (coordinator.getHoveredLegendLevel() === null) {
      clearAttribute(el, HOVER_ATTR);
    } else {
      writeAttribute(el, HOVER_ATTR, "level");
    }
  };
  apply();
  const off = coordinator.subscribe(apply);
  return () => {
    off();
    clearAttribute(host(), SCALE_ATTR);
    clearAttribute(host(), SHRINK_ATTR);
    clearAttribute(host(), DECOR_ATTR);
  };
};

/** The hovered legend level's rule: the other levels' groups dim (and, with `scaled`, their cells shrink and the level's grow); null when
 * no level is hovered. A hovered cell takes no rule: styles.css dims every group and the lift draws the cell. */
const heatmapLevelSheet = (idPrefix: string, level: number | null, scaled: boolean): string | null => {
  if (level === null) {return null;}
  const scope = `[data-bkm-chart="heatmap"][data-hm-id="${idPrefix}"][data-hm-hover="level"]`;
  const own = keyStarts(`heatmap-cells-l${level}-`);
  const others = `${scope} ${CLS.rect}${keyStarts("heatmap-cells-")}:not(${own})`;
  const dim = `${others}{opacity:var(--bkm-hm-inactive-o)}`;
  return scaled ? `${dim}${others} rect{transform:scale(var(--bkm-hm-inactive-s))}${scope} ${CLS.rect}${own} rect{transform:scale(var(--bkm-hm-active-s))}` : dim;
};

/** The hovered legend level's rule (`heatmapLevelSheet`) in a <style> the chart owns as the last child of `box` (its inner box), there only
 * while a level is hovered (after the loading label and the carriers, which render nothing); returns the unsubscribe, which removes it. */
export const watchHeatmapHoverSheet = (coordinator: HeatmapHoverCoordinator, box: HTMLElement, idPrefix: string, scaled: boolean): (() => void) => {
  const style = box.ownerDocument.createElement("style");
  const apply = (): void => {
    const sheet = heatmapLevelSheet(idPrefix, coordinator.getHoveredLegendLevel(), scaled);
    if (sheet === null) {
      style.remove();
      return;
    }
    if (style.textContent !== sheet) {style.textContent = sheet;}
    if (style.parentNode !== box) {box.append(style);}
  };
  apply();
  const off = coordinator.subscribe(apply);
  return () => {
    off();
    style.remove();
  };
};
