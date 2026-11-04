"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { ArrowUp, Bot, LoaderCircle, List, User, Plus, X, Download, ChevronDown, Terminal as TerminalIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Trace, TraceCollapsible, TraceCollapsibleTrigger, TraceCollapsibleContent, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { appendAssistantActivity, readAssistantActivity, clearAssistantActivity, ASSISTANT_ACTIVITY_CHANGED, type AssistantActivity } from "@/lib/assistant-activity";

type OtcProgressEvent = {
  step: "shape" | "ask" | "select" | "shacl" | "qwen" | "liquid" | "cleanup";
  status: "running" | "success" | "warning" | "error";
  detail: string;
  rule?: string;
  shape?: string;
  message?: string;
  violations?: string[];
  counts?: { checked?: number; passed?: number; failed?: number; triples?: number };
};
type ChatRole = "user" | "assistant";
type ChatMessage = {
  id: string; role: ChatRole; content: string;
  createdAt?: string;
  usage?: { input?: number; output?: number; total?: number };
  download?: { name: string; content: string };
  transcode?: { fileName: string; inputGraph?: string; rulesGraph?: string; surveyTitle?: string; surveyIri?: string };
  surveyOptions?: Array<{ uri: string; title: string; description: string }>;
  otcProgress?: OtcProgressEvent[];
};
type PendingPrompt = { id: number; text: string } | null;

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
        <span className="mb-1 text-[11px] text-muted-foreground">{role === "user" ? "You · Ask assistant" : "Maestro · Ask assistant"}</span>
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
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void readAssistantActivity().then((rows) => { if (mounted) setActivity(rows); }).catch(() => {}); };
    refresh();
    window.addEventListener(ASSISTANT_ACTIVITY_CHANGED, refresh);
    return () => { mounted = false; window.removeEventListener(ASSISTANT_ACTIVITY_CHANGED, refresh); };
  }, []);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
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
    setDraft("");
    const sentAttachment = attachment;
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = "";

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      ...(sentAttachment && /^transcode\b/i.test(text) ? { transcode: { fileName: sentAttachment.name } } : {}),
    };
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
        const response = await fetch("/proxy/api/otc/chat", { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as {
          error?: string; rulesGraph?: string;
          surveys?: Array<{ uri: string; title: string; description: string }>;
        };
        if (!response.ok) throw new Error(data.error || `Could not load surveys (HTTP ${response.status}).`);
        if (!data.surveys?.length) throw new Error("No OTC surveys are installed in the Personal rules graph.");
        pendingTranscode.current = { messageId: userMessage.id, prompt: text, file: sentAttachment! };
        setSelectingSurvey(true);
        const menuMessage: ChatMessage = {
          id: crypto.randomUUID(), role: "assistant", content: "Choose one survey to run. Qwen will only receive the selected survey.",
          surveyOptions: data.surveys,
          createdAt: new Date().toISOString(),
        };
        const prepared = [...nextMessages, menuMessage];
        prepared[prepared.length - 2] = { ...userMessage, transcode: {
          fileName: sentAttachment!.name, rulesGraph: data.rulesGraph,
        } };
        messagesRef.current = prepared;
        setMessages(prepared);
        setLoading(false);
        return;
      } else {
        const response = await fetch("/api/assistant", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages.map(({ role, content }) => ({ role, content })) }),
        });
        const payload = await response.json().catch(() => ({})) as {
          error?: string; message?: string;
          usage?: { input?: number; output?: number; total?: number };
        };
        if (!response.ok) throw new Error(payload.error || `Assistant request failed (HTTP ${response.status}).`);
        answer = typeof payload.message === "string" ? payload.message.trim() : "";
        if (!answer) throw new Error("Maestro returned an empty response.");
        usage = payload.usage;
      }
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(), role: "assistant", content: answer,
        createdAt: new Date().toISOString(),
        ...(usage ? { usage } : {}),
        ...(download ? { download } : {}),
      };
      const completed = [...nextMessages, assistantMessage];
      messagesRef.current = completed;
      setMessages(completed);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The assistant request failed.";
      setError(message);
      void appendAssistantActivity([{
        id: crypto.randomUUID(), createdAt: new Date().toISOString(),
        source: "Ask assistant", prompt: text, response: message, status: "error",
      }]).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [loading, attachment]);

  const runSelectedSurvey = useCallback(async (option: { uri: string; title: string }, menuId: string) => {
    const pending = pendingTranscode.current;
    if (!pending || loading) return;
    setError("");
    setLoading(true);
    setSelectingSurvey(false);
    pendingTranscode.current = null;
    const prepared = messagesRef.current.map(message => {
      if (message.id === menuId) return { ...message, surveyOptions: undefined,
        content: `Running selected survey: ${option.title}` };
      if (message.id === pending.messageId) return { ...message, transcode: {
        ...message.transcode!, fileName: pending.file.name,
        surveyTitle: option.title, surveyIri: option.uri,
      } };
      return message;
    });
    messagesRef.current = prepared;
    setMessages(prepared);
    try {
      const form = new FormData();
      form.set("prompt", pending.prompt);
      form.set("file", pending.file);
      form.set("transcoder", option.uri);
      const response = await fetch("/proxy/api/otc/chat", {
        method: "POST", body: form, cache: "no-store", headers: { Accept: "application/x-ndjson" },
      });
      if (!response.ok || !response.body) throw new Error(`Could not start OTC stream (HTTP ${response.status}).`);
      const streamState: { complete?: { status: number; result: unknown } } = {};
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const packet = JSON.parse(line) as
          | { kind: "progress"; event: OtcProgressEvent }
          | { kind: "complete"; status: number; result: unknown };
        if (packet.kind === "progress") {
          const updated = messagesRef.current.map(message => message.id === menuId ? {
            ...message, otcProgress: [...(message.otcProgress ?? []), packet.event],
          } : message);
          messagesRef.current = updated;
          setMessages(updated);
        } else streamState.complete = packet;
      };
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            handleLine(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) handleLine(buffer);
      } finally { reader.releaseLock(); }
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
    } catch (cause) {
      const description = cause instanceof Error ? cause.message : "Transcoding failed.";
      setError(description);
      const failed = [...messagesRef.current, { id: crypto.randomUUID(), role: "assistant" as const,
        content: `Survey failed: ${description}`, createdAt: new Date().toISOString() }];
      messagesRef.current = failed;
      setMessages(failed);
    } finally {
      setLoading(false);
    }
  }, [loading]);

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
          pendingTranscode.current = null;
          setSelectingSurvey(false);
          setAttachment(null);
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
            {message.otcProgress && <Trace className="mt-2 max-w-full text-xs">
              <TraceCollapsible defaultOpen>
                <TraceCollapsibleTrigger><TraceLine><TraceIcon><TerminalIcon className="size-4" /></TraceIcon>
                  <TraceTitle>OTC execution · SHACL validation and Qwen</TraceTitle>
                  <span className="text-muted-foreground">({message.otcProgress.length} events)</span>
                </TraceLine></TraceCollapsibleTrigger>
                <TraceCollapsibleContent><div className="max-h-80 space-y-1 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs" role="log" aria-label="OTC execution events">
                  {message.otcProgress.map((event, index) => <details key={index} className="border-b border-border/50 pb-1 last:border-0">
                    <summary className="cursor-pointer whitespace-pre-wrap break-words">
                      <span className={event.status === "error" ? "text-destructive" : event.status === "warning" ? "text-amber-600 dark:text-amber-400" : event.status === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                        {event.status === "running" ? "…" : event.status === "success" ? "✓" : event.status === "warning" ? "!" : "✕"}
                      </span>{" "}[{event.step.toUpperCase()}] {event.detail}
                    </summary>
                    <div className="ml-4 mt-1 space-y-1 whitespace-pre-wrap break-all text-muted-foreground">
                      {event.rule && <div>Rule: {event.rule}</div>}
                      {event.shape && <div>SHACL shape: {event.shape}</div>}
                      {event.message && <div>Focus node: {event.message}</div>}
                      {event.counts && <div>Counts: {JSON.stringify(event.counts)}</div>}
                      {event.violations?.map((violation, i) => <div key={i} className="text-destructive">Violation: {violation}</div>)}
                    </div>
                  </details>)}
                </div></TraceCollapsibleContent>
              </TraceCollapsible>
            </Trace>}
            {message.surveyOptions?.length ? <div className="mt-2 w-full max-w-md space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Choose one survey</p>
              <div className="scrollbar-none flex scroll-fade-x gap-2 overflow-x-auto overscroll-x-contain pb-1">
                {message.surveyOptions.map(option => <Button key={option.uri} type="button" variant="outline" size="sm"
                  title={option.description || option.uri} className="h-auto shrink-0 whitespace-nowrap"
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
                <summary className="cursor-pointer text-xs font-medium">Prompt sent to Qwen</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{entry.prompt}</pre>
              </details>
              <div className="text-xs font-medium">Qwen response</div>
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
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>
      {composerHost && createPortal(<form onSubmit={submit} className="w-full">
        <InputGroup>
          {attachment && <InputGroupAddon align="block-start">
            <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
              <span className="truncate" title={attachment.name}>{attachment.name}</span>
              <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label="Remove attachment" onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = ""; }}><X className="size-3" /></button>
            </span>
          </InputGroupAddon>}
          <div className="flex min-w-0 items-start px-1">
            {badgeDraft && <span className="ml-2 mt-3 shrink-0 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium" title="Backspace or Delete at the start of the text removes transcode">transcode</span>}
            <InputGroupTextarea
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
            <InputGroupButton type="button" variant="outline" size="icon-sm" className="rounded-full" onClick={onShowResults} aria-label="Back to results" title="Back to results"><List className="size-4" /></InputGroupButton>
            <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" aria-label="Send" disabled={!draft.trim() || loading || !storageReady || selectingSurvey}>
              {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>, composerHost)}
    </div>
  );
}
