import type { ChartGradient, ChartGradientStop, ChartLinearGradient, ChartRadialGradient } from "@tanstack/charts";
import { isNumber, leadingFloat } from "./guards";
import { propsFor } from "./carriers/table";
import type { ChildTable } from "./carriers/table";
import type { GradientOwnProps, LinearGradientOwnProps, RadialGradientOwnProps } from "./types/gradients";

type Length = string | number;

/** A gradient carrier's props as the chart reads them: its authored stops in `stops` (React reads them from its `<stop>` children, react/kit/gradients.ts). */
interface GradientInput extends GradientOwnProps<unknown> {
  readonly stops?: readonly ChartGradientStop[];
}

type LinearGradientInput = GradientInput & LinearGradientOwnProps<unknown>;
type RadialGradientInput = GradientInput & RadialGradientOwnProps<unknown>;

const PRESET_PREFIX = "gradientPreset:";

/** Fixed two-stop linear presets, colors copied from @visx/gradient. */
const PRESETS = {
  GradientDarkgreenGreen: ["#184E86", "#57CA85"],
  GradientLightgreenGreen: ["#42E695", "#3BB2B8"],
  GradientOrangeRed: ["#FCE38A", "#F38181"],
  GradientPinkBlue: ["#F02FC2", "#6094EA"],
  GradientPinkRed: ["#F54EA2", "#FF7676"],
  GradientPurpleOrange: ["#7117EA", "#EA6060"],
  GradientPurpleTeal: ["#5B247A", "#1BCEDF"],
  GradientSteelPurple: ["#65799B", "#5E2563"],
  GradientTealBlue: ["#17EAD9", "#6078EA"],
} as const satisfies Record<string, readonly [string, string]>;

export type GradientPresetName = keyof typeof PRESETS;

/** The role of a preset's carrier: its colors are the defaults of `from` and `to`. */
export const gradientPresetRole = (name: GradientPresetName): string => `${PRESET_PREFIX}${name}`;

/** "50%" -> 0.5, "0.25" -> 0.25, 1 -> 1. Undefined/NaN -> fallback. */
export function unit(value: Length | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (isNumber(value)) {
    return Number.isFinite(value) ? value : fallback;
  }
  const trimmed = value.trim();
  const parsed = leadingFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return trimmed.endsWith("%") ? parsed / 100 : parsed;
}

function stopsOf(props: GradientInput, defaults?: readonly [string, string]): ChartGradient["stops"] {
  const authored = props.stops ?? [];
  if (authored.length > 0) {
    return authored;
  }
  return [
    { offset: unit(props.fromOffset, 0), color: props.from ?? defaults?.[0] ?? "currentColor", opacity: unit(props.fromOpacity, 1) },
    { offset: unit(props.toOffset, 1), color: props.to ?? defaults?.[1] ?? "currentColor", opacity: unit(props.toOpacity, 1) },
  ];
}

/** visx: `transform` overrides `rotate`; only `rotate(a)` maps onto the native gradient vector. */
function rotationOf(props: GradientInput): number {
  const raw = props.transform === undefined ? props.rotate : /rotate\(\s*(-?[\d.]+)/u.exec(props.transform)?.[1];
  return raw === undefined ? 0 : Number(raw);
}

function rotateAboutOrigin(x: number, y: number, degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

function linear(props: LinearGradientInput, defaults?: readonly [string, string]): ChartLinearGradient {
  const explicit = [props.x1, props.y1, props.x2, props.y2].some((v) => v !== undefined && v !== 0 && v !== "0");
  const vertical = props.vertical !== false && !explicit;
  let x1 = vertical ? 0 : unit(props.x1, 0);
  let y1 = vertical ? 0 : unit(props.y1, 0);
  let x2 = vertical ? 0 : unit(props.x2, 1);
  let y2 = vertical ? 1 : unit(props.y2, 0);
  const degrees = rotationOf(props);
  if (Number.isFinite(degrees) && degrees !== 0) {
    [x1, y1] = rotateAboutOrigin(x1, y1, degrees);
    [x2, y2] = rotateAboutOrigin(x2, y2, degrees);
  }
  return { id: props.id, type: "linear", x1, y1, x2, y2, stops: stopsOf(props, defaults) };
}

function radial(props: RadialGradientInput): ChartRadialGradient {
  const gradient: ChartRadialGradient = {
    id: props.id,
    type: "radial",
    cx: unit(props.cx, 0.5),
    cy: unit(props.cy, 0.5),
    r: unit(props.r, 0.5),
    stops: stopsOf(props),
  };
  if (props.fx !== undefined) {
    gradient.fx = unit(props.fx, 0.5);
  }
  if (props.fy !== undefined) {
    gradient.fy = unit(props.fy, 0.5);
  }
  return gradient;
}

const isPresetName = (name: string): name is GradientPresetName => name in PRESETS;

const gradientsOfRole = (table: ChildTable, role: string): ChartGradient[] => {
  if (role === "linearGradient") {
    return propsFor<LinearGradientInput>(table, role).map((p) => linear(p));
  }
  if (role === "radialGradient") {
    return propsFor<RadialGradientInput>(table, role).map((p) => radial(p));
  }
  if (role.startsWith(PRESET_PREFIX)) {
    const name = role.slice(PRESET_PREFIX.length);
    const defaults = isPresetName(name) ? PRESETS[name] : undefined;
    return propsFor<LinearGradientInput>(table, role).map((p) => linear(p, defaults));
  }
  return [];
};

/** Every user-declared gradient in a chart's children, as native definition resources. */
export const userGradients = (table: ChildTable): ChartGradient[] => [...table.keys()].flatMap((role) => gradientsOfRole(table, role));

/** True when a paint is `url(#id)` (resolved against the chart's gradient resources). */
export const isGradientRef = (paint: string | undefined): paint is string => paint?.startsWith("url(#") === true;
