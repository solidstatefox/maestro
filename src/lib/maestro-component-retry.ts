"use client";

import { useCallback, useSyncExternalStore } from "react";

/** An isolated retry epoch for a widget-owned query clone. No authoritative FCT
 * query, Browse revision, browser URL or History entry is changed. Each listener
 * continues to own cancellation, scope guards and replacement of its own data. */
const epochs = new Map<string, number>();
const listeners = new Set<() => void>();

export function retryMaestroComponent(source: string): void {
  if (!source.trim()) return;
  epochs.set(source, (epochs.get(source) ?? 0) + 1);
  for (const listener of listeners) listener();
}

export function componentRetryEpoch(source: string): number {
  return epochs.get(source) ?? 0;
}

export function subscribeComponentRetries(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Subscribe to only this component's query retry counter; the update triggers
 * only the request effect that explicitly includes its epoch as a dependency. */
export function useMaestroComponentRetry(source: string): number {
  const snapshot = useCallback(() => componentRetryEpoch(source), [source]);
  return useSyncExternalStore(subscribeComponentRetries, snapshot, snapshot);
}

/** Single opt-in transport flag understood by both the client and FCT proxy
 * query caches. This is a request hint, not a new API operation. */
export const MAESTRO_COMPONENT_RETRY_HEADER = "x-maestro-component-retry";
export function componentRetryHeaders(epoch: number): Record<string, string> {
  return epoch > 0 ? { [MAESTRO_COMPONENT_RETRY_HEADER]: "1" } : {};
}
