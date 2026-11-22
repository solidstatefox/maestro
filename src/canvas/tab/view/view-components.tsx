"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { describeFctSource } from "@/lib/rdf-source";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { ProviderCatalogLoadingSkeleton } from "@/canvas/workspace-skeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { ArrowLeft } from "lucide-react";
import { MaestroEmptyResults } from "@/components/ui/maestro-empty-results";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";
type ViewChoice = { uri: string };
type GraphServerCard = { uri: string; label: string; endpoint: string; endpointId: string;
  selected: boolean; health: string; healthState: string };
const BOOKMARK_APPROVAL_MESSAGE = "Bookmark this query to manage {kind} approvals. Use the highlighted Bookmark button in the appbar.";
const PROVIDER_APPROVAL_LABEL: Record<ProviderKind, string> = {
  policies: "policy", formats: "format", "facet-widgets": "facet", transcoders: "transcoder", curators: "curator", "fsm-providers": "FSM provider", kinds: "Kinds provider", perspectives: "perspective provider", "analysis-providers": "Analysis provider",
};
export interface ViewPageProps {
  viewProvider: ProviderKind | null;
  requiresBookmark?: boolean;
  queryXml?: string;
  viewProviderLoading: boolean;
  viewProviderError: string;
  viewProviderCount: number;
  viewProviderHtml: string;
  viewDiscoveryLoading: boolean;
  viewDiscoveryError: string;
  selectedView: ViewChoice | undefined;
  selectedViewUri?: string;
  viewSelectionPending?: boolean;
  viewRenderError: string;
  viewHtml: string;
  viewResultCount: number;
  kanbanGroupingOptions?: { key: string; label: string }[];
  kanbanGroupKey?: string;
  onKanbanGroupChange?: (key: string) => void;
  onKanbanMoveCard?: (uri: string, from: string, to: string, beforeUri?: string) => void;
  onSelectEndpoint: (id: string) => void;
  onRefreshEndpoint: (id: string) => void;
  onPolicyAction?: (uri: string, action: "toggle" | "forget" | "bookmark", approved: boolean) => void;
  onOpenResource?: (uri: string) => void;
  onSelectProvider?: (uri: string, selected: boolean) => void;
  onBrowse: () => void;
  graphServerCards?: GraphServerCard[];
  selectedGraphCardUri?: string;
  onSelectGraphCard?: (uri: string) => void;
}
export function ViewPage({ queryXml = "", requiresBookmark = false, viewProvider, viewProviderLoading, viewProviderError, viewProviderCount, viewProviderHtml, viewDiscoveryLoading, viewDiscoveryError, selectedView, selectedViewUri = "", viewSelectionPending = false, viewRenderError, viewHtml, viewResultCount, onSelectEndpoint, onRefreshEndpoint, onPolicyAction, onOpenResource, onSelectProvider, onBrowse, kanbanGroupingOptions = [], kanbanGroupKey = "none", onKanbanGroupChange, onKanbanMoveCard, graphServerCards = [], selectedGraphCardUri = "", onSelectGraphCard }: ViewPageProps) {
  const kanbanActive = selectedView?.uri === "gttp://ggg.maestro.ui/provider/kanban" && !viewProvider;
  // The XSLT still owns cards. Decorate its *sanitized* HTML with trusted,
  // page-bounded selection metadata so native React can implement a toggle
  // without mutating FCT or selecting a different execution server.
  const graphServerHtml = useMemo(() => {
    if (!graphServerCards.length || !viewHtml || typeof DOMParser === "undefined") return viewHtml;
    const doc = new DOMParser().parseFromString(viewHtml, "text/html");
    const used = new Set<string>();
    for (const article of Array.from(doc.body.querySelectorAll("article"))) {
      const button = article.querySelector<HTMLButtonElement>("button[data-endpoint-select]");
      const id = button?.getAttribute("data-endpoint-select") ?? "";
      const hrefs = Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .map(anchor => anchor.getAttribute("href") ?? "");
      const matches = graphServerCards.filter(row => !used.has(row.uri) && (
        (id && row.endpointId === id) || hrefs.includes(row.endpoint) || hrefs.includes(row.uri) ||
        (row.label && article.textContent?.includes(row.label))));
      // Ambiguous cards must not be given the identity of the wrong server.
      if (matches.length !== 1) continue;
      const row = matches[0]; used.add(row.uri);
      article.setAttribute("data-maestro-graph-card", row.uri);
      article.setAttribute("tabindex", "0");
      article.setAttribute("aria-label", `${row.label} · select card for status history`);
      article.classList.add("cursor-pointer", "focus-visible:ring-2", "focus-visible:ring-ring", "hover:border-primary/60");
      if (selectedGraphCardUri === row.uri || selectedGraphCardUri === row.endpoint)
        article.classList.add("ring-2", "ring-primary", "border-primary");
      if (row.selected) {
        const header = article.querySelector("header");
        if (header) {
          header.classList.add("flex", "items-center", "justify-between", "gap-2");
          const state = row.healthState === "green" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
            : row.healthState === "amber" ? "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100"
            : row.healthState === "red" ? "bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100"
            : "bg-muted text-muted-foreground";
          header.classList.add(...state.split(" "));
          const indicator = doc.createElement("span");
          indicator.className = "ml-auto shrink-0 text-xs font-semibold";
          indicator.textContent = `Selected: ${row.health}`;
          header.appendChild(indicator);
        }
      }
    }
    return doc.body.innerHTML;
  }, [viewHtml, graphServerCards, selectedGraphCardUri]);
  // A ref survives the native drag lifecycle synchronously; React state updates
  // may not have committed by the first dragover event.
  const kanbanDragged = useRef<{uri: string; from: string} | null>(null);
  const [policyCode, setPolicyCode] = useState<{ uri: string; code: string; query: string; loading: boolean; error: string } | null>(null);
  useEffect(() => { setPolicyCode(null); }, [viewProvider, viewProviderHtml]);
  async function openPolicyCode(uri: string) {
    if (!/^([a-z][a-z0-9+.-]*):[^\s<>"{}|^`\\]+$/i.test(uri)) return;
    setPolicyCode({ uri, code: "", query: "", loading: true, error: "" });
    try {
      const { code, query } = await describeFctSource(queryXml, uri);
      setPolicyCode({ uri, code, query, loading: false, error: "" });
    } catch (error) {
      setPolicyCode({ uri, code: "", query: "", loading: false, error: error instanceof Error ? error.message : "Could not load policy source." });
    }
  }
  return <div className="flex min-h-0 w-full flex-1 flex-col overflow-auto p-4">
                  {kanbanActive && !policyCode && <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm" role="status">
                    <span><strong>Temporary board:</strong> Grouping and drag-and-drop changes are not persisted and do not update RDF or the FCT query.</span>
                    <label className="inline-flex items-center gap-2">Group cards by
                      <select aria-label="Group Kanban cards by facet" className="rounded-md border bg-background px-2 py-1 text-sm" value={kanbanGroupKey}
                        onChange={event => onKanbanGroupChange?.(event.currentTarget.value)}>
                        {kanbanGroupingOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                    </label>
                  </div>}
                  {requiresBookmark && !policyCode && <div data-policy-bookmark-banner="true" role="status" className="mb-4 rounded-md border border-amber-400/50 bg-amber-100/80 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{BOOKMARK_APPROVAL_MESSAGE.replace("{kind}", PROVIDER_APPROVAL_LABEL[viewProvider ?? "policies"])}</div>}
                  {policyCode ? <div className="flex h-full min-h-0 flex-col gap-3">
                    <button type="button" onClick={() => setPolicyCode(null)} className="inline-flex w-fit items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"><ArrowLeft className="size-4"/>Back to results</button>
                    {policyCode.loading ? <p role="status">Loading policy source…</p> : policyCode.error ? <ErrorDetails prefix="Policy source" error={policyCode.error} />
                      : <CodeBlock className="min-h-0 flex-1" code={policyCode.code} language="turtle" filename="policy.ttl" />}
                  </div> : viewProvider ? (viewProviderLoading ? <ProviderCatalogLoadingSkeleton label={viewProvider} />
                    : viewProviderError ? <ErrorDetails prefix="Provider discovery" error={viewProviderError} />
                    : viewProviderCount === 0 ? <MaestroEmptyResults onBrowse={onBrowse} title="No providers found" description={viewProvider === "kinds" ? "No Kinds providers were returned. Try the default Browse perspective, or check provider discovery and the seeded graph." : `No ${viewProvider} providers match this query context. Try the default Browse perspective.`}/>
                    : <div className="maestro-discovered-view w-full min-h-0 flex-1" onClick={(event) => {
                        const target = event.target as HTMLElement;
                        const selection = target.closest<HTMLInputElement>('input[data-provider-select]');
                        if (selection) {
                          const providerUri = selection.closest<HTMLElement>('article[data-provider-uri]')?.getAttribute('data-provider-uri') ?? '';
                          if (providerUri) onSelectProvider?.(providerUri, selection.checked);
                          return;
                        }
                        const link = target.closest<HTMLElement>("button[data-provider-open-uri]");
                        if (link) { const iri = link.getAttribute("data-provider-open-uri") || ""; if (/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri)) onOpenResource?.(iri); return; }
                        const actionNode = target.closest<HTMLElement>("[data-policy-action]");
                        const uri = (actionNode ?? target.closest<HTMLElement>("button[data-provider-code]"))?.closest<HTMLElement>("article[data-provider-uri]")?.getAttribute("data-provider-uri") ?? "";
                        if (target.closest("button[data-provider-code]") && uri) { void openPolicyCode(uri); return; }
                        if (!actionNode || !uri || !onPolicyAction) return;
                        const action = actionNode.getAttribute("data-policy-action");
                        if (action === "toggle" || action === "forget" || action === "bookmark") onPolicyAction(uri, action, actionNode instanceof HTMLInputElement ? actionNode.checked : false);
                      }} dangerouslySetInnerHTML={{ __html: viewProviderHtml }}/>)
                    : viewDiscoveryLoading && !selectedView ? null
                    : viewDiscoveryError && !selectedView ? <ErrorDetails prefix="View discovery" error={viewDiscoveryError} />
                    : !selectedView ? <MaestroEmptyResults onBrowse={onBrowse} title={selectedViewUri ? viewSelectionPending ? "Checking selected Perspective…" : "Selected Perspective unavailable" : "No perspectives available"} description={selectedViewUri ? viewSelectionPending ? "The saved selection is retained while discovery and SHACL validation complete. You can use the default Browse perspective meanwhile." : "The selected provider did not match this query context. Try the default Browse perspective." : "No Perspectives match the current query. Try the default Browse perspective."}/>
                    : viewRenderError ? <ErrorDetails prefix="View rendering" error={viewRenderError} />
                    : !viewHtml.trim() && viewResultCount > 0 ? <p role="status" className="text-sm text-muted-foreground"><ElapsedStatus label="Rendering perspective" category="other" clockScope="views"/></p>
                    : !viewHtml.trim() ? <MaestroEmptyResults onBrowse={onBrowse} title="No results to display" description="This Perspective returned no cards for the current page. Try the default Browse perspective."/>
                    : <div className="maestro-discovered-view w-full min-h-0 flex-1"
                      onDragStart={event => {
                        if (!kanbanActive) return;
                        const card = (event.target as HTMLElement).closest<HTMLElement>('article[data-kanban-card="true"]');
                        const uri = card?.getAttribute("data-kanban-uri") ?? "";
                        const from = card?.getAttribute("data-kanban-from") ?? "";
                        if (!uri || !card) return;
                        kanbanDragged.current = {uri, from};
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("application/x-maestro-kanban", uri);
                        event.dataTransfer.setData("text/plain", uri);
                      }}
                      onDragOver={event => {
                        if (kanbanActive && kanbanDragged.current && (event.target as HTMLElement).closest("section[data-kanban-column]")) {
                          event.preventDefault(); event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={event => {
                        const column = (event.target as HTMLElement).closest<HTMLElement>("section[data-kanban-column]");
                        const dragged = kanbanDragged.current;
                        if (!kanbanActive || !column || !dragged) return;
                        event.preventDefault();
                        const targetCard = (event.target as HTMLElement).closest<HTMLElement>('article[data-kanban-card="true"]');
                        const beforeUri = targetCard?.getAttribute("data-kanban-uri") ?? "";
                        onKanbanMoveCard?.(dragged.uri, dragged.from, column.getAttribute("data-kanban-column") ?? "", beforeUri);
                        kanbanDragged.current = null;
                      }}
                      onDragEnd={() => { kanbanDragged.current = null; }}
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        const resource = target.closest<HTMLButtonElement>("button[data-provider-open-uri]");
                        if (resource) {
                          const uri = resource.getAttribute("data-provider-open-uri") ?? "";
                          if (/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(uri)) onOpenResource?.(uri);
                          return;
                        }
                        const select = target.closest<HTMLButtonElement>("button[data-endpoint-select]");
                        if (select) {
                          if (select.dataset.endpointSelect) onSelectEndpoint(select.dataset.endpointSelect);
                          return;
                        }
                        const button = target.closest<HTMLButtonElement>("button[data-endpoint-refresh]");
                        if (button) {
                          if (button.dataset.endpointRefresh) onRefreshEndpoint(button.dataset.endpointRefresh);
                          return;
                        }
                        if (target.closest("a,button,input,select,textarea")) return;
                        const card = target.closest<HTMLElement>("article[data-maestro-graph-card]");
                        const uri = card?.getAttribute("data-maestro-graph-card") ?? "";
                        if (uri && graphServerCards.some(row => row.uri === uri)) onSelectGraphCard?.(uri);
                      }} onKeyDown={event => {
                        const target = event.target as HTMLElement;
                        if (target.localName !== "article" || !target.hasAttribute("data-maestro-graph-card") ||
                            (event.key !== "Enter" && event.key !== " ")) return;
                        const uri = target.getAttribute("data-maestro-graph-card") ?? "";
                        if (uri && graphServerCards.some(row => row.uri === uri)) {
                          event.preventDefault(); onSelectGraphCard?.(uri);
                        }
                      }} ref={(element) => {
                        if (!element) return;
                        // Native favicon fetching is optional; expose the XSLT's Lucide fallback when missing.
                        element.querySelectorAll("img").forEach((image) => {
                          image.onerror = () => {
                            const fallback = image.getAttribute("data-favicon-fallback");
                            if (fallback && image.src !== fallback) {
                              image.removeAttribute("data-favicon-fallback");
                              image.src = fallback;
                            } else image.hidden = true;
                          };
                        });
                      }} dangerouslySetInnerHTML={{ __html: graphServerHtml }}/>} 
                </div>;
}

