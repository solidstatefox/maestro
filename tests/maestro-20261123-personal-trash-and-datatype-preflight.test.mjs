import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureFctQueryIds, isValidFctNodeId } from '../src/lib/fct-node-identity.ts';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Personal facet Trash resolves a normalized query node ID and lets the query store reconcile UI', () => {
  const cards = read('src/canvas/left/personal-widget-cards.tsx');
  const remove = cards.slice(cards.indexOf('{ id: "remove", label:'), cards.indexOf('                  ]}/>', cards.indexOf('{ id: "remove", label:')));
  assert.match(remove, /const nodeId = alias\?\.id \?\? boundNode\?\.id;/);
  assert.match(remove, /if \(nodeId\) guardedDeleteQueryNode\(nodeId\)/);
  assert.doesNotMatch(remove, /setPersonalWidgets|removeProperty\(|findPropertyPathNode\(/);
  const controller = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(controller, /function guardedDeleteQueryNode\(nodeId:string\):boolean/);
  assert.match(controller, /error instanceof FctNodeInUseError/);
  assert.match(controller, /setBlockedReferenceDeletion\(\{nodeId:error.nodeId,dependents:error.dependents,hrefLabels\}\)/);
  assert.match(controller, /const resolved = getTransportedQueryTreePath\(ref\.anchorId, ref\.targetId\)/);
  assert.match(controller, /blockedReferenceDeletion\?\.hrefLabels\[ref\.anchorId\]/);
  assert.match(controller, /deleteNode\(nodeId\)/);
  const store = read('src/lib/fct-query.ts');
  assert.match(store, /assertFctNodeCanBeDeleted\(tree, target.id\)/);
  assert.match(store, /const preservedView = containsView/);
});

test('datatype evidence uses a population-scoped literal preflight before any unpaginated aggregate', () => {
  const compiler = read('src/lib/fct-sparql-translator.ts');
  assert.match(compiler, /datatypeLiteralProbeQuery = buildStatusAsk\(directives, \[\.\.\.scopedValues,/);
  assert.match(compiler, /name: "isLiteral", args: \[termExpr\(target\)\]/);
  assert.match(compiler, /datatypeEvidenceQuery = buildStatusSelect\(/);
  assert.match(compiler, /groupBy: \[inferred, original\]/);
});

test('an auxiliary datatype query failure no longer changes the successful LIST response into HTTP 500', () => {

  const lanes = process.getBuiltinModule('node:fs').readFileSync("src/lib/app-lifecycle/facet-requests.ts", 'utf8');
  assert.ok(lanes.includes('FACET_STARTED'));
  assert.ok(lanes.includes('FACET_SETTLED'));
  assert.ok(lanes.includes('FACET_CANCELLED'));
  assert.ok(lanes.includes('settleCategoriesError'));
  assert.ok(lanes.includes('settlePropertiesError'));
  assert.ok(lanes.includes('failed: {}'));

      const route = process.getBuiltinModule('node:fs').readFileSync("src/app/proxy/api/fct/route.ts", 'utf8');
      assert.ok(route.includes('if (compiled.datatypeEvidenceQuery && !countOnly && !partial)'));
      assert.ok(route.includes('const evidenceAnytime'));
      assert.ok(route.includes('Facet datatype evidence probe failed'));
      assert.ok(route.includes('evidenceResult.response.status === 200'));
    
  });


test('ID-less share URL nodes are normalized before the ID-based trash handler sees them', () => {
  const normalized = ensureFctQueryIds({ name: 'query', attributes: {}, children: [
    { id: '', name: 'property', attributes: { iri: 'http://data.europa.eu/s66#hasResult' }, children: [] },
    { id: '', name: 'view', attributes: { type: 'text' }, children: [] },
  ] });
  const ids = normalized.children.map(node => node.id);
  assert.equal(new Set(ids).size, 2);
  assert.ok(ids.every(id => isValidFctNodeId(id)));
  assert.equal(normalized.children[0].attributes.rid?.length > 0, true);
});
