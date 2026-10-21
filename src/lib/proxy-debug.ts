let proxyDebugSequence = 0;

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function compactComponentId(componentId: string): string {
  const readable = componentId.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 44) || "component";
  return `${readable}-${fingerprint(componentId)}`;
}

export function proxyDebugFingerprint(value: string): string {
  return fingerprint(value);
}

/** Browser-to-proxy attribution only; proxy routes do not forward these headers upstream. */
export function proxyDebugHeaders(source: string, componentId: string): Record<string, string> {
  proxyDebugSequence += 1;
  return {
    "X-Maestro-Debug-Source": source,
    "X-Maestro-Debug-Component": compactComponentId(componentId),
    "X-Maestro-Debug-Request": `${Date.now().toString(36)}-${proxyDebugSequence.toString(36)}`,
  };
}

/** Log caller attribution at the proxy boundary, without logging query contents or RDF data. */
export function logProxyCaller(
  request: Request,
  route: string,
  fallback?: { source?: unknown; component?: unknown; requestId?: unknown },
): void {
  const source = request.headers.get("x-maestro-debug-source") ?? (typeof fallback?.source === "string" ? fallback.source : null);
  const component = request.headers.get("x-maestro-debug-component") ?? (typeof fallback?.component === "string" ? fallback.component : null);
  const requestId = request.headers.get("x-maestro-debug-request") ?? (typeof fallback?.requestId === "string" ? fallback.requestId : null);
  if (!source && !component && !requestId) return;
  console.info("[Maestro proxy caller]", { route, source, component, requestId });
}
