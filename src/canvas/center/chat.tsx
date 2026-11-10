"use client";

import { BasicAssistantChat } from "@/components/ai-elements/basic-chat";
import type { PersonalAuthSession } from "@/lib/personal-auth";

type PendingPrompt = Parameters<typeof BasicAssistantChat>[0]["pendingPrompt"];

export function MaestroChatPane({
  authSession, assistantPromptDraft, assistantPendingPrompt,
  onShowResults, onPendingPromptConsumed,
}: {
  authSession: PersonalAuthSession | null;
  assistantPromptDraft: string;
  assistantPendingPrompt: PendingPrompt;
  onShowResults: () => void;
  onPendingPromptConsumed: (id: NonNullable<PendingPrompt>["id"]) => void;
}) {
  return (
    <div id="central-panel-chat" role="region" aria-label="Maestro assistant chat" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BasicAssistantChat
        userName={authSession ? (authSession.userName || authSession.username || "User") : undefined}
        userAvatarUrl={authSession?.avatarUrl}
        onShowResults={onShowResults}
        initialDraft={assistantPromptDraft}
        pendingPrompt={assistantPendingPrompt}
        onPendingPromptConsumed={onPendingPromptConsumed}
      />
    </div>
  );
}
