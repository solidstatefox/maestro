import { proxyDebugHeaders } from "@/lib/proxy-debug";

const uriToShortform = new Map<string, string>();
const uriToLabel = new Map<string, string>();
const namespaceToPrefix = new Map<string, string>();
let nextNamespaceNumber = 1;
let hydrated = false;
const MAX_URI_CACHE_ENTRIES = 10_000;

/** Keep URI caches bounded so exploring a large RDF store cannot retain every URI forever. */
function trimCache<T>(cache: Map<string, T>) {
  while (cache.size > MAX_URI_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

const observationQueue = new Map<string, { uri: string; isNamedGraph: boolean }>();
let observationLifecycleListenersRegistered = false;
let observationFlushInFlight = false;
const OBSERVATION_BATCH_SIZE = 500;

function registerObservationFlushOnPageExit() {
  // URI observations are passive bookkeeping, not a polling task. Never issue
  // periodic requests while the user is idle; flush only when the queue reaches
  // its batch threshold or the page is actually leaving.
  if (typeof window === "undefined" || observationLifecycleListenersRegistered) return;
  observationLifecycleListenersRegistered = true;
  window.addEventListener("pagehide", () => { void flushUriObservations(true); });
}

async function flushUriObservations(useBeacon = false) {
  if (typeof window === "undefined" || observationFlushInFlight || observationQueue.size === 0) return;
  const batch = Array.from(observationQueue.values()).slice(0, OBSERVATION_BATCH_SIZE);
  for (const item of batch) observationQueue.delete(item.uri);
  observationFlushInFlight = true;
  const debug = proxyDebugHeaders("uri-observations", "UriLabelObservationBatch");
  const payload = JSON.stringify({
    observations: batch,
    _debug: {
      source: debug["X-Maestro-Debug-Source"],
      component: debug["X-Maestro-Debug-Component"],
      requestId: debug["X-Maestro-Debug-Request"],
    },
  });
  try {
    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon("/proxy/api/observations", new Blob([payload], { type: "application/json" }));
      if (!sent) for (const item of batch) observationQueue.set(item.uri, item);
    } else {
      const response = await fetch("/proxy/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...debug },
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
  // URI labels are derived from FCT responses and namespace splitting. Do not
  // restore a monolithic persisted map: parsing it duplicates the entire cache
  // in memory and was capable of triggering out-of-memory crashes on large stores.
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
}

function persist() {
  // This is an intentionally ephemeral, bounded cache. The source labels are
  // returned by FCT again as needed, so persisting every URI is unnecessary.
  trimCache(uriToShortform);
  trimCache(uriToLabel);
  trimCache(namespaceToPrefix);
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
    registerObservationFlushOnPageExit();

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
