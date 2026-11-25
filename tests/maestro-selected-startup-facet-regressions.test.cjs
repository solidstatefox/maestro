const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
const work = read('src/canvas/utils/workspace-controller.tsx');
const seedSource = read('src/lib/client-graph-seed.ts');

function instantiateBrowserSeed(fetchImpl, personalContext = async () => { throw Error('personalContext must not be used'); }) {
  const code = ts.transpileModule(seedSource, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  const imports = {
    '@/lib/constants/graphs': {GRAPH:{}, resolveGraph:()=>''},
    '@/lib/client-personal-sparql': {personalContext, selectPersonal:async()=>[], updatePersonal:async()=>{}},
    '@/lib/status-machine-client': {invalidateClientStatusMachines:()=>{}},
    '@/lib/bnode': {createBlankNodeLabelAllocator:()=>()=> 'x'},
    '@/lib/personal-status-vocabulary': {MUI_NS:'urn:maestro:ui#'},
    '@/lib/personal-auth': {graphForPrefix:()=>{throw Error('graphForPrefix must not be used during anonymous asset loading');}},
    '@/lib/graph-seed-content-digest': {destinationSeedDigest:async()=>''},
  };
  vm.runInNewContext(code, { module, exports:module.exports, TextEncoder, AbortSignal, Promise, Set, Map,
    fetch: fetchImpl, require:id=>{if(!(id in imports))throw Error('unexpected '+id);return imports[id];}},
  {filename:'src/lib/client-graph-seed.ts'});
  return module.exports;
}

test('[01] browser-local seed assets load on startup before login, and cache is independent of personalContext', async () => {
  const calls=[];
  const digest='a'.repeat(64);
  const entry={file:'eu-data/provider.ttl',asset:`${digest}.json`,destination:'providers'};
  const asset={file:entry.file,destination:entry.destination,digest:`sha256:${digest}`,triples:[]};
  const browser=instantiateBrowserSeed(async url=>{
    calls.push(url);
    return {ok:true,json:async()=> url.endsWith('manifest.json')?[entry]:asset};
  });
  await browser.initializeBrowserGraphAssets();
  await browser.initializeBrowserGraphAssets();
  assert.equal(calls.length,2,'manifest and asset fetched exactly once');
  assert.deepEqual(calls,['/maestro-seed/manifest.json',`/maestro-seed/${digest}.json`]);
  assert.match(work,/void initializeBrowserGraphAssets\(\)\.catch/);
});

test('[01] browser seed startup failure can retry without poisoning authenticated seed lifecycle', async () => {
  let tries=0;
  const browser=instantiateBrowserSeed(async()=>{
    tries++;
    if(tries===1)throw Error('offline');
    return {ok:true,json:async()=>[{file:'dataserver-seed.ttl',asset:'a'.repeat(64)+'.json',destination:'SKIP'}]};
  });
  await assert.rejects(browser.initializeBrowserGraphAssets(),/offline/);
  await browser.initializeBrowserGraphAssets();
  assert.equal(tries,2);
});

test('[02] fresh courtesy server registry fetches list without requiring digest handshake or login',()=>{
  assert.match(work,/const hasCourtesy=Object\.entries\(stored\.groups\)/);
  assert.match(work,/if\(stored\.courtesyDigest && hasCourtesy\)/);
  assert.match(work,/data=await service\("list"\)/);
  assert.match(work,/replaceCourtesyGraphServers\(data\.digest,data\.endpoints\)/);
  assert.match(work,/for\(let attempt=0;attempt<2&&!cancelled;attempt\+\+\)/);
});

test('[06] protected anonymous graph discovery does not discard a Record',()=>{
  assert.match(work,/SR186\\b\|OAI\\.DBA\\.ASSISTANT_ID_TO_URI_INVERSE/);
  assert.match(work,/Named-graph discovery is restricted by Virtuoso/);
  assert.match(work,/setRecordGraphError\(/);
  assert.match(work,/setRecordGraphs\(/);
});

test('[12] Sheet history and bookmarks use distinct busy labels, without cross-contamination',()=>{
  const sheet=read('src/canvas/sheet/settings-pane.tsx');
  const state=read('src/canvas/controllers/history.ts');
  assert.match(state,/historyLoadingTarget/);
  assert.match(sheet,/historyLoadingTarget === "history"/);
  assert.match(sheet,/historyLoadingTarget === "bookmarks"/);
  assert.match(work,/setHistoryLoadingTarget\(includeFavorites \? "bookmarks" : "history"\)/);
});

test('[13] calendar heatmaps use compact green, orange weekday and blue date scales; date pagination preserved',()=>{
  const source=read('src/canvas/tab/view/perspective-calendar-heatmap.tsx');
  assert.match(source,/<CalendarHeatmap data=\{calendar\} blockSize=\{9\} blockMargin=\{2\}/);
  assert.match(source,/yearClassName="text-base font-semibold"/);
  assert.match(source,/oklch\(0\.55 0\.15 145\)/);
  assert.match(source,/oklch\(0\.65 0\.18 45\)/);
  assert.match(source,/oklch\(0\.56 0\.19 255\)/);
  assert.match(source,/dayShift\(period, delta \* 28\)/);
  assert.match(source,/shownCount\.toLocaleString\(\)/);
});

test('[14-16] selected categories are excluded from available lists; counts and renderer controls compacted',()=>{

  const lanes = require('node:fs').readFileSync("src/lib/app-lifecycle/facet-requests.ts", 'utf8');
  assert.ok(lanes.includes('FACET_STARTED'));
  assert.ok(lanes.includes('FACET_SETTLED'));
  assert.ok(lanes.includes('FACET_CANCELLED'));
  assert.ok(lanes.includes('settleCategoriesError'));
  assert.ok(lanes.includes('settlePropertiesError'));
  assert.ok(lanes.includes('failed: {}'));
 
      const categories = require('node:fs').readFileSync("src/canvas/left/filter-pane.tsx", 'utf8');
      const renderer = require('node:fs').readFileSync("src/canvas/left/facet-presentation.tsx", 'utf8');
      assert.ok(categories.includes('selectedClasses'));
      assert.ok(categories.includes('font-normal tabular-nums'));
      assert.ok(renderer.includes('inline-flex h-7 min-w-0 max-w-40'));
      assert.ok(renderer.includes('inline-flex h-7 min-w-10'));
    
  });

test('[33] reference editing validates the complete candidate query before committing and guards dependent deletion',()=>{
  assert.match(work,/inspectFctValueReferences\(next\);\s*replaceQueryTree\(next\)/);
  assert.match(work,/error instanceof FctNodeInUseError/);
  assert.match(work,/setBlockedReferenceDeletion\(\{nodeId:error.nodeId,dependents:error.dependents,hrefLabels,expectedQueryXml:queryXml\}\)/);
  assert.match(work, /const resolved = getTransportedQueryTreePath\(ref\.anchorId, ref\.targetId\)/);
  assert.match(work, /blockedReferenceDeletion\?\.hrefLabels\[ref\.anchorId\]/);
});

test('selected TS/TSX files parse without syntax errors',()=>{
  const files=['src/lib/client-auth-bootstrap.ts',
    'src/lib/client-graph-seed.ts','src/canvas/controllers/authentication.ts',
    'src/canvas/controllers/history.ts','src/canvas/controllers/workspace-interfaces.ts',
    'src/canvas/left/filter-pane.tsx','src/canvas/left/facet-presentation.tsx',
    'src/canvas/sheet/settings-pane.tsx','src/canvas/tab/view/perspective-calendar-heatmap.tsx',
    'src/canvas/utils/workspace-controller.tsx'];
  for(const file of files){
    const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(source.parseDiagnostics.length,0,`${file}: ${source.parseDiagnostics.map(x=>x.messageText).join('; ')}`);
  }
});

test('[07] contextual SHACL validation uses a proxy-dispatch clock, not a synthetic component timer',()=>{
  const shacl=read('src/lib/client-query-shacl.ts');
  const clock=read('src/lib/maestro-query-execution-clock.ts');
  const pane=read('src/canvas/center/pane.tsx');
  for(const source of ['History','Data','Targets','Shapes','Providers'])
    assert.match(shacl,new RegExp(`QueryContextValidation:${source}`));
  assert.match(clock,/label\.includes\("querycontextvalidation"\)/);
  assert.match(pane,/label="Validating query context"[^>]*clockScope="component:query-context"/);
});

test('[18] History and Bookmarks page size uses the center Results page-size control style',()=>{

      const source = require('node:fs').readFileSync("src/canvas/tab/view/personal-perspectives.tsx", 'utf8');
      const machine = require('node:fs').readFileSync("src/lib/app-lifecycle/perspective-selection.ts", 'utf8');
      assert.ok(machine.includes('maestroPerspectiveSelectionMachine'));
      assert.ok(machine.includes('QUERY_CHANGED'));
      const page = require('node:fs').readFileSync('src/canvas/tab/view/page.tsx','utf8');
      assert.ok(page.includes('viewPagination'));
      assert.ok(page.includes('perspectivePageReady'));
      assert.ok(source.includes('pageRows'));
      assert.ok(!source.includes('setPageSize'));

  });

test('[42] transported <a> anchors share the facet ExternalLink icon and inherit the href target color',()=>{
  assert.match(work,/node\.name === "a"\s*\? ExternalLink/);
  assert.match(work,/node\.name === "a"\s*\? queryTreeRelationshipIconColor\(queryTreePathIndex\.byId\.get\(node\.attributes\.href \?\? ""\)\)/);
  assert.match(work, /queryTreeRelationshipIconColor = [\s\S]*?child\.name === "view"[\s\S]*?"text-emerald-600 dark:text-emerald-400"[\s\S]*?"text-red-600 dark:text-red-400"/);
  assert.match(work,/Transported \$\{transportedDirection === "reverse" \? "role" : "property"\}/);
});
