/** Stable keys; graph IRIs come exclusively from graph/graph-registry.json. */
import registry from "../../../graph/graph-registry.json";
export const GRAPH = {
  STATE_MACHINES: "state-machines", STATUS: "status", SHACL_POLICIES: "shacl-policies",
  APPBAR: "appbar", BOOKMARKS: "bookmarks", HISTORY: "history",
  ONTOLOGY_CACHE: "ontology-cache", GRAPHS: "graphs", GRAPH_SERVERS: "graph-servers", POLICY_APPROVALS: "policy-approvals", ONTOLOGY: "ontology", OTC_TRANSCODERS: "otc-transcoders", KINDS: "kinds",
} as const;
export type GraphKey = typeof GRAPH[keyof typeof GRAPH];
const entries = Object.entries(registry) as Array<[GraphKey, string]>;
const templates: ReadonlyMap<GraphKey, string> = new Map(entries);
export function resolveGraph(key: GraphKey, base: string): string {
  const template = templates.get(key);
  if (!template || !/^\{base\}(?:\/|#)/.test(template)) throw new Error(`Missing or invalid graph registry entry: ${key}`);
  if (!/^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(base)) throw new Error("Invalid personal graph base URI.");
  return template.replace("{base}", base.replace(/\/+$/, ""));
}
export function graphRegistry(): ReadonlyMap<GraphKey, string> { return templates; }
