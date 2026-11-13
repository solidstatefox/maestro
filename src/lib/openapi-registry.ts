/** Reviewed OpenAPI operation registry. Browser requests identify the service and operation;
 * the server chooses the destination from an immutable OpenAPI document (never a caller URL).
 * New external services must be reviewed and registered here. */
export type ServiceOperation = { base: string; path: string; method: "GET" | "POST";
  parameters: readonly string[]; secretEnv?: string; maxRequestBytes?: number; timeoutMs?: number };

type OpenApiDocument = {
  openapi: "3.1.0";
  info: { title: string; version: string };
  servers: { url: string }[];
  paths: Record<string, { get?: { operationId: string; parameters: { name: string; in: "query"; required?: boolean; schema: { type: "string" } }[] },
    post?: {operationId: string; parameters: []; securityEnv?: string; maxRequestBytes?: number; timeoutMs?: number} }>;
};

const specifications: Record<string, OpenApiDocument> = {
  iteracompute: {
    openapi: "3.1.0", info: { title: "IteraCompute Chat Completions", version: "1" },
    servers: [{ url: "https://api.iteracompute.com" }],
    paths: { "/v1/chat/completions": { post: { operationId: "createChatCompletion", parameters: [],
      securityEnv: "ITERACOMPUTE_API_KEY", maxRequestBytes: 600000, timeoutMs: 180000 } } },
  },
  commons: {
    openapi: "3.1.0", info: { title: "Wikimedia Commons API", version: "1" },
    servers: [{ url: "https://commons.wikimedia.org" }],
    paths: { "/w/api.php": { get: { operationId: "searchImages", parameters: ["action","format","generator","gsrnamespace","gsrsearch","gsrlimit","prop","iiprop","iiurlwidth"].map(name => ({ name, in: "query", schema: { type: "string" } })) } } },
  },
  rank: {
    openapi: "3.1.0", info: { title: "Rank.to public ranking API", version: "1" },
    servers: [{ url: "https://rank.to" }],
    paths: { "/api/": { get: { operationId: "rankDomain", parameters: ["d","n"].map(name => ({ name, in: "query", schema: { type: "string" } })) } } },
  },
  prefixcc: {
    openapi: "3.1.0", info: { title: "prefix.cc JSON-LD Context", version: "1" },
    servers: [{ url: "https://prefix.cc" }],
    paths: { "/context.jsonld": { get: { operationId: "getPrefixes", parameters: [] } } },
  },
  zazuko: {
    openapi: "3.1.0", info: { title: "Zazuko Prefix Registry", version: "1" },
    servers: [{ url: "https://prefix.zazuko.com" }],
    paths: { "/api/v1/prefixes": { get: { operationId: "getPrefixes", parameters: [] } } },
  },
};

export function resolveOpenApiOperation(service: string, operationId: string): ServiceOperation | null {
  const spec = specifications[service];
  if (!spec) return null;
  for (const [path, item] of Object.entries(spec.paths)) {
    if (item.get?.operationId === operationId) return {
      base: spec.servers[0].url, path, method: "GET",
      parameters: item.get.parameters.map(param => param.name),
    };
    if (item.post?.operationId === operationId) return {
      base: spec.servers[0].url, path, method: "POST", parameters: [],
      secretEnv: item.post.securityEnv, maxRequestBytes: item.post.maxRequestBytes,
      timeoutMs: item.post.timeoutMs,
    };
  }
  return null;
}
