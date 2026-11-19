const CHART_1 = "var(--chart-1)";
/** The active gradient when `useGradient` has no `activeGradient`. Accepted divergence: bklit's default is lime → emerald hex; the kit's follows
 * the theme (`--chart-1` → `--chart-5`). */
export const THEME_GRADIENT: readonly [string, string] = [CHART_1, "var(--chart-5)"];
export const DEFAULT_INACTIVE_FILL_OPACITY = 0.8;
export const DEFAULT_ACTIVE_FILL_OPACITY = 1;
export const DEFAULT_LINEAR_HEIGHT = 24;
/** The arc's and the solid arc's track. Accepted divergence: bklit's linear track is `var(--chart-background)` (its own grey); here that is the
 * card itself, so on a Card the unfilled notches vanished. Every track takes the arc's `--border` (`--bkm-border`), the default the docs give
 * `inactiveFill`. */
export const TRACK_FILL = "var(--bkm-border)";

export interface FillOptions {
  readonly total: number;
  readonly useGradient: boolean;
  readonly activeGradient?: readonly [string, string];
  readonly inactiveGradient?: readonly [string, string];
  readonly activeFill?: string;
  readonly inactiveFill?: string;
  readonly linear: boolean;
  /** Paint (`url(#id)`) of the theme-palette gradient every active notch uses when `useGradient` has no `activeGradient`. */
  readonly themeGradientPaint: string;
}

const parseHex = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(hex.trim());
  if (!m) { return null; }
  const h = m[1].length === 3 ? m[1].replaceAll(/./gu, (c) => c + c) : m[1];
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
};

/** Interpolates two colours: hex pairs are lerped in sRGB, anything else (CSS vars) via color-mix. */
const mixColor = (a: string, b: string, t: number): string => {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (pa && pb) {
    return `rgb(${pa.map((c, i) => Math.round(c + (pb[i] - c) * t)).join(",")})`;
  }
  return `color-mix(in oklab, ${a} ${Math.round((1 - t) * 100)}%, ${b})`;
};

export const nonEmpty = (v: string | undefined): v is string => v !== undefined && v !== "";

/** Whether the active notches paint with the theme gradient (`useGradient`, no `activeGradient`, no `activeFill`). */
export const usesThemeGradient = (o: Pick<FillOptions, "useGradient" | "activeGradient" | "activeFill">): boolean =>
  o.useGradient && o.activeGradient === undefined && !nonEmpty(o.activeFill);

/** Notch `index`'s active and track paints. */
export const notchFills = (index: number, o: FillOptions): { readonly active: string; readonly track: string } => {
  const t = index / (o.total > 1 ? o.total - 1 : 1);
  const ag = o.activeGradient ?? THEME_GRADIENT;
  const ig = o.inactiveGradient ?? ag;
  let active = CHART_1;
  if (nonEmpty(o.activeFill)) { active = o.activeFill; } else if (usesThemeGradient(o)) { active = o.themeGradientPaint; } else if (o.useGradient) { active = mixColor(ag[0], ag[1], t); }
  let track = TRACK_FILL;
  if (nonEmpty(o.inactiveFill)) { track = o.inactiveFill; } else if (o.useGradient && o.activeGradient !== undefined) { track = mixColor(ig[0], ig[1], t); } else if (o.useGradient && o.linear) { track = CHART_1; }
  return { active, track };
};
