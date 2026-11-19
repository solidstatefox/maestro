import type { ArcDatum } from "./arcs";
import type { SunburstLabelsProps } from "../types/sunburst";
import { sunburstCssVars } from "./colors";
import type { SunburstNativeNode } from "./sunburst-mark";

/** Labels fade in once this fraction of the sweep has played. */
export const LABEL_START_RATIO = 0.85;
const DEFAULT_LABEL_FONT_SIZE = 11;
const LABEL_FONT_WEIGHT = 600;
const DEFAULT_LABEL_HALO = 2.5;

interface LabelsOption {
  readonly fill: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly nameOf: (node: SunburstNativeNode) => string;
  readonly classOf: (node: SunburstNativeNode) => string;
  /** The `SunburstLabels` className, on the group that holds the labels (bklit's `<g className>`). */
  readonly className: string | undefined;
}

/** The mark's label decoration for the `SunburstLabels` carrier, or undefined when the chart has none. */
export const labelsOption = (labels: SunburstLabelsProps | null, arcById: ReadonlyMap<string, ArcDatum>): LabelsOption | undefined =>
  labels === null
    ? undefined
    : {
        fill: labels.fill ?? sunburstCssVars.label,
        fontSize: labels.fontSize ?? DEFAULT_LABEL_FONT_SIZE,
        fontWeight: LABEL_FONT_WEIGHT,
        stroke: labels.stroke ?? sunburstCssVars.background,
        strokeWidth: labels.strokeWidth ?? DEFAULT_LABEL_HALO,
        nameOf: (node: SunburstNativeNode): string => arcById.get(node.id)?.name ?? node.name,
        classOf: (node: SunburstNativeNode): string => `bk-sb-l-${arcById.get(node.id)?.arcIndex ?? -1}`,
        className: labels.className === "" ? undefined : labels.className,
      };
