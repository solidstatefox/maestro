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
  }, URL}, {filename:file});
  return mod.exports;
}
const {graphServerUrlMatches} = loadTs('src/lib/graph-server-health.ts',{});
const {resolveSelectedGraphHealthTarget} = loadTs('src/lib/graph-server-preflight.ts',{
  '@/lib/graph-server-health':{graphServerUrlMatches},
});
const servers = [
  {id:'cordis',label:'CORDIS',url:'https://cordis.example/sparql',group:'Public'},
  {id:'dbpedia',label:'DBpedia',url:'https://dbpedia.org/sparql',group:'Public'},
];
test('healthcheck starts for a selected server even before query hydration or addr',()=>{
  assert.equal(resolveSelectedGraphHealthTarget(servers,'cordis',null)?.testedUrl,'https://cordis.example/sparql');
  assert.equal(resolveSelectedGraphHealthTarget(servers,'cordis','')?.endpoint.id,'cordis');
});
test('restored query addr outranks stale preference until selection reconciles',()=>{
  const result = resolveSelectedGraphHealthTarget(servers,'dbpedia','https://cordis.example/sparql');
  assert.equal(result?.endpoint.id,'cordis');
  assert.equal(result?.testedUrl,'https://cordis.example/sparql');
  assert.equal(resolveSelectedGraphHealthTarget(servers,'dbpedia','https://unknown.example/sparql'),null);
});
test('never probe with a fabricated missing registry entry',()=>{
  assert.equal(resolveSelectedGraphHealthTarget(servers,'missing',null),null);
  assert.equal(resolveSelectedGraphHealthTarget([], 'cordis',null),null);
});
test('health probe is driven by selected identity, not URL hydration, Results or an addr prerequisite',()=>{
  const source=read('src/canvas/utils/workspace-controller.tsx');
  const start=source.indexOf('// Selection is enough to initiate health verification.');
  const end=source.indexOf('// A single grouped FCT alphabet request',start);
  assert.ok(start>0 && end>start);
  const effect=source.slice(start,end);
  assert.match(effect,/resolveSelectedGraphHealthTarget\(fctEndpoints, selectedEndpointId, queryGraphServer\)/);
  assert.doesNotMatch(effect,/if \(!urlStateInitialized|if \(!graphRegistryReady|if \(!queryGraphServer/);
  assert.match(effect,/checkSelectedGraphServer\(selected, false, testedUrl\)/);
  assert.match(effect,/preflightInFlightRef\.current !== probeKey/);
  assert.match(effect,/for \(let attempt = 0; attempt < 3;/);
  assert.doesNotMatch(effect,/setQueryAttribute|replaceQueryTree|setSelectedEndpointId|chooseFctEndpoint\(/);
});
test('FCT readiness reads the live tree addr rather than a second DOMParser gate',()=>{
  const source=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(source,/const graphRegistryReady = Boolean\(validGraphServerUrl\(authoritativeServerUrl\)\)/);
  assert.match(source,/const queryGraphServer = graphRegistryReady \? authoritativeServerUrl : null/);
  assert.match(source,/const endpointReadyForQuery = Boolean\(queryGraphServer\)/);
});
test('choosing a remembered server again is permitted if the live FCT addr is empty',()=>{
  const source=read('src/canvas/utils/workspace-controller.tsx');
  const start=source.indexOf('async function chooseFctEndpoint(endpointId: string)');
  const end=source.indexOf('// Personal View widgets subscribe',start);
  const block=source.slice(start,end);
  assert.doesNotMatch(block,/if \(!endpointId \|\| endpointId === selectedEndpointId\) return/);
  assert.match(block,/endpointId === selectedEndpointId &&\s*graphServerUrlMatches\(endpoint.url, authoritativeServerUrl/);
  assert.match(block,/setQueryAttribute\("addr", `\$\{graph\}@\$\{endpoint.url\}`\)/);
});
test('while selected health check is in progress, show spinner instead of not-yet-polled ?',()=>{
  const source=read('src/canvas/top/appbar-pane.tsx');
  assert.match(source,/displayedEndpointChecking \? <LoaderCircle aria-label="Checking graph server"/);
  assert.match(source,/<EndpointStatusIcon status=\{displayedEndpointStatus\}/);
});
test('inconclusive checked status is amber, distinct from the never-polled question mark',()=>{
  const source=read('src/canvas/top/appbar.tsx');
  assert.match(source,/if \(!status\) return <BadgeQuestionMark aria-label="Not yet polled"/);
  assert.match(source,/status.state === "probe-error"\) return <BadgeAlert aria-label="SPARQL health probe inconclusive"/);
});
test('all healthcheck changed modules are TypeScript syntax-valid',()=>{
  for(const file of ['src/lib/graph-server-preflight.ts','src/canvas/utils/workspace-controller.tsx','src/canvas/top/appbar-pane.tsx','src/canvas/top/appbar.tsx']) {
    const syntax=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(syntax.parseDiagnostics.length,0,`${file}: ${syntax.parseDiagnostics.map(d=>d.messageText).join(',')}`);
  }
});
