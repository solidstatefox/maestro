import { scaleLinear } from "../scales";
import type { ScaleLinear } from "d3-scale";
import { DEFAULT_Y_AXIS_ID } from "./series";
import { gridLineStyle } from "./grid-guides";
import type { GridGuideProps } from "./grid-guides";

export interface YAxisProps {
  yAxisId?: string | number;
  orientation?: "left" | "right";
  numTicks?: number;
  formatLargeNumbers?: boolean;
  formatValue?: (value: number) => string;
}

/** `formatLargeNumbers`: thousands as `k` with one decimal where it is needed (1500 is "1.5k", 2000 is "2k").
 * Accepted divergence: bklit rounds to whole thousands (`(v / 1000).toFixed(0)`), which labels a 0-3000 axis "0, 500, 1k, 2k, 2k, 3k". */
export const formatTick = (value: number, large: boolean): string =>
  large && Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);

const axisIdOf = (config: YAxisProps): string => (config.yAxisId === undefined ? DEFAULT_Y_AXIS_ID : String(config.yAxisId));

/** The YAxis carrier of the default (left) axis id, if any. */
export const primaryYAxis = (yAxes: readonly YAxisProps[]): YAxisProps | undefined => yAxes.find((a) => axisIdOf(a) === DEFAULT_Y_AXIS_ID);

interface YScalesInput {
  readonly yDomains: ReadonlyMap<string, readonly [number, number]>;
  readonly yAxes: readonly YAxisProps[];
  readonly rowGuides: { readonly count: number; readonly native: boolean };
  readonly grid: GridGuideProps | undefined;
}

interface YTicks {
  readonly count: number;
  readonly size: 0;
  readonly format?: (value: number) => string;
}

interface YAxisOption {
  readonly line: false;
  readonly ticks: YTicks;
  readonly tickLabels: false | { readonly fontSize: 12; readonly opacity: 1; readonly thin: false };
}

interface YPlacement {
  readonly channel?: "y";
  readonly side?: "left" | "right";
}

interface YScaleOption extends YPlacement {
  readonly scale: ScaleLinear<number, number>;
  readonly grid?: ReturnType<typeof gridLineStyle> | false;
  readonly axis: YAxisOption | false;
}

/** `y` for the primary axis, `y:<id>` for the others (the shape `defineChart` reads `scales` in). */
export interface YScales {
  y: YScaleOption;
  [secondary: `y:${string}`]: YScaleOption;
}

function placementOf(config: YAxisProps | undefined, isPrimary: boolean): YPlacement {
  if (!isPrimary) {
    return { channel: "y", side: config?.orientation ?? "right" };
  }
  return config?.orientation ? { side: config.orientation } : {};
}

function axisOptionOf(config: YAxisProps | undefined, tick: YTicks): YAxisOption {
  if (!config) {
    return { line: false, ticks: tick, tickLabels: false };
  }
  const large = config.formatLargeNumbers !== false;
  const format = (v: number): string => (config.formatValue ? config.formatValue(v) : formatTick(v, large));
  // bklit y-axis.tsx:106-142 draws every scale tick, no collision test: keep all labels.
  return { line: false, ticks: { ...tick, format }, tickLabels: { fontSize: 12, opacity: 1, thin: false } };
}

function yScaleOption(args: YScalesInput, id: string): YScaleOption {
  const config = args.yAxes.find((a) => axisIdOf(a) === id);
  const domain = args.yDomains.get(id) ?? [0, 100];
  const isPrimary = id === DEFAULT_Y_AXIS_ID;
  const tick: YTicks = { count: isPrimary ? args.rowGuides.count : (config?.numTicks ?? 5), size: 0 };
  return {
    scale: scaleLinear().domain([...domain]),
    grid: isPrimary && args.rowGuides.native && args.grid ? gridLineStyle(args.grid) : false,
    axis: axisOptionOf(config, tick),
    ...placementOf(config, isPrimary),
  };
}

export function buildYScales(args: YScalesInput): YScales {
  const secondary: Record<`y:${string}`, YScaleOption> = {};
  let primary: YScaleOption | undefined;
  for (const id of args.yDomains.keys()) {
    if (id === DEFAULT_Y_AXIS_ID) {
      primary = yScaleOption(args, id);
    } else {
      secondary[`y:${id}`] = yScaleOption(args, id);
    }
  }
  return { ...secondary, y: primary ?? { scale: scaleLinear().domain([0, 100]), axis: false } };
}
