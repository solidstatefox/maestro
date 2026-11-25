/** A protected Digest endpoint is a transport address, not a separate registered server. */
export const PERSONAL_SPARQL_HEALTH_EVENT = "maestro:personal-sparql-health";
export function signalPersonalHealth(endpointUrl: string, status: number): void {
  if (typeof window === "undefined" || !/^https?:\/\//i.test(endpointUrl)) return;
  // A history UPDATE returning 204 must not cause a recursive health write.
  if (!(status === 200 || status === 401 || status === 403 || status >= 500)) return;
  window.dispatchEvent(new CustomEvent(PERSONAL_SPARQL_HEALTH_EVENT, { detail: { endpointUrl, status, at: Date.now() } }));
}
