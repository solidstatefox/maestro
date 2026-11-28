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
function compile(sample,countOnly=false){
 const mocks={
  './fct-view-types':loadTs('src/lib/fct-view-types.ts'),
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
 return loadTs('src/lib/fct-sparql-translator.ts',mocks).compileFctXmlToSparql('<query/>',sample.children.find(n=>n.name==='view')?.attributes.type ?? 'list',false,countOnly,false,false,undefined,'en').query;
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
 assert.equal(refs.dependentFctNodeReferences(withDependent,'d').length,1);
 assert.equal(refs.dependentFctNodeReferences(withDependent,'b').length,0);
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
 const batchStart=block.indexOf('<xsl:for-each select="1 to');
 assert.ok(batchStart>0, 'numeric batch loop must exist');
 const before=block.slice(0,batchStart), batch=block.slice(batchStart);
 assert.match(before,/name="runtimeQuery" select="\/mctx:context\/mctx:query\/\*\[local-name\(\)='query'\]"/);
 assert.match(before,/name="runtimeAddr" select="string\(\$runtimeQuery\/@addr\)"/);
 assert.match(before,/name="runtimeGraph"[^\n]+select="[^"\n]*\$runtimeAddr[^"\n]*\$runtimeQuery\/@graph/);
 assert.ok(before.indexOf('name="runtimeQuery"')<before.indexOf('name="runtimeAddr"') && before.indexOf('name="runtimeAddr"')<before.indexOf('name="runtimeGraph"'));
 assert.match(batch,/name="graph" select="\$runtimeGraph"/);
 assert.doesNotMatch(batch,/\/mctx:context/, 'numeric loop cannot access the input document through its integer context');
 const copies=[...ttl.matchAll(/mui:templateContent """([\s\S]*?)"""/g)];
 assert.equal(copies.length,3);
 for(const item of copies.slice(1,2))assert.equal(item[1].replace(/\\\\/g,'\\'),xsl);
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
 assert.match(ui,/error instanceof FctNodeInUseError/);
 assert.match(read('src/lib/fct-query.ts'),/function assertFctNodeCanBeDeleted/);
});


test('Query Tree buttons are joined outline controls and transported anchors share the widget icon',()=>{
 const ui=read('src/canvas/utils/workspace-controller.tsx');
 const controls=ui.slice(ui.indexOf('<ButtonGroup className="ml-auto shrink-0 self-start" aria-label={`Query node controls'),ui.indexOf('</ButtonGroup>',ui.indexOf('<ButtonGroup className="ml-auto shrink-0 self-start" aria-label={`Query node controls')));
 assert.equal((controls.match(/<Button\s+variant="outline" size="icon-sm"/g)||[]).length,3);
 assert.match(controls,/<Button\s+variant="outline" size="icon-sm"[\s\S]*?−\s*<\/Button>/);
 assert.doesNotMatch(controls,/<button\b/);
 assert.match(ui,/node\.name === "a"\s*\? ExternalLink/);
 assert.match(ui,/node\.name === "a"\s*\? queryTreeRelationshipIconColor\(queryTreePathIndex\.byId\.get\(node\.attributes\.href/);
 assert.match(ui,/queryTreeRelationshipIconColor = [\s\S]*?child\.name === "view"[\s\S]*?"text-emerald-600 dark:text-emerald-400"[\s\S]*?"text-red-600 dark:text-red-400"/);
 assert.match(read('src/canvas/left/personal-widget-cards.tsx'),/<ExternalLink className="inline size-4/);
 assert.match(ui,/deleteNode: guardedDeleteQueryNode,/);
 assert.match(ui,/blockedReferenceDeletion\?\.dependents\.map/);
 assert.match(ui,/const resolved = getTransportedQueryTreePath\(ref\.anchorId, ref\.targetId\)/);
 assert.match(ui,/resolved \? pathLabel\(resolved\.path\)/);
 assert.match(ui,/blockedReferenceDeletion\?\.hrefLabels\[ref\.anchorId\]/);
 assert.match(ui,/return owner \? getPath\(queryTreePathIndex, owner, href\) : null/);
});

test('EURIO transported href blocks deleting its target and each ancestor; removing the facet unlocks the path',()=>{
 const identity=loadTs('src/lib/fct-node-identity.ts');
 const store=loadTs('src/lib/fct-query.ts',{
  react:{useMemo:x=>x,useSyncExternalStore:()=>({})},
  './fct-node-identity':identity,
  './fct-query-clone':{cloneFctQueryTree:source=>structuredClone(source)},
  './fct-query-serialize':{serializeFctQuery:()=>'<query/>'},
  './fct-value-references':refs,
 });
 const query=tree([
  node('a3','property',{iri:'http://data.europa.eu/s66#hasEuroSciVocClassification',rid:'i'},[
   value('a4',{datatype:'uri'},'http://data.europa.eu/8mn/euroscivoc/61bab820-648f-4f84-9f2d-71b5f80c5835'),
   node('a6','property',{iri:'http://www.w3.org/2008/05/skos-xl#altLabel',rid:'k'},[
    node('a8','property',{iri:'http://www.w3.org/2008/05/skos-xl#literalForm',rid:'m'},[value('aa',{'xml:lang':'en'},'linguistic')])])]),
  node('a9','a',{href:'a8'}),node('a2','view',{type:'list',limit:'30',offset:'0'})]);
 Object.assign(query.attributes,{ctr:'371',uctr:'a',rctr:'n',addr:'$ALL$@https://cordis.europa.eu/datalab/sparql'});
 const before=JSON.stringify(query);
 const api=store.fctQueryTreeApi;
 for (const target of ['a3','a6','a8']) {
  for (const operation of [api.deleteNode,api.removeNode]) {
   assert.throws(()=>operation(query,target),error=>{
    assert.ok(error instanceof refs.FctNodeInUseError);
    assert.equal(error.nodeId,target);
    assert.deepEqual(error.dependents,[{kind:'href',anchorId:'a9',sourceId:'a',targetId:'a8'}]);
    assert.ok(error.message.includes('<a id="a9" href="a8"/>'));
    return true;
   });
  }
  assert.equal(JSON.stringify(query),before);
 }
 // Clearing only the bound value is allowed; the relationship remains.
 assert.equal(api.deleteNode(query,'aa').children[0].children[1].children[0].id,'a8');
 const unlinked=api.deleteNode(query,'a9');
 assert.ok(unlinked.children.some(n=>n.id==='a3'));
 const removed=api.deleteNode(unlinked,'a3');
 assert.ok(!removed.children.some(n=>n.id==='a3'||n.name==='a'));
 assert.equal(removed.children.find(n=>n.name==='view').id,'a2');
});

test('dependency results list all external href, from and fromView links, excluding internal references',()=>{
 const sample=tree([
  rel('b','urn:test:path',[rel('d','urn:test:target'),node('e','a',{href:'d'})]),
  rel('f','urn:test:from',[value('g',{from:'d'})]),
  rel('h','urn:test:fromView',[value('i',{fromView:'b'})]),
  node('j','a',{href:'d'}),node('k','a',{href:'b'}),node('l','view',{type:'list'})]);
 const deps=refs.dependentFctNodeReferences(sample,'b');
 assert.deepEqual(deps.map(refs.describeDeletionReference),[
  '<value id="g" from="d"/>','<value id="i" fromView="b"/>','<a id="j" href="d"/>','<a id="k" href="b"/>']);
 assert.equal(refs.dependentFctNodeReferences(sample,'j').length,0);
 assert.deepEqual(refs.dependentFctNodeReferences(tree([sample.children[0]]),'b'),[]);
});


test('Kind-filtered Properties carries a self-contained filter in the named graph',()=>{
 const browser=loadTs('src/lib/maestro-kinds.ts');
 browser.hydrateMaestroKinds([{id:'web-url',pattern:'^https?://'}]);
 const graph='http://dbpedia.org/resource/Daniel_Day-Lewis';
 const filter=browser.maestroKindFilter('web-url');
 const sample=tree([node('s','view',{type:'properties',limit:'400',offset:'0',kind:'web-url','kind-property':'web-url',kindFilter:filter})]);
 sample.attributes.addr=graph+'@https://linkeddata.uriburner.com/sparql';
 const browserQuery=compile(sample);
 assert.match(browserQuery,/REGEX\(STR\(\?o\), "\(\?:\^https\?:\/\/\)", "i"\)/);
 assert.match(browserQuery,/GRAPH <http:\/\/dbpedia.org\/resource\/Daniel_Day-Lewis>/);
 assert.match(browserQuery,/GROUP BY \?p/);
 browser.clearMaestroKinds();
 assert.equal(compile(sample),browserQuery);
 browser.hydrateMaestroKinds([{id:'web-url',pattern:'^https://'}]);
 assert.notEqual(browser.maestroKindFilter('web-url'),filter);
 assert.equal(compile(sample),browserQuery,'saved XML retains original semantics');
 sample.children[0].attributes.kind='unknown-metadata';
 assert.equal(compile(sample),browserQuery,'compiler does not interpret Kind identity');
 delete sample.children[0].attributes.kindFilter;
 assert.throws(()=>compile(sample),/requires kindFilter/);
});

test('Text materializes native numeric, all temporal and five lexical exclusions',()=>{
 const browser=loadTs('src/lib/maestro-kinds.ts');
 const patterns=[['web-url','^https?://'],['numeric','^[0-9]+$'],['date','^[0-9]{4}-'],['email','@'],['phone','^tel:']];
 browser.hydrateMaestroKinds(patterns.map(([id,pattern])=>({id,pattern})));
 const filter=browser.maestroKindFilter('text');
 assert.match(filter,/isLiteral\(\?value\) && !\(\(isNumeric\(\?value\) && DATATYPE\(\?value\) != <http:\/\/www.w3.org\/2001\/XMLSchema#boolean>/);
 for(const dt of ['date','dateTime','time','gYear','gYearMonth'])assert.ok(filter.includes(`http://www.w3.org/2001/XMLSchema#${dt}>`));
 assert.equal((filter.match(/REGEX\(/g)||[]).length,5);
 const sample=tree([node('s','view',{type:'properties',kind:'text',kindFilter:filter})]);
 const query=compile(sample);
 assert.match(query,/isNumeric\(\?o\)/);
 assert.doesNotMatch(query,/\?value\b/);
 assert.equal((query.match(/REGEX\(/g)||[]).length,5);
 browser.clearMaestroKinds();assert.equal(compile(sample),query);
 assert.equal(browser.maestroKindFilter('text'),'');
 browser.hydrateMaestroKinds([{id:'web-url',pattern:'^https?://'}]);
 assert.equal(browser.maestroKindFilter('text'),'','incomplete providers cannot silently broaden Text');
});

test('incoming Roles filter and count bind the actual related subject',()=>{
 const sample=tree([node('s','view',{type:'properties-in',kind:'web-url',kindFilter:'isIRI(?value)'})]);
 for(const countOnly of [false,true]){
  const query=compile(sample,countOnly);
  assert.match(query,/FILTER \(isIRI\(\?related\)\)/);
  assert.doesNotMatch(query,/FILTER \(isIRI\(\?s1\)\)/);
 }
});

test('generic FCT filter validation rejects injection and substitutes only the operand token',()=>{
 const sample=tree([node('s','view',{type:'properties',kind:'web-url',kindFilter:'REGEX(STR(?value), "[?]value", "i")'})]);
 assert.match(compile(sample),/REGEX\(STR\(\?o\), "\[\?\]value", "i"\)/);
 for(const raw of ['isIRI(?value)) } SERVICE <https://bad.example/> { ?s ?p ?o . } #','isIRI(?other)','bif:exec(?value)','EXISTS { ?value ?p ?o }','REGEX(STR(?value), "a", "i") # comment','isIRI(?value) ||']){
  sample.children[0].attributes.kindFilter=raw;assert.throws(()=>compile(sample),/invalid kindFilter/);
 }
});

test('Remove All deletes every dependent href and value link before the target, without modifying the supplied query',()=>{
 const identity=loadTs('src/lib/fct-node-identity.ts');
 const serialize=loadTs('src/lib/fct-query-serialize.ts',{'./fct-node-identity':identity});
 const store=loadTs('src/lib/fct-query.ts',{
  react:{useMemo:x=>x,useSyncExternalStore:()=>({})},
  './fct-node-identity':identity,'./fct-query-clone':{cloneFctQueryTree:source=>structuredClone(source)},
  './fct-query-serialize':serialize,'./fct-value-references':refs,
 });
 const query=identity.ensureFctQueryIds(tree([
  rel('b','urn:test:path',[rel('d','urn:test:target')]),
  rel('f','urn:test:from',[value('g',{from:'d'})]),
  rel('h','urn:test:fromView',[value('i',{fromView:'b'})]),
  node('j','a',{href:'d'}),node('k','a',{href:'b'}),node('l','view',{type:'list'})]));
 const before=serialize.serializeFctQuery(query), api=store.fctQueryTreeApi;
 assert.throws(()=>api.deleteNode(query,'b'),refs.FctNodeInUseError);
 assert.throws(()=>api.deleteNode(query,'b',{removeDependents:true,expectedQueryXml:before+'changed'}),/query changed/);
 const result=api.deleteNode(query,'b',{removeDependents:true,expectedQueryXml:before});
 assert.deepEqual(result.children.map(n=>n.id),['f','h','l']);
 assert.equal(result.children[0].children.length,0);
 assert.equal(result.children[1].children.length,0);
 assert.equal(serialize.serializeFctQuery(query),before);
 assert.equal(refs.inspectFctValueReferences(result).references.length,0);
});
