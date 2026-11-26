const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const source = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function load(file) {
 const exports = {};
 vm.runInNewContext(ts.transpileModule(source(file), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require(name){if(name==='./lifecycle')return {};throw Error(name);}});
 return exports;
}
const bnode = load('src/lib/bnode/index.ts');
const builtin = load('src/lib/builtin-analyses.ts');
test('initial inverse role identification does not expand siblings; explicit exploration bounds nodes before descriptions',()=>{
 const input={compiledSelect:'SELECT ?c1 WHERE { ?s <urn:p> ?c1 } LIMIT 24',graphs:['urn:g'],preferredLanguage:'all',limit:100,windowLimit:24};
 for(const [direction,pattern] of [['forward','?parent <urn:p> ?node .'],['reverse','?node <urn:p> ?parent .']]) {
 const opts={...input,focusRelationship:{predicate:'urn:p',direction}};
 const q=bnode.buildBlankNodeRecordSparql(opts);
 assert.ok(q.includes(`GRAPH ?parentGraph { ${pattern} }`));
 assert.ok(!q.includes('?seed'));assert.ok(!q.includes('GROUP BY'));assert.ok(!q.includes('ORDER BY DESC(?candidate)'));
 assert.ok(q.includes('LIMIT 24'));assert.ok(q.endsWith('LIMIT 100'));assert.ok(!q.includes('nodeID://'));
 const anchored=bnode.buildBlankNodeRecordSparql({...opts,immediateParent:'urn:parent'});
 assert.ok(anchored.includes('VALUES ?parent { <urn:parent> }'));
 const direct=bnode.buildBlankNodeRecordSparql({...opts,expansion:{kind:'uri',parent:'urn:parent',graph:'urn:g',page:1}});
 assert.ok(direct.includes('VALUES ?parent { <urn:parent> }'));
 assert.ok(!direct.includes(input.compiledSelect));
 assert.ok(direct.indexOf('LIMIT 24 OFFSET 24') < direct.indexOf('OPTIONAL {'));
 const reconstructed=bnode.buildBlankNodeRecordSparql({...opts,expansion:{kind:'reconstruct'}});
 assert.ok(reconstructed.includes('SELECT DISTINCT ?parent ?parentGraph'));
 assert.ok(reconstructed.includes(input.compiledSelect));
 assert.ok(reconstructed.indexOf('LIMIT 24 OFFSET 0') < reconstructed.indexOf('OPTIONAL {'));
 assert.ok(!reconstructed.includes('GROUP BY'));assert.ok(!reconstructed.includes('MAX(IF('));
 }
 const root=bnode.buildBlankNodeRecordSparql(input);assert.ok(!root.includes('?seed'));
 assert.throws(()=>bnode.buildBlankNodeRecordSparql({...input,immediateParent:'urn:parent'}),/Invalid immediate/);
 assert.throws(()=>bnode.buildBlankNodeRecordSparql({...input,focusRelationship:{predicate:'urn:p',direction:'forward'},expansion:{kind:'uri',parent:'nodeID://b123'}}),/Invalid sibling/);
});
const row=(node,type,value,candidate=1,graph)=>({node:{type:'bnode',value:node},candidate:{type:'literal',value:String(candidate)},...(value?{parent:{type,value}}:{}),...(graph?{parentGraph:{type:'uri',value:graph}}:{})});
test('actual parent groups separate seeds, siblings, unrelated nodes and distinct typed parents',()=>{
 const records=bnode.parseBlankNodeRecordBindings([row('a','uri','urn:p'),row('b','uri','urn:p',0),row('c','uri','urn:q'),row('d','literal','urn:p'),row('e','uri','urn:r',0),row('a','uri','urn:r')]);
 assert.equal(records.length,5);assert.deepEqual(Array.from(bnode.blankNodeCandidateIndices(records)),[0,2,3]);
 assert.deepEqual(Array.from(bnode.blankNodeSiblingIndices(records,records[0].parents[0])),[0,1]);
 assert.deepEqual(Array.from(bnode.blankNodeSiblingIndices(records,records[0].parents[1])),[0,4]);
 assert.deepEqual(Array.from(bnode.blankNodeSiblingIndices(records,records[2].parents[0])),[2]);
 assert.deepEqual(Array.from(bnode.blankNodeSiblingIndices(records,'')),[]);
});
test('named graph and response-local bnode parent identity do not conflate groups',()=>{
 const records=bnode.parseBlankNodeRecordBindings([row('a','bnode','p',1,'urn:g1'),row('b','bnode','p',0,'urn:g1'),row('c','bnode','p',1,'urn:g2'),row('d','uri','_:p',1,'urn:g1'),row('root',null,null)]);
 assert.deepEqual(Array.from(bnode.blankNodeSiblingIndices(records,records[0].parents[0])),[0,1]);
 assert.deepEqual(Array.from(bnode.blankNodeSiblingIndices(records,records[2].parents[0])),[2]);
 assert.equal(records[4].parents.length,0);assert.ok(bnode.materializeBlankNodeRecord(records[0],true).includes('<fct:complete>no</fct:complete>'));
});
test('duplicate rows from several parent groups do not duplicate Record triples',()=>{
 const binding={direction:{type:'literal',value:'property'},predicate:{type:'uri',value:'urn:value'},object:{type:'literal',value:'data'}};
 const records=bnode.parseBlankNodeRecordBindings([{...row('a','uri','urn:p'),...binding},{...row('a','uri','urn:q'),...binding}]);
 assert.equal(records[0].rows.length,1);assert.equal(records[0].parents.length,2);assert.equal(Object.hasOwn(records[0],'xml'),false);assert.equal((bnode.materializeBlankNodeRecord(records[0],false).match(/<fct:row /g)||[]).length,1);
});
test('Browse and fullscreen use the same fresh client-side blank-node transport and response-local ownership',()=>{
 const main=source('src/canvas/utils/workspace-controller.tsx'),pivot=source('src/canvas/controllers/record-session-controller.tsx'),route=source('src/app/proxy/api/sparql/route.ts');
 const loader=source('src/lib/bnode/client-record.ts'), cache=source('src/lib/client-query-cache.ts');
 assert.ok(main.includes('await loadBlankNodeRecord('));assert.ok(pivot.includes('await loadBlankNodeRecord('));
 assert.ok(main.includes('A different response cannot identify the chosen blank node'));assert.ok(pivot.includes('No cross-response blank-node graph attribution'));
 assert.ok(!route.includes('body?.recordBlankNodes'));assert.ok(!route.includes('buildBlankNodeRecordSparql'));
 assert.ok(loader.includes('responseScope: "request"'));assert.ok(cache.includes('"responseScope"'));
 assert.ok(route.includes('if (requestScoped)'));assert.ok(route.includes('body.maxResponseBytes'));assert.ok(!route.includes('REQUEST_SCOPED_RESPONSE_BYTES'));
 assert.ok(main.includes('blankNodeResponse?.key === currentRecordDescriptionKey'));assert.ok(pivot.includes('own.blankNodeResponse?.key === currentRecordDescriptionKey'));
 const ui=source('src/canvas/right/pane.tsx');assert.ok(ui.includes('aria-label="Sibling blank-node records"'));assert.ok(ui.includes('<TabsTrigger'));assert.ok(ui.includes('chooseBlankNodeSibling(index)'));assert.doesNotMatch(ui,/BlankNodeCandidatePicker|Choose a reconstructed candidate|Return to candidates|Choose immediate parent|blank-node candidates/);
 assert.ok(!fs.existsSync(path.join(__dirname,'..','src/canvas/right/blank-node-candidate-picker.tsx')));
 assert.ok(main.includes('current || (nextResults[0]?.uri || "")'));assert.ok(main.includes('setSelectedUri(visibleResultsPage[0].uri)'));assert.doesNotMatch(main,/nextResults\[0\]\?\.termType === "bnode"/);assert.ok(main.includes('blankNodeGraphQueryXml = useMemo'));
 for(const controller of [main,pivot]) {assert.ok(controller.includes('initialBlankNodeFamily(response.records, selectedUri)'));assert.ok(controller.includes('setDescribedRecord(node.rows)'));assert.ok(controller.includes('materializeBlankNodeRecord(node, incomplete)'));assert.doesNotMatch(controller,/useBlankNodeExpansion|requestBlankNodeSiblings/);}
 assert.ok(source('src/lib/bnode/lifecycle.ts').includes('membership.map(({ candidate, parents })'));
});
test('automatic initial Record prefers the old label and shows only verified same-response siblings',()=>{
 const records=bnode.parseBlankNodeRecordBindings([row('a','bnode','p'),row('b','bnode','q'),row('c','bnode','p'),row('d','bnode','p',0),row('e','bnode','p',1,'urn:other'),row('f',null,null)]);
 let family=bnode.initialBlankNodeFamily(records,'_:c');
 assert.deepEqual(Array.from(family.records,r=>r.id),['_:a','_:c','_:d']);assert.equal(family.index,1);
 family=bnode.initialBlankNodeFamily(records,'_:not-returned');assert.deepEqual(Array.from(family.records,r=>r.id),['_:a','_:c','_:d']);assert.equal(family.index,0);
 family=bnode.initialBlankNodeFamily(records,'_:b');assert.deepEqual(Array.from(family.records,r=>r.id),['_:b']);assert.equal(family.index,0);
 family=bnode.initialBlankNodeFamily(records,'_:f');assert.deepEqual(Array.from(family.records,r=>r.id),['_:f']);assert.equal(family.index,0);
 assert.equal(bnode.initialBlankNodeFamily([], '_:missing').index,-1);
});
test('Record parent shortcut consumes only typed inverse-focus URI columns already returned in Results',()=>{
 const scope={predicate:'urn:xref',direction:'forward',depth:3};
 const column=(value,property='urn:xref',direction='reverse',termType='uri')=>({value,termType,attributes:{property,direction}});
 const anchor=bnode.blankNodeParentFromResultColumns([column('urn:parent'),column('urn:irrelevant','urn:else'),column('_:parent','urn:xref','reverse','bnode')],scope);
 assert.equal(anchor.parent,'urn:parent');assert.equal(anchor.depth,3);assert.equal(anchor.direction,'forward');
 assert.equal(bnode.blankNodeParentFromResultColumns([column('urn:a'),column('urn:b')],scope),undefined);
 assert.equal(bnode.blankNodeParentFromResultColumns([column('nodeID://b42')],scope),undefined);
 assert.equal(bnode.blankNodeParentFromResultColumns([column('urn:a','urn:xref','forward')],scope),undefined);
 assert.equal(bnode.blankNodeParentFromResultColumns([column('urn:a','urn:xref','forward')],{...scope,direction:'reverse'}).parent,'urn:a');
});
test('fullscreen selection changes discard only descendants of that blank-node Record',()=>{
 const {RecordSessionsController}=load('src/canvas/controllers/record-session-model.ts');
 const controller=new RecordSessionsController({value:'urn:root',termType:'uri',queryXml:'<query/>'});
 const pivot=controller.appendPivot({value:'_:clicked',termType:'bnode',queryXml:'<query/>'},{predicate:'urn:p',direction:'property',subjectSessionId:'record-0'},0);
 assert.equal(controller.observeBlankNodeSelection(pivot.id,'_:chosen'),true);
 const child=controller.appendPivot({value:'urn:child',termType:'uri',queryXml:'<query/>'},{predicate:'urn:q',direction:'property',subjectSessionId:pivot.id},1);
 assert.equal(controller.observeBlankNodeSelection(pivot.id,'_:chosen'),false);
 assert.equal(controller.snapshot().sessions.length,3);
 assert.equal(controller.observeBlankNodeSelection(pivot.id,'_:other'),true);
 assert.equal(controller.snapshot().sessions.length,2);
 assert.equal(controller.snapshot().sessions[1].identity.value,'_:clicked');
 assert.equal(controller.snapshot().sessions[1].bnodeDisplayValue,'_:other');
});
test('trusted built-in definitions match the seeded stylesheets and cannot be shadowed',()=>{
 assert.equal(builtin.BUILTIN_ANALYSES.length,2);
 const ttl=source('graph/maestro-analyze.ttl');for(const def of builtin.BUILTIN_ANALYSES)assert.ok(ttl.includes(def.stylesheet));
 const a={uri:'urn:a',label:'A',icon:'chart-radar',stylesheet:'a',order:1};const b={...a,stylesheet:'b'};
 assert.equal(builtin.mergeAnalysisDiscoveryItems([a],[a]).length,1);
 assert.equal(builtin.mergeAnalysisDiscoveryItems([a],[b]).length,0);
 assert.equal(builtin.mergeAnalysisDiscoveryItems(builtin.BUILTIN_ANALYSES).length,0);
});
