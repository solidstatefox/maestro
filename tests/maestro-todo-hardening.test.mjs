import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('History visits use the existing Bookmark recalls schema and do not backfill legacy visits',()=>{
  const favorites=read('src/lib/client-query-favorites.ts');
  const history=read('src/lib/history-query-rdf.ts');
  assert.match(favorites,/historyQueryRdf\(id, queryXml\)/);
  assert.match(history,/BOOKMARK\}recalls/);
  assert.doesNotMatch(history,/vfct:queryRdf|backfill|migrateLegacy/);
});
test('Query and population targeting coexist in contextual SHACL discovery',()=>{
  const shacl=read('src/lib/client-query-shacl.ts');
  assert.match(shacl,/sh:targetClass vfct:query/);
  assert.match(shacl,/sh:targetSubjectsOf/);
  assert.match(shacl,/sh:targetObjectsOf/);
  const consumers=read('src/lib/personal-sparql-reads.ts');
  assert.match(consumers,/queryProviders/);
  assert.match(consumers,/classConstraint/);
});
test('one common validation notice used for Record, query context and Spider',()=>{
  assert.ok(existsSync(new URL('../src/components/ui/validation-notice.tsx',import.meta.url)));
  for(const filename of ['src/canvas/center/pane.tsx','src/canvas/right/pane.tsx','src/canvas/tab/analyze/spider.tsx'])
    assert.match(read(filename),/import \{[^}]*ValidationNotice[^}]*\} from "@\/components\/ui\/validation-notice"/);
  assert.match(read('src/lib/client-spider-shacl.ts'),/SHACLValidator/);
  assert.match(read('src/lib/client-spider-shacl.ts'),/numeric-query-validator/);
  // The shared RDF bnode allocator accepts only alphanumeric/underscore prefixes.
  for (const path of ['src/lib/client-spider-shacl.ts', 'src/lib/client-query-shacl.ts']) {
    assert.doesNotMatch(read(path),/createBlankNodeLabelAllocator\("[^"]*-[^"]*"\)/);
  }
});
test('Kind discovery and Analyze discovery have XState request actors',()=>{
  const configure=read('src/canvas/left/configure-pane.tsx');
  assert.match(configure,/selectKinds\(kindSnapshot, kindKey\)/);
  assert.match(configure,/kindState\.ready && !checkingKinds && <select/);
  assert.match(configure,/setKindRetry\(value => value \+ 1\)/);
  assert.match(read('src/lib/app-lifecycle/analyze-discovery.ts'),/fromPromise/);
  assert.match(read('src/canvas/utils/workspace-controller.tsx'),/analyzeDiscoveryController\.discover/);
});
test('URI autocomplete uses high priority bounded proxy transport and invoked cancellation',()=>{
  assert.match(read('src/lib/graph-server-query-scheduler.ts'),/autocomplete: -1/);
  assert.match(read('src/app/proxy/api/sparql/route.ts'),/autocomplete \? Math\.min\(120000/);
  assert.match(read('src/canvas/top/root-uri-autocomplete.tsx'),/createUriAutocompleteController/);
  assert.match(read('src/lib/app-lifecycle/uri-autocomplete.ts'),/fromPromise/);
  assert.match(read('src/lib/uri-autocomplete-query.ts'),/bif:contains/);
  assert.match(read('src/canvas/top/root-uri-autocomplete.tsx'),/requestClass:"autocomplete"/);
});
test('IteraCompute has no server environment key fallback',()=>{
  for(const filename of ['src/lib/otc-runtime.ts','src/lib/openapi-registry.ts','src/app/proxy/api/service/route.ts'])
    assert.doesNotMatch(read(filename),/ITERACOMPUTE_API_KEY|secretEnv/);
  assert.match(read('src/lib/openapi-registry.ts'),/createChatCompletion/);
});
