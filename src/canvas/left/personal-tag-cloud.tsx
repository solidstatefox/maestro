"use client";
import { useEffect, useMemo, useState } from "react";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { readFctResponse } from "@/canvas/utils/fct-response";
import { serializeFctQuery } from "@/lib/fct-query-api";
import { createCooccurringPropertyWidgetQuery } from "@/lib/fct-query-derived";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { toLabel } from "@/lib/uri-labels";
import { facetValueKey, groupValueBinding, type FctResult } from "@/canvas/utils/fct-response";
import { DistinctCount, distinctCountQueryFor } from "@/canvas/left/filter";
import { fctTermKey } from "@/canvas/utils/fct-response";
import type { FctQueryTree, FctQueryNode } from "@/lib/fct-query-api";

/** A four-size, data-driven cloud. Counts are materialized through the existing
 * FCT facet-count queries, never invented from page position or label length. */
export function PersonalTagCloud({ property, values, tree, selected, counts, enabled, busy,
  onCount, onChange }: {
  property: string; values: FctResult[]; tree: FctQueryTree; selected?: FctQueryNode;
  counts: Record<string, number | null>; enabled: boolean; busy: boolean;
  onCount: (query: string, count: number | null) => void;
  onChange: (value: ReturnType<typeof groupValueBinding>, enabled: boolean) => void;
}) {
  const projectionXml = useMemo(() => selected?.children.some(node => node.name === "value")
    ? serializeFctQuery(createCooccurringPropertyWidgetQuery(tree, property, selected.id)) : "",
    [tree, property, selected]);
  const [cooccurring, setCooccurring] = useState<FctResult[] | null>(null);
  useEffect(() => {
    if (!projectionXml || !enabled) { setCooccurring(null); return; }
    const controller = new AbortController();
    setCooccurring(null);
    void (async () => {
      try {
        const response = await cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", "X-Maestro-Query-Label": "TagCloud:cooccurring-values" },
          body: projectionXml, signal: controller.signal });
        const data = await readFctResponse(response);
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) setCooccurring(data.results ?? []);
      } catch { /* Keep the previously available facet values on transport failure. */ }
    })();
    return () => controller.abort();
  }, [projectionXml, enabled]);
  const shownValues = cooccurring ?? values;
  const selectedKeys = new Set((selected?.children ?? []).filter(node => node.name === "value" && Boolean(node.text))
    .map(node => fctTermKey(node.text ?? "", node.attributes.datatype ?? (node.attributes["xml:lang"] ? undefined : "string"), node.attributes["xml:lang"])));
  const items = shownValues.map(value => {
    const query = distinctCountQueryFor(tree, "value", value.uri, property, value, { direction: "forward" });
    return { value, query, count: counts[query], selected: selectedKeys.has(facetValueKey(value)) };
  });
  const known = items.map(item => item.count).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const smallest = known.length ? Math.min(...known) : 1;
  const largest = known.length ? Math.max(...known) : 1;
  const classes = ["text-xs", "text-sm", "text-base", "text-lg"] as const;
  return <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 p-1" aria-label="Tag cloud" aria-busy={busy}>
    {items.map(({ value, query, count, selected: checked }) => {
      const label = value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri;
      const rank = typeof count === "number" && count > 0 && largest > smallest
        ? Math.min(3, Math.floor(3 * Math.log(count / smallest + 1) / Math.log(largest / smallest + 1))) : 1;
      return <Tooltip key={facetValueKey(value)}>
        <TooltipTrigger render={<button type="button" aria-pressed={checked} disabled={busy}
          aria-label={`${label}: ${typeof count !== "number" ? "count loading" : count.toLocaleString()} matches${checked ? ", selected" : ""}`}
          onClick={() => onChange(groupValueBinding(value), !checked)}
          className={`${classes[rank]} cursor-pointer rounded px-1.5 py-0.5 leading-snug font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${checked ? "bg-accent text-accent-foreground ring-1 ring-ring" : "text-foreground"}`}>
          {label}
        </button>} />
        <TooltipContent>{label} · {typeof count === "number" ? `${count.toLocaleString()} matches` : "Counting…"}</TooltipContent>
        {/* Invisible query driver updates the normal facet-count cache for sizing. */}
        <span className="sr-only" aria-hidden="true"><DistinctCount enabled={enabled} tree={tree}
          kind="value" uri={value.uri} propertyUri={property} candidateValue={value}
          valueRelationship={{ direction: "forward" }} onCountChange={onCount}/></span>
      </Tooltip>;
    })}
  </div>;
}
