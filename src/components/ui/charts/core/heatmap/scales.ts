interface HeatmapLinearScale {
  (value: number): number;
  readonly domain: () => [number, number];
  readonly range: () => [number, number];
  readonly invert: (pixel: number) => number;
}

interface HeatmapTimeScale {
  (value: Date | number): number;
  readonly domain: () => [Date, Date];
  readonly range: () => [number, number];
  readonly invert: (pixel: number) => Date;
}

const linearScale = (domain: readonly [number, number], range: readonly [number, number]): HeatmapLinearScale => {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const map = (value: number): number => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
  const invert = (pixel: number): number => (r1 === r0 ? d0 : d0 + ((pixel - r0) / (r1 - r0)) * span);
  return Object.assign(map, { domain: (): [number, number] => [d0, d1], invert, range: (): [number, number] => [r0, r1] });
};

const timeScale = (domain: readonly [Date, Date], range: readonly [number, number]): HeatmapTimeScale => {
  const linear = linearScale([domain[0].getTime(), domain[1].getTime()], range);
  const map = (value: Date | number): number => linear(Number(value));
  return Object.assign(map, {
    domain: (): [Date, Date] => [domain[0], domain[1]],
    invert: (pixel: number): Date => new Date(linear.invert(pixel)),
    range: linear.range,
  });
};

export { linearScale, timeScale };
export type { HeatmapLinearScale, HeatmapTimeScale };
