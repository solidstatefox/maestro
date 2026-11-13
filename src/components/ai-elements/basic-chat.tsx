"use client";
import { ErrorDetails } from "@/components/ui/error-details";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { ArrowUp, Bot, LoaderCircle, List, User, Plus, X, Download, ChevronDown, FileText, Terminal as TerminalIcon, CheckCircle2, AlertCircle, AlertTriangle, CircleDashed, Activity, Brain, Square } from "lucide-react";
import { createPortal } from "react-dom";
import { Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions, AttachmentAction, AttachmentGroup } from "@/components/ui/attachment";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Trace, TraceCollapsible, TraceCollapsibleTrigger, TraceCollapsibleContent, TraceIcon, TraceLine, TraceTitle, TraceDescription } from "@/components/ui/trace";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { QWEN_THINKING_BUDGETS, qwenThinkingOptions, type QwenThinkingBudget } from "@/lib/qwen-thinking";
import { PromptInput, PromptInputTextarea, PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { appendAssistantActivity, readAssistantActivity, clearAssistantActivity, ASSISTANT_ACTIVITY_CHANGED, type AssistantActivity } from "@/lib/assistant-activity";

type OtcProgressEvent = {
  step: "shape" | "ask" | "select" | "shacl" | "qwen" | "liquid" | "cleanup" | "stop";
  status: "running" | "success" | "warning" | "error" | "stopped";
  detail: string;
  rule?: string;
  shape?: string;
  message?: string;
  violations?: string[];
  counts?: { checked?: number; passed?: number; failed?: number; triples?: number };
  live?: OtcLiveSnapshot;
  receivedAt?: number;
};
type OtcLiveSnapshot = {
  reasoning: string; content: string; input: number; output: number; total: number;
  estimated: boolean; phase: "waiting" | "reasoning" | "response"; reasoningTokens?: number; thinkingBudget?: number;
};
type ChatRole = "user" | "assistant";
type ChatMessage = {
  id: string; role: ChatRole; content: string;
  createdAt?: string;
  usage?: { input?: number; output?: number; total?: number };
  download?: { name: string; content: string };
  transcode?: { fileName: string; fileSize?: number; fileType?: string; uploadState?: "idle" | "uploading" | "processing" | "error" | "done"; uploadPercent?: number; inputGraph?: string; rulesGraph?: string; surveyTitle?: string; surveyIri?: string };
  surveyOptions?: Array<{ uri: string; title: string; description: string }>;
  otcProgress?: OtcProgressEvent[];
  otcLive?: OtcLiveSnapshot;
  otcFinished?: "success" | "error" | "stopped";
  runStartedAt?: number;
  runEndedAt?: number;
  durationMs?: number;
};
/** Resolve old "running" events without discarding the original audit trail. */
function resolvedOtcStatus(
  events: OtcProgressEvent[], index: number, finished?: "success" | "error" | "stopped",
): OtcProgressEvent["status"] {
  const event = events[index];
  if (event.status !== "running") return event.status;
  const later = events.slice(index + 1);
  // Prefer the terminal update for this exact operation, including its focus node.
  const terminal = later.find(next =>
    next.step === event.step && next.rule === event.rule &&
    (!event.message || next.message === event.message) &&
    (!event.shape || next.shape === event.shape) &&
    next.status !== "running"
  );
  if (terminal) return terminal.status;
  // A later phase implies this step has stopped running, even if the runtime
  // reports its final summary later (for example after multiple SHACL rows).
  if (later.some(next => next.step !== event.step)) return "success";
  // A completed/failed request must never leave an indefinite spinner.
  return finished === "error" ? "error" : finished === "stopped" ? "stopped" : finished === "success" ? "success" : "running";
}

type PendingPrompt = { id: number; text: string } | null;

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatAttachmentSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

const DB_NAME = "maestro-assistant-chat";
const DB_VERSION = 1;
const STORE_NAME = "conversations";
const CONVERSATION_KEY = "main";

function openChatDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open chat storage."));
  });
}

async function readConversation(): Promise<ChatMessage[]> {
  const db = await openChatDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(CONVERSATION_KEY);
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as ChatMessage[] : []);
      request.onerror = () => reject(request.error ?? new Error("Could not read the saved chat."));
    });
  } finally {
    db.close();
  }
}

async function writeConversation(messages: ChatMessage[]): Promise<void> {
  const db = await openChatDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(messages, CONVERSATION_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the chat."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Chat save was aborted."));
    });
  } finally {
    db.close();
  }
}

