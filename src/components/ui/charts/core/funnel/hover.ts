import type { ChartInteractionController, ChartPoint, ChartRendererRenderContext } from "@tanstack/charts";
import { writeHoverIndex } from "../host-write";
import { FUNNEL_FOCUS_LAYER } from "./focus";
import type { FunnelDatum } from "./focus";
import { MAX_STAGES } from "./host-vars";
import { popExtra } from "./marks";
import { createFunnelPop } from "./pop-spring";
import type { FunnelPop } from "./pop-spring";

type FunnelInteraction = ChartInteractionController<FunnelDatum, number, number>;
type FunnelRender = ChartRendererRenderContext<FunnelDatum, number, number>;

interface EnterComplete {
  /** The number of stages. */
  readonly stages: number;
  readonly staggerDelaySec: number;
  readonly durationSec: number;
}

export interface FunnelHover {
  /** The mounted chart's interaction controller (from `rendered`), for the tap focus and the keyboard hold. */
  readonly interaction: () => FunnelInteraction | null;
  /** The latest controlled `hoveredIndex` (undefined: uncontrolled) and `onHoverChange`; the controller hands them over on every pass. */
  readonly setProps: (hoveredIndex: number | null | undefined, onHoverChange: ((index: number | null) => void) | undefined) => void;
  /** Builds the ring pop springs for the funnel's layout (`layers` at least 1). Returns their disposal: call it before a new layout's. */
  readonly attachPop: (layout: { readonly horizontal: boolean; readonly layers: number }) => () => void;
  /** Starts each stage's enterComplete timer at mount (see the body). Returns the cancel function. */
  readonly scheduleEnterComplete: (input: EnterComplete) => () => void;
  /** The controlled `hoveredIndex` changed (after the commit that carries it): paint it and focus it natively. */
  readonly hoveredChanged: (hoveredIndex: number | null | undefined) => void;
  /** The renderer drew (`onRender`): keeps its controller and scene, hands `onPlotWidth` the plot's width, then re-applies a controlled hover. */
  readonly rendered: (context: FunnelRender, onPlotWidth?: (width: number) => void) => void;
  /** The renderer's focus changed (`onFocusChange`, after the keyboard hold saw it): paints the stage and tells `onHoverChange`, once per stage. */
  readonly focusChanged: (point: ChartPoint<FunnelDatum, number, number> | null) => void;
}

/** The hover of the funnel on `host` (read at each call). */
export function createFunnelHover(host: () => HTMLElement | null): FunnelHover {
  let pop: FunnelPop | null = null;
  let interaction: FunnelInteraction | null = null;
  let scene: FunnelRender["scene"] | null = null;
  let hovered: number | null | undefined;
  let onHoverChange: ((index: number | null) => void) | undefined;
  let lastStage: number | null = null;

  const applyHover = (stage: number | null): void => {
    const el = host();
    if (!el) { return; }
    // Beyond the rule cap a stage has no emphasis rules: leave the host un-hovered rather than dimming everything.
    const capped = stage === null || stage >= MAX_STAGES ? null : stage;
    writeHoverIndex(el, capped);
    pop?.to(capped);
  };

  // Controlled hover: drive the same native focus the pointer would.
  const applyControlledHover = (): void => {
    const target = hovered;
    if (!interaction || target === undefined) {return;}
    if (target === null) {
      interaction.setControlledFocus(null);
      return;
    }
    const point = scene?.points.find((candidate) => candidate.datum.stage === target && candidate.datum.layer === FUNNEL_FOCUS_LAYER);
    if (point) {interaction.setControlledFocus(point);}
  };

  return {
    attachPop: ({ horizontal, layers }) => {
      const el = host();
      if (!el) { return () => undefined; }
      // Ring pop springs (pop-spring.ts): velocity-preserving retarget on a hover change; the resting pop is static CSS.
      const created = createFunnelPop(el, { horizontal, layers, popOf: popExtra });
      pop = created;
      return (): void => {
        created.dispose();
        if (pop === created) { pop = null; }
      };
    },
    focusChanged: (point) => {
      // A rebuild with new datum objects re-reports the same stage (core dedupes only on identity + Object.is datum); one commit per stage.
      const stage = point ? point.datum.stage : null;
      if (stage === lastStage) {return;}
      lastStage = stage;
      applyHover(stage);
      onHoverChange?.(stage);
    },
    hoveredChanged: (hoveredIndex) => {
      if (hoveredIndex !== undefined) { applyHover(hoveredIndex); }
      applyControlledHover();
    },
    interaction: () => interaction,
    rendered: (context, onPlotWidth) => {
      interaction = context.interaction;
      scene = context.scene;
      onPlotWidth?.(context.scene.width);
      applyControlledHover();
    },
    // A stage's rings remount at its bklit enterComplete, stage * staggerDelay + duration (funnel-chart.tsx:241-244,268-269 vs :319-320, use-enter-complete.ts:12-27, use-mount-progress.ts:21-24):
    // a hovered stage springs up from rest again then.
    scheduleEnterComplete: ({ stages, staggerDelaySec, durationSec }) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (let stage = 0; stage < Math.min(stages, MAX_STAGES); stage += 1) {
        // Per-stage enterComplete at stage * staggerDelay + duration: use-enter-complete.ts:12-27, funnel-chart.tsx:244,268 (UPSTREAM-GAPS #38).
        timers.push(setTimeout(() => { pop?.restart(stage); }, (stage * staggerDelaySec + durationSec) * 1000));
      }
      return (): void => { for (const timer of timers) { clearTimeout(timer); } };
    },
    setProps: (nextHovered, nextOnHoverChange) => {
      hovered = nextHovered;
      onHoverChange = nextOnHoverChange;
    },
  };
}
