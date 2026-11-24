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
function loadDiscovery(decisions, captured, fixtureRows) {
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
      if(name==='@/lib/upstream-error') return {describeUpstreamError: error => String(error?.message ?? error), sanitizeUpstreamDiagnostic: text => String(text)};
      throw new Error('unexpected require: '+name);
    },
  };
  vm.runInNewContext(transpiled,context,{filename:'personal-sparql-reads.ts'});
  return module.exports.discoverViews;
}
test('Graph Servers can match population classes, not merely explicit FCT class constraints', {skip:!ts}, async()=>{
  const queries=[];
  const views=await loadDiscovery('Approved',queries)([klass]);
  assert.equal(views.length,1);
  assert.equal(views[0].uri,provider);
  assert.equal(views[0].matchedClass,klass);
  assert.equal(queries.length,1);
  assert.match(queries[0],/\?inputShape \(sh:class\|sh:targetClass\) \?matchedClass/);
  assert.match(queries[0],/VALUES \?matchedClass/);
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
  assert.match(queries[0],/\?provider IN \(/);
  assert.doesNotMatch(queries[0],/VALUES \?matchedClass/);
});
test('RDF Graph Servers widget is a Perspective and remains a CardGrid',()=>{
  const ttl=source('graph/maestro-widget-providers.ttl');
  assert.match(ttl,/<gttp:\/\/ggg\.maestro\.ecosys\/shacl\/view#EntryPointCards> a mui:CardGridWidget, mui:PerspectiveWidget/);
});
test('View discovery uses current FCT Categories evidence and scoped XState result, not a React copy',()=>{
  const w=source('src/canvas/utils/workspace-controller.tsx');
  assert.match(w,/classFacetsResultKey === JSON\.stringify\(\[classFacetQueryXml, queryGraphServer, queryRefreshRevision\]\)/);
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
  assert.match(w,/viewRenderResult\.key === viewRenderInputKey \? viewRenderResult\.html : ""/);
  assert.match(w,/setViewRenderResult\(\{ key: viewRenderInputKey, html, error: "" \}\)/);
  assert.match(page,/personalKind && !viewProvider[\s\S]*?<PersonalPerspectives key=\{selectedViewUri\}/);
  assert.match(ribbon,/const title = view\.label/);
  assert.match(w,/viewDiscoveryController\.cancel\(\)/);
  assert.doesNotMatch(w,/setViewDiscoveryLoading\(/);
});
