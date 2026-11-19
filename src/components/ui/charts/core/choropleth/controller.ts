import { motion } from "@tanstack/charts/motion";
import type { ChartPoint } from "@tanstack/charts";
import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { createReadyGate } from "../entrance/ready-gate";
import type { ReadyGateRun } from "../entrance/ready-gate";
import { erase } from "../erased-types";
import { hostPointerMove } from "../interaction/host-pointer";
import { createKeyboardFocusHold } from "../interaction/keyboard-hold";
import { attachMousePressFreeze, attachTapFocus } from "../interaction/touch-focus";
import { afterPaint } from "../lifecycle/after-paint";
import { prefersReducedMotion, subscribeReducedMotion } from "../loading/reduced-motion";
import { writePresence } from "../host-write";
import { memoCell } from "../memo";
import { readonly, writable } from "../store";
import type { Readable, Writable } from "../store";
import { createChartSurface, surfaceIdPrefix, surfaceOptions } from "../surface/surface";
import { choroplethA11y } from "./describe";
import type { ChartSurface } from "../surface/surface";
import { tooltipTargetStore } from "../surface/tooltip-target";
import { parseAspectRatio } from "../theme";
import type { ChoroplethCameraApi, ChoroplethChartProps, ChoroplethFeature, ChoroplethMarkerProps, TransformMatrix } from "../types/choropleth";
import { geoPath } from "d3-geo";
import type { Backdrop } from "./backdrop";
import { createCamera, edgeFadeActive, edgeFadeOf, perspectiveOn } from "./camera";
import type { CameraFrame, CameraInput } from "./camera";
import { apply, cameraTransform, compose, createPlane, invert, planeCss } from "./camera-math";
import type { Point } from "./camera-math";
import { choroplethConfigOf } from "./carriers";
import type { ChoroplethConfig } from "./carriers";
import { createChoroplethContext, withHover } from "./context";
import type { ChoroplethContext } from "./context";
import { createDefinition } from "./definition";
import { computeFadeVars, createLayerMotion, createRevealEpoch, enterMotionOf } from "./enter";
import type { EnterMotion } from "./enter";
import type { DotGrid } from "./dots";
import { choroplethLayer } from "./features";
import { createFeatureHover, ZERO_SIZE } from "./feature-hover";
import type { ChoroplethSize } from "./feature-hover";
import { createGeoGeometry, pickFeature } from "./focus";
import type { Markers } from "./markers";
import { FEATURES_ID, MARKERS_ID } from "./projection";
import { createStage } from "./stage";
import { createTooltipFollow } from "./tooltip-follow";
import { tooltipCardConfig } from "./tooltip-body";
import { choroplethHostStyle, choroplethSurfaceStyle, DEFAULT_CENTER, DEFAULT_INITIAL_ZOOM, hasPatterns, resolveMargin } from "./view";
import type { ChoroplethView } from "./view";
import { createWheelFocusClear } from "./wheel";
import { attachGeoZoom, createProjectionHolder, fromMatrix, zoomInstance } from "./zoom";
import type { ChoroplethZoomContextValue, ClientMapper, ZoomControl, ZoomTransform } from "./zoom";

/** The props a ChoroplethChart hands its controller (the adapter keeps `className` and renders the overlay children itself). */
export type ChoroplethProps = Omit<ChoroplethChartProps<unknown>, "children" | "className">;

/** The chart's container ref in its public context: the host while attached. */
interface ContainerRef {
  current: HTMLDivElement | null;
}

/** What `useChoropleth()` reads. */
export type ChoroplethControllerContext = ChoroplethContext<ContainerRef>;

export interface ChoroplethControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
  /** The framework id the surface's svg ids derive from (`surfaceIdPrefix`, RendererChart.js:37); the chart's uid when left out. */
  readonly surfaceId?: string;
}

export interface ChoroplethController<Node = unknown, Style = unknown> extends ChartController<ChoroplethProps, ChoroplethView<Node, Style>, ChoroplethControllerContext> {
  /** `useChoropleth()`: the context with the hovered feature, its tooltip data and `isLoaded` laid over it (context.ts `withHover`); never null. */
  readonly context: Readable<ChoroplethControllerContext>;
  /** The context with its hover slice at rest: it changes with the size, the zoom, the reveal epoch and the props, never on hover. React provides it and
   * lays the hover over it per reader (react/choropleth/context.tsx). */
  readonly contextAtRest: Readable<ChoroplethControllerContext>;
  /** `useChoroplethZoom()`: the zoom facade, null unless `zoomEnabled`. */
  readonly zoom: Readable<ChoroplethZoomContextValue>;
  /** `useChoroplethCamera()`: the click-to-zoom camera's state and controls. */
  readonly camera: Readable<ChoroplethCameraApi>;
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<ChoroplethProps>): void;
  /** "adapter": after a commit's paint. */
  committed(): void;
}

