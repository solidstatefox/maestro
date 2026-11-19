import { rect, ruleX } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { pushDecorative } from "./build-state";
import type { BuildState } from "./build-state";
import { crosshairGradient } from "./date-pill";
import { erase } from "../erased-types";

interface SegmentLineProps {
  stroke?: string;
  strokeWidth?: number;
  variant?: "dashed" | "solid" | "gradient";
}

export interface SegmentProps {
  readonly background: { fill?: string } | undefined;
  readonly lines: readonly (SegmentLineProps | undefined)[];
}

export function readSegmentProps(table: ChildTable): SegmentProps {
  return {
    background: propsFor<{ fill?: string }>(table, "segmentBackground")[0],
    lines: [propsFor<SegmentLineProps>(table, "segmentLineFrom")[0], propsFor<SegmentLineProps>(table, "segmentLineTo")[0]],
  };
}

export const hasSegments = (props: SegmentProps): boolean => Boolean(props.background) || props.lines.some(Boolean);

function pushGradientRule(state: BuildState, uid: string, line: SegmentLineProps, i: number, segDomain: readonly [Date, Date], half: number, [lo, hi]: readonly [number, number]): void {
  // bklit fades the rule out over its top and bottom 10%. Zero-width rules cannot take a
  // bounding-box gradient, so the rule is a stroke-wide rect carrying an objectBoundingBox linear gradient.
  const color = line.stroke ?? "var(--chart-segment-line)";
  const id = `${uid}-segment-line-${i}`;
  state.gradients.push(crosshairGradient(id, color));
  pushDecorative(
    state.marks,
    rect([segDomain[0]], {
      x1: (d: Date) => new Date(d.getTime() - half),
      x2: (d: Date) => new Date(d.getTime() + half),
      y1: () => lo,
      y2: () => hi,
      id: `segment-edge-${i}`,
      key: () => `segment:edge:${i}`,
      fill: `url(#${id})`,
    }),
  );
}

/** Appends the Segment* band and rules over the x extent `segDomain` and the primary y domain. */
export function pushSegmentMarks(
  state: BuildState,
  props: SegmentProps,
  uid: string,
  segDomain: readonly [Date, Date],
  primaryDomain: readonly [number, number],
  plotWidth: number,
): void {
  const [lo, hi] = primaryDomain;
  if (props.background) {
    pushDecorative(
      state.marks,
      rect([segDomain], {
        x1: (d: readonly Date[]) => d[0],
        x2: (d: readonly Date[]) => d[1],
        y1: () => lo,
        y2: () => hi,
        id: "segment-band",
        key: () => "segment:band",
        fill: props.background.fill ?? "var(--chart-segment-background)",
      }),
    );
  }
  const perPx = plotWidth > 0 ? (segDomain[1].getTime() - segDomain[0].getTime()) / plotWidth : 0;
  props.lines.forEach((line, i) => {
    if (!line) {
      return;
    }
    if (line.variant === "gradient" && perPx > 0) {
      pushGradientRule(state, uid, line, i, segDomain, ((line.strokeWidth ?? 1) / 2) * perPx, primaryDomain);
      return;
    }
    pushDecorative(
      state.marks,
      ruleX([segDomain[0]], erase({
        x: (d: Date) => d,
        y1: () => lo,
        y2: () => hi,
        id: `segment-edge-${i}`,
        key: () => `segment:edge:${i}`,
        stroke: line.stroke ?? "var(--chart-segment-line)",
        strokeWidth: line.strokeWidth ?? 1,
        strokeDasharray: (line.variant ?? "dashed") === "dashed" ? "4 4" : undefined,
      })),
    );
  });
}
