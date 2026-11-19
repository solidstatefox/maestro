import type { ChartRendererHostOptions } from "@tanstack/charts";
import { propsFor } from "../carriers/table";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { alignEntranceStart } from "../entrance/entrance-origin";
import { createReadyGate } from "../entrance/ready-gate";
import type { ReadyGateRun } from "../entrance/ready-gate";
import { clearAttribute, raiseAttribute } from "../host-write";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachTapFocus } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { memoCell } from "../memo";
import { afterFrames, createResizeBox } from "../size/resize";
import type { ResizeBox, ResizeBoxStore } from "../size/resize";
import { readonly, writable } from "../store";
import type { Readable } from "../store";
import { createChartSurface, surfaceOptions } from "../surface/surface";
import { sankeyA11y } from "./describe";
import { DATA_TABLE_ROLE } from "../a11y/data-table";
import type { ChartDataTableProps } from "../a11y/data-table";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import { applyPanelStyle } from "../tooltip/panel-style";
import type { SankeyChartProps, SankeyLinkProps, SankeyNodeProps, SankeyTooltipProps } from "../types/sankey";
import { createSankeyContext, createSankeyFocusStore } from "./context";
import type { SankeyChartContext, SankeyContainerRef, SankeyFocus } from "./context";
import { SANKEY_ENTRANCE_ORIGINS } from "./entrance";
import type { SankeyDatum } from "./marks";
import { createSankeyHover } from "./hover";
import { sankeyHoverCss } from "./hover-css";
import { createSankeyPass, SANKEY_RENDERER } from "./pass";
import type { SankeyPass } from "./pass";
import { SANKEY_HOLD_ATTR, SANKEY_SETTLED_ATTR, sankeyHostAttrs, sankeySettleMs, sankeySurfaceStyle } from "./view";
import type { SankeyView } from "./view";

/** The props a SankeyChart hands its controller (the adapter keeps `className` and `children`). */
export type SankeyProps<TNode> = Omit<SankeyChartProps<TNode>, "className" | "children">;

/** The table roles of the config carriers; the last of each role configures the chart (React reads them by displayName, react/sankey/data.ts). */
export const SANKEY_ROLES = { link: "sankeyLink", node: "sankeyNode", tooltip: "sankeyTooltip" } as const;

export interface SankeyControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface SankeyController<TNode> extends ChartController<SankeyProps<TNode>, SankeyView<TNode>, SankeyChartContext> {
  /** Never null: before the first draw it holds the empty layout. Live while subscribed: its size observer and ready gate run only then
   * (React renders the `useSankey()` layer only for children beyond the config carriers). */
  readonly context: Readable<SankeyChartContext>;
  /** The focused node or flow (`context` reads it): React's layer re-renders at once on it, on the default lane for the rest of the context. */
  readonly focus: Readable<SankeyFocus | null>;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<SankeyProps<TNode>>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
  /** "adapter": after a commit that rendered the context (its layout half): `data-bkm-ready` follows the flag that commit rendered, so the
   * two land together. "self" writes it at the gate's flip. */
  contextCommitted(): void;
}

const NO_LINK: SankeyLinkProps<never> = {};
const NO_NODE: SankeyNodeProps = {};
const REVERSED_ATTR = "data-bkm-reversed";
const NO_BOX: ResizeBox = { width: 0, height: 0, observed: false };
/** bklit's node and label animations start two frames after its commit while its flows run from the render (styles.css, the flow draw):
 * the hold is released this many frames after the mount's passive moment, never mid-frame (an animation would start partway through). */
const HOLD_FRAMES = 2;

/** The renderer adapter's options for this chart's datum. */
type SankeyOptions = ChartRendererHostOptions<SankeyDatum, number, number>;

interface Pass<TNode> {
  readonly sankey: SankeyPass<TNode>;
  /** As given: any change remounts the renderer and replays the entrance (`undefined` -> `""` too, as a React key would). */
  readonly revealSignature: string | undefined;
  /** The context's reset key (`revealSignature ?? ""`). */
  readonly revealKey: string;
  readonly hoveredNodeIndex: number | null | undefined;
  readonly options: SankeyOptions;
  readonly view: SankeyView<TNode>;
}