/** The base context's inputs from the props (the size, the zoom and the hover are the controller's). */
interface ContextProps {
  readonly animationDuration: number;
  readonly center: [number, number];
  readonly data: ChoroplethProps["data"];
  readonly enterTransition: ChoroplethProps["enterTransition"];
  readonly epoch: number;
  readonly margin: ReturnType<typeof resolveMargin>;
  readonly scale: number | undefined;
  readonly translate: [number, number] | undefined;
}

/** Everything one pass derives from the input and the controller's state (what React's render computed). */
interface Pass<Node, Style> {
  readonly animationDuration: number;
  /** The gate restarts when it changes (bklit's reveal replays on `animationDuration` or `revealSignature`). */
  readonly revealKey: string;
  readonly zoomEnabled: boolean;
  readonly zoomMin: number;
  readonly zoomMax: number;
  readonly initialZoom: TransformMatrix;
  readonly cameraInput: CameraInput;
  readonly config: ChoroplethConfig<Node, Style>;
  /** The markers the definition draws a point for, kept while their labels and coordinates hold. */
  readonly markers: readonly ChoroplethMarkerProps[];
  /** What the overlay's markers look like (a new one redraws them). */
  readonly markersLook: string;
  readonly contextProps: ContextProps;
  readonly options: ReturnType<typeof surfaceOptions>;
  readonly view: ChoroplethView<Node, Style>;
}

/** The props' defaults (core/types/choropleth.ts `@default`). */
const DEFAULT_ANIMATION_MS = 800;
const DEFAULT_ASPECT_RATIO = "16 / 9";
const DEFAULT_ZOOM_MIN = 0.5;
const DEFAULT_ZOOM_MAX = 4;
const DEFAULT_ARIA_LABEL = "Choropleth chart";
const DEFAULT_FOCUS_MAX_ZOOM = 6;
// bklit's 0.18s ease-out follows a wheel, pinch or programmatic step (none on a drag): the host flag that turns it on lasts this long.
const ZOOM_EASE_MS = 220;

/** What the markers' points need (a new key rebuilds the definition) and what their look needs (a new key redraws the overlay). */
const markerPointsKey = (markers: readonly ChoroplethMarkerProps[]): string => markers.map(({ label, coordinates }) => `${label}@${coordinates.join()}`).join("|");
const markerLookKey = (markers: readonly ChoroplethMarkerProps[]): string =>
  markers.map((m) => [m.label, m.coordinates.join(), m.shape, m.size, m.color, m.stroke, m.strokeWidth, m.pulse, m.glow, m.showLabel, m.className].join("~")).join("|");

