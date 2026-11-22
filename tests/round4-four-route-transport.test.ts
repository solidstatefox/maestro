import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
const operations = ["auth", "graph-seed", "ontology", "otc", "otc-chat", "otc-import", "personal-facet-providers", "perspectives", "policies", "query-favorites", "record-status", "services"];

test("Only three HTTP proxy transports remain: telemetry and observations are OpenAPI operations", () => {
  const routes = readdirSync("src/app/proxy/api", { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(`src/app/proxy/api/${entry.name}/route.ts`)).map(entry => entry.name).sort();
  assert.deepEqual(routes, ["fct", "service", "sparql"]);
});

test("Service exposes only registered OpenAPI operations; Chat SSE remains bounded", () => {
  const source = readFileSync("src/app/proxy/api/service/route.ts", "utf8");
  const registry = readFileSync("src/lib/openapi-registry.ts", "utf8");
  assert.match(source, /resolveOpenApiOperation\(/);
  assert.match(source, /if \(!operation\)/);
  assert.match(source, /origin !== new URL\(request\.url\)\.origin/);
  assert.match(source, /new TransformStream<Uint8Array, Uint8Array>/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /maxDuration = 300/);
  assert.match(source, /Maestro application operations now execute in the browser/);
  assert.match(registry, /iteracompute/);
  assert.match(registry, /createChatCompletion/);
  assert.ok(!existsSync("src/app/proxy/api/service/operations.ts"));
  assert.ok(!existsSync("src/app/proxy/api/service/handlers"));
});
