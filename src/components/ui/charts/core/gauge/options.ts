import type {
  GaugeCenterDiscOptions,
  GaugeDotsOptions,
  GaugeGlowOptions,
  GaugeNeedleOptions,
  GaugeNeedleVariant,
  GaugeProgressRingOptions,
  GaugeRulerOptions,
  GaugeSectorOptions,
} from "../types/gauge";

const layer = <T extends object>(value: boolean | T | undefined): T | null => {
  if (value === undefined || value === false) { return null; }
  return value === true ? ({} as T) : value;
};

export const resolveRuler = (v: boolean | GaugeRulerOptions | undefined): GaugeRulerOptions | null => layer(v);
export const resolveRing = (v: boolean | GaugeProgressRingOptions | undefined): GaugeProgressRingOptions | null => layer(v);
export const resolveDots = (v: boolean | GaugeDotsOptions | undefined): GaugeDotsOptions | null => layer(v);
export const resolveGlow = (v: boolean | GaugeGlowOptions | undefined): GaugeGlowOptions | null => layer(v);
export const resolveDisc = (v: boolean | GaugeCenterDiscOptions | undefined): GaugeCenterDiscOptions | null => layer(v);
export const resolveSector = (v: boolean | GaugeSectorOptions | undefined): GaugeSectorOptions | null => layer(v);

export const resolveNeedle = (v: boolean | GaugeNeedleVariant | GaugeNeedleOptions | undefined): GaugeNeedleOptions | null => {
  if (typeof v === "string") { return { variant: v }; }
  return layer(v);
};

/** With a centre disc, the sector starts at the disc's outer edge. */
export const fitSectorToDisc = (sector: GaugeSectorOptions | null, disc: GaugeCenterDiscOptions | null, size: number, outerRadius: number): GaugeSectorOptions | null => {
  if (sector === null || disc === null || outerRadius <= 0) { return sector; }
  const discEdge = size * (disc.radius ?? 0.19) + (disc.strokeWidth ?? 3) / 2;
  return { ...sector, innerRadius: Math.max(sector.innerRadius ?? 0, discEdge / outerRadius) };
};
