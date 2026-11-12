"use client";

import { useEffect, useMemo, useState } from "react";
import { cachedFetchFct, maestroQueryFetch } from "@/lib/client-query-cache";
import { propertyUsageFacetQuery, propertyUsageScope, selectedPropertyUsageValues, type PropertyUsageDirection } from "@/lib/property-usage-query";
import { serializeFctQuery, type FctQueryTree, type FctValue } from "@/lib/fct-query-api";
import { readFctResponse, facetValueKey, groupValueBinding, fctTermKey, type FctResult } from "@/canvas/utils/fct-response";
import { FACET_ITEM_GAP_CLASS } from "@/canvas/left/facet-layout";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { shortenCount } from "@/lib/utils";
import { formatPagePosition } from "@/canvas/utils/pagination";
import { toLabel } from "@/lib/uri-labels";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";

/** Built-in, property-class-only facets; intentionally not XSLT providers. */
export function PropertyUsageWidget({ tree, direction, limit, endpointReady, onNavigate }: {
  tree: FctQueryTree;
  direction: PropertyUsageDirection;
  limit: number;
  endpointReady: boolean;
  onNavigate: (direction: PropertyUsageDirection, selection?: { value: FctValue; checked: boolean }) => void;
}) {
  const title = direction === "subject" ? "Subjects" : "Values";
  const scope = propertyUsageScope(tree);
  // Match Categories: ten visible rows per page. Fetch one extra row to
  // distinguish a full last page from a page with more results.
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(0);
  const queryXml = useMemo(() => scope ? serializeFctQuery(propertyUsageFacetQuery(tree, direction, PAGE_SIZE + 1, page * PAGE_SIZE)) : "", [tree, direction, page, Boolean(scope)]);
  const [hasMore, setHasMore] = useState(false);
  const [knownTotal, setKnownTotal] = useState<number | null>(null);
  useEffect(() => { setPage(0); setKnownTotal(null); }, [tree, direction]);
  // As Categories does, report the total number of distinct facet items, not
  // the transport batch size or a speculative "30+". This separate count
  // does not hold up the page rows and is canceled with the focus context.
  const countSourceXml = useMemo(() => scope ? serializeFctQuery(propertyUsageFacetQuery(tree, direction, 1, 0)) : "", [tree, direction, Boolean(scope)]);
  useEffect(() => {
    if (!endpointReady || !countSourceXml) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const compiled = compileFctXmlToSparql(countSourceXml);
        const unpaged = compiled.query.replace(/\s+LIMIT\s+\d+(?:\s+OFFSET\s+\d+)?\s*$/i, "").replace(/\s+ORDER BY[\s\S]*$/i, "");
        const sparql = `SELECT (COUNT(*) AS ?ct) WHERE { { ${unpaged} } }`;
        const response = await maestroQueryFetch("/proxy/api/sparql", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addr: tree.attributes.addr ?? "", resultsQuery: { sparql } }),
        });
        if (!response.ok) return;
        const payload = await response.json() as { results?: { bindings?: Array<{ ct?: { value?: string } }> } };
        const count = Number(payload.results?.bindings?.[0]?.ct?.value);
        if (!controller.signal.aborted && Number.isSafeInteger(count) && count >= 0) setKnownTotal(count);
      } catch { /* An endpoint may time out counting all distinct terms; keep rows usable. */ }
    })();
    return () => controller.abort();
  }, [endpointReady, countSourceXml, tree.attributes.addr]);
  const [items, setItems] = useState<FctResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [countAvailable, setCountAvailable] = useState(true);
  const selectedValues = selectedPropertyUsageValues(tree, direction);
  const selectedKeys = new Set(selectedValues.map(value => fctTermKey(value.text, value.datatype, value.lang)));

  useEffect(() => {
    if (!endpointReady || !queryXml) { setItems([]); setIncomplete(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const load = async (xml: string) => {
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store",
            headers: {
              "Content-Type": "text/xml; charset=utf-8",
              "x-maestro-debug-source": "facet-load",
              "x-maestro-debug-component": `property-usage-${direction}`,
            },
            body: xml, signal: controller.signal,
          });
          const parsed = await readFctResponse(response);
          if (parsed.viewType !== (direction === "subject" ? "list-subjects" : "list-objects"))
            throw new Error(`Expected a ${title} FCT response, received ${parsed.viewType}.`);
          return parsed;
        };
        let parsed = await load(queryXml);
        let hasCounts = true;
        // COUNT(DISTINCT ...) over a variable predicate can exceed the facet
        // deadline even when a plain DISTINCT SELECT returns immediately in
        // Virtuoso's editor. An incomplete zero-row aggregate is NOT a zero-
        // result facet: retry with the non-aggregate native list view.
        if (!parsed.results.length && parsed.incomplete && !controller.signal.aborted) {
          const fallback = propertyUsageFacetQuery(tree, direction, PAGE_SIZE + 1, page * PAGE_SIZE);
          const fallbackView = (nodes: typeof fallback.children): void => {
            for (const node of nodes) {
              if (node.id === "query-view") { node.attributes.sort = ""; return; }
              fallbackView(node.children);
            }
          };
          fallbackView(fallback.children);
          parsed = await load(serializeFctQuery(fallback));
          hasCounts = false;
        }
        if (!controller.signal.aborted) {
          setHasMore(parsed.results.length > PAGE_SIZE);
          if (!parsed.incomplete && parsed.results.length <= PAGE_SIZE) setKnownTotal(page * PAGE_SIZE + parsed.results.length);
          setItems(parsed.results.slice(0, PAGE_SIZE));
          setIncomplete(parsed.incomplete);
          setCountAvailable(hasCounts);
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : `Unable to load ${title}.`);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [endpointReady, queryXml, title, page]);

  if (!scope) return null;
  const sparql = (() => { try { return compileFctXmlToSparql(queryXml).query; } catch { return ""; } })();
  return <article className="flex min-w-0 flex-col" aria-label={title}>
    <header className="group/header flex items-start justify-between gap-2 border-b px-2 py-2">
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" className="cursor-pointer text-sm font-semibold hover:underline underline-offset-2"
          onClick={() => onNavigate(direction)} title={`Show ${title.toLowerCase()} in Results`}>{title}</button>
        <QueryInspectorButton query={queryXml} filename={`${direction}s-fct-query.xml`}
          extraQueries={sparql ? [{ id: "sparql", label: "SPARQL", query: sparql, filename: `${direction}s.sparql`, language: "sparql" }] : undefined} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{!endpointReady || loading ? <ElapsedStatus label={`Fetching ${title.toLowerCase()}`} category="personal" clockScope="personal" /> : incomplete && !items.length ? "Incomplete" : knownTotal === null ? "—" : shortenCount(knownTotal)}</span>
    </header>
    <div className={FACET_ITEM_GAP_CLASS}>
      {items.map(item => {
        const bound = groupValueBinding(item);
        const selected = selectedKeys.has(facetValueKey(item));
        return <div key={`${item.uri}:${item.termType ?? ""}:${item.lang ?? ""}`} className="flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50">
          <input type="checkbox" checked={selected} onChange={event => onNavigate(direction, { value: bound, checked: event.target.checked })}
            className="size-4 shrink-0 accent-primary" aria-label={`Filter ${title.toLowerCase()} by ${item.title || item.uri}`} />
          <button type="button" className="min-w-0 flex-1 cursor-pointer break-all text-left underline-offset-2 hover:underline"
            onClick={() => onNavigate(direction, { value: bound, checked: true })} title={item.uri}>{item.title || toLabel(item.uri)}</button>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{(() => {
            const countColumn = item.columns?.find(column => column.attributes.var === "ct");
            return countAvailable && countColumn ? shortenCount(Number(countColumn.value)) : "—";
          })()}</span>
        </div>;
      })}
    </div>
    {(page > 0 || hasMore) && <div className="mt-2 mb-2 flex items-center justify-between gap-2 text-xs">
      <button type="button" disabled={page === 0 || loading} onClick={() => setPage(n => Math.max(0, n - 1))} className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
      <span className="text-muted-foreground">{formatPagePosition(page, knownTotal === null ? null : Math.max(1, Math.ceil(knownTotal / PAGE_SIZE)))}</span>
      <button type="button" disabled={!hasMore || loading} onClick={() => setPage(n => n + 1)} className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
    </div>}
    {incomplete && !loading && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Virtuoso returned an incomplete {title.toLowerCase()} page; counts may be unavailable.</p>}
    {error && <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p>}
  </article>;
}
