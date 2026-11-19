import { createElement, Fragment } from "react";
import type { ReactElement } from "react";
import type { SankeyNodeProps } from "../core/types/sankey";

/** Configures how nodes and their labels are drawn. Renders nothing itself; `SankeyChart` reads its props. */
export const SankeyNode = /* @__PURE__ */ Object.assign(function SankeyNode(_props: Readonly<SankeyNodeProps>): ReactElement {
  return createElement(Fragment);
}, { displayName: "SankeyNode" });
