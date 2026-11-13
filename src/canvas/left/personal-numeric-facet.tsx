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
  const [draft, setDraft] = useState<[number, number] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDomain(null);setDraft(null);setError("");
    if (!query) return () => controller.abort();
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/sparql", {
          method: "POST", signal: controller.signal, cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Maestro-Query-Label": "NumericFacet:count-projection" },
          body: JSON.stringify({ addr: tree.attributes.addr, resultsQuery: { sparql: query } }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { results?: { bindings?: Array<Record<string, { value?: string }>> } };
        const row = data.results?.bindings?.[0];
        const min = numeric(row?.min?.value);const max = numeric(row?.max?.value);
        if (!controller.signal.aborted && min !== null && max !== null && min <= max) setDomain([min,max]);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Numeric domain unavailable");
      }
    })();
    return () => controller.abort();
  }, [query, tree.attributes.addr]);
  if (!domain) return error ? <ErrorDetails prefix="Numeric facet" error={error} /> : null;
  const [min,max] = domain;
  if (min === max) return null;
  const lower = Math.max(min, Math.min(max, numeric(start) ?? min));
  const upper = Math.max(lower, Math.min(max, numeric(end) ?? max));
  const current = draft ?? [lower, upper];
  const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : (max - min) / 1000;
  return <div className="flex h-52 w-[78px] shrink-0 flex-col items-center gap-2 border-r pr-2 text-[10px] tabular-nums" data-numeric-facet-provider={provider.uri}>
    <div className="text-center" title={`Domain minimum: ${format(min)}`}>{format(min)} ≤ {format(current[0])}</div>
    <div className="min-h-0 flex-1 py-1">
      <Slider orientation="vertical" min={min} max={max} step={step} value={current}
        aria-label={`Numeric range for ${property}`}
        onValueChange={values => setDraft([values[0] ?? min,values[1] ?? max])}
        onValueCommit={values => {setDraft(null);onRangeChange(property, format(values[0] ?? min), format(values[1] ?? max));}}/>
    </div>
    <div className="text-center" title={`Domain maximum: ${format(max)}`}>{format(current[1])} ≤ {format(max)}</div>
    <button type="button" className="rounded px-1 text-muted-foreground underline hover:text-foreground" onClick={() => {setDraft(null);onRangeChange(property,"","");}}>Clear</button>
  </div>;
}
