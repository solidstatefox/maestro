import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(path,'utf8');
test('Status exactly restores existing session-scoped personal reader without retries',()=>{
  const source=read('src/app/proxy/api/fct/route.ts');
  const block=source.slice(source.indexOf('if (compiled.view === FCT_VIEW_TYPES.LIST_STATUS'),source.indexOf('const isValidate =',source.indexOf('if (compiled.view === FCT_VIEW_TYPES.LIST_STATUS')));
  assert.match(block,/parsed = await queryPersonalSparql\(query, compiled\.timeoutMs, request\)/);
  assert.match(block,/PersonalSparqlHttpError/);
  assert.match(block,/getPersonalStatusGraph\(request\)/);
  assert.match(block,/cloneFctListStatusView\(bookmarkQueryXml\)/);
  assert.doesNotMatch(block,/executeSparql\(personalEndpoint|queryPersonalStatusSparql|sparql-auth|retry/i);
});
test('Sunburst textPath is curved, local-only, and remains XSLT owned',()=>{
  const xslt=read('graph/sunburst/provider.ttl');
  const host=read('src/canvas/left/facet-presentation.tsx');
  assert.match(xslt,/<textPath href="\{concat\('#',\$arc-id\)\}" startOffset="50%">/);
  assert.match(xslt,/name="reverse"/);
  assert.match(xslt,/name="caption"/);
  assert.match(xslt,/name="total" select="\$total"/);
  assert.match(host,/"textpath","defs"/);
  assert.match(host,/\^#maestro-sunburst-label-/);
  assert.match(host,/"href" && \(child\.localName/);
});
