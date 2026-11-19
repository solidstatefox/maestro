import { defineChart } from "@tanstack/charts/scene";
import { joinClasses } from "../cn";
import { hasText } from "../guards";
import { CHART_PALETTE } from "../palette";
import { scopePaintUrl } from "../resource-ids";
import type { Transition } from "../motion/phase";
import { TOOLTIP_MOTION } from "../theme";
import { bklitTooltip, bklitTooltipExit } from "../tooltip/bklit-tooltip";
import { bklitTooltipPlacement } from "../tooltip/bklit-tooltip-portal";
import type { SankeyLinkProps, SankeyNodeProps, SankeyTooltipProps } from "../types/sankey";
import { toNativeTransition } from "./entrance";
import { createSankeyFocus } from "./focus";
import { buildSankeyGradients, createSankeyMark, formatSessions } from "./marks";
import type { SankeyDatum, SankeyInputData, SankeyInputLinkRow } from "./marks";
import { sankeyTooltipContent } from "./tooltip";
import type { Margin, SankeyData, SankeyNodeDatum } from "./types";

/** The colour of node `index`: the `SankeyNode` fill, else a `getNodeColor` (the node's, else the link's), else the palette by index. */
export const sankeyNodeColor = (nodes: readonly SankeyNodeDatum[], node: SankeyNodeProps, link: SankeyLinkProps<unknown>) => (index: number): string => {
  if (hasText(node.fill)) {return node.fill;}
  const row = nodes.at(index);
  const custom = node.getNodeColor ?? link.getNodeColor;
  if (custom !== undefined && row !== undefined) {return custom({ ...row, index }, index);}
  return CHART_PALETTE[index % CHART_PALETTE.length] ?? CHART_PALETTE[0];
};

interface SankeyDefinitionInput {
  readonly data: SankeyData;
  readonly link: SankeyLinkProps<unknown>;
  readonly node: SankeyNodeProps;
  readonly tooltip: SankeyTooltipProps<unknown> | undefined;
  readonly margin: Margin;
  readonly nodeWidth: number;
  readonly nodePadding: number;
  readonly animationDuration: number;
  readonly enterTransition: Transition | undefined;
  /** The chart's svg id prefix: a link pattern's paint url is scoped to it. */
  readonly idPrefix: string;
  readonly nodeColor: (index: number) => string;
  readonly formatValue: (value: number) => string;
  readonly valueLabel: string;
  readonly useGradient: boolean;
  /** The chart's host, read at each build: the flow draw direction is an attribute on it. */
  readonly host: () => HTMLElement | null;
}

export const buildSankeyDefinition = (config: SankeyDefinitionInput) => {
  const { data, link: linkConfig, node: nodeConfig, tooltip: tooltipConfig, margin, nodeWidth, nodePadding, animationDuration, enterTransition, idPrefix, nodeColor, formatValue, valueLabel, useGradient, host } = config;
  const input: SankeyInputData = data;
  const linkStroke = (row: SankeyInputLinkRow, sourceColor: string, gradientId: string | null): string => {
    // bklit order: a pattern id wins over the flat stroke, getLinkColor and the gradient.
    if (linkConfig.getLinkPattern) {
      const index = data.links.indexOf(row.data);
      const patternId = linkConfig.getLinkPattern({ ...row.data, index }, index);
      if (hasText(patternId)) {return scopePaintUrl(`url(#${patternId})`, idPrefix);}
    }
    if (hasText(linkConfig.stroke)) {return linkConfig.stroke;}
    if (linkConfig.getLinkColor) {
      const index = data.links.indexOf(row.data);
      return linkConfig.getLinkColor({ ...row.data, index }, index);
    }
    return gradientId === null ? sourceColor : `url(#${gradientId})`;
  };
  // bklit lays out in `width - left - right`; once that is narrower than a node the columns run right to left (never an error).
  // The builder receives the scene width (the margins are 0 here, so it is the host width): no observer, no state.
  return defineChart(({ width }) => {
    const reversed = width - margin.left - margin.right < nodeWidth;
    // The flow draw direction is a CSS rule keyed on the host attribute; set in the same synchronous build that lays the scene out,
    // so it is in place before first paint (the framework does not own this attribute).
    host()?.toggleAttribute("data-bkm-reversed", reversed);
    return {
      gradients: useGradient && !hasText(linkConfig.stroke) && linkConfig.getLinkColor === undefined ? buildSankeyGradients(input, nodeColor, reversed) : [],
      guides: false,
      // The side margins are applied by the mark (it places the columns, see layoutColumns); the chart keeps only top/bottom.
      margin: { bottom: margin.bottom, left: 0, right: 0, top: margin.top },
      marks: [createSankeyMark({
        data: input,
        enter: { durationMs: animationDuration, transition: toNativeTransition(enterTransition, animationDuration) },
        formatNodeValue: nodeConfig.formatValue ?? formatSessions,
        labelOrientation: nodeConfig.labelOrientation ?? "horizontal",
        lineCap: nodeConfig.lineCap ?? 4,
        linkStroke,
        nodeColor,
        nodePadding,
        nodeWidth,
        sideMargin: { left: margin.left, right: margin.right },
        showLabels: nodeConfig.showLabels ?? true,
        showValueLabels: nodeConfig.showValueLabels ?? true,
        strokeOpacity: linkConfig.strokeOpacity ?? 0.5,
        useGradient,
      })],
      scales: { x: null, y: null },
    };
  }, {
    // A builder chart takes its interaction options (focus, tooltip) as the second argument; inside the built spec they are ignored.
    focus: createSankeyFocus<SankeyDatum>(),
    focusRing: false,
    tooltip: {
      anchor: "pointer",
      className: joinClasses("bkm-sankey-tooltip", tooltipConfig?.className),
      content: sankeyTooltipContent(formatValue, valueLabel),
      motion: TOOLTIP_MOTION,
      offset: 16,
      portal: bklitTooltipPlacement({ pointerAnchor: true }),
      // bklit's sankey has no click handling (sankey/*.tsx): a click must not pin the tooltip (dialog role, re-placement, body
      // re-render), and click-then-leave hides it like a plain leave.
      sticky: false,
      // bklit's SankeyTooltip `exit` (default true): the panel fades out when the hover ends; `false` hides it at once.
      use: tooltipConfig?.exit === false ? bklitTooltip : bklitTooltipExit,
    },
  });
};

export type SankeyDefinition = ReturnType<typeof buildSankeyDefinition>;
