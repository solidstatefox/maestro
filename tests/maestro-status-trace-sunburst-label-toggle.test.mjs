import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = file => fs.readFileSync(file,'utf8');

test('legacy Status 401 trace remains intact while the SPA avoids federation',()=>{
  const route=read('src/app/proxy/api/fct/route.ts');
  const block=route.slice(route.indexOf('if (compiled.view === FCT_VIEW_TYPES.LIST_STATUS'),route.indexOf('const isValidate ='));
  assert.match(block,/queryPersonalSparql\(query, compiled\.timeoutMs, request\)/);
  assert.match(block,/proxyLog\("debug", "status\.sparql\.request"/);
  assert.match(block,/proxyLog\("debug", "status\.sparql\.failure"/);
  assert.match(block,/getPersonalStatusGraph\(request\)/);
  assert.match(block,/"X-Maestro-Status-Debug"/);
  assert.match(block,/MAESTRO_STATUS_DEBUG_UNSAFE/);
  assert.match(block,/process\.env\.NODE_ENV !== "production"/);
  assert.doesNotMatch(block,/queryPersonalStatusSparql|fetchWithDigestFallback|oneReadAuthUrl/);
  const client=read('src/lib/fct-client.ts');
  assert.match(client,/isClientQueryBookmarked\(liveXml, signal\)/);
  assert.match(client,/compileFctXmlToSparql\(fctQuery/);
  assert.match(client,/cachedFetchFct\("\/proxy\/api\/sparql"/);
  assert.doesNotMatch(client.slice(client.indexOf("export async function fctStatusFacet(")),/cachedFetchFct\("\/proxy\/api\/fct"/);
  assert.doesNotMatch(client,/\b(?:window\.)?console\.(?:debug|log|warn|error)\s*\(/);
});

test('Sunburst provides two provider-owned label modes switched by a host Base UI toggle group',()=>{
  const ttl=read('graph/sunburst/provider.ttl');
  const host=read('src/canvas/left/facet-presentation.tsx');
  assert.doesNotMatch(ttl,/data-facet-label-toggle=/);
  assert.match(ttl,/data-facet-label-style="arc"/);
  assert.match(ttl,/data-facet-label-style="radial"/);
  assert.match(ttl,/<textPath href=/);
  assert.match(ttl,/transform="\{concat\('rotate\('/);
  assert.match(host,/<ToggleGroup type="single" aria-label="Sunburst label layout" value=\{labelStyle\}/);
  assert.match(host,/onValueChange=\{value=>\{if\(value==="radial" \|\| value==="arc"\)setLabelStyle\(value\)/);
  assert.match(host,/root\.querySelectorAll<SVGGElement>\("\[data-facet-label-style\]"\)/);
  assert.doesNotMatch(host,/data-facet-label-toggle/);
  assert.match(host,/name==="transform"/);
});
