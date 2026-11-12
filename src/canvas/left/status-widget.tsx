"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";
import { FACET_ITEM_GAP_CLASS } from "@/canvas/left/facet-layout";
import type { PersonalStatusPage } from "@/canvas/controllers/personal-record-status";
import { shortenCount } from "@/lib/utils";
import { RECORD_STATUS_NAMES } from "@/lib/personal-status-vocabulary";

/** Status uses the Categories facet's borderless rows, header and density. */
export function PersonalStatusWidget({ statuses }: { statuses: PersonalStatusPage }) {
  if (!statuses.enabled || !statuses.hasStatuses) return null;
  return <article className="flex min-w-0 flex-col" aria-label="Status">
    <header className="group/header flex items-start justify-between gap-2 border-b px-2 py-2">
      <div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">Status</h2>
        {statuses.federatedQuery && <QueryInspectorButton query={statuses.federatedQuery} filename="statuses-federated-query.sparql" />}
      </div>
      <span className="text-xs text-muted-foreground" title={statuses.countScope === "query" ? "Query statuses" : "Loaded Results page statuses"}>{shortenCount(RECORD_STATUS_NAMES.length)}</span>
    </header>
    <div className={FACET_ITEM_GAP_CLASS}>
      {RECORD_STATUS_NAMES.map((name) => <label key={name} className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-0.5 text-sm hover:bg-accent/50">
        <input type="checkbox" checked={statuses.selectedStatuses.has(name)} onChange={() => statuses.toggleSelectedStatus(name)}
          className="size-4 shrink-0 accent-primary" aria-label={`Filter by ${name}`} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{shortenCount(statuses.counts[name] ?? 0)}</span>
      </label>)}
    </div>
    {statuses.loading && <p className="px-2 py-1 text-xs text-muted-foreground"><ElapsedStatus label="Loading Status" category="personal" clockScope="statuses" /></p>}
    {statuses.error && <p className="px-2 py-1 text-xs text-destructive" role="alert">{statuses.error}</p>}
  </article>;
}
