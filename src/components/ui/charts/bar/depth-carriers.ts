"use client";
// The BarDepth* children: using one is what bundles the depth marks (core/bar/depth.ts `enableBarDepth`).
import { defineCarrier } from "../kit/role";
import { enableBarDepth } from "../core/bar/depth";
import type { BarDepthProviderProps } from "./carriers";
import type { BarDepthBackProps, BarDepthFrontProps, BarPulseProps } from "../core/types/bar";

/** Wraps the depth children and sets their shared options: segmented side faces, the ground shadow and a minimum bar height. It renders nothing itself; place it as a child of the chart. */
export const BarDepthProvider = /* @__PURE__ */ defineCarrier<BarDepthProviderProps>("barDepthProvider", "BarDepthProvider", undefined, enableBarDepth);
/** The 3D side and top faces of the bars in the depth effect. It renders nothing itself; place it as a child of the chart. */
export const BarDepthBack = /* @__PURE__ */ defineCarrier<BarDepthBackProps>("barDepthBack", "BarDepthBack", undefined, enableBarDepth);
/** The glass front face of the bars in the depth effect. It renders nothing itself; place it as a child of the chart. */
export const BarDepthFront = /* @__PURE__ */ defineCarrier<BarDepthFrontProps>("barDepthFront", "BarDepthFront", undefined, enableBarDepth);
/** A pulsing highlight on one bar (the last by default). It renders nothing itself; place it as a child of the chart. */
export const BarPulse = /* @__PURE__ */ defineCarrier<BarPulseProps>("barPulse", "BarPulse", undefined, enableBarDepth);
