"use client";

import { ExternalLink } from "lucide-react";
import type { PersonalWidget } from "@/canvas/left/filter";
import { groupValueBinding, fctTermKey } from "@/canvas/utils/fct-response";

const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** Every built-in View/Analyze surface can consume the same scoped Personal
 * facet values. The host has already projected the full <a> path, so this
 * component must never reconstruct a remote property or dispatch a query. */
export function TransportedDimensionSummary({ widgets }: { widgets: readonly PersonalWidget[] }) {
  const axes = widgets.filter(widget => widget.anchor);
  if (!axes.length) return null;
  return <section className="min-w-0 rounded-xl border border-border/80 bg-card p-4 shadow-sm" aria-label="Transported analysis dimensions">
    <h3 className="mb-1 text-sm font-semibold">Transported dimensions</h3>
    <p className="mb-3 text-xs text-muted-foreground">Values and distinct ancestor memberships for each anchored relationship path. Counts can overlap across values.</p>
    <div className="grid gap-3 md:grid-cols-2">
      {axes.map(widget => {
        const seen = new Set<string>();
        const values = widget.values.flatMap(value => {
          const binding = groupValueBinding(value);
          const key = fctTermKey(binding.text, binding.datatype, binding.lang);
          const count = Number(value.columns?.[1]?.value);
          if (seen.has(key) || !Number.isSafeInteger(count) || count < 0) return [];
          seen.add(key);
          return [{ key, label: value.title || value.uri, count }];
        }).sort((a,b) => b.count-a.count || a.label.localeCompare(b.label)).slice(0,8);
        return <div key={widget.anchor!.id} className="min-w-0 rounded-lg border border-border/65 px-3 py-2">
          <div className="mb-2 flex items-start gap-1.5 text-xs font-medium"><ExternalLink className="mt-0.5 size-3.5 shrink-0 text-emerald-600"/><span className="break-words">{widget.label}</span></div>
          {widget.loading ? <p className="text-xs text-muted-foreground" role="status">Loading anchored groups…</p> : widget.error ? <p className="text-xs text-destructive">{widget.error}</p>
            : values.length ? <div className="space-y-1.5">{values.map(row => <div key={row.key} className="flex items-baseline justify-between gap-2 text-xs"><span className="min-w-0 truncate" title={row.label}>{row.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{fmt.format(row.count)}</span></div>)}</div>
            : <p className="text-xs text-muted-foreground">No values returned for this path.</p>}
        </div>;
      })}
    </div>
  </section>;
}