/** Minimal AI Elements-style Message + Bubble + Prompt Input composition. */
function Message({ role, children, userName, userAvatarUrl }: { role: ChatRole; children: React.ReactNode; userName?: string; userAvatarUrl?: string }) {
  return (
    <article className={`flex gap-2.5 ${role === "user" ? "flex-row-reverse" : "flex-row"}`}>
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted" aria-hidden="true">
        {role === "user" ? (
          <Avatar className="size-7">
            {userAvatarUrl && <AvatarImage src={userAvatarUrl} alt={userName || "User"} />}
            <AvatarFallback className={userName ? "bg-primary text-primary-foreground text-xs font-semibold uppercase" : "bg-muted text-muted-foreground"}>
              {userName ? userName[0].toUpperCase() : <User className="size-4" aria-hidden="true" />}
            </AvatarFallback>
          </Avatar>
        ) : <Bot className="size-4" />}
      </div>
      <div className={`min-w-0 max-w-[88%] ${role === "user" ? "items-end" : "items-start"} flex flex-col`}>
        <span className="mb-1 text-[11px] text-muted-foreground">{role === "user" ? "You" : "Maestro"}</span>
        {children}
      </div>
    </article>
  );
}

function Bubble({ role, children }: { role: ChatRole; children: React.ReactNode }) {
  return (
    <div className={`whitespace-pre-wrap break-words rounded-xl px-3 py-2.5 text-sm leading-relaxed ${role === "user" ? "bg-primary text-primary-foreground" : "border bg-card text-card-foreground"}`}>
      {children}
    </div>
  );
}

