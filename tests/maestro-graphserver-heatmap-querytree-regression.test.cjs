const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = p => fs.readFileSync(path.join(root,p),'utf8');

test('Graph status observations are private graph RDF and use existing SPARQL transport', () => {
  const store = source('src/lib/client-graph-server-status-history.ts');
  const constants = source('src/lib/graph-context.ts');
  assert.match(constants, /GRAPH_SERVER_STATUS_GRAPH_SUFFIX = "\/graph\/server-status"/);
  assert.match(store, /updatePersonal\(`INSERT DATA \{ GRAPH/);
  assert.match(store, /selectPersonal\(`SELECT \?at \?state \?code/);
  assert.match(store, /GRAPH_SERVER_STATUS_ENDPOINT/);
  assert.doesNotMatch(store, /\/(?:proxy|api)\/api\/(?:status|graph-server-history)/);
});
test('Status history reports unsampled dates as no data and keeps per-account scope', () => {
  const store = source('src/lib/client-graph-server-status-history.ts');
  assert.match(store, /graphServerStatusGraph\(ctx\.base\)/);
  assert.match(store, /const prior = days\.get\(date\)/);
  assert.match(store, /throw new Error\("Graph-server status history exceeds/);
});
test('History and Bookmarks use the three requested shadcn heatmaps and real counts', () => {
  const heatmap = source('src/canvas/tab/view/perspective-calendar-heatmap.tsx');
  for(const id of ['CalendarHeatmap','WeekdayHeatmap','DateHeatmap']) assert.match(heatmap, new RegExp(`<${id} `));
  assert.match(heatmap, /rows\.map\(row => dateAndHour\(row\.created\)\)/);
  assert.match(heatmap, /const queryDate = useMemo\(\(\) => dateFromFctRange\(queryXml\), \[queryXml\]\)/);
  assert.match(heatmap, /useState\(queryDate \?\? latest\)/);
  assert.match(heatmap, /onCellClick=\{\(\) => filterDay\(cell\.date\)\}/);
});
test('Graph Server card selection is separate from execution-server selection', () => {
  const page = source('src/canvas/tab/view/page.tsx');
  const manager = source('src/canvas/tab/view/graph-server-manager.tsx');
  assert.match(page,/const toggleGraphCard/);
  assert.match(manager,/onSelectCard\?\.\(entry\.url\)/);
  assert.match(manager,/Selected: \{state\}/);
  assert.match(manager,/<GraphServerStatusHistory/);
});
test('Query Tree uses one native button group and editor labels preserve FCT operators', () => {
  const workspace = source('src/canvas/utils/workspace-controller.tsx');
  assert.match(workspace, /<ButtonGroup className="ml-auto shrink-0 self-start"/);
  for(const label of ['from','fromValue','constant']) assert.match(workspace,new RegExp(`>${label}<\\/option>`));
  assert.match(workspace,/Select value=\{editor\.op\}/);
  assert.match(workspace,/op:editor\.op/);
});
