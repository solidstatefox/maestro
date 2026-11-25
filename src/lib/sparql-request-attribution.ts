import { observeProxyFetch } from "./proxy-transport-observation";
/** A SPARQL proxy request must have an owning component, never a URL-derived label. */
export function requireSparqlAttribution(input: RequestInfo | URL, init?: RequestInit): void {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!/\/proxy\/api\/sparql(?:[/?]|$)/.test(url)) return;
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.get("x-maestro-debug-source")?.startsWith("urn:") || !headers.get("x-maestro-debug-component")?.trim()) {
    throw new Error("SPARQL request requires an owning component and source URN.");
  }
}
export function attributedSparqlFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  requireSparqlAttribution(input, init);
  return observeProxyFetch(input, init);
}
