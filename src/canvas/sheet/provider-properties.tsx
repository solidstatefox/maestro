"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  listProviderStorageProperties, providerStorage, subscribeProviderStorageChanges,
  type ProviderStorageProperty,
} from "@/lib/maestro-storage";

/** Generic cubby inspector: no provider-specific keys, defaults, or validators. */
function PropertyEditor({ property, refresh }: { property: ProviderStorageProperty; refresh: () => void }) {
  const [draft, setDraft] = useState(property.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(property.value); }, [property.value]);
  const store = providerStorage(property.providerIri, property.accountScope);
  const save = async () => {
    setBusy(true); setError("");
    try { await store.set(property.key, draft); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete provider property '${property.key}'?`)) return;
    setBusy(true); setError("");
    try { await store.remove(property.key); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2 rounded-md border p-2">
    <Label className="break-all font-mono text-xs">{property.key}</Label>
    <textarea aria-label={`Value of ${property.key}`} value={draft} onChange={e=>setDraft(e.target.value)}
      spellCheck={false} rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 60)))}
      className="w-full resize-y rounded-md border bg-background p-2 font-mono text-xs" />
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || draft === property.value} onClick={()=>void save()}><Save className="mr-1 size-3"/>Save</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void remove()} aria-label={`Delete ${property.key}`}><Trash2 className="size-3"/></Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

type ProviderGroup = { accountScope: string; providerIri: string; properties: ProviderStorageProperty[] };
export function ProviderProperties({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<ProviderStorageProperty[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providerIri, setProviderIri] = useState("");
  const [accountScope, setAccountScope] = useState("");
  const [propertyKey, setPropertyKey] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const [addError, setAddError] = useState("");
  const refresh = useCallback(() => {
    if (!active) return;
    void listProviderStorageProperties().then(setEntries).catch(cause =>
      setError(cause instanceof Error ? cause.message : String(cause)));
  }, [active]);
  useEffect(() => {
    if (!active) return;
    refresh();
    return subscribeProviderStorageChanges(() => refresh());
  }, [active, refresh]);
  const groups = useMemo(() => {
    const map = new Map<string, ProviderGroup>();
    for (const entry of entries) {
      const id = JSON.stringify([entry.accountScope, entry.providerIri]);
      const group = map.get(id) ?? { accountScope: entry.accountScope, providerIri: entry.providerIri, properties: [] };
      group.properties.push(entry);
      map.set(id, group);
    }
    return [...map.values()];
  }, [entries]);
  const add = async () => {
    setBusy(true); setAddError("");
    try {
      if (!providerIri.trim() || !accountScope.trim() || !propertyKey.trim())
        throw new Error("Provider URI, account scope and property name are required.");
      const store = providerStorage(providerIri.trim(), accountScope);
      if (await store.get(propertyKey) !== null) throw new Error("Property already exists. Edit its value above.");
      await store.set(propertyKey, propertyValue);
      setPropertyKey(""); setPropertyValue(""); refresh();
    } catch (cause) { setAddError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3 rounded-md border p-3" aria-label="Provider properties">
    <div className="flex items-center justify-between gap-2">
      <Label>Provider properties</Label>
      <Button type="button" size="sm" variant="outline" onClick={refresh} aria-label="Refresh provider properties"><RefreshCcw className="size-3"/></Button>
    </div>
    <p className="text-xs text-muted-foreground">Inspect, edit, add or delete properties saved through the provider IndexedDB cubby API. Values are stored as strings. Providers validate their own settings when they load.</p>
    {!groups.length && <p className="text-xs text-muted-foreground">No provider cubby properties saved yet. Open a provider to initialize its settings, or add a property below.</p>}
    {groups.map(group => <Collapsible key={JSON.stringify([group.accountScope,group.providerIri])} className="rounded-md border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 p-2 text-left text-xs hover:bg-accent">
        <ChevronRight className="size-3 shrink-0"/>
        <span className="min-w-0 flex-1 break-all font-medium" title={group.providerIri}>{group.providerIri}</span>
        <span className="tabular-nums text-muted-foreground">{group.properties.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t p-2">
        <div className="break-all text-xs text-muted-foreground" title={group.accountScope}>Account scope: {group.accountScope}</div>
        {group.properties.map(item => <PropertyEditor key={item.key} property={item} refresh={refresh}/>)}
        <Button type="button" size="sm" variant="outline" onClick={()=>{setProviderIri(group.providerIri);setAccountScope(group.accountScope);}}><Plus className="mr-1 size-3"/>Add property to this provider</Button>
      </CollapsibleContent>
    </Collapsible>)}
    <Collapsible className="rounded-md border">
      <CollapsibleTrigger className="w-full p-2 text-left text-xs font-medium hover:bg-accent">Add provider property</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t p-2">
        <Label htmlFor="provider-props-iri">Provider IRI</Label>
        <Input id="provider-props-iri" value={providerIri} onChange={e=>setProviderIri(e.target.value)} placeholder="Provider IRI" />
        <Label htmlFor="provider-props-scope">Account scope</Label>
        <Input id="provider-props-scope" value={accountScope} onChange={e=>setAccountScope(e.target.value)} placeholder="Account scope" />
        <Label htmlFor="provider-props-key">Property</Label>
        <Input id="provider-props-key" value={propertyKey} onChange={e=>setPropertyKey(e.target.value)} placeholder="Property name" />
        <Label htmlFor="provider-props-value">Value</Label>
        <textarea id="provider-props-value" value={propertyValue} onChange={e=>setPropertyValue(e.target.value)} rows={2}
          className="w-full rounded-md border bg-background p-2 font-mono text-xs" />
        <Button type="button" size="sm" disabled={busy} onClick={()=>void add()}><Plus className="mr-1 size-3"/>Add</Button>
        {addError && <p role="alert" className="text-xs text-destructive">{addError}</p>}
      </CollapsibleContent>
    </Collapsible>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
