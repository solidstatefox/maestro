"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RECORD_STATE_NAMES, type RecordStateName, type StateFacetName } from "@/lib/personal-state-vocabulary";
import type { FctResult } from "@/canvas/utils/fct-response";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";

export type PersonalStatesPage = {
  enabled: boolean;
  states: Record<string, RecordStateName[]>;
  hidden: ReadonlySet<string>;
  hasStates: boolean;
  countScope: "query";
  federatedQuery: string;
  counts: Record<StateFacetName, number>;
  selectedStates: ReadonlySet<StateFacetName>;
  toggleSelectedState: (name: StateFacetName) => void;
  loading: boolean;
  error: string;
  recordBusy: boolean;
  selectedRecordStates: RecordStateName[];
  selectedRecordHidden: boolean;
  toggleRecordState: (state: "Starred" | "Seen", enabled: boolean) => Promise<void>;
  toggleHidden: (hidden: boolean) => Promise<void>;
};

type PageResult = { states: Record<string, RecordStateName[]>; hidden: string[] };
type FacetResult = { hasStates: boolean; counts: Record<StateFacetName, number>; sparql: string };
async function requestStates<T = {ok: boolean}>(body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/proxy/api/record-states", { method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) { const detail = await response.json().catch(() => null); throw new Error(detail?.error || `Personal state operation failed (HTTP ${response.status}).`); }
  return response.json() as Promise<T>;
}

