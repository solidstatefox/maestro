"use client";

import { useState } from "react";
import { Code2, X } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CodeBlock } from "@/components/ui/code-block";

/** Hover-only query inspector for any widget backed by an FCT or SPARQL request. */
export function QueryInspectorButton({
  query,
  language = "xml",
  filename,
  label = "View query",
  countQuery,
  countFilename,
  extraQueries = [],
  headerTone = false,
  toolbarButton = false,
  primaryTabLabel,
}: {
  query: string;
  language?: "xml" | "sparql";
  filename: string;
  label?: string;
  countQuery?: string | null;
  countFilename?: string;
  extraQueries?: { id: string; label: string; query: string; filename: string; language?: "xml" | "sparql" }[];
  headerTone?: boolean;
  toolbarButton?: boolean;
  primaryTabLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("widget");
  if (!query.trim()) return null;
  const showingCount = Boolean(countQuery?.trim()) && activeTab === "count";
  const selectedExtraQuery = extraQueries.find((item) => item.id === activeTab);
  const displayedCode = showingCount ? countQuery! : selectedExtraQuery?.query ?? query;
  const displayedFilename = showingCount ? (countFilename ?? "first-item-count.sparql").replace(/\.xml$/i, ".sparql") : selectedExtraQuery?.filename ?? filename;
  const displayedLanguage = showingCount || selectedExtraQuery ? selectedExtraQuery?.language ?? "sparql" : language;
  const inspectorButton = (
    <button
      type="button"
      onClick={() => { setActiveTab("widget"); setOpen(true); }}
      aria-label={`${label}: ${filename}`}
      className={`inline-flex ${toolbarButton ? "size-7 rounded border" : "size-7 rounded border"} shrink-0 items-center justify-center ${toolbarButton ? "" : "opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/header:opacity-100"} ${headerTone ? "border-sky-700 bg-sky-800 text-sky-50 hover:bg-sky-700 hover:text-sky-50 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900" : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}
    >
      <Code2 className="size-4" aria-hidden="true" />
    </button>
  );
  return (
    <>
      {toolbarButton ? (
        <Tooltip>
          <TooltipTrigger render={inspectorButton} />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger render={inspectorButton} />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-label={`${label}: ${filename}`} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden p-3">
            <header className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Query inspector</h2>
                <p className="text-xs text-muted-foreground">Inspect the request used to populate this widget.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent" aria-label="Close query viewer"><X className="size-4" /></button>
            </header>
            {(countQuery?.trim() || extraQueries.length > 0) && (
              <div role="tablist" aria-label="Widget queries" className="mb-3 flex flex-wrap gap-1 border-b">
                <button type="button" role="tab" aria-selected={activeTab === "widget"} onClick={() => setActiveTab("widget")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "widget" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>{primaryTabLabel ?? (countQuery?.trim() ? "Results SPARQL" : "FCT query")}</button>
                {countQuery?.trim() && <button type="button" role="tab" aria-selected={activeTab === "count"} onClick={() => setActiveTab("count")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "count" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>Count SPARQL query</button>}
                {extraQueries.map((item) => <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} onClick={() => setActiveTab(item.id)} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === item.id ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>{item.label}</button>)}
              </div>
            )}
            <p className="mb-2 text-xs text-muted-foreground">{displayedFilename} · {displayedLanguage.toUpperCase()}</p>
            <CodeBlock className="min-h-0 flex-1" code={displayedCode} language={displayedLanguage} filename={displayedFilename} />
        </DialogContent>
      </Dialog>
    </>
  );
}

