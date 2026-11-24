const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = relativePath => readFileSync(join(__dirname, '..', relativePath), 'utf8');

test('optional datatype-probe warnings use Maestro function logger API', () => {

  const lanes = require('node:fs').readFileSync("src/lib/app-lifecycle/facet-requests.ts", 'utf8');
  assert.ok(lanes.includes('FACET_STARTED'));
  assert.ok(lanes.includes('FACET_SETTLED'));
  assert.ok(lanes.includes('FACET_CANCELLED'));
  assert.ok(lanes.includes('settleCategoriesError'));
  assert.ok(lanes.includes('settlePropertiesError'));
  assert.ok(lanes.includes('failed: {}'));
 
      const route = require('node:fs').readFileSync("src/app/proxy/api/fct/route.ts", 'utf8');
      assert.ok(route.includes('proxyLog("error", "fct.POST.failed"'));
      assert.ok(route.includes('Facet datatype evidence probe failed'));
    
  });

test('Personal facets use query-derived removal but preserve presentation-only paging', () => {
  const cards = source('src/canvas/left/personal-widget-cards.tsx');
  const interfaces = source('src/canvas/controllers/workspace-interfaces.ts');
  assert.match(interfaces, /\| "setPersonalWidgets"/);
  assert.equal((cards.match(/workspace\.setPersonalWidgets\(\(current\) =>/g) ?? []).length, 2,
    'Previous and Next update the widget page, not widget existence');
  assert.doesNotMatch(cards, /(?<!\.)\bsetPersonalWidgets\s*\(/);
  const removal = cards.slice(cards.indexOf('{ id: "remove", label:'), cards.indexOf('                  ]}/>', cards.indexOf('{ id: "remove", label:')));
  assert.ok(removal.includes('guardedDeleteQueryNode(nodeId)'));
  assert.doesNotMatch(removal, /setPersonalWidgets|removeProperty\(|findPropertyPathNode\(/);
});
