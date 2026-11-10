"use client";
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { ScopeValue } from "@/canvas/utils/fct-response";
export type AnalysisDefinition = { uri: string; label: string; icon: string; stylesheet: string; order: number };
export type AnalysisCell = { values: string[]; checked: boolean; badgeStyle: CSSProperties; cellStyle: CSSProperties };
export type AnalysisTable = { trailStyle: CSSProperties; tableStyle: CSSProperties; headerStyle: CSSProperties; cellStyle: CSSProperties; rowStyle: CSSProperties; columns: { kind: string; nodeId: string; label: string; breadcrumbStyle: CSSProperties; headerStyle: CSSProperties }[]; rows: { uri: string; label: string; cells: AnalysisCell[] }[] };

/** Analyze-only selection, table sizing, presentation, and error state. */
export function useAnalyzeState() {
  // XSLT controls presentation only. It never supplies callbacks, event attributes,
  // breadcrumb mutation logic, or badge navigation logic.
  function analysisPresentationStyle(raw: string | null): CSSProperties {
    const permitted: Record<string, keyof CSSProperties> = {
      "background-color": "backgroundColor", "color": "color", "font-size": "fontSize",
      "font-weight": "fontWeight", "font-style": "fontStyle", "text-align": "textAlign",
      "border-radius": "borderRadius", "padding": "padding", "opacity": "opacity",
      "border-color": "borderColor", "border-width": "borderWidth", "line-height": "lineHeight",
      "white-space": "whiteSpace", "vertical-align": "verticalAlign",
    };
    const output: Record<string, string> = {};
    for (const part of (raw ?? "").split(";")) {
      const index = part.indexOf(":");
      if (index < 1) continue;
      const key = permitted[part.slice(0, index).trim().toLowerCase()];
      const value = part.slice(index + 1).trim();
      // No URL expressions, CSS variables, positioning, or interactive styling.
      if (!key || !value || /url\s*\(|var\s*\(|[{}<>]/i.test(value)) continue;
      output[key] = value;
    }
    return output as CSSProperties;
  }
  const [analysisDefinitions, setAnalysisDefinitions] = useState<AnalysisDefinition[]>([]);
  const [selectedAnalysisUri, setSelectedAnalysisUri] = useState("");
  const [analysisTable, setAnalysisTable] = useState<AnalysisTable | null>(null);
  // Width is keyed by the real facet node / value rather than its position, so
  // adding a column does not reset unrelated columns in either analysis table.
  const [analysisColumnWidths, setAnalysisColumnWidths] = useState<Record<string, number>>({});
  function beginAnalysisColumnResize(event: ReactPointerEvent<HTMLSpanElement>, key: string, width: number) {
    event.preventDefault();
    event.stopPropagation();
    const origin = event.clientX;
    const update = (move: PointerEvent) => setAnalysisColumnWidths((current) => ({
      ...current, [key]: Math.max(88, Math.min(900, width + move.clientX - origin)),
    }));
    const finish = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }
  // Analyze-only selection. Stored against the visible page so changes of
  // query or pagination cannot accidentally select different results.
  const [analysisSelection, setAnalysisSelection] = useState<{ pageKey: string; keys: string[] }>({ pageKey: "", keys: [] });
  const [analysisError, setAnalysisError] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const analysisRenderedBaseRef = useRef("");
  const [analysisValuesState, setAnalysisValuesState] = useState<{ requestKey: string; byUri: Map<string, ScopeValue[]> } | null>(null);
  const [analysisValuesError, setAnalysisValuesError] = useState("");
  const [compareFacet, setCompareFacet] = useState("");
  // Histogram reuses Compare Table's exact boolean cells; it is a presentation,
  // not another FCT query, XSLT template, or numeric-bin calculation.
  const [analyzeHistogram, setAnalyzeHistogram] = useState(false);
  return { analysisDefinitions, setAnalysisDefinitions, selectedAnalysisUri, setSelectedAnalysisUri, analysisTable, setAnalysisTable, analysisColumnWidths, setAnalysisColumnWidths, analysisSelection, setAnalysisSelection, analysisError, setAnalysisError, analysisLoading, setAnalysisLoading, analysisValuesState, setAnalysisValuesState, analysisValuesError, setAnalysisValuesError, compareFacet, setCompareFacet, analyzeHistogram, setAnalyzeHistogram, analysisRenderedBaseRef, analysisPresentationStyle, beginAnalysisColumnResize };
}

import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip as ChartTooltip } from "recharts";
type HistogramColumn = { label: string; count: number };
export function AnalyzeHistogram({ histogramColumns, visibleCount }: { histogramColumns: HistogramColumn[]; visibleCount: number }) {
  return <div className="min-h-full space-y-4 p-4" aria-label="Compare Histogram">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h2 className="text-sm font-medium">Compare Histogram</h2>
                        <span className="text-xs text-muted-foreground">Checked cells per column · {visibleCount} visible results</span>
                      </div>
                      {histogramColumns.length ? (
                        <div className="h-[min(65vh,540px)] min-h-64 w-full" role="img" aria-label={histogramColumns.map((bar) => `${bar.label}: ${bar.count}`).join(", ")}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={histogramColumns} margin={{top:12,right:20,bottom:48,left:4}}>
                              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                              <XAxis dataKey="label" interval={0} angle={-30} textAnchor="end" height={90} tick={{fontSize:11}} />
                              <YAxis allowDecimals={false} domain={[0, "dataMax"]} tick={{fontSize:11}} />
                              <ChartTooltip formatter={(value) => [value, "Checked"]} cursor={{fill:"var(--muted)", opacity:0.35}} />
                              <Bar dataKey="count" name="Checked" fill="var(--chart-1)" radius={[3,3,0,0]} maxBarSize={90}/>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : <p className="text-sm text-muted-foreground">No comparison columns available.</p>}
                    </div>;
}

