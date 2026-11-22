const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const mapping=JSON.parse(read('graph/graph-registry.json'));
const manifest=JSON.parse(read('graph/manifest.json'));
test('one file-backed graph registry is authoritative for all seed destinations',()=>{
  assert.equal(mapping['state-machines'],'{base}/state-machines');
  assert.equal(mapping.status,'{base}/status');
  assert.equal(manifest['maestro-status-machines.ttl'],'state-machines');
  for(const [file,key] of Object.entries(manifest))
    assert.ok(mapping[key],`${file} references missing graph key ${key}`);
  assert.equal(new Set(Object.values(manifest)).size,5);
});
test('Status definitions and assertions use distinct graph keys and existing XState compiler',()=>{
  const client=read('src/lib/status-machine-client.ts');
  const server=read('src/lib/status-machine-server.ts');
  const bootstrap=read('src/lib/client-auth-bootstrap.ts');
  assert.match(client,/resolveGraph\(GRAPH\.STATE_MACHINES, ctx\.base\)/);
  assert.match(server,/resolveGraph\(GRAPH\.STATE_MACHINES, getUserGraph\(request\)\)/);
  assert.match(bootstrap,/compileStatusMachines\(statusMachineRows\(machineRows\)\)/);
  assert.match(bootstrap,/resolveGraph\(GRAPH\.STATUS,base\)/);
  assert.match(bootstrap,/resolveGraph\(GRAPH\.APPBAR,base\)/);
  assert.match(bootstrap,/resolveGraph\(GRAPH\.BOOKMARKS,base\)/);
});
test('proxy has no Maestro cookie authorization gate; Digest is upstream authority',()=>{
  const server=read('src/lib/personal-sparql.ts');
  const probe=read('src/lib/client-auth-probe.ts');
  assert.doesNotMatch(server,/request\.headers\.get\("cookie"\)/);
  assert.match(server,/request\.headers\.get\("x-personal-auth"\)/);
  assert.match(server,/fetchWithDigestFallback\(endpoint,/);
  assert.doesNotMatch(probe,/document\.cookie|setMaestroSessionCookie/);
});
test('private FCT and SPARQL responses bypass every shared cache',()=>{
  const fct=read('src/app/proxy/api/fct/route.ts');
  const sparql=read('src/app/proxy/api/sparql/route.ts');
  const browser=read('src/lib/client-query-cache.ts');
  assert.match(fct,/const privateExecution = Boolean\(/);
  assert.equal(/privateExecution \|\| hasStatusConstraints \|\| isValidate \|\| componentRetry\) \? null : getQueryCache/.test(fct), true);
  assert.match(sparql,/privateRequest = Boolean\(/);
  assert.match(sparql,/bypassCache \|\| authorization/);
  assert.match(browser,/if \(scoped\.authenticated\) return track\(await monitoredProxyFetch/);
});
test('graph digest is scoped to authenticated personal graph results, not a stale proxy cache',()=>{
  const sparql=read('src/app/proxy/api/sparql/route.ts');
  assert.match(sparql,/body\?\.operation === "graph-list-digest"/);
  assert.match(sparql,/queryPersonalSparql\(query,queryTimeoutMs\?\?20000,request\)/);
  assert.match(sparql,/provided===digest\?\{unchanged:true,digest\}/);
});
