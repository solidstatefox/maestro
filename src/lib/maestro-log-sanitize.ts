/**
 * Shared, dependency-free privacy boundary for browser logging. Do not log
 * arbitrary graph/query objects, request bodies, credential values or stacks.
 */
/** Redact unexpected string content even when it arrives as an error message. */
export function safeMaestroLogMessage(value: string): string {
  return value
    .replace(/\b(?:https?|gttps?|gttp):\/\/[^\s"'<>]+/gi, "[IRI]")
    .replace(/\burn:[^\s"'<>]+/gi, "[IRI]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(password|token|authorization|cookie|secret)\s*[:=]\s*[^\s,}]+/gi, "$1=[REDACTED]")
    .replace(/\b(?:SELECT|ASK|CONSTRUCT|DESCRIBE|PREFIX|INSERT|DELETE)\b[\s\S]*/i, "[SPARQL]")
    .slice(0, 180);
}

/** Allow-list rather than serializing arbitrary UI objects/graph data. */
export function safeMaestroLogDetails(value: unknown): Record<string, unknown> {
  if (value instanceof Error || (typeof DOMException !== "undefined" && value instanceof DOMException)) {
    const name = value.name || "Error";
    const timeout = name === "TimeoutError" || /aborted due to timeout|timed? out/i.test(value.message);
    return { errorName: safeMaestroLogMessage(name), ...(timeout ? { timeout: true } : {}) };
  }
  if (Array.isArray(value)) return { itemCount: value.length };
  if (!value || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const permitted = new Set([
    "component", "source", "route", "method", "requestId", "status", "code",
    "elapsedMs", "durationMs", "timeoutMs", "cache", "optional", "kind",
    "count", "itemCount", "queryRevision", "incomplete", "httpStatus",
  ]);
  for (const [key, item] of Object.entries(obj)) {
    if (key === "error" || key === "err" || key === "cause") {
      Object.assign(result, safeMaestroLogDetails(item));
    } else if (permitted.has(key)) {
      if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
      else if (typeof item === "boolean") result[key] = item;
      else if (key === "route" && typeof item === "string" && /^\/proxy\/api\/[a-z0-9/-]+$/i.test(item)) result[key] = item;
      else if (typeof item === "string" && !/[\s<>"'\/\\?#]/.test(item) && item.length <= 80)
        result[key] = item;
    }
  }
  return result;
}
