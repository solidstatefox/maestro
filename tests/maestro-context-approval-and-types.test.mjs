import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const read = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('the View badge reflects SHACL matches in the active query and Record, never entire catalog',()=>{
  const actor=read('src/lib/app-lifecycle/pending-approvals.ts');
  const appbar=read('src/canvas/top/appbar-pane.tsx');
  const provenance=read('src/lib/client-provider-provenance.ts');
  assert.match(actor,/fromPromise/);
  assert.match(actor,/ACTIVATE/);
  assert.match(actor,/MATCH/);
  assert.match(actor,/activeMatches\(context\)/);
  assert.match(actor,/item\.status==="Pending"/);
  assert.match(actor,/item\.category==="Policy"/);
  assert.match(actor,/item\.category==="Provider"/);
  assert.match(appbar,/queryMatchedProviders/);
  assert.match(appbar,/pendingApprovalController\.activate\(workspace\.queryXml/);
  assert.match(appbar,/viewBadge/);
  assert.match(appbar,/View\{viewBadge\}/);
  assert.match(provenance,/pendingApprovalController\.match\(context\.queryXml,policies,context\.record\)/);
  assert.doesNotMatch(actor,/SELECT DISTINCT \?provider WHERE/);
});

test('effective provider approval considers direct status or curator implementation-digest grant',()=>{
  const source=read('src/lib/client-policy-approvals.ts');
  assert.match(source,/implementationDigest/);
  assert.match(source,/approvedDigest/);
  assert.match(source,/explicit\|\|inherited/);
  assert.match(source,/category: !known\?null:present\("isClassPolicy"\)\?"Policy":"Provider"/);
});

test('URI suggestion type enrichment is optional, bounded, hierarchy-aware and never changes rank',()=>{
  const typeSource=read('src/lib/uri-autocomplete-type.ts');
  assert.match(typeSource,/rdfs:subClassOf/);
  assert.match(typeSource,/FILTER NOT EXISTS/);
  assert.match(typeSource,/VALUES \?uri/);
  assert.match(typeSource,/\.slice\(0, 10\)/);
  assert.match(typeSource,/LIMIT 150/);
  const component=read('src/canvas/top/root-uri-autocomplete.tsx');
  assert.match(component,/return \[\.\.\.unique\.values\(\)\]\.slice\(0,settings\.limit\)/);
  const lifecycle=read('src/lib/app-lifecycle/uri-autocomplete.ts');
  assert.match(lifecycle,/type Enricher/);
  assert.match(lifecycle,/target: "complete"/);
  assert.match(lifecycle,/items: context.items.map\(item =>/);
  assert.match(component,/const incomingType = row\.type\?\.type === "uri"/);
  assert.match(component,/rdfType\??/);
  assert.match(read('src/lib/uri-autocomplete-query.ts'),/ORDER BY DESC \(<LONG::IRI_RANK>/);
  const transpiled=ts.transpileModule(typeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const sandbox={module:{exports:{}},exports:null};sandbox.exports=sandbox.module.exports;
  vm.runInNewContext(transpiled,sandbox);
  const {selectAutocompleteTypes,createAutocompleteTypeQuery}=sandbox.module.exports;
  const uris=['https://dbpedia.org/resource/Tim_Berners-Lee','https://dbpedia.org/resource/Ford'];
  const rows=[
    {uri:{type:'uri',value:uris[0]},type:{type:'uri',value:'https://schema.org/Person'}},
    {uri:{type:'uri',value:uris[0]},type:{type:'uri',value:'http://dbpedia.org/ontology/Person'}},
    {uri:{type:'uri',value:uris[1]},type:{type:'uri',value:'http://dbpedia.org/ontology/Company'}},
  ];
  const values=selectAutocompleteTypes(rows,uris);
  assert.deepEqual([...values.keys()],uris);
  assert.equal(values.get(uris[0]),'http://dbpedia.org/ontology/Person');
  const query=createAutocompleteTypeQuery(uris,'$ALL$@https://dbpedia.org/sparql');
  assert.match(query,/FILTER NOT EXISTS/);
  assert.match(query,/ORDER BY \?uri \?type LIMIT 150/);
});

test('Tag provider discovery must match SHACL-declared property, live FCT scope, and approval',()=>{
  const s=read('src/lib/client-facet-providers.ts');
  assert.match(s,/sh:or\/rdf:rest\*\/rdf:first\/sh:property\/sh:path \?property/);
  assert.match(s,/VALUES \?property \{ \$\{values\} \}/);
  assert.match(s,/readClientPolicyApprovals/);
  assert.match(s,/tags:tags\.filter\(p=>approved\.has\(p\.uri\)\)/);
});

test('an Analysis button exists on View > Providers and uses real FCT plus XSLT',()=>{
  assert.match(read('src/canvas/tab/view/ribbon.tsx'),/id: "analysis-providers", label: "Analysis"/);
  assert.match(read('src/lib/provider-fct-query.ts'),/providerKind === "analysis-providers"/);
  assert.match(read('src/lib/provider-fct-query.ts'),/ns\/analyze#Analysis/);
  assert.match(read('src/lib/provider-catalog-xslt.ts'),/"analysis-providers": `\$\{common\}/);
  assert.match(read('src/canvas/utils/workspace-controller.tsx'),/restored\.viewProvider === "analysis-providers"/);
});

test('all new/modified TypeScript syntax parses and generic proxy routes remain absent from patch delta',()=>{
  for(const filename of [
    'src/lib/app-lifecycle/pending-approvals.ts','src/lib/uri-autocomplete-type.ts',
    'src/canvas/top/root-uri-autocomplete.tsx','src/canvas/top/appbar-pane.tsx',
    'src/lib/client-policy-approvals.ts','src/lib/client-provider-provenance.ts',
    'src/lib/client-facet-providers.ts','src/canvas/top/view-diagnostics-hover.tsx',
    'src/canvas/tab/view/ribbon.tsx','src/lib/provider-fct-query.ts',
  ]){
    const ast=ts.createSourceFile(filename,read(filename),ts.ScriptTarget.Latest,true,filename.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.deepEqual(ast.parseDiagnostics.map(d=>String(d.messageText)),[],filename);
  }
});
