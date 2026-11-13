"use client";

import { parseFctQueryXml, readGraphServerFromQueryXml, readShareableUiState, copyRibbonUrlParams, type ShareableUiState } from "@/canvas/utils/query-controller";
import { serializeFctQuery } from "@/lib/fct-query-api";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { toast } from "@/components/ui/toast";

/** History operates against the one live query controller, injected by the workspace. */
export function createHistoryActionRestorer({
  synchronizeFctEndpointSelection,
  restoreQueryAndUiState,
  historyVisitQueryRef,
  historyVisitIdRef,
  clearPendingHistoryVisit,
  setRootSearchExpanded,
  setHistoryBookmarkId,
  setHistoryActionMenu,
}: {
  synchronizeFctEndpointSelection: (serverUri: string) => Promise<void>;
  restoreQueryAndUiState: (xml: string | null, state: ShareableUiState | null, historyId?: string | null) => boolean;
  historyVisitQueryRef: { current: string };
  historyVisitIdRef: { current: string };
  clearPendingHistoryVisit: () => void;
  setRootSearchExpanded: (value: boolean) => void;
  setHistoryBookmarkId: (value: string) => void;
  setHistoryActionMenu: (value: "backward" | "forward" | null) => void;
}): (historyId: string) => Promise<void> {
  return async function restoreHistoryActionItem(historyId: string): Promise<void> {
    try {
      const response = await fetch("/proxy/api/service?service=maestro&operationId=query-favorites", { method: "POST", headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-history-actions", "RestoreHistoryAction") }, body: JSON.stringify({ action: "getHistoryItem", historyId }), cache: "no-store" });
      const payload = await response.json() as { found?: boolean; queryXml?: string; stateUrl?: string; error?: string };
      if (!response.ok || !payload.found || !payload.queryXml) throw new Error(payload.error ?? "Could not load this History item.");
      const tree = parseFctQueryXml(payload.queryXml);
      if (!tree) throw new Error("The selected History item contains invalid FCT query XML.");
      const serverId = readGraphServerFromQueryXml(payload.queryXml);
      if (!serverId) throw new Error("The History item does not identify a graph server in addr.");
      // Resolve the selected graph server before publishing the restored FCT query.
      await synchronizeFctEndpointSelection(serverId);
      const savedUrl = payload.stateUrl ? new URL(payload.stateUrl, window.location.href) : null;
      const restoredUiState = savedUrl ? readShareableUiState(savedUrl.search) : null;
      historyVisitQueryRef.current = serializeFctQuery(tree);
      historyVisitIdRef.current = historyId;
      clearPendingHistoryVisit();
      setRootSearchExpanded(false);
      restoreQueryAndUiState(payload.queryXml, restoredUiState, historyId);
      setHistoryBookmarkId(historyId);
      const params = new URLSearchParams(window.location.search);
      params.set("q", payload.queryXml);
      params.set("history", historyId);
      if (savedUrl) copyRibbonUrlParams(savedUrl.searchParams, params);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
      setHistoryActionMenu(null);
    } catch (error) {
      toast.add({ title: "Could not restore History item", description: error instanceof Error ? error.message : "The History item could not be restored.", type: "error" });
    }
  };
}

  /** Describe the first XML-tree delta between two query snapshots for History replay. */
export function deriveHistoryAction(previousXml: string, nextXml: string): { operator: "+" | "-"; xpath: string; value?: string } | null {
    if (!previousXml || !nextXml || previousXml === nextXml) return null;
    type Entry = { signature: string; value: string };
    const flatten = (xml: string) => {
      const document = new DOMParser().parseFromString(xml, "application/xml");
      if (document.querySelector("parsererror")) return new Map<string, Entry>();
      const entries = new Map<string, Entry>();
      const walk = (element: Element, path: string) => {
        const siblings = element.parentElement ? Array.from(element.parentElement.children).filter((item) => item.localName === element.localName) : [element];
        const index = Math.max(1, siblings.indexOf(element) + 1);
        const attributes = Array.from(element.attributes).map((attribute) => `${attribute.name}=${attribute.value}`).sort().join(";");
        const directText = Array.from(element.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent ?? "").join("").trim();
        const xpathLiteral = (value: string) => value.includes("'") && value.includes('"')
          ? `concat(${value.split("'").map((part, i) => `${i ? `, "'", ` : ""}'${part}'`).join("")})`
          : value.includes("'") ? `\"${value}\"` : `'${value}'`;
        const identityPredicates = Array.from(element.attributes)
          .filter((attribute) => ["iri", "datatype", "op", "id", "type", "exclude", "property"].includes(attribute.name))
          .map((attribute) => `[@${attribute.name}=${xpathLiteral(attribute.value)}]`).join("");
        const textPredicate = directText ? `[.=${xpathLiteral(directText)}]` : "";
        const currentPath = `${path}/${element.localName}${identityPredicates}${textPredicate}[${index}]`;
        entries.set(currentPath, { signature: `${element.localName}|${attributes}|${directText}`, value: directText || attributes || element.localName });
        Array.from(element.children).forEach((child) => walk(child, currentPath));
      };
      if (document.documentElement) walk(document.documentElement, "");
      return entries;
    };
    const before = flatten(previousXml), after = flatten(nextXml);
    const added = [...after].find(([path, entry]) => !before.has(path) || before.get(path)?.signature !== entry.signature);
    const removed = [...before].find(([path, entry]) => !after.has(path) || after.get(path)?.signature !== entry.signature);
    if (added && (!removed || added[0].split("/").length >= removed[0].split("/").length)) {
      return { operator: "+", xpath: added[0], value: added[1].value };
    }
    if (removed) return { operator: "-", xpath: removed[0], value: removed[1].value };
    return null;
  }

