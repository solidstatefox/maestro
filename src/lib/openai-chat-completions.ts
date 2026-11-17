/** Bounded text-chat subset of OpenAI's Chat Completions wire protocol.
 * Standard OpenAI fields are passed through unchanged to an immutable reviewed
 * provider. File/tool invocation and arbitrary provider URLs are not exposed. */
export function validateOpenAiChatPayload(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Chat payload must be an object.";
  const v = value as Record<string, unknown>;
  const allowed = new Set(["model", "messages", "max_tokens", "max_completion_tokens", "temperature",
    "top_p", "frequency_penalty", "presence_penalty", "stop", "stream", "stream_options",
    "response_format", "seed", "reasoning", "enable_thinking", "thinking_budget"]);
  if (Object.keys(v).some(key => !allowed.has(key))) return "Unrecognized chat-completions options.";
  if (typeof v.model !== "string" || !/^[\w./:-]{1,128}$/.test(v.model)) return "Invalid OpenAI model identifier.";
  if (!Array.isArray(v.messages) || v.messages.length < 1 || v.messages.length > 40) return "Invalid chat message count.";
  for (const entry of v.messages) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "Invalid OpenAI message.";
    const message = entry as Record<string, unknown>;
    if (Object.keys(message).some(key => !["role", "content", "name"].includes(key)) ||
        !["system", "developer", "user", "assistant"].includes(String(message.role)) ||
        typeof message.content !== "string" || !message.content.trim() || message.content.length > 30000 ||
        (message.name !== undefined && (typeof message.name !== "string" || !/^[\w-]{1,64}$/.test(message.name))))
      return "Only bounded OpenAI text-chat messages are supported.";
  }
  if ((v.messages[v.messages.length - 1] as {role:string}).role !== "user") return "The last message must be a user message.";
  const maxTokens = v.max_completion_tokens ?? v.max_tokens;
  if (maxTokens !== undefined && (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 11000))
    return "Invalid chat-completions token limit.";
  for (const [name,min,max] of [["temperature",0,2],["top_p",0,1],["frequency_penalty",-2,2],["presence_penalty",-2,2]] as const)
    if (v[name] !== undefined && (typeof v[name] !== "number" || !Number.isFinite(v[name]) || v[name] < min || v[name] > max))
      return `Invalid ${name} value.`;
  if (v.seed !== undefined && (typeof v.seed !== "number" || !Number.isSafeInteger(v.seed))) return "Invalid seed.";
  if (v.stop !== undefined && !(typeof v.stop === "string" && v.stop.length <= 200 ||
      Array.isArray(v.stop) && v.stop.length <= 4 && v.stop.every((s:unknown) => typeof s === "string" && s.length <= 200))) return "Invalid stop sequence.";
  if (v.stream !== undefined && typeof v.stream !== "boolean") return "Invalid streaming option.";
  if (v.stream_options !== undefined && (!(v.stream_options && typeof v.stream_options === "object" && !Array.isArray(v.stream_options)) ||
      Object.keys(v.stream_options).some(k => k !== "include_usage") ||
      typeof (v.stream_options as {include_usage?:unknown}).include_usage !== "boolean" || v.stream !== true)) return "Invalid OpenAI stream_options.";
  if (v.response_format !== undefined && (!(v.response_format && typeof v.response_format === "object" && !Array.isArray(v.response_format)) ||
      Object.keys(v.response_format).some(k => k !== "type") ||
      !["text", "json_object"].includes((v.response_format as {type?:string}).type ?? ""))) return "Unsupported response_format.";
  if (v.reasoning !== undefined && typeof v.reasoning !== "boolean" ||
      v.enable_thinking !== undefined && typeof v.enable_thinking !== "boolean") return "Invalid provider reasoning flags.";
  if (v.thinking_budget !== undefined && (typeof v.thinking_budget !== "number" || !Number.isInteger(v.thinking_budget) || v.thinking_budget < 0 || v.thinking_budget > 8192)) return "Invalid thinking_budget.";
  return null;
}
