const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const read=p=>fs.readFileSync(p,'utf8');
test('Spider is a discoverable seeded analysis provider and declares a numeric query-validation policy',()=>{
  const manifest=JSON.parse(read('graph/manifest.json'));
  assert.equal(manifest['spider/provider.ttl'],'shacl-policies');
  const rdf=read('graph/spider/provider.ttl');
  assert.match(rdf,/a mui:Provider, ma:Analysis, sh:NodeShape/);
  assert.match(rdf,/ma:lucideIcon "chart-radar"/);
  assert.match(rdf,/numeric-query-validator> a mui:ClassPolicy, sh:NodeShape/);
  assert.match(rdf,/mui:numericCoercion "finite-lexical-v1"/);
  assert.match(rdf,/m:breadcrumbs\/m:breadcrumb/);
  assert.match(rdf,/m:results\/m:result/);
  const host=read('src/canvas/tab/analyze/page.tsx');
  assert.match(host,/pageProvider\) return <AnalyzePageProvider workspace=\{workspace\}/);
  assert.doesNotMatch(host,/SPIDER_ANALYSIS_URI|AnalyzeSpider/);
  const ui=read('src/canvas/tab/analyze/page-provider.tsx');
  assert.match(ui,/workspace\.readyAnalysisValues/);
  assert.match(ui,/<Radar /);
  assert.match(rdf,/ma:pageValidationShape/);
  assert.match(rdf,/p:finite/);
});
test('no Spider implementation in the application runtime; declared policy drives generic execution',()=>{
 for(const p of ['src/canvas/tab/analyze/page.tsx','src/canvas/tab/analyze/page-provider.tsx','src/lib/provider-page-program.ts','src/lib/client-provider-validation.ts','src/lib/app-lifecycle/provider-validation.ts','src/canvas/utils/workspace-controller.tsx'])assert.doesNotMatch(read(p),/Spider|SPIDER_ANALYSIS_URI|numeric-query-validator/i,p);
 for(const p of ['src/lib/client-spider-shacl.ts','src/lib/spider-numeric-policy.ts','src/canvas/tab/analyze/spider.tsx'])assert.equal(fs.existsSync(p),false);
 const host=read('src/canvas/tab/analyze/page-provider.tsx');assert.match(host,/workspace\.perspectivePageReady/);assert.match(host,/workspace\.readyAnalysisValues/);assert.match(host,/\[controller,key\]/);assert.match(host,/state\.phase==="ready"&&state\.program\?\.radar/);
 const discovery=read('src/lib/personal-sparql-reads.ts');assert.match(discovery,/OPTIONAL \{ \?uri ma:pageValidationShape \?pageValidationShape \}/);assert.match(discovery,/approved\.has\(row\.uri\)/);
 const policy=read('src/lib/client-provider-validation.ts');assert.match(policy,/snapshot\.seedRevision,revision,shape/);assert.match(policy,/validateClientShaclRows/);
});
