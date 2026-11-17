import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL('../src/canvas/tab/view/overview.tsx',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../src/canvas/utils/workspace-controller.tsx',import.meta.url),'utf8');
const population=readFileSync(new URL('../src/lib/overview-population.ts',import.meta.url),'utf8');
const analytics=readFileSync(new URL('../src/canvas/tab/view/overview-node-analytics.tsx',import.meta.url),'utf8');
const connections=readFileSync(new URL('../src/canvas/tab/view/overview-connection-finder.tsx',import.meta.url),'utf8');

test('only the two name-related metrics use no-legend labeled radials; other layouts are restored',()=>{
  assert.equal((ui.match(/<LabeledRings\s/g)||[]).length,2);
  assert.match(ui,/<RadialBar dataKey="percentage"/);
  assert.match(ui,/<LabelList position="insideStart" dataKey="predicate"/);
  assert.match(ui,/max-h-\[250px\]/);
  assert.doesNotMatch(ui,/x=\{mark\.x\}|y=\{mark\.y\}/);
  assert.doesNotMatch(ui.slice(ui.indexOf('function LabeledRings'),ui.indexOf('function RankedPercent')),/className="min-w-0 space-y-2\.5"/);
  assert.match(ui,/<RankedPercent items=\{classRatios\}/);
  assert.match(ui,/<RankedPercent items=\{data\.propertyShares\}/);
  assert.match(ui,/<RankedPercent items=\{data\.roleShares\}/);
  assert.match(ui,/<ShareDonut items=\{data\.graphShares\}/);
});
test('dropdown naming vocabulary, not selected text predicates, supplies all ring rows',()=>{
  assert.match(workspace,/overviewNameProperties:\s*TEXT_SEARCH_NAME_PROPERTIES,/);
  assert.doesNotMatch(workspace,/overviewNameProperties:\s*TEXT_SEARCH_NAME_PROPERTIES\.filter/);
  assert.match(population,/Zero-coverage predicates still get labeled tracks/);
  assert.doesNotMatch(population,/\.slice\(0,12\)/);
  assert.match(ui,/labelCoverage\.some\(item=>item\.percentage>0\)/);
});
test('actual edge-path analytics is the first mode, with XState-owned cancellation',()=>{
  assert.match(analytics,/useState<"connections" \| "metrics">\("connections"\)/);
  assert.match(analytics,/<OverviewConnectionFinder/);
  assert.match(analytics,/createOverviewAnalyticsCapabilityController/);
  assert.match(connections,/createOverviewConnectionsController/);
  assert.match(connections,/controller\.stop\(\)/);
  assert.match(ui,/<Section title="Roles mix"/);
});
