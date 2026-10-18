import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import * as path from "node:path";

type UriObservation = { uri: string; isNamedGraph: boolean };
type GraphRecord = {
  uri: string;
  uriHash: string;
  quadStore: string;
  quadStoreHash: string;
  uniqueVisits: number;
  firstVisited: string;
  lastVisited: string;
  isGraphUri: boolean;
  isGGGUri: boolean;
  clientHashes: string[];
};
type RegistryState = {
  version: 1;
  uris: Record<string, string>;
  graphs: Record<string, GraphRecord>;
  graphFacets: Record<string, string[]>;
};
type RegistryGlobal = typeof globalThis & {
  __maestroUriRegistryState?: RegistryState;
  __maestroUriRegistryLoad?: Promise<RegistryState>;
  __maestroUriRegistryWriteQueue?: Promise<void>;
};

const g = globalThis as RegistryGlobal;
const PREFIX = "https://w3id.org/maestro/registry#";
const EMPTY_STATE: RegistryState = { version: 1, uris: {}, graphs: {}, graphFacets: {} };

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function registryDirectory(): string {
  const configured = process.env.MAESTRO_URI_REGISTRY_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), ".maestro");
}

function jsonPath() { return path.join(registryDirectory(), "uri-registry.json"); }
function turtlePath() { return path.join(registryDirectory(), "uri-registry.ttl"); }

async function loadState(): Promise<RegistryState> {
  if (g.__maestroUriRegistryState) return g.__maestroUriRegistryState;
  if (!g.__maestroUriRegistryLoad) {
    g.__maestroUriRegistryLoad = (async () => {
      try {
        const parsed = JSON.parse(await readFile(jsonPath(), "utf8")) as Partial<RegistryState>;
        const state: RegistryState = {
          version: 1,
          uris: parsed.uris && typeof parsed.uris === "object" ? parsed.uris : {},
          graphs: parsed.graphs && typeof parsed.graphs === "object" ? parsed.graphs : {},
          graphFacets: parsed.graphFacets && typeof parsed.graphFacets === "object" ? parsed.graphFacets : {},
        };
        g.__maestroUriRegistryState = state;
        return state;
      } catch {
        g.__maestroUriRegistryState = { ...EMPTY_STATE, uris: {}, graphs: {}, graphFacets: {} };
        return g.__maestroUriRegistryState;
      }
    })();
  }
  return g.__maestroUriRegistryLoad;
}

function turtleLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
}

