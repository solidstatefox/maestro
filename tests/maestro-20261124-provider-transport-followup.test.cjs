const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(p, deps={}) {
 const module={exports:{}};
 const compiled=ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('module','exports','require',compiled)(module,module.exports,id=>{if(id in deps)return deps[id];throw Error('Unexpected dependency '+id);});
 return module.exports;
}
test('proxy failures and upstream HTTP evidence are independent; cancellation is not an outage',async()=>{
 const m=load('src/lib/proxy-transport-observation.ts');
 await assert.rejects(m.observeProxyFetch('/proxy/api/fct',{},async()=>{throw new TypeError('Failed to fetch');}),/Maestro proxy unavailable/);
 assert.equal(m.lastProxyTransportObservation().state,'unavailable');
 const proxy=await m.observeProxyFetch('/proxy/api/sparql',{},async()=>new Response('',{status:502}));
 assert.equal(m.lastProxyTransportObservation().state,'reachable');
 assert.equal(m.observedUpstreamStatus(proxy),null);
 assert.equal(m.observedUpstreamStatus(new Response('',{status:502,headers:{'X-Maestro-Upstream-Source':'network','X-Maestro-Upstream-Status':'401'}})),401);
 const controller=new AbortController();controller.abort();
 await assert.rejects(m.observeProxyFetch('/proxy/api/fct',{signal:controller.signal},async()=>{throw controller.signal.reason;}),{name:'AbortError'});
 assert.equal(m.lastProxyTransportObservation().state,'reachable');
});
test('upstream transport wrapper preserves cause without confusing cancellation',async()=>{
 const m=load('src/lib/upstream-error.ts');const cause=new Error('ECONNREFUSED');
 await assert.rejects(m.withUpstreamTransport(async()=>{throw cause;}),e=>e instanceof m.UpstreamTransportError && e.cause===cause);
 const c=new AbortController();c.abort();await assert.rejects(m.withUpstreamTransport(async()=>{throw cause;},c.signal),e=>e===cause);
});
test('personal facet queue residence is not the upstream execution deadline',()=>{
 const m=load('src/lib/personal-facet-deadline.ts',{'./maestro-query-execution-clock':{}});
 assert.equal(m.personalFacetDeadlineReason(0,60000,20000),null);
 assert.equal(m.personalFacetDeadlineReason(20000,65000,20000),null);
 assert.match(m.personalFacetDeadlineReason(50000,65000,20000),/no Anytime response received/);
 assert.match(m.personalFacetDeadlineReason(0,320000,20000),/queue/);
});
test('DCAT discovery enriches only the bound Results page and never contacts candidates',async()=>{
 const calls=[];
 const m=load('src/lib/client-endpoint-discovery.ts',{'./fct-client':{fctProjectPage:async(xml,uris,columns,signal)=>{calls.push({xml,uris,columns,signal});return uris.map(uri=>({uri,properties:new Map([['http://www.w3.org/ns/dcat#endpointURL',[{value:'https://example.org/sparql'}]],['http://purl.org/dc/terms/title',[{value:'Example',lang:'en'}]],['http://purl.org/dc/terms/conformsTo',[{value:'SPARQL'}]]])}));}},'./graph-server-directory':{validGraphServerUrl:s=>s.startsWith('https://')?s:null}});
 const xml='<query addr="@https://source.example/sparql"><view type="list"/></query>',uris=['https://source.example/service'];
 const signal=new AbortController().signal;
 const result=await m.projectGraphServerPage(xml,uris.map(uri=>({uri,title:"fallback"})),[],true,signal);
 assert.equal(result.length,1);assert.equal(result[0].title,'Example');assert.equal(result[0].likelySparql,true);
 assert.deepEqual(result[0].services,uris);
 assert.equal(calls.length,1);assert.equal(calls[0].xml,xml);assert.deepEqual(calls[0].uris,uris);assert.equal(calls[0].signal,signal);assert.equal(calls[0].columns.length,10);
});
test('Record auto formatting and automatic header collapse are gated by the Format pin',()=>{
 const browse=read('src/canvas/utils/workspace-controller.tsx'),pivot=read('src/canvas/controllers/record-session-controller.tsx');
 assert.match(browse,/policies\.find\(policy => policy\.templates\.length > 0\)/);
 assert.match(browse,/setRecordFormatEnabled\(Boolean\(preferredTemplate\)\)/);
 assert.match(browse,/!preview && !enrichLinkedResources && !localRerender && formatMode\.ready && !formatMode\.pinned && formatMode\.isCurrent\(\)/);
 assert.match(browse,/const recordFormatPreferenceLoaded = !recordFormatMemorySnapshot\.matches\("restoring"\)/);
 assert.match(pivot,/setFormatEnabled\(Boolean\(template\)\)/);
 assert.match(pivot,/formatMode\.ready && !formatMode\.pinned && formatMode\.isCurrent\(\)/);
 assert.match(pivot,/memoryLease\.isCurrent\(\) && \(saved \|\| savedTemplate === ""\)/);
 assert.match(pivot,/own\.recordPolicyCheckedUri !== selectedUri/);
 const pane=read('src/canvas/right/pane.tsx');
 assert.match(pane,/if \(currentChoice\) manualRecordFormatSelectionRef\.current = currentChoice;/);
});
test('DCAT and native EntryPoint preserve page membership even with the same endpoint; labels join by dataset identity',async()=>{
 const d='http://www.w3.org/ns/dcat#',t='http://purl.org/dc/terms/',s='https://schema.org/',rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
 const url='https://example.org/sparql',other='https://other.example/query';
 const registry=[{id:'existing',url,label:'Registered',group:'Shared'},{id:'wrong',url:'https://unrelated.example/sparql',label:'Service',group:'Shared'}];
 const props=entries=>new Map(entries.map(([p,...values])=>[p,values.map(value=>typeof value==='string'?{value}:value)]));
 const page=[{uri:'urn:native',title:'Registered'},{uri:'urn:eu',title:'Service'},{uri:'urn:distribution',title:'Distribution'},{uri:'https://catalog.example/no-url',title:'Missing URL'}];
 const records=[{uri:'urn:native',properties:props([[rdf,s+'EntryPoint'],[s+'url',url]])},{uri:'urn:eu',properties:props([[rdf,d+'DataService'],[d+'endpointURL',url,other],[t+'title',{value:'Titel',lang:'de'},{value:'Service',lang:'en'}],[t+'description','European data'],[t+'conformsTo','SPARQL'],[d+'servesDataset','urn:dataset','urn:dataset2','urn:dataset3','urn:dataset4']])},{uri:'urn:distribution',properties:props([[d+'accessURL',url,'javascript:alert(1)'],[d+'servesDataset','urn:dataset2']])},{uri:'urn:outside',properties:props([[d+'endpointURL','https://outside.example/sparql']])}];
 let reads=0;const m=load('src/lib/client-endpoint-discovery.ts',{'./fct-client':{fctProjectPage:async(xml,uris)=>{reads++;if(reads===1){assert.deepEqual(uris,page.map(row=>row.uri));return records;}assert.deepEqual(uris,['urn:dataset','urn:dataset2','urn:dataset3']);return [{uri:'urn:dataset2',properties:props([[t+'title','Second']])},{uri:'urn:dataset',properties:props([[t+'title',{value:'Deutsch',lang:'de'},{value:'First',lang:'en'}]])}];}},'./graph-server-directory':{validGraphServerUrl:value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.toString():null;}catch{return null;}}}});
 const signal=new AbortController().signal;
 const rows=await m.projectGraphServerPage('live',page,registry,true,signal);
 assert.deepEqual(rows.map(row=>row.uri),page.map(row=>row.uri));assert.deepEqual(rows.map(row=>row.endpoint),[url,url,url,'']);assert.equal(rows[0].endpointId,'existing');assert.equal(rows[1].endpointId,'existing');assert.equal(rows[1].title,'Service');assert.equal(rows[1].description,'European data');assert.deepEqual(rows[0].services,['urn:native']);assert.deepEqual(rows[1].services,['urn:eu']);assert.deepEqual(rows[2].datasetLabels,['Second']);assert.equal(m.compactDatasetLabels(rows[1]),'First · Second · urn:dataset3 · +1 more');assert.deepEqual(rows[1].standards,['SPARQL']);assert.equal(rows[3].title,'Missing URL');
 assert.equal(reads,2);const native=await m.projectGraphServerPage('live',[page[0]],registry,false,signal);assert.equal(native[0].endpoint,url);assert.equal(reads,2);
 const promoted=m.prependSelectedGraphServer(rows,registry[0]);assert.deepEqual(promoted.map(row=>row.uri),page.map(row=>row.uri));
 const moved=m.prependSelectedGraphServer([rows[3],...rows.slice(0,3)],registry[0]);assert.deepEqual(moved.map(row=>row.uri),[rows[0].uri,rows[3].uri,rows[1].uri,rows[2].uri]);
 const added=m.prependSelectedGraphServer(rows,registry[1]);assert.equal(added.length,5);assert.equal(added[0].endpoint,registry[1].url);assert.deepEqual(added.slice(1).map(row=>row.uri),page.map(row=>row.uri));
});
test('five pages sharing an endpoint retain all 20 resource identities per page',()=>{
 const m=load('src/lib/client-endpoint-discovery.ts',{'./fct-client':{},'./graph-server-directory':{validGraphServerUrl:s=>s.startsWith('https://')?s:null}});
 for(let pageIndex=0;pageIndex<5;pageIndex++){
  const page=Array.from({length:20},(_,i)=>({uri:`urn:service:${pageIndex*20+i}`,title:'SPARQL Endpoint'}));
  const records=page.map(({uri})=>({uri,properties:new Map([['http://www.w3.org/ns/dcat#endpointURL',[{value:'https://example.org/sparql'}]]])}));
  const rows=m.normalizeGraphServerPage(page,records,[],true);
  assert.equal(rows.length,20);assert.deepEqual(rows.map(row=>row.uri),page.map(row=>row.uri));assert.ok(rows.every(row=>row.services.length===1));
 }
});
test('dataset labels are optional, bounded, and never survive cancellation',async()=>{
 const d='http://www.w3.org/ns/dcat#';const uri='https://catalog.example/resource';const dataset='https://catalog.example/dataset/'+ 'x'.repeat(100);
 let reads=0;const m=load('src/lib/client-endpoint-discovery.ts',{'./fct-client':{fctProjectPage:async()=>{reads++;if(reads%2===0)throw Error('optional label lookup failed');return [{uri,properties:new Map([[d+'endpointURL',[{value:'https://example.org/sparql'}]],[d+'servesDataset',[{value:dataset}]]])}];}},'./graph-server-directory':{validGraphServerUrl:s=>s.startsWith('https://')?s:null}});
 const rows=await m.projectGraphServerPage('live',[{uri,title:'Service'}],[],true,new AbortController().signal);assert.equal(rows.length,1);assert.equal(rows[0].uri,uri);assert.deepEqual(rows[0].datasets,[dataset]);assert.ok(m.compactDatasetLabels(rows[0]).length<dataset.length);
 const controller=new AbortController();controller.abort();await assert.rejects(m.projectGraphServerPage('live',[{uri,title:'Service'}],[],true,controller.signal),{name:'AbortError'});
});
test('Graph Servers renders one original XSLT grid and uses the same committed rows for health and registration',()=>{
 const page=read('src/canvas/tab/view/page.tsx'),controller=read('src/canvas/utils/workspace-controller.tsx'),view=read('src/canvas/tab/view/view-components.tsx'),xsl=read('graph/maestro-entrypoint-view.ttl');
 assert.doesNotMatch(page,/Discovered data services|dcatDiscovery|nativeGraphServerPerspective/);
 assert.match(controller,/return \{ html, count: displayRows.length, graphRows \}/);assert.match(controller,/prependSelectedGraphServer\(populationGraphRows/);assert.match(controller,/graphServerViewRows: perspectivePageReady \? viewRenderResult.graphRows : \[\]/);
 assert.match(view,/GraphServerStatusHistory endpoint=\{row.endpoint\}/);assert.match(view,/onRegisterEndpoint\(\{endpoint:row.endpoint/);
 assert.match(xsl,/data-view-title="Graph Servers"/);assert.match(xsl,/@protocols/);assert.match(xsl,/@datasets/);
});
