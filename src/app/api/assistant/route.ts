import { NextResponse } from "next/server";

//export const runtime = "nodejs";
export const maxDuration = 180;

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const apiKey = process.env.ITERACOMPUTE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "The assistant is not configured. Set ITERACOMPUTE_API_KEY in the server environment and restart Maestro." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawMessages = body && typeof body === "object" && "messages" in body
    ? (body as { messages?: unknown }).messages
    : null;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return NextResponse.json({ error: "Send at least one chat message." }, { status: 400 });
  }

  const messages: ChatMessage[] = [];
  for (const item of rawMessages.slice(-40)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Each message must have a user/assistant role and non-empty text." }, { status: 400 });
    }
    messages.push({ role, content: content.slice(0, 30_000) });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "The latest chat message must be from the user." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.iteracompute.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages,
        max_tokens: 2048,
        reasoning: false,
      }),
      signal: AbortSignal.timeout(180_000),
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Maestro took too long to respond. The free service may be queued; please try again later."
      : "Could not reach IteraCompute. Check the server connection and try again.";
    return NextResponse.json({ error: message }, { status: 504 });
  }

  const responseText = await upstream.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = null;
  }

  if (!upstream.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { message?: unknown } }).error?.message
      : null;
    const message = typeof detail === "string" ? detail : `IteraCompute returned HTTP ${upstream.status}.`;
    return NextResponse.json({ error: message }, { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 });
  }

  const choices = payload && typeof payload === "object" && "choices" in payload
    ? (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices
    : undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Maestro returned an empty or unsupported response." }, { status: 502 });
  }

  const usage = payload && typeof payload === "object" && "usage" in payload
    ? (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage
    : undefined;
  return NextResponse.json({ message: content,
    ...(usage ? { usage: { input: usage.prompt_tokens, output: usage.completion_tokens, total: usage.total_tokens } } : {}),
  });
}
