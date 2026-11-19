"use client";
import { GlobeCode, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { CodeBlock } from "@/components/ui/code-block";

/** The globe lives in the root editor, but the controlled Dialog is mounted
 * in its durable breadcrumb host. Moving the mouse off the editor cannot
 * unmount the inspector or erase its captured SPARQL. */
export function RootAutocompleteQueryTrigger({ gateStatus, onOpen }: {
  gateStatus: string; onOpen: () => void;
}) {
  const tone = gateStatus === "rejected" ? "text-destructive"
    : gateStatus === "valid" || gateStatus === "accepted" ? "text-green-600 dark:text-green-400"
      : "text-muted-foreground";
  return <Tooltip><TooltipTrigger render={<button type="button"
    aria-label="Inspect generated root URI autocomplete SPARQL"
    onClick={event => { event.preventDefault(); event.stopPropagation(); onOpen(); }}
    className={`inline-flex h-full shrink-0 items-center justify-center rounded px-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone}`}>
      <GlobeCode className="size-4" aria-hidden="true" />
    </button>} /><TooltipContent>Inspect root URI autocomplete SPARQL</TooltipContent></Tooltip>;
}

export function RootAutocompleteQueryInspector({ open, onOpenChange, query, input, addr }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  query: string | null; input: string; addr: string;
}) {
  const graphServer = addr.includes("@") ? addr.slice(addr.indexOf("@") + 1) : addr;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90vh] w-[min(95vw,68rem)] max-w-none flex-col overflow-hidden p-4"
      aria-label="Root URI autocomplete generated SPARQL">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <DialogTitle>Root URI autocomplete — Generated SPARQL</DialogTitle>
          <DialogDescription className="break-all text-xs">{`Root query · ${input.trim() || "empty input"} · ${graphServer || "no graph server"}`}</DialogDescription>
        </div>
        <button type="button" aria-label="Close autocomplete SPARQL dialog" onClick={() => onOpenChange(false)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" aria-hidden="true" /> Close
        </button>
      </div>
      {query ? <CodeBlock className="min-h-0 flex-1" code={query} language="sparql" filename="root-uri-autocomplete.sparql" executionAddr={addr} />
        : <p className="p-3 text-sm text-muted-foreground">No SPARQL is dispatched for an empty input or a complete URI. Enter search text, then open this inspector.</p>}
    </DialogContent>
  </Dialog>;
}
