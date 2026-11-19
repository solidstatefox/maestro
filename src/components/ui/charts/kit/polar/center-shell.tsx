"use client";

// Center stat shared by PieCenter, RingCenter and PieCenterShell: a NumberFlow HTML overlay as in bklit, typeset by the
// shared `.ts-bkm-center-stat*` rules in styles.css (same pattern as gauge/label.tsx). Its state is core/polar/center.ts.
import { joinClasses } from "../../core/cn";
import NumberFlow from "@number-flow/react";
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { CENTER_STAT_CLASS, centerRenderArgs, centerStatBox, createCenterNumber, createFlowIntro, defaultCenterStatFormat, flowValue, polarCenterStat } from "../../core/polar/center";
import { toCamel } from "../../core/style";
import type { CenterStatFormat } from "../../core/types/polar";

/** Rolls the value in from 0 on mount (NumberFlow tween), as bklit's centers do (core/polar/center.ts `createFlowIntro`, started in the mount's passive effect). */
const useFlowValue = (value: number, intro: boolean): number => {
  const [flow] = useState(() => createFlowIntro(intro));
  const [introDone, setIntroDone] = useState(flow.get);
  // The post-mount flip is the roll-in itself: NumberFlow tweens from 0 to the value once it is set.
  useEffect(() => {
    const unsubscribe = flow.subscribe(() => { setIntroDone(flow.get()); });
    flow.start();
    return unsubscribe;
  }, [flow]);
  return flowValue(value, introDone);
};

interface CenterNumberProps {
  readonly value: number;
  readonly label: string;
  readonly format: CenterStatFormat;
  readonly prefix?: string;
  readonly suffix?: string;
}

/** The stat's NumberFlow, given the centre's changes at core/polar/center.ts `createCenterNumber`'s pace (one per mount, so the number a
 * reader's hovered content gave way to starts on its value). A change it shows at once lands in this commit's layout effect, before paint. */
const CenterNumber = ({ value, label, format, prefix, suffix }: Readonly<CenterNumberProps>): ReactElement => {
  const [number] = useState(() => createCenterNumber(value, label));
  const shown = useSyncExternalStore(number.subscribe, number.get, number.get);
  useLayoutEffect(() => { number.set(value, label); }, [number, value, label]);
  useEffect(() => () => { number.cancel(); }, [number]);
  // A held change leaves NumberFlow's element as it is.
  return useMemo(() => <NumberFlow format={format} isolate prefix={prefix} suffix={suffix} value={shown} willChange />, [format, prefix, suffix, shown]);
};

interface CenterShellRenderProps<Data> {
  readonly value: number;
  readonly label: string;
  readonly isHovered: boolean;
  readonly data: Data;
}

interface CenterShellProps<Data> {
  readonly value: number;
  readonly label: string;
  readonly centerSize: number;
  readonly hoveredData?: Data | null;
  /** Set: the reader's render child also shows at rest, called with this datum (core/polar/center.ts `centerRenderArgs`). */
  readonly restData?: Data;
  readonly intro?: boolean;
  readonly formatOptions?: CenterStatFormat;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly className?: string;
  readonly valueClassName?: string;
  readonly labelClassName?: string;
  readonly children?: (props: Readonly<CenterShellRenderProps<Data>>) => ReactNode;
}

/** Centered flex box: default stat stacks value over label; a reader's content lays out in a row. */
const CenterShell = <Data,>({
  value, label, centerSize, hoveredData, restData, intro = false, formatOptions = defaultCenterStatFormat, prefix, suffix,
  className = CENTER_STAT_CLASS.container, valueClassName = CENTER_STAT_CLASS.value, labelClassName = CENTER_STAT_CLASS.label, children,
}: Readonly<CenterShellProps<Data>>): ReactElement => {
  const flow = useFlowValue(value, intro);
  const args = children === undefined ? null : centerRenderArgs({ centerSize, label, value }, hoveredData ?? undefined, restData);
  const custom = args !== null;
  const style = useMemo<CSSProperties>(() => toCamel(centerStatBox(centerSize, custom)), [centerSize, custom]);
  return (
    <div className={className} data-slot="center-stat" style={style}>
      {args !== null && children !== undefined ? children(args) : (
        <>
          <span className={valueClassName}><CenterNumber format={formatOptions} label={label} prefix={prefix} suffix={suffix} value={flow} /></span>
          <span className={labelClassName}>{label}</span>
        </>
      )}
    </div>
  );
};

interface PolarCenterProps<Data extends { readonly label: string; readonly value: number }> {
  readonly hoveredData: Data | undefined;
  /** Set: the reader's render child also shows at rest, called with this datum. */
  readonly restData?: Data;
  readonly totalValue: number;
  readonly innerRadius: number;
  readonly defaultLabel?: string;
  readonly formatOptions?: CenterStatFormat;
  readonly children?: (props: Readonly<CenterShellRenderProps<Data>>) => ReactNode;
  readonly className?: string;
  readonly valueClassName?: string;
  readonly labelClassName?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

/** Stat for the hovered datum (or the total) in a box sized to the inner radius. */
const PolarCenter = <Data extends { readonly label: string; readonly value: number }>({
  hoveredData, restData, totalValue, innerRadius, defaultLabel = "Total", formatOptions = defaultCenterStatFormat, children, className, valueClassName, labelClassName, prefix, suffix,
}: Readonly<PolarCenterProps<Data>>): ReactElement => {
  const stat = polarCenterStat({ defaultLabel, hoveredData, innerRadius, totalValue });
  return (
    <CenterShell<Data>
      centerSize={stat.centerSize}
      className={joinClasses(CENTER_STAT_CLASS.container, className)}
      formatOptions={formatOptions}
      hoveredData={hoveredData}
      label={stat.label}
      restData={restData}
      labelClassName={labelClassName}
      prefix={prefix}
      suffix={suffix}
      value={stat.value}
      valueClassName={valueClassName}
    >
      {children}
    </CenterShell>
  );
};

export { PolarCenter, useFlowValue };
