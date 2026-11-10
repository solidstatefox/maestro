"use client";

const POLICY_QUERY_ACTIONS = new Set([
  "addProperty", "removeProperty", "setPropertyValues", "setPropertyValue", "setRoleValue",
  "addNestedProperty", "addNestedPropertyOf", "addClass", "removeClass", "setRoleFilter",
  "setResultsPage", "showClassResults", "deleteNode", "setSearchText", "resetQuery", "setView",
  "setQueryAttribute", "setNodeAttribute", "setNodeText", "setValue", "insertNode", "replaceNode", "removeNode",
]);

/** Split a constrained action's argument list without evaluating source code. */
function splitPolicyActionArguments(source: string): string[] {
  const args: string[] = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; continue; }
    if (character === "{" || character === "[" || character === "(") depth += 1;
    else if (character === "}" || character === "]" || character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (source.slice(start).trim()) args.push(source.slice(start).trim());
  return args;
}

/** Parse only a direct call to an allowlisted query-update API; never eval template code. */
export function parsePolicyQueryAction(source: string, element: Element, recordUri: string): { method: string; args: unknown[] } {
  if (source.length > 4000) throw new Error("Template action is too long.");
  const match = source.trim().match(/^fctQueryTreeApi\.([A-Za-z][A-Za-z0-9]*)\(([\s\S]*)\)\s*;?$/);
  if (!match || !POLICY_QUERY_ACTIONS.has(match[1])) throw new Error("Only direct calls to Maestro's allowlisted query-update API are permitted in mui:action.");
  const rawArgs = splitPolicyActionArguments(match[2]);
  const args = rawArgs.map((raw) => {
    if (raw === "undefined") return undefined;
    if (raw === "record.uri") return recordUri;
    if (raw === "result.uri") return ((element.closest("[data-maestro-query-instance]") as HTMLElement | null)?.dataset.resultUri ?? (element as HTMLElement).dataset.resultUri ?? "");
    const dataBinding = raw.match(/^event\.currentTarget\.dataset\.([A-Za-z][A-Za-z0-9]*)$/);
    if (dataBinding) return (element as HTMLElement).dataset[dataBinding[1]] ?? "";
    if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(raw)) return JSON.parse(raw);
    if (raw.startsWith("\"") || raw.startsWith("[") || raw.startsWith("{")) {
      try { return JSON.parse(raw); } catch { throw new Error("Action arguments must be JSON literals or approved record/data bindings."); }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    throw new Error("Action arguments must be literals, record.uri, result.uri, or event.currentTarget.dataset.<name>.");
  });
  if (args.length === 0 || args[0] !== undefined) throw new Error("A mui:action must pass undefined as its first argument so Maestro applies the operation to the live query.");
  return { method: match[1], args };
}


import { useRef, useState } from "react";
export type RecordPolicyOption = { uri: string; label: string; recordShape: string; matchedClasses: string[]; templates: { uri: string; label: string }[]; template: string | null };

/** Per-record format choice and policy selection state. */
export function useRecordFormatSelection() {
  const [recordPolicies, setRecordPolicies] = useState<RecordPolicyOption[]>([]);
  const [recordPolicy, setRecordPolicy] = useState<RecordPolicyOption | null>(null);
  const [selectedRecordTemplateUri, setSelectedRecordTemplateUri] = useState("");
  // A user-selected format wins over automatic policy selection for that Record/query.
  const manualRecordFormatSelectionRef = useRef<{ recordUri: string; queryXml: string; policyUri: string; templateUri: string } | null>(null);
  return { recordPolicies, setRecordPolicies, recordPolicy, setRecordPolicy, selectedRecordTemplateUri, setSelectedRecordTemplateUri, manualRecordFormatSelectionRef };
}

/** Prefer a selected category that appears in the Record; otherwise use its first available rdf:type. */
export function resolveRecordFormatCategory(selectedCategories: string[], describedRecord: { direction: string; property: string; value: string }[]): string {
    const recordTypes = describedRecord
      .filter((item) => item.direction === "property" && item.property === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
      .map((item) => item.value);
    return selectedCategories.find((iri) => recordTypes.includes(iri))
      ?? selectedCategories[0] ?? recordTypes[0] ?? "";
}
