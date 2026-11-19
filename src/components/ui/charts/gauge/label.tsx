"use client";

// Lean gauge label pieces over core/gauge/label.ts (its layout styles, classes and the arc centre's roll-in); the value is NumberFlow's React element.
import NumberFlow from "@number-flow/react";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { GAUGE_CENTER_STYLES, GAUGE_LABEL_FILL, GAUGE_STAT_CLASSES, GAUGE_STAT_STYLES, gaugeLabelBoxes, scheduleStatIntro } from "../core/gauge/label";
import type { GaugeStat } from "../core/gauge/view";
import { toCamel } from "../core/style";
import type { StyleObject } from "../core/style";
import type { GaugeLabelAlign, GaugeLabelPlacement } from "../core/types/gauge";

const camel = /* @__PURE__ */ new WeakMap<StyleObject, CSSProperties>();

/** A core style object as React's, one object per style. */
const css = (style: StyleObject): CSSProperties => {
  const known = camel.get(style);
  if (known !== undefined) { return known; }
  const made = toCamel(style);
  camel.set(style, made);
  return made;
};

interface StatProps {
  readonly stat: GaugeStat;
  readonly valueClassName: string;
  readonly labelClassName: string;
  /** Roll in from 0 on mount (NumberFlow tween), as bklit's arc centre does. */
  readonly intro?: boolean;
}

/** The stat's value: 0 until `scheduleStatIntro` swaps the real one in (core/gauge/label.ts), from a passive effect. */
const useIntroValue = (value: number, intro: boolean): number => {
  const [introDone, setIntroDone] = useState(!intro);
  useEffect(() => (intro ? scheduleStatIntro(() => { setIntroDone(true); }) : undefined), [intro]);
  return introDone ? value : 0;
};

const Stat = ({ stat, valueClassName, labelClassName, intro = false }: StatProps): ReactElement => {
  const flow = useIntroValue(stat.value, intro);
  return (
    <>
      <span className={valueClassName}><NumberFlow format={stat.format} isolate prefix={stat.prefix} suffix={stat.suffix} value={flow} willChange /></span>
      <span className={labelClassName}>{stat.label}</span>
    </>
  );
};

/** Arc centre: a square box tracking max(40% of the gauge size - 16px, 88px), sized with container query units. */
export const GaugeCenter = ({ stat }: { readonly stat: GaugeStat }): ReactElement => (
  <div style={css(GAUGE_CENTER_STYLES.outer)}>
    <div className={GAUGE_STAT_CLASSES.arc.box} style={css(GAUGE_CENTER_STYLES.inner)}>
      <Stat intro labelClassName={GAUGE_STAT_CLASSES.arc.label} stat={stat} valueClassName={GAUGE_STAT_CLASSES.arc.value} />
    </div>
  </div>
);

/** Linear label stack (`GAUGE_STAT_STYLES`). */
const GaugeLabelStat = ({ align, stat }: { readonly align: GaugeLabelAlign; readonly stat: GaugeStat }): ReactElement => (
  <div style={css(GAUGE_STAT_STYLES[align])}>
    <Stat labelClassName={GAUGE_STAT_CLASSES.linear.label} stat={stat} valueClassName={GAUGE_STAT_CLASSES.linear.value} />
  </div>
);

interface LabelLayoutProps {
  readonly placement: GaugeLabelPlacement;
  readonly align: GaugeLabelAlign;
  /** The label's stat; the label is omitted while it is null. */
  readonly stat: GaugeStat | null;
  readonly children: ReactNode;
}

/** Four-placement, three-alignment label layout around the track (`gaugeLabelBoxes`). */
export const GaugeLabelLayout = ({ placement, align, stat, children }: LabelLayoutProps): ReactElement => {
  if (stat === null) { return <div style={css(GAUGE_LABEL_FILL)}>{children}</div>; }
  const boxes = gaugeLabelBoxes(placement, align);
  const labelNode = <div style={css(boxes.label)}><GaugeLabelStat align={align} stat={stat} /></div>;
  const track = <div style={css(boxes.track)}>{children}</div>;
  return <div style={css(boxes.container)}>{boxes.labelFirst ? labelNode : track}{boxes.labelFirst ? track : labelNode}</div>;
};
