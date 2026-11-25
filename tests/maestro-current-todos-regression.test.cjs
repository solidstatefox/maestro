const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const read=path=>fs.readFileSync(path,'utf8');
function load(path,deps={}){const m={exports:{}};new Function('module','exports','require',ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports,id=>{if(id in deps)return deps[id];throw Error(id)});return m.exports;}

test('pinned Bookmarks are prepended by exact RDF identity, with no additional collection enumeration',async()=>{
 const ids={bookmarks:'urn:bookmarks',history:'urn:history'},type='http://www.w3.org/1999/02/22-rdf-syntax-ns#type',bookmark='http://www.w3.org/2002/01/bookmark#Bookmark';const calls=[];
 const m=load('src/lib/client-perspective-collections.ts',{'@/lib/personal-perspective-ids':{PERSONAL_PERSPECTIVE_URI:ids},'@/lib/fct-client':{fctProjectPage:async(xml,uris)=>{calls.push([...uris]);return uris.map(uri=>({uri,properties:new Map([[type,[{value:uri==='urn:not-bookmark'?'urn:other':bookmark}]]])}));}}});
 const page=[{uri:'urn:a',title:'A'},{uri:'urn:b',title:'B'}],pins=[{uri:'urn:b',title:'Pin B'},{uri:'urn:pin',title:'Pin'},{uri:'urn:not-bookmark',title:'Other'}];
 const provider=kind=>({uri:ids[kind],stylesheet:'xsl',template:'urn:widget',label:kind,matchedClass:bookmark});
 const result=await m.loadPerspectiveCollection('bookmarks',provider('bookmarks'),'live',page,undefined,pins);
 assert.deepEqual(calls[0],['urn:b','urn:pin','urn:not-bookmark','urn:a']);assert.deepEqual(result.rows.map(row=>row.uri),['urn:b','urn:pin','urn:a']);
 const history=await m.loadPerspectiveCollection('history',provider('history'),'live',page,undefined,pins);assert.deepEqual(history.rows.map(row=>row.uri),['urn:a','urn:b']);assert.deepEqual(calls[1],['urn:a','urn:b']);
});

test('SQ074 activates only the existing optional-rank fallback; unrelated HTTP 400 does not',()=>{
 const m=load('src/lib/virtuoso-query-fallbacks.ts');
 assert.equal(m.virtuosoRankFailure('SQ074: Raw SQL access to internal RDF functions is not allowed if user does not have SPARQL_SELECT_RAW priviledge'),true);
 assert.equal(m.virtuosoRankFailure("QName 'bif:contains' uses an undefined prefix"),false);
 assert.match(read('src/app/proxy/api/fct/route.ts'),/virtuosoRankFailure\([\s\S]*?LONG::IRI_RANK/);
});

test('query health reducer retains operation-specific failure evidence and rejects stale scope outcomes',()=>{
 // Run the actual XState assign reducers without requiring the runtime dependency.
 // The separate TS test exercises the real actor under the normal project runner.
 let config;load('src/lib/app-lifecycle/graph-server-health-actor.ts',{xstate:{assign:fn=>fn,setup:()=>({createMachine:value=>{config=value;return value;}})}});
 let context=structuredClone(config.context);const send=event=>{context={...context,...config.on[event.type].actions({context,event})};};
 const endpointUrl='https://example.org/sparql',id='e';
 const query=(operation,sequence,status,scope=1,timeout=false)=>send({type:'QUERY_REPORTED',id,endpointUrl,operation,sequence,status,scope,timeout});
 const probe=()=>send({type:'PROBE_REPORTED',startedAt:100,status:{id,testedUrl:endpointUrl,state:'ok',status:200}});
 query('results',1,400);assert.equal(context.statuses.e.state,'degraded');assert.equal(context.statuses.e.status,400);probe();assert.equal(context.statuses.e.status,400);
 query('categories',2,200);assert.equal(context.statuses.e.status,400);query('results',0,200);assert.equal(context.statuses.e.status,400);
 query('results',3,200);assert.equal(context.statuses.e.state,'ok');query('results',4,400);query('results',5,200,2);query('results',6,400,1);assert.equal(context.statuses.e.state,'ok');
 query('results',7,null,2,true);assert.equal(context.statuses.e.status,null);assert.equal(context.statuses.e.state,'degraded');
});

test('new controls retain bounded dimension, exact ribbon eligibility and full Results diagnostics',()=>{
 const factory=read('src/components/ui/facet-button-factory.tsx'),workspace=read('src/canvas/utils/workspace-controller.tsx'),ribbon=read('src/canvas/tab/view/ribbon.tsx'),sun=read('src/canvas/left/facet-presentation.tsx');
 assert.match(factory,/facetButtonFactory\(icon: ReactNode\)/);assert.match(factory,/width:28,height:28,minWidth:28,minHeight:28,maxWidth:28,maxHeight:28/);assert.match(factory,/style:\{\.\.\.props.style,\.\.\.button.props.style\}/);
 assert.doesNotMatch(ribbon,/retainedPersonalKind/);assert.match(workspace,/personalPerspectiveMatchesQuery\(selectedViewUri, queryTree\) && retainedSelectedViewRef/);
 assert.match(workspace,/parseFctResponse\(rawResponse\)\.error \|\| rawResponse/);assert.doesNotMatch(workspace,/rawResponse\.slice\(0, 500\)/);
 assert.match(sun,/cx-radius.*cy-radius.*2\*radius/);assert.match(sun,/storage\.get\("dimensions"\)/);assert.match(sun,/storage\?\.set\("dimensions"/);
 assert.match(read('src/canvas/tab/view/perspective-calendar-heatmap.tsx'),/renderYearHeading=\{/);assert.doesNotMatch(read('src/canvas/tab/view/perspective-calendar-heatmap.tsx'),/CalendarHeatmapStat/);
});
