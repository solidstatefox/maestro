const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');

test('Categories resize uses transformed visible geometry and four keyboard-focusable edges',()=>{
  const source=read('src/canvas/left/facet-presentation.tsx');
  assert.match(source,/svg\.getScreenCTM\(\)\?\.inverse\(\)/);
  assert.match(source,/element\.closest\("defs"\)/);
  assert.match(source,/styleGroup\.getAttribute\("data-facet-label-style"\)!==labelStyle/);
  assert.match(source,/inverse\.multiply\(matrix\)/);
  assert.match(source,/svg\.setAttribute\("preserveAspectRatio","xMidYMid meet"\)/);
  assert.match(source,/`Resize Sunburst \$\{handle\} edge`[\s\S]*?appearance-none border-0 bg-transparent shadow-none/);
  assert.match(source,/setPointerCapture/);
});

test('Matches has its own top border, and Remove All uses the standard dialog footer',()=>{
  assert.match(read('src/canvas/tab/browse/results-view.tsx'),/className="border-t border-border[^"\n]*" aria-label="Matching Record properties"/);
  const source=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(source,/<AlertDialogCancel>Cancel<\/AlertDialogCancel>\s*<AlertDialogAction variant="default"[\s\S]*?removeDependents: true[\s\S]*?>Remove All<\/AlertDialogAction>/);
  assert.match(source,/expectedQueryXml: blockedReferenceDeletion.expectedQueryXml/);
});

test('Format pin gates existing per-category persistence, not current formatting',()=>{
  const ui=read('src/canvas/right/pane.tsx');
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(ui,/<ButtonGroup aria-label="Record format and pin"[^>]*>[\s\S]*?aria-label="Format record"[\s\S]*?<\/DropdownMenu>[\s\S]*?aria-pressed=\{recordFormatPinned\}/);
  assert.match(ui,/recordFormatPreferenceKey\("template"\)/);
  assert.match(controller,/recordFormatMemorySnapshot.matches\("pinned"\)/);
  assert.match(controller,/const recordFormatPreferenceKey[\s\S]*?if \(!recordFormatMemoryEnabled\(\)\) return ""/);
  assert.match(controller,/memoryLease\.pinned && memoryLease\.isCurrent\(\)/);
  assert.match(controller,/put\(recordFormatEnabled, "record-format-enabled"\)/);
});

test('Properties named result bindings produce 14 real positive-count predicates and reject blank and zero rows',()=>{
  const readModule=(file,mocks={},globals={})=>{
    const source=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const mod={exports:{}};
    new Function('module','exports','require',...Object.keys(globals),source)(mod,mod.exports,id=>{if(!(id in mocks))throw Error('Unmocked '+id);return mocks[id]},...Object.values(globals));
    return mod.exports;
  };
  const element=(localName,attributes={},textContent='',childNodes=[])=>({localName,nodeType:1,attributes:Object.entries(attributes).map(([name,value])=>({name,value})),textContent,childNodes,getAttribute:key=>attributes[key]??null,getAttributeNS:(_,key)=>attributes[key]??null});
  const column=(name,value,datatype)=>element('column',{var:name,...(datatype?{datatype}:{})},value);
  const expected=['ontology/spouse','ontology/occupation','property/name','ontology/person','property/extra','property/leaderName','property/honorificPrefix'].map(s=>'http://dbpedia.org/'+s).concat(['http://rdfs.org/ns/void#sparqlEndpoint','http://xmlns.com/foaf/0.1/isPrimaryTopicOf','http://www.w3.org/ns/prov#wasDerivedFrom','http://vocab.deri.ie/void#inDataset','http://rdfs.org/sioc/ns#container_of','http://schema.org/sameAs','http://xmlns.com/foaf/0.1/topic']);
  const rows=expected.map((uri,i)=>element('row',{},'',[
    column('sampleVal','http://example.org/sample','uri'),column('n',i===0?'2':'1'),column('c1',uri,'uri')]));
  rows.push(element('row',{},'',[element('column'),column('n','0')]));
  rows.push(element('row',{},'',[column('c1','http://example.org/zero','uri'),column('n','0')]));
  let root=element('facets',{},'',[element('complete',{},'yes'),element('result',{type:'properties'},'',rows)]);
  const label={toLabel:s=>s};
  const parser=readModule('src/canvas/utils/fct-response.ts',{
    '@/lib/fct-facet-iri':readModule('src/lib/fct-facet-iri.ts'),
    '@/lib/maestro-client-logging':{browserLog:{debug(){}}},
    '@/lib/fct-facet-normalization':readModule('src/lib/fct-facet-normalization.ts',{'./uri-labels':label}),
    '@/lib/fct-view-types':readModule('src/lib/fct-view-types.ts'),
    '@/lib/fct-query-api':{},'@/lib/uri-labels':label,'@/lib/bnode':{rdfBindingKind:d=>d==='uri'?'uri':'literal'}
  },{DOMParser:class{parseFromString(){return {documentElement:root,querySelector:()=>null}}}});
  const response=parser.parseFctResponse('fixture');
  assert.deepEqual(response.properties.map(item=>item.uri),expected);
  assert.equal(response.properties[0].count,2);
  assert.ok(response.properties.every(item=>item.count>0));
  root=element('facets',{},'',[element('complete',{},'yes'),element('result',{type:'properties'},'',[
    element('row',{},'',[column('c1',expected[0],'uri')])])]);
  assert.equal(parser.parseFctResponse('count-free fixture').properties[0].count,-1,'count-free recovery does not invent zero');
});
