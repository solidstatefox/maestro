import { useMemo } from "react";
import type { CSSProperties, ReactElement } from "react";
import { LineLoadingSweep } from "../loading/line-sweep";
import type { ChartMargin } from "../../core/theme";
import { usePlotSnapshot } from "./plot-size";
import type { PlotStore } from "../../core/cartesian/plot-size";
import type { ResolvedSeries } from "../../core/cartesian/series";

interface LoadingSweepOverlaysProps {
  readonly series: readonly ResolvedSeries[];
  /** The phase is exiting: the silhouette fades out (loading-sweep.tsx:395-409). */
  readonly exiting: boolean;
  readonly margin: ChartMargin;
  readonly store: PlotStore;
}

const OVERLAY_STYLE: CSSProperties = { position: "absolute", pointerEvents: "none", overflow: "visible", zIndex: 1 };

export const LoadingSweepOverlays = ({ series, exiting, margin, store }: Readonly<LoadingSweepOverlaysProps>): ReactElement | null => {
  const size = usePlotSnapshot(store)?.size;
  const innerWidth = size?.innerWidth ?? 0;
  const innerHeight = size?.innerHeight ?? 0;
  const style = useMemo<CSSProperties>(() => ({ ...OVERLAY_STYLE, left: margin.left, top: margin.top }), [margin.left, margin.top]);
  const sweeping = series.filter((s) => s.loading?.style === "sweep");
  if (sweeping.length === 0 || innerWidth <= 0 || innerHeight <= 0) {
    return null;
  }
  return (
    <svg
      aria-hidden="true"
      width={innerWidth}
      height={innerHeight}
      style={style}
    >
      {sweeping.map((s) => (
        <LineLoadingSweep
          key={s.id}
          curve={s.curve}
          withArea={s.kind === "area"}
          mode={exiting ? "exit" : (s.loading?.mode ?? "loop")}
          stroke={s.loading?.stroke}
          strokeOpacity={s.loading?.strokeOpacity}
          strokeWidth={s.strokeWidth}
          innerWidth={innerWidth}
          innerHeight={innerHeight}
        />
      ))}
    </svg>
  );
};
