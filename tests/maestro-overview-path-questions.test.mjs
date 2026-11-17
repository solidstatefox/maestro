import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidFctNodeId } from '../src/lib/fct-node-identity.ts';
import { isAbsoluteFacetIri, resolveFacetIri } from '../src/lib/fct-facet-iri.ts';
const read=(name)=>readFileSync(new URL('../'+name, import.meta.url),'utf8');
test('FCT base36 IDs must begin with an alphabetic digit',()=>{
  assert.ok(isValidFctNodeId('a0'));
  assert.ok(isValidFctNodeId('zz'));
  for (const invalid of ['10','1a','9z','100','#invalid'])
    assert.equal(isValidFctNodeId(invalid), false);
  assert.match(read('src/lib/maestro-ui-component-ids.ts'), /!isValidFctNodeId\(xmlNodeId\)/);
});
test('relative category IRIs are rejected, never resolved against application URL',()=>{
  assert.equal(isAbsoluteFacetIri('#OscarNominee'),false);
  assert.equal(resolveFacetIri('#OscarNominee'),null);
  assert.equal(resolveFacetIri('#OscarNominee','https://example.org/vocab'), 'https://example.org/vocab#OscarNominee');
  assert.equal(resolveFacetIri('https://example.org/vocab#OscarNominee'),'https://example.org/vocab#OscarNominee');
  assert.match(read('src/canvas/utils/fct-response.ts'),/invalidClassCount/);
});
test('shared two-hop motif creates semantic FCT class/property/role filters rather than bare two-resource list',()=>{
  const path=read('src/lib/overview-path-query.ts');
  assert.match(path,/bothForward && predicate===RDF_TYPE/);
  assert.match(path,/name:"class"/);
  assert.match(path,/name:bothForward\?"property":"property-of"/);
  assert.match(path,/name:"value",attributes:\{datatype:"uri"\}/);
  assert.match(path,/ensureFctQueryIds\(raw\)/);
  assert.match(read('src/canvas/tab/view/overview-connection-finder.tsx'),/onSelectNodes/);
});
test('node analytics lives in Analyze with XState lifecycles unchanged',()=>{
  const ribbon=read('src/canvas/tab/analyze/ribbon.tsx');
  const page=read('src/canvas/tab/analyze/page.tsx');
  const overview=read('src/canvas/tab/view/overview.tsx');
  assert.match(ribbon,/Node Analytics/);
  assert.match(page,/<OverviewNodeAnalytics/);
  assert.doesNotMatch(overview,/<OverviewNodeAnalytics/);
  assert.match(read('src/canvas/tab/view/overview-node-analytics.tsx'),/createOverviewAnalyticsCapabilityController/);
});
test('label charts are sorted high-to-low inside-out, one card, and use shadcn LabelList',()=>{
  const overview=read('src/canvas/tab/view/overview.tsx');
  assert.match(overview,/\.sort\(\(a,b\)=>b\.percentage-a\.percentage/);
  assert.match(overview,/<LabelList position="insideStart"/);
  assert.match(overview,/<Section title="Name and label evidence"/);
  assert.equal((overview.match(/<LabeledRings items=/g)||[]).length,2);
});
