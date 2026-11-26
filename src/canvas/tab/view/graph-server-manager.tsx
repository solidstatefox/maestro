"use client";

import { MaestroSelect } from "@/components/ui/maestro-select";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DatabasePlus, Trash2, Server, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addPersonalGraphServer, deletePersonalGraphServer, listPersonalGraphServers, listPersonalGraphServerGroups, normalizeGraphServerGroup,
  PERSONAL_SERVERS_CHANGED, type PersonalGraphServer } from "@/lib/client-personal-graph-servers";
import { observeProxyFetch } from "@/lib/proxy-transport-observation";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { discoverProviderEndpoints } from "@/lib/provider-endpoint-recipes";
import type { EndpointCandidate } from "@/lib/client-endpoint-discovery";
import { validGraphServerUrl } from "@/lib/graph-server-directory";
import type { EndpointOption } from "@/canvas/top/appbar";
import { createMaestroViewDiscoveryController } from "@/lib/app-lifecycle/view-discovery";

/** The Graph Servers Perspective is the sole editor for the private RDF
 * registry. The public FCT cards below remain a read-only view of the query.
 * XState grants the write capability, not a local 'logged in' boolean. */
export function GraphServerManager({ canMutate, onRegistryChange,
  account = "", configuredEndpoints = [], registrationCandidate, onCandidateConsumed, discoverySource = "", discoveryRecipes = [], discoveryCancelled = false }: {
  canMutate: boolean; onRegistryChange?: () => void; account?:string;
  configuredEndpoints?: readonly EndpointOption[]; registrationCandidate?: EndpointCandidate | null; onCandidateConsumed?: () => void;
  discoverySource?:string; discoveryRecipes?:readonly string[]; discoveryCancelled?:boolean;
}) {
  const [directory] = useState(() => createMaestroViewDiscoveryController<PersonalGraphServer>());
  const directorySnapshot = useSyncExternalStore(directory.subscribe,directory.getSnapshot,directory.getSnapshot);
  const [directoryRevision,setDirectoryRevision] = useState(0);
  const directoryKey = JSON.stringify([account,directoryRevision]);
  const items = canMutate && directorySnapshot.context.key===directoryKey ? directorySnapshot.context.items : [];
  const [discovery]=useState(()=>createMaestroViewDiscoveryController<EndpointCandidate>());
  const discoverySnapshot=useSyncExternalStore(discovery.subscribe,discovery.getSnapshot,discovery.getSnapshot);
  const [discoveryRevision,setDiscoveryRevision]=useState(0);
  const [discoveredEndpoint,setDiscoveredEndpoint]=useState("");
  const discoveryScope=JSON.stringify([account,discoverySource,discoveryRecipes]);
  const discoveryKey=JSON.stringify([discoveryScope,discoveryRevision]);
  const candidates=canMutate&&!discoveryCancelled&&discoverySnapshot.context.key===discoveryKey?discoverySnapshot.context.items:[];
  const discoveryPending=discoverySnapshot.context.key===discoveryKey&&discoverySnapshot.matches("loading");
  useEffect(()=>{discovery.start();return()=>discovery.stop();},[discovery]);
  useEffect(()=>{discovery.inactive();setDiscoveredEndpoint("");},[discovery,discoveryScope,canMutate,discoveryCancelled]);
  const runDiscovery=()=>{const revision=discoveryRevision+1;setDiscoveryRevision(revision);setDiscoveredEndpoint("");discovery.discover(JSON.stringify([discoveryScope,revision]),signal=>discoverProviderEndpoints(discoverySource,discoveryRecipes,signal));};
  const [removeUri,setRemoveUri]=useState("");
  useEffect(()=>setRemoveUri(""),[account]);
  const [dialog, setDialog] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [personal, setPersonal] = useState(false);
  const [group, setGroup] = useState("");
  const [creatingGroup,setCreatingGroup]=useState(false);
  const [newGroup,setNewGroup]=useState("");
  const [storedGroups,setStoredGroups]=useState<string[]>([]);
  const groups=[...new Set(["Graph Servers","Personal Servers",...configuredEndpoints.map(item=>item.group),...items.map(item=>item.group),...storedGroups].filter((name):name is string=>Boolean(name)))].sort((a,b)=>a.localeCompare(b));
  const selectedGroup=creatingGroup?newGroup:group;
  const resetGroup=()=>{setGroup("");setCreatingGroup(false);setNewGroup("");};
  useEffect(()=>{
    if(!dialog || !canMutate)return;
    const controller=new AbortController();
    void listPersonalGraphServerGroups(controller.signal).then(rows=>{if(!controller.signal.aborted)setStoredGroups(rows);}).catch(()=>{});
    return()=>controller.abort();
  },[dialog,canMutate,account,directoryRevision]);
  useEffect(()=>{setStoredGroups([]);resetGroup();},[account]);
  const [busy, setBusy] = useState(false);
  const [verifyCandidate, setVerifyCandidate] = useState(false);
  const prepareCandidate=(candidate:EndpointCandidate)=>{
    setUrl(candidate.endpoint);setLabel(candidate.title.slice(0,160));
    setDescription([candidate.description,candidate.standards.join(", ")].filter(Boolean).join(" · ").slice(0,1024));setPersonal(false);
    resetGroup();setVerifyCandidate(true);setDialog(true);setError("");
  };
  useEffect(() => {
    if (!registrationCandidate || !canMutate) return;
    prepareCandidate(registrationCandidate);onCandidateConsumed?.();
  }, [registrationCandidate, canMutate]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {setDirectoryRevision(n=>n+1);},[]);
  useEffect(()=>{directory.start();return()=>directory.stop();},[directory]);
  useEffect(()=>{
    if(!canMutate){directory.inactive();setDialog(false);return;}
    directory.discover(directoryKey,signal=>listPersonalGraphServers(signal));
  },[directory,canMutate,directoryKey]);
  useEffect(()=>{
    const changed=()=>void refresh();
    window.addEventListener(PERSONAL_SERVERS_CHANGED,changed);
    return()=>window.removeEventListener(PERSONAL_SERVERS_CHANGED,changed);
  },[refresh]);
  const save = async () => {
    if (!canMutate || !validGraphServerUrl(url) || !label.trim() || !selectedGroup.trim() || busy) return;
    setBusy(true); setError("");
    try {
      if (verifyCandidate) {
        const response = await observeProxyFetch(`/proxy/api/fct?health=1&graphServerUrl=${encodeURIComponent(url)}`, {cache:"no-store",headers:proxyDebugHeaders("endpoint-health","GraphServerCard")});
        const result = await response.json();
        if (!response.ok || result.check?.state !== "ok" || result.check?.status !== 200) throw new Error(result.check?.diagnostic || result.error || "This data service has not been verified as a SPARQL endpoint.");
      }
      const targetGroup=normalizeGraphServerGroup(selectedGroup);
      await addPersonalGraphServer({ url, label, description, personal, group: targetGroup });
      setDialog(false); setUrl(""); setLabel(""); setDescription(""); setPersonal(false); resetGroup();
      onRegistryChange?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not register graph server"); }
    finally { setBusy(false); }
  };
  const remove = async (entry: PersonalGraphServer) => {
    if (!canMutate || busy || !window.confirm(`Remove the registration for ${entry.label}? The remote server and its RDF graphs will not be deleted.`)) return;
    setBusy(true); setError("");
    try { await deletePersonalGraphServer(entry.uri); onRegistryChange?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove registration"); }
    finally { setBusy(false); }
  };
  const removal = items.find(entry=>entry.uri===removeUri);
  return <section className="shrink-0 border-b bg-background px-4 py-3" aria-label="Manage graph servers">
    <header className="flex flex-wrap items-center gap-2">
      <Server className="size-4 text-muted-foreground" aria-hidden="true"/>
      <strong className="text-sm">Graph server directory</strong>
      {canMutate && <>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">Manage registrations
          <MaestroSelect className="rounded-md border bg-background px-2 py-1" aria-label="Select registration to remove" value={removal?removeUri:""} onChange={event=>setRemoveUri(event.currentTarget.value)}>
            <option value="">Select registered server</option>
            {items.map(entry=><option key={entry.uri} value={entry.uri}>{entry.label} · {entry.group||"Graph Servers"}</option>)}
          </MaestroSelect>
        </label>
        <Button variant="outline" size="icon-sm" title="Delete registration" aria-label="Delete selected registration" disabled={busy||!removal} onClick={()=>{if(removal)void remove(removal);}}><Trash2 className="size-4"/></Button>
        <Button size="icon-sm" variant="outline" aria-label="Refresh graph-server registrations" onClick={() => void refresh()} disabled={busy}><RefreshCw className="size-4"/></Button>
        <Button size="icon-sm" variant="outline" aria-label="Add graph server" title="Add graph server" onClick={() => { setVerifyCandidate(false); resetGroup(); setDialog(true); }} disabled={busy}><DatabasePlus className="size-4"/></Button>
      </>}
    </header>
    {canMutate&&discoveryRecipes.length>0&&<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <Button variant="outline" size="sm" disabled={discoveryPending||discoveryCancelled||!discoverySource} onClick={runDiscovery}>{discoveryPending?"Discovering…":"Discover endpoints"}</Button>
      {discoveryPending&&<Button variant="outline" size="sm" onClick={()=>discovery.cancel()}>Cancel discovery</Button>}
      {discoverySnapshot.context.key===discoveryKey&&discoverySnapshot.matches("ready")&&<><span>{candidates.length} candidates</span><MaestroSelect aria-label="Discovered endpoint" value={discoveredEndpoint} onChange={event=>setDiscoveredEndpoint(event.target.value)} className="max-w-xs rounded border bg-background px-2 py-1"><option value="">Select discovered endpoint</option>{candidates.map(candidate=><option key={candidate.endpoint} value={candidate.endpoint}>{candidate.title} · {candidate.endpoint}</option>)}</MaestroSelect><Button variant="outline" size="sm" disabled={!candidates.some(candidate=>candidate.endpoint===discoveredEndpoint)} onClick={()=>{const candidate=candidates.find(item=>item.endpoint===discoveredEndpoint);if(candidate)prepareCandidate(candidate);}}>Register</Button></>}
      {discoverySnapshot.context.key===discoveryKey&&discoverySnapshot.context.error&&<p role="alert" className="basis-full text-destructive whitespace-pre-wrap break-all">{discoverySnapshot.context.error}</p>}
    </div>}
    {!canMutate && <p className="mt-1 text-xs text-muted-foreground">Graph-server editing requires a ready authenticated personal store.</p>}
    {(error || directorySnapshot.context.error) && <p role="alert" className="mt-2 text-xs text-destructive">{error || directorySnapshot.context.error}</p>}
    <Dialog open={dialog && canMutate} onOpenChange={open => { if (!busy) setDialog(open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Register a graph server</DialogTitle>
          <DialogDescription>{verifyCandidate ? "Verify the SPARQL protocol before registering this discovered service." : "Create a schema.org EntryPoint registration in your personal RDF directory. No credentials are stored."}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">SPARQL endpoint URI<Input autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.org/sparql"/></label>
          <label className="block space-y-1 text-sm">Name<Input value={label} maxLength={160} onChange={event => setLabel(event.target.value)} placeholder="My graph server"/></label>
          <label className="block space-y-1 text-sm">Description<Input value={description} maxLength={1024} onChange={event => setDescription(event.target.value)}/></label>
          <label className="block space-y-1 text-sm">Group
            <MaestroSelect aria-label="Graph server group" className="w-full rounded-md border bg-background px-2 py-2" value={creatingGroup?"create":"group:"+group} disabled={busy}
              onChange={event=>{const value=event.currentTarget.value;setCreatingGroup(value==="create");setGroup(value.startsWith("group:")?value.slice(6):"");}}>
              <option value="group:">Choose a group</option>
              {groups.map(name=><option key={name} value={"group:"+name}>{name}</option>)}
              <option value="create">+ Create new group</option>
            </MaestroSelect>
          </label>
          {creatingGroup && <label className="block space-y-1 text-sm">New group name<Input value={newGroup} maxLength={128} disabled={busy} onChange={event=>setNewGroup(event.target.value)} placeholder="Group name"/></label>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={personal} onChange={event => setPersonal(event.target.checked)} />Personal Server</label>
          {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDialog(false)} disabled={busy}>Cancel</Button>
            <Button disabled={!canMutate || busy || !validGraphServerUrl(url) || !label.trim() || !selectedGroup.trim()} onClick={() => void save()}>{busy ? "Registering…" : "Add server"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
