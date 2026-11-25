const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {webcrypto}=require('node:crypto');
const mui='gttp://ggg.maestro.ecosys/ns/ui#',rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#',sh='http://www.w3.org/ns/shacl#';
const prefix='https://example.test/home/user',base=prefix+'/query',graph=base+'/shacl/policies';
const provider='urn:seed:provider',shape='urn:seed:shape',template='urn:seed:template';
const named=value=>({termType:'NamedNode',value}),lit=value=>({termType:'Literal',value});
const triple=(s,p,o)=>({subject:named(s),predicate:named(p),object:o});
const stylesheet='<xsl:stylesheet version="3.0"/>';
const triples=[triple(provider,rdf+'type',named(mui+'Provider')),triple(provider,mui+'accepts',named(shape)),triple(provider,mui+'widget',named(template)),triple(shape,sh+'class',named('http://www.w3.org/ns/dcat#DataService')),triple(template,rdf+'value',lit(stylesheet))];
const term=(value,type='uri')=>({value,type});
const row=(g,d)=>({graph:term(g),...(d?{digest:term(d,'literal')}:{})});
const load=(file,imports={},globals={})=>{const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module:mod,exports:mod.exports,require:id=>{assert.ok(id in imports,id);return imports[id]},crypto:webcrypto,TextEncoder,AbortSignal,...globals},{filename:file});return mod.exports;};
function fixture({failRead=false,failWrite=false,wrongTemplate=false}={}) {
 const calls=[],writes=[];let marker='',desired='',invalidations=0;
 const session={username:'user',graphPrefix:prefix};
 const ctx={session,base,addr:base+'@https://example.test/sparql-auth'};
 const registry={SHACL_POLICIES:'shacl/policies',ONTOLOGY_CACHE:'ontology-cache',STATE_MACHINES:'state-machines',OTC_TRANSCODERS:'otc/transcoders',GRAPHS:'graphs'};
 const doc={file:'example.ttl',destination:'shacl/policies',digest:'sha256:'+'a'.repeat(64),triples};
 const guard=load('src/lib/personal-update-graph-guard.ts');
 const readGuard=load('src/lib/sparql-read-guard.ts');
 const api=load('src/lib/client-graph-seed.ts',{
  '@/lib/constants/graphs':{GRAPH:registry,resolveGraph:(k,b)=>b+'/'+k},
  '@/lib/client-personal-sparql':{personalContext:async()=>ctx,
   selectPersonal:async(query,context,signal,source)=>{assert.equal(context,ctx);signal?.throwIfAborted();assert.ok(readGuard.isBoundedReadOnlySparql(query,100000));calls.push(source);if(failRead)throw Error('read failed');
    if(source==='GraphSeed:VerifyDefinitions')return triples.filter(t=>[mui+'accepts',mui+'widget',sh+'class',rdf+'value'].includes(t.predicate.value)&&query.includes(`(<${t.subject.value}> <${t.predicate.value}>)`)).map(t=>({s:term(t.subject.value),p:term(t.predicate.value),o:term(wrongTemplate&&t.predicate.value===rdf+'value'?'stale RecordProject':t.object.value,t.object.termType==='Literal'?'literal':'uri')}));
    return [row(graph,marker)];},
   updatePersonal:async(update,signal,_bookmark,source,expectedSession)=>{assert.equal(expectedSession,session);signal?.throwIfAborted();calls.push(source);writes.push(update);const inspected=guard.inspectPersonalUpdateGraphs(update);assert.ok(!inspected.hasImplicitGraph);assert.ok(inspected.graphs.every(g=>g===graph));assert.ok(guard.hasExplicitPersonalUpdateTemplates(inspected.structure));assert.doesNotMatch(update,/CLEAR\s/);if(failWrite)throw Error('write failed');if(update.startsWith('DELETE WHERE'))marker='';if(update.startsWith('INSERT DATA')&&update.includes(mui+'seedDigest'))marker=desired;}
  },
  '@/lib/status-machine-client':{invalidateClientStatusMachines:()=>invalidations++},
  '@/lib/bnode':{createBlankNodeLabelAllocator:()=>x=>x},
  '@/lib/personal-status-vocabulary':{MUI_NS:mui},
  '@/lib/personal-auth':{graphForPrefix:p=>p+'/query'},
  '@/lib/graph-seed-content-digest':load('src/lib/graph-seed-content-digest.ts'),
 },{fetch:async url=>({ok:true,json:async()=>url.endsWith('manifest.json')?[{file:doc.file,destination:doc.destination,asset:'a'.repeat(64)+'.json'}]:doc})});
 return {api,calls,writes,async prepare(){const plan=await api.preparePersonalSeed(prefix);desired=plan.desired.get(graph);return plan;},setMarker:value=>marker=value,invalidations:()=>invalidations};
}
test('seed digest SELECT distinguishes a missing marker from missing evidence',async()=>{
 const {api,prepare}=fixture();const plan=await prepare();assert.match(plan.query,/SELECT \?graph \?digest WHERE \{ VALUES \?graph/);assert.match(plan.query,/OPTIONAL/);
 assert.equal(api.parseSeedDigests([row(graph)],[graph]).get(graph),'');
 assert.throws(()=>api.parseSeedDigests([],[graph]),/Incomplete/);
 assert.throws(()=>api.parseSeedDigests([row(graph),row(graph)],[graph]),/conflicting/);
 assert.throws(()=>api.parseSeedDigests([row(graph,'not-a-digest')],[graph]),/Invalid/);
});
test('initial authenticated rows are reused, scoped writes verify definitions before committing marker',async()=>{
 const f=fixture(),plan=await f.prepare();const result=await f.api.seedPersonalGraphs(undefined,plan,[row(graph)]);
 assert.equal(result.revision,plan.revision);assert.deepEqual([...result.changedGraphs],[graph]);assert.equal(f.invalidations(),1);
 assert.ok(!f.calls.includes('GraphSeed:CheckDigests'));assert.ok(f.writes[0].startsWith('DELETE WHERE'));
 assert.match(f.writes[1],/VALUES \(\?s \?p\)/);assert.ok(f.writes[1].includes(`<${template}> <${mui}templateContent>`));assert.ok(!f.writes[1].includes('urn:user:provider'));
 assert.ok(f.calls.indexOf('GraphSeed:VerifyDefinitions')<f.calls.lastIndexOf('GraphSeed:Synchronize'));assert.equal(f.calls.at(-1),'GraphSeed:VerifyDigests');
 f.writes.length=0;f.calls.length=0;const unchanged=await f.api.seedPersonalGraphs(undefined,plan);assert.equal(unchanged.changedGraphs.length,0);assert.equal(f.writes.length,0);assert.deepEqual(f.calls,['GraphSeed:CheckDigests']);
});
test('failed, incomplete or cancelled reads never cause graph writes',async()=>{
 const f=fixture({failRead:true}),plan=await f.prepare();await assert.rejects(f.api.seedPersonalGraphs(undefined,plan),/read failed/);assert.equal(f.writes.length,0);
 await assert.rejects(f.api.seedPersonalGraphs(undefined,plan,[]),/Incomplete/);assert.equal(f.writes.length,0);
 const controller=new AbortController();controller.abort();await assert.rejects(f.api.seedPersonalGraphs(controller.signal,plan,[row(graph)]));assert.equal(f.writes.length,0);
});
test('failed updates and wrong remote template prevent completion marker',async()=>{
 for(const [options,pattern] of [[{failWrite:true},/write failed/],[{wrongTemplate:true},/verification failed/]]){
  const f=fixture(options),plan=await f.prepare();await assert.rejects(f.api.seedPersonalGraphs(undefined,plan,[row(graph)]),pattern);
  assert.ok(!f.writes.some(q=>q.startsWith('INSERT DATA')&&q.includes(mui+'seedDigest')));assert.equal(f.invalidations(),0);
 }
});

 test('the distributed provider RDF includes DCAT and the independent EU Perspective literal',()=>{
  const rdf=fs.readFileSync('graph/maestro-widget-providers.ttl','utf8');
  assert.match(rdf,/mui:accepts <gttp:\/\/ggg\.maestro\.ecosys\/shacl\/provider\/entrypoint-input>,\s*<gttp:\/\/ggg\.maestro\.ecosys\/shacl\/provider\/dcat-service-input>,\s*<gttp:\/\/ggg\.maestro\.ecosys\/shacl\/provider\/dcat-distribution-input>/);
  const eu=fs.readFileSync('graph/eu-data/provider.ttl','utf8');
  const perspective=eu.match(/<gttp:\/\/ggg\.maestro\.ecosys\/eu-data\/widget#Perspective>\s+a[\s\S]*?(?:rdf:value|mui:templateContent)\s+"""([\s\S]*?)"""/);
  assert.ok(perspective,'Perspective has its own stylesheet');
  assert.match(perspective[1],/xsl:stylesheet/);assert.doesNotMatch(perspective[1],/RecordProject/);
});
