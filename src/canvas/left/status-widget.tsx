"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { LeftWidgetButtonTray } from "@/components/ui/left-widget-button-tray";
import { Code2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { QueryInspectorButton } from "@/canvas/utils/query-inspector";
import { FACET_ITEM_GAP_CLASS } from "@/canvas/left/facet-layout";
import type { PersonalStatusPage } from "@/canvas/controllers/personal-record-status";
import type { FctQueryTree } from "@/lib/fct-query-api";
import { shortenCount } from "@/lib/utils";
import { RECORD_STATUS_NAMES } from "@/lib/personal-status-vocabulary";
import { toLabel } from "@/lib/uri-labels";
import { fctStatusFacet } from "@/lib/fct-client";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
/** The same borderless Status fixture serves Record and policy facets. Counts
 * are optional; no count is invented when the personal graph has not answered. */
export function StatusFacetWidget<T extends string>({ names, selected, counts, toggle, query, countQuery, fctQuery, loading, error, filename, labels, onNavigate }: {
  names: readonly T[]; selected: ReadonlySet<T>; counts: Partial<Record<T, number>> | null;
  toggle: (name: T) => void; query?: string; countQuery?: string; fctQuery?: string; loading?: boolean; error?: string; filename?: string; labels?: Partial<Record<T,string>>; onNavigate?: () => void;
}) {
  // Don't present a conspicuous "0" badge for an otherwise empty Status facet.
  // Checked statuses stay visible and removable even when their count is zero.
  const showCounts = counts !== null && names.some(name => (counts[name] ?? 0) > 0);
  return <article className="flex min-w-0 flex-col" aria-label="Status">
    <header className="group/header flex items-start justify-between gap-2 border-b px-2 py-2">
      <div className="flex min-w-0 items-center gap-1">{onNavigate ? <button type="button" className="cursor-pointer text-sm font-semibold hover:underline underline-offset-2" title="Navigate to mui:status of the current focus" onClick={onNavigate}>Status</button> : <h2 className="text-sm font-semibold">Status</h2>}
        {(fctQuery || query) && <LeftWidgetButtonTray threshold={3} actions={[{
          id: "inspector", label: "Inspect Status facet query", icon: <Code2 className="size-4" />,
          render: <QueryInspectorButton query={fctQuery || query || ""} language={fctQuery ? "xml" : "sparql"}
            filename={fctQuery ? "status-list-status.xml" : filename ?? "statuses-query.sparql"}
            countQuery={countQuery} countFilename="status-count.sparql" primaryTabLabel={fctQuery ? "FCT list-status" : "Status SPARQL"} />,
        }]} />}
      </div>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {loading && <ElapsedStatus label="" category="personal" clockScope="statuses" />}
        {showCounts && shortenCount(names.reduce((total, name) => total + (counts?.[name] ?? 0), 0))}
      </span>
    </header>
    <div className={FACET_ITEM_GAP_CLASS}>
      {names.filter(name => selected.has(name) || counts === null || counts[name] === undefined || counts[name]! > 0).map(name => <label key={name} className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-0.5 text-sm hover:bg-accent/50">
        <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)}
          className="size-4 shrink-0 accent-primary" aria-label={`Filter by ${name}`} />
        <span className="min-w-0 flex-1 truncate">{labels?.[name] ?? name}</span>
        {showCounts && <span className="shrink-0 text-xs text-muted-foreground">{counts?.[name] === undefined ? "—" : shortenCount(counts?.[name] ?? 0)}</span>}
      </label>)}
    </div>
    {error && <ErrorDetails error={error} prefix="Status" className="mx-2 my-1" />}
  </article>;
}

export function PersonalStatusWidget({ statuses }: { statuses: PersonalStatusPage }) {
  if (!statuses.enabled || !statuses.hasStatuses) return null;
  return <StatusFacetWidget names={RECORD_STATUS_NAMES} selected={statuses.selectedStatuses}
    counts={statuses.counts} toggle={statuses.toggleSelectedStatus}
    query={statuses.federatedQuery} filename="statuses-federated-query.sparql"
    loading={statuses.loading} error={statuses.error} />;
}

/** A single bookmarked-query Status facet: the FCT list-status projection
 * determines the matching records, and their personal mui:status triples
 * determine the displayed choices. No provider- or tab-specific switch. */
export function LiveQueryStatusWidget({ tree, toggle, revision, queryXml, onNavigate }: {
  tree: FctQueryTree; toggle: (uri: string) => void; revision: number; queryXml: string; onNavigate?: () => void;
}) {
  const [entries, setEntries] = useState<Array<{uri: string; count: number}>>([]);
  // A previous bookmark/query's Status counts must not be presented as the
  // current query's counts during an asynchronous scope change. Keep valid
  // same-scope counts mounted while a refresh is in flight.
  const [entriesScope, setEntriesScope] = useState("");
  const [fctQuery, setFctQuery] = useState("");
  const [countQuery, setCountQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Checked statuses belong to the current view carrier's scope, not
  // necessarily to the query root. Keep the UI in sync with the same scope
  // used by toggleLiveStatusFilter in the authoritative query controller.
  const currentViewScope = (nodes: FctQueryTree["children"]): FctQueryTree["children"] | null => {
    if (nodes.some(node => node.name === "view")) return nodes;
    for (const node of nodes) {
      const nested = currentViewScope(node.children);
      if (nested) return nested;
    }
    return null;
  };
  const selected = new Set((currentViewScope(tree.children) ?? tree.children)
    .filter(node => node.name === "status" && node.attributes.type === "uri")
    .map(node => node.text?.trim() ?? "").filter(Boolean));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void fctStatusFacet(queryXml, controller.signal)
      .then(data => { if (!controller.signal.aborted) {
        setEntries(data.entries); setEntriesScope(queryXml); setFctQuery(data.fctQuery); setCountQuery(data.sparql);
      } }).catch(reason => { if (!controller.signal.aborted) {
        setEntries([]); setEntriesScope(""); setFctQuery(""); setCountQuery("");
        setError(reason instanceof Error ? reason.message : "Status list unavailable");
      } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, queryXml]);
  const scopedEntries = entriesScope === queryXml ? entries : [];
  const names = [...new Set([...scopedEntries.map(entry => entry.uri), ...selected])];
  const counts = entriesScope === queryXml
    ? Object.fromEntries(scopedEntries.map(entry => [entry.uri, entry.count])) : null;
  const labels = Object.fromEntries(names.map(uri => [uri, uri === `${MUI}Unseen` ? "New" : toLabel(uri)]));
  return <StatusFacetWidget names={names} selected={selected} counts={counts} labels={labels}
    toggle={toggle} onNavigate={onNavigate}
    query={entriesScope === queryXml ? countQuery : ""}
    countQuery={entriesScope === queryXml ? countQuery : ""}
    fctQuery={entriesScope === queryXml ? fctQuery : ""}
    filename="list-status.sparql" loading={loading || (!error && entriesScope !== queryXml)} error={error} />;
}
