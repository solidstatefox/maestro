"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { createMaestroPerspectiveSelectionController } from "@/lib/app-lifecycle/perspective-selection";
import { pendingApprovalController, selectPendingApprovalBadge } from "@/lib/app-lifecycle/pending-approvals";
import { MaestroHoverExpand } from "@/components/ui/maestro-hover-expand";
import { Server, Database, Globe, LayoutGrid, Kanban, Filter, Network, ShieldCheck, FileCode2, ArrowLeftRight, Landmark, Blocks, Bookmark, History, Route, Regex, Telescope, ChartNoAxesCombined } from "lucide-react";
import type { ProviderKind } from "@/lib/provider-catalog-xslt";
import { discoverMatchedClientPerspectives } from "@/lib/client-personal-perspectives";
import { personalPerspectiveFromUri, type PersonalPerspectiveKind } from "@/lib/personal-perspective-ids";
type ViewDefinition = { uri: string; label: string; icon?: string; stylesheet: string };
export interface ViewRibbonProps {
  viewPanel: "trail" | "perspectives" | "providers";
  setViewPanel: Dispatch<SetStateAction<"trail" | "perspectives" | "providers">>;
  breadcrumbs: ReactNode;
  discoveredViews: ViewDefinition[];
  viewProvider: ProviderKind | null;
  setViewProvider: Dispatch<SetStateAction<ProviderKind | null>>;
  onSelectProvider: (providerKind: ProviderKind | null) => void;
  onFeaturesEntered: () => void;
  selectedViewUri: string;
  onSelectView: (uri: string) => void;
  viewDiscoveryLoading: boolean;
  queryClassUris: string[];
  queryMatchedProviders?: string[];
  queryXml: string;
  triggerUri: string;
  historyUri?: string;
}
export function ViewRibbon({ viewPanel, setViewPanel, breadcrumbs, discoveredViews, viewProvider, setViewProvider, onSelectProvider, onFeaturesEntered, selectedViewUri, onSelectView, viewDiscoveryLoading, queryClassUris, queryMatchedProviders = [], queryXml, triggerUri, historyUri }: ViewRibbonProps) {
  const approvalSnapshot = useSyncExternalStore(pendingApprovalController.subscribe,
    pendingApprovalController.getSnapshot,pendingApprovalController.getSnapshot);
  const pendingByProvider = selectPendingApprovalBadge(approvalSnapshot).providersByKind;
  // Discovery results belong to their exact FCT/History scope. A provider
  // approved for the previous query must not be offered for a different query
  // while its own SHACL validation is pending.
  const [personalDiscovery, setPersonalDiscovery] = useState<{
    key: string; providers: { kind: PersonalPerspectiveKind; label: string; uri: string }[];
  }>({ key: "", providers: [] });
  const [personalDiscoveryPending, setPersonalDiscoveryPending] = useState(false);
  const [personalDiscoveryError, setPersonalDiscoveryError] = useState("");
  const classKey = useMemo(() => [...new Set(queryClassUris)].sort().join("\n"), [queryClassUris]);
  // The query-context machine has already validated contextual SHACL targets
  // for this exact History visit. Use that existing result, including when
  // the query has no root class. No timers or extra population probes.
  const contextualKey = useMemo(() => [...new Set(queryMatchedProviders)].sort().join("\n"), [queryMatchedProviders]);
  const discoveryKey = [queryXml, triggerUri, historyUri ?? "", classKey, contextualKey].join("\u0000");
  const personalProviders = personalDiscovery.key === discoveryKey ? personalDiscovery.providers : [];
  useEffect(() => {
    const controller = new AbortController();
    if (!classKey && !contextualKey) {
      setPersonalDiscoveryPending(false);
      return () => controller.abort();
    }
    setPersonalDiscoveryPending(true);
    void discoverMatchedClientPerspectives(classKey ? classKey.split("\n") : [],
      queryXml, triggerUri, historyUri, controller.signal,
      contextualKey ? contextualKey.split("\n") : [])
      .then(providers => {
        if (!controller.signal.aborted) { setPersonalDiscovery({ key: discoveryKey, providers }); setPersonalDiscoveryError(""); }
      })
      .catch(error => {
        // Preserve the selection across transient discovery errors but retain
        // the original cause for browser diagnostics rather than dropping it.
        if (!controller.signal.aborted) setPersonalDiscoveryError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!controller.signal.aborted) setPersonalDiscoveryPending(false); });
    return () => controller.abort();
  }, [classKey, contextualKey, queryXml, triggerUri, historyUri, discoveryKey]);
  // While contextual validation is still resolving, show only the retained
  // explicit selection, not providers discovered for an unrelated query.
  // Even if an asynchronous SHACL refresh temporarily omits the selected
  // Personal provider, its ribbon selection remains visible and owned by the
  // user's explicit selection/share URL. Eligibility is a separate concern.
  const personalToRender = [...personalProviders];
  const retainedPersonalKind = personalPerspectiveFromUri(selectedViewUri);
  if (retainedPersonalKind && !personalToRender.some(item => item.uri === selectedViewUri)) {
    personalToRender.push({ uri: selectedViewUri, kind: retainedPersonalKind,
      label: retainedPersonalKind === "bookmarks" ? "Bookmarks" : "History" });
  }
  const firstAvailableUri = discoveredViews[0]?.uri ?? personalProviders[0]?.uri ?? "";
  const [selectionController] = useState(createMaestroPerspectiveSelectionController);
  const selectionSnapshot = useSyncExternalStore(selectionController.subscribe,
    selectionController.getSnapshot, selectionController.getSnapshot);
  const onSelectRef = useRef(onSelectView);
  onSelectRef.current = onSelectView;
  useEffect(() => { selectionController.start(); return () => selectionController.stop(); }, [selectionController]);
  // A different authoritative FCT query re-arms initial selection; late
  // provider validation for the previous query must never own this transition.
  useEffect(() => { selectionController.send({ type: "QUERY_CHANGED" }); }, [selectionController, queryXml]);
  useEffect(() => {
    selectionController.send({ type: "RIBBON_OBSERVED", panel: viewPanel,
      loading: viewDiscoveryLoading || personalDiscoveryPending,
      firstUri: firstAvailableUri, selectedUri: selectedViewUri });
  }, [selectionController, viewPanel, viewDiscoveryLoading, personalDiscoveryPending, firstAvailableUri, selectedViewUri]);
  useEffect(() => {
    if (!selectionSnapshot.matches("proposed") || selectedViewUri || viewPanel !== "perspectives" ||
      viewDiscoveryLoading || personalDiscoveryPending) return;
    const uri = selectionSnapshot.context.proposedUri;
    if (!uri || uri !== firstAvailableUri) return;
    selectionController.send({ type: "AUTO_APPLIED", uri });
    onSelectRef.current(uri);
  }, [selectionController, selectionSnapshot, selectedViewUri, viewPanel, viewDiscoveryLoading, personalDiscoveryPending, firstAvailableUri]);
  // On an explicit accordion change, activate the first actual button.
  // Do not run this on mount: a URL-restored provider selection has priority.
  const onRibbonPanelChange = (panel: "trail" | "perspectives" | "providers") => {
    if (panel === viewPanel) return;
    setViewPanel(panel);
    if (panel === "providers") {
      onFeaturesEntered();
      onSelectProvider("policies");
    }
  };
  // Discovery is observational. Selecting a ribbon item belongs only to an
  // explicit user action or the URL restoration transaction. In particular,
  // a delayed generic result cannot override a personal Bookmarks perspective.
  // A URL-restored selection is authoritative. Provider discovery may be
  // briefly empty while the class tree and login finish loading; do not
  // overwrite the saved perspective or ribbon selection during that window.
  // A saved provider selection must survive incomplete discovery on startup.
  return <MaestroHoverExpand active={viewPanel} onChange={(panel) => {
    if (panel === "trail" || panel === "perspectives" || panel === "providers") onRibbonPanelChange(panel);
  }} panels={[
          { id: "trail", label: "Trail", content: <nav aria-label="Navigation breadcrumbs" className="flex w-max min-w-full flex-nowrap items-start gap-2">
            {breadcrumbs}
          </nav> },
          { id: "perspectives", label: "Perspectives", content: <div className="flex h-full flex-wrap items-center gap-1" role="toolbar" aria-label="View perspectives">
            {discoveredViews.map((view) => {
              const active = !viewProvider && selectedViewUri === view.uri;
              // The formatter's stylesheet declares its own display icon. Prefer
              // that over a SHACL policy icon, with a generic fallback.
              const xsltIcon = view.stylesheet.match(/data-view-icon\s*=\s*["']([^"']+)["']/i)?.[1];
              const icon = xsltIcon || view.icon;
              const Icon = icon === "server" ? Server : icon === "database" ? Database : icon === "globe" ? Globe : icon === "kanban" ? Kanban : icon === "layout-grid" ? LayoutGrid : Network;
              const title = view.stylesheet.match(/data-view-title\s*=\s*["']([^"']+)["']/i)?.[1] || view.label;
              return <button type="button" key={view.uri} aria-pressed={active}
                onClick={() => onSelectView(view.uri)}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="size-7" strokeWidth={1} aria-hidden="true" />{title}
              </button>;
            })}
            {personalToRender.filter(provider => !discoveredViews.some(view => view.uri === provider.uri)).map(provider => {
              const uri = provider.uri;
              const active = !viewProvider && selectedViewUri === uri;
              const Icon = provider.kind === "bookmarks" ? Bookmark : History;
              return <button type="button" key={uri} aria-pressed={active}
                onClick={() => onSelectView(uri)}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="size-7" strokeWidth={1} aria-hidden="true" />{provider.label}
              </button>;
            })}
            {personalDiscoveryError && <ErrorDetails prefix="Personal perspective discovery" error={personalDiscoveryError} />}
            {(personalDiscoveryPending || viewDiscoveryLoading) && <span className="px-3 text-xs text-muted-foreground"><ElapsedStatus label="Locating perspectives" category="policies" clockScope="views" /></span>}
          </div> },
          { id: "providers", label: "Providers", content: <div className="flex h-full flex-wrap items-center gap-1" role="toolbar" aria-label="View providers">
            {([
              { id: "policies", label: "Policies", Icon: ShieldCheck },
              { id: "formats", label: "Formats", Icon: FileCode2 },
              { id: "facet-widgets", label: "Facets", Icon: Filter },
              { id: "transcoders", label: "Transcoders", Icon: ArrowLeftRight },
              { id: "curators", label: "Curators", Icon: Landmark },
              { id: "kinds", label: "Kinds", Icon: Regex },
              { id: "perspectives", label: "Perspectives", Icon: Telescope },
              { id: "analysis-providers", label: "Analysis", Icon: ChartNoAxesCombined },
              { id: "fsm-providers", label: "FSM Providers", Icon: Route },
            ] as const).map(({ id, label, Icon }) => {
              const active = viewProvider === id;
              return <button type="button" key={id}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                aria-pressed={active} onClick={() => onSelectProvider(id)}>
                <Icon className="size-7" strokeWidth={1} aria-hidden="true" />
                <span className="inline-flex items-center gap-1">{label}{pendingByProvider[id]>0 &&
                  <span className="inline-flex min-w-5 justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-5 text-destructive-foreground tabular-nums"
                    aria-label={`${pendingByProvider[id]} pending approvals`}>{pendingByProvider[id]}</span>}</span>
              </button>;
            })}
            <button type="button" disabled title="Services catalog is planned"
              className="flex min-w-24 cursor-not-allowed flex-col items-center gap-1 rounded-md px-3 py-2 text-xs text-muted-foreground opacity-40">
              <Blocks className="size-7" strokeWidth={1} aria-hidden="true" />Services
            </button>
          </div> },
        ]}/>;
}
