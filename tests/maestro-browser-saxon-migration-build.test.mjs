import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test('workspace controller begins with the Next.js client directive', () => {
  const code = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(code, /^"use client";\s*\n/);
  assert.match(code, /import \{ invokeClientRecordService \} from "@\/lib\/client-record-service-invocation";/);
});

test('Record service XSLT uses browser SaxonJS only, with asynchronous evaluation', () => {
  const service = read('src/lib/maestro-service-xslt.ts');
  const browser = read('src/lib/maestro-browser-xslt.ts');
  const caller = read('src/lib/client-record-service-invocation.ts');
  assert.doesNotMatch(service, /\b(?:from\s+["']saxon-js["']|require\(["']saxon-js["']\))/);
  assert.match(service, /import \{ saxonJsonToXml, transformWithMaestroSaxon \} from "@\/lib\/maestro-browser-xslt"/);
  assert.match(service, /export async function executeServiceXslt\(/);
  assert.match(service, /await transformWithMaestroSaxon\(/);
  assert.match(service, /export async function serviceJsonToXml\(/);
  assert.match(service, /await saxonJsonToXml\(/);
  assert.match(browser, /export async function saxonJsonToXml\(/);
  assert.match(browser, /const saxon = await getSaxon\(\)/);
  assert.match(browser, /serialize\(json-to-xml\(\$json\)/);
  assert.match(caller, /const requestXml\s*=\s*await executeServiceXslt\(/);
  assert.match(caller, /const responseXml\s*=\s*await serviceJsonToXml\(raw\)/);
  assert.match(caller, /const transformed\s*=\s*await executeServiceXslt\(/);
});

test('query transport remains native while telemetry and observations are registered OpenAPI operations', () => {
  for (const name of ['service', 'fct', 'sparql']) {
    assert.match(read(`src/app/proxy/api/${name}/route.ts`), /export (?:async )?function (?:GET|POST|PUT|PATCH|DELETE)|export const (?:GET|POST|PUT|PATCH|DELETE)/);
  }
  const service = read('src/app/proxy/api/service/route.ts');
  assert.match(service, /subscribeQueryEvents/);
  assert.match(service, /recordUriObservations/);
  assert.match(read('src/lib/openapi-registry.ts'), /courtesyGraphServers/);
  assert.doesNotMatch(read('src/lib/client-query-events.ts'), /\/proxy\/api\/events\?id=/);
});
