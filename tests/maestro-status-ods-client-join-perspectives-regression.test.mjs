import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = name => fs.readFileSync(name, 'utf8');

function loadSource(name, mocks, globals = {}) {
  const compiled = ts.transpileModule(read(name), {
    fileName: name, compilerOptions: {target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS},
    reportDiagnostics:true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const module = {exports:{}};
  const script = vm.runInNewContext(`(function(require,module,exports){${compiled.outputText}\n})`, globals);
  script(name => {if (name in mocks) return mocks[name];throw new Error(`Unmocked ${name}`)},module,module.exports);
  return module.exports;
}

const personalBase = 'http://demo.openlinksw.com/ods/home/acme/query';
const remoteAddr = `$ALL$@https://vec.demo.openlinksw.com/sparql`;
const xml = `<query addr="${remoteAddr}"><view type="list"/></query>`;
const statusRows = [
  {s:{value:'urn:A'},status:{value:'urn:Seen'}},
  {s:{value:'urn:A'},status:{value:'urn:Starred'}},
  {s:{value:'urn:B'},status:{value:'urn:Hidden'}},
  {s:{value:'urn:C'},status:{value:'urn:Seen'}},
];

function statusHarness({match=['urn:A','urn:C'],incomplete=false, total=4}={}) {
  const personalQueries=[], remoteQueries=[], compilations=[];
  const mocks = {
    '@/lib/constants/graphs':{ GRAPH:{STATUS:'status',SHACL_POLICIES:'shacl-policies'}, resolveGraph:(key,base)=>base+'/'+(key==='shacl-policies'?'shacl/policies':key) },
    '@/lib/client-personal-sparql': {
      personalContext: async () => ({base:personalBase,addr:`${personalBase}@https://demo.openlinksw.com/sparql`}),
      selectPersonal: async query => {
        personalQueries.push(query);
        if(query.includes('COUNT(*)'))return [{ct:{value:String(total)}}];
        return statusRows;
      },
    },
    '@/lib/client-query-cache': {
      cachedFetchFct: async (path, options) => {
        assert.equal(path, '/proxy/api/sparql');
        const data = JSON.parse(options.body);
        remoteQueries.push(data);
        assert.equal(data.addr,remoteAddr);
        assert.doesNotMatch(data.query,/\bSERVICE\s*</i);
        return {ok:true,status:200,text:async () => JSON.stringify({incomplete,
          results:{bindings:match.map(value=>({c1:{type:'uri',value}}))}})};
      },
    },
    '@/lib/fct-status-projection': {cloneFctListStatusView:() => '<query><view type="list-status"/></query>'},
    '@/lib/fct-query-clone': {withFctQueryExecutionAddress:(query, addr) => query},
    '@/lib/fct-sparql-translator': {compileFctXmlToSparql:() => ({})},
    '@/lib/client-provider-provenance': {isClientQueryBookmarked:async()=>true},
    '@/lib/upstream-error': {describeUpstreamError:()=>'',sanitizeUpstreamDiagnostic:x=>x},
    '@/canvas/utils/fct-response': {parseFctResponse:()=>({}),parseListValuesXml:()=>new Map(),mergeValuesQueryClone:()=>''},
  };
  // Compile an actual VALUES-headed source projection for the test transport.
  mocks['@/lib/fct-sparql-translator'].compileFctXmlToSparql = (...args) => {
    const candidates=args[8];compilations.push(candidates);
    return {view:'list-status',query:`SELECT DISTINCT (?s1 AS ?c1) WHERE { VALUES ?s1 { ${candidates.map(uri=>`<${uri}>`).join(' ')} } ?s1 ?p ?o . }`};
  };
  class DOMParser {parseFromString() {
    return {querySelector:()=>null,documentElement:{localName:'query',getAttribute:attr=>attr==='addr'?remoteAddr:null}};
  }}
  const client=loadSource('src/lib/fct-client.ts',mocks,{DOMParser,TextDecoder,Uint8Array});
  return {client,personalQueries,remoteQueries,compilations};
}

test('Status joins personal ODS assertions with unpaginated remote FCT membership without SERVICE',async()=>{
  const {client,personalQueries,remoteQueries,compilations}=statusHarness();
  const result=await client.fctStatusFacet(xml);
  assert.deepEqual(Object.fromEntries(result.entries.map(x=>[x.uri,x.count])),{'urn:Seen':2,'urn:Starred':1});
  assert.equal(personalQueries.length,2);
  assert.match(personalQueries[0],/COUNT\(\*\)/);
  assert.match(personalQueries[1],/ORDER BY \?s \?status LIMIT 400 OFFSET 0/);
  assert.equal(remoteQueries.length,1);
  assert.deepEqual([...compilations[0]],['urn:A','urn:B','urn:C']);
  assert.match(result.sparql,/VALUES \?s1/);
  assert.doesNotMatch(result.sparql,/SERVICE/);
});

test('Status rejects incomplete remote results rather than showing false zero counts',async()=>{
  const {client}=statusHarness({incomplete:true});
  await assert.rejects(client.fctStatusFacet(xml), /incomplete result/);
});

test('Status refuses to silently truncate oversized personal graphs',async()=>{
  const {client,remoteQueries}=statusHarness({total:25001});
  await assert.rejects(client.fctStatusFacet(xml),/25,000/);
  assert.equal(remoteQueries.length,0);
});

test('Perspective discovery uses bounded one-hop ontology closure and approved provider filtering',async()=>{
  const queries=[];
  const mocks={
    '@/lib/constants/graphs':{ GRAPH:{SHACL_POLICIES:'shacl-policies',STATUS:'status'}, resolveGraph:(key,base)=>base+'/'+(key==='shacl-policies'?'shacl/policies':key) },
    '@/lib/client-query-cache': {maestroQueryFetch:async()=>{
      throw Error('Unexpected record-probe fetch during ontology-only discovery');
    }},
    '@/lib/client-personal-sparql': {
      personalContext:async()=>({base:personalBase}),
      selectPersonal:async query=>{
        queries.push(query);
        if(query.includes('rdfs:subClassOf ?parent')){
          if(query.includes('<urn:Hotel>'))return [{parent:{value:'urn:Lodging'}}];
          if(query.includes('<urn:Lodging>'))return [{parent:{value:'urn:Place'}}];
          return [];
        }
        return [{provider:{value:'urn:provider'},kind:{value:'history'},label:{value:'History'},stylesheet:{value:'<xsl:stylesheet/>'}}];
      },
    },
    '@/lib/client-policy-approvals':{readClientPolicyApprovals:async()=>[{uri:'urn:provider',status:'Approved'}]},
    '@/lib/client-provider-provenance':{isClientQueryBookmarked:async()=>true,writeClientProviderDiscovery:async()=>{}},
    '@/lib/maestro-ui-component-ids':{UI_COMPONENT:{perspectiveRibbon:'urn:present'}},
  };
  const {discoverClientPerspectives}=loadSource('src/lib/client-personal-perspectives.ts',mocks);
  const result=await discoverClientPerspectives(['urn:Hotel']);
  assert.equal(result.length,1);
  assert.equal(result[0].uri,'urn:provider');
  const final=queries.at(-1);
  for(const iri of ['urn:Hotel','urn:Lodging','urn:Place'])assert.ok(final.includes(`<${iri}>`),iri);
  assert.doesNotMatch(queries.join('\n'),/rdfs:subClassOf\+/);
  assert.ok(queries.every(q=>!q.includes('SERVICE <')));
});

test('fullscreen Wand renders inline semantic groups without the old top selections strip',()=>{
  const explorer=read('src/canvas/right/record-explorer.tsx');
  const pane=read('src/canvas/right/pane.tsx');
  const decorator=read('src/canvas/controllers/record-rdfa-decoration.ts');
  assert.doesNotMatch(explorer,/aria-label="Wand query selections"/);
  assert.match(explorer,/nodeId: wandDraft \? \(wandPropertyNodeId/);
  assert.match(pane,/data-maestro-inline-wand-slot/);
  assert.match(pane,/data-maestro-wand-inline-replaced/);
  assert.match(pane,/<InputGroup key=\{`\$\{sessionIndex\}/);
  assert.match(pane,/intent:"wand",kind:item.kind/);
  assert.match(pane,/intent: "pivot", kind: "value"/);
  assert.match(decorator,/data-maestro-record-interactive/);
  assert.match(read('src/canvas/right/record-source-highlight.css'),/cursor: pointer/);
});

test('Status inspector previews the direct remote population query, not a federated ODS query', () => {
  const widget = read('src/canvas/left/status-widget.tsx');
  const effect = widget.slice(widget.indexOf('  // The inspector must show'), widget.indexOf('  // Checked statuses belong'));
  assert.match(effect, /compileFctXmlToSparql\(inspectorXml\)/);
  assert.match(effect, /addr:tree\.attributes\.addr/);
  assert.doesNotMatch(effect, /defaultStatusAddr|executionEndpoint|personalContext|kind: "service"/);
});
