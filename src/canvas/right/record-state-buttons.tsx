"use client";
import { Star, EyeOff, Eye, EyeClosed } from "lucide-react";
import type { PersonalStatesPage } from "@/canvas/controllers/personal-record-states";
export function RecordStarButton({ states }: { states: PersonalStatesPage }) {
  if (!states.enabled) return null;
  const starred = states.selectedRecordStates.includes("Starred");
  return <button type="button" aria-label={starred ? "Remove star" : "Star Record"} title={starred ? "Unstar" : "Star"}
    aria-pressed={starred} disabled={states.recordBusy} onClick={() => void states.toggleRecordState("Starred", !starred)}
    className={`inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50 ${starred ? "text-amber-600" : ""}`}>
      <Star className={`size-4 ${starred ? "fill-current" : ""}`} aria-hidden="true" />
  </button>;
}
export function RecordStateButtons({ states }: { states: PersonalStatesPage }) {
  if (!states.enabled) return null;
  const seen = states.selectedRecordStates.includes("Seen");
  const hidden = states.selectedRecordHidden;
  return <div className="flex w-full flex-wrap items-center gap-2 pt-1" role="group" aria-label="Personal Record states">
    <button type="button" disabled={states.recordBusy} aria-pressed={seen} onClick={() => void states.toggleRecordState("Seen", !seen)}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
      title={seen ? "Mark Record Unseen" : "Mark Record Seen"}>
      {seen ? <Eye className="size-4" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}{seen ? "Seen" : "Unseen"}
    </button>
    <button type="button" disabled={states.recordBusy} aria-pressed={hidden} onClick={() => void states.toggleHidden(!hidden)}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
      title={hidden ? "Unhide Record" : "Hide Record"}>
      {hidden ? <Eye className="size-4" aria-hidden="true" /> : <EyeClosed className="size-4" aria-hidden="true" />}{hidden ? "Unhide" : "Hide"}
    </button>
    {states.error && <span role="alert" className="text-xs text-destructive">{states.error}</span>}
  </div>;
}
