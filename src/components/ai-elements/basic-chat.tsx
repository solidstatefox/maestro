"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { ArrowUp, Bot, LoaderCircle, List, User } from "lucide-react";
import { createPortal } from "react-dom";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

type ChatRole = "user" | "assistant";
type ChatMessage = { id: string; role: ChatRole; content: string };
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
  const [draft, setDraft] = useState("");
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
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const priorMessages = messagesRef.current;
    const nextMessages = [...priorMessages, userMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setLoading(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Assistant request failed (HTTP ${response.status}).`);
      }
      const answer = typeof payload.message === "string" ? payload.message.trim() : "";
      if (!answer) throw new Error("Maestro returned an empty response.");
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: answer,
      };
      const completed = [...nextMessages, assistantMessage];
      messagesRef.current = completed;
      setMessages(completed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assistant request failed.");
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
        <Button type="button" variant="outline" size="sm" disabled={loading || messages.length === 0} onClick={() => {
          messagesRef.current = [];
          setMessages([]);
          setError("");
        }}>Clear chat</Button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite" aria-label="Chat messages">
        {!storageReady && <p className="text-sm text-muted-foreground">Loading saved chat…</p>}
        {storageReady && messages.length === 0 && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full border bg-muted"><Bot className="size-5" /></div>
            <h3 className="text-sm font-semibold">What would you like to ask?</h3>
            <p className="text-sm text-muted-foreground">Ask a question using the message field below the Query Tree.</p>
          </div>
        )}
        {messages.map((message) => (
          <Message key={message.id} role={message.role} userName={userName} userAvatarUrl={userAvatarUrl}>
            <Bubble role={message.role}>{message.content}</Bubble>
          </Message>
        ))}
        {loading && (
          <Message role="assistant">
            <Bubble role="assistant"><span className="inline-flex items-center gap-2 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Maestro is thinking…</span></Bubble>
          </Message>
        )}
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>
      {composerHost && createPortal(<form onSubmit={submit} className="w-full">
        <div className="rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            aria-label="Message Maestro"
            placeholder="Message Maestro…"
            rows={2}
            disabled={loading || !storageReady}
            className="max-h-40 min-h-12 w-full resize-y bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <p className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
            <ButtonGroup aria-label="Chat actions" className="shrink-0">
              <Button type="button" size="icon-sm" variant="outline" onClick={onShowResults} aria-label="Return to results" title="Results"><List className="size-4" /></Button>
              <Button type="submit" size="icon-sm" aria-label="Send message" disabled={!draft.trim() || loading || !storageReady}>
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </Button>
            </ButtonGroup>
          </div>
        </div>
      </form>, composerHost)}
    </div>
  );
}
