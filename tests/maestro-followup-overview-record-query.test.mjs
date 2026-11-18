import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../src/', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
test('radial labels use shadcn LabelList geometry and one true 360-degree sweep', () => {
  const s=read('canvas/tab/view/overview.tsx');
  assert.match(s, /<RadialBar dataKey="percentage"/);
  assert.match(s, /<LabelList position="insideStart" dataKey="predicate"/);
  assert.match(s, /startAngle=\{-90\} endAngle=\{270\} innerRadius=\{30\} outerRadius=\{110\}/);
});
test('Overview is first Analyze ribbon button and not in View ribbon', () => {
  const s=read('canvas/tab/analyze/ribbon.tsx');
  assert.ok(s.indexOf('>Overview') < s.indexOf('analysisDefinitions.filter'));
  assert.match(read('canvas/tab/analyze/page.tsx'),/overviewSelected\) return <OverviewPerspective/);
  assert.doesNotMatch(read('canvas/tab/view/ribbon.tsx'),/>Overview/);
});
test('Configure edits apply immediately to authoritative FCT, no staged writes', () => {
  const s=read('canvas/utils/workspace-controller.tsx');
  assert.doesNotMatch(s,/queueConfigureFacet\(/);
  assert.match(s,/function handlePropertyCheckboxChange/);
  assert.match(s,/if \(checked\) \{\s+addProperty\(/);
  assert.match(s,/setRoleFilter\(uri, checked\)/);
});
test('Query Tree displays root classes and accepts generated text-node IDs', () => {
  const s=read('canvas/tab/browse/page.tsx');
  assert.doesNotMatch(s,/>Query root</);
  assert.match(s,/id: "query-everything"/);
  assert.match(s,/\.filter\(\(node\) => node.name !== "class"\)/);
  assert.match(read('canvas/utils/workspace-controller.tsx'),/rootClassCarrierId = queryTree.children.find\(\(node\) => node.name === "text"\)/);
});
test('Virtual shared values go through standard Record row pipeline and renderer', () => {
  const ctrl=read('canvas/utils/workspace-controller.tsx'), pane=read('canvas/right/pane.tsx');
  assert.match(ctrl,/const common = await readOverviewCommonProperties\(queryXml, controller.signal\)/);
  assert.match(ctrl,/setDescribedRecord\(sharedRows\)/);
  assert.doesNotMatch(pane,/VirtualCommonRecord/);
  assert.match(pane,/visibleProperties\.map\(/);
});
