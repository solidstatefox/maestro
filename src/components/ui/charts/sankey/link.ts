import { createElement, Fragment } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SankeyLinkProps as CoreSankeyLinkProps } from "../core/types/sankey";

/** Props of `SankeyLink`. */
export interface SankeyLinkProps extends CoreSankeyLinkProps<ReactNode> {}

/** Configures how links are painted. Renders nothing itself; `SankeyChart` reads its props. */
export const SankeyLink = /* @__PURE__ */ Object.assign(function SankeyLink(_props: Readonly<SankeyLinkProps>): ReactElement {
  return createElement(Fragment);
}, { displayName: "SankeyLink" });
