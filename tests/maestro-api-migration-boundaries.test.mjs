import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(resolve(root,name), 'utf8');
test('API route surface is limited to four reviewed transports', () => {
  const scan = (dir) => readdirSync(resolve(root,dir),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?scan(`${dir}/${entry.name}`):entry.name==='route.ts'?[`${dir}/${entry.name}`]:[]);
  assert.deepEqual(scan('src/app').sort(), ['src/app/proxy/api/fct/route.ts','src/app/proxy/api/observations/route.ts','src/app/proxy/api/service/route.ts','src/app/proxy/api/sparql/route.ts'].sort());
});
test('Service transport resolves only registered OpenAPI operation IDs', () => {
  const route=read('src/app/proxy/api/service/route.ts');
  const registry=read('src/lib/openapi-registry.ts');
  assert.match(route,/resolveOpenApiOperation/);
  assert.match(route,/Unknown OpenAPI operation/);
  assert.match(route,/Cross-origin service operation is not allowed/);
  assert.doesNotMatch(route,/dispatchMaestroService/);
  assert.match(registry,/openapi:"3\.1\.0"/);
  for (const name of ['iteracompute','commons','rank','prefixcc','zazuko','openlibrary'])
    assert.match(registry,new RegExp(`\\b${name}\\s*:`));
  assert.doesNotMatch(registry,/auth:\s*\{|graph-seed:\s*\{|record-status:\s*\{/);
});
test('Archived root query tree appears as the live Everything/text/value stack', () => {
  const page=read('src/canvas/tab/browse/page.tsx'), controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.doesNotMatch(page,/>Query root<|<strong className="font-semibold">Query root<\/strong>/);
  assert.match(page,/renderQueryNode\(\{[\s\S]*?id: "query-everything"/);
  assert.match(page,/\.filter\(\(node\) => node\.name !== "class"\)/);
  assert.match(controller,/const rootClassesOnThisNode = node\.id === rootClassCarrierId \? rootClassNodes/);
  assert.match(controller,/if \(isRootCarrierRow\) \{[\s\S]*?else if \(topInlineClass\) deleteNode\(topInlineClass\.id\)/);
});
test('IteraCompute key stays in IndexedDB, not URL, FCT query or server registry', () => {
  const client=read('src/lib/iteracompute-credential.ts');
  const sheet=read('src/canvas/sheet/settings-pane.tsx');
  const transport=read('src/app/proxy/api/service/route.ts');
  const survey=read('src/lib/otc-runtime.ts');
  assert.match(client,/maestroStorageSet\(ITERACOMPUTE_KEY_STORAGE, key\)/);
  assert.doesNotMatch(client,/(?:localStorage|window\.location|URLSearchParams)/);
  assert.match(sheet,/htmlFor="maestro-iteracompute-key"/);
  assert.match(transport,/const secret = suppliedKey/);
  assert.doesNotMatch(transport,/process\.env\.ITERACOMPUTE_API_KEY|operation\.secretEnv/);
  assert.match(survey,/request\.headers\.get\("x-maestro-iteracompute-key"\)/);
});
