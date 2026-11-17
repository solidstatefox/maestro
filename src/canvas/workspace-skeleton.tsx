"use client";
import { ReturnToFiltersButton } from "@/canvas/left/return-to-filters";

import { Skeleton } from "@/components/ui/skeleton";
import { CONFIGURE_LIST_BACKGROUND_COLOR } from "@/canvas/left/configure";
import type { LeftSkeletonPane, LeftSkeletonWidget } from "@/lib/app-lifecycle/skeleton-boundaries";
import { LeftPaneFrame, LeftPaneBody, CenterPaneFrame, CenterPaneBody, RightPaneFrame, RightPaneBody } from "@/canvas/workspace-pane-shells";

/** Independent, accessible boundaries. Each occupies the same pane frame as
 * its real UI; the parent keeps a single resizable layout for all phases. */
function SkeletonRows({ rows }: { rows: number }) {
  return <div className="space-y-2.5">{Array.from({ length: rows }, (_, i) =>
    <div key={i} className="flex items-center gap-3">
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <Skeleton className={`h-4 ${i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-4/5" : "w-2/3"}`} />
      <Skeleton className="ml-auto h-3 w-7 shrink-0" />
    </div>)}</div>;
}

function SkeletonFacet({ title, rows }: { title: string; rows: number }) {
  return <section aria-label={`${title} loading`} className="space-y-3 py-3">
    <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{title}</span><Skeleton className="h-5 w-9" /></div>
    <SkeletonRows rows={rows} />
  </section>;
}

export function AppbarLoadingSkeleton() {
  return <header role="status" aria-busy="true" aria-label="Restoring Maestro workspace" className="flex min-h-12 shrink-0 items-center gap-3 border-b px-3">
    <Skeleton className="size-8 shrink-0 rounded-md" />
    <Skeleton className="h-7 w-32 shrink-0" />
    <Skeleton className="h-8 min-w-24 max-w-2xl flex-1" />
    <Skeleton className="h-8 w-24 shrink-0" />
    <span className="sr-only">Restoring your workspace and shared query</span>
  </header>;
}

export function RibbonLoadingSkeleton() {
  return <div role="status" aria-busy="true" aria-label="Restoring workspace navigation" className="flex min-h-12 shrink-0 items-center gap-3 border-b px-4 py-2">
    <Skeleton className="h-7 w-20" /><Skeleton className="h-7 w-24" /><Skeleton className="h-7 w-20" />
    <Skeleton className="ml-auto h-5 w-28" />
  </div>;
}

export function FacetsLoadingSkeleton({ pane, widgets, interactive, onShowFilters, onConfigureProperties, onConfigureRoles }: {
  pane: LeftSkeletonPane;
  widgets: readonly LeftSkeletonWidget[];
  interactive: boolean;
  onShowFilters: () => void;
  onConfigureProperties: () => void;
  onConfigureRoles: () => void;
}) {
  const label = pane === "facets" ? "Loading Configure widgets" : pane === "personal" ? "Loading Filters widgets" : "Restoring Community pane";
  return <LeftPaneFrame><LeftPaneBody>
    <div role="status" aria-busy="true" aria-label={label} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm">
        {pane === "facets" ? <ReturnToFiltersButton onClick={onShowFilters} disabled={!interactive} />
          : pane === "personal" ? <>
            <button type="button" disabled={!interactive} onClick={onConfigureProperties}
              className="cursor-pointer px-2 text-xs font-medium hover:bg-accent disabled:cursor-default disabled:opacity-50">Properties</button>
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
            <button type="button" disabled={!interactive} onClick={onConfigureRoles}
              className="cursor-pointer px-2 text-xs font-medium hover:bg-accent disabled:cursor-default disabled:opacity-50">Roles</button>
          </> : <span className="px-2 font-medium">Community</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" style={pane === "facets" ? { backgroundColor: CONFIGURE_LIST_BACKGROUND_COLOR } : undefined}>
        {widgets.map(widget => <SkeletonFacet key={widget.key} title={widget.title} rows={widget.rows} />)}
        {pane === "community" && <p className="text-xs text-muted-foreground">Community</p>}
      </div>
    </div>
  </LeftPaneBody></LeftPaneFrame>;
}

export function ResultsLoadingSkeleton({ wide = false }: { wide?: boolean }) {
  return <CenterPaneFrame defaultSize={wide ? 75 : 45}><CenterPaneBody>
    <div role="status" aria-busy="true" aria-label="Loading results" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2"><Skeleton className="h-7 w-40" /><Skeleton className="h-7 w-20" /></div>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-6 w-20" /></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{Array.from({ length: 7 }, (_, i) =>
        <div key={i} className="space-y-2 rounded-md border p-3"><Skeleton className="h-4 w-3/5" /><Skeleton className="h-3 w-4/5" /></div>)}</div>
    </div>
  </CenterPaneBody></CenterPaneFrame>;
}

export function RecordLoadingSkeleton() {
  return <RightPaneFrame><RightPaneBody>
    <div role="status" aria-busy="true" aria-label="Loading selected Record" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3"><Skeleton className="size-7" /><Skeleton className="h-5 w-32" /></div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"><Skeleton className="aspect-[5/2] w-full" /><Skeleton className="h-5 w-3/4" /><SkeletonRows rows={6} /></div>
    </div>
  </RightPaneBody></RightPaneFrame>;
}

export function ProviderCatalogLoadingSkeleton({ label }: { label: string }) {
  return <div role="status" aria-busy="true" aria-label={`Locating ${label}`} className="space-y-4">
    <div className="flex items-center gap-2"><Skeleton className="h-5 w-32" /><span className="text-xs text-muted-foreground">Locating {label}…</span></div>
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{Array.from({ length: 6 }, (_, i) =>
      <div key={i} className="space-y-3 rounded-md border p-4"><Skeleton className="h-5 w-3/5" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-2/3" /></div>)}</div>
  </div>;
}
