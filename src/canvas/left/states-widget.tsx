"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";
import { FACET_ITEM_GAP_CLASS } from "@/canvas/left/facet-layout";
import type { PersonalStatesPage } from "@/canvas/controllers/personal-record-states";
import { shortenCount } from "@/lib/utils";
import { RECORD_STATE_NAMES } from "@/lib/personal-state-vocabulary";

/** States uses the Categories facet's borderless rows, header and density. */
export function PersonalStatesWidget({ states }: { states: PersonalStatesPage }) {
  if (!states.enabled || !states.hasStates) return null;
  return <article className="flex min-w-0 flex-col" aria-label="States">
    <header className="group/header flex items-start justify-between gap-2 border-b px-2 py-2">
      <div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">States</h2>
        {states.federatedQuery && <QueryInspectorButton query={states.federatedQuery} filename="states-federated-query.sparql" />}
      </div>
      <span className="text-xs text-muted-foreground" title={states.countScope === "query" ? "Query states" : "Loaded Results page states"}>{shortenCount(RECORD_STATE_NAMES.length)}</span>
    </header>
    <div className={FACET_ITEM_GAP_CLASS}>
      {RECORD_STATE_NAMES.map((name) => <label key={name} className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-0.5 text-sm hover:bg-accent/50">
        <input type="checkbox" checked={states.selectedStates.has(name)} onChange={() => states.toggleSelectedState(name)}
          className="size-4 shrink-0 accent-primary" aria-label={`Filter by ${name}`} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{shortenCount(states.counts[name] ?? 0)}</span>
      </label>)}
    </div>
    {states.loading && <p className="px-2 py-1 text-xs text-muted-foreground"><ElapsedStatus label="Loading States" category="personal" clockScope="states" /></p>}
    {states.error && <p className="px-2 py-1 text-xs text-destructive" role="alert">{states.error}</p>}
  </article>;
}
