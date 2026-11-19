import type { ReactNode } from "react";
import { hintTextFor } from "../core/sunburst/context";
import { SUNBURST_HINT_STYLE } from "../core/sunburst/shell";
import { toCamel } from "../core/style";
import { useSunburstHover, useSunburstStable } from "./context";
import type { SunburstHintProps as CoreSunburstHintProps } from "../core/types/sunburst";

const HINT_STYLE = /* @__PURE__ */ toCamel(SUNBURST_HINT_STYLE);

/** Props of `SunburstHint`. */
export interface SunburstHintProps extends CoreSunburstHintProps<ReactNode> {}

/** Hint text below the chart: the hovered path, or instructions for zooming. Announced politely to screen readers. */
export const SunburstHint = /* @__PURE__ */ Object.assign(function SunburstHint({ className, children }: Readonly<SunburstHintProps>): ReactNode {
  const { focus } = useSunburstStable();
  const { hoveredArc } = useSunburstHover();
  const hintText = hintTextFor(hoveredArc, focus);
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the prop is bklit's public `ReactNode | function` union, discriminated at its only boundary
  const content: ReactNode = typeof children === "function" ? children({ focus, hintText, hoveredArc }) : (children ?? hintText);
  return (
    <div
      aria-live="polite"
      className={className ?? "bk-sb-hint"}
      style={HINT_STYLE}
    >
      {content}
    </div>
  );
}, { displayName: "SunburstHint" });
