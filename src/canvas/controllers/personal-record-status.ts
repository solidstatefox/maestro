"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RECORD_STATUS_NAMES, type RecordStatusName, type StatusFacetName } from "@/lib/personal-status-vocabulary";
import type { FctResult } from "@/canvas/utils/fct-response";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { readClientRecordPage, readClientStatusFacetCounts } from "@/lib/client-status-reads";
import { setClientRecordStatus, setClientHidden, recordClientLocatedPage } from "@/lib/client-status-writes";

export type PersonalStatusPage = {
  enabled: boolean;
  revision: number;
  statuses: Record<string, RecordStatusName[]>;
  hidden: ReadonlySet<string>;
  hasStatuses: boolean;
  countScope: "query";
  federatedQuery: string;
  counts: Record<StatusFacetName, number>;
  /** True only after the authoritative federated query returned counts. */
  countsReady: boolean;
  selectedStatuses: ReadonlySet<StatusFacetName>;
  toggleSelectedStatus: (name: StatusFacetName) => void;
  loading: boolean;
  error: string;
  recordBusy: boolean;
  selectedRecordStatuses: RecordStatusName[];
  selectedRecordHidden: boolean;
  toggleRecordStatus: (status: "Starred" | "Seen", enabled: boolean) => Promise<void>;
  toggleHidden: (hidden: boolean) => Promise<void>;
};


