import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = file => fs.readFileSync(file,'utf8');

test('legacy Status 401 trace remains intact while the SPA avoids federation',()=>{

  const accessSource = process.getBuiltinModule('node:fs').readFileSync("src/lib/app-lifecycle/access.ts", 'utf8');
  const controllerSource = process.getBuiltinModule('node:fs').readFileSync("src/canvas/controllers/authentication.ts", 'utf8');
  assert.ok(accessSource.includes('SESSION_OBSERVED'));
  assert.ok(accessSource.includes('signedOut: {}'));
  assert.ok(accessSource.includes('signedIn: {'));
  assert.ok(accessSource.includes('const policyReady = sessionReady && snapshot.context.policyStage === "ready"'));
  assert.ok(controllerSource.includes('useState<PersonalAuthSession | null>(null)'));
  assert.ok(controllerSource.includes('await restoreDigestSession(attempt.signal)'));

      const client = process.getBuiltinModule('node:fs').readFileSync("src/lib/fct-client.ts", 'utf8');
      assert.ok(client.includes('isClientQueryBookmarked(liveXml, signal)'));
      assert.ok(client.includes('compileFctXmlToSparql(fctQuery'));
      assert.ok(client.includes('cachedFetchFct("/proxy/api/sparql"'));
      assert.ok(!client.slice(client.indexOf('export async function fctStatusFacet(')).includes('cachedFetchFct("/proxy/api/fct"'));
    
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
