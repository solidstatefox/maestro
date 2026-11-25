const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
let ts;
try {ts = require('typescript');} catch {try {ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');} catch {ts = null;}}
const source = filename => fs.readFileSync(path.join(root,filename),'utf8');
const provider = 'gttp://ggg.maestro.ecosys/shacl/provider/entrypoint';
const template = 'gttp://ggg.maestro.ecosys/shacl/view#EntryPointCards';
const klass = 'https://schema.org/EntryPoint';
function loadDiscovery(decisions, captured, fixtureRows, probeProviderPopulation, returnExports = false) {
  if (!ts) throw new Error('TypeScript compiler not available');
  const transpiled = ts.transpileModule(source('src/lib/personal-sparql-reads.ts'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const module = {exports:{}};
  const row = {provider:{value:provider},matchedClass:{value:klass},template:{value:template},stylesheet:{value:'<xsl:stylesheet version="1.0"/>'},label:{value:'Graph Servers'}};
  const context = {
    module,exports:module.exports,AbortSignal,
    // Test guard: provider discovery must use the instrumented proxy transport,
    // not a direct browser fetch that would bypass queue/clock attribution.
    fetch:async()=>{throw Error('discovery bypassed maestroQueryFetch');},
    require(name){
      if(name==='@/lib/ribbon-discovery-limits') return {ribbonDiscoveryLimit:(_key,value)=>value,RIBBON_DISCOVERY_DEFAULTS:{perspectives:1000,analysis:50},readRibbonDiscoveryLimits:()=>({perspectives:1000,analysis:50})};
      if(name==='@/lib/constants/graphs') return { GRAPH:{SHACL_POLICIES:'shacl-policies',STATUS:'status',POLICY_APPROVALS:'policy-approvals',APPBAR:'appbar'}, resolveGraph:(key,base)=>base+'/'+({ 'shacl-policies':'shacl/policies',status:'status','policy-approvals':'status',appbar:'appbar'}[key]||key) };
      if(name==='@/lib/client-personal-request') return {personalAuthenticatedFetch:async(session,url,args,transport)=>{assert.equal(JSON.parse(args.body).personalRead,true);return transport(url,args);}};
      if(name==='@/lib/personal-endpoints') return {personalWriteEndpoint:()=> 'https://personal.example/sparql-auth'};
      if(name==='@/lib/client-query-cache') return {maestroQueryFetch: async (url,args)=>{
        assert.equal(url,'/proxy/api/sparql');
        assert.equal(args.method,'POST');
        assert.equal(args.headers['Content-Type'],'application/json');
        assert.equal(args.headers['X-Maestro-Debug-Source'],'urn:maestro:component:view-discover');
        const body=JSON.parse(args.body);
        captured.push(body.query);
        return {ok:true,status:200,headers:{get:()=> 'application/sparql-results+json'},text:async()=>JSON.stringify({results:{bindings:fixtureRows ?? [row]}})};
      }};
      if(name==='@/lib/proxy-debug') return {proxyDebugHeaders:(source,component)=>({
        'X-Maestro-Debug-Source':source,'X-Maestro-Debug-Component':component,
      })};
      if(name==='@/lib/personal-auth') return {loadPersonalAuthSession:async()=>({graphPrefix:'https://personal.example/u',graphStore:'https://personal.example/sparql'}),graphForPrefix:x=>x};
      if(name==='@/lib/client-policy-approvals') return {readClientPolicyApprovals:async uris=>uris.map(uri=>({uri,status:typeof decisions === "string" ? decisions : decisions[uri]}))};
      if(name==='@/lib/provider-population-probe' && probeProviderPopulation) return {probeProviderPopulation};
      if(name==='@/lib/upstream-error') return {describeUpstreamError: error => String(error?.message ?? error), sanitizeUpstreamDiagnostic: text => String(text)};
      throw new Error('unexpected require: '+name);
    },
  };
  vm.runInNewContext(transpiled,context,{filename:'personal-sparql-reads.ts'});
  return returnExports ? module.exports : module.exports.discoverViews;
}
test('Graph Servers can match population classes, not merely explicit FCT class constraints', {skip:!ts}, async()=>{
  const queries=[];
  const views=await loadDiscovery('Approved',queries)([klass]);
  assert.equal(views.length,1);
  assert.equal(views[0].uri,provider);
  assert.equal(views[0].matchedClass,klass);
  assert.equal(queries.length,1);
  assert.match(queries[0],/OPTIONAL \{ \?shapeUri sh:class \?matchedClass \}/);
  assert.match(queries[0],/OPTIONAL \{ \?shapeUri sh:targetClass \?targetClass \}/);
  assert.doesNotMatch(queries[0],/\?policy mui:status mui:Approved/);
  assert.doesNotMatch(queries[0],/\?curator mui:status/);
});
test('Only effectively Approved providers enter the View ribbon', {skip:!ts}, async()=>{
  const views=await loadDiscovery('Pending',[])([klass]);
  assert.equal(views.length,0);
});
test('Contextual SHACL targets also work without explicit classes', {skip:!ts}, async()=>{
  const queries=[];
  const views=await loadDiscovery('Approved',queries)([],undefined,[provider]);
  assert.equal(views.length,1);
  assert.match(queries[0],/\?provider a mui:Provider ; mui:widget \?template ; mui:accepts \?shapeUri/);
  assert.doesNotMatch(queries[0],/VALUES \?matchedClass/);
});
test('RDF Graph Servers widget is a Perspective and remains a CardGrid',()=>{
  const ttl=source('graph/maestro-widget-providers.ttl');
  assert.match(ttl,/<gttp:\/\/ggg\.maestro\.ecosys\/shacl\/view#EntryPointCards> a mui:CardGridWidget, mui:PerspectiveWidget/);
});
test('View discovery uses current FCT Categories evidence and scoped XState result, not a React copy',()=>{
  const w=source('src/canvas/utils/workspace-controller.tsx');
  assert.match(w,/const categoryFacetScopeKey = JSON\.stringify\(\[classFacetQueryXml, queryGraphServer, queryRefreshRevision, retryCategories\]\)/);
  assert.match(w,/const facetScopeKey = categoryFacetScopeKey;/);
  assert.match(w,/setClassFacetsResultKey\(facetScopeKey\)/);
  assert.match(w,/classFacetsResultKey === categoryFacetScopeKey/);
  assert.match(w,/classFacets\.filter\(item => Number\(item\.count\) > 0\)/);
  assert.match(w,/viewDiscoverySnapshot\.context\.key === viewDiscoveryScope/);
  assert.doesNotMatch(w,/setDiscoveredViews\(/);
  assert.doesNotMatch(w,/viewPanel === "perspectives" && !queryContextReady\)/);
});
test('Cross-library Base Tooltip + Radix Dropdown triggers do not nest native button hosts',()=>{
  const sources=['src/canvas/utils/workspace-controller.tsx','src/canvas/top/appbar-pane.tsx',
    'src/canvas/top/breadcrumb-renderers.tsx','src/components/ui/left-widget-button-tray.tsx'];
  for (const file of sources) assert.doesNotMatch(source(file), /TooltipTrigger render=\{<DropdownMenuTrigger asChild>/,
    file+' retains a two-library nested-trigger composition');
});

test('Seeded Bookmarks, Kanban and EU Data Explorer keep independent approved widget identities', {skip:!ts}, async()=>{
  const b='gttp://ggg.maestro.ecosys/shacl/provider/bookmarks-perspective';
  const k='gttp://ggg.maestro.ui/provider/kanban';
  const e='gttp://ggg.maestro.ecosys/eu-data/provider';
  const bc='http://www.w3.org/2002/01/bookmark#Bookmark', ec='http://data.europa.eu/s66#Project';
  const row=(uri,label,template,stylesheet,matchedClass)=>Object.fromEntries(Object.entries({provider:uri,label,template,stylesheet,matchedClass}).map(([name,value])=>[name,{value}]));
  const widget=(file,marker)=>{
    const candidates=[...source(file).matchAll(/"""([\s\S]*?)"""/g)].map(match=>match[1]);
    const result=candidates.find(text=>text.includes(marker)&&text.includes('xsl:stylesheet'));
    assert.ok(result,file+' contains '+marker);return result;
  };
  const br=row(b,'Bookmarks','gttp://ggg.maestro.ecosys/shacl/template#BookmarksPerspective',widget('graph/maestro-personal-perspectives.ttl','data-view-title="Bookmarks"'),bc);
  const kr=row(k,'Kanban','gttp://ggg.maestro.ecosys/shacl/template#KanbanPerspective',widget('graph/kanban/provider.ttl','data-view-title="Kanban"'),'');
  const er=row(e,'EU Data Explorer','gttp://ggg.maestro.ecosys/eu-data/widget#Perspective',widget('graph/eu-data/provider.ttl','data-view-title="EU Data Explorer"'),ec);
  const duplicate={...er,provider:{value:e+'/duplicate'},label:{value:'Other label'}};
  const unrelated=row(provider,'Graph Servers',template,'<xsl:stylesheet/>',klass);
  const decisions={[b]:'Approved',[k]:'Approved',[e]:'Approved',[e+'/duplicate']:'Approved',[provider]:'Approved'};
  const fixture=[br,kr,er,duplicate,unrelated,br];
  const bookmarkViews=await loadDiscovery(decisions,[],fixture)([bc],undefined,[k]);
  assert.equal(Array.from(bookmarkViews,v=>v.uri).join(','),[b,k].join(','));
  assert.match(bookmarkViews[0].stylesheet,/data-view-title="Bookmarks"/);
  assert.doesNotMatch(bookmarkViews[0].stylesheet,/data-kanban-column/);
  const euViews=await loadDiscovery(decisions,[],fixture)([ec],undefined,[k]);
  assert.equal(Array.from(euViews,v=>v.uri).join(','),[k,e].join(','));
  const noApproval=await loadDiscovery({...decisions,[k]:'Pending'},[],fixture)([bc],undefined,[k]);
  assert.equal(Array.from(noApproval,v=>v.uri).join(','),b);
});

test('Generic Perspective results are keyed to exact provider and query; personal collections cannot receive Kanban HTML',()=>{
  const w=source('src/canvas/utils/workspace-controller.tsx'), page=source('src/canvas/tab/view/page.tsx'), ribbon=source('src/canvas/tab/view/ribbon.tsx');
  assert.match(w,/!personalPerspectiveFromUri\(selectedView\.uri\)/);
  assert.match(w,/selectProviderCatalog\(viewRenderSnapshot, genericPerspectiveActive \? viewRenderInputKey : ""\)/);
  assert.match(w,/viewRenderController\.execute\(viewRenderInputKey, async \(signal\)/);
  assert.match(page,/personalKind && !viewProvider[\s\S]*?<PersonalPerspectives key=\{selectedViewUri\}/);
  assert.match(ribbon,/const title = view\.label/);
  assert.match(w,/viewDiscoveryController\.cancel\(\)/);
  assert.doesNotMatch(w,/setViewDiscoveryLoading\(/);
});

const dcatQuery = `<?xml version="1.0" encoding="UTF-8"?>
<query xmlns="http://openlinksw.com/services/facets/1.0" addr="@https://data.europa.eu/sparql" src="urn:maestro:providers:perspectives" id="a" ctr="382" uctr="a" rctr="q" classTree="true">
  <property iri="http://purl.org/dc/terms/conformsTo" rid="o" id="aj"><value datatype="uri" id="ak">https://www.w3.org/TR/sparql11-protocol/</value></property>
  <property iri="http://www.w3.org/ns/dcat#servesDataset" rid="p" group="true" id="al"/>
  <view type="list" limit="100" offset="0" id="ai"/>
</query>`;
test('DCAT class evidence admits Graph Servers, but an approved runtime needs positive focus evidence', {skip:!ts}, async()=>{
  const dcat='http://www.w3.org/ns/dcat#DataService', map='gttp://ggg.maestro.ui/provider/map';
  const row=fields=>Object.fromEntries(Object.entries(fields).map(([k,value])=>[k,{value}]));
  const recipes=[...source('graph/maestro-widget-providers.ttl').matchAll(/rdf:value """(PREFIX dcat:[\s\S]*?)"""/g)].map(m=>m[1]);
  assert.equal(recipes.length,2);
  const graphRows=recipes.map(endpointDiscoveryQuery=>row({provider,template,matchedClass:dcat,label:'Graph Servers',stylesheet:'<xsl:stylesheet/>',endpointDiscoveryQuery}));
  const mapRow=row({provider:map,template:'urn:map-template',label:'Map',stylesheet:'<xsl:stylesheet id="map"/>',shapeUri:'urn:map-shape',runtimePredicate:'urn:geo-predicate',queryStylesheet:'map-query',resultStylesheet:'map-result'});
  const queries=[], calls=[];
  const probe=async(...args)=>{calls.push(args); return false;};
  const views=await loadDiscovery('Approved',queries,[...graphRows,...graphRows,mapRow],probe)([dcat],undefined,[],dcatQuery);
  assert.deepEqual(Array.from(views,v=>v.uri),[provider]);
  assert.deepEqual(Array.from(views[0].endpointDiscoveryQueries),recipes);
  assert.match(queries[0], /OPTIONAL \{ \?shapeUri mui:endpointDiscoveryQuery/);
  assert.deepEqual(calls[0].slice(0,4),[dcatQuery,'urn:map-shape','map-query',map]);
  const withGeo=await loadDiscovery('Approved',[],[...graphRows,mapRow],async()=>true)([dcat],undefined,[],dcatQuery);
  assert.deepEqual(Array.from(withGeo,v=>v.uri),[provider,map]);
  const pending=await loadDiscovery({[provider]:'Approved',[map]:'Pending'},[],[...graphRows,mapRow],async()=>{throw Error('Unapproved runtime executed');})([dcat],undefined,[],dcatQuery);
  assert.deepEqual(Array.from(pending,v=>v.uri),[provider]);
  const noContext=await loadDiscovery('Approved',[],[mapRow],async()=>{throw Error('No FCT scope');})([],undefined,[]);
  assert.equal(noContext.length,0);
});

test('a completed negative revalidation cannot retain a formerly selected runtime',()=>{
  const w=source('src/canvas/utils/workspace-controller.tsx');
  assert.match(w,/if \(discoverySettled && !freshSelectedView\) retainedSelectedViewRef\.current = null/);
  assert.match(w,/discoverViews\(classes, signal, queryMatchedProvidersKey\.split/);
});


test('Code Block and ribbon use byte-identical discovery SELECTs and the personal graph address', async () => {
  const captured = [];
  const api = loadDiscovery('Approved', captured, undefined, undefined, true);
  const target = api.personalDiscoveryTarget({graphPrefix:'https://personal.example/u',graphStore:'https://personal.example/sparql'});
  assert.equal(target.addr,'https://personal.example/u/shacl/policies@https://personal.example/sparql-auth');
  await api.discoverViews([klass]);
  assert.equal(captured[0], api.buildViewDiscoverySparql(target.graphs));
  await api.discoverAnalyses([klass], undefined, [provider]);
  const analysis = api.buildAnalysisDiscoverySparql(target.graphs, [klass], [provider]);
  assert.equal(captured[1], analysis);
  assert.ok(analysis.includes(`<${klass}>`));
  assert.ok(analysis.includes(`?uri IN (<${provider}>)`));
  assert.ok(!api.buildAnalysisDiscoverySparql(target.graphs, [klass]).includes(`?uri IN (<${provider}>)`));
});

 test('configured ribbon limits are dispatched verbatim; capped responses cannot certify eligibility',async()=>{
  const captured=[];const api=loadDiscovery('Approved',captured,undefined,undefined,true);
  const target=api.personalDiscoveryTarget({graphPrefix:'https://personal.example/u',graphStore:'https://personal.example/sparql'});
  await api.discoverViews([klass],undefined,[],undefined,250);
  assert.equal(captured[0],api.buildViewDiscoverySparql(target.graphs,250));
  assert.match(captured[0],/LIMIT 250$/);
  await api.discoverAnalyses([klass],undefined,[],100);
  assert.equal(captured[1],api.buildAnalysisDiscoverySparql(target.graphs,[klass],[],100));
  assert.match(captured[1],/LIMIT 100$/);
  const capped=loadDiscovery("Approved",[],Array.from({length:25},()=>({})),undefined,true);
  await assert.rejects(capped.discoverViews([klass],undefined,[],undefined,25),/bounded result size/);
  await assert.rejects(capped.discoverAnalyses([klass],undefined,[],25),/Sheet LIMIT/);
});
