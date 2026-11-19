import { createMark } from "@tanstack/charts";
import type { ChartMark, SceneNode } from "@tanstack/charts";

export interface LiveTipOptions {
  readonly id: string;
  readonly time: number;
  readonly value: number;
  readonly color: string;
  readonly stroke: string;
  readonly dotSize: number;
  readonly badge: boolean;
  /** The badge text as the tick starts (headLabels' first): the label steps (live-steps.ts) write the rest of bklit's display lerp walk into the
   * same node and size its pill, `length * 7.5 + 16` (badgeWidth). */
  readonly label: string;
  /** bklit's pulse ring (live-line.tsx:250-275): r from dotSize to dotSize * 3.5 and opacity 0.5 -> 0 over 1.5 s, under the halo and dot. */
  readonly pulse: boolean;
  /** Head easing: the tip is laid out at its target and the head clock (live-head.ts) carries it from where bklit's display lerp stands (Frame.dy) along the lerp curve,
   * so a y-domain jump moves the start with it. Off during the intro, where the tip follows the chart's own roll. */
  readonly ease: boolean;
}

const BADGE_HEIGHT = 24;
const BADGE_GAP = 12;
const CHAR_WIDTH = 7.5;
const BADGE_PAD = 16;
const BADGE_TEXT_DY = 4;
/** The badge pill's width for `text` (bklit: `text.length * 7.5 + 16`). */
export const badgeWidth = (text: string): number => text.length * CHAR_WIDTH + BADGE_PAD;

export function liveTip(options: LiveTipOptions): ChartMark<unknown, Date, number> {
  const { id, time, value, color, stroke, dotSize, badge, label, pulse, ease } = options;
  return createMark<unknown, Date, number>(() => ({
    id,
    // No channels: the tip never influences either domain.
    channels: {},
    render: ({ scales, chart }) => {
      // Keyed only while the tip tweens with the chart (the intro, `ease` off): at rest the mark has no motion, and a keyed node costs the renderer
      // a pass over every scene point per update to find its timing context (live-tail.ts).
      const key = (part: string): string => (ease ? "" : `${id}:${part}`);
      const x = scales.x.map(new Date(time));
      const y = scales.y.map(value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { nodes: [] };
      }
      const children: SceneNode[] = [
        {
          kind: "rule",
          key: key("rule"),
          x1: chart.x,
          x2: x,
          y1: y,
          y2: y,
          style: { stroke, strokeOpacity: 0.25, strokeWidth: 1, strokeDasharray: "4 4" },
        },
      ];
      // At rest the indicator group carries the tip's translate, so a tick rewrites one transform; while the tip tweens (`ease` off)
      // the nodes take absolute coordinates so each follows the chart's roll.
      const lx = ease ? 0 : x;
      const ly = ease ? 0 : y;
      const indicator: SceneNode[] = [];
      if (pulse) {
        // Under the halo and dot, as bklit paints it; its radius and opacity are the head clock's (live-head.ts), on a cycle no tick restarts.
        indicator.push({ kind: "dot", key: "", className: "bkm-live-pulse", x: lx, y: ly, radius: dotSize, style: { fill: "none", stroke: color, strokeWidth: 1.5 } });
      }
      indicator.push(
        { kind: "dot", key: key("halo"), x: lx, y: ly, radius: dotSize + 2, style: { fill: color, fillOpacity: 0.1 } },
        {
          kind: "dot",
          key: key("dot"),
          x: lx,
          y: ly,
          radius: dotSize,
          style: { fill: color, stroke: "var(--chart-background)", strokeWidth: 2 },
        },
      );
      if (badge) {
        indicator.push(
          {
            kind: "rect",
            // Keyed like the dot while it tweens (the intro), so the badge travels with it.
            key: key("badge"),
            className: "bkm-live-badge",
            x: lx + BADGE_GAP,
            y: ly - BADGE_HEIGHT / 2,
            width: badgeWidth(label),
            height: BADGE_HEIGHT,
            radius: 6,
            style: { fill: "var(--bkm-popover)", fillOpacity: 0.95 },
          },
          {
            kind: "label",
            key: key("badge-text"),
            className: "bkm-live-badge-text",
            x: lx + BADGE_GAP + 8,
            // bklit: <text y={4}> in a 24px box centred on the dot, alphabetic baseline (not dominant-baseline middle).
            y: ly + BADGE_TEXT_DY,
            text: label,
            anchor: "start",
            fontSize: 11,
            fontWeight: 500,
          },
        );
      }
      children.push({ kind: "group", key: key("indicator"), className: "bkm-live-indicator", ...(ease ? { translateX: x, translateY: y } : {}), children: indicator });
      return {
        nodes: [{ kind: "group", key: id, className: "bkm-live-tip", ariaHidden: true, children }],
        points: [],
      };
    },
  }), ease ? false : undefined);
}
