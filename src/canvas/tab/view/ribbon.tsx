"use client";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import { MaestroHoverExpand } from "@/components/ui/maestro-hover-expand";
import { Server, Database, Globe, LayoutGrid, Network, ShieldCheck, FileCode2, ArrowLeftRight, Blocks } from "lucide-react";
import type { FeatureKind } from "@/lib/feature-view-xslt";
type ViewDefinition = { uri: string; label: string; icon?: string; stylesheet: string };
export interface ViewRibbonProps {
  viewPanel: "trail" | "perspectives" | "features";
  setViewPanel: Dispatch<SetStateAction<"trail" | "perspectives" | "features">>;
  breadcrumbs: ReactNode;
  discoveredViews: ViewDefinition[];
  viewFeature: FeatureKind | null;
  setViewFeature: Dispatch<SetStateAction<FeatureKind | null>>;
  selectedViewUri: string;
  onSelectView: (uri: string) => void;
  viewDiscoveryLoading: boolean;
}
export function ViewRibbon({ viewPanel, setViewPanel, breadcrumbs, discoveredViews, viewFeature, setViewFeature, selectedViewUri, onSelectView, viewDiscoveryLoading }: ViewRibbonProps) {
  return <MaestroHoverExpand active={viewPanel} onChange={setViewPanel} panels={[
          { id: "trail", label: "Trail", content: <nav aria-label="Navigation breadcrumbs" className="flex flex-wrap items-start gap-2">
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
                <Icon className={`size-7 ${active ? "stroke-[2.5]" : ""}`} aria-hidden="true" />{title}
              </button>;
            })}
            {viewDiscoveryLoading && <span className="px-3 text-xs text-muted-foreground">Locating views…</span>}
            {!viewDiscoveryLoading && !discoveredViews.length && <span className="px-3 text-xs text-muted-foreground">No perspectives found</span>}
          </div> },
          { id: "features", label: "Features", content: <div className="flex h-full flex-wrap items-center gap-1" role="toolbar" aria-label="View features">
            {([
              { id: "policies", label: "Policies", Icon: ShieldCheck },
              { id: "formats", label: "Formats", Icon: FileCode2 },
              { id: "transcoders", label: "Transcoders", Icon: ArrowLeftRight },
            ] as const).map(({ id, label, Icon }) => {
              const active = viewFeature === id;
              return <button type="button" key={id}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                aria-pressed={active} onClick={() => setViewFeature((current) => current === id ? null : id)}>
                <Icon className={`size-7 ${active ? "stroke-[2.5]" : ""}`} aria-hidden="true" />{label}
              </button>;
            })}
            <button type="button" disabled title="Services catalog is planned"
              className="flex min-w-24 cursor-not-allowed flex-col items-center gap-1 rounded-md px-3 py-2 text-xs text-muted-foreground opacity-40">
              <Blocks className="size-7" aria-hidden="true" />Services
            </button>
          </div> },
        ]}/>;
}
