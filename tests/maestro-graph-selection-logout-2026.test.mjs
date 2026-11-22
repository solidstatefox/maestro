import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

// Runtime behavior tests use XState directly: no mocked auth session, and the
// endpoint IDs deliberately change when the registry is refreshed.
test('public graph server survives logout when the anonymous registry assigns a new ID', async () => {
  const { createGraphServerSelectionController } = await import('../src/lib/app-lifecycle/graph-server-selection-actor.ts');
  const controller = createGraphServerSelectionController();
  controller.start();
  controller.restorePreference('https://demo.openlinksw.com/sparql');
  controller.updateRegistry([{ id:'logged-in-demo', url:'https://demo.openlinksw.com/sparql', label:'Demo', group:'Servers' }]);
  controller.observeQuery('https://demo.openlinksw.com/sparql');
  assert.equal(controller.getSnapshot().selectedId, 'logged-in-demo');
  controller.updateRegistry([{ id:'anonymous-demo', url:'https://demo.openlinksw.com/sparql', label:'Demo', group:'Servers' }]);
  assert.equal(controller.getSnapshot().selectedId, 'anonymous-demo');
  assert.equal(controller.getSnapshot().queryUrl, 'https://demo.openlinksw.com/sparql');
  controller.stop();
  controller.start();
  assert.equal(controller.getSnapshot().selectedId, 'anonymous-demo');
  controller.stop();
});

test('unknown explicit server is not silently replaced by another server', async () => {
  const { createGraphServerSelectionController } = await import('../src/lib/app-lifecycle/graph-server-selection-actor.ts');
  const controller = createGraphServerSelectionController();
  controller.start();
  controller.restorePreference('https://demo.openlinksw.com/sparql');
  controller.updateRegistry([{ id:'demo', url:'https://demo.openlinksw.com/sparql', label:'Demo', group:'Servers' }]);
  controller.observeQuery('https://private.example.invalid/sparql');
  assert.equal(controller.getSnapshot().selectedId, `shared:${encodeURIComponent('https://private.example.invalid/sparql')}`);
  assert.equal(controller.getSnapshot().queryUrl, 'https://private.example.invalid/sparql');
  controller.stop();
});

test('server fallback waits for browser preference hydration, independently of login', async () => {
  const { createGraphServerSelectionController } = await import('../src/lib/app-lifecycle/graph-server-selection-actor.ts');
  const controller = createGraphServerSelectionController();
  controller.start();
  controller.updateRegistry([
    { id:'a', url:'https://a.example/sparql', label:'A', group:'Servers' },
    { id:'b', url:'https://b.example/sparql', label:'B', group:'Servers' },
  ]);
  assert.equal(controller.getSnapshot().selectedId, '');
  controller.restorePreference('https://b.example/sparql');
  assert.equal(controller.getSnapshot().selectedId, 'b');
  controller.observeQuery('');
  assert.equal(controller.getSnapshot().selectedId, 'b');
  controller.choose('a');
  assert.equal(controller.getSnapshot().queryUrl, 'https://a.example/sparql');
  assert.equal(controller.getSnapshot().preferredUrl, 'https://a.example/sparql');
  controller.stop();
});

test('a saved URL remains in Shared when courtesy membership changes', async () => {
  const { createGraphServerSelectionController } = await import('../src/lib/app-lifecycle/graph-server-selection-actor.ts');
  const controller = createGraphServerSelectionController();
  controller.start();
  controller.restorePreference('https://obsolete.example/sparql');
  controller.updateRegistry([{ id:'public', url:'https://public.example/sparql', label:'Public', group:'Servers' }]);
  assert.equal(controller.getSnapshot().selectedId, `shared:${encodeURIComponent('https://obsolete.example/sparql')}`);
  controller.observeQuery('https://obsolete.example/sparql');
  assert.equal(controller.getSnapshot().selectedId, `shared:${encodeURIComponent('https://obsolete.example/sparql')}`);
  controller.stop();
});

test('health, login, public query and loading placeholders remain separate', () => {
  const selection = read('src/lib/app-lifecycle/graph-server-selection-actor.ts');
  const graph = read('src/canvas/controllers/graph-servers.ts');
  const controller = read('src/canvas/utils/workspace-controller.tsx');
  const workspace = read('src/canvas/workspace.tsx');
  assert.match(graph, /createGraphServerSelectionController/);
  assert.match(graph, /createGraphServerHealthController/);
  assert.doesNotMatch(selection, /authSession|healthController|endpointStatuses/);
  assert.match(controller, /maestro-last-graph-server-url/);
  assert.match(controller, /const graphRegistryReady = Boolean\(/);
  assert.match(controller, /observeGraphServerQuery\(authoritativeServerUrl\)/);
  assert.doesNotMatch(controller, /graphRegistryLoadedRevision/);
  assert.match(controller, /fctEndpoints.find\(\(endpoint\) => queryGraphServer &&/);
  assert.match(controller, /\[queryCountXml, queryGraphServer, queryRefreshRevision\]/);
  assert.match(controller, /operationId:"courtesyGraphServers"/);
  assert.doesNotMatch(workspace, /<AppbarLoadingSkeleton\s*\/>|<RibbonLoadingSkeleton\s*\/>|<RecordLoadingSkeleton\s*\/>/);
  assert.match(workspace, /<FacetsLoadingSkeleton/);
  assert.match(workspace, /<ResultsLoadingSkeleton/);
  assert.match(workspace, /<RightCanvasPanel workspace=\{workspace\}/);
});
