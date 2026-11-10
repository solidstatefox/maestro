"use client";

import { useRef, useState } from "react";

/** State owned by the chat subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useChatState() {
  const [assistantPromptDraft, setAssistantPromptDraft] = useState("");
  const [assistantPendingPrompt, setAssistantPendingPrompt] = useState<{ id: number; text: string } | null>(null);
  const assistantPromptIdRef = useRef(0);

  return {
    assistantPromptDraft,
    setAssistantPromptDraft,
    assistantPendingPrompt,
    setAssistantPendingPrompt,
    assistantPromptIdRef,
  };
}
