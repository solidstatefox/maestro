const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function load(p, deps={}) {
 const module={exports:{}};
 const compiled=ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('module','exports','require',compiled)(module,module.exports,id=>{if(id in deps)return deps[id];throw Error('Unexpected dependency '+id);});
 return module.exports;
}
const addr='http://example.org/catalog@https://data.europa.eu/sparql';
const sourceXml='<query addr="'+addr+'"><property group="true"/><view type="list" limit="100" offset="90"/></query>';
const snapshotXml=sourceXml.replace(' group="true"','');
const derived='DEFINE input:same-as "yes"\nSELECT DISTINCT (?s AS ?c1) ?lat ?lng WHERE { GRAPH <http://example.org/catalog> { ?s <http://purl.org/dc/terms/conformsTo> <https://www.w3.org/TR/sparql11-protocol/> . { ?s <urn:lat> ?lat ; <urn:lng> ?lng . } UNION { ?s <urn:point> ?point } } } ORDER BY ?c1 LIMIT 100 OFFSET 90';
function fixture(fetch, overrides={}) {
 const calls=[],logs=[];
 const split=load('src/lib/provider-fct-context.ts',{'@/lib/fct-sparql-translator':{}});
 const guard=load('src/lib/sparql-read-guard.ts');
 const m=load('src/lib/provider-population-probe.ts',{
  '@/lib/provider-xslt-query':{compileProviderXsltQuery:async(xml,shape,stylesheet,signal)=>{assert.equal(xml,snapshotXml);assert.equal(shape,'urn:shape');assert.equal(stylesheet,'xsl');return {sparql:derived,timeoutMs:20000};}},
  '@/lib/provider-fct-context':split,
  '@/lib/fct-query-clone':{snapshotFctQueryXml:(xml,plane)=>{assert.equal(xml,sourceXml);assert.equal(plane,'data');return snapshotXml;},fctQueryExecutionAddress:()=>addr},
  '@/lib/client-query-cache':{maestroQueryFetch:async(url,init)=>{calls.push([url,init]);return fetch(url,init);}},
  '@/lib/proxy-debug':{proxyDebugHeaders:(source,component)=>({'X-Maestro-Debug-Source':source,'X-Maestro-Debug-Component':component})},
  '@/lib/sparql-read-guard':guard,
  '@/lib/maestro-client-logging':{browserLog:{warn:(...args)=>logs.push(args)}},...overrides,
 });
 return {calls,logs,probe:(signal)=>m.probeProviderPopulation(sourceXml,'urn:shape','xsl','urn:provider',signal)};
}
const response=(bindings,incomplete=false)=>new Response(JSON.stringify({head:{vars:['c1']},results:{bindings},incomplete}));
test('runtime probe preserves scope and WHERE, avoids full sorted result retrieval, and requires a witness',async()=>{
 const f=fixture(async()=>response([{c1:{type:'literal',value:'1'}}]));
 assert.equal(await f.probe(),true);
 assert.equal(f.calls.length,1);
 const [url,init]=f.calls[0], body=JSON.parse(init.body), query=body.resultsQuery.sparql;
 assert.equal(url,'/proxy/api/sparql');assert.equal(body.addr,addr);
 assert.match(query,/^DEFINE input:same-as "yes"\nSELECT \(1 AS \?c1\) WHERE/);
 assert.match(query,/GRAPH <http:\/\/example.org\/catalog>/);
 assert.match(query,/<https:\/\/www.w3.org\/TR\/sparql11-protocol\/>/);
 assert.match(query,/\?s <urn:lat> \?lat ; <urn:lng> \?lng/);
 assert.match(query,/UNION \{ \?s <urn:point> \?point \}/);
 assert.match(query,/LIMIT 1$/);assert.doesNotMatch(query,/ORDER BY|OFFSET|LIMIT 100/);
});
test('empty, incomplete empty, malformed, failed and cancelled probes cannot authorize a runtime',async()=>{
 for(const res of [response([]),response([],true),response([{}]),new Response('{}',{status:502})]){
  const f=fixture(async()=>res);assert.equal(await f.probe(),false);
 }
 const positivePartial=fixture(async()=>response([{c1:{type:'literal',value:'1'}}],true));assert.equal(await positivePartial.probe(),true);
 const abort=new AbortController();
 const f=fixture(async()=>{abort.abort();return response([{c1:{type:'literal',value:'1'}}]);});
 await assert.rejects(f.probe(abort.signal),{name:'AbortError'});
});
test('Format pin matches the active Format styling, and personal graph toast uses lowercase wording',()=>{
 const pane=read('src/canvas/right/pane.tsx');
 const group=pane.slice(pane.indexOf('<ButtonGroup aria-label="Record format and pin"'),pane.indexOf('</ButtonGroup>',pane.indexOf('<ButtonGroup aria-label="Record format and pin"')));
 const appbar=read('src/canvas/top/appbar-pane.tsx');
 assert.match(appbar,/<ButtonGroup aria-label="Graph server selection, discovery, and refresh"[\s\S]*?<DropdownMenuTrigger asChild><button/);
 assert.match(group,/<DropdownMenu open=\{recordFormatMenuOpen\} onOpenChange=\{setRecordFormatMenuOpen\}>/);
 assert.match(group,/<DropdownMenuTrigger asChild><button[^>]*className=\{`\$\{recordFormatButtonClass\} px-3`\}[^>]*>[\s\S]*?<ChevronDown/);
 assert.match(pane,/const recordFormatButtonClass = `[^`]*recordFormatEnabled[^`]*bg-primary text-primary-foreground/);
 assert.match(group,/<\/DropdownMenu>\s*<button type="button" className=\{`\$\{recordFormatButtonClass\} w-8`\} aria-pressed=\{recordFormatPinned\}/);
 assert.match(group,/<DropdownMenuContent align="start" className=\{fullscreenPane \? "z-\[120\] w-80" : "w-80"\}>/);
 assert.match(group,/Default\{!recordFormatEnabled && <Check/);
 assert.match(group,/selectedRecordTemplateUri === template.uri && <Check/);
 assert.match(group,/recordFormatPreviews\[template.uri\]/);
 assert.match(group,/recordFormatPinned \? <Pin[\s\S]*?<PinOff/);
 assert.doesNotMatch(group,/Combobox|InputGroup|Search formats|<input/);
 assert.doesNotMatch(pane,/Search Record formats/);
 // Verify the pin is a sibling of the menu, never a child of its trigger.
 const ast=ts.createSourceFile('pane.tsx',pane,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const groups=[];function walk(n){if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='ButtonGroup'&&n.openingElement.getText(ast).includes('Record format and pin'))groups.push(n);ts.forEachChild(n,walk);}walk(ast);
 assert.equal(groups.length,1);
 assert.deepEqual(groups[0].children.filter(ts.isJsxElement).map(n=>n.openingElement.tagName.getText(ast)),['DropdownMenu','button']);
 const toast=read('src/canvas/diagnostics/use-maestro-access.ts');
 assert.match(toast,/Personal graph reads and state machine verification completed/);
 assert.doesNotMatch(toast,/State-machine verification/);
});
