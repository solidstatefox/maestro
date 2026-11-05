/** Structured proxy logger. Server-only: never import this module into client components. */
import pino from "pino";
import { NextResponse } from "next/server";
import { describeUpstreamError } from "./upstream-error";

export type MaestroLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const logger = pino({ level: process.env.MAESTRO_LOG_LEVEL || "info", redact: {
  paths: ["req.headers.authorization", "req.headers.cookie", "authHeader", "password", "token", "cookie", "authorization"],
  censor: "[REDACTED]",
} });
export function proxyLog(level: MaestroLevel, event: string, details: Record<string, unknown> = {}): void {
  logger[level]({ component: "maestro-proxy", event, ...details }, event);
}

/** Sanitized, bounded diagnostic metadata. Upstream bodies may contain private RDF and are not included in response headers. */
export function browserDiagnosticHeaders(request: Request, event: string, details: Record<string, unknown> = {}): HeadersInit {
  const level = request.headers.get("x-maestro-log-level");
  const requestId = request.headers.get("x-maestro-debug-request") || "";
  const headers: Record<string, string> = { "X-Maestro-Debug-Request": requestId };
  if (!level || !["trace", "debug", "info", "warn", "error", "fatal"].includes(level)) return headers;
  const diagnostic = JSON.stringify({ level: "error", event, requestId,
    source: request.headers.get("x-maestro-debug-source") || "", ...details });
  headers["X-Maestro-Diagnostic"] = Buffer.from(diagnostic.slice(0, 5000), "utf8").toString("base64");
  return headers;
}

export function proxyFailure(request: Request, operation: string, error: unknown, extra: Record<string, unknown> = {}): NextResponse {
  const message = describeUpstreamError(error, `${operation} failed`);
  const timedOut = error instanceof Error && (error.name === "TimeoutError" || /aborted due to timeout|timed? out/i.test(message));
  const statusValue = error && typeof error === "object" && "status" in error ? Number(error.status) : NaN;
  const status = timedOut ? 504 : Number.isInteger(statusValue) && statusValue >= 400 && statusValue <= 599 ? statusValue : 502;
  const upstreamBody = error && typeof error === "object" && "responseBody" in error ? String(error.responseBody) : "";
  const code = timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR";
  const requestId = request.headers.get("x-maestro-debug-request") || "";
  proxyLog("error", operation, { message, code, status, requestId, ...extra, err: error });
  return NextResponse.json({ error: message, code, status, requestId,
    ...(upstreamBody ? { upstreamBody: upstreamBody.slice(0, 16000), upstreamBodyTruncated: upstreamBody.length > 16000 } : {}),
  }, { status, headers: browserDiagnosticHeaders(request, operation, { message, code, status, ...extra }) });
}
