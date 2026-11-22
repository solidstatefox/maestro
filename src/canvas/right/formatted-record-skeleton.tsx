"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { ElapsedStatus } from "@/components/ui/elapsed-status";

/** Shape of a formatted Record, not an unscoped full-pane loading billboard.
 * The parent preserves the Record header and graph selector while rendering.
 * When there is no selection, this is a static placeholder (not fake loading).
 */
export function FormattedRecordSkeleton({
  label, clockScope, pending = true, state,
}: {
  label: string;
  clockScope?: "record" | "policies";
  pending?: boolean;
  state?: "unconfirmed" | "loading";
}) {
  const placeholder = (width: string, height = "h-3", key?: string) =>
    <Skeleton key={key} className={`${height} ${width} ${pending ? "" : "animate-none"}`} aria-hidden="true" />;
  return <div className="min-h-0 flex-1 overflow-auto p-4" data-maestro-record-state={state} role="status" aria-busy={pending} aria-label={label}>
    <div className="mx-auto w-full max-w-3xl space-y-5" data-maestro-record-skeleton="formatted">
      <div className="text-xs text-muted-foreground">
        {clockScope && pending ? <ElapsedStatus label={label} category="record" clockScope={clockScope} /> : label}
      </div>
      <div className="border-l-[3px] border-muted pl-3">
        <div className="flex items-center justify-between gap-3 bg-muted/25 px-2 py-2">
          {placeholder("w-28", "h-2.5")}{placeholder("w-24", "h-2.5")}
        </div>
      </div>
      <div className="space-y-3">
        {placeholder("w-5/6", "h-7")}
        {placeholder("w-2/3", "h-7")}
        <div className="flex gap-2">{placeholder("w-20", "h-3")}{placeholder("w-28", "h-3")}{placeholder("w-16", "h-3")}</div>
      </div>
      <div className="space-y-3 border-y py-5">
        {placeholder("w-full", "h-1.5")}
        <div className="flex justify-between">{placeholder("w-24", "h-3")}{placeholder("w-24", "h-3")}</div>
      </div>
      <div className="space-y-2.5">
        {placeholder("w-full")}{placeholder("w-11/12")}{placeholder("w-full")}{placeholder("w-4/5")}{placeholder("w-2/3")}
      </div>
      <div className="space-y-4 border-t pt-4">
        {placeholder("w-20", "h-4")}
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          {Array.from({length:4}, (_, index) => <div key={index} className="space-y-2">
            {placeholder("w-20", "h-2.5")}{placeholder(index % 2 ? "w-3/4" : "w-full", "h-4")}
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}
