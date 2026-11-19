"use client";

// React's adapter over the gauge controller (core/gauge/controller.ts), whose dial draws the gauge in the surface element and runs its sweep
// (core/gauge/dial.ts); only the centre/label stat is React's (gauge/label.tsx, NumberFlow). It calls the controller at the phases the shell
// ran that work in: `prepare` while rendering, `update` after every commit (layout), `attach` / `detach` at mount (layout) and whenever the
// host moves (`view.layout`). It renders the root, the host, the surface, the reader's defs (children) and the stat.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { NO_CARRIERS } from "./core/carriers/table";
import { warnOnce } from "./core/carriers/registry";
import { createGaugeController } from "./core/gauge/controller";
import { toCamel } from "./core/style";
import type { GaugeProps as CoreGaugeProps } from "./core/types/gauge";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { useRenderStart } from "./kit/entrance/entrance-align";
import { useHydratingAttrs } from "./kit/use-hydrating";
import { useSanitizedId } from "./kit/use-sanitized-id";
import { ControllerSurface } from "./runtime/surface";
import { renderMarkup } from "./runtime/markup";
import { GAUGE_CHILD_DEFS } from "./core/gauge/view";
import { GaugeCenter, GaugeLabelLayout } from "./gauge/label";
export type {
  GaugeArcStyle,
  GaugeCenterDiscOptions,
  GaugeDotsOptions,
  GaugeGlowOptions,
  GaugeLabelAlign,
  GaugeLabelPlacement,
  GaugeNeedleOptions,
  GaugeNeedleVariant,
  GaugeOrientation,
  GaugeProgressRingOptions,
  GaugeRulerLabelOptions,
  GaugeRulerOptions,
  GaugeRulerPosition,
  GaugeSectorOptions,
  GaugeZone,
  GaugeZoneDisplay,
} from "./core/types/gauge";

/** Props for `Gauge`. */
export interface GaugeProps extends CoreGaugeProps<ReactNode> {}

// A gauge has no tooltip (`tooltip: false`).
const noTooltipBody = (): null => null;

/**
 * Gauge that shows a 0 to 100 `value`: a notch, solid or sector dial (`arcStyle`) or a horizontal notch track (`orientation="linear"`), with
 * optional dial layers (`ruler`, `needle`, `zones`, `sector`, `progressRing`, `dots`, `glow`, `centerDisc`). Set `centerValue` to add a label
 * with an animated number. The track fades in, then the fill sweeps from zero on a zero-bounce spring; a new `value` sweeps on from where it
 * is. Omit `width` and `height` to fill the parent. The gauge is server-rendered and plays its entrance after hydration.
 */
const Gauge = /* @__PURE__ */ Object.assign(function Gauge(props: GaugeProps): ReactElement {
  const uid = useSanitizedId();
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const hydratingAttrs = useHydratingAttrs();
  const input = { props, table: NO_CARRIERS };
  const [controller] = useState(() => createGaugeController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  controller.prepare(input);
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.get, controller.view.get);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const renderStart = useRenderStart();
  // Every commit hands the renderer its latest options, as RendererChart.js's layout effect did.
  useLayoutEffect(() => { controller.update(input); });
  // Entrance starts on the first draw, without bklit's ParentSize frames (gauge.tsx:685), at the user's direction (no frame waits); the curve is unchanged.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) {
      return undefined;
    }
    controller.attach({ host, surface }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, renderStart, view.layout]);
  const surface = <ControllerSurface prerender={controller.prerender} renderTooltipBody={noTooltipBody} style={view.surfaceStyle} surfaceRef={surfaceRef} tooltip={controller.tooltip} />;
  // The reader's defs (pattern tiles a fill paints with `url(#id)`), in a hidden svg.
  const defs = props.children === undefined || props.children === null || props.children === false ? null : renderMarkup(GAUGE_CHILD_DEFS, props.children);
  const root = (child: ReactNode): ReactElement => (
    <div className={view.rootClass} {...view.rootAttrs} {...hydratingAttrs} style={view.rootStyle === undefined ? undefined : toCamel(view.rootStyle)}>
      {child}
    </div>
  );

  if (view.linear) {
    const track = <div ref={hostRef} style={toCamel(view.hostStyle)}>{surface}{defs}</div>;
    const labelled = <GaugeLabelLayout align={view.labelAlign} placement={view.labelPlacement} stat={view.stat}>{track}</GaugeLabelLayout>;
    const box = view.linearBox;
    if (box === null) {
      return root(labelled);
    }
    return root(box.clipped
      ? <div className="bk-gauge-clip" style={toCamel(box.style)}><div className="bk-gauge-clip-box"><div className="bk-gauge-clip-inner">{labelled}</div></div></div>
      : <div className="bk-gauge-clip" style={toCamel(box.style)}>{labelled}</div>);
  }

  return root(
    <div className={view.hostClass} ref={hostRef} style={toCamel(view.hostStyle)}>
      {surface}
      {defs}
      {view.stat === null ? null : <GaugeCenter stat={view.stat} />}
    </div>,
  );
}, { displayName: "Gauge" });

export { Gauge };
