/** Independent XState invocations can own prerequisite reads without borrowing
 * a foreground ribbon. The capability lives only for the invoked job; derived
 * transport signals share its revocation, without retaining a signal registry.
 * Debug headers, an arbitrary AbortSignal, and an expired job confer no authority. */
export type QueryActorOwner = "query-context" | "perspective-discovery" | "analysis-discovery"
  | "personal-perspective-discovery" | "bookmark-verification" | "pending-approvals"
  | "provider-policy" | "personal-directory" | "history-navigation" | "bookmark-metadata";
type Authority = { readonly owner: QueryActorOwner; active: boolean };
const authorities = new WeakMap<AbortSignal, Authority>();
export async function runActorQuery<T>(owner: QueryActorOwner, signal: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  if (authorities.has(signal)) throw new Error("XState query authority is already assigned.");
  const authority: Authority = { owner, active: true };
  authorities.set(signal, authority);
  try { const result = await run(signal); signal.throwIfAborted(); return result; }
  finally { authority.active = false; }
}
/** Only use at a real signal-composition boundary, never to authorize a caller. */
export function inheritActorQueryAuthority(source: AbortSignal | null | undefined, derived: AbortSignal): void {
  const authority = source && authorities.get(source);
  if (authority) authorities.set(derived, authority);
}
export function getActorQueryAuthority(signal: AbortSignal | null | undefined): QueryActorOwner | undefined {
  const authority = signal && authorities.get(signal);
  if (!authority) return undefined;
  if (!authority.active || signal?.aborted) throw new DOMException("The XState query actor is inactive", "AbortError");
  return authority.owner;
}
export function actorQueryAllowed(owner: QueryActorOwner, selection: { tab: string; viewPanel: string }): boolean {
  switch (owner) {
    case "query-context": return selection.tab === "analyze" || selection.tab === "view" && selection.viewPanel === "perspectives";
    case "perspective-discovery": case "personal-perspective-discovery": return selection.tab === "view" && selection.viewPanel === "perspectives";
    case "analysis-discovery": return selection.tab === "analyze";
    // These independent actors already gate their own account/query/session.
    default: return true;
  }
}
