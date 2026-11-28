"use client";

import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { cachedFetchFct } from "@/lib/client-query-cache";
import { configuredTimeoutMs } from "@/lib/maestro-query-timeouts";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { readBlankNodeRecordLimits, MIB } from "./limits";
import { virtuosoRankFailure } from "@/lib/virtuoso-query-fallbacks";
import { buildBlankNodeRecordSparql, parseBlankNodeRecordBindings, type BNodeRecordBinding, type BlankNodeExpansion, type BlankNodeRecord } from "./index";

type Input = { queryXml: string; immediateParent?: string; preferredLanguage: string; signal: AbortSignal; expansion?: BlankNodeExpansion; retryRevision?: number };
type Result = { records: BlankNodeRecord[]; incomplete: boolean; query: string };
type Flight = { controller: AbortController; subscribers: number; promise: Promise<Result> };
// Pending-only single flight. Never cache a completed blank-node response.
// Cancelling one session cannot cancel another session's live subscription.
const pending = new Map<string, Flight>();

function rankFallback(query: string, diagnostic: string): string | null {
  if (!virtuosoRankFailure(diagnostic)) return null;
  const fallback = query.replace(/\bORDER\s+BY\s+DESC\s*\(\s*<LONG::IRI_RANK>\s*\(\s*\?[A-Za-z][A-Za-z0-9_]*\s*\)\s*\)\s*(?=(?:LIMIT|OFFSET|\}|$))/gi, " ");
  return fallback === query ? null : fallback;
}

export async function loadBlankNodeRecord(input: Input): Promise<Result> {
  input.signal.throwIfAborted();
  const document = new DOMParser().parseFromString(input.queryXml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid blank-node FCT query.");
  const addr = document.documentElement.getAttribute("addr") ?? "";
  if (!addr.includes("@")) throw new Error("Blank-node query requires an originating graph server.");
  const scopedGraph = addr.slice(0, addr.indexOf("@"));
  const graphs = scopedGraph && scopedGraph !== "$ALL$" ? [scopedGraph] : [];
  const limits = readBlankNodeRecordLimits();
  const rowLimit = limits.rows;
  const maxResponseBytes = limits.responseMiB * MIB;
  // Preserve the source page's offset. Limit the number of candidate terms
  // before joining any triples; a window exceeding the cap is incomplete.
  const view = Array.from(document.getElementsByTagName("*")).find(node => node.localName === "view");
  if (!view) throw new Error("Blank-node query has no view.");
  const originalLimit = Number(view.getAttribute("limit"));
  if (!Number.isSafeInteger(originalLimit) || originalLimit < 1) throw new Error("Invalid blank-node candidate window.");
  const seedLimit = Math.min(originalLimit, limits.window, rowLimit);
  const windowLimit = input.expansion ? Math.min(limits.window, rowLimit) : seedLimit;
  view.setAttribute("limit", String(seedLimit));
  const compiled = compileFctXmlToSparql(new XMLSerializer().serializeToString(document), undefined, false, false, false, false, undefined, input.preferredLanguage);
  if (compiled.view !== "list-values" || compiled.limit > seedLimit) throw new Error("Expected a bounded blank-node list-values query.");
  const query = buildBlankNodeRecordSparql({ compiledSelect: compiled.query, focusRelationship: compiled.focusRelationship,
    graphs, immediateParent: input.immediateParent, expansion: input.expansion, windowLimit,
    preferredLanguage: input.preferredLanguage, limit: rowLimit });
  const key = JSON.stringify([addr, query, configuredTimeoutMs("record-blank-node RecordDescription"), input.retryRevision ?? 0, maxResponseBytes]);
  let flight = pending.get(key);
  if (!flight || flight.controller.signal.aborted) {
    const controller = new AbortController();
    const execute = async (): Promise<Result> => {
      let actualQuery = query;
      for (let attempt = 0; attempt < 2; attempt++) {
        controller.signal.throwIfAborted();
        const response = await cachedFetchFct("/proxy/api/sparql", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: {"x-maestro-view-tab": "record", "x-maestro-view-ribbon": "session",  "Content-Type": "application/json", ...proxyDebugHeaders("record-blank-node", "RecordDescription"),
            ...(input.retryRevision ? { "X-Maestro-Component-Retry": "1" } : {}) },
          body: JSON.stringify({ addr, query: actualQuery, responseScope: "request", maxResponseBytes }),
        });
        const payload = await response.json() as { error?: string; details?: string; code?: string; results?: { bindings?: BNodeRecordBinding[] } };
        controller.signal.throwIfAborted();
        if (!response.ok) {
          if (response.status === 413 && payload.code === "RESPONSE_LIMIT_EXCEEDED") throw new Error(`Blank-node response exceeded the ${limits.responseMiB} MiB limit in the Sheet. Adjust the limit or narrow the query, then retry explicitly.`);
          if (response.status === 504 || payload.code === "UPSTREAM_TIMEOUT") throw new Error("The graph server did not return the blank-node window before the request deadline. Retry explicitly to reconstruct it.");
          const fallback = attempt === 0 ? rankFallback(actualQuery, `${payload.error ?? ""} ${payload.details ?? ""}`) : null;
          if (fallback) { actualQuery = fallback; continue; }
          throw new Error(payload.details || payload.error || `Blank-node Record SELECT failed (HTTP ${response.status}).`);
        }
        const bindings = payload.results?.bindings;
        if (!Array.isArray(bindings)) throw new Error("Invalid blank-node Record SELECT response.");
        const records = parseBlankNodeRecordBindings(bindings);
        if (!records.some(record => record.candidate)) throw new Error("No blank-node Records were returned in this response.");
        // An expansion window may be clipped by either the parent/node-pair
        // cap or the description row cap. Never present its size as a total.
        const pairs = records.reduce((n, record) => n + Math.max(1, record.parents.length), 0);
        return { records, query: actualQuery, incomplete: response.headers.get("x-maestro-incomplete") === "true" || bindings.length >= rowLimit ||
          (input.expansion ? pairs >= windowLimit || (input.expansion.kind === "reconstruct" && originalLimit > seedLimit) : originalLimit > seedLimit) };
      }
      throw new Error("Blank-node SELECT failed.");
    };
    const newFlight: Flight = { controller, subscribers: 0, promise: execute() };
    flight = newFlight;
    pending.set(key, newFlight);
    const clear = () => { if (pending.get(key) === newFlight) pending.delete(key); };
    void newFlight.promise.then(clear, clear);
  }
  const current = flight;
  current.subscribers++;
  return new Promise<Result>((resolve, reject) => {
    let done = false;
    const finish = (result?: Result, error?: unknown) => {
      if (done) return;
      done = true;
      input.signal.removeEventListener("abort", abort);
      current.subscribers--;
      if (current.subscribers === 0 && pending.get(key) === current) {
        pending.delete(key);
        current.controller.abort();
      }
      if (result) resolve(result); else reject(error);
    };
    const abort = () => finish(undefined, input.signal.reason ?? new DOMException("Aborted", "AbortError"));
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) { abort(); return; }
    void current.promise.then(result => finish(result), error => finish(undefined, error));
  });
}