export function createChoroplethController<Node = unknown, Style = unknown>(
  env: ChartEnv,
  initial: ChartInput<ChoroplethProps>,
  options: ChoroplethControllerOptions = {},
): ChoroplethController<Node, Style> {
  const selfDriven = options.commits !== "adapter";
  const { uid } = env;
  const idPrefix = surfaceIdPrefix(undefined, options.surfaceId ?? uid);
  const patternPrefix = `${uid}-`;
  let host: HTMLElement | null = null;
  let surfaceEl: HTMLElement | null = null;
  const containerRef: ContainerRef = { current: null };
  const tooltip = tooltipTargetStore();
  const viewVersion = writable(0);
  const contextVersion = writable(0);
  const zoomVersion = writable(0);
  const bump = (store: Writable<number>): void => { store.set(store.get() + 1); };
  let latestInput = initial;
  let pass: Pass<Node, Style> | undefined;
  let changedFromInside: (stores: readonly Writable<number>[]) => void = () => undefined;

  // --- The controller's state: what React held as state (size, transform, isDragging) and in refs --------------------------------
  const holder = createProjectionHolder(initial.props.initialZoom ?? DEFAULT_INITIAL_ZOOM);
  const geometry = createGeoGeometry(holder);
  // The size the renderer measured (feature-hover.ts `onSize`) and the zoom layer's transform and drag (zoom.ts `attachGeoZoom`).
  let size: ChoroplethSize = ZERO_SIZE;
  let transform: ZoomTransform = fromMatrix(initial.props.initialZoom ?? DEFAULT_INITIAL_ZOOM);
  let dragging = false;
  let control: ZoomControl | null = null;
  // The stage (the map layers, the plane, the overlay svg) and what it draws besides the renderer: each layer once its carrier enabled it
  // (features.ts), so a map without one never bundles it.
  const stage = createStage();
  let dotsLayer: DotGrid | undefined;
  let markersLayer: Markers | undefined;
  let backdropLayer: Backdrop | undefined;
  const dots = {
    draw: (...args: Parameters<DotGrid["draw"]>): void => {
      dotsLayer ??= choroplethLayer("dots")?.();
      dotsLayer?.draw(...args);
    },
    light: (index: number | null): void => { dotsLayer?.light(index); },
    remove: (): void => { dotsLayer?.remove(); },
    zoom: (k: number): void => { dotsLayer?.zoom(k); },
  };
  const markers = {
    draw: (...args: Parameters<Markers["draw"]>): void => {
      if (args[0].length === 0 && markersLayer === undefined) {return;}
      markersLayer ??= choroplethLayer("markers")?.();
      markersLayer?.draw(...args);
    },
    place: (at: Parameters<Markers["place"]>[0]): void => { markersLayer?.place(at); },
    refresh: (): void => { markersLayer?.refresh(); },
    remove: (): void => { markersLayer?.remove(); },
  };
  const backdrop = {
    draw: (...args: Parameters<Backdrop["draw"]>): void => {
      if (args[1] === undefined && backdropLayer === undefined) {return;}
      backdropLayer ??= choroplethLayer("backdrop")?.();
      backdropLayer?.draw(...args);
    },
    remove: (): void => { backdropLayer?.remove(); },
  };
  // The last pointer position over the chart (client px), for the tilted map's hit test and the flight's landing check.
  let lastPointer: Point | null = null;
  // The reader's reduced-motion preference, read once and kept current while attached (the pointer camera asks on every move).
  let reducedMotion: boolean | undefined;
  let reducedOff: (() => void) | undefined;
  const follow = createTooltipFollow();

  // --- The view: the composed transform on the map layers, the plane, the markers, written once per change -------------------------
  let reanchorFrame = 0;
  /** A focus held while the map moved: its tooltip moves to the feature's new anchor (tooltip-follow.ts; the renderer repaints the focus when
   * the panel isn't placed yet), and a feature the move carried out of view loses the focus. */
  const reanchor = (): void => {
    const el = surfaceEl;
    if (!el || !host || syncing) {return;}
    if (hover.hoverStore.hovered === null && hover.hoverStore.marker === null) {return;}
    if (!follow.follow()) {render(el);}
    clearHidden();
  };
  const scheduleReanchor = (): void => {
    if (reanchorFrame === 0) {
      reanchorFrame = requestAnimationFrame(() => {
        reanchorFrame = 0;
        reanchor();
      });
    }
  };
  const markerAt = (composed: { k: number; x: number; y: number }) => (coordinates: [number, number]): Point | null => {
    const p = holder.projection?.(coordinates);
    return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? apply(composed, { x: p[0], y: p[1] }) : null;
  };
  const writeFrame = (frame: CameraFrame, inFrame: boolean): void => {
    const { width, height } = size;
    const zoomNow = frame.zoom ?? transform;
    const composed = compose(cameraTransform(frame.view, width, height), zoomNow);
    holder.transform = composed;
    stage.setMap(composed);
    const angles = { depth: frame.depth, tilt: frame.tilt, yaw: frame.yaw };
    holder.plane = frame.perspective ? createPlane(angles, width, height) : null;
    stage.setPlane(frame.perspective ? planeCss(angles) : "", frame.perspective);
    dots.zoom(frame.view?.k ?? 1);
    markers.place(markerAt(composed));
    if (inFrame) {
      reanchor();
    } else {
      scheduleReanchor();
    }
  };

  const hover = createFeatureHover({
    geometry,
    highlights: () => !unpaintedOf(current().config),
    holder,
    host: () => host,
    layer: () => stage.mapLayer,
    onFeature: (index) => { dots.light(index); },
    onSize: (next) => {
      size = next;
      // The projection is rebuilt: the camera starts over (bklit's size effect).
      camera.resize();
      changedFromInside([contextVersion]);
    },
  });
  const getInteraction = () => erase(hover.interaction());
  // Keyboard-held focus survives a pointer pass (interaction/keyboard-hold.ts).
  const hold = createKeyboardFocusHold(getInteraction);
  const wheel = createWheelFocusClear();
  wheel.bind({ hoverStore: hover.hoverStore, interaction: hover.interaction, isHeld: hold.isHeld });
  const revealEpoch = createRevealEpoch();
  // `initial: "always"` replays the entrance on hydrated (server-rendered) SVG too.
  const renderer = motion({ initial: "always" });
  // bklit's entering layer ignores the hover (no dim, no highlight) until `isLoaded`; the CSS gates the dim and the highlight on `data-bkm-ready`.
  const gate = createReadyGate(() => host);
  const onFocusChange = (point: ChartPoint<ChoroplethFeature> | null): void => {
    hold(erase(point));
    hover.focusChange(point);
  };

  // --- The camera (camera.ts) ----------------------------------------------------------------------------------------------------
  const camera = createCamera({
    features: () => latestInput.props.data.features,
    onFocus: (key) => {
      writePresence(host, "data-bkm-cam-focus", key !== null);
      writePresence(host, "data-bkm-edge-on", edgeFadeActive(current().cameraInput.perspective, key !== null));
      markers.refresh();
      // While zoomed in only the focused target reacts (bklit gates its enter handlers): a hover on anything else ends.
      const held = hover.hoverStore.hovered;
      const marker = hover.hoverStore.marker;
      const off = key !== null && ((held !== null && key !== `feature:${held}`) || (marker !== null && key !== `point:${marker.label}`));
      if (off) {hover.interaction()?.setControlledFocus(null, { source: "pointer" });}
    },
    projection: () => holder.projection,
    reducedMotion: () => (reducedMotion ??= prefersReducedMotion()),
    resetZoom: () => {
      if (control === null) {return null;}
      const reset = fromMatrix(current().initialZoom);
      control.set(reset, true);
      transform = reset;
      bump(zoomVersion);
      bump(contextVersion);
      return reset;
    },
    settled: () => {
      // The map stopped under a resting pointer: as after a wheel tick, the hover stays only while its feature is still under it.
      if (lastPointer !== null) {wheel.onWheelZoom(lastPointer.x, lastPointer.y);}
    },
    size: () => size,
    write: writeFrame,
    zoom: () => transform,
  });
  holder.hoverable = (index) => camera.api.get().isHoverable(`feature:${index}`);
  // The hide delay ran out with the pointer on no feature: the focus it kept goes (the next move resolves nothing).
  holder.graceEnded = (): void => {
    if (hover.hoverStore.hovered !== null && !hold.isHeld()) {hover.interaction()?.setControlledFocus(null, { source: "pointer" });}
  };
  /** The host-local point of a client point (one box read). */
  const hostLocal = (clientX: number, clientY: number): Point | null => {
    const el = host;
    if (el === null) {return null;}
    const box = el.getBoundingClientRect();
    return { x: clientX - box.left - el.clientLeft, y: clientY - box.top - el.clientTop };
  };
  // The renderer reads the pointer through the svg's screen CTM, which flattens a 3D transform: on a tilted map the hit test maps the
  // pointer through the plane itself.
  holder.pointer = () => {
    const plane = holder.plane;
    if (plane === null || plane === undefined || lastPointer === null) {return null;}
    const local = hostLocal(lastPointer.x, lastPointer.y);
    return local === null ? null : plane.unproject(local);
  };
  let probeContext: CanvasRenderingContext2D | null | undefined = undefined;
  const probe = (): CanvasRenderingContext2D | null => {
    probeContext ??= document.createElement("canvas").getContext("2d");
    return probeContext;
  };
  /** bklit's clicks: a region flies the camera to it (again: back out), the empty map flies back. */
  const onClick = (event: MouseEvent): void => {
    const cam = camera.api.get();
    const target = event.target;
    const onMap = target instanceof Node && (surfaceEl?.contains(target) === true || stage.root.contains(target));
    if (!cam.enabled || !onMap || cam.wasDrag()) {return;}
    const local = hostLocal(event.clientX, event.clientY);
    if (local === null) {return;}
    const flat = holder.plane?.unproject(local) ?? local;
    const base = invert(holder.transform, flat);
    const hit = pickFeature<ChoroplethFeature>(erase(holder.renderedPoints ?? []), FEATURES_ID, geometry, base.x, base.y, probe());
    if (hit !== undefined) {
      cam.focusFeature(hit.datumIndex);
    } else if (cam.focusedKey !== null) {
      cam.reset();
    }
  };
  const onPointerDown = (event: PointerEvent): void => { camera.onPointerDown(event); };
  const onPointerMove = (event: PointerEvent): void => {
    lastPointer = { x: event.clientX, y: event.clientY };
    camera.onPointerMove(event, () => {
      const el = host;
      if (el === null) {return 0.5;}
      const box = el.getBoundingClientRect();
      return box.width > 0 ? (event.clientX - box.left) / box.width : 0.5;
    });
  };
  const onPointerLeave = (): void => {
    lastPointer = null;
    camera.onPointerLeave();
  };
  const onKeyDown = (event: KeyboardEvent): void => { camera.onKeyDown(event); };
  const markerHandlers = {
    activate: (props: ChoroplethMarkerProps): void => {
      const cam = camera.api.get();
      if (cam.enabled) {cam.focusPoint(props.coordinates, props.label);}
    },
    focus: (index: number | null, source: "pointer" | "keyboard"): void => {
      const interaction = hover.interaction();
      if (!interaction) {return;}
      if (index === null) {
        if (hover.hoverStore.marker !== null) {interaction.setControlledFocus(null, { source: "pointer" });}
        return;
      }
      const point = holder.renderedPoints?.find((p) => p.markId === MARKERS_ID && p.datumIndex === index);
      if (point) {interaction.setControlledFocus(erase(point), { source: source === "keyboard" ? "programmatic" : "pointer" });}
    },
    hoverable: (key: string): boolean => camera.api.get().isHoverable(key),
    interactive: (): boolean => current().cameraInput.clickToZoom,
    wasDrag: (): boolean => camera.api.get().wasDrag(),
  };

  // --- The zoom layer's callbacks ------------------------------------------------------------------------------------------------
  let easeTimer: ReturnType<typeof setTimeout> | undefined;
  /** bklit's 0.18s ease-out on the zoom group follows this step (styles.css, keyed on the host's flag while it lasts). */
  const easeZoom = (): void => {
    writePresence(host, "data-bkm-zoom-ease", true);
    clearTimeout(easeTimer);
    easeTimer = setTimeout(() => { writePresence(host, "data-bkm-zoom-ease", false); }, ZOOM_EASE_MS);
  };
  const onTransform = (next: ZoomTransform, smooth: boolean): void => {
    transform = next;
    camera.releaseZoom();
    if (smooth) {easeZoom();}
    writeFrame(camera.frame(), false);
    // Only the zoom's and the context's readers hear of it: nothing re-renders the chart.
    bump(zoomVersion);
    bump(contextVersion);
  };
  const onDragging = (next: boolean): void => {
    if (next === dragging) { return; }
    dragging = next;
    writePresence(host, "data-bkm-drag", next);
    if (next) {
      // A drag follows the pointer: a wheel's ease still running ends here.
      clearTimeout(easeTimer);
      writePresence(host, "data-bkm-zoom-ease", false);
    }
    bump(zoomVersion);
  };
  /** A gesture's start: the host's box read once, then each point mapped through the plane (when tilted) and back out of the camera. */
  const gesture = (): ClientMapper => {
    const el = host;
    const box = el?.getBoundingClientRect();
    const left = (box?.left ?? 0) + (el?.clientLeft ?? 0);
    const top = (box?.top ?? 0) + (el?.clientTop ?? 0);
    return (clientX, clientY) => {
      const local = { x: clientX - left, y: clientY - top };
      const flat = holder.plane?.unproject(local) ?? local;
      return invert(cameraTransform(camera.frame().view, size.width, size.height), flat);
    };
  };
  const centre = (): Point => invert(cameraTransform(camera.frame().view, size.width, size.height), { x: size.width / 2, y: size.height / 2 });

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's useMemo did) -------------------------
  const marginCell = memoCell<ReturnType<typeof resolveMargin>>();
  const configCell = memoCell<ChoroplethConfig<Node, Style>>();
  const enterMotionCell = memoCell<EnterMotion>();
  const fadeCell = memoCell<Record<string, string>>();
  const definitionCell = memoCell<ReturnType<typeof createDefinition>>();
  const optionsCell = memoCell<ReturnType<typeof surfaceOptions>>();
  const contextPropsCell = memoCell<ContextProps>();
  const attrsCell = memoCell<ChoroplethView["hostAttrs"]>();
  const hostStyleCell = memoCell<ChoroplethView["hostStyle"]>();
  const surfaceStyleCell = memoCell<ChoroplethView["surfaceStyle"]>();
  const patternsCell = memoCell<ChoroplethView<Node, Style>["patterns"]>();
  const tooltipCell = memoCell<ChoroplethView<Node, Style>["tooltip"]>();
  const viewCell = memoCell<ChoroplethView<Node, Style>>();
  const cameraCell = memoCell<CameraInput>();
  const markersCell = memoCell<readonly ChoroplethMarkerProps[]>();
  let markersKey = "";
  let markersKept: readonly ChoroplethMarkerProps[] = [];

  const derive = ({ props, table }: ChartInput<ChoroplethProps>): Pass<Node, Style> => {
    const {
      data,
      margin: marginProp,
      animationDuration = DEFAULT_ANIMATION_MS,
      enterTransition,
      revealSignature = "",
      aspectRatio = DEFAULT_ASPECT_RATIO,
      scale,
      center = DEFAULT_CENTER,
      translate,
      zoomEnabled = false,
      zoomMin = DEFAULT_ZOOM_MIN,
      zoomMax = DEFAULT_ZOOM_MAX,
      initialZoom = DEFAULT_INITIAL_ZOOM,
      ariaLabel = DEFAULT_ARIA_LABEL,
      ariaDescription,
      clickToZoom = false,
      focusMaxZoom = DEFAULT_FOCUS_MAX_ZOOM,
      zoomTransition,
      perspective,
    } = props;
    const margin = marginCell([marginProp], () => resolveMargin(marginProp));
    const ratio = parseAspectRatio(aspectRatio);
    const config = configCell([table], () => choroplethConfigOf<Node, Style>(table));
    const { featureConfig, tooltipConfig, graticuleConfig } = config;
    // The markers' points keep their identity while their labels and coordinates hold (a re-render's new props objects don't rebuild the definition).
    const nextMarkersKey = markerPointsKey(config.markers);
    if (nextMarkersKey !== markersKey) {
      markersKey = nextMarkersKey;
      markersKept = config.markers;
    }
    const markerPoints = markersCell([markersKept], () => markersKept);
    const unpainted = unpaintedOf(config);
    // Moves in the pass whose props change its key, so that pass's context already carries it.
    const epoch = revealEpoch.update(animationDuration, revealSignature);
    const enterMotion = enterMotionCell([enterTransition], () => enterMotionOf(enterTransition));
    const fadeVars = fadeCell([animationDuration, enterTransition], () => computeFadeVars(animationDuration, enterTransition));
    const definition = definitionCell([center, data, enterMotion, featureConfig, graticuleConfig, margin, scale, tooltipConfig, translate, unpainted, markerPoints], () =>
      createDefinition({ center, data, featureConfig, follow, geometry, graticuleConfig, holder, layerMotion: createLayerMotion(enterMotion), margin, markers: markerPoints, patternPrefix, scale, tooltipConfig, translate, unpainted }));
    const surface = optionsCell([definition, renderer, ratio, ariaLabel, ariaDescription, data, table], () =>
      surfaceOptions(erase({ ariaDescription, ariaLabel, aspectRatio: ratio, definition, onFocusChange, onRender, onTooltipBodyChange: tooltip.onChange, renderer, a11y: choroplethA11y(data, table) }), idPrefix));
    const fadedOpacity = featureConfig?.fadedOpacity;
    const perspectiveKey = perspective === undefined ? "" : JSON.stringify(perspective);
    const easeKey = zoomTransition?.ease?.join() ?? "";
    const cameraInput = cameraCell([clickToZoom, focusMaxZoom, zoomTransition?.duration, easeKey, perspectiveKey], () => ({ clickToZoom, focusMaxZoom, perspective, zoomTransition }));
    const edgeFade = edgeFadeOf(cameraInput.perspective, perspectiveOn(cameraInput.perspective));
    const hostAttrs = attrsCell([edgeFade > 0], () => ({ "data-bkm-chart": "choropleth", "data-bkm-edge": edgeFade > 0 ? "" : undefined, "data-slot": "chart" }));
    const hostStyle = hostStyleCell([ratio, zoomEnabled, fadedOpacity, fadeVars, edgeFade], () => choroplethHostStyle({ edgeFade, fadeVars, fadedOpacity, ratio, zoomEnabled }));
    const surfaceStyle = surfaceStyleCell([ratio], () => choroplethSurfaceStyle(ratio));
    const patterns = patternsCell([featureConfig], () => {
      const nodes = featureConfig?.patterns;
      return nodes !== undefined && hasPatterns(featureConfig) ? { nodes, prefix: patternPrefix } : null;
    });
    const tooltipCard = tooltipCell([tooltipConfig], () => (tooltipConfig ? tooltipCardConfig(tooltipConfig) : undefined));
    // bklit's tooltip grace bridges border gaps; without a tooltip nothing waits.
    holder.hideDelay = tooltipCard?.hideDelay ?? 0;
    const view = viewCell([hostAttrs, hostStyle, surfaceStyle, patterns, tooltipCard], () => ({ hostAttrs, hostStyle, patterns, surfaceStyle, tooltip: tooltipCard }));
    return {
      animationDuration,
      revealKey: `${animationDuration}|${revealSignature}`,
      zoomEnabled,
      zoomMin,
      zoomMax,
      initialZoom,
      cameraInput,
      config,
      markers: markerPoints,
      markersLook: markerLookKey(config.markers),
      contextProps: contextPropsCell([animationDuration, center, data, enterTransition, epoch, margin, scale, translate], () => ({ animationDuration, center, data, enterTransition, epoch, margin, scale, translate })),
      options: surface,
      view,
    };
  };

  const current = (): Pass<Node, Style> => {
    pass ??= derive(latestInput);
    return pass;
  };

  // --- The overlay: the dot grid, the markers and the backdrop, redrawn when what they draw changes --------------------------------
  let dotsDrawn: readonly unknown[] = [];
  let markersDrawn: string | undefined;
  const drawOverlay = (): void => {
    const el = host;
    if (el === null) {return;}
    const { config, markers: list, markersLook, cameraInput, contextProps } = current();
    const props = config.dotGridConfig;
    const { projection } = holder;
    const dotsKey = [props, projection, size.width, size.height, contextProps.epoch, cameraInput.focusMaxZoom, contextProps.data];
    if (dotsKey.length !== dotsDrawn.length || dotsKey.some((value, i) => value !== dotsDrawn[i])) {
      dotsDrawn = dotsKey;
      if (props !== undefined && projection !== undefined && size.width > 0 && size.height > 0) {
        const path = geoPath(projection);
        const features = contextProps.data.features;
        dots.draw({ featurePaths: features.map((feature) => path(feature)), features, height: size.height, maxZoom: cameraInput.focusMaxZoom, props, width: size.width }, stage.mapLayer, stage.defs, uid);
        dots.light(hover.hoverStore.hovered);
      } else {
        dots.remove();
      }
    }
    if (markersLook !== markersDrawn) {
      markersDrawn = markersLook;
      markers.draw(list, stage.markerLayer, stage.defs, uid, markerHandlers);
    }
    backdrop.draw(el, config.backgroundConfig, uid);
  };
  /** After every renderer pass: its size and focus mirrored (feature-hover.ts), the stage's writes put back, the overlay drawn. */
  function onRender(context: Parameters<typeof hover.render>[0]): void {
    hover.render(context);
    stage.afterRender();
    drawOverlay();
    markers.place(markerAt(holder.transform));
  }

  // --- The commit-phase work ---------------------------------------------------------------------------------------------------
  let chart: ChartSurface | undefined;
  const surfaceOf = (): ChartSurface => {
    chart ??= createChartSurface(current().options);
    return chart;
  };
  let syncing = false;
  // The transform `clearHidden` last ran for (React's layout effect on [transform]); reset by `detach`.
  let clearedFor: ZoomTransform | undefined;
  const clearHidden = (): void => {
    if (holder.transform === clearedFor) { return; }
    clearedFor = holder.transform;
    // A held feature the zoom carried out of view loses the focus (feature-hover.ts).
    hover.clearHidden();
  };
  const render = (el: HTMLElement): void => {
    syncing = true;
    try {
      surfaceOf().render(el, current().options);
    } finally {
      syncing = false;
    }
  };
  /** The camera's options and the host flags they set. */
  const configureCamera = (): void => {
    const { cameraInput } = current();
    camera.configure(cameraInput);
    writePresence(host, "data-bkm-edge-on", edgeFadeActive(cameraInput.perspective, camera.api.get().focusedKey !== null));
  };
  /** A commit's layout half: the renderer gets the latest options (RendererChart.js's layout effect; without a new definition it repaints the held
   * focus, so its tooltip re-anchors), then the camera's options, the overlay and the hidden-focus clear. */
  const layout = (): void => {
    const el = surfaceEl;
    if (!el || !host) {
      return;
    }
    render(el);
    configureCamera();
    drawOverlay();
    clearHidden();
  };
  // What the passive work last ran for (React effects' deps); reset by `detach`, so a re-attach runs it again.
  let zoomKey: string | undefined;
  let zoomOff: (() => void) | undefined;
  let freezeOn: boolean | undefined;
  let freezeOff: (() => void) | undefined;
  let tapOff: (() => void) | undefined;
  let holdOff: (() => void) | undefined;
  let cameraOff: (() => void) | undefined;
  let escapeOn = false;
  let gateKey: string | undefined;
  let staticZoom: TransformMatrix | undefined;
  const gateRun = (): ReadyGateRun => ({ duration: current().animationDuration });
  /** A commit's passive half, in the order React ran these effects. */
  const committed = (): void => {
    const el = host;
    if (!el) {
      return;
    }
    const { zoomEnabled, zoomMin, zoomMax, initialZoom, revealKey, cameraInput } = current();
    // The gesture layer while `zoomEnabled`; a new range re-installs it from `initialZoom`, which it applies at once.
    const nextZoomKey = zoomEnabled ? `${zoomMin}|${zoomMax}` : "";
    if (nextZoomKey !== zoomKey) {
      zoomKey = nextZoomKey;
      zoomOff?.();
      zoomOff = undefined;
      control = null;
      if (zoomEnabled) {
        const layer = attachGeoZoom(el, { centre, gesture, initial: initialZoom, max: zoomMax, min: zoomMin, onDragging, onTransform, onWheelZoom: wheel.onWheelZoom });
        control = layer.control;
        zoomOff = layer.detach;
      }
    }
    // Without the gesture layer, `initialZoom` is the map's fixed transform.
    if (!zoomEnabled && initialZoom !== staticZoom) {
      staticZoom = initialZoom;
      const next = fromMatrix(initialZoom);
      if (next.k !== transform.k || next.x !== transform.x || next.y !== transform.y) {
        transform = next;
        writeFrame(camera.frame(), false);
        bump(zoomVersion);
        bump(contextVersion);
      }
    }
    // A new animationDuration or revealSignature restarts the gate once it is armed.
    if (revealKey !== gateKey) {
      gateKey = revealKey;
      gate.restart(gateRun());
    }
    // bklit hovers on mouseenter / mouseleave, so a tap hovers until a tap elsewhere; a zoomable map's drag (visx / use-gesture) also captures the press and pans by touch.
    if (zoomEnabled !== freezeOn) {
      freezeOn = zoomEnabled;
      freezeOff?.();
      freezeOff = zoomEnabled ? attachMousePressFreeze(el, getInteraction) : undefined;
    }
    tapOff ??= attachTapFocus(el, getInteraction, "tap");
    reducedOff ??= subscribeReducedMotion(() => { reducedMotion = prefersReducedMotion(); });
    holdOff ??= hold.attach(el);
    // The camera's pointer: the press (a drag's click doesn't count), the pointer view, the tilted hit test; its clicks and Escape.
    if (cameraOff === undefined) {
      el.addEventListener("pointerdown", onPointerDown, { capture: true });
      el.addEventListener(hostPointerMove(el), onPointerMove, { capture: true, passive: true });
      el.addEventListener("pointerleave", onPointerLeave);
      el.addEventListener("click", onClick);
      cameraOff = (): void => {
        el.removeEventListener("pointerdown", onPointerDown, { capture: true });
        el.removeEventListener(hostPointerMove(el), onPointerMove, { capture: true });
        el.removeEventListener("pointerleave", onPointerLeave);
        el.removeEventListener("click", onClick);
      };
    }
    if (cameraInput.clickToZoom !== escapeOn) {
      escapeOn = cameraInput.clickToZoom;
      if (escapeOn) {window.addEventListener("keydown", onKeyDown);} else {window.removeEventListener("keydown", onKeyDown);}
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
  changedFromInside = (stores): void => {
    const before = pass?.view;
    pass = derive(latestInput);
    for (const store of stores) { bump(store); }
    if (pass.view !== before) { bump(viewVersion); }
    if (!selfDriven || microtask) {
      return;
    }
    // Never inside the renderer's own callbacks (a draw's measured size): the next microtask, as a port's own flush would.
    microtask = true;
    queueMicrotask(() => {
      microtask = false;
      if (!host) { return; }
      if (!syncing) { layout(); }
      schedulePassive();
    });
  };

  // --- The public contexts: built when read; a context keeps its object while its inputs hold --------------------------------------
  const buildContext = createChoroplethContext<ContainerRef>();
  const contextAtRest: Readable<ChoroplethControllerContext> = {
    get: () => buildContext({ ...current().contextProps, containerRef, hoverStore: hover.hoverStore, ready: gate.store, setHoveredFeatureIndex: hover.setHoveredFeatureIndex, size, transform }),
    subscribe: contextVersion.subscribe,
  };
  const readerCell = memoCell<ChoroplethControllerContext>();
  const context: Readable<ChoroplethControllerContext> = {
    get: () => {
      const base = contextAtRest.get();
      const loaded = gate.store.get();
      return readerCell([base, hover.hoverStore.version, loaded], () => withHover(base, loaded));
    },
    subscribe: (listener) => {
      const offs = [contextVersion.subscribe(listener), hover.hoverStore.subscribe(listener), gate.store.subscribe(listener)];
      return (): void => { for (const off of offs) { off(); } };
    },
  };
  const zoomCell = memoCell<ChoroplethZoomContextValue>();
  const zoom: Readable<ChoroplethZoomContextValue> = {
    get: () => {
      const { zoomEnabled, initialZoom } = current();
      return zoomCell([zoomEnabled, initialZoom, dragging, transform], () => ({ zoom: zoomInstance({ control: () => control, enabled: zoomEnabled, initial: initialZoom, isDragging: dragging, transform }) }));
    },
    subscribe: zoomVersion.subscribe,
  };

  let highlightOff: (() => void) | undefined;
  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(tooltip),
    context,
    contextAtRest,
    zoom,
    camera: camera.api,
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      const before = pass;
      latestInput = input;
      pass = derive(input);
      if (selfDriven) {
        if (pass.view !== before?.view) { bump(viewVersion); }
        if (pass.contextProps !== before?.contextProps) { bump(contextVersion); }
        if (pass.zoomEnabled !== before?.zoomEnabled || pass.initialZoom !== before?.initialZoom) { bump(zoomVersion); }
      }
      layout();
      if (selfDriven) { schedulePassive(); }
    },
    committed,
    attach(dom) {
      host = dom.host;
      surfaceEl = dom.surface;
      // SAFETY: an adapter's chart host is a <div> (the public context types the ref as one).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      containerRef.current = dom.host as HTMLDivElement;
      // The overlay goes after the chart's children (React appended its highlight from the chart's layout effect, after the surface mounted).
      stage.attach(dom.host, dom.surface);
      configureCamera();
      // Mount: TanStack's draw builds the projection and reports the size it measured; the overlay draws after it (onRender).
      render(dom.surface);
      highlightOff = hover.attach(dom.host);
      // The initial transform and plane before the first paint.
      writeFrame(camera.frame(), false);
      clearHidden();
      // The gate's restart key as of the mount: a later change restarts it (React's restart effect ran before the mount effect armed it).
      gateKey = current().revealKey;
      if (selfDriven) { schedulePassive(); }
    },
    mounted() {
      gate.arm(gateRun());
    },
    detach() {
      cancelPassive?.();
      cancelPassive = undefined;
      cancelAnimationFrame(reanchorFrame);
      reanchorFrame = 0;
      clearTimeout(easeTimer);
      holdOff?.();
      holdOff = undefined;
      tapOff?.();
      tapOff = undefined;
      freezeOff?.();
      freezeOff = undefined;
      freezeOn = undefined;
      zoomOff?.();
      zoomOff = undefined;
      zoomKey = undefined;
      staticZoom = undefined;
      control = null;
      cameraOff?.();
      cameraOff = undefined;
      reducedOff?.();
      reducedOff = undefined;
      reducedMotion = undefined;
      if (escapeOn) { window.removeEventListener("keydown", onKeyDown); }
      escapeOn = false;
      camera.dispose();
      wheel.dispose();
      gate.dispose();
      gateKey = undefined;
      // The renderer goes first, then the highlight and the focus it showed (React ran RendererChart's cleanup before the chart's own).
      chart?.destroy();
      highlightOff?.();
      highlightOff = undefined;
      dots.remove();
      markers.remove();
      backdrop.remove();
      stage.detach();
      dotsDrawn = [];
      markersDrawn = undefined;
      clearedFor = undefined;
      for (const name of ["data-bkm-drag", "data-bkm-zoom-ease", "data-bkm-cam-focus", "data-bkm-edge-on"]) { writePresence(host, name, false); }
      host = null;
      surfaceEl = null;
      lastPointer = null;
      containerRef.current = null;
    },
    prerender: () => surfaceOf().prerender(),
  };
}

/** A dot grid without a `ChoroplethFeatureComponent` draws the map alone: the features stay for hover and keyboard, unpainted. */
const unpaintedOf = (config: { readonly dotGridConfig: unknown; readonly featureConfig: unknown }): boolean => config.dotGridConfig !== undefined && config.featureConfig === undefined;
