"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { CONFIGURE_LIST_BACKGROUND_COLOR, CONFIGURE_HEADER_BACKGROUND_COLOR, CONFIGURE_HEADER_BORDER_COLOR } from "@/canvas/left/configure";
import { LeftPaneNavigation } from "@/canvas/left/pane-navigation";
import type { LeftPaneWorkspace } from "@/canvas/controllers/workspace-interfaces";
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

/** Configure retains its blue section furniture, focus order, Kinds slot,
 * inspector slot, and list positions. Only unknown RDF values/counts pulse.
 * Query-driven controls are deliberately inert until URL restoration finishes. */
function SkeletonConfigureSection({ title, rows }: { title: string; rows: number }) {
  return <section aria-label={`${title} loading`} className="mb-5">
    <div className="group/header mb-2 flex w-full items-center gap-1 overflow-hidden rounded-t-md border-b"
      style={{ backgroundColor: CONFIGURE_HEADER_BACKGROUND_COLOR, borderColor: CONFIGURE_HEADER_BORDER_COLOR }}>
      <h2 className="min-w-0 truncate px-3 py-2 text-sm font-semibold text-white">{title}</h2>
      <Skeleton aria-hidden="true" className="ml-1 h-5 w-16 shrink-0 bg-white/30" />
      <Skeleton aria-hidden="true" className="ml-auto size-7 shrink-0 rounded bg-white/30" />
      <Skeleton aria-hidden="true" className="mx-2 h-3 w-6 shrink-0 bg-white/30" />
    </div>
    <div className="space-y-2 px-1"><SkeletonRows rows={rows} /></div>
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

export function FacetsLoadingSkeleton({ pane, widgets, workspace }: {
  pane: LeftSkeletonPane;
  widgets: readonly LeftSkeletonWidget[];
  workspace: LeftPaneWorkspace;
}) {
  const label = pane === "facets" ? "Loading Configure widgets" : pane === "personal" ? "Loading Filters widgets" : "Restoring Community pane";
  return <LeftPaneFrame><LeftPaneBody>
    <div role="status" aria-busy="true" aria-label={label} className="flex min-h-0 flex-1 flex-col">
      <LeftPaneNavigation workspace={workspace} restoring pane={pane} />
      <div className={`min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] p-3 ${pane === "facets" ? "" : "bg-background"}`}
        style={pane === "facets" ? { backgroundColor: CONFIGURE_LIST_BACKGROUND_COLOR } : undefined}>
        {widgets.map(widget => pane === "facets"
          ? <SkeletonConfigureSection key={widget.key} title={widget.title} rows={widget.rows} />
          : <SkeletonFacet key={widget.key} title={widget.title} rows={widget.rows} />)}
        {pane === "community" && <div className="space-y-2"><h2 className="text-sm font-semibold">Community</h2>
          <p className="text-xs text-muted-foreground">Community-shared views will appear here.</p></div>}
      </div>
    </div>
  </LeftPaneBody></LeftPaneFrame>;
}

export function ResultsLoadingSkeleton({ wide = false }: { wide?: boolean }) {
  return <CenterPaneFrame defaultSize={wide ? 75 : 45}><CenterPaneBody>
    <section role="status" aria-busy="true" aria-label="Restoring Results" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-3 py-2 text-sm font-medium">Results</div>
      <p className="px-3 pt-3 text-xs text-muted-foreground">Restoring query…</p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{Array.from({ length: 2 }, (_, i) =>
        <div key={i} className="space-y-2 rounded-md border p-3"><Skeleton className="h-4 w-3/5" /><Skeleton className="h-3 w-4/5" /></div>)}</div>
    </section>
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
