"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { useEffect, useMemo, useState } from "react";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { readFctResponse } from "@/canvas/utils/fct-response";
import { serializeFctQuery } from "@/lib/fct-query-api";
import { createCooccurringPropertyWidgetQuery } from "@/lib/fct-query-derived";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { toLabel } from "@/lib/uri-labels";
import { facetValueKey, groupValueBinding, distinctFacetValues, countedFacetValues, facetMembershipCount, type FctResult } from "@/canvas/utils/fct-response";
import { fctTermKey } from "@/canvas/utils/fct-response";
import type { FctQueryTree, FctQueryNode } from "@/lib/fct-query-api";

/** A four-size, data-driven cloud. Counts are returned by the shared
 * count-sorted FCT value-list query, never invented from page position or label length. */
export function PersonalTagCloud({ property, values, tree, selected, enabled, busy, onChange }: {
  property: string; values: FctResult[]; tree: FctQueryTree; selected?: FctQueryNode;
  enabled: boolean; busy: boolean;
  onChange: (value: ReturnType<typeof groupValueBinding>, enabled: boolean) => void;
}) {
  const projectionXml = useMemo(() => selected?.children.some(node => node.name === "value")
    ? serializeFctQuery(createCooccurringPropertyWidgetQuery(tree, property, selected.id)) : "",
    [tree, property, selected]);
  const [cooccurrence, setCooccurrence] = useState<{ key: string; values: FctResult[] | null; error: string }>(
    { key: "", values: null, error: "" });
  const cooccurrenceKey = enabled ? projectionXml : "";
  useEffect(() => {
    if (!cooccurrenceKey) return;
    const controller = new AbortController();
    // Revisiting the same query must not erase tags already loaded for that
    // exact scope. A new scope is hidden synchronously by the keyed projection.
    setCooccurrence(current => current.key === cooccurrenceKey
      ? { ...current, error: "" }
      : { key: cooccurrenceKey, values: null, error: "" });
    void (async () => {
      try {
        const response = await cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store",
          headers: {"x-maestro-view-tab": "browse",  "Content-Type": "text/xml; charset=utf-8", "X-Maestro-Query-Label": "TagCloud:cooccurring-values" },
          body: projectionXml, signal: controller.signal });
        const data = await readFctResponse(response);
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) setCooccurrence({ key: cooccurrenceKey, values: countedFacetValues(data.results ?? []), error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setCooccurrence(current => current.key === cooccurrenceKey
          ? { ...current, error: error instanceof Error ? error.message : "Co-occurring tags request failed" }
          : current);
        // Retain the ordinary facet value list as a usable fallback.
      }
    })();
    return () => controller.abort();
  }, [cooccurrenceKey]);
  const cooccurring = cooccurrence.key === cooccurrenceKey ? cooccurrence.values : null;
  const cooccurringError = cooccurrence.key === cooccurrenceKey ? cooccurrence.error : "";
  // A co-occurrence query with no projected values must not erase the normal
  // facet. The selected term is still actionable and should remain visible
  // when a server cannot project additional tags for this query scope.
  // Co-occurring values extend the ordinary facet set; they never replace
  // it.  Asynchronous projection pages must not make existing tags vanish.
  // Distinct RDF-term identity keeps the result stable through refresh/reentry.
  const shownValues = useMemo(() => distinctFacetValues([
    ...values, ...(cooccurring ?? []),
  ]), [cooccurring, values]);
  const selectedKeys = new Set((selected?.children ?? []).filter(node => node.name === "value" && Boolean(node.text))
    .map(node => fctTermKey(node.text ?? "", node.attributes.datatype ?? (node.attributes["xml:lang"] ? undefined : "string"), node.attributes["xml:lang"])));
  const items = shownValues.map(value => {
    return { value, count: facetMembershipCount(value), selected: selectedKeys.has(facetValueKey(value)) };
  }).filter(item => item.selected || (item.count ?? 0) > 0);
  const known = items.map(item => item.count).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const smallest = known.length ? Math.min(...known) : 1;
  const largest = known.length ? Math.max(...known) : 1;
  const classes = ["text-xs", "text-sm", "text-base", "text-lg"] as const;
  return <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 p-1" aria-label="Tag cloud" aria-busy={busy}>
    {cooccurringError && <ErrorDetails prefix="Co-occurring tags" error={cooccurringError} />}
    {items.length === 0 && <span className="text-xs text-muted-foreground" role="status">
      {busy ? "Loading tags…" : "No tag values in the current facet scope"}
    </span>}
    {items.map(({ value, count, selected: checked }) => {
      const label = value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri;
      const rank = typeof count === "number" && count > 0 && largest > smallest
        ? Math.min(3, Math.floor(3 * Math.log(count / smallest + 1) / Math.log(largest / smallest + 1))) : 1;
      return <Tooltip key={facetValueKey(value)}>
        <TooltipTrigger render={<button type="button" aria-pressed={checked} disabled={busy}
          aria-label={`${label}: ${typeof count !== "number" ? "count unavailable" : count.toLocaleString()} matches${checked ? ", selected" : ""}`}
          onClick={() => onChange(groupValueBinding(value), !checked)}
          className={`${classes[rank]} cursor-pointer rounded px-1.5 py-0.5 leading-snug font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${checked ? "bg-accent text-accent-foreground ring-1 ring-ring" : "text-foreground"}`}>
          {label}
        </button>} />
        <TooltipContent>{label} · {typeof count === "number" ? `${count.toLocaleString()} matches` : "Count unavailable"}</TooltipContent>
      </Tooltip>;
    })}
  </div>;
}
