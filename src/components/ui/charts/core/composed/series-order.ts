import { declarationOf, propsFor } from "../carriers/table";
import type { ChildTable } from "../carriers/table";
import { stringValue } from "./narrow";

const SERIES_ROLES = ["line", "area", "profitLossLine", "seriesBar", "scatter", "candlestick"] as const;
/** The range overlays' mark ids (range-overlays.ts BAND_KEY, DEADLINE_KEY, WEEKENDS_KEY), spelled out so the order needs no import of the feature. */
const UNDERLAY_IDS = /^(?:band|deadline|wkend):/u;

interface MarkLike {
  readonly id?: string;
}

/** dataKeys of the series carriers in tree order (bklit upserts: a later config for the same key keeps its slot). */
export function seriesOrder(table: ChildTable): string[] {
  const carriers = SERIES_ROLES.flatMap((role) => propsFor<{ readonly dataKey?: unknown }>(table, role)).toSorted((a, b) => declarationOf(a) - declarationOf(b));
  const keys: string[] = [];
  for (const carrier of carriers) {
    // A Candlestick has no dataKey: bklit registers it as the `close` series.
    const key = "dataKey" in carrier ? stringValue(carrier.dataKey) : "close";
    if (key !== undefined && !keys.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
}

/** Paint order follows the JSX tree (the kit emits areas, then lines, then extras). */
export function orderSeriesMarks<M extends MarkLike>(marks: readonly M[], order: readonly string[]): M[] {
  const rank = (mark: M): number => {
    const id = mark.id ?? "";
    const match = /^(?:line|area|pattern|bar|scatter):(.+?)(?::fill(?::p?fade(?:-left|-right|-c)?)?|:tail|:glow|:ring)?$/u.exec(id);
    // Weekends, Deadline and Band (cartesian/range-overlays.ts) paint with the guides, beneath every series (bklit's underlay layer);
    // LineBackdrops paint under every series too, as the grid does (bklit: render it before the Line).
    if (id.startsWith("grid-") || id.startsWith("backdrop-") || UNDERLAY_IDS.test(id)) {
      return -2;
    }
    if (id.startsWith("candle:")) {
      const at = order.indexOf("close");
      return at === -1 ? order.length : at;
    }
    if (!match || id.endsWith(":dot")) {
      return -1;
    }
    const index = order.indexOf(match[1]);
    return index === -1 ? order.length : index;
  };
  const guides = marks.filter((m) => rank(m) === -2);
  const series = marks.filter((m) => rank(m) >= 0);
  const rest = marks.filter((m) => rank(m) === -1);
  // Stable: within one dataKey an area stays beneath its line (kit order).
  series.sort((a, b) => rank(a) - rank(b));
  return [...guides, ...series, ...rest];
}
