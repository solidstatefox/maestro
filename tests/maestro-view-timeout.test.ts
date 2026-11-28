import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFctRequestTimeout, readMaestroWidgetTimeouts, writeMaestroWidgetTimeouts } from '../src/lib/maestro-query-timeouts';
import { compileFctXmlToSparql } from '../src/lib/fct-sparql-translator';
import { buildSynsetQuery, SYNSET_SETTINGS } from '../src/lib/property-synset-query';
import { predicateAnalyticsEndpointWithTimeout } from '../src/lib/predicate-analytics-upstream';
import type { FctQueryTree } from '../src/lib/fct-query';
import { readFileSync } from 'node:fs';
const base = (view:string, timeout='', nested=false, rootTimeout='20000') => `<query addr="$ALL$@https://example.org/sparql" id="a" timeout="${rootTimeout}">${nested?'<property iri="urn:property" id="b">':''}<view type="${view}" ${timeout} id="c"/>${nested?'</property>':''}</query>`;
const sources = ['Analysis:properties-rank','Analysis:properties-cluster','Analysis:clusters','PropertySynset'];
const settings = readMaestroWidgetTimeouts();
function configure(properties:number,other:number) {writeMaestroWidgetTimeouts({...settings,properties,other,results:5});}
const xmlFrom = (body:string) => body.startsWith('{') ? JSON.parse(body).queryXml as string : body;

