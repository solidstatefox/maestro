/**
 * IndexedDB-backed key/value storage for Maestro's persistent browser state.
 *
 * The synchronous API is an in-memory mirror for existing call sites; writes are
 * persisted asynchronously. initializeMaestroStorage() hydrates that mirror,
 * migrates legacy localStorage entries once, then removes the legacy entries.
 */
const DATABASE_NAME = "maestro-storage";
const DATABASE_VERSION = 1;
const STORE_NAME = "key-value";
const memory = new Map<string, string>();
let initialized = false;
let indexedDbAvailable = false;
let initialization: Promise<void> | null = null;
let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open Maestro storage."));
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

async function persistValue(key: string, value: string | undefined): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  if (value === undefined) store.delete(key);
  else store.put(value, key);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write was aborted."));
  });
}

/** Load IndexedDB and migrate existing localStorage keys without overwriting newer IDB values. */
export function initializeMaestroStorage(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const [keys, values] = await Promise.all([
        requestResult(store.getAllKeys()),
        requestResult(store.getAll()),
      ]);
      for (let index = 0; index < keys.length; index += 1) {
        if (typeof keys[index] === "string" && typeof values[index] === "string") {
          memory.set(keys[index] as string, values[index] as string);
        }
      }

      // Migrate legacy keys in one transaction, and only remove localStorage
      // after the IndexedDB transaction commits successfully.
      const legacy: Array<[string, string]> = [];
      try {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (key === null) continue;
          const value = window.localStorage.getItem(key);
          // URI labels are a disposable derived cache. Migrating the old
          // monolithic JSON blob would immediately recreate the memory spike.
          if (value !== null && key !== "virtuoso-fct-uri-labels-v1") legacy.push([key, value]);
        }
      } catch {
        // Private browsing or browser policy may disable localStorage.
      }
      if (legacy.length) {
        const migration = db.transaction(STORE_NAME, "readwrite");
        const target = migration.objectStore(STORE_NAME);
        for (const [key, value] of legacy) {
          if (!memory.has(key)) {
            target.put(value, key);
            memory.set(key, value);
          }
        }
        await new Promise<void>((resolve, reject) => {
          migration.oncomplete = () => resolve();
          migration.onerror = () => reject(migration.error ?? new Error("Storage migration failed."));
          migration.onabort = () => reject(migration.error ?? new Error("Storage migration was aborted."));
        });
      }
      // Remove legacy entries only after every non-disposable value has been
      // safely copied (or confirmed already present) in IndexedDB.
      try { window.localStorage.clear(); } catch { /* legacy cleanup is best effort */ }
      indexedDbAvailable = true;
      initialized = true;
    } catch (error) {
      // Keep the app usable when IndexedDB is blocked. Existing localStorage is
      // retained as a fallback and writes remain in the in-memory mirror.
      console.error("[Maestro Storage] IndexedDB initialization failed; using browser fallback.", error);
      indexedDbAvailable = false;
      initialized = true;
    }
  })();
  return initialization;
}

/** Synchronous mirror read, with legacy localStorage fallback before initialization. */
export function maestroStorageGet(key: string): string | null {
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  if (!indexedDbAvailable && typeof window !== "undefined") {
    try { return window.localStorage.getItem(key); } catch { /* unavailable */ }
  }
  return null;
}

/** Update the memory mirror immediately and persist to IndexedDB asynchronously. */
export function maestroStorageSet(key: string, value: string): void {
  memory.set(key, value);
  void persistValue(key, value).catch((error) => {
    console.error(`[Maestro Storage] Could not persist key ${key}.`, error);
  });
}

/** Remove one key from the memory mirror and IndexedDB. */
export function maestroStorageRemove(key: string): void {
  memory.delete(key);
  void persistValue(key, undefined).catch((error) => {
    console.error(`[Maestro Storage] Could not remove key ${key}.`, error);
  });
}

/** Clear all Maestro-origin browser storage, including any remaining legacy keys. */
export async function clearMaestroStorage(): Promise<void> {
  memory.clear();
  try {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear IndexedDB."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB clear was aborted."));
    });
  } finally {
    try { window.localStorage.clear(); } catch { /* best effort */ }
  }
}

/** Remove a set of related keys, waiting for all IndexedDB deletions to finish. */
export async function maestroStorageRemoveMany(keys: string[]): Promise<void> {
  for (const key of keys) memory.delete(key);
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  for (const key of keys) store.delete(key);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB delete failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB delete was aborted."));
  });
}

/** Approximate IndexedDB key/value payload size for the controls panel. */
export async function getMaestroStorageUsageBytes(): Promise<number> {
  await initializeMaestroStorage();
  let bytes = 0;
  for (const [key, value] of memory) bytes += (key.length + value.length) * 2;
  return bytes;
}

/** True after the first storage initialization attempt has completed. */
export function isMaestroStorageInitialized(): boolean {
  return initialized;
}
