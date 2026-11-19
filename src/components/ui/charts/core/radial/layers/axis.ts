import { radialRule, radialText } from "@tanstack/charts/polar";
import type { RadialAxisProps, RadialLabelOrientation } from "../../types/radial";
import { TAU, arcStartLabelLayout, cartesianToAngle, polarToCartesian, radialArcPath, radialLabelFontSize, radialValueTicks } from "../geometry";
import { radialUtcTickFormat, radialUtcTicks } from "../time-ticks";
import { ENTER_EASE, ENTER_MS, animate, childrenOf, markId, pathMark, resourceId, springEase } from "./common";
import type { AnyPolarMark, LayerContext, LayerEnterEnv, RadialLayer } from "./types";

const DEFAULT_LABELS = ["00", "06", "12", "18"];
const DAY_MS = 86_400_000;
const monthFormat = /* @__PURE__ */ new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const numberFormat = /* @__PURE__ */ new Intl.NumberFormat("en-US");
const formatNumber = (value: number): string => numberFormat.format(value);

// bklit-ui's animation.ts grid timings (the radar chart's standard).
const RING_STAGGER_S = 0.08;
const RING_SPRING = { stiffness: 100, damping: 15, mass: 1 } as const;
const SPOKE_STAGGER_S = 0.05;
const SPOKE_SPRING = { stiffness: 80, damping: 15, mass: 1 } as const;
const VALUE_LABEL_STAGGER_S = 0.06;
const ANGLE_LABEL_STAGGER_S = 0.08;
const ANGLE_LABEL_FADE_MS = 500;
/** A cap on the total angle-label stagger, so dense band labels don't trail. */
const ANGLE_LABEL_MAX_STAGGER_S = 0.6;
const MS = 1000;

/** Labels start once half of the grid rings have started. */
const gridLabelDelay = (ringCount: number): number => ringCount * RING_STAGGER_S * 0.5;

interface AngleLabel {
  readonly key: string;
  readonly angle: number;
  readonly text: string;
}

interface TimeTick {
  readonly time: number;
  readonly angle: number;
  readonly labelAngle: number | null;
  readonly text: string;
}

const normalizeAngle = (angle: number): number => ((angle % TAU) + TAU) % TAU;

/** The anchor and rotation (degrees, about the label's point) of a label at `angle`. */
const labelPlacement = (orientation: RadialLabelOrientation, angle: number): { anchor: "start" | "middle" | "end"; rotate: number } => {
  const a = normalizeAngle(angle);
  const deg = (a * 180) / Math.PI;
  if (orientation === "radial") {
    const flip = a > Math.PI;
    return { anchor: flip ? "end" : "start", rotate: deg - 90 + (flip ? 180 : 0) };
  }
  if (orientation === "tangential") {
    const flip = a > Math.PI / 2 && a < (3 * Math.PI) / 2;
    return { anchor: "middle", rotate: deg + (flip ? 180 : 0) };
  }
  return { anchor: "middle", rotate: 0 };
};

const bandLabel = (raw: unknown, index: number, labelFormat: RadialAxisProps["labelFormat"]): string => (labelFormat ? labelFormat(raw, index) : String(raw ?? ""));

/** Labels spread evenly from the start angle (ending on the end angle on partial arcs). */
const evenLabels = (texts: readonly string[], isFullCircle: boolean, fractionToAngle: (fraction: number) => number): AngleLabel[] => {
  const steps = isFullCircle ? texts.length : Math.max(1, texts.length - 1);
  return texts.map((text, i) => ({ key: `l${i}`, angle: fractionToAngle(i / steps), text }));
};

const computeTimeTicks = (input: {
  readonly timeDomain: readonly [number, number];
  readonly timeTicks: number | readonly (Date | number)[];
  readonly timeTickFormat: ((date: Date) => string) | undefined;
  readonly timeLabelPosition: "tick" | "between";
  readonly timeToAngle: (time: number) => number | null;
}): TimeTick[] => {
  const [t0, t1] = input.timeDomain;
  const { timeTicks } = input;
  const times = typeof timeTicks === "number" ? radialUtcTicks(t0, t1, timeTicks) : timeTicks.map((t) => (typeof t === "number" ? t : t.getTime()));
  const longSpan = t1 - t0 > 60 * DAY_MS;
  const format = input.timeTickFormat ?? (longSpan ? (d: Date) => monthFormat.format(d) : radialUtcTickFormat);
  const result: TimeTick[] = [];
  times.forEach((time, i) => {
    const angle = input.timeToAngle(time);
    if (angle === null) {
      return;
    }
    let labelAngle: number | null = angle;
    if (input.timeLabelPosition === "between") {
      const nextAngle = input.timeToAngle(Math.min(times[i + 1] ?? t1, t1));
      labelAngle = nextAngle === null || nextAngle === angle ? null : (angle + nextAngle) / 2;
    }
    result.push({ time, angle, labelAngle, text: format(new Date(time)) });
  });
  return result;
};

