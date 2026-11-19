import { joinClasses } from "../cn";
import { memoCell, structuralCell } from "../memo";
import { px } from "../style";
import type { StyleObject } from "../style";
import { clamp01 } from "./geometry";
import { resolveDisc, resolveDots, resolveGlow, resolveNeedle, resolveRing, resolveRuler, resolveSector } from "./options";
import { gaugeAria } from "./props";
import type { ResolvedGaugeProps } from "./props";
import { activeNotchCount } from "./scene";
import type { GaugeAria, GaugeSpec } from "./scene";
import { FILL_ENTER_DELAY_MS, sweepKey, toSweepMotion } from "./transition";
import type { SweepMotion } from "./transition";

const ARC_MAX_WIDTH = 560;
/** bklit's fluid arc box (`aspect-[21/16]`). */
export const ARC_ASPECT = 21 / 16;
/** The size a fluid arc's server markup is drawn at (the svg scales to its box). */
const NOMINAL_ARC = { height: 320, width: 420 } as const;
const NOMINAL_LINEAR_WIDTH = 400;

/** The gauge's element styles (kebab-case, core/style.ts). */
export interface GaugeStyles {
  /** The root's: a fluid arc's min-width. */
  readonly root: StyleObject | undefined;
  /** The arc's renderer host, a size container. */
  readonly arcHost: StyleObject;
  /** The linear track, the renderer's host. */
  readonly track: StyleObject;
  /** A fluid linear gauge's box: `linearClip` without a label, `linearFlow` with one. */
  readonly linearClip: StyleObject;
  readonly linearFlow: StyleObject;
}

export interface GaugeModel {
  readonly linear: boolean;
  /** An arc fixed at `width` × `height`; a fluid one fills its parent at `ARC_ASPECT`. */
  readonly fixed: boolean;
  /** The linear track's thickness. */
  readonly trackHeight: number;
  readonly spec: GaugeSpec;
  readonly aria: GaugeAria;
  /** The sweep's targets: lit notches and the value (0–1). */
  readonly fill: number;
  readonly value: number;
  readonly motion: SweepMotion;
  /** The first sweep's wait after mount (ms). */
  readonly delayMs: number;
  /** Draw at the value at once (`geometryScrubbing`). */
  readonly instant: boolean;
  readonly rootClass: string;
  readonly arcHostClass: string;
  readonly styles: GaugeStyles;
  /** The drawing's size when the props fix it, else null (it follows its box), and the size of the server's markup. */
  readonly fixedSize: { readonly width: number; readonly height: number } | null;
  readonly nominalSize: { readonly width: number; readonly height: number };
}

export interface GaugeModelInput {
  readonly resolved: ResolvedGaugeProps<unknown>;
  /** The mount's id (server and client stable): the prefix of the drawing's defs' ids. */
  readonly idPrefix: string;
}

/** Functions (a ruler label's `format`) key on their source; everything else on its JSON. */
const keyOf = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => (typeof v === "function" ? String(v) : v));

