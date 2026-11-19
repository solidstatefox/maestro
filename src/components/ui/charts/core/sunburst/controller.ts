import { createChartCursor } from "@tanstack/charts/cursor";
import { motion } from "@tanstack/charts/motion";
import type { ChartInteractionController, ChartPoint, ChartScene } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import { userGradients } from "../gradients";
import type { ChartClock, ChartController, ChartDom, ChartEnv, ChartInput } from "../chart/controller";
import { alignEntranceStart } from "../entrance/entrance-origin";
import { erase } from "../erased-types";
import { attachTapFocus } from "../interaction/touch-focus";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import type { StyleObject } from "../style";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import { sunburstA11y } from "./describe";
import { descriptionOf } from "../a11y/layer";
import type { ChartSurface } from "../surface/surface";
import type { TooltipTarget } from "../surface/tooltip-target";
import { createResizeBox } from "../size/resize";
import type { SunburstCenterProps, SunburstChartProps, SunburstLabelsProps, SunburstSegmentProps } from "../types/sunburst";
import { buildArcs } from "./arcs";
import type { ArcDatum, SunburstModel } from "./arcs";
import { hoveredArcId, sunburstStableValue } from "./context";
import type { SunburstHoverStore, SunburstStableContextValue } from "./context";
import { buildDefinition } from "./definition";
import { applyControlledCursor, createSunburstHover, reapplyPushOnPaint, reportSunburstFocus, watchHoverGrow } from "./hover-grow";
import type { SunburstHoverFrame } from "./hover-grow";
import type { SunburstDatum } from "./hub";
import { createSunburstIntro, SUNBURST_ENTRANCE_ORIGINS, sweepOf } from "./intro";
import type { Sweep } from "./intro";
import { createPointerHold } from "./pointer-hold";
import type { SectorPush } from "./push";
import { DEFAULT_ARIA_DESCRIPTION, DEFAULT_HOVER_POP, DEFAULT_SIZE, resolveFocus, sceneCenter, sunburstAriaLabel, sunburstHostStyle, sunburstMetrics, sunburstStageStyle } from "./shell";
import { createSectorFeed, createSectorLayer } from "./sunburst-layer";
import type { SectorFeed } from "./sunburst-layer";
import type { SectorTrail, SunburstNativeNode } from "./sunburst-mark";
import { createSunburstZoom, zoomToNode } from "./zoom";
import { SUNBURST_ROLES, SUNBURST_SURFACE_STYLE } from "./view";
import type { SunburstView } from "./view";

/** The props a SunburstChart hands its controller (the adapter keeps `className` and places the breadcrumbs and hints itself). */
export type SunburstProps = Omit<SunburstChartProps<never>, "children" | "className">;

/** The elements a SunburstChart adapter rendered: the chart's host, the stage inside it (its width scales the hover metrics; its clicks are guarded) and the surface. */
export interface SunburstDom extends ChartDom {
  readonly stage: HTMLElement;
}

export interface SunburstControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface SunburstController extends ChartController<SunburstProps, SunburstView, SunburstStableContextValue> {
  /** The hovered arc index (`useSunburstHover`, the hint): only leaves subscribe; the host emphasis follows it. */
  readonly hover: SunburstHoverStore;
  /** Mounts the renderer into `dom.surface`; the stage is observed and guarded from the passive work. Attach once the view is `drawn`. */
  attach(dom: SunburstDom, clock: ChartClock): void;
  /** "adapter": the input of the pass being rendered and when that render started (the entrance's clock: the shell's `useRenderStart`). Never notifies. */
  prepare(input: ChartInput<SunburstProps>, clock: ChartClock): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
  /** "self": runs the passive work an `update` scheduled now instead of after the next paint; nothing pending, nothing runs. A port calls it
   * after an update made inside a discrete event (lifecycle/discrete-event.ts), as React flushes a discrete commit's passive effects at the end
   * of its task: a controlled hover the renderer cleared while redrawing is re-applied before the parent's echo of that clear lands. */
  flushPassive(): void;
}

type SunburstPoint = ChartPoint<SunburstDatum, number, number>;

/** Everything one pass derives from the input and the controller's state (what the shell's render computed). */
interface Pass {
  readonly model: SunburstModel;
  readonly arcById: ReadonlyMap<string, ArcDatum>;
  readonly focusDepth: number;
  readonly hoveredIndex: number | null | undefined;
  readonly frame: SunburstHoverFrame;
  readonly playKey: number;
  readonly introMs: number;
  readonly settled: boolean;
  readonly feed: SectorFeed;
  readonly popPx: number;
  readonly definition: ReturnType<typeof buildDefinition> | null;
  readonly options: ReturnType<typeof surfaceOptions> | null;
  readonly stable: SunburstStableContextValue | null;
  readonly view: SunburstView;
}

