"use client";
// Standalone bklit `ChartRevealClip` (core/markup/loading.ts draws it).
import type { ReactNode } from "react";
import { revealClipTree } from "../../core/markup/loading";
import type { ChartRevealClipProps } from "../../core/types/loading";
import { renderMarkup } from "../../runtime/markup";

/** @internal */
export const ChartRevealClip = /* @__PURE__ */ Object.assign(function ChartRevealClip(props: Readonly<ChartRevealClipProps>): ReactNode {
  return renderMarkup(revealClipTree(props));
}, { displayName: "ChartRevealClip" });
