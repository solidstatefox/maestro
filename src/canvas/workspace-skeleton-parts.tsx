"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { ResultCardFixture } from "@/canvas/workspace-fixtures";

/** Only data-bearing atoms become skeletons. Shells, headings, toolbar labels,
 * input geometry and Record section fixtures are their real counterparts. */
export function PendingCount({ pending }: { pending: boolean }) {
  return pending ? <Skeleton className="inline-block h-4 w-8 align-middle" />
    : <span className="tabular-nums">0</span>;
}

export function PendingFacetRows({ rows }: { rows: number }) {
  return <div className="space-y-0.5" aria-hidden="true">{Array.from({ length: rows }, (_, i) =>
    <div key={i} className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1">
      <Skeleton className="size-4 shrink-0 rounded-[3px]" />
      <Skeleton className={`h-4 ${i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-4/5" : "w-2/3"}`} />
      <Skeleton className="ml-auto h-3 w-7 shrink-0" />
    </div>)}</div>;
}

export function PendingFacet({ title, rows, pending }: { title: string; rows: number; pending: boolean }) {
  return <section aria-label={`${title} ${pending ? "loading" : "unavailable"}`} className="space-y-2 py-3">
    <header className="flex min-h-8 items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <span className="text-xs text-muted-foreground"><PendingCount pending={pending} /></span>
    </header>
    {pending ? <PendingFacetRows rows={rows} />
      : <p className="px-2 text-xs text-muted-foreground">No values available.</p>}
  </section>;
}

/** The same selectable Results card shell; only actual title and URI data load. */
export function PendingResultCards({ pending, rows = 5 }: { pending: boolean; rows?: number }) {
  return <div className="relative min-h-0 flex-1 overflow-y-auto p-2" aria-label={pending ? "Loading result items" : "Empty result items"}>
    {pending ? Array.from({ length: rows }, (_, i) =>
      <ResultCardFixture key={i}>
        <div className="flex items-start gap-2 p-3" aria-hidden="true">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={`h-4 ${i % 3 === 0 ? "w-3/5" : "w-2/5"}`} />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      </ResultCardFixture>)
      : <p className="p-3 text-sm text-muted-foreground">No results available from the selected graph server.</p>}
  </div>;
}

/** Shared section proportions with default Record properties / incoming roles. */
export function PendingRecordSection({ title, rows, pending }: { title: string; rows: number; pending: boolean }) {
  return <section className="space-y-2" aria-label={`${title} ${pending ? "loading" : "unavailable"}`}>
    <h3 className="text-sm font-semibold">{title} <span className="font-normal text-muted-foreground"><PendingCount pending={pending} /></span></h3>
    {pending ? <div className="space-y-2" aria-hidden="true">{Array.from({ length: rows }, (_, i) =>
      <div key={i} className="flex items-center gap-3 py-1">
        <Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 flex-1" />
      </div>)}</div>
      : <p className="text-xs text-muted-foreground">No statements available.</p>}
  </section>;
}
