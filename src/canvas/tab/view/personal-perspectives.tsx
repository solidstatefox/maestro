"use client";
import { ErrorDetails } from "@/components/ui/error-details";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Trash2, RefreshCw } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renderDiscoveredViewXslt } from "@/lib/discovered-view-xslt";
import { toLabel } from "@/lib/uri-labels";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { readFctResponse } from "@/canvas/utils/fct-response";
import { deletePerspectiveEntries } from "@/lib/perspective-delete";
import { snapshotFctQueryXml } from "@/lib/fct-query-api";

const validAppbarIcons = new Set<string>(iconNames);
type Provider = { kind: "bookmarks" | "history"; label: string; template: string };
type Entry = { uri: string; label: string; created: string; description: string; url: string; queryXml: string;
  tags?: string[]; tagPredicates?: string[]; lastResultCount?: number | null; lastNewCount?: number | null };
type AppbarButton = { uri: string; action: string; icon: string; tooltip: string; url: string };
type Collection = { provider: Provider & { stylesheet: string }; rows: Entry[] };
type IconSlot = { element: HTMLElement; icon: IconName };

/** A shortcut points to a saved Bookmark IRI. Resolve that exact identity first.
 * For pre-existing providers whose action IRI no longer matches the returned
 * collection entry, the stored share URL can identify the entry ONLY when it
 * is unique within the collection; never guess from label or query text. */
function bookmarkShortcut(entry: Entry, buttons: AppbarButton[], rows: Entry[]): AppbarButton | undefined {
  const exact = buttons.find(button => button.action === entry.uri);
  if (exact) return exact;
  if (!entry.url || rows.filter(row => row.url === entry.url).length !== 1) return undefined;
  return buttons.find(button => button.url === entry.url && !rows.some(row => row.uri === button.action));
}


/** Structural statistics are computed from saved FCT XML, not estimated from a Results page. */
function queryStats(xml: string) {
  const empty = { depth: "0", avgSiblings: "0", searchText: "", signal: "", rootClasses: "" };
  if (!xml || typeof DOMParser === "undefined") return empty;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return empty;
  const root = doc.documentElement;
  if (root.localName !== "query") return empty;
  const children = (node: Element) => Array.from(node.children);
  const relations = (node: Element) => children(node).filter(child => child.localName === "property" || child.localName === "property-of");
  const leaf = Array.from(root.getElementsByTagName("view"))[0];
  let depth = 0;
  for (let node = leaf?.parentElement; node && node !== root; node = node.parentElement)
    if (node.localName === "property" || node.localName === "property-of") depth++;
  const scopeNodes = [root, ...Array.from(root.getElementsByTagName("property")), ...Array.from(root.getElementsByTagName("property-of"))];
  const avgSiblings = scopeNodes.length ? (scopeNodes.reduce((sum, node) => sum + relations(node).length, 0) / scopeNodes.length).toFixed(1) : "0";
  const rootClasses = children(root).filter(node => node.localName === "class").map(node => node.getAttribute("iri") ?? "").filter(Boolean).map(iri => toLabel(iri, "Class")).join(", ");
  const searchText = Array.from(root.getElementsByTagName("text")).map(node => node.textContent?.trim() ?? "").filter(Boolean).join(", ");
  const signal = Array.from(root.getElementsByTagName("status")).map(node => node.textContent?.trim() || node.getAttribute("iri") || "").filter(Boolean).join(", ");
  return { depth: String(depth), avgSiblings, rootClasses, searchText, signal };
}

/** SHACL provider discovery drives this collection UI. Actions are interpreted by React, not XSLT. */
/** Project the live constraints onto the root resource (the saved-item IRI).
 * The list's own <view> may be on a property, but bookmark/history entries
 * must be intersected against resources satisfying the whole FCT query. */
