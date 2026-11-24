"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { PerspectiveCalendarHeatmap } from "@/canvas/tab/view/perspective-calendar-heatmap";
import { MaestroEmptyResults } from "@/components/ui/maestro-empty-results";
import { ErrorDetails } from "@/components/ui/error-details";

import { manageAppbarButtons } from "@/lib/client-appbar-buttons";
import { loadPerspectiveCollection } from "@/lib/client-perspective-collections";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Trash2, RefreshCw, Pin, PinOff, Play, ChevronLeft, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { renderDiscoveredViewXslt } from "@/lib/discovered-view-xslt";
import { toLabel } from "@/lib/uri-labels";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { readFctResponse } from "@/canvas/utils/fct-response";
import { deletePerspectiveEntries } from "@/lib/perspective-delete";
import { snapshotFctQueryXml } from "@/lib/fct-query-api";
import { parseFctQueryXml } from "@/canvas/utils/query-controller";
import { bookmarkAtCurrentHost } from "@/lib/bookmark-host-handoff";

/** Browser Fetch may report an AbortSignal cancellation as a TypeError rather
 * than DOMException AbortError (notably when AbortSignal.any is canceled without
 * an explicit reason). Cancellation is not a Perspective/server failure. */
function isPerspectiveCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" ||
    /^signal is aborted without reason$/i.test(error.message) ||
    /^(?:the operation was aborted|this operation was aborted|fetch was aborted)$/i.test(error.message);
}

const validAppbarIcons = new Set<string>(iconNames);
type Provider = { kind: "bookmarks" | "history"; label: string; template: string };
type Entry = { uri: string; label: string; created: string; description: string; url: string; queryXml: string;
  tags?: string[]; tagPredicates?: string[]; lastResultCount?: number | null; lastNewCount?: number | null };
