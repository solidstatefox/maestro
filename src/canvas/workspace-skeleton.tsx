"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";
import { ResizableHandle, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  LeftPaneFrame, LeftPaneBody, CenterPaneFrame, CenterPaneBody,
  RightPaneFrame, RightPaneBody,
} from "@/canvas/workspace-pane-shells";

/** A facet's real header/row layout, with only the values replaced by skeletons. */
function FacetContents({ title, rows }: { title: string; rows: number }) {
  return <section aria-label={`${title} loading`} className="py-3">
    <div className="mb-3 flex items-center justify-between gap-4 px-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Skeleton className="h-5 w-12" />
    </div>
    <div className="space-y-0.5 px-3">
      {Array.from({ length: rows }, (_, i) => <div className="flex min-h-7 items-center gap-2" key={i}>
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <Skeleton className={`h-4 ${i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-4/5" : "w-2/3"}`} />
        <Skeleton className="ml-auto h-3 w-7 shrink-0" />
      </div>)}
    </div>
  </section>;
}

function CategoriesAndGraphsSkeleton({ defaultSize }: { defaultSize: number }) {
  return <LeftPaneFrame defaultSize={defaultSize}>
    <LeftPaneBody>
      {/* Exact navigation header and scrolling-content frames used by LeftCanvasPanel. */}
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-sm whitespace-nowrap">
        <Skeleton className="h-6 w-20" /><Skeleton className="ml-2 h-6 w-16" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <FacetContents title="Categories" rows={7} />
        <FacetContents title="Graphs" rows={4} />
      </div>
    </LeftPaneBody>
  </LeftPaneFrame>;
}

function ResultsSkeleton({ defaultSize }: { defaultSize: number }) {
  return <CenterPaneFrame defaultSize={defaultSize}>
    <CenterPaneBody>
      {/* The live Results group-by header, batch header, and result-card container geometry. */}
      <div className="group/header shrink-0 border-b px-3 pb-3 pt-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
          <Skeleton className="h-6 w-40" /><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="flex min-h-[42px] shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <Skeleton className="h-4 w-24" /><Skeleton className="h-7 w-20" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="rounded-md border p-3">
            <Skeleton className="mb-2 h-4 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>)}
        </div>
      </div>
    </CenterPaneBody>
  </CenterPaneFrame>;
}

function RecordSkeleton({ defaultSize }: { defaultSize: number }) {
  return <RightPaneFrame defaultSize={defaultSize}>
    <RightPaneBody>
      {/* Same Record controls header and content frame as RightCanvasPanel. */}
      <div className="shrink-0 border-b">
        <div className="group/record-header flex items-center gap-2 px-4 py-3">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="ml-auto h-7 w-12" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        <Skeleton className="aspect-[5/2] w-full" />
        <Skeleton className="h-6 w-3/4" />
        {Array.from({ length: 6 }, (_, i) => <div className="flex gap-2" key={i}>
          <Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 flex-1" />
        </div>)}
      </div>
    </RightPaneBody>
  </RightPaneFrame>;
}

/**
 * Render real Maestro ribbon and resizable pane shells. Their live contents are
 * replaced with Skeleton primitives; panel widths remain owned by the same
 * react-resizable-panels layout system instead of percentage-width placeholders.
 */
export function WorkspaceSkeleton({ message, error, ribbon, panelWidths = [25, 45, 30], onLayout }: {
  ribbon: ReactNode;
  message: string;
  error?: string | null;
  panelWidths?: readonly number[];
  onLayout?: (sizes: number[]) => void;
}) {
  const [left = 25, center = 45, right = 30] = panelWidths;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden" role="status" aria-busy="true" aria-label={message}>
    <div className="shrink-0">{ribbon}</div>
    {error && <p className="border-b px-4 py-2 text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1" onLayout={onLayout}>
        <CategoriesAndGraphsSkeleton defaultSize={left} />
        <ResizableHandle withHandle />
        <ResultsSkeleton defaultSize={center} />
        <ResizableHandle withHandle />
        <RecordSkeleton defaultSize={right} />
      </ResizablePanelGroup>
    </div>
    <span className="sr-only">{message}</span>
  </div>;
}
