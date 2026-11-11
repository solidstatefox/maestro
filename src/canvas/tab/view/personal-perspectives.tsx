"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Trash2, RefreshCw } from "lucide-react";
import { renderDiscoveredViewXslt } from "@/lib/discovered-view-xslt";
import { toLabel } from "@/lib/uri-labels";

type Provider = { kind: "bookmarks" | "history"; label: string; template: string };
type Entry = { uri: string; label: string; created: string; description: string; url: string; queryXml: string;
  tags?: string[]; tagPredicates?: string[]; lastResultCount?: number | null; lastNewCount?: number | null };
type Collection = { provider: Provider & { stylesheet: string }; rows: Entry[] };

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
  const signal = Array.from(root.getElementsByTagName("state")).map(node => node.textContent?.trim() || node.getAttribute("iri") || "").filter(Boolean).join(", ");
  return { depth: String(depth), avgSiblings, rootClasses, searchText, signal };
}

/** SHACL provider discovery drives this collection UI. Actions are interpreted by React, not XSLT. */
export function PersonalPerspectives({ active, kind, providerUri }: { active: boolean; kind: "bookmarks" | "history"; providerUri: string }) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  useEffect(() => {
    if (!active || !kind) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setNotLoggedIn(false); setCollection(null); setHtml(""); setSelected([]);
    void (async () => {
      try {
        const response = await fetch("/proxy/api/perspectives", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", kind, providerUri }), cache: "no-store", signal: controller.signal });
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
  const filtered = useMemo(() => (collection?.rows ?? []).filter(row => [row.label, row.description, row.url, row.created, ...(row.tags ?? []), row.queryXml].some(v => v.toLowerCase().includes(search.toLowerCase().trim()))), [collection, search]);
  const visible = useMemo(() => filtered.slice(0, 500), [filtered]);
  useEffect(() => {
    if (!collection) return;
    let current = true;
    void renderDiscoveredViewXslt(collection.provider.stylesheet, visible.map(row => ({
      uri: row.uri, label: row.label, created: row.created, description: row.description, url: row.url, selected: selected.includes(row.uri),
      tags: (row.tags ?? []).join(", "), ...queryStats(row.queryXml),
      lastResultCount: row.lastResultCount == null ? "" : String(row.lastResultCount),
      lastNewCount: row.lastNewCount == null ? "" : String(row.lastNewCount),
    }))).then(markup => { if (current) setHtml(markup); }).catch(err => { if (current) setError(err instanceof Error ? err.message : "Rendering failed"); });
    return () => { current = false; };
  }, [collection, visible, selected]);
  const remove = useCallback(async (ids: string[]) => {
    if (!kind || !ids.length || !window.confirm(`Delete ${ids.length} ${kind === "history" ? "history" : "bookmark"} entr${ids.length === 1 ? "y" : "ies"}?`)) return;
    setLoading(true);
    try {
      const response = await fetch("/proxy/api/perspectives/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ids }), cache: "no-store" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Delete failed");
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
  if (!active) return null;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-2">
      <div className="relative ml-auto min-w-40 flex-1 sm:max-w-xs"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground"/><input aria-label="Search saved entries" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search history or bookmarks" className="w-full rounded-md border bg-background py-2 pl-8 pr-2 text-sm" /></div>
      <button type="button" aria-label="Reload perspective" title="Reload" onClick={() => setRevision(v => v + 1)} className="rounded-md p-2 hover:bg-accent"><RefreshCw className="size-4"/></button>
      {selected.length > 0 && <button type="button" onClick={() => void remove(selected)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"><Trash2 className="size-3.5"/>Delete selected ({selected.length})</button>}
    </div>
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
    {notLoggedIn ? <p className="p-5 text-sm text-muted-foreground">Log in to your personal graph server to view History and Bookmarks.</p>
      : loading ? <p className="p-5 text-sm text-muted-foreground">Loading {kind}…</p>
      : !collection ? <p className="p-5 text-sm text-muted-foreground">No perspective data loaded.</p>
      : <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        <p className="mb-1 text-xs text-muted-foreground">{filtered.length} entries{filtered.length === 500 ? " (first 500)" : ""}</p>
        <div className="maestro-discovered-view" onClick={event => {
          const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-perspective-id]");
          if (!button) return;
          const id = button.dataset.perspectiveId ?? "";
          if (!collection?.rows.some(row => row.uri === id)) return;
          if (button.dataset.perspectiveOpen === "true") open(id);
          else if (button.dataset.perspectiveDelete === "true") void remove([id]);
          else if (button.dataset.perspectiveSelect === "true") setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
        }} dangerouslySetInnerHTML={{ __html: html }}/>
      </div>}
  </div>;
}
