"use client";
import { useRef, useState } from "react";
import { Braces } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useFctQuery, type FctQueryNode } from "@/lib/fct-query";
import { discoverApprovedRegexDerivations } from "@/lib/client-derived-facet-providers";
import { spawnRegexDerivedFacets } from "@/lib/fct-derived-facets";

/** Generic action: the approval-filtered SHACL provider defines which
 * predicates and capture fields apply, never a hard-coded email name in JSX. */
export function DerivedFacetButton({ source }: { source: FctQueryNode }) {
  const { tree, replaceTree } = useFctQuery();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const controller=useRef<AbortController|null>(null);
  const extract=async () => {
    if (busy) return;
    controller.current?.abort();
    const next=new AbortController(); controller.current=next;
    setBusy(true); setError("");
    try {
      const fields=await discoverApprovedRegexDerivations(source.attributes.iri || "", next.signal);
      if (next.signal.aborted) return;
      if (!fields.length) {setError("No approved regex derivation provider matches this facet.");return;}
      replaceTree(spawnRegexDerivedFacets(tree,source.id,fields));
    } catch (error) {
      if (!next.signal.aborted) setError(error instanceof Error ? error.message : "Derived facet creation failed.");
    } finally {if (controller.current===next) {setBusy(false);controller.current=null;}}
  };
  return <div className="inline-flex items-center gap-1">
    <Tooltip><TooltipTrigger render={<button type="button" disabled={busy}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      onClick={() => void extract()} aria-label="Extract approved regex-derived facets">
        <Braces className="size-4" />
      </button>} /><TooltipContent>Extract fields using an approved regex provider</TooltipContent></Tooltip>
    {error && <Tooltip><TooltipTrigger render={<span role="status" className="max-w-28 truncate text-xs text-destructive" title={error}>No provider</span>} /><TooltipContent>{error}</TooltipContent></Tooltip>}
  </div>;
}
