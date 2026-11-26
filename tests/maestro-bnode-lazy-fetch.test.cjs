const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(rel, modules = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname,'..',rel), 'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports, require(name){if (Object.hasOwn(modules,name)) return modules[name];throw Error(`Unexpected import ${name}`);}, AbortController, DOMException, ...globals});
  return exports;
}
const api = load('src/lib/bnode/index.ts',{'./lifecycle':{}});
const rank = load('src/lib/virtuoso-query-fallbacks.ts');
const errors = load('src/lib/upstream-error.ts',{},{Error});
function fixture(fetch, {ranked=false,limits={window:100,rows:2000,responseMiB:8}}={}) {
  class DOMParser { parseFromString(xml) {
    const limit = xml.match(/limit="(\d+)"/)?.[1] ?? '30';
    const attrs={limit};const view={localName:'view',getAttribute:key=>attrs[key],setAttribute:(key,value)=>{attrs[key]=value;}};
    return {view,documentElement:{getAttribute:()=>'$ALL$@https://example.org/sparql'},querySelector:()=>null,getElementsByTagName:()=>[view]};
  }}
  class XMLSerializer { serializeToString(doc){return doc.view.getAttribute('limit');} }
  return load('src/lib/bnode/client-record.ts',{
    '@/lib/fct-sparql-translator':{compileFctXmlToSparql:limit=>({view:'list-values',limit:Number(limit),focusRelationship:{predicate:'urn:p',direction:'forward'},query:`SELECT ?c1 WHERE { ?s <urn:p> ?c1 } ${ranked?'ORDER BY DESC (<LONG::IRI_RANK>(?c1)) ':''}LIMIT ${limit}`})},
    '@/lib/client-query-cache':{cachedFetchFct:fetch},
    '@/lib/maestro-query-timeouts':{configuredTimeoutMs:()=>20000},
    '@/lib/proxy-debug':{proxyDebugHeaders:()=>({})},
    '@/lib/virtuoso-query-fallbacks':rank,
    './index':api,
    './limits':{readBlankNodeRecordLimits:()=>({...limits}),MIB:1024*1024},
  },{DOMParser,XMLSerializer});
}
const input = (signal,overrides={}) => ({queryXml:'<query><view limit="30"/></query>',preferredLanguage:'all',signal,...overrides});
const result = () => new Response(JSON.stringify({results:{bindings:[{node:{type:'bnode',value:'a'},candidate:{type:'literal',value:'1'}}]}}));
test('initial bnode window caps and lazy XML serialization',()=>{
  const rows=api.parseBlankNodeRecordBindings([{node:{type:'bnode',value:'b'},candidate:{type:'literal',value:'1'},predicate:{type:'uri',value:'urn:p'},object:{type:'literal',value:'<&'},direction:{value:'property'}}]);
  assert.equal(Object.hasOwn(rows[0],'xml'),false);
  assert.match(api.materializeBlankNodeRecord(rows[0],false),/&lt;&amp;/);
  assert.strictEqual(api.blankNodeCandidateIndices(rows),api.blankNodeCandidateIndices(rows));
  assert.equal(api.blankNodeExpansionForParent(JSON.stringify(['bnode','_:private','','',''])).kind,'reconstruct');
  assert.equal(api.blankNodeExpansionForParent(JSON.stringify(['uri','urn:parent','','','urn:g'])).parent,'urn:parent');
  assert.equal(api.blankNodeExpansionForParent(JSON.stringify(['uri','nodeID://b1','','',''])).kind,'reconstruct');
});
test('one pending query is shared; subscriber cancellation does not abort another; settled responses are not cached',async()=>{
  const calls=[];
  const {loadBlankNodeRecord}=fixture((url,opts)=>new Promise((resolve,reject)=>{calls.push({url,opts,resolve,reject});opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true});}));
  const a=new AbortController(),b=new AbortController();
  const p=loadBlankNodeRecord(input(a.signal)),q=loadBlankNodeRecord(input(b.signal));
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/proxy/api/sparql');
  const body=JSON.parse(calls[0].opts.body);assert.equal(body.responseScope,'request');assert.match(body.query,/LIMIT 2000$/);assert.doesNotMatch(body.query,/GROUP BY|MAX\(IF/);
  a.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(calls[0].opts.signal.aborted,false);
  calls[0].resolve(result());assert.equal((await q).records.length,1);
  const c=new AbortController();const fresh=loadBlankNodeRecord(input(c.signal));assert.equal(calls.length,2);c.abort();await assert.rejects(fresh,{name:'AbortError'});assert.equal(calls[1].opts.signal.aborted,true);
});
test('bounded timeout is terminal; explicit retry starts a new flight, no automatic retry',async()=>{
  let count=0;
  const {loadBlankNodeRecord}=fixture(async()=>{count++;return new Response(JSON.stringify({error:'The operation timed out',code:'UPSTREAM_TIMEOUT'}),{status:504});});
  const signal=new AbortController().signal;
  await assert.rejects(loadBlankNodeRecord(input(signal)),/Retry explicitly/);assert.equal(count,1);
  await assert.rejects(loadBlankNodeRecord(input(signal,{retryRevision:1})),/Retry explicitly/);assert.equal(count,2);
});
test('only a verified rank rejection allows one rank-only fallback',async()=>{
  const queries=[];const {loadBlankNodeRecord}=fixture(async(url,opts)=>{queries.push(JSON.parse(opts.body).query);return queries.length===1?new Response(JSON.stringify({error:'SPARQL HTTP 500',details:'SR185 undefined IRI_RANK'}),{status:500}):result();},{ranked:true});
  await loadBlankNodeRecord(input(new AbortController().signal));assert.equal(queries.length,2);assert.match(queries[0],/IRI_RANK/);assert.doesNotMatch(queries[1],/IRI_RANK/);
});
test('DOMException code 23 is normalized rather than echoed as an apparent duration',()=>{
  const timeout=new DOMException('The operation was aborted due to timeout','TimeoutError');
  const wrapped=new errors.UpstreamTransportError(timeout);
  const message=errors.describeUpstreamError(wrapped);
  assert.match(message,/timed out/);assert.doesNotMatch(message,/: 23/);
});

