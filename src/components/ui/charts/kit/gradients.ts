"use client";
// bklit's visx gradients as React config carriers (core/gradients.ts builds them): the chart reads a gradient's `<stop>` children into
// the `stops` the core builds from, so `url(#x)` resolves with no DOM <defs>.
import { Children, isValidElement } from "react";
import type { ReactNode, SVGProps } from "react";
import type { ChartGradientStop } from "@tanstack/charts";
import { gradientPresetRole, unit } from "../core/gradients";
import type { GradientPresetName } from "../core/gradients";
import type { GradientOwnProps, LinearGradientOwnProps, RadialGradientOwnProps } from "../core/types/gradients";
import { defineCarrier } from "./role";

type Length = string | number;

/**
 * Props of `LinearGradient`: the gradient options below plus any SVG `linearGradient` attribute. Attributes without a chart equivalent are accepted and ignored.
 */
// bklit's visx gradients pass every other SVG attribute through; the carriers accept them and ignore what has no native equivalent.
export type LinearGradientProps = LinearGradientOwnProps<ReactNode> & Omit<SVGProps<SVGLinearGradientElement>, keyof LinearGradientOwnProps<ReactNode> | "ref">;

/**
 * Props of `RadialGradient`: the gradient options below plus any SVG `radialGradient` attribute. Attributes without a chart equivalent are accepted and ignored.
 */
export type RadialGradientProps = RadialGradientOwnProps<ReactNode> & Omit<SVGProps<SVGRadialGradientElement>, keyof RadialGradientOwnProps<ReactNode> | "ref">;

/** A gradient's `<stop>` children as the core's `stops` (offset, color and opacity as authored); a gradient without children reads as written. */
const withStops = <Props extends GradientOwnProps<ReactNode>>(props: Props): Props | (Props & { readonly stops: ChartGradientStop[] }) => {
  if (props.children === undefined) {
    return props;
  }
  const stops: ChartGradientStop[] = [];
  Children.forEach(props.children, (child) => {
    if (!isValidElement<{ offset?: Length; stopColor?: string; stopOpacity?: number }>(child)) {
      return;
    }
    const { offset, stopColor, stopOpacity } = child.props;
    if (stopColor !== undefined) {
      const stop: ChartGradientStop = { offset: unit(offset, 0), color: stopColor };
      if (stopOpacity !== undefined) {
        stop.opacity = stopOpacity;
      }
      stops.push(stop);
    }
  });
  return { ...props, stops };
};

/**
 * Declares a linear gradient that chart elements reference as `fill="url(#id)"`. Place it as a child of the chart. It renders nothing itself.
 */
export const LinearGradient = /* @__PURE__ */ defineCarrier<LinearGradientProps>("linearGradient", "LinearGradient", withStops);
/**
 * Declares a radial gradient that chart elements reference as `fill="url(#id)"`. Place it as a child of the chart. It renders nothing itself.
 */
export const RadialGradient = /* @__PURE__ */ defineCarrier<RadialGradientProps>("radialGradient", "RadialGradient", withStops);

// The visx preset components accept every LinearGradient prop; from/to are optional.
const preset = (name: GradientPresetName): ReturnType<typeof defineCarrier<LinearGradientProps>> => defineCarrier<LinearGradientProps>(gradientPresetRole(name), name, withStops);

/**
 * Two-stop linear gradient preset from dark blue (#184E86) to green (#57CA85). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientDarkgreenGreen = /* @__PURE__ */ preset("GradientDarkgreenGreen");
/**
 * Two-stop linear gradient preset from light green (#42E695) to teal (#3BB2B8). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientLightgreenGreen = /* @__PURE__ */ preset("GradientLightgreenGreen");
/**
 * Two-stop linear gradient preset from yellow (#FCE38A) to red (#F38181). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientOrangeRed = /* @__PURE__ */ preset("GradientOrangeRed");
/**
 * Two-stop linear gradient preset from pink (#F02FC2) to blue (#6094EA). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientPinkBlue = /* @__PURE__ */ preset("GradientPinkBlue");
/**
 * Two-stop linear gradient preset from pink (#F54EA2) to red (#FF7676). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientPinkRed = /* @__PURE__ */ preset("GradientPinkRed");
/**
 * Two-stop linear gradient preset from purple (#7117EA) to orange (#EA6060). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientPurpleOrange = /* @__PURE__ */ preset("GradientPurpleOrange");
/**
 * Two-stop linear gradient preset from purple (#5B247A) to teal (#1BCEDF). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientPurpleTeal = /* @__PURE__ */ preset("GradientPurpleTeal");
/**
 * Two-stop linear gradient preset from steel (#65799B) to purple (#5E2563). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientSteelPurple = /* @__PURE__ */ preset("GradientSteelPurple");
/**
 * Two-stop linear gradient preset from teal (#17EAD9) to blue (#6078EA). Reference it as `fill="url(#your-id)"`. Accepts the `LinearGradient` props, and `from` / `to` override the preset colors.
 */
export const GradientTealBlue = /* @__PURE__ */ preset("GradientTealBlue");
