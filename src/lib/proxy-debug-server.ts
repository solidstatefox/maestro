/** Server-side request correlation using the shared Pino logger. */
import { proxyLog } from "./maestro-logger";

export function logProxyCaller(
  request: Request,
  route: string,
  fallback?: { source?: unknown; component?: unknown; requestId?: unknown },
): void {
  const source = request.headers.get("x-maestro-debug-source") ?? (typeof fallback?.source === "string" ? fallback.source : "");
  const component = request.headers.get("x-maestro-debug-component") ?? (typeof fallback?.component === "string" ? fallback.component : "");
  const requestId = request.headers.get("x-maestro-debug-request") ?? (typeof fallback?.requestId === "string" ? fallback.requestId : "");
  proxyLog("info", "proxy.request", { route, source, component, requestId, method: request.method });
}
