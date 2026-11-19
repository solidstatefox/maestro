const binKey = (x: number, y: number, r: number): string => {
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  let py = y / dy;
  let pj = Math.round(py);
  let px = x / dx - (pj & 1) / 2;
  let pi = Math.round(px);
  const py1 = py - pj;
  if (Math.abs(py1) * 3 > 1) {
    const px1 = px - pi;
    const pi2 = pi + (px < pi ? -1 : 1) / 2;
    const pj2 = pj + (py < pj ? -1 : 1);
    const px2 = px - pi2;
    const py2 = py - pj2;
    if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) {
      pi = pi2 + (pj & 1 ? 1 : -1) / 2;
      pj = pj2;
    }
  }
  px = pi;
  py = pj;
  return `${px}:${py}`;
};

export interface LatticeInput {
  /** Each observation's pixel position, or null when it has none. */
  readonly points: readonly ({ readonly x: number; readonly y: number; readonly value: number } | null)[];
  readonly radius: number;
  readonly reduce: "count" | "sum" | "mean";
}

/** The bin values the lattice makes of `points`, ascending. */
export const latticeValues = ({ points, radius, reduce }: LatticeInput): number[] => {
  const bins = new Map<string, { count: number; sum: number }>();
  for (const point of points) {
    if (point === null) { continue; }
    const key = binKey(point.x, point.y, radius);
    const bin = bins.get(key);
    if (bin === undefined) {
      bins.set(key, { count: 1, sum: point.value });
    } else {
      bin.count += 1;
      bin.sum += point.value;
    }
  }
  const values: number[] = [];
  for (const bin of bins.values()) {
    values.push(reduce === "count" ? bin.count : reduce === "sum" ? bin.sum : bin.sum / bin.count);
  }
  return values.sort((a, b) => a - b);
};

/** A pointy-topped hexagon's outline around (cx, cy). */
export const hexagonPath = (cx: number, cy: number, r: number): string => {
  const parts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i * Math.PI) / 3;
    const x = cx + Math.sin(angle) * r;
    const y = cy - Math.cos(angle) * r;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `${parts.join("")}Z`;
};
