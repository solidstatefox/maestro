"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useFctQuery, fctQueryTreeApi, serializeFctQuery } from "@/lib/fct-query-api";
import { createTransportedFacetQuery, resolveTransportedFacets, type TransportedFacet } from "@/lib/fct-facet-alias";
import { readFctResponse, type FctResult } from "@/canvas/utils/fct-response";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";
import { toLabel } from "@/lib/uri-labels";

function TransportedPersonalFacet({ alias, navigate, endpointReady }: {
  alias: TransportedFacet; navigate: (id:string) => void; endpointReady:boolean;
}) {
  const { tree, replaceTree } = useFctQuery();
  const [items, setItems] = useState<FctResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const query = useMemo(() => {
    try { return serializeFctQuery(createTransportedFacetQuery(tree, alias.href)); }
    catch { return ""; }
  }, [tree, alias.href]);
  useEffect(() => {
    if (!endpointReady || !query) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        const response = await fetch("/proxy/api/fct", {method:"POST",signal:controller.signal,cache:"no-store",
          headers:{"Content-Type":"text/xml; charset=utf-8"},body:query});
        const result = await readFctResponse(response);
        if (!controller.signal.aborted) setItems(result.results ?? []);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [query, endpointReady]);
  const currentTarget = (() => {
    const lookup = (nodes: typeof tree.children): (typeof tree.children)[number] | undefined => {
      for (const node of nodes) { if (node.id === alias.href) return node; const found = lookup(node.children); if (found) return found; }
    };
    return lookup(tree.children);
  })();
  const selected = currentTarget?.children.filter(node => node.name === "value") ?? [];
  const checked = (result: FctResult) => selected.some(node => node.text === result.uri &&
    (node.attributes.datatype ?? (result.termType === "uri" ? "uri" : "string")) === (result.termType === "uri" ? "uri" : result.datatype ?? "string"));
  const toggle = (result: FctResult, value: boolean) => {
    const selections = selected.map(node => ({text:node.text ?? "",datatype:node.attributes.datatype,lang:node.attributes["xml:lang"]}));
    const next = value ? [...selections, {text:result.uri,datatype:result.termType === "uri" ? "uri" : result.datatype ?? "string",lang:result.lang}]
      : selections.filter(item => item.text !== result.uri);
    replaceTree(fctQueryTreeApi.setValue(tree, alias.href, next, {replaceExisting:true}));
  };
  const pageCount = Math.max(1, Math.ceil(items.length/10));
  const rendered = items.slice(Math.min(page,pageCount-1)*10,Math.min(page,pageCount-1)*10+10);
  return <article className="rounded-md border" aria-label={`Transported facet ${toLabel(alias.target.attributes.iri ?? "")}`}>
    <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center text-sm font-semibold">
        {alias.path.map((step,index) => <span className="inline-flex min-w-0 items-center" key={step.id}>
          {index > 0 && <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground" />}
          <button type="button" className="break-all text-left hover:underline" title={`Navigate to ${step.iri}`} onClick={() => navigate(step.id)}>{toLabel(step.iri)}</button>
        </span>)}
      </div>
      {loading ? <span className="text-xs text-muted-foreground">Loading…</span> : <span className="text-xs text-muted-foreground">{items.length}</span>}
      {query && <QueryInspectorButton query={query} filename={`transported-facet-${alias.href}.xml`} />}
    </header>
    {error && <div role="alert" className="px-3 py-2 text-xs text-destructive">{error}</div>}
    <div className="max-h-72 overflow-auto px-2 py-1">
      {rendered.map((item,index) => <label key={`${item.uri}-${index}`} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
        <input type="checkbox" className="size-4" checked={checked(item)} onChange={event => toggle(item,event.target.checked)} />
        <span className="min-w-0 flex-1 break-all">{item.title || toLabel(item.uri)}</span>
        {item.columns?.[1]?.value && <span className="text-xs tabular-nums text-muted-foreground">{item.columns[1].value}</span>}
      </label>)}
      {!loading && !error && items.length === 0 && <p className="p-2 text-xs text-muted-foreground">No matching values.</p>}
    </div>
    {pageCount > 1 && <footer className="flex justify-between border-t px-3 py-1 text-xs">
      <button type="button" disabled={page===0} onClick={() => setPage(p => Math.max(0,p-1))} className="disabled:opacity-40">Previous</button>
      <span>{Math.min(page,pageCount-1)+1}/{pageCount}</span>
      <button type="button" disabled={page >= pageCount-1} onClick={() => setPage(p => Math.min(pageCount-1,p+1))} className="disabled:opacity-40">Next</button>
    </footer>}
  </article>;
}

export function TransportedPersonalFacets({ navigate, endpointReady }: {navigate:(id:string)=>void;endpointReady:boolean}) {
  const {tree} = useFctQuery();
  const aliases = resolveTransportedFacets(tree);
  return <>{aliases.map(alias => <TransportedPersonalFacet key={alias.id} alias={alias} navigate={navigate} endpointReady={endpointReady} />)}</>;
}
