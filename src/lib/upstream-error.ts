/**
 * Turn a thrown error into the most specific message available.
 *
 * Node's fetch (undici) throws `TypeError: fetch failed` and hides the real reason (ECONNREFUSED, ENOTFOUND,
 * certificate errors, timeouts...) in `error.cause`. This walks the cause chain and returns what the network
 * layer or the graph server actually reported instead of the generic wrapper text.
 */
const GENERIC_MESSAGES = new Set(["fetch failed", "failed to fetch", "network error", "load failed", "terminated"]);

export function describeUpstreamError(error: unknown, fallback = "Unknown error"): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; current && depth < 6 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) {
      const withCode = current as Error & { code?: unknown; syscall?: unknown; hostname?: unknown; address?: unknown; port?: unknown };
      const message = current.message.trim();
      const technical = [withCode.code, withCode.syscall, withCode.hostname ?? (withCode.address ? `${withCode.address}${withCode.port ? `:${withCode.port}` : ""}` : undefined)]
        .filter((value) => value !== undefined && value !== "")
        .map(String);
      const isGeneric = GENERIC_MESSAGES.has(message.toLowerCase());
      // Skip the generic wrapper text itself, but never drop a message that carries detail.
      if (message && !isGeneric && !parts.includes(message)) parts.push(message);
      for (const item of technical) if (!parts.some((part) => part.includes(item))) parts.push(item);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      const text = typeof current === "string" ? current : (() => { try { return JSON.stringify(current); } catch { return String(current); } })();
      if (text && !parts.includes(text)) parts.push(text);
      break;
    }
  }
  if (error instanceof Error && error.name === "TimeoutError" && !parts.some((part) => /timed? ?out|timeout/i.test(part))) parts.push("the graph server did not respond before the timeout");
  if (parts.length === 0) {
    const generic = error instanceof Error ? error.message.trim() : "";
    return generic ? `${generic} (the network layer gave no further detail)` : fallback;
  }
  return parts.join(": ");
}
