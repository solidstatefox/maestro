import type { ChartCurve } from "@tanstack/charts";

type Point = readonly [number, number];

export const bumpPath = (points: readonly Point[]): string => {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (i === 0) { d = `M${x},${y}`; continue; }
    const [px, py] = points[i - 1];
    const mid = (px + x) / 2;
    d += `C${mid},${py},${mid},${y},${x},${y}`;
  }
  return d;
};

// Flow ribbons are stroked lines, so the area form is never drawn; the contract still asks for one.
export const BUMP_CURVE: ChartCurve = { line: bumpPath, area: (top) => bumpPath(top) };
