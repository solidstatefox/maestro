"use client";
// The Background child: using it is what bundles the pattern rect, its mask CSS and the pattern presets (core/cartesian/enable-background.ts).
import { defineCarrier } from "../role";
import type { BackgroundConfig } from "../../core/types/cartesian";
import { enableBackground } from "../../core/cartesian/enable-background";

/** A background fill behind the plot area, as a solid color, gradient or pattern. It renders nothing itself; place it as a child of the chart. */
export const Background = /* @__PURE__ */ defineCarrier<Readonly<BackgroundConfig>>("background", "Background", undefined, enableBackground);
