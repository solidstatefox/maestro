"use client";

import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createSparklineController, SPARKLINE_HEIGHT } from "../core/sparkline/controller";
import type { SparklineKind } from "../core/sparkline/controller";
import { sparklineHostAttrs } from "../core/sparkline/markup";
import type { AnySparklineProps } from "../core/types/sparkline";
import { useHydrating } from "../kit/use-hydrating";
import type { AreaSparklineProps, BarSparklineProps, LineSparklineProps, SparklineBaseProps } from "./types";

/** What the server (and the hydrating render) writes on the host and in it; the same object on every later render. */
interface ServerParts {
  readonly attrs: Readonly<Record<string, string | number>> | undefined;
  readonly html: { readonly __html: string } | undefined;
}

const CLIENT_ONLY: ServerParts = { attrs: undefined, html: undefined };

function useSparkline<T>(kind: SparklineKind, props: SparklineBaseProps<T>): ReactElement {
  const [controller] = useState(() => createSparklineController<T>(kind));
  const id = useId();
  const hydrating = useHydrating();
  const server = useRef<ServerParts | null>(null);
  if (server.current === null) {
    if (hydrating && props.width !== undefined) {
      const { tabindex, ...attrs } = sparklineHostAttrs(props as AnySparklineProps<T>);
      server.current = {
        attrs: tabindex === undefined ? attrs : { ...attrs, tabIndex: tabindex },
        html: { __html: controller.prerender(props as AnySparklineProps<T>, id) },
      };
    } else {
      server.current = CLIENT_ONLY;
    }
  }
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    controller.update(props as AnySparklineProps<T>);
  });
  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) {
      return undefined;
    }
    controller.attach(element);
    return () => {
      controller.detach();
    };
  }, [controller]);
  const { width, height = SPARKLINE_HEIGHT, className, style } = props;
  const { attrs, html } = server.current;
  // oxlint-disable-next-line react/no-danger, react/jsx-props-no-spreading -- the controller's own server svg (kept, never set again) and the host's attributes it writes itself on the client
  return <div className={className} data-bkm-spark="" ref={host} style={{ width, height, ...style }} {...attrs} dangerouslySetInnerHTML={html} />;
}

function LineSparklineImpl<T>(props: LineSparklineProps<T>): ReactElement {
  return useSparkline("line", props);
}

function AreaSparklineImpl<T>(props: AreaSparklineProps<T>): ReactElement {
  return useSparkline("area", props);
}

function BarSparklineImpl<T>(props: BarSparklineProps<T>): ReactElement {
  return useSparkline("bar", props);
}

/** Tiny line chart: one path, no axes, a hover crosshair and dot. Fills its parent's width unless given one. */
export const LineSparkline = /* @__PURE__ */ memo(LineSparklineImpl) as typeof LineSparklineImpl;
/** Tiny area chart: a line over a gradient or solid fill. */
export const AreaSparkline = /* @__PURE__ */ memo(AreaSparklineImpl) as typeof AreaSparklineImpl;
/** Tiny bar chart: every bar drawn as a single path. Bars always include zero and support negative values. */
export const BarSparkline = /* @__PURE__ */ memo(BarSparklineImpl) as typeof BarSparklineImpl;

/**
 * Lift a sparkline's hover state so you can display the hovered value. Spread `sparklineProps` onto one sparkline, or several to sync
 * their crosshairs.
 *
 * ```tsx
 * const hover = useSparklineHover<Row>();
 * <span>{hover.datum?.value ?? latest}</span>
 * <LineSparkline data={rows} dataKey="value" {...hover.sparklineProps} />
 * ```
 */
export function useSparklineHover<T>() {
  const [state, setState] = useState<{ index: number | null; datum: T | null }>({ index: null, datum: null });
  const onHoverChange = useCallback((index: number | null, datum: T | null) => setState({ index, datum }), []);
  const sparklineProps = useMemo(() => ({ hoverIndex: state.index, onHoverChange }), [state.index, onHoverChange]);
  return { index: state.index, datum: state.datum, isHovering: state.index !== null, sparklineProps };
}
