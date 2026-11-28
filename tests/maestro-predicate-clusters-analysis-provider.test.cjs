const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');
const lib = (()=>{
  const js = ts.transpileModule(read('src/lib/predicate-clusters-provider.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',js)(()=>{throw Error('Unexpected module dependency')},module,module.exports);
  return module.exports;
})();
const column = (name,value,label='')=>({value,label,termType:name==='c1'?'uri':'literal',attributes:{var:name}});
const page=(viewType,rows)=>({viewType,rows,complete:'yes',incomplete:false});
const sample=()=>[
  page('properties-rank',[[column('c1','urn:p:a','A'),column('rank','1')],[column('c1','urn:p:b','B'),column('rank','2')],[column('c1','urn:p:c','C'),column('rank','3')]]),
  page('properties-cluster',[[column('c1','urn:p:a'),column('cluster','C1')],[column('c1','urn:p:b'),column('cluster','C1')],[column('c1','urn:p:c'),column('cluster','C2')]]),
  page('clusters',[[column('c1','C1'),column('n','2'),column('sample','urn:p:a'),column('sampleLabel','A')],[column('c1','C2'),column('n','1'),column('sample','urn:p:c'),column('sampleLabel','C')]]),
];
test('three complete flat FCT views join into global ranking and self-documenting tabs',()=>{
  const result=lib.joinPredicateClusterViews(...sample());
  assert.deepEqual(result.ranks.map(row=>[row.uri,row.rank,row.cluster]),[['urn:p:a',1,'C1'],['urn:p:b',2,'C1'],['urn:p:c',3,'C2']]);
  assert.deepEqual(result.clusters.map(item=>[item.id,item.count,item.sampleUri,item.sampleLabel]),[['C1',2,'urn:p:a','A'],['C2',1,'urn:p:c','C']]);
});
test('joins legitimate RDF URI identities that are not bare SPARQL IRIREFs',()=>{
  const pages=sample();
  const unusual='http://example.org/property/part|serial';
  for(const view of pages){
    for(const row of view.rows){
      for(const cell of row)if(cell.value==='urn:p:a')cell.value=unusual;
    }
  }
  const result=lib.joinPredicateClusterViews(...pages);
  assert.equal(result.ranks[0].uri,unusual);
  assert.equal(result.clusters[0].sampleUri,unusual);
});
test('incomplete or missing data never publishes a plausible fictitious cluster',()=>{
  for(const index of [0,1,2]){
    const pages=sample();pages[index].complete='no';assert.throws(()=>lib.joinPredicateClusterViews(...pages),/Incomplete/);
  }
  const pages=sample();pages[1].rows.pop();assert.throws(()=>lib.joinPredicateClusterViews(...pages),/disagrees|incomplete/);
});
test('duplicate ranks, incorrect cardinality, or mismatched sample URI fail closed',()=>{
  let pages=sample();pages[0].rows[1][1].value='1';assert.throws(()=>lib.joinPredicateClusterViews(...pages),/disagrees/);
  pages=sample();pages[2].rows[0][1].value='3';assert.throws(()=>lib.joinPredicateClusterViews(...pages),/cardinality/);
  pages=sample();pages[2].rows[0][2].value='urn:p:c';assert.throws(()=>lib.joinPredicateClusterViews(...pages),/sample/);
});
test('provider is seeded as approved contextual Analysis without a page validator',()=>{
  const manifest=JSON.parse(read('graph/manifest.json'));
  assert.equal(manifest['predicate-clusters/provider.ttl'],'shacl-policies');
  const rdf=read('graph/predicate-clusters/provider.ttl');
  assert.match(rdf,/a mui:Provider, ma:Analysis, sh:NodeShape/);
  assert.doesNotMatch(rdf,/ma:pageValidationShape/);
  for(const kind of lib.PREDICATE_CLUSTER_VIEW_NAMES)assert.ok(rdf.includes(`'${kind}'`));
  assert.match(rdf,/ma:stylesheet/);
});
test('the dedicated Analysis bypasses generic per-page projections and leaves live query intact',()=>{
  const workspace=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(workspace,/selectedAnalysisUri === PREDICATE_CLUSTERS_ANALYSIS_URI \|\| !analysisDefinitions/);
  const page=read('src/canvas/tab/analyze/page.tsx');
  assert.match(page,/AnalyzePredicateClusters workspace=\{workspace\}/);
  const component=read('src/canvas/tab/analyze/predicate-clusters.tsx');
  assert.match(component,/snapshotFctQueryXml\(liveQuery, "data"\)/);
  assert.match(component,/createMaestroViewDiscoveryController/);
  assert.match(component,/cachedFetchFct/);
  assert.match(component,/views\[0\]\.setAttribute\("cutoff", settings\.cutoff\.toFixed\(2\)\)/);
  assert.match(component,/Similarity cutoff/);
  assert.match(component,/maxIncidenceRows/);
  assert.match(component,/views\[0\]\.setAttribute\("max-incidence-rows", String\(settings\.maxIncidenceRows\)\)/);
  assert.doesNotMatch(component,/setQueryXml|setQueryTree|replaceHistory/);
});
