export interface SquareColumnLayout {
  /** Number of squares in the column. */
  count: number;
  /** Top offsets (relative to the column top), bottom square first. */
  positions: number[];
  /** Quantized column height in pixels. */
  columnHeight: number;
  squareSize: number;
  /** Effective gap between squares (fit mode redistributes it). */
  gap: number;
}

export interface SquareColumnInput {
  /** Raw bar length in pixels (baseline minus value). */
  barLengthPx: number;
  /** Square width and height, typically the bar width. */
  squareSize: number;
  /** Gap between stacked squares in pixels. */
  gap: number;
  /** Redistribute the gap so the column height matches `barLengthPx` exactly. */
  fit?: boolean;
}

/**
 * Quantize a bar length into a stack of square cells.
 * @internal
 */
export function computeSquareColumn({ barLengthPx, squareSize, gap, fit = false }: SquareColumnInput): SquareColumnLayout {
  if (barLengthPx <= 0 || squareSize <= 0) {
    return { count: 0, columnHeight: 0, positions: [], squareSize, gap };
  }
  const positions: number[] = [];
  if (fit) {
    const count = Math.max(1, Math.floor((barLengthPx + gap) / (squareSize + gap)));
    const effective = count > 1 ? Math.max(0, (barLengthPx - count * squareSize) / (count - 1)) : 0;
    const step = squareSize + effective;
    for (let i = 0; i < count; i += 1) {
      positions.push(barLengthPx - squareSize - i * step);
    }
    return { count, columnHeight: barLengthPx, positions, squareSize, gap: effective };
  }
  const step = squareSize + gap;
  const count = Math.max(1, Math.round(barLengthPx / step));
  const columnHeight = count * squareSize + Math.max(0, count - 1) * gap;
  for (let i = 0; i < count; i += 1) {
    positions.push(columnHeight - squareSize - i * step);
  }
  return { count, columnHeight, positions, squareSize, gap };
}

/**
 * Y centre of the topmost square in a vertical column.
 * @internal
 */
export function topSquareCenterY({ baselineY, ...input }: SquareColumnInput & { baselineY: number }): number {
  const { count, squareSize, columnHeight } = computeSquareColumn(input);
  return count === 0 ? baselineY : baselineY - columnHeight + squareSize / 2;
}

// --- 3D depth ---------------------------------------------------------

export const DEFAULT_GROUND_SHADOW = 0.26;
export const GLASS_TIP_OPACITY = 0.2;

/** Side-face depth is capped below the gap between neighbouring bars. */
function barDepthMaxDepth(step: number, bandWidth: number): number {
  const gap = Math.max(0, step - bandWidth);
  return Math.min(bandWidth * 0.22, Math.max(0, gap - 1), 7);
}

/** Depth grows with distance from the chart centre; the lid rises with it (bklit bar-depth-geometry.ts). */
function barDepthAndRise(absOffset: number, naturalHeight: number, maxDepth: number): Pick<DepthEntry, "depth" | "perspectiveRise"> {
  const offset = Math.min(1, Math.max(0, absOffset));
  const capped = Math.min(maxDepth, Math.max(0, naturalHeight));
  const depth = offset * capped;
  return { depth, perspectiveRise: depth * 0.45 };
}

export interface DepthEntry {
  readonly index: number;
  readonly label: string;
  readonly bandX: number;
  readonly bandWidth: number;
  readonly baselineY: number;
  readonly topY: number;
  readonly bottomY: number;
  readonly barHeight: number;
  readonly naturalHeight: number;
  readonly topYTrim: number;
  readonly depth: number;
  readonly perspectiveRise: number;
  readonly isNegative: boolean;
  readonly isRightOfCenter: boolean;
}

export interface DepthInput {
  readonly index: number;
  readonly label: string;
  readonly value: number;
  readonly bandX: number;
  readonly bandWidth: number;
  readonly step: number;
  readonly innerWidth: number;
  readonly plotLeft: number;
  readonly baselineY: number;
  readonly valueY: number;
  readonly minBarHeight: number;
  readonly topSegmentFraction?: number;
}

export function depthEntry(input: DepthInput): DepthEntry | undefined {
  const { value, bandX, bandWidth, step, innerWidth, plotLeft, baselineY, valueY, minBarHeight } = input;
  const isNegative = value < 0;
  const rawHeight = Math.abs(baselineY - valueY);
  const naturalHeight = isNegative ? rawHeight : Math.max(rawHeight, minBarHeight);
  if (Number.isNaN(naturalHeight) || naturalHeight <= 0) {
    return undefined;
  }
  const isFloored = !isNegative && rawHeight < naturalHeight;
  const maxDepth = barDepthMaxDepth(step, bandWidth);
  const centerX = plotLeft + innerWidth / 2;
  const cx = bandX + bandWidth / 2;
  const offset = innerWidth > 0 ? (cx - centerX) / (innerWidth / 2) : 0;
  const { depth, perspectiveRise: rawRise } = barDepthAndRise(Math.min(1, Math.abs(offset)), naturalHeight, maxDepth);
  const perspectiveRise = isNegative ? 0 : rawRise;
  const clampRef = input.topSegmentFraction === undefined ? naturalHeight : input.topSegmentFraction * naturalHeight;
  const trim = naturalHeight > 0 && !isNegative && !isFloored ? Math.min(perspectiveRise, Math.max(0, clampRef - 1)) : 0;
  const topY = isNegative ? baselineY : baselineY - naturalHeight + trim;
  const bottomY = isNegative ? baselineY + naturalHeight : baselineY;
  return {
    index: input.index,
    label: input.label,
    bandX,
    bandWidth,
    baselineY,
    topY,
    bottomY,
    barHeight: bottomY - topY,
    naturalHeight,
    topYTrim: trim,
    depth,
    perspectiveRise,
    isNegative,
    isRightOfCenter: offset > 0,
  };
}

type Pt = readonly [number, number];

/** Side parallelogram between two y spans (front edge at the bar, back edge shifted by depth / rise). */
export function sidePoints(e: DepthEntry, y1: number, y2: number): Pt[] {
  const { bandX, bandWidth, depth, perspectiveRise: r, isRightOfCenter } = e;
  if (isRightOfCenter) {
    return [[bandX, y1], [bandX - depth, y1 - r], [bandX - depth, y2 - r], [bandX, y2]];
  }
  return [[bandX + bandWidth, y1], [bandX + bandWidth + depth, y1 - r], [bandX + bandWidth + depth, y2 - r], [bandX + bandWidth, y2]];
}

export function lidPoints(e: DepthEntry): Pt[] {
  const { bandX, bandWidth, depth, perspectiveRise: r, topY, isRightOfCenter } = e;
  if (isRightOfCenter) {
    return [[bandX, topY], [bandX + bandWidth, topY], [bandX + bandWidth - depth, topY - r], [bandX - depth, topY - r]];
  }
  return [[bandX, topY], [bandX + bandWidth, topY], [bandX + bandWidth + depth, topY - r], [bandX + depth, topY - r]];
}
