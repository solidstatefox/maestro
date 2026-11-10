"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import type { MouseEvent } from "react";
import { Network } from "lucide-react";
import type { FeatureKind } from "@/lib/feature-view-xslt";
type ViewChoice = { uri: string };
export interface ViewPageProps {
  viewFeature: FeatureKind | null;
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
}
export function ViewPage({ viewFeature, viewFeatureLoading, viewFeatureError, viewFeatureCount, viewFeatureHtml, viewDiscoveryLoading, viewDiscoveryError, selectedView, viewRenderError, viewHtml, onSelectEndpoint, onRefreshEndpoint }: ViewPageProps) {
  return <div className="min-h-0 flex-1 overflow-auto p-4">
                  {viewFeature ? (viewFeatureLoading ? <p className="text-sm text-muted-foreground"><ElapsedStatus label={`Locating ${viewFeature}`} category="policies" clockScope="views" /></p>
                    : viewFeatureError ? <p role="alert" className="text-sm text-destructive">{viewFeatureError}</p>
                    : viewFeatureCount === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No applicable {viewFeature} found for the current query context.</p>
                    : <div className="maestro-discovered-view" dangerouslySetInnerHTML={{ __html: viewFeatureHtml }}/>)
                    : viewDiscoveryLoading ? <p className="text-sm text-muted-foreground"><ElapsedStatus label="Locating views" category="policies" clockScope="views" /></p>
                    : viewDiscoveryError ? <p role="alert" className="text-sm text-destructive">{viewDiscoveryError}</p>
                    : !selectedView ? <div className="mx-auto max-w-lg rounded-lg border border-dashed p-8 text-center">
                        <Network className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true"/>
                        <h3 className="font-medium">No views found</h3>
                        <p className="mt-2 text-sm text-muted-foreground">No views match the classes at this breadcrumb scope.</p>
                      </div>
                    : viewRenderError ? <p role="alert" className="text-sm text-destructive">{viewRenderError}</p>
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

