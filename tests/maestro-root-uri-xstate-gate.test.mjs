import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRootUri, isRootUriOrPrefix, MAX_ROOT_URI_CHARS } from '../src/lib/root-uri-policy.ts';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url),'utf8');

test('only complete safe absolute URI text can pass the fixed-subject gate', () => {
  for (const invalid of ['Ford','Ford Motor','https://','http','www.example.com','/relative','http://example.org/a b','javascript:alert(1)','data:text/plain,hi','https://guest:password@example.org/','x'.repeat(MAX_ROOT_URI_CHARS+1)]) {
    assert.equal(parseRootUri(invalid),null,invalid);
  }
  for (const valid of ['https://example.org/Ford','http://dbpedia.org/resource/Ford_Motor_Company','urn:maestro:topic:Ford']) {
    assert.equal(parseRootUri(valid),valid,valid);
  }
  assert.equal(MAX_ROOT_URI_CHARS,2048);
});

test('complete or partial URLs are not autocomplete terms, ordinary text is',()=>{
  for (const draft of ['http:','https:/','https://','https://example.org','ftp://somehost','www.','www.example.org','urn:thing'])
    assert.equal(isRootUriOrPrefix(draft),true,draft);
  for (const draft of ['F','f','ht','htt','http','https','Ford','Ford Motor Company','BMW'])
    assert.equal(isRootUriOrPrefix(draft),false,draft);
});

test('XState commit gate owns the FCT URI writer without falling back to text',()=>{
  const machine=read('src/lib/app-lifecycle/root-uri-gate.ts');
  const workspace=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(machine,/createMachine\(/);
  assert.match(machine,/COMMIT:[\s\S]*parseRootUri\(event\.value\)/);
  assert.match(machine,/target: "\.rejected"/);
  assert.match(workspace,/const decision = rootUriGate\.commit\(value\)/);
  assert.match(workspace,/if \(decision\.kind === "rejected"\) return;/);
  assert.match(workspace,/decision\.kind === "accepted" \? \[\{ text: decision\.uri, datatype: "uri" \}\] : \[\]/);
  assert.match(workspace,/const decision = rootUriGate\.commit\(restoredUri\)/);
  assert.match(workspace,/setSearch\(value\);/); // ordinary text signals unchanged
});

test('Base Combobox commits selected URI, disables autocomplete for URL-shaped drafts, and indicates XState',()=>{
  const component=read('src/canvas/top/root-uri-autocomplete.tsx');
  const query=read('src/lib/uri-autocomplete-query.ts');
  assert.match(component,/const key = !suspended && !urlDraft/);
  assert.match(component,/onDraft\(selected\.uri\);onCommit\(selected\.uri, selected\.label\)/);
  assert.match(component,/showTrigger=\{false\}/);
  assert.match(component,/data-xstate-gate=\{gateState\}/);
  assert.doesNotMatch(component, />XState<\/span>/);
  assert.match(read('src/canvas/top/root-autocomplete-query-inspector.tsx'), /text-green-600 dark:text-green-400/);
  assert.match(component,/maxLength=\{MAX_ROOT_URI_CHARS\}/);
  assert.match(query,/isRootUriOrPrefix\(text\)/);
  assert.doesNotMatch(query,/const uriPrefix =/);
  assert.match(query,/SELECT \?uri \?label \?type/);
});

test('Clipboard obeys both 10s freshness and URL length without truncating',()=>{
  const clip=read('src/lib/recent-clipboard.ts');
  assert.match(clip,/MAX_AGE_MS=10_000/);
  assert.match(clip,/text\.length > MAX_ROOT_URI_CHARS/);
  assert.doesNotMatch(clip,/text\.slice\(/);
  const workspace=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(workspace,/selectedSignalModeRef\.current === modeAtClick/);
});

test('the three proxy transports remain explicit; breadcrumb preview update guard included',()=>{
  const wc=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(wc,/reconcileBreadcrumbSummaries/);
  assert.match(wc,/reconcileBreadcrumbPendingIds/);
  // Query traffic is still on FCT/SPARQL; observations and events moved to OpenAPI /service.
  for(const route of ['service','fct','sparql'])
    assert.match(read(`src/app/proxy/api/${route}/route.ts`),/export/);
  const service=read('src/app/proxy/api/service/route.ts');
  assert.match(service,/recordUriObservations/);
  assert.match(service,/subscribeQueryEvents/);
});
