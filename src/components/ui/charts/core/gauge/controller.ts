import type { ChartController, ChartEnv, ChartInput } from "../chart/controller";
import { prefersReducedMotion } from "../loading/reduced-motion";
import { memoCell } from "../memo";
import { readonly, writable } from "../store";
import { surfaceBox, surfaceHostStyle } from "../surface/surface";
import type { TooltipTarget } from "../surface/tooltip-target";
import type { StyleObject } from "../style";
import type { GaugeProps } from "../types/gauge";
import { createGaugeDial } from "./dial";
import type { DialInput } from "./dial";
import { ARC_ASPECT, createGaugeModel } from "./model";
import { resolveGaugeProps } from "./props";
import { gaugeLayout, linearBoxOf } from "./view";
import type { GaugeStat, GaugeView } from "./view";

export interface GaugeControllerOptions {
  /** Who times the commit-phase work (see the head of this file): React's adapter ("adapter"), or the controller itself (the ports, the default). */
  readonly commits?: "adapter" | "self";
}

export interface GaugeController extends ChartController<GaugeProps<unknown>, GaugeView> {
  /** "adapter": the input of the pass being rendered (idempotent; never notifies). */
  prepare(input: ChartInput<GaugeProps<unknown>>): void;
}

/** Everything one pass derives from the input (what React's render computed). */
interface Pass {
  readonly dial: DialInput;
  readonly view: GaugeView;
}

export function createGaugeController(env: ChartEnv, initial: ChartInput<GaugeProps<unknown>>, options: GaugeControllerOptions = {}): GaugeController {
  const selfDriven = options.commits !== "adapter";
  const build = createGaugeModel();
  const viewVersion = writable(0);
  const dial = createGaugeDial();
  let latestInput = initial;
  let pass: Pass | undefined;

  // --- One pass: the memo cells keep each value's identity while its inputs hold (as React's memoised hooks did) -------------------
  const surfaceStyleCell = memoCell<StyleObject>();
  const statCell = memoCell<GaugeStat | null>();
  const viewCell = memoCell<GaugeView>();
  const dialCell = memoCell<DialInput>();

  const derive = ({ props }: ChartInput<GaugeProps<unknown>>): Pass => {
    const resolved = resolveGaugeProps(props);
    const { width, height, centerValue, defaultLabel, prefix, suffix, formatOptions, labelPlacement, labelAlign } = resolved;
    const model = build({ idPrefix: env.uid, resolved });
    const { linear, fixed, trackHeight, styles } = model;
    // The linear track is `trackHeight` tall at `width` (or the container's); a fixed arc is `width` × `height`; a fluid one keeps `ARC_ASPECT`.
    const size = linear
      ? { width, height: trackHeight, aspectRatio: undefined }
      : { width: fixed ? width : undefined, height: fixed ? height : undefined, aspectRatio: fixed ? undefined : ARC_ASPECT };
    const surfaceStyle = surfaceStyleCell([size.width, size.height, size.aspectRatio], () => surfaceHostStyle(surfaceBox(size)));
    const stat = statCell([centerValue, defaultLabel, prefix, suffix, formatOptions], () =>
      (centerValue === undefined ? null : { value: centerValue, label: defaultLabel, prefix, suffix, format: formatOptions }));
    const linearBox = linear ? linearBoxOf({ width, labelled: stat !== null, clip: styles.linearClip, flow: styles.linearFlow }) : null;
    const layout = gaugeLayout(linear, linearBox, stat, labelPlacement, labelAlign);
    const hostClass = linear ? undefined : model.arcHostClass;
    const hostStyle = linear ? styles.track : styles.arcHost;
    const view = viewCell(
      [linear, layout, model.rootClass, styles.root, hostClass, hostStyle, linearBox?.clipped, linearBox?.style, surfaceStyle, stat, labelPlacement, labelAlign],
      () => ({
        linear,
        layout,
        rootClass: model.rootClass,
        rootAttrs: { "data-bkm-chart": "" },
        rootStyle: styles.root,
        hostClass,
        hostStyle,
        linearBox,
        surfaceStyle,
        stat,
        labelPlacement,
        labelAlign,
      }),
    );
    // Read on every pass, as the React shell read it on every render.
    const animate = !model.instant && !prefersReducedMotion();
    const dialInput = dialCell(
      [model.spec, model.aria, model.fill, model.value, model.fixedSize, model.nominalSize, model.motion, animate, model.delayMs],
      () => ({ animate, aria: model.aria, delayMs: model.delayMs, fill: model.fill, fixed: model.fixedSize, motion: model.motion, nominal: model.nominalSize, spec: model.spec, value: model.value }),
    );
    return { dial: dialInput, view };
  };

  const current = (): Pass => {
    pass ??= derive(latestInput);
    return pass;
  };

  let lastDial: DialInput | undefined;
  const push = (): void => {
    const next = current().dial;
    if (next !== lastDial) {
      lastDial = next;
      dial.update(next);
    }
  };

  return {
    view: { get: () => current().view, subscribe: viewVersion.subscribe },
    tooltip: readonly(writable<TooltipTarget | null>(null)),
    context: readonly(writable(null)),
    prepare(input) {
      latestInput = input;
      pass = derive(input);
    },
    update(input) {
      const before = pass?.view;
      latestInput = input;
      pass = derive(input);
      if (selfDriven && pass.view !== before) { viewVersion.set(viewVersion.get() + 1); }
      push();
    },
    attach(dom) {
      push();
      dial.attach(dom.surface);
    },
    // No reveal to arm: the entrance starts at `attach`.
    mounted() {},
    detach() {
      dial.detach();
    },
    prerender: () => dial.prerender(current().dial),
  };
}
