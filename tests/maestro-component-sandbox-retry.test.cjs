const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('retry epochs notify subscribers without editing the FCT query or URL', () => {
  const source = read('src/lib/maestro-component-retry.ts');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => {
    assert.equal(id, 'react');
    return { useCallback: fn => fn, useSyncExternalStore: () => 0 };
  }, module, module.exports);
  const {retryMaestroComponent, componentRetryEpoch, subscribeComponentRetries, componentRetryHeaders} = module.exports;
  const events = [];
  const unsubscribe = subscribeComponentRetries(() => events.push([componentRetryEpoch('properties'), componentRetryEpoch('roles')]));
  retryMaestroComponent('properties');
  assert.deepEqual(events, [[1, 0]]);
  assert.equal(componentRetryEpoch('roles'), 0);
  retryMaestroComponent('roles');
  assert.deepEqual(events, [[1, 0], [1, 1]]);
  unsubscribe();
  retryMaestroComponent('properties');
  assert.equal(events.length, 2);
  assert.deepEqual(componentRetryHeaders(0), {});
  assert.deepEqual(componentRetryHeaders(2), {'x-maestro-component-retry': '1'});
  assert.doesNotMatch(source, /setQueryXml|setLiveQuery|location\.reload|window\.location|history\.pushState/);
});

test('Anytime clock is a focusable component-scoped retry control', () => {
  const indicator = read('src/canvas/utils/incomplete-widget.tsx');
  assert.match(indicator, /retryMaestroComponent\(source\)/);
  assert.match(indicator, /if \(!status\?\.incomplete\) return null/);
  assert.match(indicator, /aria-label=\{`Retry only \$\{source\} query`\}/);
  assert.doesNotMatch(indicator, /location\.reload|window\.location|refreshLiveQuery/);
});

test('502 503 504 error actions use shadcn ButtonGroup beside Copy with callback from the owner', () => {
  const error = read('src/components/ui/error-details.tsx');
  assert.match(error, /function isRetryableGatewayError/);
  assert.match(error, /\(\?:502\|503\|504\)/);
  assert.match(error, /<ButtonGroup aria-label="Error actions"/);
  assert.match(error, /onRetry && isRetryableGatewayError\(error\)/);
  assert.match(error, /onClick=\{onRetry\}/);
  for (const [file, component] of [
    ['src/canvas/left/pane-navigation.tsx', 'properties'],
    ['src/canvas/left/pane-navigation.tsx', 'roles'],
    ['src/canvas/left/filter-pane.tsx', 'categories'],
    ['src/canvas/center/pane.tsx', 'results'],
    ['src/canvas/right/pane.tsx', 'record'],
  ]) assert.ok(read(file).includes(`onRetry={() => retryMaestroComponent("${component}")}`), `${file}: ${component}`);
});

test('retry revisions are consumed by each request owner and not by the global Refresh', () => {
  const workspace = read('src/canvas/utils/workspace-controller.tsx');
  for (const key of ['properties','roles','categories','graphs','alphabet','groups','results','record']) {
    assert.ok(workspace.includes(`useMaestroComponentRetry("${key}")`), key);
  }
  for (const key of ['retryProperties','retryRoles','retryCategories','retryGraphs','retryAlphabet','retryGroups','retryResults','retryRecord']) {
    assert.ok(workspace.includes(`componentRetryHeaders(${key})`) || (key === 'retryRecord' && workspace.includes('retryRevision: retryRecord')), key);
  }
  const personal = read('src/canvas/left/filter.tsx');
  assert.match(personal, /useMaestroComponentRetry\(`personal:\$\{identity\}`\)/);
  assert.match(personal, /useMaestroComponentRetry\(`personal-role:\$\{uri\}`\)/);
  assert.match(personal, /componentRetryHeaders\(retryRevision\)/);
});

test('explicit retry bypasses both browser cache and FCT and SPARQL proxy caches', () => {
  const client = read('src/lib/client-query-cache.ts');
  const fct = read('src/app/proxy/api/fct/route.ts');
  const sparql = read('src/app/proxy/api/sparql/route.ts');
  assert.match(client, /requestHeaders\.get\("x-maestro-component-retry"\) === "1" \? null\s*:\s*await lookupCachedResponseWithDeadline\(key, init\?\.signal\)/);
  assert.match(fct, /const componentRetry = request\.headers\.get\("x-maestro-component-retry"\) === "1"/);
  assert.match(fct, /hasStatusConstraints \|\| isValidate \|\| componentRetry/);
  assert.match(sparql, /const bypassComponentCache = request\.headers\.get\("x-maestro-component-retry"\) === "1"/);
  assert.match(sparql, /querySparql\(fctEndpoint, actualQuery, queryTimeoutMs, request\.signal, undefined, bypassComponentCache\)/);
  assert.match(sparql, /querySparql\(fctEndpoint, fallback, queryTimeoutMs, request\.signal, undefined, bypassComponentCache\)/);
  assert.match(sparql, /querySparql\(recordEndpoint, query, scanTimeout, request\.signal, undefined, request\.headers\.get\("x-maestro-component-retry"\) === "1"\)/);
});

test('Sankey cosmetic dropdown has a real shadcn Radix Select module in the ZIP', () => {
  const sankey = read('src/canvas/tab/analyze/d3-sankey.tsx');
  const select = read('src/components/ui/select.tsx');
  assert.match(sankey, /from "@\/components\/ui\/select"/);
  assert.match(select, /from "radix-ui"/);
  assert.match(select, /export \{ Select, SelectTrigger, SelectValue, SelectContent, SelectItem \}/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['radix-ui'], 'radix-ui is a declared dependency');
  assert.match(sankey, /import \{ Slider \} from "@\/components\/ui\/slider"/);
  assert.match(sankey, /import \{ Checkbox \} from "@\/components\/ui\/checkbox"/);
});
