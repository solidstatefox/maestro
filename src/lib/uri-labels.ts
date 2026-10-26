import { proxyDebugHeaders } from "@/lib/proxy-debug";

const uriToShortform = new Map<string, string>();
const uriToLabel = new Map<string, string>();
const namespaceToPrefix = new Map<string, string>();
const namespaceToLabel = new Map<string, string>();
let nextNamespaceNumber = 1;
let hydrated = false;
const MAX_URI_CACHE_ENTRIES = 10_000;

/** Namespace prefixes and labels taken from the public vocabularies' RDF/ RDFS descriptions. */
const KNOWN_NAMESPACE_METADATA = [
  { namespace: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", prefix: "rdf", label: "RDF Syntax" },
  { namespace: "http://www.w3.org/2000/01/rdf-schema#", prefix: "rdfs", label: "RDF Schema" },
  { namespace: "http://www.w3.org/2002/07/owl#", prefix: "owl", label: "Web Ontology Language" },
  { namespace: "http://www.w3.org/2001/XMLSchema#", prefix: "xsd", label: "XML Schema Datatypes" },
  { namespace: "http://purl.org/dc/terms/", prefix: "dcterms", label: "DCMI Metadata Terms" },
  { namespace: "http://purl.org/dc/elements/1.1/", prefix: "dc", label: "Dublin Core Metadata Element Set" },
  { namespace: "http://www.w3.org/2004/02/skos/core#", prefix: "skos", label: "SKOS Vocabulary" },
  { namespace: "http://rdfs.org/scot/ns#", prefix: "scot", label: "Social Semantic Cloud of Tags Ontology" },
  { namespace: "http://www.w3.org/2002/01/bookmark#", prefix: "bookmark", label: "Annotea Bookmark Schema" },
  { namespace: "http://www.w3.org/2000/10/annotation-ns#", prefix: "a", label: "Annotea Annotation Schema" },
  { namespace: "http://rdfs.org/sioc/ns#", prefix: "sioc", label: "Semantically-Interlinked Online Communities Ontology" },
  { namespace: "https://schema.org/", prefix: "schema", label: "Schema.org Vocabulary" },
  { namespace: "http://xmlns.com/foaf/0.1/", prefix: "foaf", label: "Friend of a Friend Vocabulary" },
  { namespace: "http://www.w3.org/2006/vcard/ns#", prefix: "vcard", label: "vCard Ontology" },
  { namespace: "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#", prefix: "vfct", label: "Virtuoso Faceted Browser API" },
] as const;

for (const item of KNOWN_NAMESPACE_METADATA) {
  namespaceToPrefix.set(item.namespace, item.prefix);
  namespaceToLabel.set(item.namespace, item.label);
}

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
  // URI labels are derived from live FCT responses and namespace splitting. Do
  // not restore a monolithic persisted map; large stores can exhaust browser memory.
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
}

function persist() {
  trimCache(uriToShortform);
  trimCache(uriToLabel);
  trimCache(namespaceToPrefix);
  trimCache(namespaceToLabel);
}

/** Merge namespace prefix/label metadata discovered from public LOD ontology documents. */
export function rememberNamespaceMetadata(input: unknown) {
  if (!Array.isArray(input)) return;
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const namespace = typeof record.namespace === "string" ? record.namespace.trim() : "";
    const prefix = typeof record.prefix === "string" ? record.prefix.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!namespace) continue;
    if (prefix) namespaceToPrefix.set(namespace, prefix);
    if (label) namespaceToLabel.set(namespace, label);
  }
  persist();
}

/** Return the known human-readable title of a namespace, when available. */
export function toNamespaceLabel(namespace: string): string | undefined {
  return namespaceToLabel.get(namespace);
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
    const isNamedGraph = record.isNamedGraph === true || /^(graph|ggg):\/\//i.test(uri);
    const priorObservation = observationQueue.get(uri);
    observationQueue.set(uri, { uri, isNamedGraph: isNamedGraph || priorObservation?.isNamedGraph === true });
    registerObservationFlushOnPageExit();
    if (label && label !== uri && uriToLabel.get(uri) !== label) {
      uriToLabel.set(uri, label);
      changed = true;
    }
    if (shortform && shortform !== uri && uriToShortform.get(uri) !== shortform) {
      uriToShortform.set(uri, shortform);
      changed = true;
    }
  }
  if (changed) persist();
  if (observationQueue.size >= OBSERVATION_BATCH_SIZE) void flushUriObservations();
}

function splitNamespace(uri: string): { namespace: string; local: string } {
  const hash = uri.lastIndexOf("#");
  if (hash >= 0 && hash < uri.length - 1) return { namespace: uri.slice(0, hash + 1), local: uri.slice(hash + 1) };
  const slash = uri.lastIndexOf("/");
  if (slash >= 0 && slash < uri.length - 1) return { namespace: uri.slice(0, slash + 1), local: uri.slice(slash + 1) };
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
  if (known && known !== uri) return known;
  if (known === uri) uriToShortform.delete(uri);
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
  const generatedLabel = `${prefix}:${decodedLocal}`;
  uriToShortform.set(uri, generatedLabel);
  persist();
  return generatedLabel;
}
