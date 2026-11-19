/**
 * Browser Pino logging and optional same-origin proxy diagnostics.
 * The Sheet's enabled/level preferences govern both application events and
 * network diagnostics; callers must not send raw RDF, SPARQL or credentials.
 */
import pino from "pino";
import { safeMaestroLogMessage, safeMaestroLogDetails } from "./maestro-log-sanitize";

export type BrowserLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** Pino's browser bundle uses the browser console; the server Pino transport stays server-only. */
const logger = pino({
  name: "maestro-browser",
  level: "silent",
  browser: { asObject: true },
});
let enabled = false;
let logLevel: BrowserLogLevel = "debug";
let installed = false;

/** Events are stable identifiers; the details allow-list prevents RDF/query leaks. */
export function logMaestroBrowser(level: BrowserLogLevel, event: string, ...details: unknown[]): void {
  if (!enabled) return;
  const fields = Object.assign({}, ...details.map(safeMaestroLogDetails)) as Record<string, unknown>;
  const safeEvent = safeMaestroLogMessage(event).replace(/[^a-zA-Z0-9._-]+/g, ".").slice(0, 96);
  logger[level]({ component: "maestro-browser", event: safeEvent, ...fields }, safeEvent);
}

/** One typed interface for client lifecycle, display, storage, and proxy events. */
export const browserLog = {
  trace: (event: string, ...details: unknown[]) => logMaestroBrowser("trace", event, ...details),
  debug: (event: string, ...details: unknown[]) => logMaestroBrowser("debug", event, ...details),
  info: (event: string, ...details: unknown[]) => logMaestroBrowser("info", event, ...details),
  warn: (event: string, ...details: unknown[]) => logMaestroBrowser("warn", event, ...details),
  error: (event: string, ...details: unknown[]) => logMaestroBrowser("error", event, ...details),
  fatal: (event: string, ...details: unknown[]) => logMaestroBrowser("fatal", event, ...details),
};

export function configureMaestroBrowserLogging(active: boolean, level: BrowserLogLevel): void {
  enabled = active;
  logLevel = level;
  logger.level = active ? level : "silent";
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
    browserLog.debug("proxy.request", { method: init?.method || (input instanceof Request ? input.method : "GET"),
      route: url.pathname, requestId });
    try {
      const response = await original(input, { ...init, headers: requestHeaders });
      const elapsedMs = Math.round(performance.now() - started);
      // Proxy 504 is an expected deadline outcome; don't surface it as a JS failure.
      const level: BrowserLogLevel = response.status === 504 ? "debug" : response.ok ? "info" :
        response.status < 500 ? "warn" : "error";
      logMaestroBrowser(level, "proxy.response", { route: url.pathname, status: response.status,
        elapsedMs, requestId, cache: response.headers.get("x-maestro-cache") });
      if (response.headers.get("x-maestro-incomplete") === "true") {
        browserLog.info("virtuoso.anytime", { route: url.pathname, requestId, optional: true });
      }
      const encoded = response.headers.get("x-maestro-diagnostic");
      if (encoded && response.status !== 504) {
        try {
          const diagnostic = JSON.parse(decodeURIComponent(escape(atob(encoded)))) as { event?: unknown; code?: unknown; status?: unknown };
          browserLog.debug("proxy.diagnostic", { requestId, code: diagnostic.code, status: diagnostic.status });
        } catch (error) { browserLog.debug("proxy.diagnostic.decode-failed", { requestId, error }); }
      }
      // Never print cloned upstream bodies: these can contain personal RDF, FCT
      // XML, SPARQL or authentication diagnostics. HTTP status is sufficient.
      return response;
    } catch (error) {
      const cancelled = (error instanceof Error && error.name === "AbortError") || init?.signal?.aborted;
      const timeout = error instanceof Error && (error.name === "TimeoutError" ||
        /aborted due to timeout|timed? out/i.test(error.message));
      if (!cancelled) logMaestroBrowser(timeout ? "debug" : "error", timeout ? "proxy.timeout" : "proxy.network-failure",
        { route: url.pathname, requestId, elapsedMs: Math.round(performance.now() - started), error });
      throw error;
    }
  };
}
