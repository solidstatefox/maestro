"use client";
/** Only the latest authentication initialization may publish bootstrap/readiness.
 * These tokens never contain credentials and are never sent to the proxy. */
let revision = 0;
let active: AbortController | null = null;
export type PersonalInitialization = { revision: number; signal: AbortSignal };
export function beginPersonalInitialization(): PersonalInitialization {
  active?.abort();
  active = new AbortController();
  return {revision: ++revision, signal: active.signal};
}
export function isCurrentPersonalInitialization(attempt: PersonalInitialization): boolean {
  return attempt.revision === revision && !attempt.signal.aborted;
}
export function cancelPersonalInitialization(): void {
  active?.abort(); active = null; revision++;
}
