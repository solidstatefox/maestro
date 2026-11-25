"use client";
import { MaestroSelect } from "@/components/ui/maestro-select";
import { ErrorDetails } from "@/components/ui/error-details";
import { describeFctSource } from "@/lib/rdf-source";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { ProviderCatalogLoadingSkeleton } from "@/canvas/workspace-skeleton";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GraphServerStatusHistory } from "@/canvas/tab/view/graph-server-status-history";
import { CodeBlock } from "@/components/ui/code-block";
import { ArrowLeft } from "lucide-react";
import { MaestroEmptyResults } from "@/components/ui/maestro-empty-results";
import type { EndpointCandidate } from "@/lib/client-endpoint-discovery";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";
type ViewChoice = { uri: string };
type GraphServerCard = { uri: string; label: string; endpoint: string; endpointId: string;
  services:string[]; standards:string[]; likelySparql:boolean; selected: boolean; health: string; healthState: string; description?:string; software?:string; rank?:string };
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
  viewRenderPhase: import("@/lib/app-lifecycle/provider-catalog").ProviderCatalogPhase;
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
  canReadGraphHistory?: boolean;
  selectedGraphCardUri?: string;
  onSelectGraphCard?: (uri: string) => void;
  onRegisterEndpoint?: (candidate:EndpointCandidate)=>void;
}
export function ViewPage({ queryXml = "", requiresBookmark = false, viewProvider, viewProviderLoading, viewProviderError, viewProviderCount, viewProviderHtml, viewDiscoveryLoading, viewDiscoveryError, selectedView, selectedViewUri = "", viewSelectionPending = false, viewRenderError, viewHtml, viewRenderPhase, onSelectEndpoint, onRefreshEndpoint, onPolicyAction, onOpenResource, onSelectProvider, onBrowse, kanbanGroupingOptions = [], kanbanGroupKey = "none", onKanbanGroupChange, onKanbanMoveCard, graphServerCards = [], canReadGraphHistory = false, selectedGraphCardUri = "", onSelectGraphCard, onRegisterEndpoint }: ViewPageProps) {
  const kanbanActive = selectedViewUri === "gttp://ggg.maestro.ui/provider/kanban" && selectedView?.uri === selectedViewUri && !viewProvider;
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
      const explicit = article.getAttribute("data-graph-uri");
      const matches = graphServerCards.filter(row => !used.has(row.uri) && (explicit ? row.uri === explicit :
        ((id && row.endpointId === id) || hrefs.includes(row.endpoint) || hrefs.includes(row.uri))));
      // Ambiguous cards must not be given the identity of the wrong server.
      if (matches.length !== 1) continue;
      const row = matches[0]; used.add(row.uri);
      article.setAttribute("data-maestro-graph-card", row.uri);
      article.setAttribute("tabindex", "0");
      article.setAttribute("aria-label", row.label);
      if (row.endpoint && !row.endpointId && onRegisterEndpoint) {
        const button=doc.createElement("button"); button.type="button";
        button.setAttribute("data-maestro-register-endpoint",row.uri);
        button.className="mx-5 mb-3 self-start rounded-md border px-2 py-1 text-xs hover:bg-muted";
        button.textContent="Verify and register"; article.appendChild(button);
      }
      const slot = doc.createElement("div"); slot.setAttribute("data-maestro-health-slot", row.uri); slot.className = "px-4 pb-3"; article.appendChild(slot);
      article.classList.add("cursor-pointer", "focus-visible:ring-2", "focus-visible:ring-ring", "hover:border-primary/60");

    }
    return doc.body.innerHTML;
  }, [viewHtml, JSON.stringify(graphServerCards.map(row => [row.uri,row.endpoint,row.endpointId,row.label])), Boolean(onRegisterEndpoint)]);
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
                      <MaestroSelect aria-label="Group Kanban cards by facet" className="rounded-md border bg-background px-2 py-1 text-sm" value={kanbanGroupKey}
                        onChange={event => onKanbanGroupChange?.(event.currentTarget.value)}>
                        {kanbanGroupingOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </MaestroSelect>
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
                    : viewRenderPhase === "waitingForResults" ? <p role="status" className="text-sm text-muted-foreground">Waiting for results…</p>
                    : viewRenderPhase === "cancelled" ? <p role="status" className="text-sm text-muted-foreground">Perspective rendering cancelled.</p>
                    : viewRenderPhase === "resolving" || viewRenderPhase === "rendering" ? <p role="status" className="text-sm text-muted-foreground"><ElapsedStatus label="Rendering perspective" category="other" clockScope="views"/></p>
                    : !viewHtml.trim() ? <MaestroEmptyResults onBrowse={onBrowse} title="No results to display" description="This Perspective returned no cards for the current page. Try the default Browse perspective."/>
                    : <PerspectiveHtmlSurface key={JSON.stringify([selectedView.uri, graphServerHtml])}
                        graphServerHtml={graphServerHtml} graphServerCards={graphServerCards}
                        selectedGraphCardUri={selectedGraphCardUri} onSelectGraphCard={onSelectGraphCard}
                        onRegisterEndpoint={onRegisterEndpoint} queryXml={queryXml} canReadGraphHistory={canReadGraphHistory}
                        onSelectEndpoint={onSelectEndpoint} onRefreshEndpoint={onRefreshEndpoint}
                        onOpenResource={onOpenResource} kanbanActive={kanbanActive} onKanbanMoveCard={onKanbanMoveCard} />}
                </div>;
}


