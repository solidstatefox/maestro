"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { useEffect, useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { buildFctCountSparql } from "@/lib/fct-count-sparql";
import type { FctQueryNode, FctQueryTree } from "@/lib/fct-query-api";
import type { NumericFacetProvider } from "@/canvas/left/personal-date-facet";

const numeric = (value: string | undefined): number | null => {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const format = (number: number) => Number(number.toPrecision(10)).toString();
/** Compact display only; range values and SPARQL bounds retain full precision. */
const display = (number: number) => new Intl.NumberFormat(typeof navigator !== "undefined" ? navigator.language : "en-US", {
  notation: "compact", maximumSignificantDigits: 5,
}).format(number);

/** Numeric-range widget mounted alongside the checkbox list; no independent
 * facet and no hard-coded property IRIs. The provider supplies the additional
 * projections; Maestro compiles them into the existing FCT count scope. */
export function NumericFacetContent({ provider, tree, property, selected, onRangeChange }: {
  provider: NumericFacetProvider;
  tree: FctQueryTree;
  property: string;
  selected?: FctQueryNode;
  onRangeChange: (property: string, start: string, end: string) => void;
}) {
  const start = selected?.children.find(node => node.name === "value" && node.attributes.rangeStart !== undefined)?.attributes.rangeStart;
  const end = selected?.children.find(node => node.name === "value" && node.attributes.rangeEnd !== undefined)?.attributes.rangeEnd;
  const query = useMemo(() => {
    // Exclude only this facet's existing range from domain discovery; the
    // remaining live FCT constraints must be honored.
    const copy = structuredClone(tree);
    const stripCurrentScope = (nodes: FctQueryNode[]): boolean => {
      if (nodes.some(node => node.name === "view")) {
        for (const node of nodes) {
          if (node.name === "property" && node.attributes.iri === property)
            node.children = node.children.filter(child => !(child.name === "value" &&
              (child.attributes.rangeStart !== undefined || child.attributes.rangeEnd !== undefined)));
        }
        return true;
      }
      for (const node of nodes) if (stripCurrentScope(node.children)) return true;
      return false;
    };
    stripCurrentScope(copy.children);
    return buildFctCountSparql(copy, { predicate: property, projections: provider.projections });
  }, [tree, property, provider]);
  const [domain, setDomain] = useState<[number, number] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<[number, number] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);setDraft(null);setError("");
    if (!query) { setError("Numeric domain is unavailable for this FCT query scope."); setLoading(false); return () => controller.abort(); }
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/sparql", {
          method: "POST", signal: controller.signal, cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Maestro-Query-Label": "NumericFacet:count-projection" },
          body: JSON.stringify({ facetValueCount: { addr: tree.attributes.addr, sparql: query, numericDomain: true } }),
        });
        const data = await response.json() as { error?: string; incomplete?: boolean; min?: string | null; max?: string | null };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (data.incomplete) throw new Error("Numeric domain query timed out before completing.");
        const min = numeric(data.min ?? undefined);const max = numeric(data.max ?? undefined);
        if (!controller.signal.aborted && min !== null && max !== null && min <= max) setDomain([min,max]);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Numeric domain unavailable");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query, tree.attributes.addr]);
  if (!domain) return error ? <ErrorDetails prefix="Numeric facet" error={error} /> : <div className="h-56 w-[104px] shrink-0 animate-pulse border-r pr-2" aria-label="Loading numeric facet domain"><div className="mx-auto h-full w-1.5 rounded bg-muted" /></div>;
  const [min,max] = domain;
  if (min === max) return <span className="text-xs text-muted-foreground">{display(min)}</span>;
  const lower = Math.max(min, Math.min(max, numeric(start) ?? min));
  const upper = Math.max(lower, Math.min(max, numeric(end) ?? max));
  const current = draft ?? [lower, upper];
  const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : (max - min) / 1000;
  // Radix places MAX at the top of a vertical slider and MIN at the bottom.
  // The first value is the lower bound (bottom thumb), the second is the
  // upper bound (top thumb). Keep those labels in the same visual order.
  return <div aria-busy={loading} className={`flex h-56 w-[104px] shrink-0 flex-col items-center gap-1 border-r pr-2 text-[10px] tabular-nums ${loading ? "opacity-50" : ""}`} data-numeric-facet-provider={provider.uri}>
    <div className="w-full text-center leading-tight" aria-label={`Domain maximum ${format(max)}; selected upper bound ${format(current[1])}`}>
      <div className="text-muted-foreground">Max {display(max)}</div>
      <div>To {display(current[1])}</div>
    </div>
    <div className="min-h-0 flex-1 py-1">
      <Slider orientation="vertical" disabled={loading} min={min} max={max} step={step} value={current}
        aria-label={`Numeric range for ${property}`}
        onValueChange={values => setDraft([values[0] ?? min,values[1] ?? max])}
        onValueCommit={values => {setDraft(null);onRangeChange(property, format(values[0] ?? min), format(values[1] ?? max));}}/>
    </div>
    <div className="w-full text-center leading-tight" aria-label={`Selected lower bound ${format(current[0])}; domain minimum ${format(min)}`}>
      <div>From {display(current[0])}</div>
      <div className="text-muted-foreground">Min {display(min)}</div>
    </div>
    <button type="button" disabled={loading} className="rounded px-1 text-muted-foreground underline hover:text-foreground" onClick={() => {setDraft(null);onRangeChange(property,"","");}}>Clear</button>
  </div>;
}
