"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { describeFctSource } from "@/lib/rdf-source";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { ArrowLeft } from "lucide-react";
import { Network } from "lucide-react";
import type { FeatureKind } from "@/lib/feature-view-xslt";
type ViewChoice = { uri: string };
const BOOKMARK_APPROVAL_MESSAGE = "Bookmark this query to manage {kind} approvals. Use the highlighted Bookmark button in the appbar.";
const FEATURE_APPROVAL_LABEL: Record<FeatureKind, string> = {
  policies: "policy", formats: "format", "facet-widgets": "facet", transcoders: "transcoder", curators: "curator",
};
export interface ViewPageProps {
  viewFeature: FeatureKind | null;
  requiresBookmark?: boolean;
  queryXml?: string;
  viewFeatureLoading: boolean;
  viewFeatureError: string;
  viewFeatureCount: number;
  viewFeatureHtml: string;
  viewDiscoveryLoading: boolean;
  viewDiscoveryError: string;
  selectedView: ViewChoice | undefined;
  viewRenderError: string;
  viewHtml: string;
  onSelectEndpoint: (id: string) => void;
  onRefreshEndpoint: (id: string) => void;
  onPolicyAction?: (uri: string, action: "toggle" | "forget" | "bookmark", approved: boolean) => void;
  onOpenResource?: (uri: string) => void;
  onSelectFeature?: (uri: string, selected: boolean) => void;
}
export function ViewPage({ queryXml = "", requiresBookmark = false, viewFeature, viewFeatureLoading, viewFeatureError, viewFeatureCount, viewFeatureHtml, viewDiscoveryLoading, viewDiscoveryError, selectedView, viewRenderError, viewHtml, onSelectEndpoint, onRefreshEndpoint, onPolicyAction, onOpenResource, onSelectFeature }: ViewPageProps) {
  const [policyCode, setPolicyCode] = useState<{ uri: string; code: string; query: string; loading: boolean; error: string } | null>(null);
  useEffect(() => { setPolicyCode(null); }, [viewFeature, viewFeatureHtml]);
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
                  {requiresBookmark && !policyCode && <div data-policy-bookmark-banner="true" role="status" className="mb-4 rounded-md border border-amber-400/50 bg-amber-100/80 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{BOOKMARK_APPROVAL_MESSAGE.replace("{kind}", FEATURE_APPROVAL_LABEL[viewFeature ?? "policies"])}</div>}
                  {policyCode ? <div className="flex h-full min-h-0 flex-col gap-3">
                    <button type="button" onClick={() => setPolicyCode(null)} className="inline-flex w-fit items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"><ArrowLeft className="size-4"/>Back to results</button>
                    {policyCode.loading ? <p role="status">Loading policy source…</p> : policyCode.error ? <ErrorDetails prefix="Policy source" error={policyCode.error} />
                      : <CodeBlock className="min-h-0 flex-1" code={policyCode.code} language="turtle" filename="policy.ttl" />}
                  </div> : viewFeature ? (viewFeatureLoading ? <p className="text-sm text-muted-foreground"><ElapsedStatus label={`Locating ${viewFeature}`} category="policies" clockScope="views" /></p>
                    : viewFeatureError ? <ErrorDetails prefix="Feature discovery" error={viewFeatureError} />
                    : viewFeatureCount === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No applicable {viewFeature} found for the current query context.</p>
                    : <div className="maestro-discovered-view" onClick={(event) => {
                        const target = event.target as HTMLElement;
                        const selection = target.closest<HTMLInputElement>('input[data-feature-select]');
                        if (selection) {
                          const featureUri = selection.closest<HTMLElement>('article[data-feature-uri]')?.getAttribute('data-feature-uri') ?? '';
                          if (featureUri) onSelectFeature?.(featureUri, selection.checked);
                          return;
                        }
                        const link = target.closest<HTMLElement>("button[data-feature-open-uri]");
                        if (link) { const iri = link.getAttribute("data-feature-open-uri") || ""; if (/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri)) onOpenResource?.(iri); return; }
                        const actionNode = target.closest<HTMLElement>("[data-policy-action]");
                        const uri = (actionNode ?? target.closest<HTMLElement>("button[data-feature-code]"))?.closest<HTMLElement>("article[data-feature-uri]")?.getAttribute("data-feature-uri") ?? "";
                        if (target.closest("button[data-feature-code]") && uri) { void openPolicyCode(uri); return; }
                        if (!actionNode || !uri || !onPolicyAction) return;
                        const action = actionNode.getAttribute("data-policy-action");
                        if (action === "toggle" || action === "forget" || action === "bookmark") onPolicyAction(uri, action, actionNode instanceof HTMLInputElement ? actionNode.checked : false);
                      }} dangerouslySetInnerHTML={{ __html: viewFeatureHtml }}/>)
                    : viewDiscoveryLoading ? <p className="text-sm text-muted-foreground"><ElapsedStatus label="Locating views" category="policies" clockScope="views" /></p>
                    : viewDiscoveryError ? <ErrorDetails prefix="View discovery" error={viewDiscoveryError} />
                    : !selectedView ? <div className="mx-auto max-w-lg rounded-lg border border-dashed p-8 text-center">
                        <Network className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true"/>
                        <h3 className="font-medium">No views found</h3>
                        <p className="mt-2 text-sm text-muted-foreground">No views match the classes at this breadcrumb scope.</p>
                      </div>
                    : viewRenderError ? <ErrorDetails prefix="View rendering" error={viewRenderError} />
                    : <div className="maestro-discovered-view" onClick={(event) => {
                        const target = event.target as HTMLElement;
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