test('all analytical views override conflicting Sheet categories, both wire formats',()=>{
 configure(5,10);
 for(const [i,view] of ['properties-rank','properties-cluster','clusters','properties-synset'].entries()){
  for (const algorithm of view==='properties-rank'?['fur','structural']:view==='properties-synset'?['relation-agreement','rulealign']:['']) {
   const xml=base(view,`timeout="120000"${algorithm?` algorithm="${algorithm}"`:''}`,true);
   for(const body of [xml,JSON.stringify({queryXml:xml,bookmarkQueryXml:'untouched',fresh:true})]) {
    const resolved=resolveFctRequestTimeout(sources[i],body);
    assert.equal(resolved.timeoutMs,120000);assert.equal(resolved.body,body);
    const compiled=compileFctXmlToSparql(xmlFrom(resolved.body));
    assert.equal(compiled.timeoutMs,120000);
    assert.equal(new URL(predicateAnalyticsEndpointWithTimeout('https://example.org/sparql?timeout=10000',compiled.timeoutMs)).searchParams.get('timeout'),'120000');
   }
  }
 }
});
test('ordinary view override, Sheet and root inheritance remain distinct',()=>{
 configure(5,10);
 const xml=base('properties','',true);
 const sheet=resolveFctRequestTimeout('Properties',xml);
 assert.equal(sheet.timeoutMs,5000);assert.equal(compileFctXmlToSparql(sheet.body).timeoutMs,5000);
 const json=resolveFctRequestTimeout('Properties',JSON.stringify({queryXml:xml,bookmarkQueryXml:xml,view:'properties'}));
 assert.equal(JSON.parse(json.body).bookmarkQueryXml,xml);assert.equal(compileFctXmlToSparql(xmlFrom(json.body)).timeoutMs,5000);
 const explicit=base('properties',"timeout='60000'",true);
 assert.equal(resolveFctRequestTimeout('Properties',explicit).body,explicit);assert.equal(compileFctXmlToSparql(explicit).timeoutMs,60000);
 configure(0,0);
 assert.equal(resolveFctRequestTimeout('Properties',xml).body,xml);assert.equal(compileFctXmlToSparql(xml).timeoutMs,20000);
 assert.equal(resolveFctRequestTimeout('Properties',explicit).timeoutMs,60000);
});
test('invalid explicit timeout fails at compiler, is never hidden by Sheet',()=>{
 configure(5,10);
 for(const invalid of ['0','999','-1','1.5','abc','','2147483648']){
  const xml=base('properties',`timeout="${invalid}"`);
  assert.equal(resolveFctRequestTimeout('Properties',xml).body,xml);
  assert.throws(()=>compileFctXmlToSparql(xml),/FCT view timeout/);
 }
});
test('comments and unrelated attributes do not override the Sheet',()=>{
 configure(5,10);
 const xml=base('properties').replace('<view','<!-- <view timeout="120000"/> --><view');
 assert.equal(resolveFctRequestTimeout('Properties',xml).timeoutMs,5000);
});
test('provider query builder sets timeout on view and preserves root/live tree',()=>{
 const tree:FctQueryTree={name:'query',attributes:{addr:'$ALL$@https://example.org/sparql',id:'a',timeout:'20000'},children:[{name:'property',id:'b',attributes:{iri:'urn:property'},children:[{name:'view',id:'c',attributes:{type:'text'},children:[]}]}]};
 const old=JSON.stringify(tree);const xml=buildSynsetQuery(tree,'relation-agreement',SYNSET_SETTINGS);
 assert.equal(JSON.stringify(tree),old);assert.match(xml,/<query[^>]*timeout="20000"/);assert.match(xml,/<view[^>]*timeout="120000"/);assert.equal(compileFctXmlToSparql(xml).timeoutMs,120000);
 const clusters=readFileSync('src/canvas/tab/analyze/predicate-clusters.tsx','utf8');assert.match(clusters,/views\[0\]\.setAttribute\("timeout", String\(settings\.timeoutMs\)\)/);assert.doesNotMatch(clusters,/query\.setAttribute\("timeout"/);
});

test('both browser transport paths resolve before dispatch, with cache separation and unchanged signal', async()=>{
 const ts=await import('typescript');
 const vm=await import('node:vm');
 const source=readFileSync('src/lib/client-query-cache.ts','utf8');
 const code=source.slice(source.indexOf('export function computeClientCacheKey('),source.indexOf('export async function getClientCachedResponse(')) + '\n' +
 source.slice(source.indexOf('async function maestroQueryFetchImpl('),source.indexOf('/** Track query requests so a live FCT change')) + '\nmodule.exports={maestroQueryFetchImpl,cachedFetchFctImpl};';
 const module={exports:{} as {maestroQueryFetchImpl:(input:string,init:RequestInit)=>Promise<Response>;cachedFetchFctImpl:(input:string,init:RequestInit)=>Promise<Response>}};
 const delivered:RequestInit[]=[];const keys:string[]=[];
 const compiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{module,exports:module.exports,Headers,URL,Request,Response,AbortSignal,JSON,
   resolveFctRequestTimeout,configuredTimeoutMs:()=>{throw new Error('generic timeout applied to FCT');},
   maestroLanguageHeader:()=> 'en',readMaestroConcurrency:()=>({}),setMaestroIncompleteResults:()=>{},
   lookupCachedResponseWithDeadline:async(key:string)=>{keys.push(key);return null;},
   monitoredProxyFetch:async(_url:string,init:RequestInit)=>{delivered.push(init);return new Response('test',{status:206});},
 });
 configure(5,10);
 const owner=new AbortController();const endpoint='/proxy/api/fct';
 for(const wrapper of [module.exports.maestroQueryFetchImpl,module.exports.cachedFetchFctImpl]){
  for(const budget of [120000,60000]){
   const body=JSON.stringify({queryXml:base('properties-rank',`timeout="${budget}"`,true)});
   await wrapper(endpoint,{method:'POST',body,signal:owner.signal,headers:{'x-maestro-debug-source':'Analysis:properties-rank','x-maestro-query-timeout-ms':'5000'}});
   const sent=delivered.at(-1)!;assert.equal(sent.body,body);assert.equal(sent.signal,owner.signal);assert.equal(new Headers(sent.headers).get('x-maestro-query-timeout-ms'),String(budget));
  }
 }
 assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);assert.match(keys[0],/::timeout=120000::/);assert.match(keys[1],/::timeout=60000::/);
});
