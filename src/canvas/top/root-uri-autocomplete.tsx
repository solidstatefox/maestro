"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createUriAutocompleteController, selectUriAutocomplete, type UriSuggestion } from "@/lib/app-lifecycle/uri-autocomplete";
import { createRootUriAutocompleteQuery } from "@/lib/uri-autocomplete-query";
import { createAutocompleteTypeQuery, selectAutocompleteTypes, type AutocompleteTypeRow } from "@/lib/uri-autocomplete-type";
import { readUriAutocompleteSettings } from "@/lib/uri-autocomplete-settings";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { isRootUriOrPrefix, MAX_ROOT_URI_CHARS, parseRootUri } from "@/lib/root-uri-policy";
import type { RootUriGateState } from "@/lib/app-lifecycle/root-uri-gate";
/** The root URI draft commits only on Enter or option selection. XState owns
 * loading, error, empty success, stale cancellation and the selected scope. */
export function RootUriAutocomplete({ value, addr, gateState, onDraft, onCommit, onRequestClose }: {
  value: string; addr: string; gateState: RootUriGateState; onDraft: (value: string) => void; onCommit: (value: string, selectedLabel?: string) => void;
  onRequestClose?: () => void;
}) {
  const [actor] = useState(createUriAutocompleteController);
  const snapshot = useSyncExternalStore(actor.subscribe, actor.getSnapshot, actor.getSnapshot);
  const prefix = value.trim();
  const urlDraft = isRootUriOrPrefix(prefix);
  const key = !urlDraft && prefix.length>=1 && prefix.length<=MAX_ROOT_URI_CHARS ? `${addr}\u0000${prefix}` : "";
  const result = selectUriAutocomplete(snapshot,key);
  useEffect(()=>{actor.start();return ()=>actor.stop();},[actor]);
  useEffect(()=>{
    actor.clear();
    if(!key || !addr.includes("@"))return;
    actor.find(key,async signal=>{
        const settings = readUriAutocompleteSettings();
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutSeconds * 1000)]);
        const execute = async () => {
          const query = createRootUriAutocompleteQuery(prefix, addr, settings);
          if (!query) return {results: { bindings: [] as Array<{uri?: {type?: string;value?: string};label?: {value?: string}}> }};
          const response = await fetch("/proxy/api/sparql", {
            method: "POST", signal: requestSignal, cache: "no-store",
            headers: {"Content-Type":"application/json", "X-Maestro-Query-Label":"Root:Autocomplete",
              "x-maestro-query-timeout-ms": String(settings.timeoutSeconds * 1000)},
            body: JSON.stringify({addr,query,requestClass:"autocomplete"}),
          });
          const raw = await response.text();
          let data: {results?: {bindings?: Array<{uri?: {type?:string;value?:string};label?:{value?:string}}>};error?: string} = {};
          try { data = JSON.parse(raw) as typeof data; }
          catch { throw new Error(`Autocomplete HTTP ${response.status}: invalid SPARQL JSON`); }
          if (!response.ok || !Array.isArray(data.results?.bindings)) {
            const message = data.error || `Autocomplete HTTP ${response.status}`;
            if (/UNABLE_TO_GET_ISSUER_CERT_LOCALLY|unable to get local issuer certificate/i.test(message))
              throw new Error("Autocomplete TLS certificate-chain verification failed for the selected endpoint. Check the server certificate/intermediate CAs and the proxy trust store; TLS verification was not disabled.");
            if (/IRI_RANK|SR185|undefined procedure/i.test(message))
              throw new Error("This SPARQL endpoint does not support Virtuoso IRI_RANK. Ranked autocomplete cannot be supplied by this endpoint.");
            throw new Error(message);
          }
          return data;
        };
        // Rank is mandatory. A server without Virtuoso's Facet VAD gets a
        // transparent compatibility error, not a silently unsorted list.
        const data = await execute();
        const unique=new Map<string,UriSuggestion>();
        for(const row of data.results?.bindings ?? []){
          const uri=row.uri?.value??"";
          if(row.uri?.type==="uri"&&parseRootUri(uri)){
            if(!unique.has(uri))unique.set(uri,{uri,label:row.label?.value||uri});
          }
        }
        const ranked = [...unique.values()].slice(0,settings.limit);
        return ranked;
      },async (ranked, signal) => {
        // Second, independent XState invocation: metadata cannot delay ranked
        // URI/label rows and is aborted when the selected context changes.
        const typeQuery = createAutocompleteTypeQuery(ranked.map(item=>item.uri),addr);
        if (!typeQuery || signal.aborted) return new Map<string,string>();
        const typeSignal=AbortSignal.any([signal, AbortSignal.timeout(3500)]);
        const response=await fetch("/proxy/api/sparql",{
          method:"POST",signal:typeSignal,cache:"no-store",
          headers:{"Content-Type":"application/json","X-Maestro-Query-Label":"Root:AutocompleteTypes",
            "x-maestro-query-timeout-ms":"3500"},
          body:JSON.stringify({addr,query:typeQuery}),
        });
        if (!response.ok) return new Map<string,string>();
        const payload=await response.json() as {results?:{bindings?:AutocompleteTypeRow[]}};
        return selectAutocompleteTypes(payload.results?.bindings??[],ranked.map(item=>item.uri));
      });
    return ()=>actor.clear();
  },[actor,key,addr,prefix]);
  const suggestions = result.items;
  return <span className="flex min-w-0 flex-1 items-stretch" data-maestro-root-combobox="true" data-xstate-gate={gateState}>
    <Combobox items={suggestions} itemToStringLabel={(item:UriSuggestion)=>item.label} itemToStringValue={(item:UriSuggestion)=>item.uri}
      filter={null} open={result.open && !urlDraft} onOpenChange={(next, details) => {
        // Base UI may signal close when a controlled list goes empty. Keep the
        // anchored popup open for loading, no-results, and transport errors.
        // An empty/result error is an in-popup state, never a close reason.
        if (!next && (result.loading || result.error || (result.ready && suggestions.length === 0)) && details.reason === "none") return;
        actor.setOpen(next);
      }} inputValue={value}
      onInputValueChange={(text:string,details)=>{if(details.reason==="item-press")return;onDraft(text);actor.setOpen(!isRootUriOrPrefix(text));}}
      onValueChange={(selected)=>{if(selected && !Array.isArray(selected)){onDraft(selected.uri);onCommit(selected.uri, selected.label);actor.setOpen(false);}}}>
      <ComboboxInput autoFocus showTrigger={false} showClear={false} maxLength={MAX_ROOT_URI_CHARS} placeholder="Enter URI or search for a resource" aria-label="Root URI (XState validated)"
        className="h-10 min-w-0 flex-1 rounded-none border-0 shadow-none focus-within:ring-0"
        onFocus={()=>actor.setOpen(!urlDraft)}
        onKeyDown={event=>{
          if(event.key==="Escape"){actor.setOpen(false);onRequestClose?.();}
          if(event.key==="Enter" && (urlDraft || suggestions.length===0)){event.preventDefault();onCommit(value);actor.setOpen(!parseRootUri(value));}
        }}/>
      <ComboboxContent aria-label="URI suggestions" onMouseLeave={(event) => {
        // The popup is portaled. Leaving it for the root InputGroup is not a
        // dismissal; leaving the composite control closes the root editor.
        if ((event.relatedTarget instanceof Element &&
            event.relatedTarget.closest('[data-maestro-root-editor="true"]')) ||
            (document.activeElement instanceof Element &&
            document.activeElement.closest('[data-maestro-root-editor="true"]'))) return;
        actor.setOpen(false);
        onRequestClose?.();
      }}>
        {result.loading ? <div role="status" className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
        : result.error ? <div role="alert" className="px-3 py-2 text-sm text-destructive">{result.error}</div>
        : !key ? <div className="px-3 py-2 text-sm text-muted-foreground">Type to search resource labels</div>
        : null}
        {result.ready && suggestions.length===0 && <div role="status" className="px-3 py-2 text-sm text-muted-foreground">No results</div>}
        <ComboboxList>{(item:UriSuggestion)=><ComboboxItem key={item.uri} value={item}>
          <span className="grid w-full min-w-0 grid-cols-[minmax(8rem,1fr)_minmax(7rem,0.8fr)] gap-x-3 gap-y-0.5 text-left">
            <span className="truncate font-medium" title={item.label}>{item.label}</span>
            <span className="truncate text-xs text-muted-foreground" title={item.rdfType??"No rdf:type returned"}>{item.rdfType ? (item.rdfType.split(/[\/#]/).filter(Boolean).pop()||item.rdfType) : ""}</span>
            <span className="col-span-2 truncate text-xs text-muted-foreground" title={item.uri}>{item.uri}</span>
          </span>
        </ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>

  </span>;
}