/** One immutable XSLT markup generation, including its React-owned portals.
 * The caller keys this boundary by provider and exact decorated markup. Health
 * changes update portal props and source decorations, not the HTML lifetime.
 * Do not move portal state to ViewPage: a new page, provider, error, or cancel
 * must retire the old host and all its portals in one React reconciliation.
 */
type PerspectiveHtmlSurfaceProps = Pick<ViewPageProps,
  "onSelectGraphCard" | "onRegisterEndpoint" | "onSelectEndpoint" | "onRefreshEndpoint" |
  "onOpenResource" | "onKanbanMoveCard"> & {
  graphServerHtml: string;
  graphServerCards: GraphServerCard[];
  selectedGraphCardUri: string;
  queryXml: string;
  canReadGraphHistory: boolean;
  kanbanActive: boolean;
};
function PerspectiveHtmlSurface({ graphServerHtml, graphServerCards, selectedGraphCardUri,
  onSelectGraphCard, onRegisterEndpoint, queryXml, canReadGraphHistory,
  onSelectEndpoint, onRefreshEndpoint, onOpenResource, kanbanActive, onKanbanMoveCard }: PerspectiveHtmlSurfaceProps) {
  // React must receive the same innerHTML prop object for this entire mount.
  // A freshly allocated object on a status update can cause the host contents
  // to be assigned again, destroying the slot DOM outside React's ownership.
  const [surfaceMarkup] = useState(() => ({ __html: graphServerHtml }));
  const graphHtmlHost = useRef<HTMLDivElement | null>(null);
  const [healthSlots, setHealthSlots] = useState<HTMLElement[]>([]);
  useLayoutEffect(() => {
    const host = graphHtmlHost.current;
    if (!host) return;
    setHealthSlots(Array.from(host.querySelectorAll<HTMLElement>("[data-maestro-health-slot]")));
    // Only the immutable XSLT surface owns its source images. React owns
    // the descendants of each health slot; never replace or clear them.
    const images = Array.from(host.querySelectorAll("img"));
    for (const image of images) image.onerror = () => {
      const fallback = image.getAttribute("data-favicon-fallback");
      if (fallback && image.src !== fallback) {
        image.removeAttribute("data-favicon-fallback");
        image.src = fallback;
      } else image.hidden = true;
    };
    return () => { for (const image of images) image.onerror = null; };
  }, []);
  // Live status colors are local host decoration, never an XSLT execution key.
  useLayoutEffect(() => {
    for (const row of graphServerCards) {
      const slot = healthSlots.find(item => item.dataset.maestroHealthSlot === row.uri);
      const article = slot?.closest("article");
      if (!article) continue;
      article.classList.toggle("ring-2", selectedGraphCardUri === row.uri);
      article.classList.toggle("ring-primary", selectedGraphCardUri === row.uri);
      const status = article.querySelector<HTMLElement>('[data-graph-meta="health-text"]') ?? article.querySelector<HTMLElement>("[data-maestro-live-health]") ?? document.createElement("div");
      status.setAttribute("data-maestro-live-health", "true");
      status.className = `text-xs ${row.healthState === "green" ? "text-green-600" : row.healthState === "amber" ? "text-amber-600" : row.healthState === "red" ? "text-red-600" : "text-muted-foreground"}`;
      status.textContent = `${row.selected ? "Selected: " : ""}${row.health}`;
      if (!status.parentElement) article.insertBefore(status, slot!);
      // Remove the stale snapshot glyph; the live colored text is authoritative.
      const health = article.querySelector('[data-graph-meta="health"]');
      health?.querySelector(':scope > span:has(svg)')?.remove();
      for (const [name,value] of Object.entries({description:row.description??"",software:row.software??"",rank:row.rank?.startsWith("#")?`Site rank: ${row.rank}`:""})) {
        const node=article.querySelector<HTMLElement>(`[data-graph-meta="${name}"]`);
        if(node){node.textContent=value;node.hidden=!value;}
      }
    }
  }, [graphServerCards, healthSlots, selectedGraphCardUri]);
  // A ref survives the native drag lifecycle synchronously; React state updates
  // may not have committed by the first dragover event.
  const kanbanDragged = useRef<{uri: string; from: string} | null>(null);
  return <>
    <div className="maestro-discovered-view w-full min-h-0 flex-1"
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
                        const register = target.closest<HTMLButtonElement>("button[data-maestro-register-endpoint]");
                        if(register){
                          const row=graphServerCards.find(card=>card.uri===register.dataset.maestroRegisterEndpoint && card.endpoint && !card.endpointId);
                          if(row && onRegisterEndpoint)onRegisterEndpoint({endpoint:row.endpoint,title:row.label,services:row.services,standards:row.standards,likelySparql:row.likelySparql,description:row.description});
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
                      }} ref={graphHtmlHost} dangerouslySetInnerHTML={surfaceMarkup}/>
                  {healthSlots.map(slot => {
                    const row = graphServerCards.find(card => card.uri === slot.dataset.maestroHealthSlot);
                    return row?.endpoint ? createPortal(<GraphServerStatusHistory endpoint={row.endpoint} label={row.label} queryXml={queryXml} canRead={canReadGraphHistory} compact/>,slot,row.uri) : null;
                  })}
  </>;
}
