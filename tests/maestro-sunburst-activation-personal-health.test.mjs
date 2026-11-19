import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(name,'utf8');

test('approved facet presentation activates automatically, with reversible user override',()=>{
  const s=read('src/canvas/left/facet-presentation.tsx');
  assert.match(s,/const active = !!provider && \(choice\.scope!==scope \|\| choice\.active\)/);
  assert.match(s,/setChoice\(\{scope, uri:provider\.uri,active:!active\}\)/);
  assert.match(s,/if\(providers\.some\(row=>row\.uri===uri\)\)setChoice\(\{scope,uri,active:true\}\)/);
  assert.match(s,/onToggle\(uri,!item\.selected\)/);
});

test('personal SPARQL transport reports server 5xx and success to the graph-server registry without exposing query or HTML',()=>{
  const transport=read('src/lib/client-personal-sparql.ts');
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(transport,/PERSONAL_SPARQL_HEALTH_EVENT/);
  assert.match(transport,/response\.ok \|\| response\.status>=500/);
  assert.match(transport,/endpointUrl,status/);
  assert.match(transport,/sanitizeUpstreamDiagnostic\(upstream\)/);
  assert.match(transport,/Personal SPARQL returned HTTP \$\{response\.status\}/);
  assert.match(controller,/addEventListener\(PERSONAL_SPARQL_HEALTH_EVENT,onPersonalHealth\)/);
  assert.match(controller,/graphServerUrlMatches\(item\.url,endpointUrl,item\.schemeInferred\)/);
  assert.match(controller,/status >= 500 \? "server-error" : status === 401 \? "http-error" : "ok"/);
});
