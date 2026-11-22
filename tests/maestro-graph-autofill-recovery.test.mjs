import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphAutoFillAllowsQuery } from '../src/lib/app-lifecycle/graph-autofill.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root,file),'utf8');
const base = {
  enabled: true, graphSelected: false, graphFieldEditing: false,
  queryIdentity: 'query@server:1', probeIdentity: 'query@server:1', probeState: 'running',
};
const allows = (overrides) => graphAutoFillAllowsQuery({ ...base, ...overrides });

test('pending optional graph selection cannot gate the live query', () => {
  assert.equal(allows({}), true);
  assert.equal(allows({ probeState: 'empty' }), true);
  assert.equal(allows({ probeState: 'no-graph' }), true);
});

test('timeout or unsupported graph enumeration never blocks a healthy live query', () => {
  assert.equal(allows({ probeState: 'error' }), true);
  assert.equal(allows({ enabled: false }), true);
  assert.equal(allows({ graphSelected: true }), true);
  assert.equal(allows({ graphFieldEditing: true }), true);
});

test('a stale optional graph probe cannot gate an otherwise valid live query', () => {
  assert.equal(allows({ probeIdentity: 'previous-query', probeState: 'error' }), true);
  assert.equal(allows({ probeIdentity: 'previous-query', probeState: 'no-graph' }), true);
  assert.equal(allows({ probeIdentity: 'query@server:1', probeState: 'error' }), true);
});

test('unbound graph discovery skips GRAPH enumeration while bounded matching FCT scopes retain auto-fill', () => {
  const route = read('src/app/proxy/api/fct/route.ts');
  const compiler = read('src/lib/fct-sparql-translator.ts');
  assert.match(route,/if \(!rankedDiscovery\.graphDiscoveryHasSourcePattern\)/);
  assert.match(route,/selection: "unscoped"/);
  assert.match(route,/if \(addressGraph === ALL_GRAPHS\)/);
  assert.match(compiler,/graphDiscoveryHasSourcePattern = hasSourcePattern\(discoveryWhere\)/);
  assert.match(compiler,/pattern\.kind === "triple"/);
  assert.match(compiler,/pattern\.kind === "full-text"/);
  assert.match(route,/tryDiscovery\("ranked"\)/);
  assert.match(route,/tryDiscovery\("first-match"\)/);
});

test('auto-fill errors remain a toast, not a two-pane fatal error', () => {
  const workspace = read('src/canvas/workspace.tsx');
  const appbar = read('src/canvas/top/appbar-pane.tsx');
  assert.doesNotMatch(workspace,/Graph auto-fill unavailable/);
  assert.doesNotMatch(workspace,/graphDiscoveryFailed/);
  assert.match(appbar,/Browsing continues using the server's default dataset/);
  assert.match(appbar,/lastGraphProbeToastRef/);
});

test('graph auto-fill reuse follows the existing paging-independent FCT identity', () => {
  const controller = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(controller, /graphProbeIdentity = `\$\{bookmarkQueryKey\}\\u0000\$\{queryGraphServer \?\? ""\}\\u0000\$\{queryRefreshRevision\}`/);
  assert.match(controller, /The query XML is captured when the canonical identity changes/);
  assert.doesNotMatch(controller, /graphAutoFill, graphProbeIdentity, queryXml\]/);
});
