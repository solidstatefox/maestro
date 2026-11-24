"use client";

import { MaestroSelect } from "@/components/ui/maestro-select";
import { useCallback, useEffect, useState } from "react";
import { DatabasePlus, Trash2, Server, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addPersonalGraphServer, deletePersonalGraphServer, listPersonalGraphServers,
  PERSONAL_SERVERS_CHANGED, type PersonalGraphServer } from "@/lib/client-personal-graph-servers";
import { validGraphServerUrl } from "@/lib/graph-server-directory";
import type { EndpointOption, EndpointStatus } from "@/canvas/top/appbar";
import { GraphServerStatusHistory } from "@/canvas/tab/view/graph-server-status-history";

/** The Graph Servers Perspective is the sole editor for the private RDF
 * registry. The public FCT cards below remain a read-only view of the query.
 * XState grants the write capability, not a local 'logged in' boolean. */
export function GraphServerManager({ canMutate, onRegistryChange, selectedCardUri = "", onSelectCard,
  selectedEndpointId = "", configuredEndpoints = [], statuses = {}, queryXml = "", canReadHistory = false }: {
  canMutate: boolean; onRegistryChange?: () => void; selectedCardUri?: string;
  onSelectCard?: (uri: string) => void; selectedEndpointId?: string;
  configuredEndpoints?: readonly EndpointOption[]; statuses?: Record<string, EndpointStatus>;
  queryXml?: string; canReadHistory?: boolean;
}) {
  const [items, setItems] = useState<PersonalGraphServer[]>([]);
  const [filter, setFilter] = useState<"all" | "personal">("all");
  const [dialog, setDialog] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [personal, setPersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!canMutate) { setItems([]); return; }
    try { const entries = await listPersonalGraphServers(signal); if (!signal?.aborted) setItems(entries); }
    catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Cannot read graph-server registrations"); }
  }, [canMutate]);
  useEffect(() => {
    if (!canMutate) { setItems([]); setDialog(false); return; }
    const controller = new AbortController();
    const changed = () => void refresh(controller.signal);
    changed();
    window.addEventListener(PERSONAL_SERVERS_CHANGED, changed);
    return () => { controller.abort(); window.removeEventListener(PERSONAL_SERVERS_CHANGED, changed); };
  }, [canMutate, refresh]);
  const save = async () => {
    if (!canMutate || !validGraphServerUrl(url) || !label.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await addPersonalGraphServer({ url, label, description, personal });
      setDialog(false); setUrl(""); setLabel(""); setDescription(""); setPersonal(false);
      await refresh(); onRegistryChange?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not register graph server"); }
    finally { setBusy(false); }
  };
  const remove = async (entry: PersonalGraphServer) => {
    if (!canMutate || busy || !window.confirm(`Remove the registration for ${entry.label}? The remote server and its RDF graphs will not be deleted.`)) return;
    setBusy(true); setError("");
    try { await deletePersonalGraphServer(entry.uri); await refresh(); onRegistryChange?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove registration"); }
    finally { setBusy(false); }
  };
  const visible = filter === "personal" ? items.filter(entry => entry.isPersonal) : items;
  return <section className="shrink-0 border-b bg-background px-4 py-3" aria-label="Manage graph servers">
    <header className="flex flex-wrap items-center gap-2">
      <Server className="size-4 text-muted-foreground" aria-hidden="true"/>
      <strong className="text-sm">Graph server directory</strong>
      {canMutate && <>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">Show
          <MaestroSelect className="rounded-md border bg-background px-2 py-1" aria-label="Filter graph-server registrations" value={filter}
            onChange={event => setFilter(event.currentTarget.value as "all" | "personal")}>
            <option value="all">All registered servers</option>
            <option value="personal">Personal Servers</option>
          </MaestroSelect>
        </label>
        <Button size="icon-sm" variant="outline" aria-label="Refresh graph-server registrations" onClick={() => void refresh()} disabled={busy}><RefreshCw className="size-4"/></Button>
        <Button size="icon-sm" variant="outline" aria-label="Add graph server" title="Add graph server" onClick={() => setDialog(true)} disabled={busy}><DatabasePlus className="size-4"/></Button>
      </>}
    </header>
    {canMutate ? <>
      <p className="mt-1 text-xs text-muted-foreground">Registrations stored in your authenticated personal graph. Public FCT results below are read-only.</p>
      {visible.length > 0 && <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(entry => {
          const endpoint = configuredEndpoints.find(item => item.url === entry.url);
          const current = Boolean(endpoint && endpoint.id === selectedEndpointId);
          const status = endpoint ? statuses[endpoint.id] : undefined;
          const state = !status ? "Unknown" : status.status === 200 && status.state === "ok"
            ? "Healthy" : status.state === "degraded" || status.state === "probe-error" ? "Degraded" : "Unreachable";
          const tone = state === "Healthy" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
            : state === "Degraded" ? "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200"
            : state === "Unreachable" ? "bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100"
            : "bg-muted text-muted-foreground";
          const selected = selectedCardUri === entry.url;
          return <article key={entry.uri} tabIndex={0}
            role="button" aria-pressed={selected} aria-label={`Select ${entry.label} status history`}
            onClick={event => { if ((event.target as HTMLElement).closest("a,button,input")) return; onSelectCard?.(entry.url); }}
            onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectCard?.(entry.url); } }}
            className={`min-w-0 cursor-pointer rounded-lg border bg-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary ring-2 ring-primary" : "hover:border-primary/60"}`}>
          {current && <div className={`mb-2 flex items-center justify-between rounded-md px-2 py-1 text-xs font-medium ${tone}`}><span>Current graph server</span><span>Selected: {state}</span></div>}
          <div className="flex min-w-0 items-start gap-2">
          <Server className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
          <div className="min-w-0 flex-1 text-xs"><strong className="block truncate text-sm" title={entry.label}>{entry.label}</strong>
            <span className="text-muted-foreground">{entry.isPersonal ? "Personal Server · schema:EntryPoint" : "Graph Server · schema:EntryPoint"}</span>
            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-primary hover:underline">{entry.url}</a>
            {entry.description && <p className="mt-1 text-muted-foreground">{entry.description}</p>}
          </div>
          <Button variant="ghost" size="icon-xs" title="Delete registration" aria-label={`Delete registration for ${entry.label}`} disabled={busy} onClick={() => void remove(entry)}><Trash2 className="size-4"/></Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{selected ? "Selected · status history" : "Select card to inspect status history"}</p>
          {selected ? <GraphServerStatusHistory endpoint={entry.url} label={entry.label} queryXml={queryXml} canRead={canReadHistory} compact/>
            : <div aria-label="Status heatmap (select card to load)" className="mt-2 flex flex-wrap gap-1 border-t pt-2" title="Select this card to load its private status history">
                {Array.from({ length: 24 }, (_, i) => <span key={i} aria-hidden="true" className="size-2.5 rounded-[2px] bg-muted"/>)}
              </div>}
        </article>})}
      </div>}
      {!visible.length && <p className="mt-2 text-xs text-muted-foreground">No registrations in this category.</p>}
    </> : <p className="mt-1 text-xs text-muted-foreground">Graph-server editing requires a ready authenticated personal store. Public server selection remains available in the appbar.</p>}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    <Dialog open={dialog && canMutate} onOpenChange={open => { if (!busy) setDialog(open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Register a graph server</DialogTitle>
          <DialogDescription>Create a schema.org EntryPoint registration in your personal RDF directory. No credentials are stored.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">SPARQL endpoint URI<Input autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.org/sparql"/></label>
          <label className="block space-y-1 text-sm">Name<Input value={label} maxLength={160} onChange={event => setLabel(event.target.value)} placeholder="My graph server"/></label>
          <label className="block space-y-1 text-sm">Description<Input value={description} maxLength={1024} onChange={event => setDescription(event.target.value)}/></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={personal} onChange={event => setPersonal(event.target.checked)} />Personal Server</label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDialog(false)} disabled={busy}>Cancel</Button>
            <Button disabled={!canMutate || busy || !validGraphServerUrl(url) || !label.trim()} onClick={() => void save()}>{busy ? "Registering…" : "Add server"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