interface Carriers {
  readonly segments: ReadonlyMap<number, SunburstSegmentProps>;
  /** The `LinearGradient` / `RadialGradient` children, and their content (the definition rebuilds only when it changes). */
  readonly gradients: ReturnType<typeof userGradients>;
  readonly gradientsKey: string;
  /** The carriers' content (they are rebuilt with every render): the definition rebuilds only when it changes. */
  readonly segmentKey: string;
  readonly labels: SunburstLabelsProps | null;
  readonly labelsKey: string;
  readonly hasCenter: boolean;
  /** The last `SunburstCenter`'s className. */
  readonly centerClass: string | undefined;
}

/** The last `SunburstSegment` per arc index and the last `SunburstLabels` win, as the shell's children read did. */
const carriersOf = (table: ChartInput<SunburstProps>["table"]): Carriers => {
  const segments = new Map<number, SunburstSegmentProps>();
  for (const segment of propsFor<SunburstSegmentProps>(table, SUNBURST_ROLES.segment)) {
    segments.set(segment.index, segment);
  }
  const labels = propsFor<SunburstLabelsProps>(table, SUNBURST_ROLES.labels).at(-1) ?? null;
  const gradients = userGradients(table);
  const center = propsFor<SunburstCenterProps>(table, SUNBURST_ROLES.center).at(-1);
  return { centerClass: center?.className === "" ? undefined : center?.className, gradients, gradientsKey: JSON.stringify(gradients), hasCenter: propsFor(table, SUNBURST_ROLES.center).length > 0, labels, labelsKey: JSON.stringify(labels), segmentKey: JSON.stringify([...segments.values()]), segments };
};

const sameKeys = (a: readonly unknown[], b: readonly unknown[] | undefined): boolean => b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

