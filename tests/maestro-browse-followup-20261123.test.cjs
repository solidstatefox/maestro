const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function load(f,extra={}) {const mod={exports:{}};vm.runInNewContext(ts.transpileModule(read(f),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,Headers,Request,URL,...extra});return mod.exports;}
test('SPARQL requests require both attribution headers before network dispatch',async()=>{
 let dispatches=0;const api=load('src/lib/sparql-request-attribution.ts',{fetch:async()=>{dispatches++;return new Response('ok')}});
 for(const headers of [{},{'x-maestro-debug-source':'urn:maestro:component:RecordPolicy'},{'x-maestro-debug-component':'RecordPolicy'},{'x-maestro-debug-source':'sparql','x-maestro-debug-component':'RecordPolicy'}])assert.throws(()=>api.attributedSparqlFetch('/proxy/api/sparql',{headers}),/owning component/);
 assert.equal(dispatches,0);
 await api.attributedSparqlFetch('/proxy/api/sparql',{headers:{'x-maestro-debug-source':'urn:maestro:component:RecordPolicy','x-maestro-debug-component':'RecordPolicy'}});assert.equal(dispatches,1);
});
test('Browse widths belong to physical columns in every ordering, including saved resized widths',()=>{
 const api=load('src/canvas/browse-pane-order.ts');const sizes=[20,45,35];
 assert.deepEqual(JSON.parse(JSON.stringify(api.DEFAULT_BROWSE_PANE_SIZES)),[25,45,30]);
 for(const a of api.DEFAULT_BROWSE_PANE_ORDER)for(const b of api.DEFAULT_BROWSE_PANE_ORDER)for(const c of api.DEFAULT_BROWSE_PANE_ORDER){const order=[a,b,c];if(!api.isBrowsePaneOrder(order))continue;
   const layout=api.browseSizesInOrder(sizes,order);assert.deepEqual(JSON.parse(JSON.stringify(layout)),sizes);
   assert.deepEqual(JSON.parse(JSON.stringify(api.browseSizesInOrder(api.DEFAULT_BROWSE_PANE_SIZES,order))),[25,45,30]);
   assert.deepEqual(JSON.parse(JSON.stringify(api.browseSizesFromLayout(order,layout))),sizes);
 }
 assert.equal(api.browseSizesFromLayout(['filters','results','record'],[2,48,50]),null);assert.equal(api.browseSizesFromLayout(['filters','results'],[25,75]),null);
 assert.deepEqual(JSON.parse(JSON.stringify(api.readBrowsePaneSizes(JSON.stringify(sizes)))),sizes);
 assert.deepEqual(JSON.parse(JSON.stringify(api.readBrowsePaneSizes('{"filters":20,"results":45,"record":35}'))),[25,45,30]);
 assert.match(read('src/canvas/browse-pane-layout.tsx'), /const index = order.indexOf\(pane\)/);
});
test('explicit personal perspective entry uses Return, automatic selection does not',()=>{
 const source=read('src/canvas/utils/workspace-controller.tsx');const machine=read('src/lib/app-lifecycle/operations.ts');const ribbon=read('src/canvas/tab/view/ribbon.tsx');
 assert.match(source,/function selectPerspective\(uri: string, explicit = true\)[\s\S]*?if \(kind && explicit\)[\s\S]*?PERSONAL_PERSPECTIVE_ENTERED/);
 assert.match(machine,/PERSONAL_PERSPECTIVE_ENTERED: \{[\s\S]*?!context.returnVisible[\s\S]*?returnUrl: context.returnUrl \|\| context.pendingEntryUrl \|\| context.browseUrl/);
 assert.match(ribbon,/onSelectRef.current\(uri, false\)/);
});
test('EU Perspective and Record widgets embed their own independent stylesheets; Kanban remains registered',()=>{
 const graph=read('graph/eu-data/provider.ttl');const templates=[...graph.matchAll(/mui:templateContent """([\s\S]*?)"""/g)];
 assert.equal(templates[0][1],read('graph/eu-data/perspective.xsl'));assert.equal(templates[1][1].replace(/\\\\/g,'\\'),read('graph/eu-data/record.xsl'));assert.match(templates[0][1],/match="\/results"/);
 assert.equal(JSON.parse(read('graph/manifest.json'))['kanban/provider.ttl'],'shacl-policies');assert.match(read('graph/kanban/provider.ttl'),/sh:targetClass vfct:query/);
});
