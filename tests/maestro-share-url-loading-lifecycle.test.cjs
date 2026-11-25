const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');
const controller = read('src/canvas/utils/workspace-controller.tsx');
const interfaces = read('src/canvas/controllers/workspace-interfaces.ts');
const appbar = read('src/canvas/top/appbar-pane.tsx');

test('current query addr remains execution authority; graph health remains observational', () => {
  assert.match(controller, /const authoritativeServerUrl = \(queryTree\.attributes\.addr \?\? ""\)/);
  assert.match(controller, /const endpointReadyForQuery = Boolean\(queryGraphServer\)/);
  assert.match(controller, /graphReady: endpointReadyForQuery,/);
  assert.doesNotMatch(controller, /graphReady: graphHealthReady,/);
});

test('new Share URL does not inherit the abandoned Results/count loading flags', () => {
  const start = controller.indexOf('function clearWidgetsForViewChange()');
  const end = controller.indexOf('/** X: stop transport/queue work', start);
  assert(start >= 0 && end > start);
  const clear = controller.slice(start, end);
  assert.match(clear, /setIsSearching\(false\)/);
  assert.match(clear, /setIsCountingResults\(false\)/);
  assert.doesNotMatch(clear, /setIsSearching\(endpointReadyForQuery\)/);
  assert.doesNotMatch(clear, /setIsCountingResults\(endpointReadyForQuery\)/);
  const barrier = controller.slice(controller.indexOf('// Query pipeline barrier:'), controller.indexOf('// Selection is enough to initiate health verification.'));
  assert.match(barrier, /setIsSearching\(false\)/);
  assert.match(barrier, /setIsCountingResults\(false\)/);
});

test('the request effects settle their own spinners on denied gate or abort', () => {
  const resultsStart = controller.indexOf('const requestQueryIdentity = ');
  const resultsEnd = controller.indexOf('}, [urlStateInitialized, resultsRequestXml,', resultsStart);
  assert(resultsStart >= 0 && resultsEnd > resultsStart);
  const results = controller.slice(resultsStart, resultsEnd);
  assert.match(results, /if \(!urlStateInitialized \|\| !endpointReady\) \{\s*\/\/[\s\S]*?setIsSearching\(false\);\s*return;/);
  assert.match(results, /setIsSearching\(true\)/);
  // Cleanup settles the spinner even before dispatch, but only the effect
  // that claimed execution may cancel the XState Results operation.
  const cleanup = results.slice(results.lastIndexOf('return () => {'));
  assert.match(cleanup, /controller\.abort\(\);[\s\S]*?setIsSearching\(false\);\s*if \(timerFired\) operations\.controller\.send\(\{ type: "RESULTS_CANCELLED", key: operationQueryKey \}\);/);
  assert.match(results, /operations\.controller\.send\(\{ type: "RESULTS_STARTED", key: operationQueryKey \}\);[\s\S]*?if \(claimed\.key !== operationQueryKey \|\| claimed\.phase !== "executing"\) return;\s*timerFired = true;/);
  assert.match(results, /finally \{\s*resultsBatchRequestPending\.current = false;\s*if \(!cancelled\) setIsSearching\(false\);/);
  const count = controller.slice(controller.indexOf('const resultsCountRequestIdentity = '), controller.indexOf('  // Hydrate from the existing Maestro IndexedDB store'));
  assert.match(count, /setIsCountingResults\(true\)/);
  assert.match(count, /countController\.discover\(countKey, async signal/);
  assert.match(count,/countSnapshot\.matches\("loading"\)[\s\S]*?setIsCountingResults\(false\)/);
});

test('appbar reads the selected-server health state through its declared Workspace contract', () => {
  const api = interfaces.slice(interfaces.indexOf('export type AppBarDirectWorkspace'), interfaces.indexOf('export type AppBarWorkspace'));
  assert.match(api, /\| "checkingEndpointIds"/);
  assert.match(appbar, /checkingEndpointIds,/);
  assert.match(appbar, /const displayedEndpointChecking = Boolean\(activeGraphServer && checkingEndpointIds\[activeGraphServer\.id\]\)/);
});

test('an unresponsive client cache cannot indefinitely hold up an FCT fetch', async () => {
  // Exercise the real cache helper body without loading its browser-only imports.
  // Use a shorter deadline only inside this isolated, deterministic unit test.
  const ts = require('typescript');
  const vm = require('node:vm');
  const source = read('src/lib/client-query-cache.ts');
  const ast = ts.createSourceFile('client-query-cache.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const helper = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'lookupCachedResponseWithDeadline');
  assert(helper, 'Cache preflight needs its own bounded lookup helper');
  assert.match(source, /await lookupCachedResponseWithDeadline\(key, init\?\.signal\)/);
  assert.match(source, /request\.onblocked\s*=/);
  assert.match(source, /CLIENT_CACHE_OPEN_TIMEOUT_MS/);
  const unit = `const CLIENT_CACHE_LOOKUP_TIMEOUT_MS = 15;\n${helper.getText(ast)}\n globalThis.lookup = lookupCachedResponseWithDeadline;`;
  const script = ts.transpileModule(unit, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const context = { setTimeout, clearTimeout, AbortController, getClientCachedResponse: async () => new Promise(() => {}) };
  vm.runInNewContext(script, context);
  const start = performance.now();
  const miss = await context.lookup('blocked');
  assert.equal(miss, null);
  assert(performance.now() - start < 300, 'cache bypass should not follow the hung promise');
  const cached = { status: 200, response: 'cached' };
  context.getClientCachedResponse = async () => cached;
  assert.equal(await context.lookup('hit'), cached);
  context.getClientCachedResponse = async () => new Promise(() => {});
  const abort = new AbortController();
  const pending = context.lookup('abort', abort.signal);
  abort.abort();
  assert.equal(await pending, null);
});
