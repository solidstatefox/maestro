import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const appbar = read('src/canvas/top/appbar-pane.tsx');

test('reverts three-stage ribbon and graph-server layout experiment', () => {
  assert.doesNotMatch(appbar, /selectAppbarTabMode|ribbonSlotRef|data-maestro-tab-mode/);
  assert.match(appbar, /compactRibbonTabs \? <div/);
  assert.match(appbar, /<Tabs value=\{workspaceTab\}/);
  assert.match(appbar, /Graph server selection, discovery, and refresh/);
});

test('graph address and navigation stay in the SAME row as non-shrinking tabs', () => {
  assert.match(appbar, /flex min-w-0 flex-1 flex-nowrap items-center gap-x-2/);
  // The graph input now yields available width to the tab strip, rather than
  // imposing a 38rem minimum or obscuring the tabs.
  assert.match(appbar, /ref=\{graphAddressLayoutRef\} className="relative z-20 min-w-0 flex-\[1_1_auto\]/);
  assert.doesNotMatch(appbar, /max-w-\[48rem\]/);
  assert.match(appbar, /className="ml-auto shrink-0"/);
  assert.doesNotMatch(appbar, /absolute inset-y-0 left-0 z-50/);
});

test('graph input and server label can SHRINK instead of expanding over tabs', () => {
  assert.match(appbar, /group\/graph-input flex min-w-0 flex-1 items-stretch/);
  assert.match(appbar, /min-w-0 flex-1 truncate px-3 py-2 text-left/);
  assert.match(appbar, /basis-\[30ch\] max-w-\[min\(54%,34rem\)\] shrink/);
  assert.match(appbar, /<span className="min-w-0/);
});

test('no graph-discovery error is rendered inline between navigation and graph field', () => {
  assert.doesNotMatch(appbar, /<ErrorDetails prefix="Graph discovery"/);
  assert.match(appbar, /title: timeout \? "Graph auto-fill timed out"/);
  assert.match(appbar, /toast\.add\(\{/);
  assert.match(appbar, /lastGraphProbeToastRef/);
});

test('server retains identical FCT scope with cheaper unranked matching-graph fallback', () => {
  const translator = read('src/lib/fct-sparql-translator.ts');
  const route = read('src/app/proxy/api/fct/route.ts');
  assert.match(translator, /discoverGraph === "first"/);
  assert.match(translator, /MAX"?, distinct: false/);
  assert.match(route, /tryDiscovery\("ranked"\)/);
  assert.match(route, /tryDiscovery\("first-match"\)/);
  assert.match(route, /mode === "ranked" \? 5500 : 10000/);
  assert.match(route, /GRAPH_DISCOVERY_TIMEOUT/);
  assert.doesNotMatch(route, /Graph discovery did not complete; normal queries remain blocked\.", query:/);
});

test('XState graph health and query scope readiness remain separate', () => {
  const controller = read('src/canvas/utils/workspace-controller.tsx');
  const hook = read('src/canvas/diagnostics/use-maestro-operations.ts');
  assert.match(controller, /graphReady: graphHealthReady,\s+querySourceReady: endpointReadyForQuery/);
  assert.match(hook, /QUERY_OBSERVED[^\n]*graphReady: facts\.querySourceReady/);
  assert.match(hook, /GRAPH_OBSERVED[^\n]*key: facts\.graphKey/);
});


test('an inconclusive health probe or stale health toast cannot mark a green server unavailable', () => {
  const workspace = read('src/canvas/workspace.tsx');
  assert.match(workspace, /endpointFailed: !graphHealthReady && Boolean/);
  assert.match(workspace, /selectedEndpointStatus\.state !== "probe-error"/);
  assert.match(workspace, /endpointHealthToast\.endpointId === selectedEndpointId/);
});


test('failed automatic graph discovery no longer replaces normal facets or results with error panels', () => {
  const workspace = read('src/canvas/workspace.tsx');
  const selector = read('src/lib/app-lifecycle/skeleton-boundaries.ts');
  const controller = read('src/canvas/utils/workspace-controller.tsx');
  assert.doesNotMatch(workspace, /Graph auto-fill could not resolve a matching named graph/);
  assert.doesNotMatch(workspace, /title=\{graphDiscoveryFailed/);
  assert.match(controller, /graphAutoFillAllowsQuery\(/);
  assert.match(selector, /Discovery errors are advisory/);
  assert.match(controller, /setGraphProbe\(\{ identity: graphProbeIdentity, state: "error"/);
});


test('appbar graph-server refresh also advances the real query/discovery generation', () => {
  assert.match(appbar, /onClick=\{\(\) => void refreshMaestroPage\(\)\}/);
  assert.doesNotMatch(appbar, /onClick=\{\(\) => void refreshQuery\(\)\}/);
});
