const EPSILON = 1e-6;

interface Interval {
  readonly minimum: number;
  readonly maximum: number;
}

/** The offset across the axis of each circle at `positions` (pixels along the axis) with `radii`, `padding` px apart, centred on the axis. */
export function dodgeOffsets(positions: readonly number[], radii: readonly number[], padding: number): number[] {
  const offsets = positions.map(() => 0);
  const placed: number[] = [];
  for (const [index, measured] of positions.entries()) {
    const radius = radii[index] ?? 0;
    const forbidden: Interval[] = [];
    for (const other of placed) {
      const distance = radius + (radii[other] ?? 0) + padding;
      const delta = measured - (positions[other] ?? 0);
      if (Math.abs(delta) > distance) {
        continue;
      }
      const cross = Math.sqrt(Math.max(0, distance * distance - delta * delta));
      const at = offsets[other] ?? 0;
      forbidden.push({ minimum: at - cross, maximum: at + cross });
    }
    const candidates = [0, ...forbidden.flatMap((interval) => [interval.minimum, interval.maximum])];
    // Nearest the axis first; a tie keeps the earlier candidate (the stable sort), so the packing is deterministic.
    candidates.sort((a, b) => Math.abs(a) - Math.abs(b));
    const free = candidates.find((candidate) => forbidden.every((interval) => candidate <= interval.minimum + EPSILON || candidate >= interval.maximum - EPSILON));
    offsets[index] = free ?? 0;
    placed.push(index);
  }
  return offsets;
}
