"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { useProviderWidgetLifecycle } from "@/canvas/diagnostics/use-provider-widget-lifecycle";
import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { resetMaestroQueryExecutionScope } from "@/lib/maestro-query-execution-clock";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
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
  const [domainKey, setDomainKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const [editingBound, setEditingBound] = useState<"lower" | "upper" | null>(null);
  const [editingText, setEditingText] = useState("");
  const editingRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingBound) { editingRef.current?.focus(); editingRef.current?.select(); }
  }, [editingBound]);
  const widgetPhase = useProviderWidgetLifecycle(`${provider.uri}|${property}|${tree.attributes.addr}`, {
    loading, ready: Boolean(domain) && domainKey === `${tree.attributes.addr}\u0000${query}`, error,
  });
  useEffect(() => {
    const controller = new AbortController();
    // Keep the last valid same-endpoint domain mounted while the next FCT
    // scope is being measured. The slider is disabled until the new scope is
    // confirmed; no stale bound can be committed to the live query.
    resetMaestroQueryExecutionScope(`component:numeric:${property}`);
    setLoading(true); setDraft(null); setEditingBound(null); setError("");
    if (!query) { setError("Numeric domain is unavailable for this FCT query scope."); setLoading(false); return () => controller.abort(); }
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/sparql", {
          method: "POST", signal: controller.signal, cache: "no-store",
          headers: {"x-maestro-view-tab": "shared", "x-maestro-view-ribbon": "query",  "Content-Type": "application/json", "X-Maestro-Query-Label": "NumericFacet:count-projection",
            ...proxyDebugHeaders("facet:count:numeric-domain", `NumericFacet:${provider.uri}:${property}`),
            "X-Maestro-Clock-Component": `component:numeric:${property}` },
          body: JSON.stringify({ facetValueCount: { addr: tree.attributes.addr, sparql: query, numericDomain: true } }),
        });
        const responseBody = await response.text();
        let data: { error?: string; incomplete?: boolean; min?: string | null; max?: string | null } = {};
        try { data = JSON.parse(responseBody) as typeof data; } catch { /* retain the raw upstream failure */ }
        if (!response.ok) throw new Error(`Numeric domain HTTP ${response.status} ${response.statusText}; ${data.error ?? responseBody.slice(0, 4000)}; endpoint ${tree.attributes.addr}; count projection SPARQL:\n${query}`);
        if (data.incomplete) throw new Error("Numeric domain query timed out before completing.");
        const min = numeric(data.min ?? undefined);const max = numeric(data.max ?? undefined);
        if (controller.signal.aborted) return;
        if (min === null || max === null || min > max) throw new Error("Numeric facet returned an invalid MIN/MAX domain.");
        setDomain([min, max]);
        setDomainKey(`${tree.attributes.addr}\u0000${query}`);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Numeric domain unavailable");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query, tree.attributes.addr]);
  const scopeKey = `${tree.attributes.addr}\u0000${query}`;
  const domainIsCurrent = Boolean(domain && domainKey === scopeKey);
  const canRetainDomain = Boolean(domain && domainKey.startsWith(`${tree.attributes.addr}\u0000`));
  const refreshing = !domainIsCurrent || loading;
  // Never display one graph server's numeric domain as another server's domain.
  if (!domain || !canRetainDomain) return error ? <ErrorDetails prefix="Numeric facet" error={error} /> :
    <div data-provider-phase={widgetPhase} className="flex h-56 w-[104px] shrink-0 flex-col items-center gap-3 overflow-hidden border-r pr-2 text-[10px] leading-tight" aria-label="Loading numeric facet domain">
      <span className="block w-full min-w-0 text-center text-[10px] leading-tight [&>span]:flex [&>span]:flex-wrap [&>span]:justify-center [&>span]:gap-0.5 [&>span]:whitespace-normal"><ElapsedStatus label="Updating range…" category="counts" clockScope={`component:numeric:${property}`} /></span>
      <div className="mx-auto h-full w-1.5 animate-pulse rounded bg-muted" />
    </div>;
  const [min,max] = domain;
  if (min === max) return <div data-provider-phase={widgetPhase} aria-busy={refreshing} className="flex h-56 w-[104px] shrink-0 flex-col items-center justify-center gap-2 border-r pr-2 text-xs text-muted-foreground" aria-label="Constant numeric domain">
    {(refreshing || error) && <span className="w-full min-w-0 break-words text-center text-[10px] leading-tight">{error ? "Domain unavailable" : "Updating range…"}</span>}
    {display(min)}
    <button type="button" disabled={refreshing || Boolean(error)} className="rounded px-1 underline hover:text-foreground" onClick={() => {setDraft(null);onRangeChange(property,"","");}}>Reset</button>
  </div>;
  const lower = Math.max(min, Math.min(max, numeric(start) ?? min));
  const upper = Math.max(lower, Math.min(max, numeric(end) ?? max));
  const current = draft ?? [lower, upper];
  const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : (max - min) / 1000;
  const beginBoundEdit = (bound: "lower" | "upper") => {
    setEditingText(format(bound === "lower" ? current[0] : current[1]));
    setEditingBound(bound);
  };
  const commitBoundEdit = (bound: "lower" | "upper") => {
    if (editingBound !== bound) return;
    setEditingBound(null);
    const next = numeric(editingText);
    if (next === null) return; // An invalid numeric string cannot become an FCT range.
    const lowerBound = bound === "lower" ? Math.max(min, Math.min(current[1], next)) : current[0];
    const upperBound = bound === "upper" ? Math.min(max, Math.max(lowerBound, next)) : current[1];
    setDraft(null);
    // Commit the FCT <value> only. The ordinary query pipeline re-renders the
    // slider; no imperative slider or sibling-widget synchronization is added.
    onRangeChange(property, format(lowerBound), format(upperBound));
  };
  // Radix places MAX at the top of a vertical slider and MIN at the bottom.
  // The first value is the lower bound (bottom thumb), the second is the
  // upper bound (top thumb). Keep those labels in the same visual order.
  return <div data-provider-phase={widgetPhase} aria-busy={refreshing} className={`flex h-56 w-[104px] shrink-0 flex-col items-center gap-1 border-r pr-2 text-[10px] tabular-nums ${refreshing ? "opacity-50" : ""}`} data-numeric-facet-provider={provider.uri}>
    {(refreshing || error) && <div role="status" className="w-full min-w-0 text-center text-[10px] leading-tight text-muted-foreground">{error ? "Domain unavailable" : <span className="block w-full min-w-0 text-center text-[10px] leading-tight [&>span]:flex [&>span]:flex-wrap [&>span]:justify-center [&>span]:gap-0.5 [&>span]:whitespace-normal"><ElapsedStatus label="Updating range…" category="counts" clockScope={`component:numeric:${property}`} /></span>}</div>}
    <div className="w-full text-center leading-tight" aria-label={`Domain maximum ${format(max)}; selected upper bound ${format(current[1])}`}>
      <div className="text-muted-foreground">Max {display(max)}</div>
      {editingBound === "upper" ? <input ref={editingRef} aria-label="Edit selected upper bound" inputMode="decimal" type="text"
        value={editingText} onChange={event => setEditingText(event.target.value)}
        onBlur={() => commitBoundEdit("upper")}
        className="w-full rounded border border-input bg-background px-0.5 text-center text-[10px]" /> :
        <button type="button" disabled={refreshing || Boolean(error)} onClick={() => beginBoundEdit("upper")}
          className="w-full rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`Edit selected upper bound ${format(current[1])}`}>To {display(current[1])}</button>}
    </div>
    <div className="min-h-0 flex-1 py-1">
      <Slider orientation="vertical" disabled={refreshing || Boolean(error)} min={min} max={max} step={step} value={current}
        aria-label={`Numeric range for ${property}`}
        onValueChange={values => setDraft([values[0] ?? min,values[1] ?? max])}
        onValueCommit={values => {setDraft(null);onRangeChange(property, format(values[0] ?? min), format(values[1] ?? max));}}/>
    </div>
    <div className="w-full text-center leading-tight" aria-label={`Selected lower bound ${format(current[0])}; domain minimum ${format(min)}`}>
      {editingBound === "lower" ? <input ref={editingRef} aria-label="Edit selected lower bound" inputMode="decimal" type="text"
        value={editingText} onChange={event => setEditingText(event.target.value)}
        onBlur={() => commitBoundEdit("lower")}
        className="w-full rounded border border-input bg-background px-0.5 text-center text-[10px]" /> :
        <button type="button" disabled={refreshing || Boolean(error)} onClick={() => beginBoundEdit("lower")}
          className="w-full rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`Edit selected lower bound ${format(current[0])}`}>From {display(current[0])}</button>}
      <div className="text-muted-foreground">Min {display(min)}</div>
    </div>
    <button type="button" disabled={refreshing || Boolean(error)} className="rounded px-1 text-muted-foreground underline hover:text-foreground" onClick={() => {setDraft(null);onRangeChange(property,"","");}}>Reset</button>
  </div>;
}
