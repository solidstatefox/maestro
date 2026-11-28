import { sanitizeUpstreamDiagnostic } from "./upstream-error";
export type PredicateQueryTraceEntry = { label: string; query: string; language: "xml" | "sparql"; endpoint?: string };
const xml = (value: string) => sanitizeUpstreamDiagnostic(value, Infinity)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|\p{Surrogate}/gu, "\ufffd")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
/** Only analytical responses carry this extension. No new transport or extra reads. */
export function appendPredicateQueryTrace(body: string, fct: string, entries: readonly PredicateQueryTraceEntry[]): string {
  const trace = [{label:"FCT (effective request)",query:fct,language:"xml" as const}, ...entries];
  const extension = `<fct:query-trace>${trace.map(entry => `<fct:request language="${entry.language}" label="${xml(entry.label)}"${entry.endpoint ? ` endpoint="${xml(entry.endpoint)}"` : ""}>${xml(entry.query)}</fct:request>`).join("")}</fct:query-trace>`;
  return body.replace(/<\/fct:facets>$/, () => extension + "</fct:facets>");
}
export async function tracePredicateResponse(response: Response, fct: string, entries: readonly PredicateQueryTraceEntry[]): Promise<Response> {
  return new Response(appendPredicateQueryTrace(await response.text(), fct, entries), {status:response.status,statusText:response.statusText,headers:response.headers});
}
