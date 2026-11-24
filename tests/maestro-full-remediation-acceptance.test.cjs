const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');

test('Numeric FCT count projection carries Sheet provenance and its own dispatch clock on initial load and refresh', () => {
  const s = read('src/canvas/left/personal-numeric-facet.tsx');
  assert.match(s,/proxyDebugHeaders\("facet:count:numeric-domain", `NumericFacet:/);
  assert.match(s,/"X-Maestro-Clock-Component": `component:numeric:\$\{property\}`/);
  assert.match(s,/resetMaestroQueryExecutionScope\(`component:numeric:\$\{property\}`\)/);
  assert.ok((s.match(/clockScope=\{`component:numeric:\$\{property\}`\}/g)||[]).length>=2,'initial and refresh have same timer');
  assert.match(s,/Numeric domain HTTP \$\{response.status\}/);
  assert.match(s,/count projection SPARQL:/);
  const timeouts = read('src/lib/maestro-query-timeouts.ts');
  assert.match(timeouts,/if \(s.includes\("count"\) \|\| s.includes\("distinct"\)\) return "counts"/);
  const proxy = read('src/app/proxy/api/sparql/route.ts');
  assert.match(proxy,/x-maestro-query-timeout-ms/);
});

test('Personal facet requests and headers map to their own execution clock, not the global personal category',()=>{
  const filter = read('src/canvas/left/filter.tsx');
  const cards = read('src/canvas/left/personal-widget-cards.tsx');
  assert.match(filter,/resetMaestroQueryExecutionScope\(`component:personal:\$\{identity\}`\)/);
  assert.match(filter,/"X-Maestro-Clock-Component": `component:personal:\$\{identity\}`/);
  assert.match(cards,/clockScope=\{`component:personal:\$\{widgetKey\}`\}/);
  assert.match(filter,/"X-Maestro-Clock-Component": `component:personal-role:\$\{uri\}`/);
  const events = read('src/lib/client-query-events.ts');
  assert.match(events,/componentScope\?: MaestroQueryClockScope \| null/);
  assert.match(events,/beginMaestroQueryExecution\(componentScope\)/);
  assert.match(events,/for \(const complete of finish\) complete\(data.elapsedMs\)/);
  const client = read('src/lib/client-query-cache.ts');
  assert.match(client,/subscribeMaestroQueryEvents\(telemetryId, clockScope,[\s\S]*componentClockScope\)/);
});

test('A scoped execution clock can be reset without disturbing other components',()=>{
  const js = ts.transpileModule(read('src/lib/maestro-query-execution-clock.ts'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`, {performance,Headers})(()=>{throw Error('Unexpected runtime import')},module,module.exports);
  const c = module.exports;
  const other='component:personal:https://example.test/role';
  const mine='component:personal:https://example.test/predicate';
  const completeOther=c.beginMaestroQueryExecution(other);
  c.beginMaestroQueryExecution(mine);
  assert.equal(c.getMaestroQueryExecutionSnapshot(other).active,1);
  c.resetMaestroQueryExecutionScope(mine);
  assert.equal(c.getMaestroQueryExecutionSnapshot(mine).active,0);
  assert.equal(c.getMaestroQueryExecutionSnapshot(other).active,1);
  completeOther(200);
  assert.equal(c.getMaestroQueryExecutionSnapshot(other).active,0);
  assert.ok(c.getMaestroQueryExecutionSnapshot(other).elapsedMs>=200);
});

test('Optional FCT datatype evidence never fails the main facet LIST, and successful evidence can be cached',()=>{

  const lanes = require('node:fs').readFileSync("src/lib/app-lifecycle/facet-requests.ts", 'utf8');
  assert.ok(lanes.includes('FACET_STARTED'));
  assert.ok(lanes.includes('FACET_SETTLED'));
  assert.ok(lanes.includes('FACET_CANCELLED'));
  assert.ok(lanes.includes('settleCategoriesError'));
  assert.ok(lanes.includes('settlePropertiesError'));
  assert.ok(lanes.includes('failed: {}'));
 
      const route = require('node:fs').readFileSync("src/app/proxy/api/fct/route.ts", 'utf8');
      assert.ok(route.includes('if (compiled.datatypeEvidenceQuery && !countOnly && !partial)'));
      assert.ok(route.includes('setQueryCache(evidenceResult.key, evidenceResult.text)'));
      assert.ok(route.includes('Facet datatype evidence probe failed'));
    
  });
test('XState gates every Sheet clear action, including an open confirmation dialog',()=>{
  const access=read('src/lib/app-lifecycle/access.ts');
  const sheet=read('src/canvas/sheet/settings-pane.tsx');
  const workspace=read('src/canvas/workspace.tsx');
  const auth=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(access,/LOGIN_ACTIVITY: \{ actions: assign/);
  assert.match(access,/canClearCaches: !snapshot.context.loginPending/);
  assert.match(access,/policyStage !== "seeding"/);
  assert.match(access,/policyStage !== "verifying"/);
  assert.ok((sheet.match(/guardedClear\(/g)||[]).length>=3);
  assert.match(sheet,/disabled=\{!accessCapabilities.canClearCaches\}/);
  assert.match(workspace,/selectMaestroCapabilities\(workspace.accessController.getSnapshot\(\)\).canClearCaches/);
  assert.match(workspace,/event.preventDefault\(\)/);
  // Check the XState event rather than the callback's parameter spelling.
  assert.match(auth,/setLoginTesting:\s*\([^\n]+?=>\s*\{[^\n]*?accessController\.send\(\s*\{\s*type:\s*"LOGIN_ACTIVITY",\s*pending:\s*next\s*\}\s*\)/);
});

test('Login uses one Connecting control, navigation has one joined outline seam, root clips border corners',()=>{
  const appbar=read('src/canvas/top/appbar-pane.tsx');
  assert.match(appbar,/\{loginTesting \? "Connecting…" : "Connect"\}/);
  assert.doesNotMatch(appbar,/>\s*Test Connection\s*</);
  assert.doesNotMatch(appbar,/>\s*Testing…\s*</);
  assert.match(appbar,/\[&>button:not\(:first-child\)\]:!border-l-0/);
  assert.match(appbar,/\[&>button:not\(:first-child\)\]:!ml-0/);
  const crumb=read('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(crumb,/Root breadcrumb[\s\S]{0,240}overflow-hidden rounded-md/);
  assert.match(crumb,/Controls for \$\{breadcrumbLabel\}[\s\S]{0,220}overflow-hidden/);
});

test('EURIO Record formatter uses DESCRIBE @label for acronym, parties and money, and status-colored rail',()=>{
  const x=read('graph/eu-data/record.xsl');
  assert.match(x,/name="acronymRaw"[^>]*@label/);
  assert.match(x,/name="project-monetary"/);
  // European formatting explicitly uses a named decimal picture: 1.234.567,89.
  assert.match(x,/<xsl:decimal-format name="eu" decimal-separator="," grouping-separator="\."\/>/);
  assert.match(x,/format-number\(xs:decimal\(\$amount\),'#\.##0,##','eu'\)/);
  assert.match(x,/name="project-involved-party"/);
  assert.match(x,/name="project-party-display"/);
  assert.match(x,/id="eu-project-status-rail"[^>]+\$statusCode/);
  assert.match(x,/id="eu-project-status-icon"[^>]+\$statusCode/);
  assert.match(x,/id="eu-project-today-value"[^>]*>Today/);
  assert.match(x,/id="eu-project-today-leader"/);
  assert.match(x,/id="eu-project-today-dot"/);
  assert.match(x,/id="eu-project-duration-leader"/);
  assert.match(x,/id="eu-project-duration-dot"/);
  assert.match(x,/>More information<\/h4>/);
  // Narrative fields now precede Results; the fallback Details table excludes
  // those long-text rows, domain-rendered predicates, and the record label.
  const otherRows = x.match(/<xsl:variable name="otherRows" select="([^"]+)"/)?.[1];
  assert.ok(otherRows, 'EURIO fallback Details projection must exist');
  assert.match(otherRows, /\$knownDetailIris/);
  assert.match(otherRows, /\$additionalLongTextRows\/fct:column\[2\]/);
  assert.match(otherRows, /'http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#label'/);
  assert.ok((x.match(/data-maestro-expandable="true"/g)||[]).length>=2);
  assert.ok((x.match(/data-maestro-preserve-formatted-label="true"/g)||[]).length>=3);
  assert.doesNotMatch(x,/shortForm|acronymShortForm/);
  const derived=read('graph/eu-data/involved-party-derived.ttl');
  assert.match(derived,/mui:sourceValuePredicate rdfs:label/);
  assert.match(derived,/Org:.*Role:.*Project:/);
  const generic=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(generic,/dataset\.maestroPreserveFormattedLabel === "true"/);
});

test('The existing Record expansion handler provides more and less without truncating RDF contents',()=>{
  const s=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(s,/\[data-maestro-expandable\]/);
  assert.match(s,/toggle.textContent = "more…"/);
  assert.match(s,/expanded \? "less…" : "more…"/);
  assert.match(s,/summary.style.maxHeight/);
  assert.match(s,/summary.style.maskImage/);
});

test('Full CI runner uses Windows Node 24, npm ci, all tests, TypeScript and Next build',()=>{
  const s=read('.github/workflows/maestro-build.yml');
  for(const expected of ['windows-latest',"node-version: '24'",'npm ci','npm run test','npx tsc --noEmit','npm run build'])
    assert.ok(s.includes(expected),`Missing ${expected}`);
});

test('All changed TypeScript/TSX modules are syntax-valid',()=>{
  const names=[
    'src/app/proxy/api/fct/route.ts','src/canvas/controllers/workspace-interfaces.ts',
    'src/canvas/left/filter.tsx','src/canvas/left/personal-numeric-facet.tsx',
    'src/canvas/left/personal-widget-cards.tsx','src/canvas/sheet/settings-pane.tsx',
    'src/canvas/top/appbar-pane.tsx','src/canvas/top/breadcrumb-renderers.tsx',
    'src/canvas/utils/workspace-controller.tsx','src/canvas/workspace.tsx',
    'src/lib/app-lifecycle/access.ts','src/lib/client-query-cache.ts','src/lib/client-query-events.ts',
    'src/lib/maestro-query-execution-clock.ts'
  ];
  for(const name of names) {
    const source=ts.createSourceFile(name,read(name),ts.ScriptTarget.Latest,true,
      name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(source.parseDiagnostics.length,0,`${name}: ${source.parseDiagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join('; ')}`);
  }
});
