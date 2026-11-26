/** Server-only HTTP transport for read queries. The SQL execution budget belongs
 * to Virtuoso; HTTP delivery is not a second execution clock. Undici fetch sets
 * its own per-dispatch header/body deadlines, so override those at the dispatcher
 * boundary as well as removing application AbortSignal.timeout calls.
 * Connection errors, intentional cancellation and upstream HTTP errors remain
 * real failures. Do not disable TLS verification or follow redirects. */
import { Agent } from "undici";

export function withoutReadDeliveryDeadline<T extends object>(options: T): T & { headersTimeout: 0; bodyTimeout: 0 } {
  return { ...options, headersTimeout: 0, bodyTimeout: 0 };
}
class VirtuosoReadAgent extends Agent {
  override dispatch(...[options, handler]: Parameters<Agent["dispatch"]>): ReturnType<Agent["dispatch"]> {
    return super.dispatch(withoutReadDeliveryDeadline(options), handler);
  }
}
const dispatcher = new VirtuosoReadAgent();
export function fetchVirtuosoRead(url: string, init: RequestInit, transport: typeof fetch = fetch): Promise<Response> {
  // A dedicated dispatcher prevents the read policy from leaking into health,
  // login control-plane or service requests. Forward only the owner's signal.
  const options: RequestInit & { dispatcher: Agent } = { ...init, dispatcher };
  return transport(url, options);
}
