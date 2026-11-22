const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = path => fs.readFileSync(path, 'utf8');
function loadTs(file, mocks) {
  const output = ts.transpileModule(read(file), {compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const mod = {exports:{}};
  vm.runInNewContext(output, {module:mod,exports:mod.exports,require:id => {
    if (!(id in mocks)) throw Error(`Unmocked dependency ${id}`);
    return mocks[id];
  }, URL, encodeURIComponent, JSON, Set, Map, Object, Array}, {filename:file});
  return mod.exports;
}
const memory = new Map();
const storage = {maestroStorageGet: key => memory.get(key) ?? null,maestroStorageSet:(key,value) => memory.set(key,value)};
const directoryApi = loadTs('src/lib/graph-server-directory.ts', {'@/lib/maestro-storage':storage});
const {chooseStartupGraphServer,createAddressedStartupQuery,prepareInitialFctQuery,DEFAULT_PUBLIC_GRAPH_SERVER,readCachedPersonalGraphServers,rememberPersonalGraphServers} =
  loadTs('src/lib/graph-server-startup.ts', {
    '@/lib/graph-server-health':{graphServerUrlMatches:(a,b)=>a.replace(/\/$/,'')===b.replace(/\/$/,'')},
    '@/lib/graph-server-directory':directoryApi,
    '@/lib/graph-address-mode':{ALL_GRAPHS:'$ALL$'},
    '@/lib/maestro-storage':storage,
  });
const endpoint = (id,url,group) => ({id,label:id,url,group});
const publicServer = endpoint('public-a','https://public.example/sparql','Public');
const publicServerB = endpoint('public-b','https://another.example/sparql','Public');
const personalA = endpoint('personal-a','https://personal-a.example/sparql','Personal');
const personalB = endpoint('personal-b','https://personal-b.example/sparql','Personal');
const directory = entries => ({courtesyDigest:'',groups:{Public:entries,Shared:[]}});
const choose = (partial) => chooseStartupGraphServer({preferredUrl:'',personalEndpoints:[],directory:directory([]),...partial});

test('startup selects last used personal before another personal or any public', () => {
  const result = choose({preferredUrl:personalB.url,personalEndpoints:[personalA,personalB],
    directory:directory([publicServer])});
  assert.equal(result.url,personalB.url);
  assert.equal(result.addedDefault,false);
});
test('personal list wins over a previously selected public; restored personal login endpoint is usable', () => {
  assert.equal(choose({preferredUrl:publicServer.url,personalEndpoints:[personalA],directory:directory([publicServer])}).url,personalA.url);
  assert.equal(choose({preferredUrl:publicServer.url,loginPersonalUrl:personalB.url,directory:directory([publicServer])}).url,personalB.url);
});
test('with no personal servers, previous public preference wins then first local public', () => {
  assert.equal(choose({preferredUrl:publicServerB.url,directory:directory([publicServer,publicServerB])}).url,publicServerB.url);
  assert.equal(choose({preferredUrl:'https://unlisted.example/sparql',directory:directory([publicServer])}).url,publicServer.url);
});
test('no registered candidates chooses DBpedia and records it in browser-owned Shared', () => {
  const selected = choose({preferredUrl:'ftp://invalid.example/sparql'});
  assert.equal(selected.url,DEFAULT_PUBLIC_GRAPH_SERVER);
  assert.equal(selected.addedDefault,true);
  const result = directoryApi.collectSharedGraphServer(selected.url);
  assert.equal(result.groups.Shared[0].url,DEFAULT_PUBLIC_GRAPH_SERVER);
  assert.equal(directoryApi.collectSharedGraphServer(selected.url).groups.Shared.length,1);
});
test('personal directory cache persists per restored account, never across login identity', () => {
  rememberPersonalGraphServers('https://login.example/sparql','alice',[personalA,personalB]);
  assert.deepEqual(Array.from(readCachedPersonalGraphServers('https://login.example/sparql','alice'),x=>x.url),[personalA.url,personalB.url]);
  assert.equal(readCachedPersonalGraphServers('https://login.example/sparql','bob').length,0);
  rememberPersonalGraphServers('https://login.example/sparql','alice',[]);
  assert.equal(readCachedPersonalGraphServers('https://login.example/sparql','alice').length,2);
});
test('the dropdown is released by directory hydration, not the presence of addr', () => {
  const menu=read('src/canvas/top/appbar-pane.tsx');
  const controller=read('src/canvas/controllers/graph-servers.ts');
  assert.match(menu,/!graphServerDirectoryHydrated \? \(/);
  assert.doesNotMatch(menu,/!graphRegistryReady \? \(/);
  assert.match(menu,/disabled=\{fctEndpoints\.length === 0\}/);
  assert.match(controller,/setGraphServerDirectoryHydrated\(true\)/);
});
test('addressed startup helper builds an empty FCT query without copying old filters',()=>{
  const selected = choose({preferredUrl:personalB.url,personalEndpoints:[personalA,personalB], directory:directory([publicServer])});
  const root = createAddressedStartupQuery(selected.url);
  assert.equal(root.name, 'query');
  assert.equal(root.attributes.addr, '$ALL$@'+personalB.url);
  assert.deepEqual(Array.from(root.children,node=>node.name), ['text','view']);
  assert.equal(root.children[0].text, '');
  assert.equal(root.children[1].attributes.type, 'text');
  assert.equal(root.children[1].attributes.limit, '30');
  assert.equal(root.children[1].attributes.offset, '0');
  assert.equal(root.children.filter(node=>node.name==='property'||node.name==='class'||node.name==='value').length,0);
  // Exercise the real FCT XML serializer and ID allocator. The XML sent to
  // Results must have the endpoint, not merely a selected dropdown label.
  const ids = loadTs('src/lib/fct-node-identity.ts', {});
  const serializer = loadTs('src/lib/fct-query-serialize.ts', {'./fct-node-identity': ids});
  const xml = serializer.serializeFctQuery(root);
  assert.match(xml, /<query[^>]+addr="\$ALL\$@https:\/\/personal-b\.example\/sparql"/);
  assert.match(xml, /<view[^>]+type="text"/);
  assert.doesNotMatch(xml, /<text\b|<value\b|<class\b|<property\b/);
  assert.throws(()=>createAddressedStartupQuery(''),/graph-server URL must be valid/);
});

test('bare URL becomes an executable Everywhere query; explicit valid q is untouched',()=>{
  const fresh = prepareInitialFctQuery(null,personalB.url);
  assert.equal(fresh.attributes.addr,'$ALL$@'+personalB.url);
  const preserved = {...fresh,attributes:{...fresh.attributes,addr:'https://graph.example/id@https://other.example/sparql'}};
  assert.equal(prepareInitialFctQuery(preserved,personalB.url),preserved);
  assert.throws(()=>prepareInitialFctQuery(null,''),/Initial FCT query requires a valid graph-server URL/);
});
test('legacy q with no addr is corrected without discarding its filters, view or node IDs',()=>{
  const prior={name:'query',attributes:{xmlns:'http://openlinksw.com/services/facets/1.0',addr:''},children:[
    {id:'class-id',name:'class',attributes:{iri:'http://example.org/Project'},children:[]},
    {id:'view-id',name:'view',attributes:{type:'list',limit:'20',offset:'4'},children:[]},
  ]};
  const restored=prepareInitialFctQuery(prior,personalA.url);
  assert.equal(restored.attributes.addr,'$ALL$@'+personalA.url);
  assert.equal(prior.attributes.addr,'');
  assert.equal(restored.children,prior.children);
  assert.equal(restored.children[0].attributes.iri,'http://example.org/Project');
  assert.equal(restored.children[1].attributes.offset,'4');
  const ids=loadTs('src/lib/fct-node-identity.ts', {});
  const serializer=loadTs('src/lib/fct-query-serialize.ts',{'./fct-node-identity':ids});
  assert.match(serializer.serializeFctQuery(restored),/addr="\$ALL\$@https:\/\/personal-a\.example\/sparql"/);
  const existingGraph=prepareInitialFctQuery({...prior,attributes:{...prior.attributes,graph:'http://example.org/dataset'}},personalA.url);
  assert.equal(existingGraph.attributes.addr,'http://example.org/dataset@'+personalA.url);
  const partialAddr = prepareInitialFctQuery({...prior,attributes:{...prior.attributes,addr:'http://example.org/graph@'}},personalA.url);
  assert.equal(partialAddr.attributes.addr,'http://example.org/graph@'+personalA.url);
  const noNamespace = prepareInitialFctQuery(prior,personalA.url);
  assert.equal(noNamespace.attributes.xmlns,'http://openlinksw.com/services/facets/1.0');
});
test('startup commits explicit q or locally repaired addr before URL synchronization', () => {
  const controller = read('src/canvas/utils/workspace-controller.tsx');
  const start = controller.indexOf('const initialUrlRestoredRef = ');
  const finish = controller.indexOf('// One authoritative serializer for the address bar', start);
  assert.ok(start >= 0 && finish > start);
  const boot = controller.slice(start, finish);
  const syncStart = controller.indexOf('// Phase C navigation actor', finish);
  const syncEnd = controller.indexOf('// Avoid writing the same restored History URL', syncStart);
  assert.ok(syncStart > finish && syncEnd > syncStart);
  const urlSync = controller.slice(syncStart, syncEnd);

  assert.match(boot, /const supplied = params\.get\("q"\)/);
  assert.match(boot, /const parsed = supplied\?\.trim\(\) \? parseFctQueryXml\(supplied\) : createBlankStartupQuery\(\)/);
  assert.match(boot, /const explicitServer =/);
  assert.match(boot, /if \(\!explicitServer\) \{/);
  assert.match(boot, /chooseStartupGraphServer\(\{/);
  assert.match(boot, /prepared = prepareInitialFctQuery\(parsed, selected\.url\)/);
  assert.match(boot, /if \(selected\.addedDefault\) collectSharedGraphServer\(selected\.url\)/);
  assert.match(boot, /else if \(at < 0\)/); // legacy server-only addr

  const parseAt = boot.indexOf('const parsed = ');
  const fallbackAt = boot.indexOf('if (!explicitServer)');
  const serializeAt = boot.indexOf('const initialXml = serializeFctQuery(prepared)');
  const restoreAt = boot.indexOf('restoreQueryAndUiState(initialXml, initialUiState, params.get("history"), true)');
  const verifiedAt = boot.indexOf('workbenchQueryTreeApi.getTree().attributes.addr !== prepared.attributes.addr');
  const readyAt = boot.indexOf('setUrlStateInitialized(true)');
  assert.ok(parseAt >= 0 && fallbackAt > parseAt && serializeAt > fallbackAt && restoreAt > serializeAt && verifiedAt > restoreAt && readyAt > verifiedAt);
  assert.match(boot, /setUrlRestoreError\(message\)/); // failure must settle, not hang
  assert.doesNotMatch(boot, /if \(needsAddress|await\s|initializeMaestroStorage\(|authRestoreComplete|setSelectedEndpointId\(|window\.history\.replaceState|searchParams\.set\("q"\)/);
  assert.match(boot, /\}, \[\]\);/);

  assert.match(urlSync, /useLayoutEffect\(\(\) => \{\s*if \(!urlStateInitialized\) return;/);
  assert.match(urlSync, /window\.history\.replaceState/);
  assert.doesNotMatch(controller, /restoreGraphServerPreference\(/);
});

test('result execution gets the server only from the authoritative FCT query, never the remembered menu',()=>{
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(controller,/const queryGraphServer = graphRegistryReady \? authoritativeServerUrl : null/);
  assert.match(controller,/const endpointReadyForQuery = Boolean\(queryGraphServer\)/);
  assert.match(controller,/graphKey: operationGraphKey,/);
  assert.match(controller,/queryHydrated: urlStateInitialized,/);
  assert.doesNotMatch(controller,/const endpointReadyForQuery = Boolean\(selectedEndpointId\)/);
});

test('all startup modified TS and TSX modules parse',()=>{
  for(const file of [
    'src/lib/graph-server-startup.ts','src/canvas/controllers/graph-servers.ts',
    'src/canvas/controllers/workspace-interfaces.ts','src/canvas/utils/workspace-controller.tsx',
    'src/canvas/top/appbar-pane.tsx',
  ]) {
    const parsed=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(parsed.parseDiagnostics.length,0,`${file}: ${parsed.parseDiagnostics.map(d=>d.messageText).join(',')}`);
  }
});
