"use client";
import { Star, EyeOff, Eye, EyeClosed } from "lucide-react";
import type { PersonalStatusPage } from "@/canvas/controllers/personal-record-status";
export function RecordStarButton({ statuses }: { statuses: PersonalStatusPage }) {
  if (!statuses.enabled) return null;
  const starred = statuses.selectedRecordStatuses.includes("Starred");
  return <button type="button" aria-label={starred ? "Remove star" : "Star Record"} title={starred ? "Unstar" : "Star"}
    aria-pressed={starred} disabled={statuses.recordBusy} onClick={() => void statuses.toggleRecordStatus("Starred", !starred)}
    className={`inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50 ${starred ? "text-amber-600" : ""}`}>
      <Star className={`size-4 ${starred ? "fill-current" : ""}`} aria-hidden="true" />
  </button>;
}
export function RecordStatusButtons({ statuses }: { statuses: PersonalStatusPage }) {
  if (!statuses.enabled) return null;
  const seen = statuses.selectedRecordStatuses.includes("Seen");
  const hidden = statuses.selectedRecordHidden;
  return <div className="flex w-full flex-wrap items-center gap-2 pt-1" role="group" aria-label="Personal Record status">
    <button type="button" disabled={statuses.recordBusy} aria-pressed={seen} onClick={() => void statuses.toggleRecordStatus("Seen", !seen)}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
      title={seen ? "Mark Record Unseen" : "Mark Record Seen"}>
      {seen ? <Eye className="size-4" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}{seen ? "Seen" : "Unseen"}
    </button>
    <button type="button" disabled={statuses.recordBusy} aria-pressed={hidden} onClick={() => void statuses.toggleHidden(!hidden)}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
      title={hidden ? "Unhide Record" : "Hide Record"}>
      {hidden ? <Eye className="size-4" aria-hidden="true" /> : <EyeClosed className="size-4" aria-hidden="true" />}{hidden ? "Unhide" : "Hide"}
    </button>
    {statuses.error && <span role="alert" className="text-xs text-destructive">{statuses.error}</span>}
  </div>;
}
