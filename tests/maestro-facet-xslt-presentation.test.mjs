import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const at = (name) => fs.readFileSync(path.join(process.cwd(),name),'utf8');

test('Categories presentation is provider driven and the old React visual is absent',()=>{
  const facet=at('src/canvas/left/filter-pane.tsx');
  const host=at('src/canvas/left/facet-presentation.tsx');
  assert.match(facet,/useFacetPresentation/);
  assert.match(facet,/onToggle=\{toggleClass\}/);
  assert.match(host,/readClientPolicyApprovals/);
  assert.match(host,/transformWithMaestroSaxon/);
  assert.match(host,/onToggle\(uri,!item\.selected\)/);
  assert.doesNotMatch(facet,/CategorySunburst|categorySunburstMode/i);
  assert.equal(fs.existsSync('src/canvas/left/category-sunburst.tsx'),false);
});

test('provider is registered as a SHACL-applicable approved facet renderer',()=>{
  const provider=at('graph/sunburst/provider.ttl');
  const manifest=JSON.parse(at('graph/manifest.json'));
  const curator=at('graph/maestro-curation-providers.ttl');
  assert.equal(manifest['sunburst/provider.ttl'],'shacl-policies');
  assert.match(curator,/<gttp:\/\/ggg\.maestro\.ui\/provider\/category-sunburst>/);
  for(const required of ['a mui:Provider','a mui:InputShape, sh:NodeShape','sh:path rdf:type','a mui:FacetWidget','mui:templateContent','math:cos','math:sin','data-facet-value']) assert.ok(provider.includes(required),required);
});

test('untrusted provider markup has allowlisted SVG and no inline actions',()=>{
  const host=at('src/canvas/left/facet-presentation.tsx');
  assert.match(host,/const ALLOWED = new Set/);
  assert.match(host,/const ATTRS = new Set/);
  assert.match(host,/child\.removeAttribute\(attr\.name\)/);
  assert.match(host,/validIri\(attr\.value\)/);
});