export function BasicAssistantChat({
  pendingPrompt,
  onPendingPromptConsumed,
  onShowResults,
  initialDraft,
  userName,
  userAvatarUrl,
}: {
  pendingPrompt: PendingPrompt;
  onPendingPromptConsumed: (id: number) => void;
  onShowResults: () => void;
  initialDraft?: string;
  userName?: string;
  userAvatarUrl?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<AssistantActivity[]>([]);
  const modelId = "qwen/qwen3.8-27b";
  const [thinkingBudget, setThinkingBudget] = useState<QwenThinkingBudget>(0);
  const thinkingIndex = QWEN_THINKING_BUDGETS.indexOf(thinkingBudget);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void readAssistantActivity().then((rows) => { if (mounted) setActivity(rows); }).catch(() => {}); };
    refresh();
    window.addEventListener(ASSISTANT_ACTIVITY_CHANGED, refresh);
    return () => { mounted = false; window.removeEventListener(ASSISTANT_ACTIVITY_CHANGED, refresh); };
  }, []);
  const [draft, setDraft] = useState("");
  const [transcodePrefLoaded, setTranscodePrefLoaded] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("maestro-chat-transcode-mode") === "yes")
        setDraft((current) => current.trim() ? current : "transcode ");
    } catch { /* Private browsing may disable storage. */ }
    setTranscodePrefLoaded(true);
  }, []);
  useEffect(() => {
    if (!transcodePrefLoaded) return;
    try {
      window.localStorage.setItem("maestro-chat-transcode-mode", /^transcode\b/i.test(draft.trimStart()) ? "yes" : "no");
    } catch { /* The mode still works without persistent storage. */ }
  }, [draft, transcodePrefLoaded]);
  const [attachment, setAttachment] = useState<File | null>(null);
  // File bytes remain available for downloads only during this page session.
  // Saved chat history retains metadata, not potentially sensitive uploaded content.
  const availableUploadsRef = useRef<Map<string, File>>(new Map());
  const pendingTranscode = useRef<{ messageId: string; prompt: string; file: File } | null>(null);
  const [selectingSurvey, setSelectingSurvey] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const transcodeMode = /^transcode\b/i.test(draft.trimStart());
  const badgeDraft = /^transcode(?=\s|$)/i.test(draft);
  const composerText = badgeDraft ? draft.replace(/^transcode\s*/i, "") : draft;
  const updateComposer = (value: string) => setDraft(badgeDraft ? `transcode ${value}` : value);
  const timeline = [
    ...messages.map((message, index) => ({ kind: "message" as const, id: message.id, timestamp: Date.parse(message.createdAt || "") || index, index, message })),
    ...activity.map((entry, index) => ({ kind: "activity" as const, id: `activity-${entry.id}`, timestamp: Date.parse(entry.createdAt || "") || index, index, entry })),
  ].sort((a, b) => a.timestamp - b.timestamp || (a.kind === "message" ? -1 : 1));
  const downloadAvailableUpload = (messageId: string) => {
    const file = availableUploadsRef.current.get(messageId);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadComposerUpload = () => {
    if (!attachment) return;
    const url = URL.createObjectURL(attachment);
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadTurtle = (value: { name: string; content: string }) => {
    const url = URL.createObjectURL(new Blob([value.content], { type: "text/turtle;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = value.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const [composerHost, setComposerHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setComposerHost(document.getElementById("maestro-assistant-composer-slot")); }, []);
  useEffect(() => { if (initialDraft) setDraft(initialDraft); }, [initialDraft]);
  const [loading, setLoading] = useState(false);
  const currentFetchRef = useRef<AbortController | null>(null);
  const currentOtcRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);
  const activeRequestStartedAtRef = useRef<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!loading) return;
    setClockNow(Date.now());
    const interval = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [loading]);
  const stopGeneration = () => {
    cancelledRef.current = true;
    currentFetchRef.current?.abort();
    currentOtcRef.current?.abort();
    setError("");
  };
  useEffect(() => () => { currentFetchRef.current?.abort(); currentOtcRef.current?.abort(); }, []);
  const [storageReady, setStorageReady] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (composerHost) inputRef.current?.focus(); }, [composerHost]);
  const sentPendingIdRef = useRef<number | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    let cancelled = false;
    void readConversation().then((saved) => {
      if (!cancelled) {
        setMessages(saved);
        setStorageReady(true);
      }
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Could not load the saved chat.");
        setStorageReady(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const timer = window.setTimeout(() => {
      void writeConversation(messages).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not save the chat.");
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [messages, storageReady]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || loading) return;
    setError("");
    cancelledRef.current = false;
    const startedAt = Date.now();
    activeRequestStartedAtRef.current = startedAt;
    setClockNow(startedAt);
    // Keep Transcode mode after sending; removing its badge explicitly exits it.
    setDraft(/^transcode\b/i.test(text) ? "transcode " : "");
    const sentAttachment = attachment;
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = "";

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      ...(sentAttachment && /^transcode\b/i.test(text) ? { transcode: { fileName: sentAttachment.name, fileSize: sentAttachment.size, fileType: sentAttachment.type, uploadState: "idle" as const } } : {}),
    };
    if (sentAttachment && /^transcode\b/i.test(text)) availableUploadsRef.current.set(userMessage.id, sentAttachment);
    const priorMessages = messagesRef.current;
    const nextMessages = [...priorMessages, userMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setLoading(true);
    try {
      const isTranscode = /^transcode\b/i.test(text);
      let answer: string;
      let usage: { input?: number; output?: number; total?: number } | undefined;
      let download: { name: string; content: string } | undefined;
      if (isTranscode && !sentAttachment) {
        answer = "Please attach a Turtle (.ttl) document using the paperclip, then send your transcode request again.";
      } else if (isTranscode) {
        // Fetch the menu first. This endpoint performs no LLM requests.
        const controller = new AbortController();
        currentFetchRef.current = controller;
        const response = await fetch("/proxy/api/service?service=maestro&operationId=otc-chat", { cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => ({})) as {
          error?: string; rulesGraph?: string;
          surveys?: Array<{ uri: string; title: string; description: string }>;
        };
        if (!response.ok) throw new Error(data.error || `Could not load surveys (HTTP ${response.status}).`);
        if (!data.surveys?.length) throw new Error("No OTC surveys are installed in the Personal rules graph.");
        pendingTranscode.current = { messageId: userMessage.id, prompt: text, file: sentAttachment! };
        setSelectingSurvey(true);
        const menuMessage: ChatMessage = {
          id: crypto.randomUUID(), role: "assistant", content: "Choose one survey to run. Maestro will execute only your selection.",
          surveyOptions: data.surveys,
          createdAt: new Date().toISOString(),
        };
        const prepared = [...nextMessages, menuMessage];
        prepared[prepared.length - 2] = { ...userMessage, transcode: {
          ...userMessage.transcode!, rulesGraph: data.rulesGraph,
        } };
        messagesRef.current = prepared;
        setMessages(prepared);
        setLoading(false);
        return;
      } else {
        const controller = new AbortController();
        currentFetchRef.current = controller;
        // OpenAPI chat-completions operation through Maestro's one /service
        // transport; the IteraCompute credential remains server-side.
        const response = await fetch("/proxy/api/service", {
          signal: controller.signal, method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service: "iteracompute", operationId: "createChatCompletion", payload: {
            model: "qwen/qwen3.8-27b",
            messages: nextMessages.map(({ role, content }) => ({ role, content })),
            ...qwenThinkingOptions(thinkingBudget, 2048),
          } }),
        });
        const payload = await response.json().catch(() => ({})) as {
          error?: string | {message?: string}; choices?: Array<{ message?: {content?: string} }>;
          usage?: {prompt_tokens?: number; completion_tokens?: number; total_tokens?: number};
        };
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || `Assistant request failed (HTTP ${response.status}).`);
        answer = payload.choices?.[0]?.message?.content?.trim() ?? "";
        if (!answer) throw new Error("Maestro returned an empty response.");
        usage = payload.usage ? {input:payload.usage.prompt_tokens, output:payload.usage.completion_tokens, total:payload.usage.total_tokens} : undefined;
      }
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(), role: "assistant", content: answer,
        createdAt: new Date().toISOString(),
        ...(usage ? { usage } : {}),
        ...(download ? { download } : {}),
        durationMs: Date.now() - startedAt,
      };
      const completed = [...nextMessages, assistantMessage];
      messagesRef.current = completed;
      setMessages(completed);
    } catch (cause) {
      if (cancelledRef.current) {
        const stopped: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "Stopped", createdAt: new Date().toISOString(), durationMs: Date.now() - startedAt };
        const updated = [...messagesRef.current, stopped];
        messagesRef.current = updated;
        setMessages(updated);
        return;
      }
      const message = cause instanceof Error ? cause.message : "The assistant request failed.";
      setError(message);
      void appendAssistantActivity([{
        id: crypto.randomUUID(), createdAt: new Date().toISOString(),
        source: "Maestro", prompt: text, response: message, status: "error",
      }]).catch(() => {});
    } finally {
      currentFetchRef.current = null;
      activeRequestStartedAtRef.current = null;
      setLoading(false);
    }
  }, [loading, attachment, thinkingBudget]);

  const runSelectedSurvey = useCallback(async (option: { uri: string; title: string }, menuId: string) => {
    const pending = pendingTranscode.current;
    if (!pending || loading) return;
    setError("");
    cancelledRef.current = false;
    const startedAt = Date.now();
    activeRequestStartedAtRef.current = startedAt;
    setClockNow(startedAt);
    setLoading(true);
    setSelectingSurvey(false);
    pendingTranscode.current = null;
    const prepared = messagesRef.current.map(message => {
      if (message.id === menuId) return { ...message, surveyOptions: undefined,
        content: `Running selected survey: ${option.title}`, runStartedAt: startedAt, runEndedAt: undefined, otcFinished: undefined };
      if (message.id === pending.messageId) return { ...message, transcode: {
        ...message.transcode!, fileName: pending.file.name,
        surveyTitle: option.title, surveyIri: option.uri,
      } };
      return message;
    });
    messagesRef.current = prepared;
    setMessages(prepared);
    const updateAttachmentStatus = (uploadState: "uploading" | "processing" | "error" | "done", uploadPercent?: number) => {
      const updated = messagesRef.current.map(message => message.id === pending.messageId && message.transcode ? {
        ...message, transcode: { ...message.transcode, uploadState, ...(uploadPercent !== undefined ? { uploadPercent } : {}) },
      } : message);
      messagesRef.current = updated;
      setMessages(updated);
    };
    try {
      const form = new FormData();
      form.set("prompt", pending.prompt);
      form.set("file", pending.file);
      form.set("transcoder", option.uri);
      form.set("thinkingBudget", String(thinkingBudget));
      const streamState: { complete?: { status: number; result: unknown } } = {};
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const packet = JSON.parse(line) as
          | { kind: "progress"; event: OtcProgressEvent }
          | { kind: "complete"; status: number; result: unknown };
        if (packet.kind === "progress") {
          const updated = messagesRef.current.map(message => message.id === menuId ? (
            packet.event.live
              ? { ...message, otcLive: packet.event.live }
              : { ...message, otcProgress: [...(message.otcProgress ?? []), { ...packet.event, receivedAt: Date.now() }] }
          ) : message);
          messagesRef.current = updated;
          setMessages(updated);
        } else streamState.complete = packet;
      };
      // XMLHttpRequest exposes real upload progress while preserving incremental NDJSON activity.
      // A streaming fetch response alone cannot report upload bytes in the browser.
      updateAttachmentStatus("uploading", 0);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        currentOtcRef.current = xhr;
        let processed = 0;
        let buffer = "";
        let rejected = false;
        const consume = (flush = false) => {
          buffer += xhr.responseText.slice(processed);
          processed = xhr.responseText.length;
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (line.trim()) handleLine(line);
          }
          if (flush && buffer.trim()) { handleLine(buffer); buffer = ""; }
        };
        xhr.open("POST", "/proxy/api/service?service=maestro&operationId=otc-chat");
        xhr.setRequestHeader("Accept", "application/x-ndjson");
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) updateAttachmentStatus("uploading", Math.min(100, Math.round(100 * event.loaded / event.total)));
        };
        xhr.upload.onload = () => updateAttachmentStatus("processing", 100);
        xhr.onprogress = () => { try { consume(); } catch (err) { rejected = true; xhr.abort(); reject(err); } };
        xhr.onload = () => {
          if (rejected) return;
          try {
            consume(true);
            if (xhr.status < 200 || xhr.status >= 300) throw new Error(`Could not start OTC stream (HTTP ${xhr.status}).`);
            resolve();
          } catch (err) { reject(err); }
        };
        xhr.onerror = () => reject(new Error("Could not connect to the OTC service."));
        xhr.onabort = () => { if (!rejected) reject(new Error("OTC upload was cancelled.")); };
        xhr.send(form);
      });
      const completion = streamState.complete;
      if (!completion) throw new Error("OTC progress stream ended before the result arrived.");
      const data = completion.result as {
        error?: string; activity?: AssistantActivity[]; turtle?: string;
        tripleCount?: number; inputGraph?: string; rulesGraph?: string; reason?: string;
      };
      if (Array.isArray(data.activity) && data.activity.length) await appendAssistantActivity(data.activity);
      if (completion.status >= 400) {
        if (data.inputGraph) {
          const updated = messagesRef.current.map(message => message.id === pending.messageId ? {
            ...message, transcode: { ...message.transcode!, inputGraph: data.inputGraph,
              rulesGraph: data.rulesGraph || message.transcode?.rulesGraph },
          } : message);
          messagesRef.current = updated;
          setMessages(updated);
        }
        throw new Error(completion.status === 401
          ? "Please log in to Maestro before transcoding."
          : data.error || `Transcoding failed (HTTP ${completion.status}).`);
      }
      // Mark the audit entry as settled even when the final event has no matching end event.
      const settled = messagesRef.current.map(message => message.id === menuId
        ? { ...message, otcFinished: "success" as const, runEndedAt: Date.now() } : message);
      messagesRef.current = settled;
      setMessages(settled);
      const completed = messagesRef.current.map(message => message.id === pending.messageId ? {
        ...message, transcode: { ...message.transcode!, inputGraph: data.inputGraph,
          rulesGraph: data.rulesGraph || message.transcode?.rulesGraph },
      } : message);
      completed.push({ id: crypto.randomUUID(), role: "assistant", createdAt: new Date().toISOString(),
        content: data.turtle?.trim()
          ? `Survey completed: ${option.title}. ${data.tripleCount ?? 0} RDF triples generated.`
          : `Survey completed without RDF output. ${data.reason || "No eligible or SHACL-valid input rows."}`,
        ...(data.turtle?.trim() ? { download: { name: "maestro-transcoded-output.ttl", content: data.turtle } } : {}),
      });
      messagesRef.current = completed;
      setMessages(completed);
      updateAttachmentStatus("done", 100);
    } catch (cause) {
      if (cancelledRef.current) {
        const stopped = messagesRef.current.map(message => message.id === menuId ? {
          ...message, otcFinished: "stopped" as const, runEndedAt: Date.now(), content: `Stopped survey: ${option.title}`,
          otcProgress: [...(message.otcProgress ?? []), { step: "stop" as const, status: "stopped" as const, detail: "Stopped by user" }],
        } : message);
        messagesRef.current = stopped;
        setMessages(stopped);
        updateAttachmentStatus("done");
        return;
      }
      const settled = messagesRef.current.map(message => message.id === menuId
        ? { ...message, otcFinished: "error" as const, runEndedAt: Date.now() } : message);
      messagesRef.current = settled;
      setMessages(settled);
      updateAttachmentStatus("error");
      const description = cause instanceof Error ? cause.message : "Transcoding failed.";
      setError(description);
      const failed = [...messagesRef.current, { id: crypto.randomUUID(), role: "assistant" as const,
        content: `Survey failed: ${description}`, createdAt: new Date().toISOString() }];
      messagesRef.current = failed;
      setMessages(failed);
    } finally {
      currentOtcRef.current = null;
      activeRequestStartedAtRef.current = null;
      setLoading(false);
    }
  }, [loading, thinkingBudget]);

  useEffect(() => {
    if (!storageReady || !pendingPrompt || sentPendingIdRef.current === pendingPrompt.id) return;
    sentPendingIdRef.current = pendingPrompt.id;
    void send(pendingPrompt.text);
    onPendingPromptConsumed(pendingPrompt.id);
  }, [pendingPrompt, storageReady, send, onPendingPromptConsumed]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold">Maestro</h2>
          <p className="text-xs text-muted-foreground">Maestro assistant · chat saved in this browser</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading || (messages.length === 0 && activity.length === 0)} onClick={() => {
          messagesRef.current = [];
          availableUploadsRef.current.clear();
          pendingTranscode.current = null;
          setSelectingSurvey(false);
          setAttachment(null);
          setDraft("");
          try { window.localStorage.removeItem("maestro-chat-transcode-mode"); } catch { /* optional */ }
          setMessages([]);
          setError("");
          void clearAssistantActivity().catch(() => setError("Could not clear assistant activity history."));
        }}>Clear chat</Button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite" aria-label="Chat messages">
        {!storageReady && <p className="text-sm text-muted-foreground">Loading saved chat…</p>}
        {storageReady && messages.length === 0 && activity.length === 0 && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full border bg-muted"><Bot className="size-5" /></div>
            <h3 className="text-sm font-semibold">What would you like to ask?</h3>
            <p className="text-sm text-muted-foreground">Ask a question using the message field below the Query Tree.</p>
          </div>
        )}
        {timeline.map((item) => item.kind === "message" ? (() => { const message = item.message; return (
          <Message key={message.id} role={message.role} userName={userName} userAvatarUrl={userAvatarUrl}>
            <Bubble role={message.role}>{message.content}</Bubble>
            {message.transcode && <Attachment className="mt-2 w-full max-w-md" state={message.transcode.uploadState ?? "done"} size="sm" aria-label={`Attached file ${message.transcode.fileName}`}>
              <AttachmentMedia><FileText className="size-4" /></AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{message.transcode.fileName}</AttachmentTitle>
                <AttachmentDescription>{message.transcode.uploadState === "uploading" ? `Uploading · ${message.transcode.uploadPercent ?? 0}%` : message.transcode.uploadState === "processing" ? "Processing transcoder survey…" : message.transcode.uploadState === "error" ? "Upload or survey failed" : message.transcode.uploadState === "done" ? "Submitted" : "Ready to upload"}{typeof message.transcode.fileSize === "number" ? ` · ${formatAttachmentSize(message.transcode.fileSize)}` : ""}</AttachmentDescription>
                {message.transcode.uploadState === "uploading" && <div role="progressbar" aria-label="Attachment upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={message.transcode.uploadPercent ?? 0} className="h-1 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${message.transcode.uploadPercent ?? 0}%` }} /></div>}
              </AttachmentContent>
              {availableUploadsRef.current.has(message.id) && <AttachmentActions>
                <AttachmentAction aria-label={`Download ${message.transcode.fileName}`} title="Download attached file" onClick={() => downloadAvailableUpload(message.id)}><Download className="size-3.5" /></AttachmentAction>
              </AttachmentActions>}
            </Attachment>}
            {message.transcode && <Trace className="mt-2 max-w-full text-xs">
              <TraceCollapsible defaultOpen>
                <TraceCollapsibleTrigger><TraceLine><TraceIcon><TerminalIcon className="size-4" /></TraceIcon><TraceTitle>Submitted for transcoding</TraceTitle></TraceLine></TraceCollapsibleTrigger>
                <TraceCollapsibleContent><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-xs">{[
                  `File: ${message.transcode.fileName}`,
                  message.transcode.surveyTitle && `Survey: ${message.transcode.surveyTitle}`,
                  message.transcode.surveyIri && `Transcoder: ${message.transcode.surveyIri}`,
                  message.transcode.rulesGraph && `Transcoder graph: ${message.transcode.rulesGraph}`,
                  message.transcode.inputGraph && `Temporary input graph: ${message.transcode.inputGraph} (cleared after run)`,
                ].filter(Boolean).join("\n")}</pre></TraceCollapsibleContent>
              </TraceCollapsible>
            </Trace>}
            {message.otcProgress && <Trace className="mt-2 max-w-full text-xs" role="log" aria-label="OTC transcoding steps" aria-live="polite" aria-relevant="additions">
              <TraceLine className="border-b border-border/50">
                <TraceIcon><Activity className="size-4" /></TraceIcon>
                <TraceTitle>OTC transcoding</TraceTitle>
                <TraceDescription>{message.otcProgress.length} steps{message.runStartedAt !== undefined ? ` · ${message.runEndedAt === undefined ? "Elapsed" : "Took"} ${formatElapsed((message.runEndedAt ?? clockNow) - message.runStartedAt)}` : ""}</TraceDescription>
              </TraceLine>
              {message.otcLive && <div className="border-b border-border/50 px-3 py-2 text-xs" aria-label="Live Qwen generation and token usage">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">Tokens {message.otcLive.estimated ? "(estimated)" : "(provider reported)"}</span>
                  <span className="tabular-nums">Input: {message.otcLive.input.toLocaleString()}</span>
                  <span className="tabular-nums">Output: {message.otcLive.output.toLocaleString()}</span>
                  {message.otcLive.reasoningTokens !== undefined && <span className="tabular-nums">Thinking: ~{message.otcLive.reasoningTokens.toLocaleString()} / {message.otcLive.thinkingBudget?.toLocaleString() ?? "unlimited"}</span>}
                  <span className="font-semibold tabular-nums">Total: {message.otcLive.total.toLocaleString()}</span>
                  {message.otcFinished === "success" ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : message.otcFinished === "error" ? <AlertCircle className="size-3.5 text-destructive" /> : message.otcFinished === "stopped" ? <CircleDashed className="size-3.5 text-muted-foreground" /> : <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
                </div>
                {message.otcLive.reasoning && <TraceCollapsible className="mt-1" defaultOpen={false}>
                  <TraceCollapsibleTrigger><TraceLine className="px-0 py-1"><TraceIcon><Brain className="size-3.5" /></TraceIcon><TraceTitle>Model reasoning</TraceTitle><TraceDescription>{message.otcLive.phase === "reasoning" ? "Streaming" : "Received"}</TraceDescription></TraceLine></TraceCollapsibleTrigger>
                  <TraceCollapsibleContent className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{message.otcLive.reasoning}</TraceCollapsibleContent>
                </TraceCollapsible>}
                {message.otcLive.content && <TraceCollapsible className="mt-1" defaultOpen={false}>
                  <TraceCollapsibleTrigger><TraceLine className="px-0 py-1"><TraceIcon><FileText className="size-3.5" /></TraceIcon><TraceTitle>Survey response</TraceTitle><TraceDescription>{message.otcFinished === "stopped" ? "Stopped" : message.otcFinished ? "Complete" : "Streaming bindings"}</TraceDescription></TraceLine></TraceCollapsibleTrigger>
                  <TraceCollapsibleContent className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono">{message.otcLive.content}</TraceCollapsibleContent>
                </TraceCollapsible>}
              </div>}
              <div className="max-h-80 overflow-y-auto">
                {message.otcProgress.map((event, index) => {
                  const detailAvailable = Boolean(event.rule || event.shape || event.message || event.counts || event.violations?.length);
                  const status = resolvedOtcStatus(message.otcProgress!, index, message.otcFinished);
                  const statusIcon = status === "success"
                    ? <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                    : status === "error"
                      ? <AlertCircle className="size-4 text-destructive" />
                      : status === "warning"
                        ? <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                        : status === "stopped"
                          ? <CircleDashed className="size-4 text-muted-foreground" />
                        : <LoaderCircle className="size-4 animate-spin text-muted-foreground" />;
                  const line = <TraceLine status={status === "stopped" ? undefined : status}>
                    <TraceIcon>{statusIcon}</TraceIcon>
                    <TraceTitle>{event.step === "stop" ? "Stopped" : event.step.toUpperCase()}</TraceTitle>
                    <TraceDescription>{event.detail}</TraceDescription>
                  </TraceLine>;
                  return detailAvailable ? (
                    <TraceCollapsible key={index} className="border-b border-border/40 last:border-0">
                      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                      <TraceCollapsibleContent>
                        <div className="space-y-1 whitespace-pre-wrap break-all">
                          {event.rule && <div>Rule: {event.rule}</div>}
                          {event.shape && <div>SHACL shape: {event.shape}</div>}
                          {event.message && <div>Focus node: {event.message}</div>}
                          {event.counts && <div>Counts: {JSON.stringify(event.counts)}</div>}
                          {event.violations?.map((violation, i) => <div key={i} className="text-destructive">Violation: {violation}</div>)}
                        </div>
                      </TraceCollapsibleContent>
                    </TraceCollapsible>
                  ) : <div key={index} className="border-b border-border/40 last:border-0">{line}</div>;
                })}
              </div>
            </Trace>}
            {message.surveyOptions?.length ? <div className="mt-2 w-full max-w-md space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Choose one survey</p>
              <div className="flex w-full min-w-0 flex-col gap-2">
                {message.surveyOptions.map(option => <Button key={option.uri} type="button" variant="outline" size="sm"
                  title={option.description || option.uri} className="h-auto w-full min-w-0 justify-start whitespace-normal break-words text-left"
                  disabled={loading || !selectingSurvey || pendingTranscode.current === null}
                  onClick={() => void runSelectedSurvey(option, message.id)}>{option.title}</Button>)}
              </div>
            </div> : null}
            {message.download && <Button type="button" variant="outline" size="sm" className="mt-1" onClick={() => downloadTurtle(message.download!)}><Download className="mr-1 size-3"/>Download .ttl</Button>}
            {message.usage && <span className="mt-1 text-[11px] text-muted-foreground">Tokens: {message.usage.input ?? "?"} input / {message.usage.output ?? "?"} output{message.usage.total !== undefined ? ` / ${message.usage.total} total` : ""}</span>}
          </Message>
        ); })() : (() => { const entry = item.entry; return (
          <Message key={`activity-${entry.id}`} role="assistant">
            <div className="w-full min-w-0 space-y-2 rounded-xl border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{entry.source}</span>
                <span>· {new Date(entry.createdAt).toLocaleString()}</span>
                <span className={entry.status === "error" ? "text-destructive" : ""}>{entry.status}</span>
              </div>
              <details className="rounded-md border p-2">
                <summary className="cursor-pointer text-xs font-medium">Survey input sent by Maestro</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{entry.prompt}</pre>
              </details>
              <div className="text-xs font-medium">Survey response</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{entry.response}</pre>
              {entry.usage && <p className="text-xs text-muted-foreground">Tokens: {entry.usage.input ?? "?"} input / {entry.usage.output ?? "?"} output{entry.usage.total !== undefined ? ` / ${entry.usage.total} total` : ""}</p>}
            </div>
          </Message>
        ); })())}
        {loading && (
          <Message role="assistant">
            <Bubble role="assistant"><span className="inline-flex items-center gap-2 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Maestro is thinking…</span></Bubble>
          </Message>
        )}
        {error && <ErrorDetails prefix="Maestro chat" error={error} className="px-3 py-2" />}
      </div>
      {composerHost && createPortal(<form onSubmit={submit} className="w-full">
        <PromptInput>
          {attachment && <InputGroupAddon align="block-start">
            <AttachmentGroup className="w-full">
              <Attachment state="idle" size="sm" className="max-w-full" aria-label={`Selected file ${attachment.name}`}>
                <AttachmentMedia><FileText className="size-4" /></AttachmentMedia>
                <AttachmentContent><AttachmentTitle>{attachment.name}</AttachmentTitle><AttachmentDescription>Turtle · {formatAttachmentSize(attachment.size)} · Ready to send</AttachmentDescription></AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction aria-label={`Download ${attachment.name}`} title="Download attached file" onClick={downloadComposerUpload}><Download className="size-3" /></AttachmentAction>
                  <AttachmentAction aria-label={`Remove ${attachment.name}`} onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = ""; }}><X className="size-3" /></AttachmentAction>
                </AttachmentActions>
              </Attachment>
            </AttachmentGroup>
          </InputGroupAddon>}
          <div className="flex min-w-0 items-start px-1">
            {badgeDraft && <span className="ml-2 mt-3 inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium" title="Transcode mode — remove to return to normal chat">transcode <button type="button" aria-label="Exit Transcode mode" title="Exit Transcode mode" onClick={() => setDraft(composerText)} className="rounded-full p-0.5 hover:bg-accent"><X className="size-3" aria-hidden="true" /></button></span>}
            <PromptInputTextarea
              ref={inputRef} value={composerText} onChange={event => updateComposer(event.currentTarget.value)}
              onKeyDown={event => {
                if (badgeDraft && (event.key === "Backspace" || event.key === "Delete") &&
                  event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
                  event.preventDefault(); setDraft(composerText); return;
                }
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
              }}
              aria-label="Message Maestro" placeholder="Message Maestro…" rows={2}
              disabled={loading || !storageReady || selectingSurvey} className="min-w-0 flex-1" />
          </div>
          <InputGroupAddon align="block-end">
            <input ref={fileRef} type="file" accept=".ttl,text/turtle" className="hidden" aria-label="Attach Turtle file"
              onChange={event => setAttachment(event.currentTarget.files?.[0] ?? null)} />
            <InputGroupButton type="button" variant="outline" size="icon-sm" className="rounded-full" title="Attach Turtle (.ttl)" aria-label="Attach files"
              onClick={() => fileRef.current?.click()}><Plus className="size-4" /></InputGroupButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><InputGroupButton type="button" variant="ghost" size="sm" className="ml-auto gap-1" aria-label="Select model">Qwen <ChevronDown className="size-3" /></InputGroupButton></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuRadioGroup value={modelId} onValueChange={() => {}}>
                  <DropdownMenuGroup><DropdownMenuLabel>Qwen</DropdownMenuLabel>
                    <DropdownMenuRadioItem value={modelId}>{modelId.replace("qwen/", "")}</DropdownMenuRadioItem>
                  </DropdownMenuGroup>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="relative shrink-0" role="group" aria-label="Qwen thinking budget"
              onMouseEnter={() => setThinkingExpanded(true)} onMouseLeave={() => setThinkingExpanded(false)}
              onFocusCapture={() => setThinkingExpanded(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setThinkingExpanded(false); }}>
              <InputGroupButton type="button" variant="ghost" size="sm" aria-expanded={thinkingExpanded}
                aria-label={`Thinking budget: ${thinkingBudget === 0 ? "Off" : `${thinkingBudget.toLocaleString()} tokens`}`}
                onClick={() => setThinkingExpanded(value => !value)}>
                Thinking: {thinkingBudget === 0 ? "Off" : `${thinkingBudget.toLocaleString()}`} <ChevronDown className="size-3" />
              </InputGroupButton>
              {thinkingExpanded && <div className="absolute bottom-full right-0 z-50 w-60 rounded-lg border bg-popover p-3 shadow-lg">
                <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                  <span>Thinking budget</span><span className="tabular-nums">{thinkingBudget === 0 ? "Off" : `${thinkingBudget.toLocaleString()} tokens`}</span>
                </div>
                <Slider min={0} max={QWEN_THINKING_BUDGETS.length - 1} step={1}
                  value={[thinkingIndex]} onValueChange={(values) => {
                    const selected = QWEN_THINKING_BUDGETS[values[0]];
                    if (selected !== undefined) setThinkingBudget(selected);
                  }} disabled={loading} aria-label="Thinking budget" />
                <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">
                  <span>Off</span><span>512</span><span>1K</span><span>4K</span><span>8K</span>
                </div>
              </div>}
            </div>
            <InputGroupButton type="button" variant="outline" size="icon-sm" className="rounded-full" onClick={onShowResults} aria-label="Back to results" title="Back to results"><List className="size-4" /></InputGroupButton>
            {loading ? <InputGroupButton type="button" variant="default" size="icon-sm" className="rounded-full"
              onClick={stopGeneration} title="Stop generation" aria-label="Stop generation"><Square className="size-3.5 fill-current" /></InputGroupButton>
              : <PromptInputSubmit disabled={!draft.trim() || !storageReady || selectingSurvey}><ArrowUp className="size-4" /></PromptInputSubmit>}
          </InputGroupAddon>
        </PromptInput>
      </form>, composerHost)}
    </div>
  );
}