export function createSankeyController<TNode>(env: ChartEnv, initial: ChartInput<SankeyProps<TNode>>, options: SankeyControllerOptions = {}): SankeyController<TNode> {
  const selfDriven = options.commits !== "adapter";
  // The sankey reads neither `staticPreview` nor `config`: it plays its entrance in a static docs preview too.
  const { uid } = env;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  const containerRef: SankeyContainerRef = { current: null };
  const tooltip = tooltipTargetStore();
  const focus = createSankeyFocusStore();
  let staticStyle: HTMLStyleElement | null = null;
  const hover = createSankeyHover({ focus, host: () => host, surface: () => surfaceEl });
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(() => hover.interaction());
  const passOf = createSankeyPass<TNode>(uid, () => host);
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const bump = (store: typeof viewVersion): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let pass: Pass<TNode> | undefined;

  // The SankeyTooltip's `panelStyle`, set inline on the panel (the native tooltip's body) as each body is handed to the leaf.
  let panelStyle: unknown;
  let styled: { readonly panel: HTMLElement; readonly style: unknown; readonly names: readonly string[] } | null = null;
  const onTooltipBody: typeof tooltip.onChange = (target) => {
    if (target !== null && (styled === null || styled.panel !== target.element || styled.style !== panelStyle)) {
      const previous = styled?.panel === target.element ? styled.names : [];
      styled = { names: applyPanelStyle(target.element, panelStyle, previous), panel: target.element, style: panelStyle };
    }
    tooltip.onChange(target);
  };

  const onFocusChange = (point: Parameters<typeof hover.focusChange>[0]): void => {
    hold(point);
    hover.focusChange(point);
  };

  // --- One pass: the memo cells keep each value's identity while its inputs hold ---------------------------------------------------
  const hostAttrs = sankeyHostAttrs();
  const optionsCell = memoCell<SankeyOptions>();
  const surfaceStyleCell = memoCell<SankeyView<TNode>["surfaceStyle"]>();
  const viewCell = memoCell<SankeyView<TNode>>();
  const derive = ({ props, table }: ChartInput<SankeyProps<TNode>>): Pass<TNode> => {
    const link = propsFor<SankeyLinkProps<TNode>>(table, SANKEY_ROLES.link).at(-1) ?? NO_LINK;
    const node = propsFor<SankeyNodeProps>(table, SANKEY_ROLES.node).at(-1) ?? NO_NODE;
    const tooltipProps = propsFor<SankeyTooltipProps<TNode>>(table, SANKEY_ROLES.tooltip).at(-1);
    panelStyle = tooltipProps?.panelStyle;
    const sankey = passOf({ props, carriers: { link, node, tooltip: tooltipProps } });
    // The hover reads the latest pass (React: assigned while rendering).
    hover.latest({ data: sankey.data, dim: sankey.dim, hoveredNodeIndex: props.hoveredNodeIndex, onNodeHoverChange: props.onNodeHoverChange });
    const surface = optionsCell([sankey.definition, sankey.aspectRatio, sankey.ariaLabel, sankey.ariaDescription, props.data, table], () =>
      surfaceOptions({
        definition: sankey.definition, renderer: SANKEY_RENDERER, aspectRatio: sankey.aspectRatio, ariaLabel: sankey.ariaLabel, ariaDescription: sankey.ariaDescription, onFocusChange, onRender: hover.onRender, onTooltipBodyChange: onTooltipBody,
        a11y: sankeyA11y(props.data, tooltipProps?.formatValue, tooltipProps?.valueLabel, propsFor<ChartDataTableProps>(table, DATA_TABLE_ROLE)[0]),
      }, uid));
    const surfaceStyle = surfaceStyleCell([sankey.aspectRatio], () => sankeySurfaceStyle(sankey.aspectRatio));
    const { patterns } = link;
    const shownPatterns = patterns === undefined || patterns === null || patterns === false ? null : patterns;
    const view = viewCell([sankey.hostStyle, surfaceStyle, sankey.renderTooltipBody, shownPatterns], () => ({ hostAttrs, hostStyle: sankey.hostStyle, surfaceStyle, renderTooltipBody: sankey.renderTooltipBody, patterns: shownPatterns }));
    return { sankey, revealSignature: props.revealSignature, revealKey: props.revealSignature ?? "", hoveredNodeIndex: props.hoveredNodeIndex, options: surface, view };
  };
  const current = (): Pass<TNode> => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- The useSankey() context: live while subscribed --------------------------------------------------------------------------
  // bklit's isLoaded timer (sankey-chart.tsx:130-136), exposed only through `useSankey()`: it gates no hover.
  const gate = createReadyGate(() => host);
  const buildContext = createSankeyContext();
  let subscribers = 0;
  let box: ResizeBoxStore | null = null;
  let boxOff: (() => void) | undefined;
  let observeOff: (() => void) | undefined;
  // One per passive run on new keys; it outlives a re-subscription, so StrictMode's effect re-run counts as React's state counted it.
  let revealEpoch = 0;
  // The passive key (animationDuration, reset key) the gate and the epoch last ran for; undefined: the gate is not armed.
  let contextKey: string | undefined;
  // The reset key the gate last flipped for: a new key reads not-loaded until the gate flips again.
  let loadedFor: string | null = null;
  /** The context's passive work, in React's effect order: the size observer, the gate armed at the first run and restarted on a new
   * duration or reset key, the epoch bumped on the same keys (its first run included). */
  const contextPassive = (): void => {
    if (subscribers === 0 || host === null || box === null) {
      return;
    }
    observeOff ??= box.observe(host);
    const { sankey: { animationDuration }, revealKey } = current();
    const key = `${animationDuration}|${revealKey}`;
    if (key === contextKey) {
      return;
    }
    // The flip lands the flag and `data-bkm-ready` together ("adapter": in the commit that renders it, `contextCommitted`), without the
    // ready-origin alignment (the sankey has no ready entrance).
    const run: ReadyGateRun = {
      duration: animationDuration,
      land: (ready) => {
        loadedFor = ready ? revealKey : null;
        if (selfDriven) { gate.reflect(ready); }
        bump(contextVersion);
      },
    };
    if (contextKey === undefined) {
      gate.arm(run);
    } else {
      gate.restart(run);
    }
    contextKey = key;
    revealEpoch += 1;
    bump(contextVersion);
  };
  /** What a detach undoes; the next passive moment after an attach runs it again while still subscribed. */
  const contextStop = (): void => {
    observeOff?.();
    observeOff = undefined;
    gate.dispose();
    loadedFor = null;
    contextKey = undefined;
  };
  let schedulePassive: () => void = () => undefined;
  const activate = (): void => {
    box = createResizeBox();
    boxOff = box.subscribe(() => { bump(contextVersion); });
    // "adapter": a layer mounting later re-renders the chart, whose next passive moment runs it; "self": the next paint.
    if (selfDriven && host !== null) { schedulePassive(); }
  };
  const deactivate = (): void => {
    contextStop();
    boxOff?.();
    boxOff = undefined;
    box = null;
  };
  const context: Readable<SankeyChartContext> = {
    get: () => {
      const { sankey, revealKey, hoveredNodeIndex } = current();
      return buildContext({
        data: sankey.data,
        size: box?.get() ?? NO_BOX,
        margin: sankey.margin,
        nodeWidth: sankey.nodeWidth,
        nodePadding: sankey.nodePadding,
        animationDuration: sankey.animationDuration,
        enterTransition: sankey.enterTransition,
        hoveredNodeIndex,
        focus: focus.get(),
        focusNode: hover.focusNode,
        focusLink: hover.focusLink,
        containerRef,
        isLoaded: loadedFor === revealKey,
        revealEpoch,
      });
    },
    subscribe: (listener) => {
      subscribers += 1;
      if (subscribers === 1) { activate(); }
      const offs = [focus.subscribe(listener), contextVersion.subscribe(listener)];
      let subscribed = true;
      return (): void => {
        if (!subscribed) { return; }
        subscribed = false;
        for (const off of offs) { off(); }
        subscribers -= 1;
        if (subscribers === 0) { deactivate(); }
      };
    },
  };

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface<SankeyDatum, number, number> | undefined;
  const surfaceOf = (): ChartSurface<SankeyDatum, number, number> => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  // The revealSignature the mounted renderer was drawn for, and the one the hold was last released for; reset by `detach`.
  let mountedReveal: { readonly signature: string | undefined } | undefined;
  let released: { readonly signature: string | undefined } | undefined;
  let cancelRelease: (() => void) | undefined;
  let cancelSettle: (() => void) | undefined;
  let cancelAlign: (() => void) | undefined;
  /** The renderer's mount, after the hold is re-raised (before paint) and the CSS entrances are re-stamped to motion's clock from the first
   * frame's timestamp, not the render start (bklit's commit precedes the migrated one by more than motion's stale limit, entrance-origin.ts). */
  const mount = (el: HTMLElement): void => {
    cancelSettle?.();
    cancelSettle = undefined;
    clearAttribute(host, SANKEY_SETTLED_ATTR);
    raiseAttribute(host, SANKEY_HOLD_ATTR);
    cancelAlign?.();
    cancelAlign = alignEntranceStart(() => host, SANKEY_ENTRANCE_ORIGINS, "frame");
    const { options: opts, revealSignature } = current();
    mountedReveal = { signature: revealSignature };
    hover.reset();
    surfaceOf().render(el, opts);
  };
  /** A commit's layout half: the renderer gets the latest options (RendererChart.js's layout effect), or a new revealSignature remounts it
   * (the old chart destroyed with its tooltip, a fresh one mounted, held and aligned). */
  const layout = (): void => {
    const el = surfaceEl;
    if (!el || !mountedReveal) {
      return;
    }
    if (Object.is(mountedReveal.signature, current().revealSignature)) {
      surfaceOf().render(el, current().options);
      return;
    }
    cancelRelease?.();
    cancelRelease = undefined;
    surfaceOf().destroy();
    tooltip.onChange(null);
    mount(el);
  };
  // The keys the passive work last ran for (React effects' deps); reset by `detach`, so a re-attach runs it again.
  let controlled: { readonly index: number | null | undefined } | undefined;
  let listenersOff: (() => void) | undefined;
  const listen = (el: HTMLElement): (() => void) => {
    // Tap focus under touch (UPSTREAM-GAPS #39), then the keyboard hold (#42).
    const tapOff = attachTapFocus(el, () => hover.interaction(), "tap");
    const holdOff = hold.attach(el);
    return (): void => {
      tapOff();
      holdOff();
    };
  };
  /** A commit's passive half, in React's effect order: the hold release (keyed on the revealSignature), the context's, then the controlled
   * hover (on `hoveredNodeIndex`), the tap focus and the keyboard hold. */
  const committed = (): void => {
    const el = host;
    if (el === null) {
      return;
    }
    const { revealSignature, hoveredNodeIndex } = current();
    if (!released || !Object.is(released.signature, revealSignature)) {
      released = { signature: revealSignature };
      cancelRelease?.();
      cancelRelease = afterFrames(HOLD_FRAMES, () => {
        clearAttribute(el, SANKEY_HOLD_ATTR);
        // The entrance runs from here; once it has ended its finished animations are dropped (styles.css).
        cancelSettle?.();
        const timer = setTimeout(() => {
          cancelSettle = undefined;
          raiseAttribute(el, SANKEY_SETTLED_ATTR);
        }, sankeySettleMs(current().sankey.entranceMs));
        cancelSettle = () => { clearTimeout(timer); };
      });
    }
    contextPassive();
    // Controlled hover: drive the same native focus the pointer would.
    if (!controlled || !Object.is(controlled.index, hoveredNodeIndex)) {
      controlled = { index: hoveredNodeIndex };
      hover.applyControlled();
    }
    listenersOff ??= listen(el);
  };
  let cancelPassive: (() => void) | undefined;
  schedulePassive = (): void => {
    cancelPassive?.();
    cancelPassive = afterPaint(() => {
      cancelPassive = undefined;
      committed();
    });
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context,
    focus: readonly(focus),
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      const before = pass?.view;
      latestInput = input;
      pass = derive(input);
      if (selfDriven) {
        if (pass.view !== before) { bump(viewVersion); }
        bump(contextVersion);
      }
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    committed,
    contextCommitted() {
      if (subscribers > 0) { gate.reflect(loadedFor === current().revealKey); }
    },
    attach(dom) {
      host = dom.host;
      surfaceEl = dom.surface;
      // SAFETY: an adapter's chart host is a <div> (the public context types the ref as one).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      containerRef.current = dom.host as HTMLDivElement;
      // The owned stylesheet sits first in the host, before the surface's host element.
      let before: Node = dom.surface;
      while (before.parentNode !== null && before.parentNode !== dom.host) { before = before.parentNode; }
      const doc = dom.host.ownerDocument;
      staticStyle = doc.createElement("style");
      staticStyle.textContent = sankeyHoverCss();
      dom.host.insertBefore(staticStyle, before.parentNode === dom.host ? before : null);
      // Mount: TanStack's draw lays the scene out (and sets the flow direction on the host, definition.ts).
      mount(dom.surface);
      if (selfDriven) { schedulePassive(); }
    },
    mounted() {
      // The first post-paint moment: the passive half now (the hold release is the sankey's reveal; self mode scheduled it from `attach` too).
      cancelPassive?.();
      cancelPassive = undefined;
      committed();
    },
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      cancelRelease?.();
      cancelRelease = undefined;
      cancelSettle?.();
      cancelSettle = undefined;
      cancelAlign?.();
      cancelAlign = undefined;
      listenersOff?.();
      listenersOff = undefined;
      contextStop();
      staticStyle?.remove();
      staticStyle = null;
      hover.detach();
      chart?.destroy();
      // The destroyed renderer's tooltip element goes with it: no leaf portals into it.
      tooltip.onChange(null);
      clearAttribute(host, REVERSED_ATTR);
      clearAttribute(host, SANKEY_SETTLED_ATTR);
      mountedReveal = undefined;
      released = undefined;
      controlled = undefined;
      host = null;
      surfaceEl = null;
      containerRef.current = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}
