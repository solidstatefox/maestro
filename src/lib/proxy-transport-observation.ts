/** Observations of the browser-to-proxy hop, not of the RDF endpoint. */
export const PROXY_TRANSPORT_EVENT = "maestro:proxy-transport-observed";
export type ProxyTransportObservation = { state: "reachable" | "unavailable"; at: number };
let latest: ProxyTransportObservation | null = null;
// Per-document abort generation; never persisted or broadcast to another tab.
let queryGeneration = new AbortController();
export function stopProxyQueryGeneration(): void { queryGeneration.abort(); }
export function resumeProxyQueryGeneration(): void {
  if (queryGeneration.signal.aborted) queryGeneration = new AbortController();
}
export function proxyQuerySignal(signal?: AbortSignal | null): AbortSignal {
  const generation = queryGeneration.signal;
  generation.throwIfAborted();
  return signal ? AbortSignal.any([signal, generation]) : generation;
}
export const lastProxyTransportObservation = () => latest;
function publish(state: ProxyTransportObservation["state"]) {
  latest = { state, at: Date.now() };
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROXY_TRANSPORT_EVENT));
}
export async function observeProxyFetch(input: RequestInfo | URL, init?: RequestInit, transport: typeof fetch = fetch): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^\/proxy\/api\//.test(url)) return transport(input, init);
  // The signal remains attached through response body consumption. Cancellation
  // is not inferred from the pending-query display or an upstream HTTP status.
  if (/^\/proxy\/api\/(?:fct|sparql)(?:[/?]|$)/.test(url)) {
    const signal = proxyQuerySignal(init?.signal);
    init = { ...init, signal };
  }
  try {
    const response = await transport(input, init);
    init?.signal?.throwIfAborted();
    if (!init?.signal?.aborted) publish("reachable");
    return response;
  } catch (error) {
    if (init?.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    publish("unavailable");
    throw new Error(`Maestro proxy unavailable (${url.split("?")[0]}): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
/** No upstream status is inferred from the proxy's response status. */
export function observedUpstreamStatus(response: Response): number | null {
  if (response.headers.get("X-Maestro-Upstream-Source") !== "network") return null;
  const raw = response.headers.get("X-Maestro-Upstream-Status");
  if (!raw || !/^\d{3}$/.test(raw)) return null;
  const status = Number(raw);
  return status >= 100 && status <= 599 ? status : null;
}
