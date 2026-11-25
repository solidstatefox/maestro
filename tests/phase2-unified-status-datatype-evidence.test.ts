import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (name: string) => readFileSync(name, 'utf8');

test('Status compilation reads the universal graph with no approval-value split', () => {
  const source = read('src/lib/fct-sparql-translator.ts');
  assert.match(source, /statusScope\(/);
  assert.match(source, /parseStatusAddress\(/);
  assert.doesNotMatch(source, /policyApprovalGraph|policy-approvals/);
});

test('numeric detection uses unpaginated datatype aggregate, not sampled facet values', () => {
  const compiler = read('src/lib/fct-sparql-translator.ts');
  const discovery = read('src/lib/client-facet-providers.ts');
  const route = read('src/app/proxy/api/fct/route.ts');
  assert.match(compiler, /datatypeEvidenceQuery = buildStatusSelect/);
  assert.match(compiler, /groupBy: \[inferred, original\]/);
  assert.match(route, /compiled\.datatypeEvidenceQuery/);
  assert.match(route, /datatypeEvidence/);
  assert.doesNotMatch(discovery, /numericExamples|hasObservedNumeric|slice\(0, 20\)/);
  assert.match(discovery, /validateClientShaclRows\(/);
  assert.match(discovery, /readClientPolicyApprovals\(/);
  assert.match(discovery, /input\.datatypeEvidence/);
});

test('numeric provider matches datatype evidence through SHACL qualified values', () => {
  const rdf = read('graph/numeric/provider.ttl');
  assert.match(rdf, /sh:path mui:inferredDatatype/);
  assert.match(rdf, /sh:qualifiedValueShape \[ sh:in/);
  assert.match(rdf, /sh:qualifiedMinCount 1/);
  assert.match(read('src/lib/shacl-standard-validation.ts'), /sh:in\|/);
});

test('Bookmark animation applies to its button and both inspectors have executable SPARQL tabs', () => {
  const bookmark = read('src/canvas/top/appbar-pane.tsx');
  const appbar = bookmark.slice(bookmark.indexOf('id="maestro-bookmark-button"'));
  assert.match(appbar, /bookmarkBounce && policyBookmarkVisible && !isQueryBookmarked \? "animate-bounce/);
  assert.match(appbar, /<Bookmark aria-hidden="true"\s+className=\{`size-4 \$\{isQueryBookmarked \? "fill-current text-amber-500" : bookmarkBounce && policyBookmarkVisible \? "text-amber-500" : ""\}`\}/);
  assert.match(bookmark,/<Button\s+type="button" variant="outline" size="icon"\s+aria-pressed=\{isQueryBookmarked\}\s+id="maestro-bookmark-button"/);
  assert.match(bookmark,/aria-label="Pinned bookmark shortcuts"[\s\S]*?<Button type="button" size="icon" variant="outline"/);
  const inspector = read('src/canvas/left/filter-pane.tsx');
  assert.match(inspector, /facetQueryInspectorTabs/);
  assert.match(inspector, /list-count/);
});


test('one personal status graph is authoritative; no legacy migration or compatibility scan', () => {
  const graph = read('src/lib/personal-status-graph.ts');
  assert.doesNotMatch(graph, /migrateLegacyStatuses|legacyStatusMigrationComplete|oldApprovals|oldHide/);
  assert.match(graph, /getPersonalStatusGraph/);
  assert.match(graph, /\$\{getUserGraph\(request\)\}\/status/);
  const policy = read('src/lib/policy-approval-store.ts');
  assert.match(policy, /statusGraph\(request\)/);
});
