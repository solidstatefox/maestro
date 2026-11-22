/** Spider query validation uses the same finite-lexical-v1 semantics as the
 * approved Numeric Range Personal facet. No RDFS/OWL datatype inference. */
import { isCoercibleNumericLexical } from "./virtuoso-numeric-coercion";
export const SPIDER_ANALYSIS_URI = "gttp://ggg.maestro.ecosys/analyze/spider";
export type SpiderAxis = { uri: string; direction: "forward" | "reverse"; label: string; anchorId?: string };
export type SpiderCell = { value: string; type?: string; datatype?: string };
export type SpiderRow = { uri: string; label: string; values: Record<string,SpiderCell[]> };
export function spiderAxisKey(axis: Pick<SpiderAxis,"uri"|"direction"> & { anchorId?: string }): string { return "anchorId" in axis && axis.anchorId ? `alias:${axis.anchorId}` : `${axis.direction}|${axis.uri}`; }
export function validateSpiderQuery(axes: readonly SpiderAxis[], rows: readonly SpiderRow[]):
  {ok: true; chart: Array<{axis:string;[member:string]:number|string}>; members:Array<{key:string;label:string}>} | {ok:false;reason:string} {
  if (axes.length < 3) return {ok:false,reason:"Spider needs at least three Properties or Roles in the current FCT view."};
  if (!rows.length) return {ok:false,reason:"This page has no results to plot."};
  const unique = new Set(axes.map(spiderAxisKey));
  if (unique.size!==axes.length) return {ok:false,reason:"Duplicate axes occur in the current FCT view."};
  // Validate original RDF lexical values first. Normalization is purely a
  // presentation transform and never weakens the finite-number policy.
  const valuesByAxis = axes.map(() => [] as number[]);
  const members=rows.map((row,index)=>({key:`m${index}`,label:row.label || row.uri}));
  for (const [rowIndex,row] of rows.entries()) for (const [axisIndex,axis] of axes.entries()) {
    const vals = (row.values[spiderAxisKey(axis)]??[]).filter(v=>v.value !== "-");
    if (vals.length !== 1)
      return {ok:false,reason:`${axis.label}: ${row.label || row.uri} must have exactly one value (found ${vals.length}; SHACL minCount/maxCount violation).`};
    const cell=vals[0];
    if (cell.type === "uri" || cell.type === "bnode")
      return {ok:false,reason:`${axis.label}: ${row.label || row.uri} has an RDF ${cell.type} instead of a numeric literal: ${cell.value} (SHACL sh:nodeKind).`};
    if (!isCoercibleNumericLexical(cell.value))
      return {ok:false,reason:`${axis.label}: ${row.label || row.uri} has nonfinite or nonnumeric lexical value ${JSON.stringify(cell.value)} (datatype ${cell.datatype || "unspecified"}; SHACL sh:pattern).`};
    const numeric = Number(cell.value);
    if (!Number.isFinite(numeric))
      return {ok:false,reason:`${axis.label}: ${row.label || row.uri} is outside the finite numeric range.`};
    valuesByAxis[axisIndex][rowIndex] = numeric;
  }
  // Per-axis 0–100 normalization prevents, for example, a distance of 3000
  // hiding a temperature of 25. Constant axes have no relative ordering:
  // represent their non-zero values at the neutral midpoint (zero at zero).
  // Include actual RDF numeric values under raw_* keys for the tooltip.
  const chart: Array<{axis:string;[member:string]:number|string}> = axes.map((axis, axisIndex) => {
    const values = valuesByAxis[axisIndex];
    const min = Math.min(...values), max = Math.max(...values);
    const spread = max - min;
    const row: {axis:string;[member:string]:number|string} = {axis:axis.label};
    for (const [rowIndex,value] of values.entries()) {
      const key = members[rowIndex].key;
      const relative = Number.isFinite(spread)
        ? (value - min) / spread
        : ((value / 2) - (min / 2)) / ((max / 2) - (min / 2));
      row[key] = max !== min ? Math.max(0, Math.min(100, relative * 100)) : value === 0 ? 0 : 50;
      row[`raw_${key}`] = value;
    }
    return row;
  });
  return {ok:true,chart,members};
}