type AppbarButton = { uri: string; action: string; icon: string; tooltip: string; url: string };
type Collection = { provider: Provider & { stylesheet: string }; rows: Entry[] };
type IconSlot = { element: HTMLElement; icon: IconName };
type PinSlot = { element: HTMLElement; id: string; pinned: boolean };
type ActionSlot = { element: HTMLElement; id: string; action: "select" | "delete"; selected: boolean };
type BookmarkActionSlot = { element: HTMLElement; id: string; pinned: boolean; pinEnabled: boolean };
const PERSPECTIVE_PAGE_SIZES = [10, 20, 50, 100] as const;

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
export function PersonalPerspectives({ active, kind, providerUri, queryXml, onBrowse, onOpenShareUrl }: { active: boolean; kind: "bookmarks" | "history"; providerUri: string; queryXml: string; onBrowse: () => void; onOpenShareUrl: (url: string) => boolean }) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(20);
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const onCalendarFilter = useCallback((date: string | null) => { setCalendarDay(date); setPage(0); }, []);
  const [selected, setSelected] = useState<string[]>([]);
  const [html, setHtml] = useState("");
  const [renderedSignature, setRenderedSignature] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const loadedProviderIdentity = useRef("");
  const [appbarButtons, setAppbarButtons] = useState<AppbarButton[]>([]);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [iconSlots, setIconSlots] = useState<IconSlot[]>([]);
  const [pinSlots, setPinSlots] = useState<PinSlot[]>([]);
  const [actionSlots, setActionSlots] = useState<ActionSlot[]>([]);
  const [bookmarkActionSlots, setBookmarkActionSlots] = useState<BookmarkActionSlot[]>([]);
  const [matchingResources, setMatchingResources] = useState<{ scope: string; ids: Set<string> } | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const scopedQuery = useMemo(() => typeof DOMParser === "undefined" ? null : rootResourceQuery(queryXml), [queryXml]);
  useEffect(() => {
    const controller = new AbortController();
    // Scope results are associated with their exact FCT XML; never display a
    // prior scope as if it were validated for the new query. Retain the old
    // result until the new result arrives to avoid needless re-projections.
    if (!active || !scopedQuery) { setScopeLoading(false); return () => controller.abort(); }
    // A prior scope's error is not evidence that this FCT scope failed.
    setError("");
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
          // Global query navigation can abort an otherwise current Perspective
          // request without aborting this component's own signal. Retry once
          // through the SAME FCT transport; never retry a genuine HTTP error.
          const run = () => cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: { "Content-Type": "text/xml; charset=utf-8", "X-Maestro-Query-Label": `PerspectiveScope:${kind}` },
            body: new XMLSerializer().serializeToString(doc),
          });
          let response: Response;
          try { response = await run(); }
          catch (cause) {
            if (!isPerspectiveCancellation(cause, controller.signal) || controller.signal.aborted) throw cause;
            // Yield to the navigation transaction so its query pipeline can
            // resume before the retry. A second cancellation is handled below.
            await new Promise<void>(resolve => setTimeout(resolve, 100));
            if (controller.signal.aborted) return;
            response = await run();
          }
          if (!response.ok) throw new Error(`Perspective scope query returned HTTP ${response.status}`);
          const data = await readFctResponse(response);
          if (data.error) throw new Error(String(data.error));
          if (controller.signal.aborted) return;
          for (const columns of data.rows) if (columns[0]?.value) ids.add(columns[0].value);
          if (data.rows.length < 500) break;
          if (offset === 4500) throw new Error("The current query has more than 5000 matching resources. Narrow the query to filter this perspective precisely.");
        }
        if (!controller.signal.aborted) setMatchingResources({ scope: scopedQuery, ids });
      } catch (cause) {
        if (!isPerspectiveCancellation(cause, controller.signal))
          setError(cause instanceof Error ? cause.message : "Could not apply current query to perspective");
      } finally { if (!controller.signal.aborted) setScopeLoading(false); }
    })();
    return () => controller.abort();
  }, [active, scopedQuery, kind]);
  const [appbarCandidate, setAppbarCandidate] = useState("");
  const [appbarTooltip, setAppbarTooltip] = useState("");
  const [appbarIcon, setAppbarIcon] = useState("bookmark");
  const [appbarBusy, setAppbarBusy] = useState(false);
  const loadAppbar = useCallback(async () => {
    const result = await manageAppbarButtons({ action: "list" });
    setAppbarButtons(result.buttons ?? []);
  }, []);
  useEffect(() => { if (kind === "bookmarks" && active) void loadAppbar().catch(err => setError(err instanceof Error ? err.message : "Could not load appbar")); },[active,kind,loadAppbar]);
  const editAppbar = useCallback(async (action:"add"|"remove", bookmark:string, provider?:string) => {
    setAppbarBusy(true);
    try {
      if (action === "add") {
        if (!validAppbarIcons.has(appbarIcon.trim())) throw new Error("Choose a valid Lucide icon name, e.g. bookmark or map-pin.");
      }
      const result = await manageAppbarButtons({action,bookmark,provider,tooltip:appbarTooltip,icon:appbarIcon});
      setAppbarButtons(result.buttons ?? []); setAppbarCandidate("");
      window.dispatchEvent(new Event("maestro:appbar-buttons-updated"));
    } catch(err) { setError(err instanceof Error ? err.message : "Appbar update failed"); }
    finally { setAppbarBusy(false); }
  },[appbarTooltip,appbarIcon]);
  useEffect(() => {
    if (!active || !kind) return;
    const controller = new AbortController();
    // A same-provider refresh should not erase a previously loaded collection
    // before the replacement arrives. That produced blank Bookmarks/History
    // cards during provider validation/reentry. Never retain results when
    // switching to a different provider identity.
    const identity = `${kind}\u0000${providerUri}`;
    if (loadedProviderIdentity.current !== identity) {
      loadedProviderIdentity.current = identity;
      setCollection(null); setHtml(""); setSelected([]); setPage(0);
    }
    setLoading(true); setError(""); setNotLoggedIn(false);
    void (async () => {
      try {
        const data = await loadPerspectiveCollection(kind, providerUri, controller.signal);
        if (!controller.signal.aborted) setCollection(data);
      } catch (err) {
        if (!isPerspectiveCancellation(err, controller.signal)) {
          const message = err instanceof Error ? err.message : "Loading failed";
          if (message.startsWith("Log in to use the personal graph server.")) {
            setNotLoggedIn(true);
            setCollection(null); setHtml("");
          }
          else setError(message);
        }
      }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [active, kind, providerUri, revision]);
  const scopeIsReady = !scopedQuery || matchingResources?.scope === scopedQuery;
  const filtered = useMemo(() => [...(collection?.rows ?? [])]
    .filter(row => !scopedQuery || (matchingResources?.scope === scopedQuery && matchingResources.ids.has(row.uri)))
    .sort((a,b) => Number(Boolean(bookmarkShortcut(b, appbarButtons, collection?.rows ?? []))) - Number(Boolean(bookmarkShortcut(a, appbarButtons, collection?.rows ?? []))))
    .filter(row => (!calendarDay || row.created.slice(0,10) === calendarDay) && [row.label, row.description, row.url, row.created, ...(row.tags ?? []), row.queryXml].some(v => v.toLowerCase().includes(search.toLowerCase().trim()))),
    [collection, search, calendarDay, appbarButtons, scopedQuery, matchingResources]);
  // Both approved mui:Providers render one page at a time from the *complete*
  // retrieved collection. Paging happens after FCT scope and search filtering.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(0, page), totalPages - 1);
  const visible = useMemo(() => filtered.slice(currentPage * pageSize,
    (currentPage + 1) * pageSize), [filtered, currentPage, pageSize]);
  // A previously rendered XSLT collection must never be shown under a new
  // FCT scope or search. Rendering is async and can complete after a ribbon
  // or query change; identify the *source* of the markup, not its React node.
  const contentSignature = useMemo(() => JSON.stringify([
    kind, providerUri, scopedQuery, visible.map(row => row.uri), selected,
    appbarButtons.map(button => [button.uri, button.action, button.icon]),
  ]), [kind, providerUri, scopedQuery, visible, selected, appbarButtons]);
  useEffect(() => {
    if (!collection || !scopeIsReady) return;
    let current = true;
    void renderDiscoveredViewXslt(collection.provider.stylesheet, visible.map(row => ({
      appbarIcon: kind === "bookmarks" ? bookmarkShortcut(row, appbarButtons, collection.rows)?.icon : undefined,
      uri: row.uri, label: row.label, created: row.created, description: row.description, url: row.url, selected: selected.includes(row.uri),
      appbarAdded: Boolean(bookmarkShortcut(row, appbarButtons, collection.rows)),
      appbarAvailable: kind === "bookmarks" && (appbarButtons.length < 5 || Boolean(bookmarkShortcut(row, appbarButtons, collection.rows))),
      tags: (row.tags ?? []).join(", "), ...queryStats(row.queryXml),
      lastResultCount: row.lastResultCount == null ? "" : String(row.lastResultCount),
      lastNewCount: row.lastNewCount == null ? "" : String(row.lastNewCount),
    }))).then(markup => {
      if (!current) return;
      setHtml(markup);
      setRenderedSignature(contentSignature);
    }).catch(err => { if (current) setError(err instanceof Error ? err.message : "Rendering failed"); });
    return () => { current = false; };
  }, [collection, visible, selected, appbarButtons, kind, contentSignature, scopeIsReady]);
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
      if (!(["http:", "https:"].includes(target.protocol) && target.origin !== origin && (target.searchParams.has("q") || Boolean(row.queryXml)))) continue;
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
    // Older personally stored XSLT may have separate pin/delete slots. Adapt
    // those inert DOM placeholders to the new single action group in-place;
    // no reseeding, new SPARQL query, or destructive migration is required.
    if (kind === "bookmarks") {
      for (const article of resultsRef.current?.querySelectorAll<HTMLElement>("article") ?? []) {
        if (article.querySelector("[data-perspective-bookmark-actions-slot]")) continue;
        const legacyDelete = article.querySelector<HTMLElement>("[data-perspective-action-slot='delete']");
        if (!legacyDelete) continue;
        const id = legacyDelete.dataset.perspectiveId ?? "";
        if (!collection?.rows.some(row => row.uri === id)) continue;
        const mount = document.createElement("span");
        mount.className = "inline-flex shrink-0 self-start";
        mount.dataset.perspectiveBookmarkActionsSlot = "true";
        mount.dataset.perspectiveId = id;
        const legacyPin = article.querySelector<HTMLElement>("[data-perspective-pin-slot]");
        legacyPin?.remove();
        legacyDelete.replaceWith(mount);
      }
    }
    const slots = Array.from(resultsRef.current?.querySelectorAll<HTMLElement>("[data-perspective-appbar-icon]") ?? [])
      .map(element => ({ element, icon: element.dataset.perspectiveAppbarIcon ?? "" }))
      .filter((item): item is IconSlot => validAppbarIcons.has(item.icon));
    setBookmarkActionSlots(Array.from(resultsRef.current?.querySelectorAll<HTMLElement>("[data-perspective-bookmark-actions-slot='true'][data-perspective-id]") ?? []).flatMap(element => {
      const id = element.dataset.perspectiveId ?? "";
      const row = collection?.rows.find(entry => entry.uri === id);
      if (!row || kind !== "bookmarks") return [];
      const pinned = Boolean(bookmarkShortcut(row, appbarButtons, collection!.rows));
      return [{ element, id, pinned, pinEnabled: pinned || appbarButtons.length < 5 }];
    }));
    setIconSlots(slots);
    const matching = resultsRef.current?.querySelectorAll<HTMLElement>("[data-perspective-pin-slot='true'][data-perspective-pin-id]") ?? [];
    setPinSlots(Array.from(matching).flatMap(element => {
      const id = element.dataset.perspectivePinId ?? "";
      const row = collection?.rows.find(row => row.uri === id);
      return row ? [{ element, id, pinned: Boolean(bookmarkShortcut(row, appbarButtons, collection!.rows)) }] : [];
    }));
    // XSLT controls where the buttons sit; React owns trusted icon, tooltip,
    // and action behavior. Validate every inert slot against loaded records.
    const actions = resultsRef.current?.querySelectorAll<HTMLElement>("span[data-perspective-action-slot][data-perspective-id]") ?? [];
    setActionSlots(Array.from(actions).flatMap(element => {
      const id = element.dataset.perspectiveId ?? "";
      const action = element.dataset.perspectiveActionSlot;
      if ((action !== "select" && action !== "delete") || !collection?.rows.some(row => row.uri === id)) return [];
      return [{ element, id, action, selected: selected.includes(id) }];
    }));
  }, [html, renderedSignature, contentSignature, scopeIsReady, active, collection, appbarButtons, selected]);
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
        if (onOpenShareUrl(url.href)) return;
        setError("The saved link could not be restored as a Maestro query. Verify its FCT q and addr.");
        return;
      }
    } catch { /* A legacy entry may have no valid saved URL. */ }
    setError("This entry has no usable Maestro share URL. Open it through the existing History/Bookmarks navigation.");
  }, [collection, onOpenShareUrl]);
  const tryAtThisHost = useCallback((id: string) => {
    const row = collection?.rows.find(entry => entry.uri === id);
    if (!row?.url) return;
    const rewritten = bookmarkAtCurrentHost(row.url, window.location.href, row.queryXml,
      xml => Boolean(xml.trim() && parseFctQueryXml(xml)));
    if (!rewritten) {
      setError("The saved Bookmark has neither a valid URL query nor valid saved FCT XML.");
      return;
    }
    if (!onOpenShareUrl(rewritten)) {
      setError("The saved query cannot be restored at this host; check the FCT addr and graph server.");
    }
  }, [collection, onOpenShareUrl]);
  if (!active) return null;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b px-2 py-2" aria-label={`${kind} search and pagination`}>
      <div className="relative min-w-0 flex-1"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground"/><input aria-label="Search saved entries" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder={`Search ${kind}`} className="w-full min-w-0 rounded-md border bg-background py-2 pl-8 pr-2 text-sm" /></div>
      <Tooltip><TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Reload perspective" onClick={() => setRevision(v => v + 1)}><RefreshCw className="size-4"/></Button>} /><TooltipContent>Reload {kind}</TooltipContent></Tooltip>
      {selected.length > 0 && <Tooltip><TooltipTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={`Delete ${selected.length} selected entries`} onClick={() => void remove(selected)} className="shrink-0 text-destructive hover:bg-destructive/10"><Trash2 className="size-4"/></Button>} /><TooltipContent>Delete selected ({selected.length})</TooltipContent></Tooltip>}
      <nav aria-label={`${kind} pagination`} className="ml-auto flex shrink-0 items-center gap-1 border-l pl-2">
        <label htmlFor={`${kind}-perspective-page-size`} className="whitespace-nowrap text-xs text-muted-foreground">Per page</label>
        <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(0); }}>
          <SelectTrigger id={`${kind}-perspective-page-size`} aria-label={`${kind} entries per page`} className="h-9 w-auto shrink-0 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{PERSPECTIVE_PAGE_SIZES.map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon-sm" aria-label="Previous page" disabled={currentPage === 0 || !scopeIsReady || loading} onClick={() => setPage(Math.max(0, currentPage - 1))}><ChevronLeft className="size-4" aria-hidden="true"/></Button>
        <span className="min-w-[5.5rem] whitespace-nowrap text-center text-xs text-muted-foreground" aria-live="polite">Page {currentPage + 1} of {totalPages}</span>
        <Button type="button" variant="outline" size="icon-sm" aria-label="Next page" disabled={currentPage >= totalPages - 1 || !scopeIsReady || loading} onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}><ChevronRight className="size-4" aria-hidden="true"/></Button>
      </nav>
    </div>
    {error && <ErrorDetails prefix="Perspective" error={error} className="mx-4 my-2" />}
    {notLoggedIn ? <p className="p-5 text-sm text-muted-foreground">Log in to your personal graph server to view History and Bookmarks.</p>
      : loading && !collection ? <p className="p-5 text-sm text-muted-foreground">Loading {kind}…</p>
      : !collection ? <MaestroEmptyResults onBrowse={onBrowse} title="No perspective data" description="No saved entries were loaded. Try the default Browse perspective."/>
      : <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1" aria-busy={loading || scopeLoading}>
        <PerspectiveCalendarHeatmap rows={collection.rows} queryXml={queryXml} onDayFilter={onCalendarFilter} />
        <p className="mb-1 text-xs text-muted-foreground">{!scopeIsReady ? (scopeLoading ? "Filtering by current query…" : "Current query scope unavailable") : `${filtered.length} matching entries · ${filtered.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)}` : "0"} shown`}</p>
        {!scopeIsReady && <p role="status" className="mt-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">{scopeLoading ? "Checking saved entries against the current FCT query…" : "Cannot establish which saved entries match this query. See the error above and retry."}</p>}
        {scopeIsReady && !scopeLoading && filtered.length === 0 && <MaestroEmptyResults onBrowse={onBrowse} title={`No ${kind} entries found`} description="No saved entries match this query. Try the default Browse perspective."/>}
        <div ref={resultsRef} aria-busy={!scopeIsReady || renderedSignature !== contentSignature} className="maestro-discovered-view" onClick={event => {
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
            const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
            if (anchor && anchor.target !== "_blank" && !anchor.hasAttribute("download")) {
              try {
                const url = new URL(anchor.href, window.location.origin);
                if (url.origin === window.location.origin && url.searchParams.has("q")) {
                  event.preventDefault();
                  if (!onOpenShareUrl(url.href)) setError("The saved link could not be restored as a Maestro query.");
                  return;
                }
              } catch { /* An invalid external anchor follows native handling. */ }
            }
          }
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
        }} dangerouslySetInnerHTML={{ __html: scopeIsReady && renderedSignature === contentSignature ? html : "" }}/>
        {bookmarkActionSlots.map(slot => createPortal(
          <ButtonGroup aria-label="Bookmark actions" className="shrink-0 self-start">
            <Tooltip><TooltipTrigger render={<Button type="button" variant="outline" size="icon-sm"
              aria-label={slot.pinned ? "Unpin from appbar" : "Pin to appbar"}
              disabled={!slot.pinEnabled}
              onClick={event => {
                event.stopPropagation();
                const entry = collection?.rows.find(row => row.uri === slot.id);
                if (!entry || !collection) return;
                const shortcut = bookmarkShortcut(entry, appbarButtons, collection.rows);
                if (shortcut) void editAppbar("remove", slot.id, shortcut.uri);
                else if (appbarButtons.length < 5) {
                  setAppbarCandidate(slot.id); setAppbarTooltip(entry.label); setAppbarIcon("bookmark");
                }
              }}
              className="size-7 text-muted-foreground hover:text-foreground">
              {slot.pinned ? <PinOff className="size-4" aria-hidden="true"/> : <Pin className="size-4" aria-hidden="true"/>}
            </Button>} /><TooltipContent>{slot.pinned ? "Unpin from appbar" : "Pin to appbar"}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button type="button" variant="outline" size="icon-sm"
              aria-label="Delete bookmark"
              onClick={event => { event.stopPropagation(); void remove([slot.id]); }}
              className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="size-4" aria-hidden="true"/>
            </Button>} /><TooltipContent>Delete bookmark</TooltipContent></Tooltip>
          </ButtonGroup>,
          slot.element,
        ))}
        {actionSlots.map(slot => createPortal(
          <Tooltip><TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm"
            data-perspective-id={slot.id}
            {...(slot.action === "select" ? { "data-perspective-select": "true" } : { "data-perspective-delete": "true" })}
            aria-pressed={slot.action === "select" ? slot.selected : undefined}
            aria-label={slot.action === "select" ? (slot.selected ? "Deselect entry" : "Select entry") : "Delete entry"}
            onClick={event => {
              // Portals bubble through the React owner tree, not necessarily
              // the injected results container. Dispatch the validated action
              // here instead of relying on its delegated native-button handler.
              event.stopPropagation();
              if (slot.action === "select") setSelected(current => current.includes(slot.id)
                ? current.filter(id => id !== slot.id) : [...current, slot.id]);
              else void remove([slot.id]);
            }}
            className={`size-7 shrink-0 self-start ${slot.action === "delete" ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive" : "text-muted-foreground hover:text-foreground"}`}>
            {slot.action === "select" ? <Play className="size-4" aria-hidden="true"/> : <Trash2 className="size-4" aria-hidden="true"/>}
          </Button>} /><TooltipContent>{slot.action === "select" ? (slot.selected ? "Deselect entry" : "Select entry") : "Delete entry"}</TooltipContent></Tooltip>,
          slot.element,
        ))}
        {pinSlots.map(slot => createPortal(
          <Tooltip><TooltipTrigger render={<Button type="button" variant="outline" size="icon-sm"
            data-perspective-id={slot.id} data-perspective-appbar="true"
            aria-label={slot.pinned ? "Unpin from appbar" : "Pin to appbar"}
            className="size-7 text-muted-foreground hover:text-foreground">
            {slot.pinned ? <PinOff className="size-4" aria-hidden="true"/> : <Pin className="size-4" aria-hidden="true"/>}
          </Button>} /><TooltipContent>{slot.pinned ? "Unpin from appbar" : "Pin to appbar"}</TooltipContent></Tooltip>,
          slot.element,
        ))}
        {iconSlots.map(slot => createPortal(
          <DynamicIcon name={slot.icon} className="size-4 text-muted-foreground" aria-hidden="true" />,
          slot.element,
        ))}
      </div>}
    <Dialog open={Boolean(appbarCandidate)} onOpenChange={open => {if (!open && !appbarBusy) setAppbarCandidate("");}}>
      <DialogContent><DialogHeader><DialogTitle>Pin bookmark to appbar</DialogTitle><DialogDescription>Choose the button tooltip and Lucide icon name. Maximum five bookmark buttons.</DialogDescription></DialogHeader>
        <label className="block text-sm">Tooltip<Input value={appbarTooltip} maxLength={120} onChange={e=>setAppbarTooltip(e.target.value)}/></label>
        <label className="block text-sm">Lucide icon name<Input value={appbarIcon} placeholder="bookmark" onChange={e=>setAppbarIcon(e.target.value)}/></label>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setAppbarCandidate("")} disabled={appbarBusy}>Cancel</Button><Tooltip><TooltipTrigger render={<Button aria-label="Pin to appbar" size="icon" disabled={appbarBusy || !appbarTooltip.trim() || !validAppbarIcons.has(appbarIcon.trim())} onClick={()=>void editAppbar("add",appbarCandidate)}><Pin className="size-4" aria-hidden="true"/></Button>} /><TooltipContent>Pin to appbar</TooltipContent></Tooltip></div>
      </DialogContent>
    </Dialog>
  </div>;
}
