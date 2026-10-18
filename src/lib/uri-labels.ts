const STORAGE_KEY = "virtuoso-fct-uri-labels-v1";
const uriToShortform = new Map<string, string>();
const uriToLabel = new Map<string, string>();
const namespaceToPrefix = new Map<string, string>();
let nextNamespaceNumber = 1;
let hydrated = false;

const observationQueue = new Map<string, { uri: string; isNamedGraph: boolean }>();
let observationTimer: number | undefined;
let observationFlushInFlight = false;
const OBSERVATION_BATCH_SIZE = 500;
const OBSERVATION_INTERVAL_MS = 15_000;

function startObservationReporting() {
  if (typeof window === "undefined" || observationTimer) return;
  observationTimer = window.setInterval(() => { void flushUriObservations(); }, OBSERVATION_INTERVAL_MS);
  window.addEventListener("pagehide", () => { void flushUriObservations(true); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushUriObservations(true);
  });
}

async function flushUriObservations(useBeacon = false) {
  if (typeof window === "undefined" || observationFlushInFlight || observationQueue.size === 0) return;
  const batch = Array.from(observationQueue.values()).slice(0, OBSERVATION_BATCH_SIZE);
  for (const item of batch) observationQueue.delete(item.uri);
  observationFlushInFlight = true;
  const payload = JSON.stringify({ observations: batch });
  try {
    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon("/api/observations", new Blob([payload], { type: "application/json" }));
      if (!sent) for (const item of batch) observationQueue.set(item.uri, item);
    } else {
      const response = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: useBeacon,
      });
      if (!response.ok) for (const item of batch) observationQueue.set(item.uri, item);
    }
  } catch {
    for (const item of batch) observationQueue.set(item.uri, item);
  } finally {
    observationFlushInFlight = false;
  }
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      for (const [uri, shortform] of Object.entries(parsed.shortforms ?? {})) {
        // Older cache entries may have stored the URI itself as its "shortform".
        // Keep only useful labels; toLabel() will regenerate a compact fallback.
        if (typeof shortform === "string" && shortform.trim() && shortform.trim() !== uri.trim()) {
          uriToShortform.set(uri, shortform.trim());
        }
      }
      for (const [uri, label] of Object.entries(parsed.labels ?? {})) {
        if (typeof label === "string" && label.trim() && label.trim() !== uri.trim()) {
          uriToLabel.set(uri, label.trim());
        }
      }
      for (const [namespace, prefix] of Object.entries(parsed.namespaces ?? {})) {
        if (typeof prefix === "string" && prefix) namespaceToPrefix.set(namespace, prefix);
      }
      const storedNext = Number(parsed.nextNamespaceNumber);
      if (Number.isFinite(storedNext) && storedNext >= 1) nextNamespaceNumber = Math.floor(storedNext);
    }
  } catch {
    // Ignore malformed or unavailable local storage; labels still work in memory.
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      shortforms: Object.fromEntries(uriToShortform),
      labels: Object.fromEntries(uriToLabel),
      namespaces: Object.fromEntries(namespaceToPrefix),
      nextNamespaceNumber,
    }));
  } catch {
    // Storage may be disabled or full; the in-memory maps remain usable.
  }
}

export function rememberShortforms(input: unknown) {
  hydrate();
  if (!Array.isArray(input)) return;
  let changed = false;
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const uri = typeof record.uri === "string" ? record.uri.trim() : "";
    const shortform = typeof record.shortform === "string" ? record.shortform.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!uri) continue;

    // Queue every URI returned by FCT for periodic server-side hash registration.
    // The server determines the selected quad store and client IP; neither is
    // accepted from this browser payload.
    const isNamedGraph = record.isNamedGraph === true || /^(graph|ggg):\/\//i.test(uri);
    const priorObservation = observationQueue.get(uri);
    observationQueue.set(uri, { uri, isNamedGraph: isNamedGraph || priorObservation?.isNamedGraph === true });
    startObservationReporting();

    // A label supplied by the FCT response takes precedence over compact
    // namespace labels and shortforms when one is available.
    if (label && label !== uri && uriToLabel.get(uri) !== label) {
      uriToLabel.set(uri, label);
      changed = true;
    }
    // Virtuoso sometimes reports the URI itself as its shortform.
    if (shortform && shortform !== uri && uriToShortform.get(uri) !== shortform) {
      uriToShortform.set(uri, shortform);
      changed = true;
    }
  }
  if (changed) persist();
  if (observationQueue.size >= OBSERVATION_BATCH_SIZE) void flushUriObservations();
}

function splitNamespace(uri: string): { namespace: string; local: string } {
  // URI fragments take precedence; otherwise use the last path separator.
  const hash = uri.lastIndexOf("#");
  if (hash >= 0 && hash < uri.length - 1) return { namespace: uri.slice(0, hash + 1), local: uri.slice(hash + 1) };
  const slash = uri.lastIndexOf("/");
  if (slash >= 0 && slash < uri.length - 1) return { namespace: uri.slice(0, slash + 1), local: uri.slice(slash + 1) };
  // For URNs and other opaque identifiers, split on the final colon.
  const colon = uri.lastIndexOf(":");
  if (colon >= 0 && colon < uri.length - 1) return { namespace: uri.slice(0, colon + 1), local: uri.slice(colon + 1) };
  return { namespace: "", local: uri };
}

export function toLabel(value: string): string {
  const uri = value.trim();
  if (!uri) return value;
  hydrate();
  const realLabel = uriToLabel.get(uri);
  if (realLabel && realLabel !== uri) return realLabel;
  const known = uriToShortform.get(uri);
  // Treat URI-to-itself mappings as missing labels, including stale in-memory entries.
  if (known && known !== uri) return known;
  if (known === uri) uriToShortform.delete(uri);
  // Already-compact labels and ordinary text are not rewritten.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(uri) || !/^https?:\/\//i.test(uri) && !uri.includes("/")) return value;
  const { namespace, local } = splitNamespace(uri);
  if (!namespace || !local) return value;
  let prefix = namespaceToPrefix.get(namespace);
  if (!prefix) {
    prefix = `ns${nextNamespaceNumber++}`;
    namespaceToPrefix.set(namespace, prefix);
    persist();
  }
  let decodedLocal: string;
  try { decodedLocal = decodeURIComponent(local); }
  catch { decodedLocal = local; }

  // Cache generated labels too, so repeated lookups and later browser sessions
  // use the same label. rememberShortforms() deliberately overwrites this entry
  // when a real FCT shortform for the URI arrives later.
  const generatedLabel = `${prefix}:${decodedLocal}`;
  uriToShortform.set(uri, generatedLabel);
  persist();
  return generatedLabel;
}
