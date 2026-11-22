import type { EndpointOption } from "@/canvas/top/appbar";
import { graphServerUrlMatches } from "@/lib/graph-server-health";

/** A health probe observes the selected server. It is not an FCT query and
 * must not wait for URL hydration, a nonempty query addr, or Results readiness.
 *
 * Once an authoritative addr exists it takes precedence over a stale saved
 * dropdown preference while the graph-server selection actor reconciles IDs.
 * Registry IDs are presentation keys; the URL is the execution identity. */
export function resolveSelectedGraphHealthTarget(
  endpoints: readonly EndpointOption[],
  selectedEndpointId: string,
  queryServerUrl: string | null,
): { endpoint: EndpointOption; testedUrl: string } | null {
  const addressed = queryServerUrl?.trim() ?? "";
  if (addressed) {
    const endpoint = endpoints.find((item) => graphServerUrlMatches(item.url, addressed, item.schemeInferred));
    return endpoint ? { endpoint, testedUrl: addressed } : null;
  }
  const endpoint = endpoints.find((item) => item.id === selectedEndpointId);
  return endpoint ? { endpoint, testedUrl: endpoint.url } : null;
}
