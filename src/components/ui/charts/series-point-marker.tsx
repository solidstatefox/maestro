"use client";

import { useLayoutEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { SeriesPointMarkerProps } from "./core/types/cartesian";

/**
 * A single point marker drawn at pixel position `(cx, cy)` that fades and un-blurs in after `revealDelay` seconds. Use it in a custom chart child; `Line` and `Area` draw their own markers via `showMarkers`.
 */
export const SeriesPointMarker = ({
  dataKey,
  index,
  cx,
  cy,
  enterBlur = 2,
  revealDelay,
  revealEpoch,
  enterDuration,
  fill,
  stroke,
  strokeWidth = 2,
  ringGap = 2,
  outlineWidth = 0,
  outlineColor,
  radius = 5,
}: SeriesPointMarkerProps): ReactElement => {
  const ref = useRef<SVGGElement>(null);
  // bklit re-keys the motion.g on `${dataKey}-${index}-${revealEpoch}` so a new epoch replays the enter; the ease is
  // DEFAULT_CHART_ENTER_TRANSITION.ease (animation.ts:12).
  useLayoutEffect(() => {
    const animation = ref.current?.animate(
      [
        { opacity: 0, filter: `blur(${enterBlur}px)` },
        { opacity: 1, filter: "blur(0px)" },
      ],
      { delay: revealDelay * 1000, duration: enterDuration * 1000, easing: "cubic-bezier(0.85, 0, 0.15, 1)", fill: "backwards" },
    );
    return (): void => animation?.cancel();
  }, [dataKey, index, revealEpoch, revealDelay, enterDuration, enterBlur]);

  const resolvedStroke = stroke ?? fill ?? "currentColor";
  const ringOuter = strokeWidth > 0 ? radius + ringGap + strokeWidth : radius;
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <g ref={ref}>
        {outlineWidth > 0 ? (
          <circle cx={0} cy={0} fill="none" r={ringOuter + outlineWidth / 2} stroke={outlineColor ?? resolvedStroke} strokeWidth={outlineWidth} />
        ) : null}
        <circle cx={0} cy={0} fill={fill} r={radius} />
        {strokeWidth > 0 ? (
          <circle cx={0} cy={0} fill="none" r={radius + ringGap + strokeWidth / 2} stroke={resolvedStroke} strokeWidth={strokeWidth} />
        ) : null}
      </g>
    </g>
  );
};
