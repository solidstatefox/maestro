"use client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table2, TableProperties, ChartColumn, ChartPie } from "lucide-react";
type AnalysisDefinition = { uri: string; label: string; icon: string };
// Only built-in Maestro Analyze resources live before the separator.
// Every other discovered provider is external, irrespective of URI or label.
const NATIVE_ANALYZE_URIS = new Set([
  "gttp://ggg.maestro.ecosys/analyze/table",
  "gttp://ggg.maestro.ecosys/analyze/compare-table",
]);
export interface AnalyzeRibbonProps {
  analysisDefinitions: AnalysisDefinition[];
  selectedAnalysisUri: string;
  analyzeHistogram: boolean;
  isCompareAnalysis: boolean;
  firstBreadcrumbLabel?: string;
  firstResultTitle?: string;
  onSelectAnalysis: (uri: string) => void;
  onSelectHistogram: (uri: string) => void;
}
export function AnalyzeRibbon({ analysisDefinitions, selectedAnalysisUri, analyzeHistogram, isCompareAnalysis, firstBreadcrumbLabel, firstResultTitle, onSelectAnalysis, onSelectHistogram }: AnalyzeRibbonProps) {
  return <div className="flex min-h-[78px] flex-wrap items-center gap-3 border-b bg-background px-4 py-2" role="toolbar" aria-label="Analyze presentations">
          {analysisDefinitions.filter((definition) => NATIVE_ANALYZE_URIS.has(definition.uri)).map((definition) => {
            const active = selectedAnalysisUri === definition.uri && !analyzeHistogram;
            const Icon = definition.icon === "table-properties" ? TableProperties : definition.icon === "chart-column" ? ChartColumn : definition.icon === "chart-pie" ? ChartPie : Table2;
            return <Tooltip key={definition.uri} disableHoverablePopup={false}>
              <TooltipTrigger render={<button type="button" onClick={() => { onSelectAnalysis(definition.uri); }} aria-pressed={active && !analyzeHistogram}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="size-7" strokeWidth={1} aria-hidden="true"/>{definition.label}
              </button>} />
              <TooltipContent side="bottom" className="z-[100] w-64 p-3" >
                <div className="mb-2 font-semibold">{definition.label} preview</div>
                {definition.icon.startsWith("chart-") ? <p className="text-xs text-muted-foreground">Analyze all matching bookmarks in the current faceted query.</p> : <div className="rounded border bg-background p-2 text-foreground">
                  <table className="w-full border-collapse text-[10px]"><thead><tr><th className="border p-1 text-left">Result</th><th className="border p-1 text-left">{definition.icon === "table-properties" ? "Value A" : (firstBreadcrumbLabel || "Property")}</th><th className="border p-1 text-left">{definition.icon === "table-properties" ? "Value B" : "Property 2"}</th></tr></thead><tbody>
                  <tr><td className="border p-1">{firstResultTitle ?? "Resource"}</td><td className="border p-1">{definition.icon === "table-properties" ? "✓" : "Value"}</td><td className="border p-1">—</td></tr></tbody></table>
                </div>}
                <p className="mt-2 text-xs text-muted-foreground">Choose this SHACL-discovered analysis.</p>
              </TooltipContent>
            </Tooltip>;
          })}
          {analysisDefinitions.some((definition) => definition.uri.includes("compare-table")) && (
            <Tooltip>
              <TooltipTrigger render={<button type="button" aria-pressed={isCompareAnalysis && analyzeHistogram}
                onClick={() => { const compare = analysisDefinitions.find((definition) => definition.uri.includes("compare-table")); if (compare) { onSelectHistogram(compare.uri); } }}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${isCompareAnalysis && analyzeHistogram ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <ChartColumn className="size-7" strokeWidth={1} aria-hidden="true"/>Histogram
              </button>} />
              <TooltipContent side="bottom">Count checked Compare Table cells for each column value.</TooltipContent>
            </Tooltip>
          )}
          {analysisDefinitions.some((definition) => !NATIVE_ANALYZE_URIS.has(definition.uri)) && <div className="mx-1 h-11 self-center border-l border-border" role="separator" aria-orientation="vertical" aria-label="SHACL-provided analyses" />}
          {analysisDefinitions.filter((definition) => !NATIVE_ANALYZE_URIS.has(definition.uri)).map((definition) => {
            const active = selectedAnalysisUri === definition.uri && !analyzeHistogram;
            const Icon = definition.icon === "chart-pie" ? ChartPie : ChartColumn;
            return <Tooltip key={definition.uri} disableHoverablePopup={false}>
              <TooltipTrigger render={<button type="button" onClick={() => onSelectAnalysis(definition.uri)} aria-pressed={active}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="size-7" strokeWidth={1} aria-hidden="true" />{definition.label}
              </button>} />
              <TooltipContent side="bottom">SHACL-provided {definition.label} analysis of the current faceted scope.</TooltipContent>
            </Tooltip>;
          })}
          {analysisDefinitions.length === 0 && <span className="text-sm text-muted-foreground">No analysis templates discovered. Load the updated SHACL policies into your personal graph server.</span>}
        </div>;
}
