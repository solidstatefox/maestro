import { dispatchMaestroService } from "@/app/proxy/api/service/operations";
import { NextResponse } from "next/server";
import { resolveOpenApiOperation } from "@/lib/openapi-registry";

// OTC survey streams use the same approved service transport.
export const maxDuration = 300;

/** Reviewed OpenAPI integrations and the allowlisted local Maestro operations
 * share one service HTTP transport. External URLs remain server-controlled;
 * no arbitrary proxying or redirects are introduced by the migration. */
export async function POST(request: Request): Promise<Response> {
  if (new URL(request.url).searchParams.get("service") === "maestro")
    return dispatchMaestroService(request, "POST");
  try {
    if (Number(request.headers.get("content-length") ?? "0") > 650000)
      return NextResponse.json({ error: "Service request too large" }, { status: 413 });
    const body = await request.json() as { service?: unknown; operationId?: unknown; parameters?: unknown; payload?: unknown };
    const operation = typeof body.service === "string" && typeof body.operationId === "string"
      ? resolveOpenApiOperation(body.service, body.operationId) : null;
    if (!operation) return NextResponse.json({ error: "Unknown OpenAPI operation" }, { status: 404 });
    const params = body.parameters ?? {};
    if (!params || typeof params !== "object" || Array.isArray(params))
      return NextResponse.json({ error: "Invalid service parameters" }, { status: 400 });
    const entries = Object.entries(params);
    if (entries.length > 16 || entries.some(([name, value]) => !operation.parameters.includes(name) || typeof value !== "string" || value.length > 250 || /[\x00-\x1f]/.test(value)))
      return NextResponse.json({ error: "Parameters do not match the OpenAPI operation" }, { status: 400 });
    const url = new URL(operation.path, operation.base);
    for (const [name, value] of entries) url.searchParams.set(name, value as string);
    // OpenAPI POST operations use a reviewed destination and server-side
    // credentials. The browser never supplies the upstream URL or API key.
    if (operation.method === "POST") {
      const upstreamBody = JSON.stringify(body.payload ?? null);
      if (upstreamBody.length > (operation.maxRequestBytes ?? 0) || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload))
        return NextResponse.json({error:"Invalid OpenAPI request body"},{status:400});
      // The reviewed OpenAPI chat operation accepts a bounded standard
      // chat-completions request, not an arbitrary prompt or upstream model.
      if (body.service === "iteracompute") {
        const value = body.payload as Record<string, unknown>;
        const messages = value.messages;
        const allowed = new Set(["model", "messages", "reasoning", "enable_thinking", "thinking_budget", "max_tokens"]);
        if (Object.keys(value).some(key => !allowed.has(key)) ||
            (value.reasoning !== undefined && typeof value.reasoning !== "boolean") ||
            (value.enable_thinking !== undefined && typeof value.enable_thinking !== "boolean") ||
            (value.thinking_budget !== undefined &&
              (typeof value.thinking_budget !== "number" || !Number.isInteger(value.thinking_budget) ||
                value.thinking_budget < 0 || value.thinking_budget > 8192)))
          return NextResponse.json({error:"Unrecognized chat-completions options."},{status:400});
        if (value.model !== "qwen/qwen3.8-27b" || !Array.isArray(messages) || messages.length < 1 || messages.length > 40 ||
            !messages.every(item => item && typeof item === "object" &&
              ["user", "assistant"].includes((item as {role?: string}).role ?? "") &&
              typeof (item as {content?: unknown}).content === "string" &&
              (item as {content:string}).content.trim().length > 0 &&
              (item as {content:string}).content.length <= 30000) ||
            (messages[messages.length-1] as {role?: string}).role !== "user" ||
            typeof value.max_tokens !== "number" || !Number.isInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 11000) {
          return NextResponse.json({error:"Invalid OpenAPI chat-completions payload."},{status:400});
        }
      }
      const secret = operation.secretEnv ? process.env[operation.secretEnv]?.trim() : "";
      if (operation.secretEnv && !secret) return NextResponse.json({error:"The selected service is not configured."},{status:503});
      const response = await fetch(url, {
        method: "POST", redirect: "manual", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json",
          ...(secret ? {Authorization: `Bearer ${secret}`} : {}) },
        body: upstreamBody,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(operation.timeoutMs ?? 30000)]),
      });
      const text = await response.text();
      if (text.length > 1500000) return NextResponse.json({error:"Service response too large"},{status:502});
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { return NextResponse.json({error:"Service returned invalid JSON"},{status:502}); }
      return NextResponse.json(parsed, {status: response.status >= 400 && response.status < 600 ? response.status : response.ok ? 200 : 502,
        headers: {"Cache-Control":"no-store"}});
    }
    const response = await fetch(url, {
      method: operation.method, redirect: "manual", cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Maestro/1.0 (OpenAPI service transport)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || response.status >= 300) return NextResponse.json({ error: `External service HTTP ${response.status}` }, { status: 502 });
    const mime = response.headers.get("content-type") ?? "";
    if (!/\b(?:json|javascript)\b|\+json/i.test(mime)) return NextResponse.json({ error: "Service returned non-JSON content" }, { status: 502 });
    if (Number(response.headers.get("content-length") ?? "0") > 1000000) return NextResponse.json({ error: "Service response too large" }, { status: 502 });
    const text = await response.text();
    if (text.length > 1000000) return NextResponse.json({ error: "Service response too large" }, { status: 502 });
    const data: unknown = JSON.parse(text);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Service call failed" }, { status: 502 });
  }
}

/** Authenticated Maestro operations and public OpenAPI services share the
 * approved /service transport. Existing GET operations are explicitly mapped. */
export async function GET(request: Request): Promise<Response> {
  return dispatchMaestroService(request, "GET");
}
