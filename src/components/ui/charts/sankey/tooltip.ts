import { createElement, Fragment } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { SankeyTooltipProps as CoreSankeyTooltipProps } from "../core/types/sankey";

/** Props of `SankeyTooltip`. */
export interface SankeyTooltipProps extends CoreSankeyTooltipProps<ReactNode, CSSProperties> {}

/** Configures the tooltip shown on hover or keyboard focus. Renders nothing itself; `SankeyChart` reads its props. */
export const SankeyTooltip = /* @__PURE__ */ Object.assign(function SankeyTooltip(_props: Readonly<SankeyTooltipProps>): ReactElement {
  return createElement(Fragment);
}, { displayName: "SankeyTooltip" });