export function createSunburstController(env: ChartEnv, initial: ChartInput<SunburstProps>, options: SunburstControllerOptions = {}): SunburstController {
  // The shell never read `staticPreview` or the chart config, so `env` gives the sunburst only its id.
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  let host: HTMLElement | null = null;
  let stage: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let pass: Pass | undefined;
  let changedFromInside: () => void = () => undefined;

  // --- What the renderer reports back, read by the definition's lazy getters, the listeners and the zoom ---------------------------------
  let interaction: ChartInteractionController<SunburstDatum, number, number> | null = null;
  let scene: ChartScene<SunburstDatum, number, number> | null = null;
  let center: { readonly x: number; readonly y: number } | null = null;
  // Where this play's render began (performance.now): the sector layer's entrance clock, <EntranceAlign>'s origin and the entrance hit test's.
  const renderStart: { current: number | null } = { current: null };
  // The arcs of the last hover path written to the host (`data-bk-path`), for the zoom's snap.
  const hoverPath: { current: readonly number[] } = { current: [] };
  const registry = new Map<string, ChartPoint<SunburstNativeNode, number, number>>();
  const pushes = new Map<string, SectorPush>();
  const trail: SectorTrail = new Map();
  const cursor = createChartCursor<number, number>();
  const renderer = motion({ initial: "always" });
  const tooltip = writable<TooltipTarget | null>(null);
  // bklit's sunburst has no tooltip (the hint names the hovered path): the surface reports no body, so `tooltip` stays empty.

  // --- The shell's state and its neutral parts -------------------------------------------------------------------------------------------
  let internalFocusId: string | undefined;
  const setInternalFocusId = (id: string): void => {
    if (id !== internalFocusId) {
      internalFocusId = id;
      changedFromInside();
    }
  };
  const hover = createSunburstHover();
  const hold = createKeyboardFocusHold(() => erase(interaction));
  const zoom = createSunburstZoom();
  const pointerHold = createPointerHold(() => interaction, zoom.zoomable);
  const entrance = createSunburstIntro(() => { changedFromInside(); });
  // The stage's measured box (bklit's react-use-measure, first hop; size/resize.ts): bklit draws in a size-unit viewBox, so the hover padding and
  // pop shrink with its width. It starts at the first `size`, as the shell's useResizeBox did.
  const firstSize = initial.props.size ?? DEFAULT_SIZE;
  const stageBox = createResizeBox({ height: firstSize, width: firstSize });
  stageBox.subscribe(() => { changedFromInside(); });

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as the shell's useMemo did) ---------------------------
  const modelCell = memoCell<SunburstModel>();
  const sweepCell = memoCell<Sweep>();
  const arcByIdCell = memoCell<ReadonlyMap<string, ArcDatum>>();
  const zoomToCell = memoCell<(nextId: string) => void>();
  const feedCell = memoCell<SectorFeed>();
  const layerCell = memoCell<ReturnType<typeof createSectorLayer>>();
  const definitionCell = memoCell<ReturnType<typeof buildDefinition> | null>();
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const stableCell = memoCell<SunburstStableContextValue | null>();
  const attrsCell = memoCell<SunburstView["hostAttrs"]>();
  const hostStyleCell = memoCell<StyleObject>();
  const stageStyleCell = memoCell<StyleObject>();
  const viewCell = memoCell<SunburstView>();

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  function onRender(context: { readonly interaction: unknown; readonly scene: ChartScene<SunburstDatum, number, number> }): void {
    interaction = erase(context.interaction);
    ({ scene } = context);
    center = sceneCenter(context.scene);
    zoom.handFocusOver(context.scene);
  }
  function onChartFocus(point: SunburstPoint | null): void {
    const { arcById, frame } = current();
    reportSunburstFocus(point, { arcById, holdFocus: hold, host, setHoveredArcIndex: frame.setHoveredArcIndex });
  }

  function derive({ props, table }: ChartInput<SunburstProps>): Pass {
    const { data, size = DEFAULT_SIZE, playKey = 0, focusId: focusIdProp, onFocusChange, hoveredIndex, onHoverChange, hoverPop = DEFAULT_HOVER_POP, padding, enterTransition, enterStaggerScale = 1, ariaLabel, ariaDescription } = props;
    const model = modelCell([data], () => buildArcs(data));
    // The shell's useState(model.rootId): the first pass's root.
    internalFocusId ??= model.rootId;
    const isFocusControlled = focusIdProp !== undefined;
    const { focus, focusId } = resolveFocus(model, isFocusControlled ? focusIdProp : internalFocusId);
    const arcById = arcByIdCell([model.arcs], () => new Map(model.arcs.map((arc) => [arc.id, arc])));
    const { segments, segmentKey, labels, labelsKey, hasCenter, centerClass, gradients, gradientsKey } = carriersOf(table);
    const frame = hover.update({ arcs: model.arcs, hoveredIndex, onHoverChange });
    const { growPadding, popPx } = sunburstMetrics({ hoverPop, maxDepth: model.maxDepth, padding, size, stageWidth: stageBox.get().width });
    // Keyed on the transition's values (a bezier by its numbers: an inline array is a new one every render).
    const ease = enterTransition?.ease;
    const sweep = sweepCell([enterTransition?.type, enterTransition?.duration, Array.isArray(ease) ? ease.join(",") : ease, enterTransition?.stiffness, enterTransition?.damping, enterTransition?.mass], () => sweepOf(enterTransition));
    const sweepMs = sweep.ms;
    const { setHoveredArcIndex } = frame;
    const zoomTo = zoomToCell([focusId, model.focusById, isFocusControlled, onFocusChange, setHoveredArcIndex], () => (nextId: string): void => {
      zoomToNode({ focusById: model.focusById, focusId, host, hoverPath: hoverPath.current, isFocusControlled, onFocusChange, setHoveredArcIndex, setInternalFocusId }, nextId);
    });
    zoom.update({ arcById, focus, holdFocus: hold, model, zoomTo });
    const { hostVars, introMs, settled } = entrance.update({ arcs: model.arcs, enterStaggerScale, playKey, sweepCss: sweep.css, sweepMs });
    // One feed and layer per chart: the layer's composition must be a stable object across definition rebuilds (a changed renderer remounts it).
    const feed = feedCell([size], () => createSectorFeed(size));
    const sectorRenderer = layerCell([feed], () => createSectorLayer(feed, renderStart));
    const definition = definitionCell([model, arcById, focus, segmentKey, labelsKey, gradientsKey, hasCenter, centerClass, sweepMs, sweep, enterStaggerScale, feed, sectorRenderer, popPx, growPadding, frame.isHoverControlled], () =>
      (focus === undefined || model.maxDepth === 0
        ? null
        : buildDefinition({
          center: () => center,
          centerClass,
          controlled: frame.isHoverControlled,
          controller: cursor,
          enterStaggerScale,
          feed,
          focus,
          gradients,
          hasCenter,
          hoverPop: popPx,
          idPrefix: uid,
          hoveredId: () => hoveredArcId(hover.store),
          introAt: () => renderStart.current,
          isIntro: entrance.isIntro,
          labels,
          model,
          moving: pointerHold.moving,
          noteSource: zoom.noteSource,
          padding: growPadding,
          pushes,
          registry,
          scene: () => scene,
          sectorRenderer,
          segments,
          sweepEase: sweep.fn,
          sweepMs,
          trail,
        })));
    const label = sunburstAriaLabel(data, ariaLabel);
    const surface = definition === null
      ? null
      : optionsCell([definition, label, ariaDescription, data, table], () => {
        // The summary of its data, then its own keyboard help (zoom included), unless the reader describes it.
        const a11y = sunburstA11y(data, table);
        const described = ariaDescription ?? [descriptionOf(a11y.describe)?.summary, DEFAULT_ARIA_DESCRIPTION].filter(Boolean).join(" ");
        return surfaceOptions(erase({ ariaDescription: described, ariaLabel: label, aspectRatio: 1, definition, onFocusChange: onChartFocus, onRender, onSelect: zoom.selectZoom, renderer, a11y }), uid);
      });
    const stable = stableCell([data, focus, focusId, model, size, zoomTo], () => sunburstStableValue({ data, focus, focusId, model, size, zoomTo }));
    const hostAttrs = attrsCell([settled], () => ({ "data-bk-intro": settled ? undefined : "" }));
    const hostStyle = hostStyleCell([size, JSON.stringify(hostVars)], () => sunburstHostStyle(size, hostVars));
    const stageStyle = stageStyleCell([size], () => sunburstStageStyle(size));
    const view = viewCell([stable !== null, definition !== null, hostAttrs, hostStyle, stageStyle, surface], () => ({
      drawn: definition !== null,
      hostAttrs,
      hostStyle,
      shown: stable !== null,
      stageStyle,
      surface,
      surfaceStyle: SUNBURST_SURFACE_STYLE,
    }));
    return { arcById, definition, feed, focusDepth: focus?.depth ?? 0, frame, hoveredIndex, introMs, model, options: surface, playKey, popPx, settled, stable, view };
  }

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (opts: ReturnType<typeof surfaceOptions>): ChartSurface => {
    chart ??= createChartSurface(opts);
    return chart;
  };
  // The play the mounted chart shows: the shell keyed its RendererChart by `playKey`, so a new one mounts a fresh chart (the entrance replays).
  let mountedPlay: number | undefined;
  let cancelAlign: (() => void) | undefined;
  let syncing = false;
  /** A commit's layout half: <EntranceAlign> while the entrance plays (it rendered before the renderer), then the renderer gets the latest options. */
  const layout = (): void => {
    const el = surfaceEl;
    if (!el || !host) {
      return;
    }
    const { definition, settled, options: opts, playKey } = current();
    const aligning = definition !== null && !settled;
    if (aligning && cancelAlign === undefined) {
      cancelAlign = alignEntranceStart(() => host, SUNBURST_ENTRANCE_ORIGINS, renderStart.current ?? "frame", true);
    } else if (!aligning && cancelAlign !== undefined) {
      cancelAlign();
      cancelAlign = undefined;
    }
    if (opts === null) {
      return;
    }
    if (playKey !== mountedPlay) {
      mountedPlay = playKey;
      chart?.destroy();
    }
    syncing = true;
    try {
      surfaceOf(opts).render(el, opts);
    } finally {
      syncing = false;
    }
  };

  // The deps the passive work last ran for (the shell's effects'); reset by `detach`, so a re-attach runs it again.
  let syncedHover: readonly unknown[] | undefined;
  let listenersOff: (() => void) | undefined;
  let played: readonly unknown[] | undefined;
  let cancelPlay: (() => void) | undefined;
  let pushedFeed: SectorFeed | undefined;
  let pushOff: (() => void) | undefined;
  let cursorDeps: readonly unknown[] | undefined;
  let growDeps: readonly unknown[] | undefined;
  let growOff: (() => void) | undefined;
  /** The mount listeners: the stage's size, press focus under touch (UPSTREAM-GAPS #39), the keyboard hold (#42), Escape, the click guard and move flag. */
  const listen = (el: HTMLElement, stageEl: HTMLElement): (() => void) => {
    const offs = [stageBox.observe(stageEl), attachTapFocus(el, () => erase(interaction), "press"), hold.attach(el), zoom.attach(el), pointerHold.attach(el, stageEl)];
    return (): void => { for (const off of offs) { off(); } };
  };
  /** A commit's passive half, in the order the shell ran these effects. */
  const committed = (): void => {
    const { frame, hoveredIndex, playKey, introMs, feed, definition, model, focusDepth, popPx } = current();
    // A controlled hoveredIndex is committed into the store.
    const hoverKeys = [frame.isHoverControlled, hoveredIndex];
    if (!sameKeys(hoverKeys, syncedHover)) {
      syncedHover = hoverKeys;
      hover.syncControlled(hoveredIndex);
    }
    if (listenersOff === undefined && host !== null && stage !== null) {
      listenersOff = listen(host, stage);
    }
    // The settle timer of this play (intro.ts `play`).
    const playKeys = [playKey, introMs];
    if (!sameKeys(playKeys, played)) {
      played = playKeys;
      cancelPlay?.();
      cancelPlay = entrance.play(playKey, introMs);
    }
    if (feed !== pushedFeed) {
      pushedFeed = feed;
      pushOff?.();
      pushOff = reapplyPushOnPaint(feed, () => host);
    }
    // A controlled hoveredIndex addresses its sector through the cursor, after each change of it or of the definition.
    const controlledId = frame.hoveredArc?.id ?? null;
    const cursorKeys = [controlledId, frame.isHoverControlled, definition];
    if (!sameKeys(cursorKeys, cursorDeps)) {
      cursorDeps = cursorKeys;
      if (frame.isHoverControlled) { applyControlledCursor(cursor, registry, controlledId); }
    }
    // The host emphasis, watched again when the scene is rebuilt so the hover is re-applied to the new sectors.
    const growKeys = [host, model.arcs, definition, focusDepth, model.maxDepth, popPx];
    if (!sameKeys(growKeys, growDeps)) {
      growDeps = growKeys;
      growOff?.();
      growOff = watchHoverGrow({ arcs: model.arcs, focusDepth, host: () => host, hoverPath, hoverPop: popPx, hoverStore: hover.store, maxDepth: model.maxDepth, pushes });
    }
  };
  let cancelPassive: (() => void) | undefined;
  let microtask = false;
  const schedulePassive = (): void => {
    cancelPassive?.();
    cancelPassive = afterPaint(() => {
      cancelPassive = undefined;
      committed();
    });
  };
  const notify = (before: Pass | undefined, after: Pass): void => {
    if (after.view !== before?.view) { bump(viewVersion); }
    if (after.stable !== before?.stable) { bump(contextVersion); }
  };
  changedFromInside = (): void => {
    const before = pass;
    pass = derive(latestInput);
    notify(before, pass);
    if (!selfDriven || microtask) {
      return;
    }
    // Never inside the renderer's own callbacks (a select's zoom, a focus report): the next microtask, as a port's own flush would.
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      if (!syncing) { layout(); }
      schedulePassive();
    });
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context: { get: () => current().stable, subscribe: contextVersion.subscribe } satisfies Readable<SunburstStableContextValue | null>,
    hover: hover.store,
    prepare(input, clock) {
      latestInput = input;
      renderStart.current = clock.renderStart;
      pass = derive(input);
    },
    update(input) {
      // A replay's clock starts at the update that brings it, as the keyed remount took its render's start.
      if (selfDriven && (input.props.playKey ?? 0) !== (latestInput.props.playKey ?? 0)) { renderStart.current = performance.now(); }
      const before = pass;
      latestInput = input;
      pass = derive(input);
      if (selfDriven) { notify(before, pass); }
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    committed,
    flushPassive() {
      if (cancelPassive === undefined) {
        return;
      }
      cancelPassive();
      cancelPassive = undefined;
      committed();
    },
    attach(dom, clock) {
      host = dom.host;
      stage = dom.stage;
      surfaceEl = dom.surface;
      renderStart.current = clock.renderStart;
      mountedPlay = current().playKey;
      // Mount: <EntranceAlign>, then TanStack's draw.
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    mounted() {
      // Nothing to arm (see the head of this file).
    },
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      cancelAlign?.();
      cancelAlign = undefined;
      cancelPlay?.();
      cancelPlay = undefined;
      listenersOff?.();
      listenersOff = undefined;
      pushOff?.();
      pushOff = undefined;
      growOff?.();
      growOff = undefined;
      chart?.destroy();
      syncedHover = undefined;
      played = undefined;
      pushedFeed = undefined;
      cursorDeps = undefined;
      growDeps = undefined;
      interaction = null;
      scene = null;
      center = null;
      host = null;
      stage = null;
      surfaceEl = null;
    },
    prerender: () => {
      const opts = current().options;
      return opts === null ? "" : surfaceOf(opts).prerender();
    },
  };
}