function rootResourceQuery(xml: string): string | null {
  const doc = new DOMParser().parseFromString(snapshotFctQueryXml(xml, "data"), "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "query") return null;
  const root = doc.documentElement;
  const isConstrained = Array.from(root.children).some(el => ["class", "property", "property-of", "text", "status", "value"].includes(el.localName));
  if (!isConstrained) return null;
  for (const view of Array.from(root.getElementsByTagName("*"))) if (view.localName === "view") view.remove();
  const view = doc.createElementNS(root.namespaceURI, "view");
  view.setAttribute("type", "list"); view.setAttribute("limit", "500"); view.setAttribute("offset", "0");
  root.appendChild(view);
  return new XMLSerializer().serializeToString(doc);
}
export function PersonalPerspectives({ active, kind, providerUri, queryXml }: { active: boolean; kind: "bookmarks" | "history"; providerUri: string; queryXml: string }) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [appbarButtons, setAppbarButtons] = useState<AppbarButton[]>([]);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [iconSlots, setIconSlots] = useState<IconSlot[]>([]);
  const [matchingResources, setMatchingResources] = useState<Set<string> | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const scopedQuery = useMemo(() => typeof DOMParser === "undefined" ? null : rootResourceQuery(queryXml), [queryXml]);
  useEffect(() => {
    const controller = new AbortController();
    setMatchingResources(null);
    if (!active || !scopedQuery) { setScopeLoading(false); return () => controller.abort(); }
    setScopeLoading(true);
    void (async () => {
      try {
        const ids = new Set<string>();
        // Enumerate matching root resources, not projected property values.
        // Continue through complete pages rather than filtering only page one.
        const parser = new DOMParser();
        for (let offset = 0; offset < 5000; offset += 500) {
          const doc = parser.parseFromString(scopedQuery, "application/xml");
          const view = Array.from(doc.getElementsByTagName("*" )).find(el => el.localName === "view");
          if (!view) break;
          view.setAttribute("offset", String(offset));
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: { "Content-Type": "text/xml; charset=utf-8", "X-Maestro-Query-Label": `PerspectiveScope:${kind}` },
            body: new XMLSerializer().serializeToString(doc),
          });
          if (!response.ok) throw new Error(`Perspective scope query returned HTTP ${response.status}`);
          const data = await readFctResponse(response);
          if (data.error) throw new Error(String(data.error));
          if (controller.signal.aborted) return;
          for (const columns of data.rows) if (columns[0]?.value) ids.add(columns[0].value);
          if (data.rows.length < 500) break;
          if (offset === 4500) throw new Error("The current query has more than 5000 matching resources. Narrow the query to filter this perspective precisely.");
        }
        if (!controller.signal.aborted) setMatchingResources(ids);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not apply current query to perspective");
      } finally { if (!controller.signal.aborted) setScopeLoading(false); }
    })();
    return () => controller.abort();
  }, [active, scopedQuery, kind]);
  const [appbarCandidate, setAppbarCandidate] = useState("");
  const [appbarTooltip, setAppbarTooltip] = useState("");
  const [appbarIcon, setAppbarIcon] = useState("bookmark");
  const [appbarBusy, setAppbarBusy] = useState(false);
  const loadAppbar = useCallback(async () => {
    const response = await fetch("/proxy/api/service?service=maestro&operationId=appbar-buttons", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list"}),cache:"no-store"});
    const result = await response.json() as {buttons?:AppbarButton[];error?:string};
    if (!response.ok) throw new Error(result.error ?? "Could not load appbar providers");
    setAppbarButtons(result.buttons ?? []);
  }, []);
  useEffect(() => { if (kind === "bookmarks" && active) void loadAppbar().catch(err => setError(err instanceof Error ? err.message : "Could not load appbar")); },[active,kind,loadAppbar]);
  const editAppbar = useCallback(async (action:"add"|"remove", bookmark:string, provider?:string) => {
    setAppbarBusy(true);
    try {
      if (action === "add") {
        if (!validAppbarIcons.has(appbarIcon.trim())) throw new Error("Choose a valid Lucide icon name, e.g. bookmark or map-pin.");
      }
      const response = await fetch("/proxy/api/service?service=maestro&operationId=appbar-buttons", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,bookmark,provider,tooltip:appbarTooltip,icon:appbarIcon}),cache:"no-store"});
      const result = await response.json() as {buttons?:AppbarButton[];error?:string};
      if (!response.ok) throw new Error(result.error ?? "Appbar update failed");
      setAppbarButtons(result.buttons ?? []); setAppbarCandidate("");
      window.dispatchEvent(new Event("maestro:appbar-buttons-updated"));
    } catch(err) { setError(err instanceof Error ? err.message : "Appbar update failed"); }
    finally { setAppbarBusy(false); }
  },[appbarTooltip,appbarIcon]);
  useEffect(() => {
    if (!active || !kind) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setNotLoggedIn(false); setCollection(null); setHtml(""); setSelected([]);
    void (async () => {
      try {
        const response = await fetch("/proxy/api/service?service=maestro&operationId=perspectives", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", kind, providerUri }), cache: "no-store", signal: controller.signal });
        const data = await response.json() as Collection & { error?: string };
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setNotLoggedIn(true);
          return;
        }
        if (!response.ok) throw new Error(data.error || "Could not load collection");
        if (!controller.signal.aborted) setCollection(data);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Loading failed"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [active, kind, providerUri, revision]);
  const filtered = useMemo(() => [...(collection?.rows ?? [])]
    .filter(row => !scopedQuery || (matchingResources !== null && matchingResources.has(row.uri)))
    .sort((a,b) => Number(Boolean(bookmarkShortcut(b, appbarButtons, collection?.rows ?? []))) - Number(Boolean(bookmarkShortcut(a, appbarButtons, collection?.rows ?? []))))
    .filter(row => [row.label, row.description, row.url, row.created, ...(row.tags ?? []), row.queryXml].some(v => v.toLowerCase().includes(search.toLowerCase().trim()))),
    [collection, search, appbarButtons, scopedQuery, matchingResources]);
  const visible = useMemo(() => filtered.slice(0, 500), [filtered]);
  useEffect(() => {
    if (!collection) return;
    let current = true;
    void renderDiscoveredViewXslt(collection.provider.stylesheet, visible.map(row => ({
      appbarIcon: kind === "bookmarks" ? bookmarkShortcut(row, appbarButtons, collection.rows)?.icon : undefined,
      uri: row.uri, label: row.label, created: row.created, description: row.description, url: row.url, selected: selected.includes(row.uri),
      appbarAdded: Boolean(bookmarkShortcut(row, appbarButtons, collection.rows)),
      appbarAvailable: kind === "bookmarks" && (appbarButtons.length < 5 || Boolean(bookmarkShortcut(row, appbarButtons, collection.rows))),
      tags: (row.tags ?? []).join(", "), ...queryStats(row.queryXml),
      lastResultCount: row.lastResultCount == null ? "" : String(row.lastResultCount),
      lastNewCount: row.lastNewCount == null ? "" : String(row.lastNewCount),
    }))).then(markup => { if (current) setHtml(markup); }).catch(err => { if (current) setError(err instanceof Error ? err.message : "Rendering failed"); });
    return () => { current = false; };
  }, [collection, visible, selected, appbarButtons, kind]);
  // The saved bookmark link is never silently rewritten. Offer an explicit
  // same-app navigation option only when its HTTP(S) origin differs from ours.
  // Insert into the already-sanitized XSLT card so this works with previously
  // published personal-store stylesheets without requiring an RDF reload.
  useEffect(() => {
    if (!active || kind !== "bookmarks" || !collection || !resultsRef.current) return;
    const origin = window.location.origin;
    for (const openButton of resultsRef.current.querySelectorAll<HTMLButtonElement>("button[data-perspective-open='true'][data-perspective-id]")) {
      const row = collection.rows.find(entry => entry.uri === openButton.dataset.perspectiveId);
      if (!row?.url) continue;
      let target: URL;
      try { target = new URL(row.url); } catch { continue; }
      if (!(["http:", "https:"].includes(target.protocol) && target.origin !== origin && target.searchParams.has("q"))) continue;
      const hostButton = document.createElement("button");
      hostButton.type = "button";
      hostButton.dataset.perspectiveTryHost = "true";
      hostButton.dataset.perspectiveId = row.uri;
      hostButton.textContent = "Try at this host";
      hostButton.title = `Open this saved query at ${origin} instead of ${target.origin}`;
      hostButton.className = "shrink-0 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";
      openButton.insertAdjacentElement("afterend", hostButton);
    }
  }, [active, kind, collection, html]);
  // XSLT owns the card layout; React mounts the user-selected Lucide icon into
  // its sanitized, inert placeholder. No icon markup or code comes from RDF.
  useEffect(() => {
    const slots = Array.from(resultsRef.current?.querySelectorAll<HTMLElement>("[data-perspective-appbar-icon]") ?? [])
      .map(element => ({ element, icon: element.dataset.perspectiveAppbarIcon ?? "" }))
      .filter((item): item is IconSlot => validAppbarIcons.has(item.icon));
    setIconSlots(slots);
  }, [html, active]);
  const remove = useCallback(async (ids: string[]) => {
    if (!kind || !ids.length || !window.confirm(`Delete ${ids.length} ${kind === "history" ? "history" : "bookmark"} entr${ids.length === 1 ? "y" : "ies"}?`)) return;
    setLoading(true);
    try {
      await deletePerspectiveEntries(kind, ids);
      setSelected([]); setRevision(v => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); setLoading(false); }
  }, [kind]);
  const open = useCallback((id: string) => {
    const row = collection?.rows.find(r => r.uri === id);
    if (!row) return;
    // Saved share URLs are the authoritative restoration route. Never execute RDF-supplied scripts.
    try {
      const url = new URL(row.url, window.location.origin);
      if (url.origin === window.location.origin && (url.protocol === "http:" || url.protocol === "https:")) {
        window.location.assign(url.href); return;
      }
    } catch { /* A legacy entry may have no valid saved URL. */ }
    setError("This entry has no usable Maestro share URL. Open it through the existing History/Bookmarks navigation.");
  }, [collection]);
  const tryAtThisHost = useCallback((id: string) => {
    const row = collection?.rows.find(entry => entry.uri === id);
    if (!row?.url) return;
    try {
      const saved = new URL(row.url);
      const current = new URL(window.location.href);
      if (!["http:", "https:"].includes(saved.protocol) || saved.origin === current.origin || !saved.searchParams.has("q")) return;
      // URL.origin carries the scheme, hostname and port together. All query,
      // ribbon and history parameters are preserved from the saved bookmark.
      const rewritten = new URL(saved.pathname + saved.search + saved.hash, current.origin);
      window.location.assign(rewritten.href);
    } catch {
      setError("This entry has no usable Maestro share URL.");
    }
  }, [collection]);
  if (!active) return null;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-2">
      <div className="relative ml-auto min-w-40 flex-1 sm:max-w-xs"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground"/><input aria-label="Search saved entries" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search history or bookmarks" className="w-full rounded-md border bg-background py-2 pl-8 pr-2 text-sm" /></div>
      <button type="button" aria-label="Reload perspective" title="Reload" onClick={() => setRevision(v => v + 1)} className="rounded-md p-2 hover:bg-accent"><RefreshCw className="size-4"/></button>
      {selected.length > 0 && <button type="button" onClick={() => void remove(selected)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"><Trash2 className="size-3.5"/>Delete selected ({selected.length})</button>}
    </div>
    {error && <ErrorDetails prefix="Perspective" error={error} className="mx-4 my-2" />}
    {notLoggedIn ? <p className="p-5 text-sm text-muted-foreground">Log in to your personal graph server to view History and Bookmarks.</p>
      : loading ? <p className="p-5 text-sm text-muted-foreground">Loading {kind}…</p>
      : !collection ? <p className="p-5 text-sm text-muted-foreground">No perspective data loaded.</p>
      : <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        <p className="mb-1 text-xs text-muted-foreground">{scopeLoading ? "Filtering by current query…" : `${filtered.length} matching entries`}{!scopeLoading && filtered.length === 500 ? " (first 500)" : ""}</p>
        <div ref={resultsRef} className="maestro-discovered-view" onClick={event => {
          const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-perspective-id]");
          if (!button) return;
          const id = button.dataset.perspectiveId ?? "";
          if (!collection?.rows.some(row => row.uri === id)) return;
          if (button.dataset.perspectiveAppbar === "true") {
            const entry = collection.rows.find(row => row.uri === id);
            const found = entry && bookmarkShortcut(entry, appbarButtons, collection.rows);
            if (found) void editAppbar("remove", id, found.uri);
            else if (appbarButtons.length < 5) { setAppbarCandidate(id); setAppbarTooltip(collection.rows.find(r=>r.uri===id)?.label ?? ""); setAppbarIcon("bookmark"); }
          }
          else if (button.dataset.perspectiveTryHost === "true") tryAtThisHost(id);
          else if (button.dataset.perspectiveOpen === "true") open(id);
          else if (button.dataset.perspectiveDelete === "true") void remove([id]);
          else if (button.dataset.perspectiveSelect === "true") setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
        }} dangerouslySetInnerHTML={{ __html: html }}/>
        {iconSlots.map(slot => createPortal(
          <DynamicIcon name={slot.icon} className="size-4 text-muted-foreground" aria-hidden="true" />,
          slot.element,
        ))}
      </div>}
    <Dialog open={Boolean(appbarCandidate)} onOpenChange={open => {if (!open && !appbarBusy) setAppbarCandidate("");}}>
      <DialogContent><DialogHeader><DialogTitle>Pin bookmark to appbar</DialogTitle><DialogDescription>Choose the button tooltip and Lucide icon name. Maximum three bookmark buttons.</DialogDescription></DialogHeader>
        <label className="block text-sm">Tooltip<Input value={appbarTooltip} maxLength={120} onChange={e=>setAppbarTooltip(e.target.value)}/></label>
        <label className="block text-sm">Lucide icon name<Input value={appbarIcon} placeholder="bookmark" onChange={e=>setAppbarIcon(e.target.value)}/></label>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setAppbarCandidate("")} disabled={appbarBusy}>Cancel</Button><Button disabled={appbarBusy || !appbarTooltip.trim() || !validAppbarIcons.has(appbarIcon.trim())} onClick={()=>void editAppbar("add",appbarCandidate)}>Pin to appbar</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
