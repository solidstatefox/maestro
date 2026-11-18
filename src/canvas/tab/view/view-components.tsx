"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { describeFctSource } from "@/lib/rdf-source";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { ProviderCatalogLoadingSkeleton } from "@/canvas/workspace-skeleton";
import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { ArrowLeft } from "lucide-react";
import { Network } from "lucide-react";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";
type ViewChoice = { uri: string };
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
  onSelectEndpoint: (id: string) => void;
  onRefreshEndpoint: (id: string) => void;
  onPolicyAction?: (uri: string, action: "toggle" | "forget" | "bookmark", approved: boolean) => void;
  onOpenResource?: (uri: string) => void;
  onSelectProvider?: (uri: string, selected: boolean) => void;
}
export function ViewPage({ queryXml = "", requiresBookmark = false, viewProvider, viewProviderLoading, viewProviderError, viewProviderCount, viewProviderHtml, viewDiscoveryLoading, viewDiscoveryError, selectedView, selectedViewUri = "", viewSelectionPending = false, viewRenderError, viewHtml, onSelectEndpoint, onRefreshEndpoint, onPolicyAction, onOpenResource, onSelectProvider }: ViewPageProps) {
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
  return <div className="min-h-0 flex-1 overflow-auto p-4">
                  {requiresBookmark && !policyCode && <div data-policy-bookmark-banner="true" role="status" className="mb-4 rounded-md border border-amber-400/50 bg-amber-100/80 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{BOOKMARK_APPROVAL_MESSAGE.replace("{kind}", PROVIDER_APPROVAL_LABEL[viewProvider ?? "policies"])}</div>}
                  {policyCode ? <div className="flex h-full min-h-0 flex-col gap-3">
                    <button type="button" onClick={() => setPolicyCode(null)} className="inline-flex w-fit items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"><ArrowLeft className="size-4"/>Back to results</button>
                    {policyCode.loading ? <p role="status">Loading policy source…</p> : policyCode.error ? <ErrorDetails prefix="Policy source" error={policyCode.error} />
                      : <CodeBlock className="min-h-0 flex-1" code={policyCode.code} language="turtle" filename="policy.ttl" />}
                  </div> : viewProvider ? (viewProviderLoading ? <ProviderCatalogLoadingSkeleton label={viewProvider} />
                    : viewProviderError ? <ErrorDetails prefix="Provider discovery" error={viewProviderError} />
                    : viewProviderCount === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{viewProvider === "kinds" ? "No Kinds providers returned by the selected policies graph. Check graph/kinds/provider.ttl in the seed manifest and inspect the FCT response for incompleteness." : viewProvider === "perspectives" ? "No PerspectiveWidget providers returned by the selected policies graph. Check the provider manifest and the FCT response." : `No applicable ${viewProvider} found for the current query context.`}</p>
                    : <div className="maestro-discovered-view" onClick={(event) => {
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
                    : viewDiscoveryLoading ? <p className="text-sm text-muted-foreground"><ElapsedStatus label="Locating views" category="policies" clockScope="views" /></p>
                    : viewDiscoveryError ? <ErrorDetails prefix="View discovery" error={viewDiscoveryError} />
                    : !selectedView ? <div role={selectedViewUri ? "status" : undefined} aria-busy={viewSelectionPending} className="mx-auto max-w-lg rounded-lg border border-dashed p-8 text-center">
                        <Network className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true"/>
                        <h3 className="font-medium">{selectedViewUri ? viewSelectionPending ? "Checking selected Perspective…" : "Selected Perspective unavailable" : "No views found"}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">{selectedViewUri ? viewSelectionPending
                          ? "The saved selection is retained while provider discovery and SHACL validation complete."
                          : "The selected provider was not returned for this query context. The selection has not been discarded."
                          : "No views match the classes at this breadcrumb scope."}</p>
                      </div>
                    : viewRenderError ? <ErrorDetails prefix="View rendering" error={viewRenderError} />
                    : <div className="maestro-discovered-view" onClick={(event) => {
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
                        if (!button) return;
                        if (button.dataset.endpointRefresh) onRefreshEndpoint(button.dataset.endpointRefresh);
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
                      }} dangerouslySetInnerHTML={{ __html: viewHtml }}/>} 
                </div>;
}

