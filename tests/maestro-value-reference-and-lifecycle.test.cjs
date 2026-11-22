const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root,relative), 'utf8');
function loadTs(relative, mocks={}) {
 const js = ts.transpileModule(read(relative), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJS}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',js)(name => {
  if (Object.hasOwn(mocks,name)) return mocks[name];
  throw Error(`Unmocked ${name} from ${relative}`);
 },mod,mod.exports);
 return mod.exports;
}
const refs = loadTs('src/lib/fct-value-references.ts');
const node = (id,name,attrs={},children=[],text='') => ({id,name,attributes:attrs,children,text});
const tree = (children) => ({name:'query',attributes:{id:'a',addr:'@https://example.org/sparql'},children});
const rel = (id,iri,children=[]) => node(id,'property',{iri},children);
const value = (id,attrs={},text='') => node(id,'value',attrs,[],text);
function asParsed(item){
 const out={...Object.fromEntries(Object.entries(item.attributes).map(([k,v])=>[`@_${k}`,v]))};
 if (item.id) out['@_id']=item.id;
 if(item.text)out['#text']=item.text;
 for(const child of item.children){ const v=asParsed(child); out[child.name]=out[child.name] ? [...(Array.isArray(out[child.name])?out[child.name]:[out[child.name]]),v] : v; }
 return out;
}
function compile(sample){
 const kinds={TEXT:'text',LIST:'list',LIST_COUNT:'list-count',DESCRIBE:'describe',PROPERTIES:'properties',PROPERTIES_IN:'properties-in',CLASSES:'classes',GRAPHS:'graphs',COUNT_DISTINCT:'count-distinct',LIST_VALUES:'list-values',MERGE_VALUES:'merge-values'};
 const mocks={
  './maestro-kinds':{normalizeMaestroKind:()=>null,maestroKindSparql:()=>''},
  './fct-view-types':{FCT_VIEW_TYPES:kinds,isFctViewType:v=>Object.values(kinds).includes(v)},
  './bnode':{isBlankNodeTerm:()=>false,bnodeDescribeBounds:()=>null,RDF_REST_IRI:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
  'fast-xml-parser':{XMLValidator:{validate:()=>true},XMLParser:class{parse(){return {query:asParsed(sample)}}}},
  './fct-value-policy':{normalizeFctValue:s=>s.trim()},
  './virtuoso-numeric-coercion':{NUMERIC_LEXICAL_PATTERN:'^[-+]?\\d+$'},
  './virtuoso-full-text':{buildVirtuosoFullTextExpression:()=>null},
  './graph-address-mode':{ALL_GRAPHS:'$ALL$'},
  './fct-get-path':loadTs('src/lib/fct-get-path.ts'),
  './fct-value-references':refs,
  './maestro-language':{effectiveMaestroLanguage:()=> 'en',validMaestroLanguage:value=>value},
 };
 return loadTs('src/lib/fct-sparql-translator.ts',mocks).compileFctXmlToSparql('<query/>','list').query;
}
test('from compiles same-solution subject comparison with a stable node ID',()=>{
 const sample=tree([
  rel('b','https://example.org/friend',[value('e',{from:'d'})]),
  rel('d','https://example.org/knows'),
  node('f','view',{type:'list'}),
 ]);
 const query=compile(sample);
 assert.match(query,/BIND\(\?s1 AS \?maestroRefSubject1\)/);
 assert.match(query,/sameTerm\(\?s2, \?maestroRefSubject1\)/);
 assert.ok(!query.includes('fromView'));
});
test('a reverse-path from reference binds the incoming RDF subject, not the parent object',()=>{
 const sample=tree([rel('b','urn:test:p',[value('e',{from:'d'})]),node('d','property-of',{iri:'urn:test:reverse'}),node('f','view',{type:'list'})]);
 const sparql=compile(sample);
 assert.match(sparql,/\?s3 <urn:test:reverse> \?s1 \./);
 assert.match(sparql,/BIND\(\?s3 AS \?maestroRefSubject1\)/);
 assert.ok(!sparql.includes('BIND(?s1 AS ?maestroRefSubject1)'));
});
test('fromView compiles an independently scoped DISTINCT population without changing the live query',()=>{
 const sample=tree([
  rel('b','https://example.org/friend',[value('e',{fromView:'d'})]),
  rel('d','https://example.org/knows'),
  node('f','view',{type:'list'}),
 ]);
 const before=JSON.stringify(sample);
 const query=compile(sample);
 assert.match(query,/SELECT DISTINCT \(\?s\d+ AS \?maestroPopulation\d+\)/);
 assert.match(query,/sameTerm\(\?s2, \?maestroPopulation\d+\)/);
 assert.equal(JSON.stringify(sample),before,'live view remains unchanged');
});
test('native scalar counts and numeric domain honor from/fromView and selected graph',()=>{
 const mocks={
  './maestro-language':{effectiveMaestroLanguage:()=> 'en',validMaestroLanguage:value=>value},
  './maestro-kinds':{MAESTRO_KIND_IDS:[],normalizeMaestroKind:()=>null,maestroKindSparql:()=>''},
  './graph-address-mode':{ALL_GRAPHS:'$ALL$'},
  './fct-value-policy':{normalizeFctValue:s=>s.trim()},
  './virtuoso-full-text':{buildVirtuosoFullTextExpression:()=>null},
  './virtuoso-numeric-coercion':{guardedNumericRangeFilter:()=>'',numericFacetBinding:()=>'',NUMERIC_FACET_PROJECTION:''},
  './fct-value-references':refs,
 };
 const count=loadTs('src/lib/fct-count-sparql.ts',mocks).buildFctCountSparql;
 const sample=tree([
  rel('b','https://example.org/friend',[value('e',{fromView:'d'})]),
  rel('d','https://example.org/knows'),node('f','view',{type:'list'}),
 ]);
 sample.attributes.addr='https://example.org/graph@https://example.org/sparql';
 const query=count(sample);
 assert.ok(query, 'scalar query returned null');
 assert.match(query,/SELECT DISTINCT \(\?fct\d+ AS \?maestroPopulation\d+\)/);
 assert.match(query,/sameTerm\(\?fct1, \?maestroPopulation\d+\)/);
 assert.match(query,/GRAPH <https:\/\/example.org\/graph>/);
 const fromTree=tree([rel('b','urn:test:p',[value('c',{from:'d'})]),rel('d','urn:test:q'),node('f','view',{type:'list'})]);
 const native=count(fromTree);
 assert.match(native,/BIND\(\?fct0 AS \?maestroRefSubject1\)/);
 assert.match(native,/sameTerm\(\?fct1, \?maestroRefSubject1\)/);
});
test('reference validation rejects dangling IDs, self-dependencies, cycles and mixed sources',()=>{
 assert.throws(()=>refs.inspectFctValueReferences(tree([rel('b','urn:test:p',[value('c',{from:'missing'})])])),/missing or unsupported/);
 assert.throws(()=>refs.inspectFctValueReferences(tree([rel('b','urn:test:p',[value('c',{from:'a',fromView:'d'})]),rel('d','urn:test:q')])),/cannot use both/);
 assert.throws(()=>refs.inspectFctValueReferences(tree([rel('b','urn:test:p',[value('c',{fromView:'d'})]),rel('d','urn:test:q',[value('e',{fromView:'b'})])])),/cyclic fromView/);
});
test('deleting a referenced node is blocked; deleting a self-contained subtree is allowed',()=>{
 const withDependent=tree([rel('b','urn:test:p',[value('c',{from:'d'})]),rel('d','urn:test:q')]);
 assert.equal(refs.dependentFctValueReferences(withDependent,'d').length,1);
 assert.equal(refs.dependentFctValueReferences(withDependent,'b').length,0);
});
test('the shared FCT query API retains stable binding IDs and rejects deleting referenced paths',()=>{
 const identity=loadTs('src/lib/fct-node-identity.ts');
 const store=loadTs('src/lib/fct-query.ts',{
  react:{useMemo:x=>x,useSyncExternalStore:()=>({})},
  './fct-node-identity':identity,
  './fct-query-clone':{cloneFctQueryTree:source=>structuredClone(source)},
  './fct-query-serialize':{serializeFctQuery:()=>'<query/>'},
  './fct-value-references':refs,
 });
 const base=tree([rel('b','urn:test:p'),rel('d','urn:test:q'),node('f','view',{type:'list'})]);
 base.attributes.ctr='30';base.attributes.uctr='a';base.attributes.rctr='a';
 const first=store.fctQueryTreeApi.upsertValueBinding(base,'b',null,{text:'',attributes:{from:'d'}});
 const bound=first.children.find(n=>n.id==='b').children.find(n=>n.name==='value');
 assert.ok(bound?.id);
 assert.equal(bound.attributes.from,'d');
 const revised=store.fctQueryTreeApi.upsertValueBinding(first,'b',bound.id,{text:'',attributes:{fromView:'d'}});
 const edited=revised.children.find(n=>n.id==='b').children.find(n=>n.name==='value');
 assert.equal(edited.id,bound.id,'editing a value must not allocate a new ID');
 assert.equal(edited.attributes.fromView,'d');
 assert.throws(()=>store.fctQueryTreeApi.deleteNode(revised,'d'),/Cannot delete node/);
 const removed=store.fctQueryTreeApi.deleteNode(revised,edited.id);
 assert.equal(removed.children.find(n=>n.id==='b').children.some(n=>n.name==='value'),false);
});
test('Record XSLT numeric batch captures its document context beforehand and embedded templates stay synchronized',()=>{
 const xsl=read('graph/eu-data/record.xsl');
 const ttl=read('graph/eu-data/provider.ttl');
 const block=xsl.match(/<xsl:template name="eurio-runtime-label-queries">([\s\S]*?)<\/xsl:template>/)?.[1]??'';
 assert.match(block, /name="runtimeGraph"[^\n]+\/mctx:context/);
 assert.ok(block.indexOf('name="runtimeGraph"')<block.indexOf('xsl:for-each select="1 to'));
 assert.match(block,/name="graph" select="\$runtimeGraph"/);
 const copies=[...ttl.matchAll(/mui:templateContent """([\s\S]*?)"""/g)];
 assert.equal(copies.length,3);
 for(const item of copies.slice(0,2))assert.equal(item[1].replace(/\\\\/g,'\\'),xsl);
});
test('Show Bookmarks cannot mount old transported facet listener or inspector against a new query',()=>{
 assert.match(read('src/canvas/workspace.tsx'),/personalWidgets\.filter\(\(widget\) =>/);
 assert.match(read('src/canvas/workspace.tsx'),/activeTransportedFacets\(queryTree\)/);
 assert.match(read('src/canvas/left/personal-widget-cards.tsx'),/\.flatMap\(widget =>/);
 assert.match(read('src/canvas/left/personal-widget-cards.tsx'),/current \? \[\{\.\.\.widget, anchor: current\}\] : \[\]/);
});
test('bootstrap forms q and fills only missing addr before the canonical restore and URL sync', () => {
  const source = read('src/canvas/utils/workspace-controller.tsx');
  const start = source.indexOf('const initialUrlRestoredRef = ');
  const end = source.indexOf('// One authoritative serializer for the address bar', start);
  assert.ok(start >= 0 && end > start);
  const boot = source.slice(start, end);
  const sync = source.slice(source.indexOf('// Phase C navigation actor', end), source.indexOf('// Avoid writing the same restored History URL', end));
  assert.match(boot, /const parsed = supplied\?\.trim\(\) \? parseFctQueryXml\(supplied\) : createBlankStartupQuery\(\)/);
  assert.match(boot, /const explicitServer =/);
  assert.match(boot, /if \(!explicitServer\)/);
  assert.match(boot, /chooseStartupGraphServer\(\{/);
  assert.match(boot, /prepared = prepareInitialFctQuery\(parsed, selected\.url\)/);
  assert.match(boot, /const initialXml = serializeFctQuery\(prepared\)/);
  assert.match(boot, /restoreQueryAndUiState\(initialXml, initialUiState, params\.get\("history"\), true\)/);
  assert.match(boot, /workbenchQueryTreeApi\.getTree\(\)\.attributes\.addr !== prepared\.attributes\.addr/);
  assert.match(boot, /setUrlStateInitialized\(true\)/);
  assert.doesNotMatch(boot, /await\s|authRestoreComplete|initializeMaestroStorage\(|window\.history\.replaceState|replaceQueryTree\(addressed\)|setSelectedEndpointId\(/);
  assert.match(sync, /useLayoutEffect\(\(\) => \{/);
  assert.match(sync, /window\.history\.replaceState/);
});
test('Query Tree offers Link only to unbound relationships, Pencil on bound value; XML store enforces referential integrity',()=>{
 const ui=read('src/canvas/utils/workspace-controller.tsx');
 assert.match(ui,/!node\.children\.some\(child=>child\.name==="value"\)/);
 assert.match(ui,/<Pencil className="size-4"\/>/);
 assert.match(ui,/dependentFctValueReferences\(queryTree,nodeId\)/);
 assert.match(read('src/lib/fct-query.ts'),/function assertFctNodeCanBeDeleted/);
});
