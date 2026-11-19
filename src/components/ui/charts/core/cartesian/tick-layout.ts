const MAX_GAP_LAYOUTS = 400;

interface LayoutScore {
  readonly score: number;
  readonly symmetryPenalty: number;
  readonly countDistance: number;
  readonly edgePreference: number;
}

const binomial = (n: number, k: number): number => {
  if (k < 0 || k > n) {
    return 0;
  }
  let result = 1;
  for (let i = 0; i < k; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
};

const composePositiveSum = (sum: number, parts: number): number[][] => {
  if (parts === 1) {
    return sum >= 1 ? [[sum]] : [];
  }
  const layouts: number[][] = [];
  for (let gap = 1; gap <= sum - (parts - 1); gap += 1) {
    for (const tail of composePositiveSum(sum - gap, parts - 1)) {
      layouts.push([gap, ...tail]);
    }
  }
  return layouts;
};

const gapsToIndices = (gaps: readonly number[]): number[] => {
  const indices = [0];
  let position = 0;
  for (const gap of gaps) {
    position += gap;
    indices.push(position);
  }
  return indices;
};

const indicesForTickCount = (length: number, tickCount: number): number[] => {
  const span = length - 1;
  if (span <= 0) {
    return [0];
  }
  const raw = Array.from({ length: tickCount }, (_unused, index) => Math.round((index / (tickCount - 1)) * span));
  const indices = [...new Set(raw)].sort((a, b) => a - b);
  if (indices[0] !== 0) {
    indices.unshift(0);
  }
  if (indices.at(-1) !== span) {
    indices.push(span);
  }
  return [...new Set(indices)].sort((a, b) => a - b);
};

const allIndexLayouts = (length: number, tickCount: number): number[][] => {
  const span = length - 1;
  if (span <= 0) {
    return [[0]];
  }
  const gapCount = tickCount - 1;
  if (gapCount <= 0) {
    return [[0]];
  }
  if (binomial(span - 1, gapCount - 1) > MAX_GAP_LAYOUTS) {
    return [indicesForTickCount(length, tickCount)];
  }
  return composePositiveSum(span, gapCount).map(gapsToIndices);
};

const indexGaps = (indices: readonly number[]): number[] => {
  const gaps: number[] = [];
  for (let i = 1; i < indices.length; i += 1) {
    gaps.push((indices[i]) - (indices[i - 1]));
  }
  return gaps;
};

const smallestGapEdgePreference = (indices: readonly number[]): number => {
  const gaps = indexGaps(indices);
  const at = gaps.indexOf(Math.min(...gaps));
  if (at === gaps.length - 1) {
    return 0;
  }
  return at === 0 ? 1 : 2;
};

const scoreLayout = (indices: readonly number[], xPx: (index: number) => number, targetCount: number): LayoutScore => {
  if (indices.length < 2) {
    const inf = Number.POSITIVE_INFINITY;
    return { score: inf, symmetryPenalty: inf, countDistance: inf, edgePreference: inf };
  }
  const pixelGaps: number[] = [];
  for (let i = 1; i < indices.length; i += 1) {
    pixelGaps.push(xPx(indices[i]) - xPx(indices[i - 1]));
  }
  const minGap = Math.min(...pixelGaps);
  const maxGap = Math.max(...pixelGaps);
  const meanGap = pixelGaps.reduce((sum, gap) => sum + gap, 0) / pixelGaps.length;
  const spreadRatio = meanGap > 0 ? (maxGap - minGap) / meanGap : maxGap - minGap;
  const countDistance = Math.abs(indices.length - targetCount);
  const gaps = indexGaps(indices);
  const smallestIndex = gaps.indexOf(Math.min(...gaps));
  const interiorPenalty = smallestIndex > 0 && smallestIndex < gaps.length - 1 ? 0.08 : 0;
  const symmetryPenalty = gaps.reduce((penalty, gap, index) => penalty + Math.abs(gap - (gaps.at(-1 - index) ?? gap)), 0) / gaps.length;
  return {
    score: spreadRatio + 0.1 * countDistance + interiorPenalty + symmetryPenalty * 0.02,
    symmetryPenalty,
    countDistance,
    edgePreference: smallestGapEdgePreference(indices),
  };
};

const isBetter = (next: LayoutScore, best: LayoutScore, nextCount: number, bestCount: number): boolean => {
  if (next.score < best.score - 1e-6) {
    return true;
  }
  if (Math.abs(next.score - best.score) > 1e-6) {
    return false;
  }
  if (nextCount !== bestCount) {
    return nextCount < bestCount;
  }
  if (Math.abs(next.symmetryPenalty - best.symmetryPenalty) > 1e-6) {
    return next.symmetryPenalty < best.symmetryPenalty;
  }
  return next.edgePreference < best.edgePreference;
};

/** `labels[i]` is the formatted label of row i; rows with a repeated label are dropped from a layout. */
export function selectEvenlySpacedIndices(length: number, targetCount: number, labels: readonly string[], xPx: (index: number) => number): number[] {
  if (length <= 0) {
    return [];
  }
  if (length === 1) {
    return [0];
  }
  if (length <= targetCount) {
    return Array.from({ length }, (_unused, index) => index);
  }
  const dedupe = (indices: readonly number[]): number[] => {
    const seen = new Set<string>();
    const out: number[] = [];
    for (const index of indices) {
      const label = labels[index] ?? String(index);
      if (!seen.has(label)) {
        seen.add(label);
        out.push(index);
      }
    }
    return out;
  };
  const minCount = Math.max(2, targetCount - 1);
  const maxCount = Math.min(length, targetCount + 1);
  let bestIndices = indicesForTickCount(length, targetCount);
  let bestScore = scoreLayout(bestIndices, xPx, targetCount);
  let bestCount = bestScore.countDistance;
  for (let tickCount = minCount; tickCount <= maxCount; tickCount += 1) {
    for (const raw of allIndexLayouts(length, tickCount)) {
      const indices = dedupe(raw);
      if (indices.length < 2) {
        continue;
      }
      const layoutScore = scoreLayout(indices, xPx, targetCount);
      const countDistance = Math.abs(indices.length - targetCount);
      if (isBetter(layoutScore, bestScore, countDistance, bestCount)) {
        bestIndices = indices;
        bestScore = layoutScore;
        bestCount = countDistance;
      }
    }
  }
  return bestIndices;
}