function turtleIri(value: string): string {
  // Encode characters not allowed in Turtle IRIREFs as percent escapes.
  const safe = value.replace(/[ <>"{}|\\^`]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  return `<${safe}>`;
}

function serializeTurtle(state: RegistryState): string {
  const lines = [
    "@prefix maestro: <https://w3id.org/maestro/registry#> .",
    "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
    "",
    "# Deterministic URI-hash lookup table.",
  ];
  for (const [uriHash, uri] of Object.entries(state.uris).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${turtleIri(`urn:maestro:uri-hash:${uriHash}`)} maestro:uri ${turtleIri(uri)} .`);
  }
  lines.push("", "# Per-quad-store graph observations. Client IP hashes are deliberately not serialized.");
  for (const record of Object.values(state.graphs).sort((a, b) => `${a.quadStoreHash}:${a.uriHash}`.localeCompare(`${b.quadStoreHash}:${b.uriHash}`))) {
    const observation = turtleIri(`urn:maestro:graph-observation:${record.quadStoreHash}:${record.uriHash}`);
    lines.push(`${observation} maestro:subject ${turtleIri(record.uri)} ;`);
    lines.push(`  maestro:uriHash ${turtleLiteral(record.uriHash)} ;`);
    lines.push(`  maestro:quadstore ${turtleIri(record.quadStore)} ;`);
    lines.push(`  maestro:quadstoreHash ${turtleLiteral(record.quadStoreHash)} ;`);
    lines.push(`  maestro:uniqueVisits "${record.uniqueVisits}"^^xsd:integer ;`);
    lines.push(`  maestro:firstVisited "${record.firstVisited}"^^xsd:dateTime ;`);
    lines.push(`  maestro:lastVisited "${record.lastVisited}"^^xsd:dateTime ;`);
    lines.push(`  maestro:isGraphUri "${record.isGraphUri}"^^xsd:boolean ;`);
    lines.push(`  maestro:isGGGUri "${record.isGGGUri}"^^xsd:boolean .`);
  }
  return `${lines.join("\n")}\n`;
}

async function persistState(state: RegistryState): Promise<void> {
  const directory = registryDirectory();
  await mkdir(directory, { recursive: true });
  const jsonTemp = `${jsonPath()}.tmp`;
  const ttlTemp = `${turtlePath()}.tmp`;
  await Promise.all([
    writeFile(jsonTemp, `${JSON.stringify(state, null, 2)}\n`, "utf8"),
    writeFile(ttlTemp, serializeTurtle(state), "utf8"),
  ]);
  await Promise.all([rename(jsonTemp, jsonPath()), rename(ttlTemp, turtlePath())]);
}

export async function recordUriObservations(input: {
  observations: UriObservation[];
  quadStore: string;
  clientIp: string;
}): Promise<{ recorded: number; graphsUpdated: number; registryFiles: { json: string; turtle: string } }> {
  const state = await loadState();
  const now = new Date().toISOString();
  const clientSalt = process.env.MAESTRO_VISIT_HASH_SALT || "maestro-local-registry-change-this-salt";
  const clientHash = input.clientIp && input.clientIp !== "unknown"
    ? hash(`${clientSalt}\u0000${input.clientIp}`)
    : "";
  const quadStoreHash = hash(input.quadStore);
  const uniqueUris = new Map<string, UriObservation>();
  for (const observation of input.observations) {
    const uri = observation.uri.trim();
    if (!uri) continue;
    const isSchemeGraph = /^(graph|ggg):\/\//i.test(uri);
    uniqueUris.set(uri, { uri, isNamedGraph: observation.isNamedGraph || isSchemeGraph });
  }

  let graphsUpdated = 0;
  for (const observation of uniqueUris.values()) {
    const uriHash = hash(observation.uri);
    state.uris[uriHash] = observation.uri;
    const isGraphUri = /^graph:\/\//i.test(observation.uri);
    const isGGGUri = /^ggg:\/\//i.test(observation.uri);
    if (!observation.isNamedGraph && !isGraphUri && !isGGGUri) continue;

    const graphKey = `${quadStoreHash}:${uriHash}`;
    let record = state.graphs[graphKey];
    if (!record) {
      record = state.graphs[graphKey] = {
        uri: observation.uri,
        uriHash,
        quadStore: input.quadStore,
        quadStoreHash,
        uniqueVisits: 0,
        firstVisited: now,
        lastVisited: now,
        isGraphUri,
        isGGGUri,
        clientHashes: [],
      };
    }
    // Keep a separate, unique list for the Graphs facet. Check membership
    // before inserting so repeat sightings never append duplicate facet items.
    const facetGraphs = state.graphFacets[quadStoreHash] ?? (state.graphFacets[quadStoreHash] = []);
    if (!facetGraphs.includes(observation.uri)) facetGraphs.push(observation.uri);

    record.lastVisited = now;
    record.isGraphUri = isGraphUri;
    record.isGGGUri = isGGGUri;
    // Do not invent a unique client when the deployment has not supplied a
    // trustworthy client IP. Counts remain accurate once proxy IP forwarding is configured.
    if (clientHash && !record.clientHashes.includes(clientHash)) {
      record.clientHashes.push(clientHash);
      record.uniqueVisits = record.clientHashes.length;
    }
    graphsUpdated++;
  }

  // Serialize writes so concurrent report batches cannot overwrite one another.
  const previous = g.__maestroUriRegistryWriteQueue ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => persistState(state));
  g.__maestroUriRegistryWriteQueue = next;
  await next;
  return {
    recorded: uniqueUris.size,
    graphsUpdated,
    registryFiles: { json: jsonPath(), turtle: turtlePath() },
  };
}

export async function getGraphFacets(quadStore: string): Promise<string[]> {
  const state = await loadState();
  const quadStoreHash = hash(quadStore);
  return [...(state.graphFacets[quadStoreHash] ?? [])];
}
