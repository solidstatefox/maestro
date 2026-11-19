import { propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { axisId } from "../cartesian/series";
import { DEFAULT_LINE_STROKE } from "../theme";
import type { EnterTransition } from "../motion/phase";
import type { SeriesBarProps } from "../types/composed";
import type { SeriesBarSpec } from "./bars";

/** `barGap`'s default: px between grouped SeriesBar columns. */
export const DEFAULT_BAR_GAP = 4;

/** The entrance span in ms: `enterTransition.duration` (seconds, as in bklit-ui) overrides `animationDuration`. */
export const enterDurationMs = (animationDuration: number, enterTransition: EnterTransition | undefined): number =>
  enterTransition?.duration === undefined ? animationDuration : enterTransition.duration * 1000;

/** First non-empty colour, like `a || b || c` on optional strings. */
const firstColor = (...colors: readonly (string | undefined)[]): string | undefined => colors.find((c) => c !== undefined && c !== "");

/** The SeriesBar carriers in tree order, with their defaults; one without a dataKey draws nothing. */
export const seriesBarSpecs = (table: ChildTable): SeriesBarSpec[] =>
  propsFor<SeriesBarProps>(table, "seriesBar").flatMap((p) =>
    p.dataKey === ""
      ? []
      : [
          {
            dataKey: p.dataKey,
            label: p.label,
            yAxisId: axisId(p.yAxisId),
            fill: p.fill ?? DEFAULT_LINE_STROKE,
            dotColor: firstColor(p.stroke, p.fill) ?? DEFAULT_LINE_STROKE,
            radius: p.radius ?? 0,
            animate: p.animate ?? true,
            fadedOpacity: p.fadedOpacity ?? 0.3,
          },
        ],
  );
