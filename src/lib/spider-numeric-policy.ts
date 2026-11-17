/** Spider query validation uses the same finite-lexical-v1 semantics as the
 * approved Numeric Range Personal facet. No RDFS/OWL datatype inference. */
import { isCoercibleNumericLexical } from "./virtuoso-numeric-coercion";
export const SPIDER_ANALYSIS_URI = "gttp://ggg.maestro.ecosys/analyze/spider";
export type SpiderAxis = { uri: string; direction: "forward" | "reverse"; label: string };
export type SpiderCell = { value: string; type?: string; datatype?: string };
export type SpiderRow = { uri: string; label: string; values: Record<string,SpiderCell[]> };
export function spiderAxisKey(axis: Pick<SpiderAxis,"uri"|"direction">): string { return `${axis.direction}|${axis.uri}`; }
export function validateSpiderQuery(axes: readonly SpiderAxis[], rows: readonly SpiderRow[]):
  {ok: true; chart: Array<{axis:string;[member:string]:number|string}>; members:Array<{key:string;label:string}>} | {ok:false;reason:string} {
  if (axes.length < 3) return {ok:false,reason:"Spider needs at least three Properties or Roles in the current FCT view."};
  if (!rows.length) return {ok:false,reason:"This page has no results to plot."};
  const unique = new Set(axes.map(spiderAxisKey));
  if (unique.size!==axes.length) return {ok:false,reason:"Duplicate axes occur in the current FCT view."};
  const chart: Array<{axis:string;[member:string]:number|string}> = axes.map(a=>({axis:a.label}));
  const members=rows.map((row,index)=>({key:`m${index}`,label:row.label || row.uri}));
  for (const [rowIndex,row] of rows.entries()) for(const [axisIndex,axis] of axes.entries()) {
    const vals = (row.values[spiderAxisKey(axis)]??[]).filter(v=>v.value !== "-");
    if (vals.length !== 1)
      return {ok:false,reason:`${axis.label}: ${row.label || row.uri} must have exactly one value (found ${vals.length}; SHACL minCount/maxCount violation).`};
    const cell=vals[0];
    if (cell.type === "uri" || cell.type === "bnode")
      return {ok:false,reason:`${axis.label}: ${row.label || row.uri} has an RDF ${cell.type} instead of a numeric literal: ${cell.value} (SHACL sh:nodeKind).`};
    if (!isCoercibleNumericLexical(cell.value))
      return {ok:false,reason:`${axis.label}: ${row.label || row.uri} has nonfinite or nonnumeric lexical value ${JSON.stringify(cell.value)} (datatype ${cell.datatype || "unspecified"}; SHACL sh:pattern).`};
    chart[axisIndex][`m${rowIndex}`]=Number(vals[0].value);
  }
  return {ok:true,chart,members};
}
