/** Optional browser-side diagnostics for all same-origin Maestro proxy calls. */
export type BrowserLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const weights: Record<BrowserLogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
let enabled = false;
let logLevel: BrowserLogLevel = "debug";
let installed = false;

function emit(level: BrowserLogLevel, label: string, data: unknown): void {
  if (!enabled || weights[level] < weights[logLevel]) return;
  const log = level === "fatal" || level === "error" ? console.error : level === "warn" ? console.warn : level === "info" ? console.info : console.debug;
  log(`[Maestro ${level.toUpperCase()}] ${label}`, data);
}

export function configureMaestroBrowserLogging(active: boolean, level: BrowserLogLevel): void {
  enabled = active;
  logLevel = level;
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : String(input), window.location.href); }
    catch { return original(input, init); }
    if (!enabled || url.origin !== window.location.origin || !url.pathname.startsWith("/proxy/api/"))
      return original(input, init);
    const requestHeaders = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    requestHeaders.set("X-Maestro-Log-Level", logLevel);
    const started = performance.now();
    const requestId = requestHeaders.get("X-Maestro-Debug-Request") || "";
    emit("debug", "proxy.request", { method: init?.method || (input instanceof Request ? input.method : "GET"), url: url.pathname, requestId });
    try {
      const response = await original(input, { ...init, headers: requestHeaders });
      const elapsedMs = Math.round(performance.now() - started);
      const level = response.ok ? "info" : "error";
      emit(level, "proxy.response", { url: url.pathname, status: response.status, elapsedMs, requestId,
        cache: response.headers.get("x-maestro-cache") });
      if (response.headers.get("x-maestro-incomplete") === "true") {
        emit("warn", "virtuoso.anytime", { url: url.pathname, requestId, source: requestHeaders.get("x-maestro-debug-source"),
          message: "Virtuoso reported incomplete results; all returned rows are retained.",
          sqlState: response.headers.get("x-maestro-upstream-sql-state") });
      }
      const encoded = response.headers.get("x-maestro-diagnostic");
      if (encoded) {
        try { emit("error", "proxy.diagnostic", JSON.parse(decodeURIComponent(escape(atob(encoded))))); }
        catch { emit("warn", "proxy.diagnostic.decode", { requestId }); }
      }
      if (!response.ok && weights[logLevel] <= weights.error) {
        try {
          const body = await response.clone().text();
          emit("error", "proxy.upstream-response", { url: url.pathname, status: response.status, body: body.slice(0, 16000),
            truncated: body.length > 16000, requestId });
        } catch (error) { emit("warn", "proxy.response-read-failed", { error: String(error), requestId }); }
      }
      return response;
    } catch (error) {
      emit("error", "proxy.network-failure", { url: url.pathname, requestId, elapsedMs: Math.round(performance.now() - started), error });
      throw error;
    }
  };
}
