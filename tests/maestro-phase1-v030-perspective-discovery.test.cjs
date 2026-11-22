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
function loadDiscovery(decisions, captured) {
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
      if(name==='@/lib/client-query-cache') return {maestroQueryFetch: async (url,args)=>{
        assert.equal(url,'/proxy/api/sparql');
        assert.equal(args.method,'POST');
        assert.equal(args.headers['Content-Type'],'application/json');
        assert.equal(args.headers['X-Maestro-Debug-Source'],'urn:maestro:component:view-discover');
        const body=JSON.parse(args.body);
        captured.push(body.query);
        return {ok:true,status:200,headers:{get:()=> 'application/sparql-results+json'},text:async()=>JSON.stringify({results:{bindings:[row]}})};
      }};
      if(name==='@/lib/proxy-debug') return {proxyDebugHeaders:(source,component)=>({
        'X-Maestro-Debug-Source':source,'X-Maestro-Debug-Component':component,
      })};
      if(name==='@/lib/personal-auth') return {loadPersonalAuthSession:async()=>({graphPrefix:'https://personal.example/u',graphStore:'https://personal.example/sparql'}),graphForPrefix:x=>x};
      if(name==='@/lib/client-policy-approvals') return {readClientPolicyApprovals:async uris=>uris.map(uri=>({uri,status:decisions}))};
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
  assert.match(queries[0],/VALUES \?provider/);
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