export async function queryDigest(xml: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalQueryIdentityXml(xml));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function usePersonalRecordStatus({ enabled, results, selectedUri, resultsReady, queryXml, pageIdentity, onHiddenChanged, selectedStatuses, toggleSelectedStatus }:
  { enabled: boolean; results: FctResult[]; selectedUri: string; resultsReady: boolean; queryXml: string; pageIdentity: string; onHiddenChanged?: () => void;
    selectedStatuses: ReadonlySet<StatusFacetName>; toggleSelectedStatus: (name: StatusFacetName) => void }): PersonalStatusPage {
  const [statuses, setStatuses] = useState<Record<string, RecordStatusName[]>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [digestState, setDigestState] = useState({xml:"",hash:""});
  const stableXml = canonicalQueryIdentityXml(queryXml);
  const hash = enabled && digestState.xml === stableXml ? digestState.hash : "";
  const [loading, setLoading] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [error, setError] = useState("");
  const [federatedCounts, setFederatedCounts] = useState<Record<StatusFacetName, number> | null>(null);
  const [federatedQuery, setFederatedQuery] = useState("");
  const [statusRevision, setStatusRevision] = useState(0);
  // An XState/query refresh creates a new page identity, but a React render,
  // status count update or Strict Mode effect replay must not write the *same*
  // located page again. Reuse its pending write before performing page reads.
  const locatedPageWritesRef = useRef(new Map<string, Promise<void>>());
  const previousViewedRecordRef = useRef("");
  const activeHashRef = useRef("");
  activeHashRef.current = enabled ? hash : "";
  const viewedRef = useRef(new Set<string>());
  const pageUris = useMemo(() => [...new Set(results.filter((r) => r.uri && r.termType !== "bnode" && /^(https?:|gttp:|gttps:)/i.test(r.uri)).map((r) => r.uri))], [results]);
  const pageKey = pageUris.join("\u0000");

  useEffect(() => {
    if (!enabled || !stableXml) { setDigestState({xml:"",hash:""}); return; }
    let active = true;
    void queryDigest(stableXml).then((value) => { if (active) setDigestState({xml:stableXml,hash:value}); }).catch(() => { if (active) setDigestState({xml:"",hash:""}); });
    return () => { active = false; };
  }, [enabled, stableXml]);
  useEffect(() => {
    setStatuses({}); setHidden(new Set()); setFederatedCounts(null); setFederatedQuery("");
    viewedRef.current.clear(); previousViewedRecordRef.current = "";
  }, [enabled, hash]);

  useEffect(() => {
    if (!enabled || !hash || !resultsReady || pageKey) return;
    const controller = new AbortController();
    void readClientStatusFacetCounts(hash, controller.signal)
      .then((facet) => { if (!controller.signal.aborted) { setFederatedCounts(facet.counts); setFederatedQuery(facet.sparql); } })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Federated status count failed."); });
    return () => controller.abort();
  }, [enabled, hash, resultsReady, pageKey, pageIdentity, queryXml, statusRevision]);

  useEffect(() => {
    if (!enabled || !hash || !resultsReady || !pageKey) { setLoading(false); return; }
    const controller = new AbortController();
    const uris = pageKey.split("\u0000");
    setLoading(true); setError("");
    void (async () => {
      try {
        // Commit the received page before page-local reads. Do not abort this
        // server mutation when navigating rapidly: every received page counts.
        const batches = Array.from({ length: Math.ceil(uris.length / 150) }, (_, index) => uris.slice(index * 150, (index + 1) * 150));
        const observationKey = `${hash}\u0000${pageIdentity}\u0000${pageKey}`;
        let recorded = locatedPageWritesRef.current.get(observationKey);
        if (!recorded) {
          const executionTime = new Date().toISOString();
          // Do not abort committed observations on navigation; all batches of
          // a received page are one logical execution.
          recorded = Promise.all(batches.map(batch => recordClientLocatedPage(hash, batch, executionTime))).then(() => undefined);
          locatedPageWritesRef.current.set(observationKey, recorded);
          void recorded.catch(() => { if (locatedPageWritesRef.current.get(observationKey) === recorded)
            locatedPageWritesRef.current.delete(observationKey); });
          if (locatedPageWritesRef.current.size > 100)
            locatedPageWritesRef.current.delete(locatedPageWritesRef.current.keys().next().value!);
        }
        await recorded;
        if (controller.signal.aborted) return;
        const pages = await Promise.all(batches.map((batch) => readClientRecordPage(batch, controller.signal)));
        if (controller.signal.aborted) return;
        const response = { statuses: Object.assign({}, ...pages.map((page) => page.statuses)) as Record<string, RecordStatusName[]>, hidden: pages.flatMap((page) => page.hidden) };
        setStatuses((old) => {
          const merged = { ...old, ...(response.statuses ?? {}) };
          for (const uri of uris) merged[uri] = response.statuses[uri] ?? [];
          return merged;
        });
        setHidden(new Set(response.hidden ?? []));
        // The browser's shared RDF/XState evaluator supplies effective page states.
        // Do not independently infer Unseen in a second React state machine.
        try {
          const facet = await readClientStatusFacetCounts(hash, controller.signal);
          if (!controller.signal.aborted) { setFederatedCounts(facet.counts); setFederatedQuery(facet.sparql); }
        } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Authoritative Status count failed."); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load Status."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [enabled, hash, resultsReady, pageKey, pageIdentity, queryXml, statusRevision]);

  // The RDF/XState evaluator, not React event handlers, determines the next
  // effective Record state. Re-read after mutation instead of hand-writing a
  // second Seen/Unseen/Starred transition table in component state.
  const refreshEffectiveRecord = useCallback(async (uri: string) => {
    const scope = activeHashRef.current;
    const page = await readClientRecordPage([uri]);
    if (!scope || activeHashRef.current !== scope) return;
    setStatuses((old) => ({ ...old, [uri]: page.statuses[uri] ?? [] }));
    setHidden((old) => {
      const next = new Set(old);
      if (page.hidden.includes(uri)) next.add(uri); else next.delete(uri);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled || !hash || !resultsReady || !pageUris.includes(selectedUri) || !/^(https?:|gttp:|gttps:)/i.test(selectedUri)) return;
    const key = `${hash}|${selectedUri}`;
    if (previousViewedRecordRef.current !== key) {
      previousViewedRecordRef.current = key;
      viewedRef.current.delete(key);
    }
    if (viewedRef.current.has(key)) return;
    viewedRef.current.add(key);
    void setClientRecordStatus(hash, selectedUri, "Seen", true, undefined, queryXml).then(() => {
      if (activeHashRef.current === hash) setStatusRevision((revision) => revision + 1);
    }).catch((e) => { if (activeHashRef.current === hash) { viewedRef.current.delete(key); setError(e instanceof Error ? e.message : "Could not mark Record Seen."); } });
  }, [enabled, hash, selectedUri, queryXml, resultsReady, pageKey]);

  const toggleRecordStatus = useCallback(async (status: "Starred" | "Seen", next: boolean) => {
    if (!enabled || !hash || !selectedUri || recordBusy) return;
    setRecordBusy(true); setError("");
    try {
      await setClientRecordStatus(hash, selectedUri, status, next, undefined, queryXml);
      viewedRef.current.add(`${hash}|${selectedUri}`);
      await refreshEffectiveRecord(selectedUri);
      setStatusRevision((revision) => revision + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update Record status."); }
    finally { setRecordBusy(false); }
  }, [enabled, hash, selectedUri, queryXml, recordBusy, refreshEffectiveRecord]);

  const toggleHidden = useCallback(async (next: boolean) => {
    if (!enabled || !hash || !selectedUri || recordBusy) return;
    setRecordBusy(true); setError("");
    try {
      await setClientHidden(selectedUri, next, undefined, queryXml);
      setHidden((old) => { const updated = new Set(old); if (next) updated.add(selectedUri); else updated.delete(selectedUri); return updated; });
      // Apply the visible status immediately and restart Results through the existing query refresh.
      onHiddenChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not change Hidden status."); }
    finally { setRecordBusy(false); }
  }, [enabled, hash, selectedUri, queryXml, recordBusy, onHiddenChanged]);

  // Never manufacture counts from the currently displayed Results page.
  const shownCounts: Record<StatusFacetName, number> = federatedCounts ?? { New: 0, Unseen: 0, Seen: 0, Starred: 0, Hidden: 0 };
  return { enabled, revision: statusRevision, statuses, hidden, hasStatuses: enabled && (federatedCounts !== null || pageUris.length > 0 || Object.values(statuses).some((list) => list.length > 0) || hidden.size > 0),
    countScope: "query", federatedQuery, counts: shownCounts, countsReady: federatedCounts !== null, selectedStatuses, toggleSelectedStatus,
    loading, error, recordBusy, selectedRecordStatuses: statuses[selectedUri] ?? [], selectedRecordHidden: hidden.has(selectedUri), toggleRecordStatus, toggleHidden };
}
