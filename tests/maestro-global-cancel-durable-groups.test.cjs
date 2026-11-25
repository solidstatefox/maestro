const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadTransportObservation}=require('./transport-test-loader.cjs');
const fs=require('node:fs');const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('global Cancel aborts existing transport and rejects new work even with no queue entries',async()=>{
 const api=loadTransportObservation();let finish,signal,calls=0;
 const p=api.observeProxyFetch('/proxy/api/sparql',{},(_url,init)=>{calls++;signal=init.signal;return new Promise(r=>finish=r);});
 api.stopProxyQueryGeneration();assert.equal(signal.aborted,true);
 await assert.rejects(api.observeProxyFetch('/proxy/api/fct',{},()=>{calls++;return Promise.resolve(new Response('wrong'));}),{name:'AbortError'});
 api.resumeProxyQueryGeneration();finish(new Response('old'));await assert.rejects(p,{name:'AbortError'});
 const res=await api.observeProxyFetch('/proxy/api/fct',{},()=>{calls++;return Promise.resolve(new Response('new'));});
 assert.equal(await res.text(),'new');assert.equal(calls,2);
});
test('durable seed assets are keyed by compiled content, with a fresh manifest',()=>{
 const build=read('src/scripts/migration/round5-static-graph-seed.mjs');const client=read('src/lib/client-graph-seed.ts');
 assert.match(build,/createHash\([^)]+\)\.update\(/);assert.match(client,/maestro-rdf-assets-v2/);assert.match(client,/force-cache.*no-store/);
});
test('registration has mandatory group and a combined RDF insert for new group plus endpoint',()=>{
 const src=read('src/lib/client-personal-graph-servers.ts');
 assert.match(src,/group: string \}/);assert.match(src,/normalizeGraphServerGroup\(input.group\)/);
 const insert=src.slice(src.indexOf('async function insertServer'),src.indexOf('export async function addPersonalGraphServer'));
 assert.equal((insert.match(/await updatePersonal\(/g)||[]).length,1);
 assert.match(insert,/existingGroups.length \? ""/);assert.match(insert,/iri\(DCT_PART\).*iri\(groupUri\)/);
});