test('Sheet preferences persist independently, reject invalid inputs, and are not capped at the old defaults',()=>{
 const stored=new Map();const prefs=load('src/lib/bnode/limits.ts',{'@/lib/maestro-storage':{maestroStorageGet:key=>stored.get(key),maestroStorageSet:(key,value)=>stored.set(key,value)}});
 assert.equal(JSON.stringify(prefs.readBlankNodeRecordLimits()),JSON.stringify({window:100,rows:2000,responseMiB:8}));
 const selected={window:350,rows:18000,responseMiB:32};prefs.writeBlankNodeRecordLimits(selected);
 assert.equal(JSON.stringify(prefs.readBlankNodeRecordLimits()),JSON.stringify(selected));
 for(const invalid of [0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>prefs.writeBlankNodeRecordLimits({...selected,window:invalid}));
 assert.throws(()=>prefs.writeBlankNodeRecordLimits({...selected,responseMiB:Number.MAX_SAFE_INTEGER}));
 assert.equal(JSON.stringify(prefs.readBlankNodeRecordLimits()),JSON.stringify(selected));
});
test('configured seed window, sibling window, row and byte budgets are sent end to end',async()=>{
 const bodies=[];const limits={window:350,rows:18000,responseMiB:32};
 const {loadBlankNodeRecord}=fixture(async(url,opts)=>{bodies.push(JSON.parse(opts.body));return result();},{limits});
 const signal=new AbortController().signal;
 await loadBlankNodeRecord(input(signal,{queryXml:'<query><view limit="500"/></query>'}));
 assert.match(bodies[0].query,/LIMIT 350/);assert.match(bodies[0].query,/LIMIT 18000$/);assert.equal(bodies[0].maxResponseBytes,32*1024*1024);
 await loadBlankNodeRecord(input(signal,{expansion:{kind:'uri',parent:'urn:parent',page:1}}));
 assert.match(bodies[1].query,/LIMIT 350 OFFSET 350/);
 limits.window=3;limits.rows=7;limits.responseMiB=1;
 const lower=await loadBlankNodeRecord(input(signal));assert.match(bodies[2].query,/LIMIT 3/);assert.match(bodies[2].query,/LIMIT 7$/);assert.equal(bodies[2].maxResponseBytes,1024*1024);assert.equal(lower.incomplete,true);
});
test('different byte budgets must not share pending request-scoped responses',async()=>{
 const calls=[];const limits={window:30,rows:100,responseMiB:8};
 const {loadBlankNodeRecord}=fixture((url,opts)=>new Promise(resolve=>calls.push({opts,resolve})),{limits});
 const signal=new AbortController().signal;
 const first=loadBlankNodeRecord(input(signal));limits.responseMiB=16;const second=loadBlankNodeRecord(input(signal));
 assert.equal(calls.length,2);assert.equal(JSON.parse(calls[0].opts.body).maxResponseBytes,8*1024*1024);assert.equal(JSON.parse(calls[1].opts.body).maxResponseBytes,16*1024*1024);
 calls.forEach(call=>call.resolve(result()));await Promise.all([first,second]);
});
test('byte ceiling failure reports the configurable Sheet limit without retry',async()=>{
 let calls=0;const {loadBlankNodeRecord}=fixture(async()=>{calls++;return new Response(JSON.stringify({code:'RESPONSE_LIMIT_EXCEEDED'}),{status:413});},{limits:{window:10,rows:100,responseMiB:16}});
 await assert.rejects(loadBlankNodeRecord(input(new AbortController().signal)),/16 MiB limit in the Sheet/);assert.equal(calls,1);
});
test('proxy forwards the browser byte budget and does not carry a blank-node-specific cap',()=>{
 const route=fs.readFileSync(path.join(__dirname,'..','src/app/proxy/api/sparql/route.ts'),'utf8');
 assert.match(route,/const maxResponseBytes = requestScoped \? body.maxResponseBytes : undefined/);
 assert.match(route,/Number.isSafeInteger\(maxResponseBytes\)/);assert.match(route,/readBoundedSparqlResponse\(response, maxResponseBytes\)/);assert.doesNotMatch(route,/REQUEST_SCOPED_RESPONSE_BYTES/);
 const sheet=fs.readFileSync(path.join(__dirname,'..','src/canvas/sheet/settings-pane.tsx'),'utf8');
 assert.match(sheet,/writeBlankNodeRecordLimits\(value\)/);assert.match(sheet,/Candidate \/ sibling window LIMIT/);assert.match(sheet,/Blank-node SELECT LIMIT/);assert.match(sheet,/Response size limit \(MiB\)/);
});
