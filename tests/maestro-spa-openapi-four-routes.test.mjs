import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=process.cwd();
const read=(name)=>readFileSync(join(root,name),'utf8');
const sha=(name)=>createHash('sha256').update(readFileSync(join(root,name))).digest('hex');
const protectedHashes={
  'fct':'965ece14499354bd5ad8281cb15918b4207d468b1fa47cbd20845b816d4c2330',
};
test('URI observations are an OpenAPI operation; FCT preserves native request transport',()=>{
  assert.ok(!existsSync('src/app/proxy/api/observations/route.ts'));
  assert.match(read('src/app/proxy/api/service/route.ts'),/processUriObservationBatch/);
  const fct = read('src/app/proxy/api/fct/route.ts');
  assert.match(fct, /compileFctXmlBase/);
  assert.match(fct, /request.headers.get\("x-maestro-language"\)/);
  assert.match(fct, /labelAcceptLanguage/);
});
test('/service handles only allowlisted OpenAPI operations',()=>{
  const route=read('src/app/proxy/api/service/route.ts');
  assert.match(route,/resolveOpenApiOperation/);
  assert.doesNotMatch(route,/dispatchMaestroService/);
  assert.match(route,/operation\.serviceKey/);
  assert.match(route,/pathParameters/);
  assert.doesNotMatch(route,/fetch\([^\n]*body\.url/);
});
test('URI observation beacon and POST both use the registered OpenAPI service',()=>{
  const browser=read('src/lib/uri-labels.ts');
  assert.match(browser,/sendBeacon\("\/proxy\/api\/service"/);
  assert.match(browser,/observeProxyFetch\("\/proxy\/api\/service"/);
  assert.match(browser,/operationId: "recordUriObservations"/);
});
test('three deliberate transport routes with local OpenAPI telemetry; no legacy server operations',()=>{
  const target=['fct','service','sparql'].sort();
  const routes=readdirSync(join(root,'src/app/proxy/api'),{withFileTypes:true})
    .filter(entry=>entry.isDirectory()&&existsSync(join(root,'src/app/proxy/api',entry.name,'route.ts'))).map(entry=>entry.name).sort();
  assert.deepEqual(routes,target);
  assert.equal(existsSync(join(root,'src/app/proxy/api/service/operations.ts')),false);
});
test('browser-side providers and OTC workflows no longer invoke Maestro RPC',()=>{
  const paths=['src/canvas/controllers/authentication.ts','src/canvas/tab/view/ribbon.tsx',
    'src/lib/client-otc-runner.ts','src/components/ai-elements/basic-chat.tsx',
    'src/canvas/utils/workspace-controller.tsx'];
  for(const path of paths){const code=read(path);assert.doesNotMatch(code,/\/proxy\/api\/forward|service\?service=maestro/,path);}
});
test('original SPARQL policy bookmark gate is supplied by browser status transitions',()=>{
  assert.match(read('src/lib/client-personal-sparql.ts'),/bookmarkQueryXml/);
  assert.match(read('src/lib/client-status-writes.ts'),/signal, queryXml\)/);
});

test('SPARQL remains the same route, with bounded autocomplete priority for rank and timeout',()=>{
  const route=read('src/app/proxy/api/sparql/route.ts');
  assert.match(route,/requestClass === "autocomplete"/);
  assert.match(route,/LONG::IRI_RANK/);
  assert.match(route,/candidateLimits\[0\] > 10/);
  assert.match(route,/queryTimeoutMs \|\| 5000/);
});
