"use client";

/** Separate, persisted execution log. These entries are never included in model context. */
export type AssistantActivity = {
  id: string;
  createdAt: string;
  source: string;
  prompt: string;
  response: string;
  status: "success" | "error";
  usage?: { input?: number; output?: number; total?: number };
};

const DB_NAME = "maestro-assistant-activity";
const STORE = "events";
export const ASSISTANT_ACTIVITY_CHANGED = "maestro-assistant-activity-changed";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Assistant activity storage unavailable."));
  });
}

export async function readAssistantActivity(): Promise<AssistantActivity[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as AssistantActivity[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export async function appendAssistantActivity(items: AssistantActivity[]): Promise<void> {
  if (!items.length) return;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      for (const item of items) transaction.objectStore(STORE).put(item);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
  window.dispatchEvent(new Event(ASSISTANT_ACTIVITY_CHANGED));
}

export async function clearAssistantActivity(): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
  window.dispatchEvent(new Event(ASSISTANT_ACTIVITY_CHANGED));
}
