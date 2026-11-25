const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p,deps){const m={exports:{}};new Function('module','exports','require',ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports,id=>{if(id in deps)return deps[id];throw Error(id)});return m.exports;}
test('page projection joins transported and direct columns by allocated node IDs, preserving all page resources and order',async()=>{
 const calls=[];let bound=[];
 const m=load('src/lib/fct-client.ts',{'@/lib/constants/graphs':{},'@/lib/client-query-cache':{cachedFetchFct:async(url,init)=>{calls.push({url,init});return new Response('xml')}},'@/lib/client-personal-sparql':{},'@/lib/fct-status-projection':{},'@/lib/fct-sparql-translator':{},'@/lib/client-provider-provenance':{},'@/lib/upstream-error':{},'@/lib/fct-query-clone':{},'@/canvas/utils/fct-response':{mergeValuesQueryClone:(xml,cols,terms,ids)=>{assert.equal(xml,'live');bound=terms;ids.push('a','b','c');return 'clone'},parseFctResponse:()=>({results:[],incomplete:false}),parseListValuesXml:()=>new Map(bound.map(({value})=>[value,[{id:'c',values:[{value:'direct2'}]},{id:'a',values:[{value:'transported'}]},{id:'b',values:[{value:'direct1'}]}]]))}});
 const columns=[{property:'urn:p',path:['urn:hop','urn:p'],direction:'forward'},{property:'urn:p',direction:'forward'},{property:'urn:q',direction:'forward'}];
 const resources=Array.from({length:101},(_,i)=>`urn:row:${i}`);
 const rows=await m.fctProjectPage('live',resources,columns);
 assert.deepEqual(rows.map(row=>row.uri),resources);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url==='/proxy/api/fct'&&c.init.body==='clone'));
 assert.equal(rows[0].properties.get('forward|urn:hop/urn:p')[0].value,'transported');assert.equal(rows[0].properties.get('forward|urn:p')[0].value,'direct1');assert.equal(rows[0].properties.get('forward|urn:q')[0].value,'direct2');
 assert.deepEqual(await m.fctProjectPage('live',[],columns),[]);assert.equal(calls.length,2);
});
test('saved-entry rendering uses approved provider and page order, never adds a row from enrichment',async()=>{
 const ids={bookmarks:'urn:bookmarks',history:'urn:history'};let calls=0;
 const m=load('src/lib/client-perspective-collections.ts',{'@/lib/personal-perspective-ids':{PERSONAL_PERSPECTIVE_URI:ids},'@/lib/fct-client':{fctProjectPage:async(xml,uris,columns,signal)=>{calls++;assert.equal(xml,'live');assert.deepEqual(uris,['urn:b','urn:a']);return [{uri:'urn:a',properties:new Map([['http://purl.org/dc/terms/title',[{value:'A'}]]])},{uri:'urn:outside',properties:new Map()}]}}});
 const page=[{uri:'urn:b',title:'B'},{uri:'urn:a',title:'fallback'}];
 for(const kind of ['bookmarks','history']){const result=await m.loadPerspectiveCollection(kind,{uri:ids[kind],stylesheet:'xsl',template:'urn:widget',label:kind,matchedClass:'urn:class'},'live',page);assert.deepEqual(result.rows.map(row=>[row.uri,row.label]),[['urn:b','B'],['urn:a','A']]);}
 assert.equal(calls,2);
});
test('all ribbon rendering waits for committed live results; appbar indicator and cursor use actual readiness',()=>{
 const w=read('src/canvas/utils/workspace-controller.tsx'), page=read('src/canvas/tab/view/page.tsx'),app=read('src/canvas/top/appbar-pane.tsx'),access=read('src/lib/app-lifecycle/access.ts');
 assert.match(w,/const perspectivePageReady = !isSearching[\s\S]*?committedResultsOperation === operationQueryKey/);assert.match(w,/if \(!perspectivePageReady\)/);assert.match(w,/const viewPageKey = JSON\.stringify\(visibleResultsPage\.map/);assert.match(w,/projectGraphServerPage\(queryXml, visibleResultsPage\.filter/);assert.doesNotMatch(page,/Discovered data services|dcatDiscovery|nativeGraphServerPerspective/);assert.match(page,/pageRows=\{pageUriRows\}/);
 assert.match(access,/policyReady \? "green" : "pulsingGreen"/);assert.match(app,/pulsingGreen:"bg-emerald-500 animate-pulse/);assert.match(app,/canUsePersonalStore \? "cursor-pointer" : "cursor-default"/);assert.match(app,/value="publish" disabled className="cursor-default"/);
});
