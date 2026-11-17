"use client";

import { FileQuestion, FileText, FolderOpen, LayoutList, Link2, SearchX } from "lucide-react";
import { CONFIGURE_LIST_BACKGROUND_COLOR } from "@/canvas/left/configure";
import { ReturnToFiltersButton } from "@/canvas/left/return-to-filters";
import type { LeftSkeletonPane } from "@/lib/app-lifecycle/skeleton-boundaries";
import { LeftPaneFrame, LeftPaneBody, CenterPaneFrame, CenterPaneBody, RightPaneFrame, RightPaneBody } from "@/canvas/workspace-pane-shells";

/** A stopped graph request has no pending content. These are intentionally
 * static empty fixtures, never animated loading skeletons or fake RDF data.
 * We preserve the ordinary resizable panel frames and navigation furniture. */
function ZeroFacet({ name }: { name: string }) {
  return <section aria-label={`${name} (0)`} className="space-y-2 py-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{name}</h2>
      <span className="min-w-6 text-right text-xs tabular-nums text-muted-foreground">0</span>
    </div>
    <div className="text-xs text-muted-foreground">No {name.toLowerCase()} loaded</div>
  </section>;
}

export function GraphUnavailableFacets({ pane, onShowFilters, onConfigureProperties, onConfigureRoles }: {
  pane: LeftSkeletonPane;
  onShowFilters: () => void;
  onConfigureProperties: () => void;
  onConfigureRoles: () => void;
}) {
  return <LeftPaneFrame><LeftPaneBody>
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm">
      {pane === "facets" ? <ReturnToFiltersButton onClick={onShowFilters} /> : <>
        <button type="button" onClick={onConfigureProperties} className="cursor-pointer px-2 text-xs font-medium hover:bg-accent">Properties</button>
        <span aria-hidden="true" className="h-5 w-px bg-border" />
        <button type="button" onClick={onConfigureRoles} className="cursor-pointer px-2 text-xs font-medium hover:bg-accent">Roles</button>
      </>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3"
      style={pane === "facets" ? { backgroundColor: CONFIGURE_LIST_BACKGROUND_COLOR } : undefined}>
      {pane === "facets" && <><ZeroFacet name="Properties" /><ZeroFacet name="Roles" /></>}
      {pane === "personal" && <ZeroFacet name="Categories" />}
      <ZeroFacet name="Graphs" />
      {pane === "community" && <p className="text-xs text-muted-foreground">Community content is unavailable.</p>}
    </div>
  </LeftPaneBody></LeftPaneFrame>;
}

/** Empty results with the Group-by controls still visible. Unlike a skeleton,
 * the wireframe is not aria-busy and has no pulsing animation. */
export function GraphUnavailableResults({ wide = false }: { wide?: boolean }) {
  return <CenterPaneFrame defaultSize={wide ? 75 : 45}><CenterPaneBody>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
      <span className="font-medium">Group <span className="tabular-nums">0</span> results by:</span>
      <select aria-label="Group by" disabled defaultValue="none" className="min-w-28 rounded-md border bg-background px-2 py-1 text-sm text-muted-foreground disabled:opacity-70">
        <option value="none">None</option>
      </select>
      <span className="text-muted-foreground">in pages of</span>
      <input aria-label="Group page size" value="0" readOnly disabled className="w-12 rounded-md border bg-background px-2 py-1 text-center tabular-nums text-muted-foreground disabled:opacity-70" />
    </div>
    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2 text-sm">
      <span className="font-semibold">Results <span className="ml-1 text-muted-foreground tabular-nums">0</span></span>
      <span className="text-xs text-muted-foreground">0 results</span>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <SearchX className="size-4 shrink-0" aria-hidden="true" />
        No results loaded from the selected graph server. You can choose another server or refresh.
      </div>
      <div aria-label="Empty results wireframe" className="space-y-2" aria-busy="false">
        {Array.from({ length: 4 }, (_, index) => <div key={index} aria-hidden="true"
          className="flex items-center gap-3 rounded-md border border-dashed border-border/60 px-3 py-3 text-muted-foreground/45">
          <FileText className="size-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-2 w-2/5 rounded-sm bg-muted/70" />
            <div className="h-1.5 w-3/5 rounded-sm bg-muted/50" />
          </div>
        </div>)}
      </div>
    </div>
  </CenterPaneBody></CenterPaneFrame>;
}

export function GraphUnavailableRecord() {
  return <RightPaneFrame><RightPaneBody>
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><FileQuestion className="size-4 text-muted-foreground" aria-hidden="true" />Record</div>
      <span className="text-xs text-muted-foreground">No selection</span>
    </div>
    <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs" aria-label="Record tools unavailable">
      <button type="button" disabled className="rounded-md border px-2 py-1 disabled:opacity-50">Format</button>
      <button type="button" disabled className="rounded-md border px-2 py-1 disabled:opacity-50">Source</button>
      <button type="button" disabled className="rounded-md border px-2 py-1 disabled:opacity-50">Validate</button>
    </div>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Record not found</h2>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Like a 404 page, this Record has no content to display yet. No resource was returned by the selected graph server.
        </p>
      </div>
      <div className="space-y-3 rounded-md border p-3 text-xs">
        <div className="flex items-center gap-2 font-medium"><FolderOpen className="size-4 text-muted-foreground" aria-hidden="true" /> Record details</div>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">Subject</span><span>—</span></div>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">Classes</span><span>0</span></div>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">Properties</span><span>0</span></div>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">Roles</span><span>0</span></div>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">Graphs</span><span>0</span></div>
      </div>
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2 font-semibold"><LayoutList className="size-4 text-muted-foreground" aria-hidden="true" />Properties <span className="font-normal text-muted-foreground">0</span></div>
        <div className="rounded-md border border-dashed px-3 py-3 text-muted-foreground">No statements to display.</div>
      </div>
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2 font-semibold"><Link2 className="size-4 text-muted-foreground" aria-hidden="true" />Roles <span className="font-normal text-muted-foreground">0</span></div>
        <div className="rounded-md border border-dashed px-3 py-3 text-muted-foreground">No incoming statements.</div>
      </div>
    </div>
  </RightPaneBody></RightPaneFrame>;
}
