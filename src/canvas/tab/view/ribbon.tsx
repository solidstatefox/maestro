"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { useEffect, useMemo, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { MaestroHoverExpand } from "@/components/ui/maestro-hover-expand";
import { Server, Database, Globe, LayoutGrid, Network, ShieldCheck, FileCode2, ArrowLeftRight, Landmark, Blocks, Bookmark, History } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { useMapProviderDefinition } from "@/lib/map-provider-discovery";
import type { FeatureKind } from "@/lib/feature-view-xslt";
import { PERSONAL_PERSPECTIVE_URI, personalPerspectiveFromUri, type PersonalPerspectiveKind } from "@/lib/personal-perspective-ids";
const availableProviderIcons = new Set<string>(iconNames);
type ViewDefinition = { uri: string; label: string; icon?: string; stylesheet: string };
export interface ViewRibbonProps {
  viewPanel: "trail" | "perspectives" | "features";
  setViewPanel: Dispatch<SetStateAction<"trail" | "perspectives" | "features">>;
  breadcrumbs: ReactNode;
  discoveredViews: ViewDefinition[];
  viewFeature: FeatureKind | null;
  setViewFeature: Dispatch<SetStateAction<FeatureKind | null>>;
  onSelectFeature: (feature: FeatureKind | null) => void;
  selectedViewUri: string;
  onSelectView: (uri: string) => void;
  viewDiscoveryLoading: boolean;
  queryClassUris: string[];
  queryXml: string;
  triggerUri: string;
  historyUri?: string;
}
export function ViewRibbon({ viewPanel, setViewPanel, breadcrumbs, discoveredViews, viewFeature, setViewFeature, onSelectFeature, selectedViewUri, onSelectView, viewDiscoveryLoading, queryClassUris, queryXml, triggerUri, historyUri }: ViewRibbonProps) {
  const mapProvider = useMapProviderDefinition(viewPanel === "perspectives", queryXml);
  const [personalProviders, setPersonalProviders] = useState<{ kind: PersonalPerspectiveKind; label: string; uri: string }[]>([]);
  const [personalDiscoveryPending, setPersonalDiscoveryPending] = useState(false);
  const classKey = useMemo(() => [...new Set(queryClassUris)].sort().join("\n"), [queryClassUris]);
  useEffect(() => {
    const controller = new AbortController();
    // Keep the last confirmed buttons while a new ASK/discovery is pending.
    // Clearing on every query mutation makes Bookmarks/History flicker.
    if (!classKey) {
      setPersonalDiscoveryPending(false);
      // Avoid a one-frame disappearance while Configure is resetting, but
      // clear buttons if this genuinely is a class-free query.
      const clear = window.setTimeout(() => {
        if (!controller.signal.aborted) setPersonalProviders([]);
      }, 400);
      return () => { controller.abort(); window.clearTimeout(clear); };
    }
    setPersonalDiscoveryPending(true);
    void fetch("/proxy/api/service?service=maestro&operationId=perspectives", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "discover", classes: classKey.split("\n"), queryXml, trigger: triggerUri, historyUri }),
      cache: "no-store", signal: controller.signal,
    }).then(async response => {
      if (!response.ok) return;
      const data = await response.json() as { providers?: { kind: string; label: string; uri: string }[] };
      if (!controller.signal.aborted) {
        setPersonalProviders((data.providers ?? []).filter((provider): provider is { kind: PersonalPerspectiveKind; label: string; uri: string } => (provider.kind === "bookmarks" || provider.kind === "history") && /^(?:https?:|gttp:|gttps:|urn:)/.test(provider.uri)));
      }
    }).catch(() => { /* Keep last confirmed buttons if discovery fails. */ })
      .finally(() => { if (!controller.signal.aborted) setPersonalDiscoveryPending(false); });
    return () => controller.abort();
  }, [classKey, queryXml, triggerUri, historyUri]);
  // On an explicit accordion change, activate the first actual button.
  // Do not run this on mount: a URL-restored provider selection has priority.
  const firstPerspectiveUri = discoveredViews[0]?.uri ?? mapProvider?.uri ?? personalProviders[0]?.uri ?? "";
  const onRibbonPanelChange = (panel: "trail" | "perspectives" | "features") => {
    if (panel === viewPanel) return;
    setViewPanel(panel);
    if (panel === "features") onSelectFeature("policies");
    if (panel === "perspectives") {
      onSelectView(firstPerspectiveUri);
    }
  };
  // When discovery finishes after the user opened an empty Perspectives ribbon,
  // fill its previously unselected button; never overwrite a restored URI.
  useEffect(() => {
    if (viewPanel === "perspectives" && !selectedViewUri && firstPerspectiveUri) onSelectView(firstPerspectiveUri);
  }, [viewPanel, selectedViewUri, firstPerspectiveUri, onSelectView]);
  // A URL-restored selection is authoritative. Provider discovery may be
  // briefly empty while the class tree and login finish loading; do not
  // overwrite the saved perspective or ribbon selection during that window.
  // A saved Map selection must survive initial Configure discovery. An empty
  // geospatial property list during startup is not a deliberate user pivot.
  return <MaestroHoverExpand active={viewPanel} onChange={onRibbonPanelChange} panels={[
          { id: "trail", label: "Trail", content: <nav aria-label="Navigation breadcrumbs" className="flex w-max flex-nowrap items-start gap-2">
            {breadcrumbs}
          </nav> },
          { id: "perspectives", label: "Perspectives", content: <div className="flex h-full flex-wrap items-center gap-1" role="toolbar" aria-label="View perspectives">
            {discoveredViews.map((view) => {
              const active = !viewFeature && selectedViewUri === view.uri;
              // The formatter's stylesheet declares its own display icon. Prefer
              // that over a SHACL policy icon, with a generic fallback.
              const xsltIcon = view.stylesheet.match(/data-view-icon\s*=\s*["']([^"']+)["']/i)?.[1];
              const icon = xsltIcon || view.icon;
              const Icon = icon === "server" ? Server : icon === "database" ? Database : icon === "globe" ? Globe : icon === "layout-grid" ? LayoutGrid : Network;
              const title = view.stylesheet.match(/data-view-title\s*=\s*["']([^"']+)["']/i)?.[1] || view.label;
              return <button type="button" key={view.uri} aria-pressed={active}
                onClick={() => onSelectView(view.uri)}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="size-7" strokeWidth={1} aria-hidden="true" />{title}
              </button>;
            })}
            {mapProvider && <button type="button" aria-pressed={!viewFeature && selectedViewUri === mapProvider.uri}
              onClick={() => onSelectView(mapProvider.uri)}
              className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${!viewFeature && selectedViewUri === mapProvider.uri ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
              <DynamicIcon name={(availableProviderIcons.has(mapProvider.icon) ? mapProvider.icon : "layout-grid") as IconName} className="size-7" strokeWidth={1} aria-hidden="true" />{mapProvider.label}
            </button>}
            {personalProviders.filter(provider => !discoveredViews.some(view => view.uri === provider.uri) && provider.uri !== mapProvider?.uri).map(provider => {
              const uri = provider.uri;
              const active = selectedViewUri === uri;
              const Icon = provider.kind === "bookmarks" ? Bookmark : History;
              return <button type="button" key={uri} aria-pressed={active}
                onClick={() => onSelectView(uri)}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="size-7" strokeWidth={1} aria-hidden="true" />{provider.label}
              </button>;
            })}
            {personalDiscoveryPending && <span className="px-3 text-xs text-muted-foreground"><ElapsedStatus label="Locating personal perspectives" category="policies" clockScope="views" /></span>}
            {viewDiscoveryLoading && <span className="px-3 text-xs text-muted-foreground"><ElapsedStatus label="Locating views" category="policies" clockScope="views" /></span>}
            {!viewDiscoveryLoading && !personalDiscoveryPending && !discoveredViews.length && !personalProviders.length && !mapProvider && <span className="px-3 text-xs text-muted-foreground">No perspectives found</span>}
          </div> },
          { id: "features", label: "Features", content: <div className="flex h-full flex-wrap items-center gap-1" role="toolbar" aria-label="View features">
            {([
              { id: "policies", label: "Policies", Icon: ShieldCheck },
              { id: "formats", label: "Formats", Icon: FileCode2 },
              { id: "facet-widgets", label: "Facets", Icon: LayoutGrid },
              { id: "transcoders", label: "Transcoders", Icon: ArrowLeftRight },
              { id: "curators", label: "Curators", Icon: Landmark },
            ] as const).map(({ id, label, Icon }) => {
              const active = viewFeature === id;
              return <button type="button" key={id}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                aria-pressed={active} onClick={() => onSelectFeature(id)}>
                <Icon className="size-7" strokeWidth={1} aria-hidden="true" />{label}
              </button>;
            })}
            <button type="button" disabled title="Services catalog is planned"
              className="flex min-w-24 cursor-not-allowed flex-col items-center gap-1 rounded-md px-3 py-2 text-xs text-muted-foreground opacity-40">
              <Blocks className="size-7" strokeWidth={1} aria-hidden="true" />Services
            </button>
          </div> },
        ]}/>;
}