export async function queryDigest(xml: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalQueryIdentityXml(xml));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function usePersonalRecordStates({ enabled, results, selectedUri, resultsReady, queryXml, pageIdentity, onHiddenChanged, selectedStates, toggleSelectedState }:
  { enabled: boolean; results: FctResult[]; selectedUri: string; resultsReady: boolean; queryXml: string; pageIdentity: string; onHiddenChanged?: () => void;
    selectedStates: ReadonlySet<StateFacetName>; toggleSelectedState: (name: StateFacetName) => void }): PersonalStatesPage {
  const [states, setStates] = useState<Record<string, RecordStateName[]>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hash, setHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [error, setError] = useState("");
  const [federatedCounts, setFederatedCounts] = useState<Record<StateFacetName, number> | null>(null);
  const [federatedQuery, setFederatedQuery] = useState("");
  const [stateRevision, setStateRevision] = useState(0);
  const previousViewedRecordRef = useRef("");
  const viewedRef = useRef(new Set<string>());
  const pageUris = useMemo(() => [...new Set(results.filter((r) => r.uri && r.termType !== "bnode" && /^(https?:|gttp:|gttps:)/i.test(r.uri)).map((r) => r.uri))], [results]);
  const pageKey = pageUris.join("\u0000");
  const stableXml = canonicalQueryIdentityXml(queryXml);

  useEffect(() => {
    if (!enabled || !stableXml) { setHash(""); return; }
    let active = true;
    void queryDigest(stableXml).then((value) => { if (active) setHash(value); }).catch(() => { if (active) setHash(""); });
    return () => { active = false; };
  }, [enabled, stableXml]);
  useEffect(() => {
    setStates({}); setHidden(new Set()); setFederatedCounts(null); setFederatedQuery("");
    viewedRef.current.clear(); previousViewedRecordRef.current = "";
  }, [enabled, hash]);

  useEffect(() => {
    if (!enabled || !hash || !resultsReady || pageKey) return;
    const controller = new AbortController();
    void requestStates<FacetResult>({ action: "facets", queryHash: hash, queryXml }, controller.signal)
      .then((facet) => { if (!controller.signal.aborted) { setFederatedCounts(facet.counts); setFederatedQuery(facet.sparql); } })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Federated state count failed."); });
    return () => controller.abort();
  }, [enabled, hash, resultsReady, pageKey, pageIdentity, queryXml]);

  useEffect(() => {
    if (!enabled || !hash || !resultsReady || !pageKey) { setLoading(false); return; }
    const controller = new AbortController();
    const uris = pageKey.split("\u0000");
    setLoading(true); setError("");
    void (async () => {
      try {
        // Commit the received page before page-local reads. Do not abort this
        // server mutation when navigating rapidly: every received page counts.
        const executionTime = new Date().toISOString();
        const batches = Array.from({ length: Math.ceil(uris.length / 150) }, (_, index) => uris.slice(index * 150, (index + 1) * 150));
        // All batches must finish writing even when a user immediately pages on.
        await Promise.all(batches.map((batch) => requestStates({ action: "located", queryHash: hash, uris: batch, executionTime })));
        if (controller.signal.aborted) return;
        const pages = await Promise.all(batches.map((batch) => requestStates<PageResult>({ action: "page", queryHash: hash, uris: batch }, controller.signal)));
        if (controller.signal.aborted) return;
        const response: PageResult = { states: Object.assign({}, ...pages.map((page) => page.states)), hidden: pages.flatMap((page) => page.hidden) };
        setStates((old) => {
          const merged = { ...old, ...(response.states ?? {}) };
          for (const uri of uris) if ((old[uri] ?? []).includes("Seen")) merged[uri] = [...new Set([...(merged[uri] ?? []).filter((item) => item !== "Unseen"), "Seen" as const])];
          return merged;
        });
        setHidden(new Set(response.hidden ?? []));
        // Newly discovered entries become Unseen, but an existing Seen/Starred entry is not reset.
        setStates((old) => {
          const next = { ...old };
          for (const uri of uris) if (!(next[uri] ?? []).includes("Seen")) next[uri] = [...new Set([...(next[uri] ?? []), "Unseen" as const])];
          return next;
        });
        try {
          const facet = await requestStates<FacetResult>({ action: "facets", queryHash: hash, queryXml }, controller.signal);
          if (!controller.signal.aborted) { setFederatedCounts(facet.counts); setFederatedQuery(facet.sparql); }
        } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Authoritative States count failed."); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load States."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [enabled, hash, resultsReady, pageKey, pageIdentity, queryXml]);

  // The query-hash graph is the bus. A Record view/toggle writes Seen/Starred
  // there, then re-reads authoritative federated facet counts without waiting
  // for the Results page to change.
  useEffect(() => {
    if (!enabled || !hash || !resultsReady || !pageKey || !stateRevision) return;
    const controller = new AbortController();
    void requestStates<FacetResult>({ action: "facets", queryHash: hash, queryXml }, controller.signal)
      .then((facet) => {
        if (!controller.signal.aborted) { setFederatedCounts(facet.counts); setFederatedQuery(facet.sparql); }
      })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not update States counts."); });
    return () => controller.abort();
  }, [enabled, hash, resultsReady, pageKey, queryXml, stateRevision]);

  useEffect(() => {
    if (!enabled || !hash || !selectedUri || !/^(https?:|gttp:|gttps:)/i.test(selectedUri)) return;
    const key = `${hash}|${selectedUri}`;
    if (previousViewedRecordRef.current !== key) {
      previousViewedRecordRef.current = key;
      viewedRef.current.delete(key);
    }
    if (viewedRef.current.has(key)) return;
    viewedRef.current.add(key);
    let active = true;
    void requestStates({ action: "set", queryHash: hash, uri: selectedUri, state: "Seen", enabled: true }).then(() => {
      if (active) {
        setStates((old) => ({ ...old, [selectedUri]: [...(old[selectedUri] ?? []).filter((name) => name !== "Unseen" && name !== "Seen"), "Seen"] }));
        setStateRevision((revision) => revision + 1);
      }
    }).catch((e) => { if (active) { viewedRef.current.delete(key); setError(e instanceof Error ? e.message : "Could not mark Record Seen."); } });
    return () => { active = false; };
  }, [enabled, hash, selectedUri]);

  const toggleRecordState = useCallback(async (state: "Starred" | "Seen", next: boolean) => {
    if (!enabled || !hash || !selectedUri || recordBusy) return;
    setRecordBusy(true); setError("");
    try {
      await requestStates({ action: "set", queryHash: hash, uri: selectedUri, state, enabled: next });
      viewedRef.current.add(`${hash}|${selectedUri}`);
      setStateRevision((revision) => revision + 1);
      setStates((old) => ({ ...old, [selectedUri]: state === "Seen"
        ? [...(old[selectedUri] ?? []).filter((item) => item !== "Seen" && item !== "Unseen"), next ? "Seen" : "Unseen"]
        : next ? [...new Set([...(old[selectedUri] ?? []), "Starred" as const])] : (old[selectedUri] ?? []).filter((item) => item !== "Starred") }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update Record state."); }
    finally { setRecordBusy(false); }
  }, [enabled, hash, selectedUri, recordBusy]);

  const toggleHidden = useCallback(async (next: boolean) => {
    if (!enabled || !hash || !selectedUri || recordBusy) return;
    setRecordBusy(true); setError("");
    try {
      await requestStates({ action: "hide", queryHash: hash, uri: selectedUri, enabled: next });
      setHidden((old) => { const updated = new Set(old); if (next) updated.add(selectedUri); else updated.delete(selectedUri); return updated; });
      // Apply the visible state immediately and restart Results through the existing query refresh.
      onHiddenChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not change Hidden state."); }
    finally { setRecordBusy(false); }
  }, [enabled, hash, selectedUri, recordBusy, onHiddenChanged]);

  // Never manufacture counts from the currently displayed Results page.
  const shownCounts: Record<StateFacetName, number> = federatedCounts ?? { New: 0, Unseen: 0, Seen: 0, Starred: 0, Hidden: 0 };
  return { enabled, states, hidden, hasStates: enabled && (federatedCounts !== null || pageUris.length > 0 || Object.values(states).some((list) => list.length > 0) || hidden.size > 0),
    countScope: "query", federatedQuery, counts: shownCounts, selectedStates, toggleSelectedState,
    loading, error, recordBusy, selectedRecordStates: states[selectedUri] ?? [], selectedRecordHidden: hidden.has(selectedUri), toggleRecordState, toggleHidden };
}
