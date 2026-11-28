/** Passive observation of actual browser queue admission. No request authority,
 * transport metadata, extra requests, or parallel queue. The observer travels
 * only through the same real signal-composition boundaries as its request. */
type Admission = { source: AbortSignal; notify: () => void; fired: boolean; closed: boolean };
const admissions = new WeakMap<AbortSignal, Admission>();
export function observeQueryQueueAdmission(signal: AbortSignal, notify: () => void): () => void {
  const admission: Admission = { source: signal, notify, fired: false, closed: false };
  const previous = admissions.get(signal);
  if (previous) previous.closed = true;
  admissions.set(signal, admission);
  return () => { admission.closed = true; if (admissions.get(signal) === admission) admissions.delete(signal); };
}
export function inheritQueryQueueObservation(source: AbortSignal | null | undefined, derived: AbortSignal): void {
  const admission = source && admissions.get(source);
  if (admission) admissions.set(derived, admission);
}
export function observeAdmittedQuery(signal: AbortSignal | null | undefined): void {
  const admission = signal && admissions.get(signal);
  if (!admission || admission.closed || admission.fired || admission.source.aborted || signal?.aborted) return;
  admission.fired = true;
  try { admission.notify(); } catch { /* A passive diagnostic cannot veto admission. */ }
}