/** The gauge's model builder: one per mount, fed on every render. */
export function createGaugeModel(): (input: GaugeModelInput) => GaugeModel {
  const specCell = structuralCell<GaugeSpec>();
  const motionCell = memoCell<SweepMotion>();
  const ariaCell = memoCell<GaugeAria>();
  const trackCell = memoCell<StyleObject>();
  const linearClipCell = memoCell<StyleObject>();
  const linearFlowCell = memoCell<StyleObject>();
  const arcRootCell = memoCell<StyleObject>();
  const arcHostCell = memoCell<StyleObject>();
  const fixedCell = memoCell<{ readonly width: number; readonly height: number } | null>();
  const nominalCell = memoCell<{ readonly width: number; readonly height: number }>();
  return ({ resolved, idPrefix }) => {
    const {
      orientation, value, totalNotches, spacing, notchCornerRadius, uniformWidth, startAngle, endAngle, useGradient, activeGradient, inactiveGradient,
      inactiveFill, activeFill, inactiveFillOpacity, activeFillOpacity, className, width, height, minWidth, notchLengthPercent, notchWidthPercent,
      linearHeight, enterTransition, enterStaggerScale, arcStyle, arcThickness, zones, zoneDisplay, geometryScrubbing,
    } = resolved;
    const linear = orientation === "linear";
    // Fluid linear gauges ignore `height` and use `linearHeight` (gauge.tsx); only a fixed `width` honours `height`.
    const trackHeight = linear && width === undefined ? linearHeight : (height ?? linearHeight);
    const fixed = width !== undefined && height !== undefined;
    // Linear notches are rectangles by default, arc notches tapered (bklit's `uniformWidth` defaults).
    const uniform = linear ? uniformWidth !== false : uniformWidth === true;
    // The dial layers are arc only (bklit ignores them on a linear track).
    const arc = !linear;
    const fresh: GaugeSpec = {
      activeOpacity: activeFillOpacity,
      arcStyle: arc ? arcStyle : "notches",
      arcThickness,
      cornerRadius: notchCornerRadius,
      disc: arc ? resolveDisc(resolved.centerDisc) : null,
      dots: arc ? resolveDots(resolved.dots) : null,
      endAngle,
      fills: { activeFill, activeGradient, inactiveFill, inactiveGradient, linear, themeGradientPaint: `url(#${idPrefix}-gauge-theme-active)`, total: totalNotches, useGradient },
      glow: arc ? resolveGlow(resolved.glow) : null,
      idPrefix,
      inactiveOpacity: inactiveFillOpacity,
      linear,
      needle: arc ? resolveNeedle(resolved.needle) : null,
      notchLengthPercent,
      notchWidthPercent,
      ring: arc ? resolveRing(resolved.progressRing) : null,
      ruler: arc ? resolveRuler(resolved.ruler) : null,
      sector: arc ? resolveSector(resolved.sector) : null,
      spacing,
      startAngle,
      total: totalNotches,
      uniformWidth: uniform,
      zoneDisplay,
      zones: arc ? zones : undefined,
    };
    const spec = specCell(fresh, keyOf(fresh));
    const { ariaLabel, ariaDescription } = gaugeAria(value, resolved.ariaLabel, resolved.ariaDescription);
    const aria = ariaCell([ariaLabel, ariaDescription], () => ({ description: ariaDescription, label: ariaLabel }));
    const motion = motionCell([sweepKey(enterTransition)], () => toSweepMotion(enterTransition));
    const fixedSize = fixedCell([linear, fixed, width, height, trackHeight], () => {
      if (linear) { return width === undefined ? null : { height: trackHeight, width }; }
      return fixed ? { height: height ?? 0, width: width ?? 0 } : null;
    });
    const nominalSize = nominalCell([linear, trackHeight], () => (linear ? { height: trackHeight, width: NOMINAL_LINEAR_WIDTH } : NOMINAL_ARC));

    // bklit's fixed-width linear gauge has no min-width (the minimum belongs to the fluid wrapper, `linearClip`).
    const track = trackCell([trackHeight, width], () => ({ height: px(trackHeight), width: width === undefined ? "100%" : px(width) }));
    const linearClip = linearClipCell([trackHeight, minWidth], () => ({ height: px(trackHeight), "min-width": px(minWidth ?? 200) }));
    const linearFlow = linearFlowCell([minWidth], () => ({ "min-width": px(minWidth ?? 200) }));
    const arcHost = arcHostCell([fixed, height, width], () => ({ "container-type": "size", ...(fixed ? { height: px(height), width: px(width) } : { "max-width": px(ARC_MAX_WIDTH) }) }));
    const root = linear || fixed ? undefined : arcRootCell([minWidth], () => ({ "min-width": px(minWidth ?? 300) }));

    return {
      arcHostClass: fixed ? "bk-gauge-host" : "bk-gauge-host bk-gauge-host-fluid",
      aria,
      delayMs: FILL_ENTER_DELAY_MS * Math.min(2.5, Math.max(0.25, enterStaggerScale)),
      fill: activeNotchCount(spec, value),
      fixed,
      fixedSize,
      instant: geometryScrubbing === true,
      linear,
      motion,
      nominalSize,
      rootClass: linear ? joinClasses("bk-gauge-flow", className) : joinClasses("bk-gauge", fixed ? "bk-gauge-fixed" : undefined, className),
      spec,
      styles: { arcHost, linearClip, linearFlow, root, track },
      trackHeight,
      value: clamp01(value / 100),
    };
  };
}
