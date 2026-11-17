import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
const operations = ["auth", "graph-seed", "ontology", "otc", "otc-chat", "otc-import", "personal-facet-providers", "perspectives", "policies", "query-favorites", "record-status", "services"];

test("Only the four approved Maestro HTTP proxy transports remain after cleanup", () => {
  const routes = readdirSync("src/app/proxy/api", { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(`src/app/proxy/api/${entry.name}/route.ts`)).map(entry => entry.name).sort();
  assert.deepEqual(routes, ["fct", "observations", "service", "sparql"]);
});

test("The remaining trusted service operations are allowlisted; OTC streaming is preserved", () => {
  const source = readFileSync("src/app/proxy/api/service/operations.ts", "utf8");
  for (const operation of operations) {
    assert.ok(source.includes(`'${operation}': {`));
    assert.ok(existsSync(`src/app/proxy/api/service/handlers/${operation}.ts`));
  }
  assert.match(source, /dispatchMaestroService/);
  assert.doesNotMatch(source, /'appbar-buttons':\s*\{/);
  assert.match(readFileSync("src/lib/client-appbar-buttons.ts", "utf8"), /manageAppbarButtons/);
  assert.match(readFileSync("src/lib/client-otc-discovery.ts", "utf8"), /clientListChatSurveys/);
  assert.match(source, /origin !== url.origin/);
  const chat = readFileSync("src/components/ai-elements/basic-chat.tsx", "utf8");
  assert.match(chat, /xhr\.open\("POST", "\/proxy\/api\/service\?service=maestro&operationId=otc-chat"\)/);
  assert.match(chat, /xhr\.send\(form\)/);
  assert.match(readFileSync("src/app/proxy/api/service/route.ts", "utf8"), /maxDuration = 300/);
});
