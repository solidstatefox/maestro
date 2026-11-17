// Focused migration regressions. Browser modules are transpiled with mocked
// SPARQL/HTTP boundaries; no credentials or live graph server are required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {webcrypto}=require('node:crypto');
const ctx={base:'https://example.test/DAV/query',addr:'https://example.test/DAV/query@https://example.test/sparql',session:{graphStore:'https://example.test/sparql',authHeader:'test',graphPrefix:'https://example.test/DAV'}};
function compiled(file,dependencies={},extra={}){
  const source=fs.readFileSync(file,'utf8');
  const result=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
  assert.equal(result.diagnostics?.length??0,0,file+' transpile');
  const exports={};
  vm.runInNewContext(result.outputText,{exports,require(name){assert.ok(Object.hasOwn(dependencies,name),'unexpected import '+name);return dependencies[name];},Response,Request,URL,URLSearchParams,TextEncoder,crypto:webcrypto,AbortController,console,...extra},{filename:file});
  return exports;
}
const personal={personalContext:async()=>ctx,selectPersonal:async()=>[],updatePersonal:async()=>{}};
async function main(){
  const queries=[],writes=[];
  const favorites=compiled('src/lib/client-query-favorites.ts',{
    '@/lib/query-identity':{canonicalQueryIdentityXml:xml=>xml},
    'fast-xml-parser':{XMLParser:class{}},
    '@/lib/fct-sparql-translator':{compileFctXmlToSparql:()=>({query:'SELECT ?c1 WHERE { ?c1 ?p ?o }'})},
    '@/lib/client-personal-sparql':{...personal,
      selectPersonal:async(q)=>{queries.push(q);return q.includes('SELECT ?queryXML')?[{queryXML:{value:'<query addr="@https://example.test/sparql"><view type="list"/></query>'},stateUrl:{value:'https://maestro.example/?q=x'}}]:[];},
      updatePersonal:async(u)=>{writes.push(u)},
    },
  });
  let response=await favorites.clientQueryFavorites({method:'POST',body:JSON.stringify({action:'getHistoryItem',historyId:'https://example.test/visit'})});
  assert.equal(response.status,200);
  assert.ok((await response.json()).queryXml.includes('<query'));
  assert.ok(queries[0].includes('GRAPH <'+ctx.base+'#history>'));
  response=await favorites.clientQueryFavorites({method:'POST',body:JSON.stringify({action:'visit',queryXml:'<query><view type="list"/></query>',stateUrl:'https://maestro.example/?q=x'})});
  assert.equal(response.status,200);
  assert.ok((await response.json()).historyId.includes('history#'));
  assert.ok(writes.some(s=>s.includes('GRAPH <'+ctx.base+'#history>')));
  const approval=compiled('src/lib/client-policy-approvals.ts',{
    '@/lib/client-personal-sparql':{...personal,selectPersonal:async()=>[
      {policy:{value:'urn:direct'},isProvider:{value:'true'},assertion:{value:'gttp://ggg.maestro.ecosys/ns/ui#Approved'}},
      {policy:{value:'urn:inherited'},isProvider:{value:'true'},curated:{value:'true'}},
      {policy:{value:'urn:curator'},isCurator:{value:'true'}},
    ]},
  });
  const granted=await approval.readClientPolicyApprovals(['urn:direct','urn:inherited','urn:curator','urn:missing']);
  assert.equal(granted[0].status,'Approved');
  assert.equal(granted[1].status,'Approved');
  assert.equal(granted[2].status,'Pending');
  assert.equal(granted[3].status,null);
  const discovery=compiled('src/lib/client-record-services.ts',{
    '@/lib/client-personal-sparql':{...personal,selectPersonal:async()=>[
      {service:{value:'urn:s'},label:{value:'Service'},operation:{value:'urn:op'},operationLabel:{value:'Lookup'},requires:{value:'isbn'}},
      {service:{value:'urn:s'},label:{value:'Service'},operation:{value:'urn:op'},operationLabel:{value:'Lookup'},requires:{value:'token'}},
    ]},
    '@/lib/record-service-discovery-query': {safeRecordServiceIri:uri=>typeof uri==='string' && /^urn:|^https:/.test(uri),buildRecordServiceDiscoveryQueries:()=>['SELECT ?service WHERE {?service ?p ?o}']},
  });
  const services=await discovery.discoverRecordServices(['https://schema.org/Book']);
  assert.equal(services.length,1);assert.deepEqual(Array.from(services[0].operations[0].requires),['isbn','token']);
  const ontology=compiled('src/lib/client-ontology-metadata.ts',{
    '@/lib/client-personal-sparql':{...personal,selectPersonal:async(q)=>q.includes('?candidateParent WHERE')?[
      {class:{value:'https://ex/Child'},candidateParent:{value:'https://ex/Parent'}},
    ]:[{class:{value:'https://ex/Child'},ontology:{value:'https://ex/onto'}}]},
  },{fetch:async()=>Response.json({ingestion:{fetched:1,imported:1,failures:[]}})});
  const hierarchy=await ontology.readOntologyMetadata(['https://ex/Child','https://ex/Parent']);
  assert.equal(hierarchy[0].parent,'https://ex/Parent');
  const perspective=compiled('src/lib/client-perspective-collections.ts',{
    '@/lib/client-personal-sparql':{...personal,selectPersonal:async(q)=>q.includes('SELECT DISTINCT ?provider')?[
      {provider:{value:'urn:provider'},kind:{value:'bookmarks'},template:{value:'urn:widget'},stylesheet:{value:'<xsl:stylesheet/>'}},
    ]:[{entry:{value:'urn:item'},label:{value:'Saved bookmark'},tag:{value:'film'},tagPredicate:{value:'http://purl.org/dc/terms/subject'}}]},
    '@/lib/client-policy-approvals':{readClientPolicyApprovals:async()=>[{uri:'urn:provider',status:'Approved'}]},
  });
  const collection=await perspective.loadPerspectiveCollection('bookmarks','urn:provider');
  assert.equal(collection.rows[0].tags[0],'film');
  const registry=fs.readFileSync('src/app/proxy/api/service/operations.ts','utf8');
  assert.ok(!registry.includes("'query-favorites':"));
  assert.equal((registry.match(/': \{ POST:/g)||[]).length,11);
  for(const file of ['src/canvas/utils/workspace-controller.tsx','src/canvas/utils/history.ts','src/canvas/top/appbar-pane.tsx']){
    const text=fs.readFileSync(file,'utf8');
    assert.ok(text.startsWith('"use client";'),file+' directive');
    assert.ok(!text.includes('operationId=query-favorites'),file+' retired endpoint');
  }
  console.log('PASS: Favorites, direct/curated approval, service discovery, ontology hierarchy, perspective collections and 11-operation registry');
}
main().catch(error=>{console.error(error);process.exitCode=1});
