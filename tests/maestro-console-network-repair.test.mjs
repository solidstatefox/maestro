import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';

const root=process.cwd();
const read=path=>readFileSync(join(root,path),'utf8');
const require=createRequire(import.meta.url);
const ts=require('typescript');

test('Categories metadata uses existing RDF graphs; browsing never causes unsolicited CORS dereferences or LOAD',()=>{
  const code=read('src/lib/client-ontology-metadata.ts');
  assert.doesNotMatch(code,/ingestClientOntologies|forwardHttp|fetch\(/);
  assert.match(code,/selectPersonal\(/);
  assert.match(code,/\$\{ctx\.base\}\/ontology/);
  assert.match(code,/\$\{ctx\.base\}\/ontology-cache/);
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(controller,/classTreeEdges/);
  assert.match(controller,/readOntologyMetadata\(batch, controller\.signal\)/);
});

test('the same generic SPARQL proxy has an authenticated personal READ mode scoped to the login endpoint',()=>{
  const browser=read('src/lib/client-personal-sparql.ts');
  const proxy=read('src/app/proxy/api/sparql/route.ts');
  assert.match(browser,/perform\(\{addr:ctx\.addr,query,personalRead:true\}/);
  assert.match(proxy,/if \(body\?\.personalRead === true\)/);
  assert.match(proxy,/const denied = requirePersonalLogin\(request\)/);
  assert.match(proxy,/selectedUrl !== personalUrl/);
  assert.match(proxy,/isBoundedReadOnlySparql\(body\.query, 100000\)/);
  assert.match(proxy,/queryPersonalSparql\(body\.query\.trim\(\), queryTimeoutMs \?\? 20000, request\)/);
  const authStart=proxy.indexOf('if (body?.personalRead === true)');
  assert.ok(authStart>0 && authStart<proxy.indexOf('const endpointList = await getConfiguredFctEndpoints(request)'));
  assert.doesNotMatch(proxy.slice(authStart,proxy.indexOf('const endpointList = await getConfiguredFctEndpoints(request)')),/setQueryCache|\/sparql-auth|Authorization:/);
  assert.match(browser,/await perform\(\{update,/);
});

test('prefix registries are opt-in and do not cascade a failing source to another upstream API',()=>{
  const prefs=read('src/canvas/controllers/preferences.ts');
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(prefs,/useState<"prefixcc" \| "zazuko" \| "builtin">\("builtin"\)/);
  assert.doesNotMatch(controller,/\.catch\(\(error\) => prefixSource === "prefixcc"/);
  assert.match(controller,/setPrefixSource\("builtin"\)/);
  assert.match(controller,/maestroStorageSet\("maestro-namespace-prefix-source", "builtin"\)/);
});

test('all modified TypeScript and TSX modules parse',()=>{
  for(const file of [
    'src/lib/client-ontology-metadata.ts','src/lib/client-personal-sparql.ts',
    'src/app/proxy/api/sparql/route.ts','src/canvas/controllers/preferences.ts',
    'src/canvas/utils/workspace-controller.tsx','src/canvas/sheet/settings-pane.tsx'
  ]){
    const src=read(file);
    const kind=file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS;
    const parsed=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,kind);
    assert.equal(parsed.parseDiagnostics.length,0,file+' '+parsed.parseDiagnostics.map(d=>d.messageText).join('; '));
  }
});

test('personal RDF metadata lookup returns previously imported class relationships without network imports',async()=>{
  const file='src/lib/client-ontology-metadata.ts';
  const js=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const calls=[];
  const module={exports:{}};
  const ctx={base:'urn:me/query'};
  const mocks={
    '@/lib/client-personal-sparql':{
      personalContext:async()=>ctx,
      selectPersonal:async(query, received)=>{
        assert.equal(received,ctx);calls.push(query);
        return calls.length===1?[{class:{value:'https://example.org/Child'},parent:{value:'https://example.org/Parent'}}]:[];
      }
    }
  };
  runInNewContext(js,{exports:module.exports,module,require:id=>mocks[id]??(()=>{throw Error('Unexpected import '+id)})(),Set,Map,URL,console});
  const rows=await module.exports.readOntologyMetadata(['https://example.org/Child']);
  assert.equal(rows.length,1);
  assert.equal(rows[0].parent,'https://example.org/Parent');
  assert.equal(calls.length,1);
  assert.match(calls[0],/GRAPH \?g/);
});