const resolveValueTicks = (spec: number | readonly number[] | undefined, domain: readonly [number, number]): readonly number[] => {
  if (spec === undefined) {
    return [];
  }
  return typeof spec === "number" ? radialValueTicks([domain[0], domain[1]], spec) : spec;
};

interface LabelRow {
  readonly key: string;
  readonly angle: number;
  readonly radius: number;
  readonly text: string;
  readonly anchor: "start" | "middle" | "end";
  readonly rotate: number;
}

export function axisLayer(props: Readonly<RadialAxisProps>, { shell, index: L, uid }: Readonly<LayerContext>): RadialLayer {
  const {
    showCircle = true, centerGradient = false, tickCount: tickCountProp, majorTickEvery = 6, labels, labelColor = "var(--muted-foreground)",
    stroke = "var(--foreground)", labelOrientation: labelOrientationProp, labelRadius: labelRadiusProp, labelEvery = 1, labelFormat, timeTicks = 12,
    timeTickFormat, timeLabelPosition = "between", angleGrid: angleGridProp, valueTicks: valueTicksProp, valueTickFormat = formatNumber,
    showValueLabels = true, valueLabelAngle, showRingLabels = true, gridOpacity = 0.12,
  } = props;
  const { radius, layout, centerRadius, innerRadius, outerRadius, angleType, orientation, startAngle, endAngle, timeDomain, timeToAngle, valueDomain, valueToAngle, valueScale, isFullCircle, fractionToAngle, binAngle, binCount, data, xDataKey, ringBand } = shell;
  const fontSize = radialLabelFontSize(radius);
  const angular = orientation === "angular";
  const isClock = angleType === "clock" && !angular;
  const isBand = angleType === "band" && !angular;
  const tickCount = tickCountProp ?? (isClock ? 24 : 0);
  const labelOrientation = labelOrientationProp ?? (isBand ? "radial" : "horizontal");
  const rotated = labelOrientation !== "horizontal";
  const labelRadius = radius * (labelRadiusProp ?? (rotated ? layout.bandOuter + 0.03 : layout.axisLabel));
  const angleGrid = angleGridProp ?? (angleType === "time" || angular);
  const valueTicks = resolveValueTicks(valueTicksProp ?? (angular ? 5 : undefined), valueDomain);
  const timeTickList = !angular && angleType === "time" && timeDomain ? computeTimeTicks({ timeDomain, timeTicks, timeTickFormat, timeLabelPosition, timeToAngle }) : [];

  // Angle labels -----------------------------------------------------------------------------------------------------------------
  let angleLabels: AngleLabel[] = [];
  if (labels === false) {
    angleLabels = [];
  } else if (labels) {
    angleLabels = evenLabels(labels, isFullCircle, fractionToAngle);
  } else if (angular) {
    angleLabels = valueTicks.map((v) => ({ key: `v${v}`, angle: valueToAngle(v), text: valueTickFormat(v) }));
  } else if (angleType === "band") {
    const every = Math.max(1, Math.round(labelEvery));
    for (let i = 0; i < binCount; i += every) {
      angleLabels.push({ key: `b${i}`, angle: binAngle(i), text: bandLabel(data[i]?.[xDataKey], i, labelFormat) });
    }
  } else if (angleType === "time") {
    angleLabels = timeTickList.flatMap((t) => (t.labelAngle === null ? [] : [{ key: `t${t.time}`, angle: t.labelAngle, text: t.text }]));
  } else {
    angleLabels = evenLabels(DEFAULT_LABELS, isFullCircle, fractionToAngle);
  }
  let spokeAngles: number[] = [];
  if (angleGrid) {
    spokeAngles = angular ? valueTicks.map(valueToAngle) : timeTickList.map((t) => t.angle);
  }

  // Enter order: the centre circle, the tick ring, the value rings (inside out), the outer arc.
  const valueRingCount = angular ? 0 : valueTicks.length;
  const tickRingIndex = Number(showCircle);
  const firstValueRing = tickRingIndex + Number(tickCount > 0);
  const outerArcIndex = firstValueRing + valueRingCount;
  const labelDelay = gridLabelDelay(outerArcIndex + Number(angular));
  const ringOrder = [...valueTicks].sort((a, b) => Math.abs(valueScale(a)) - Math.abs(valueScale(b)));

  const marks: AnyPolarMark[] = [];
  const gradientId = resourceId(uid, L, "center");
  const ids = {
    circle: markId(L, "circle"), minor: markId(L, "ticks-minor"), major: markId(L, "ticks-major"), spokes: markId(L, "spokes"), rings: markId(L, "rings"),
    ringLabels: markId(L, "value-labels"), outer: markId(L, "outer"), angleLabels: markId(L, "angle-labels"), startLabels: markId(L, "ring-labels"),
  };
  if (showCircle) {
    marks.push(pathMark(ids.circle, [{ d: radialArcPath(centerRadius, 0, TAU), key: "c0" }], {
      className: "bkm-rd-ring", fill: centerGradient ? `url(#${gradientId})` : "none", stroke, strokeOpacity: 0.1, strokeWidth: 1,
    }));
  }
  if (tickCount > 0) {
    const span = endAngle - startAngle;
    const ticks = Array.from({ length: isFullCircle ? tickCount : tickCount + 1 }, (_, i) => ({
      angle: startAngle + (i / tickCount) * span, i, major: majorTickEvery > 0 && i % majorTickEvery === 0,
    }));
    for (const major of [false, true]) {
      const rows = ticks.filter((t) => t.major === major);
      if (rows.length > 0) {
        marks.push(radialRule(rows, {
          angle: (t) => t.angle, className: "bkm-rd-ring", id: major ? ids.major : ids.minor, key: (t) => `t${t.i}`, motion: false,
          radius1: radius * layout.tickInner, radius2: radius * (major ? layout.tickMajorOuter : layout.tickMinorOuter), stroke,
          strokeOpacity: major ? 0.4 : 0.22, strokeWidth: major ? 1.25 : 1,
        }));
      }
    }
  }
  if (spokeAngles.length > 0) {
    marks.push(radialRule(spokeAngles.map((angle, i) => ({ angle, i })), {
      angle: (s) => s.angle, className: "bkm-rd-spoke", id: ids.spokes, key: (s) => `s${s.i}`, motion: false, radius1: innerRadius, radius2: outerRadius,
      stroke, strokeOpacity: gridOpacity, strokeWidth: 1,
    }));
  }
  if (valueRingCount > 0) {
    marks.push(pathMark(ids.rings, valueTicks.map((v, i) => ({ d: radialArcPath(valueScale(v), startAngle, endAngle), key: `v${i}` })), {
      className: "bkm-rd-ring", stroke, strokeOpacity: gridOpacity, strokeWidth: 1,
    }));
    if (showValueLabels) {
      const at = valueLabelAngle === undefined ? startAngle : (valueLabelAngle * Math.PI) / 180;
      marks.push(radialText(valueTicks.map((v, i) => ({ v, i })), {
        anchor: "middle", angle: at, baseline: "middle", className: "bkm-rd-label bkm-rd-label-halo", fill: labelColor, fontSize: fontSize * 0.85,
        id: ids.ringLabels, key: (row) => `v${row.i}`, motion: false, radius: (row) => valueScale(row.v), text: (row) => valueTickFormat(row.v),
      }));
    }
  }
  if (angular) {
    marks.push(pathMark(ids.outer, [{ d: radialArcPath(outerRadius, startAngle, endAngle), key: "o0" }], {
      className: "bkm-rd-ring", stroke, strokeOpacity: gridOpacity, strokeWidth: 1,
    }));
  }
  const angleRows: LabelRow[] = angleLabels.map((label) => ({ ...label, radius: labelRadius, ...labelPlacement(labelOrientation, label.angle) }));
  if (angleRows.length > 0) {
    marks.push(radialText(angleRows, {
      anchor: (row) => row.anchor, angle: (row) => row.angle, baseline: "middle", className: "bkm-rd-label", fill: labelColor,
      fontSize: rotated ? fontSize * 0.8 : fontSize, id: ids.angleLabels, key: (row) => row.key, motion: false, radius: (row) => row.radius,
      rotate: (row) => row.rotate, text: (row) => row.text,
    }));
  }
  let startRows: LabelRow[] = [];
  if (angular && showRingLabels) {
    const place = arcStartLabelLayout(startAngle, endAngle, fontSize * 0.6);
    startRows = data.map((d, i) => {
      const { x, y, rotate } = place.position(ringBand(i).center);
      return { key: `r${i}`, angle: cartesianToAngle(x, y), radius: Math.hypot(x, y), text: bandLabel(d[xDataKey], i, labelFormat), anchor: place.anchor, rotate };
    });
    marks.push(radialText(startRows, {
      anchor: (row) => row.anchor, angle: (row) => row.angle, baseline: "middle", className: "bkm-rd-label", fill: labelColor, fontSize: fontSize * 0.8,
      id: ids.startLabels, key: (row) => row.key, motion: false, radius: (row) => row.radius, rotate: (row) => row.rotate, text: (row) => row.text,
    }));
  }

  const defs = showCircle && centerGradient
    ? `<radialGradient id="${gradientId}"><stop offset="0%" stop-color="${stroke}" stop-opacity="0.06"/><stop offset="100%" stop-color="${stroke}" stop-opacity="0"/></radialGradient>`
    : "";

  const enter = (env: LayerEnterEnv): void => {
    const ring = springEase(RING_SPRING);
    const spoke = springEase(SPOKE_SPRING);
    const ringIn = (element: Element, index: number): void => {
      animate(env, element, [{ opacity: 0, scale: "0" }], { delay: index * RING_STAGGER_S * MS, duration: ring.durationMs, easing: ring.ease });
    };
    const circle = env.group(ids.circle);
    if (circle) { ringIn(circle, 0); }
    for (const id of [ids.minor, ids.major]) {
      const group = env.group(id);
      if (group) { ringIn(group, tickRingIndex); }
    }
    childrenOf(env, ids.rings).forEach((element, i) => {
      ringIn(element, firstValueRing + ringOrder.indexOf(valueTicks[i] ?? 0));
    });
    const outer = env.group(ids.outer);
    if (outer) { ringIn(outer, outerArcIndex); }
    // Spokes extend from their inner end outward.
    childrenOf(env, ids.spokes).forEach((element, i) => {
      const a = polarToCartesian(spokeAngles[i] ?? 0, innerRadius);
      if (element instanceof SVGElement) {
        element.style.transformOrigin = `${a.x}px ${a.y}px`;
      }
      animate(env, element, [{ scale: "0" }], { delay: i * SPOKE_STAGGER_S * MS, duration: spoke.durationMs, easing: spoke.ease });
    });
    // Value and ring labels fade in (bklit's RadarGrid level labels).
    childrenOf(env, ids.ringLabels).forEach((element, i) => {
      animate(env, element, [{ opacity: 0 }], { delay: (labelDelay + ringOrder.indexOf(valueTicks[i] ?? 0) * VALUE_LABEL_STAGGER_S) * MS, duration: ENTER_MS, easing: ENTER_EASE });
    });
    childrenOf(env, ids.startLabels).forEach((element, i) => {
      animate(env, element, [{ opacity: 0 }], { delay: (labelDelay + i * VALUE_LABEL_STAGGER_S) * MS, duration: ENTER_MS, easing: ENTER_EASE });
    });
    // Angle labels slide out from the centre while they fade in (bklit's RadarLabels).
    const stagger = Math.min(ANGLE_LABEL_STAGGER_S, ANGLE_LABEL_MAX_STAGGER_S / Math.max(1, angleRows.length));
    childrenOf(env, ids.angleLabels).forEach((element, i) => {
      const row = angleRows[i];
      if (!row) {
        return;
      }
      const from = polarToCartesian(row.angle, -row.radius);
      animate(env, element, [{ translate: `${from.x}px ${from.y}px` }], { duration: spoke.durationMs, easing: spoke.ease });
      animate(env, element, [{ opacity: 0 }], { delay: (labelDelay + i * stagger) * MS, duration: ANGLE_LABEL_FADE_MS, easing: "ease-out" });
    });
  };

  return { marks, defs, css: "", enter };
}
