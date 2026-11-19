"use client";
// bklit LiveLineChart on native TanStack Charts: React's adapter over the live line controller (core/live-line/controller.ts), which builds
// the rolling frame and its definition (the streaming scroll is the native `motion.path` rolling contract, a linear tween one sample interval
// long, not a rAF loop) and hosts both renderers, the line's and the y labels' layer. Config comes from LiveLine / Grid / LiveXAxis /
// LiveYAxis / ChartTooltip carrier children. The adapter calls the controller at React's phases: `prepare` while
// rendering, `update` after every commit (layout), `attach` / `detach` at mount (layout), `committed` after every commit's paint (passive).
// It renders the host, the surface while the chart is built, the tooltip leaf and the pattern tiles; hover never re-renders it.
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createLiveLineController } from "./core/live-line/controller";
import type { LiveTooltipOptions } from "./core/live-line/live-tooltip";
import { warnOnce } from "./core/carriers/registry";
import { erase } from "./core/erased-types";
import { toCamel } from "./core/style";
import type { LiveLineChartProps as CoreLiveLineChartProps } from "./core/types/live-line";
import { useChartConfig, useStaticChartPreview } from "./kit/cartesian/chart-config";
import { useRenderStart } from "./kit/entrance/entrance-align";
import { readChildren } from "./kit/read-children";
import { warnUnrenderedChildren } from "./kit/stable-children";
import { BklitTooltipBody } from "./kit/tooltip/tooltip-body";
import { useSanitizedId } from "./kit/use-sanitized-id";
import { renderMarkup } from "./runtime/markup";
import { ControllerSurface } from "./runtime/surface";

export interface LiveLineChartProps extends CoreLiveLineChartProps<ReactNode, CSSProperties> {}

const bump = (n: number): number => n + 1;

/** A real-time line chart that scrolls with the clock. Append samples to `data`, pass the latest `value`, and add a `LiveLine` child. It draws after mount, so the server renders an empty shell. */
export const LiveLineChart = (props: Readonly<LiveLineChartProps>): ReactElement => {
  const { children, className, style } = props;
  const uid = `l${useSanitizedId()}`;
  const staticPreview = useStaticChartPreview();
  const config = useChartConfig();
  const table = useMemo(() => { warnUnrenderedChildren(children, "LiveLineChart"); return readChildren(children); }, [children]);
  const input = { props, table };
  const [controller] = useState(() => createLiveLineController({ uid, staticPreview, config, warn: warnOnce }, input, { commits: "adapter" }));
  // The controller's changes from inside (the first width from rAF, the scene's width from the mounting draw, the intro from the seed's
  // passive effect, a y label pick from rAF) re-render on the lane of the moment they happen (a scheduled render, a synchronous one from
  // the layout effect); a useSyncExternalStore subscription would render each one synchronously.
  const [, rerender] = useReducer(bump, 0);
  controller.prepare(input);
  const view = controller.view.get();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const renderStart = useRenderStart();
  useLayoutEffect(() => controller.view.subscribe(rerender), [controller]);
  // Every commit hands the renderers their latest options, as RendererChart.js's layout effect does.
  useLayoutEffect(() => { controller.update(input); });
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    controller.attach({ host, surface: null }, { renderStart: renderStart.current });
    return () => { controller.detach(); };
  }, [controller, renderStart]);
  useEffect(() => { controller.committed(); });
  // SAFETY: the table holds the props React's carriers were given, so the ChartTooltip's `content` returns React nodes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  const tooltipOptions = view.tooltipOptions as LiveTooltipOptions<ReactNode>;
  return (
    <div
      ref={hostRef}
      className={className}
      // SAFETY: the core's style objects hold CSS properties and `--bkm-*` / `--ts-chart-*` custom properties only.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
      style={{ ...toCamel(view.hostStyle), ...style, ...toCamel(view.hostVars) } as CSSProperties}
      {...view.hostAttrs}
    >
      {view.built ? (
        <ControllerSurface
          surfaceRef={controller.setSurface}
          style={view.surfaceStyle}
          prerender={controller.prerender}
          tooltip={controller.tooltip}
          renderTooltipBody={({ points }) => <BklitTooltipBody points={erase(points)} options={tooltipOptions} />}
        />
      ) : null}
      {renderMarkup(view.pill)}
    </div>
  );
};
