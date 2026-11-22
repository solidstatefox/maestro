import { describeUpstreamError, sanitizeUpstreamDiagnostic } from "@/lib/upstream-error";
import { NextResponse } from "next/server";
import { resolveOpenApiOperation } from "@/lib/openapi-registry";
import { validateOpenAiChatPayload } from "@/lib/openai-chat-completions";
import { getCourtesyGraphServerDigest, getCourtesyGraphServerSnapshot } from "@/lib/personal-sparql";
import { openProxyQueryTelemetry } from "@/lib/proxy-query-telemetry";
import { processUriObservationBatch } from "@/lib/uri-observation-service";

// OTC survey streams use the same approved service transport.
export const maxDuration = 300;

/** OpenAPI-only allowlist router. The SPA selects a registered description
 * and operationId; this route forwards the protocol request and response.
 * No SHACL, SPARQL, XSLT, OTC, provider or Maestro application RPC runs here. */
export async function POST(request: Request): Promise<Response> {
  if (new URL(request.url).searchParams.get("service") === "maestro")
    return NextResponse.json({error:"Maestro application operations now execute in the browser."},{status:410});
  try {
    // The personal key is supplied to the same-origin server, never to an arbitrary upstream URL.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return NextResponse.json({ error: "Cross-origin service operation is not allowed." }, { status: 403 });
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
    // A registered local OpenAPI service is handled here; no user-specified
    // destination or credentials are forwarded to a third-party host.
    if (operation.serviceKey === "maestroTransport") {
      if (operation.operationId === "subscribeQueryEvents") {
        const id = (params as Record<string,string>).id ?? "";
        return openProxyQueryTelemetry(request, id);
      }
      if (operation.operationId === "courtesyGraphServers") {
        const value = body.payload;
        if (!value || typeof value !== "object" || Array.isArray(value))
          return NextResponse.json({error:"Invalid courtesy action"},{status:400});
        const {action,digest} = value as {action?:unknown;digest?:unknown};
        if (action === "check") {
          if (typeof digest !== "string" || (digest !== "" && !/^sha256:[0-9a-f]{64}$/.test(digest)))
            return NextResponse.json({error:"Invalid courtesy digest"},{status:400});
          const current = await getCourtesyGraphServerDigest();
          return NextResponse.json({digest:current,changed:digest!==current},{headers:{"Cache-Control":"no-store"}});
        }
        if (action === "list") {
          const {digest,endpoints} = await getCourtesyGraphServerSnapshot();
          return NextResponse.json({digest,endpoints},{headers:{"Cache-Control":"no-store"}});
        }
        return NextResponse.json({error:"Unknown courtesy action"},{status:400});
      }
      if (operation.operationId === "recordUriObservations")
        return processUriObservationBatch(request, body.payload);
      return NextResponse.json({error:"Unknown local OpenAPI operation"},{status:404});
    }
    // OpenAPI paths contain URI-template variables. Validate each requested
    // path parameter before substitution; query parameters remain allowlisted.
    let path=operation.path;
    for(const name of operation.pathParameters??[]){
      const value=(params as Record<string,string>)[name];
      if(!value || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
        return NextResponse.json({error:`Invalid OpenAPI path parameter ${name}`},{status:400});
      path=path.replace(`{${name}}`,encodeURIComponent(value));
    }
    if(path.includes("{"))return NextResponse.json({error:"Missing OpenAPI path parameter"},{status:400});
    const url = new URL(path, operation.base);
    for (const [name, value] of entries)
      if(!(operation.pathParameters??[]).includes(name)) url.searchParams.set(name,value as string);
    // OpenAPI POST operations use a reviewed server-controlled destination.
    // A browser-supplied IteraCompute key is scoped to this one operation; the browser
    // can never specify the upstream URL, and Maestro never persists that key.
    if (operation.method === "POST") {
      const upstreamBody = JSON.stringify(body.payload ?? null);
      if (upstreamBody.length > (operation.maxRequestBytes ?? 0) || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload))
        return NextResponse.json({error:"Invalid OpenAPI request body"},{status:400});
      // Reviewed OpenAI-compatible text Chat Completions schema. Provider-specific
      // thinking extensions remain optional, while standard sampling and SSE
      // fields are now accepted. Never permit an arbitrary upstream URL.
      if (operation.serviceKey === "iteracompute") {
        const problem = validateOpenAiChatPayload(body.payload);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      }
      const suppliedKey = operation.serviceKey === "iteracompute" ? request.headers.get("x-maestro-iteracompute-key")?.trim() ?? "" : "";
      if (suppliedKey && (suppliedKey.length > 512 || /[\x00-\x1f\x7f]/.test(suppliedKey)))
        return NextResponse.json({ error: "Invalid IteraCompute credential." }, { status: 400 });
      const secret = suppliedKey;
      if (operation.serviceKey === "iteracompute" && !secret) return NextResponse.json({error:"Configure an IteraCompute API key in Sheet → Maestro controls."},{status:401});
      const response = await fetch(url, {
        method: "POST", redirect: "manual", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: operation.serviceKey === "iteracompute" && (body.payload as {stream?:boolean}).stream ? "text/event-stream" : "application/json",
          ...(secret ? {Authorization: `Bearer ${secret}`} : {}) },
        body: upstreamBody,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(operation.timeoutMs ?? 30000)]),
      });
      // Forward OpenAI's streaming SSE unchanged, including usage deltas and
      // [DONE]. Cancel upstream on client disconnect; cap total streamed bytes.
      if (operation.serviceKey === "iteracompute" && (body.payload as {stream?:boolean}).stream && response.ok) {
        const mime = response.headers.get("content-type") ?? "";
        if (!mime.includes("text/event-stream") || !response.body)
          return NextResponse.json({ error: "Upstream did not return OpenAI SSE." }, { status: 502 });
        let size = 0;
        const limited = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > 2_000_000) throw new Error("OpenAI stream exceeded service limit.");
            controller.enqueue(chunk);
          },
        }));
        return new Response(limited, { status: 200, headers: {
          "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
        } });
      }
      const text = await response.text();
      if (text.length > 1500000) return NextResponse.json({error:"Service response too large"},{status:502});
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch (error) { return NextResponse.json({error:`Service returned invalid JSON: ${describeUpstreamError(error)}`, upstreamStatus:response.status, upstreamMessage:sanitizeUpstreamDiagnostic(text)},{status:502}); }
      return NextResponse.json(parsed, {status: response.status >= 400 && response.status < 600 ? response.status : response.ok ? 200 : 502,
        headers: {"Cache-Control":"no-store"}});
    }
    const response = await fetch(url, {
      method: operation.method, redirect: "manual", cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Maestro/1.0 (OpenAPI service transport)" },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(operation.timeoutMs ?? 10000)]),
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
    return NextResponse.json({ error: describeUpstreamError(error, "Service call failed") }, { status: 502 });
  }
}

/** No Maestro operation dispatch or extra API routes. */
export async function GET():Promise<Response>{
  return NextResponse.json({error:"Use POST with a registered OpenAPI service and operationId."},
    {status:405,headers:{Allow:"POST"}});
}
