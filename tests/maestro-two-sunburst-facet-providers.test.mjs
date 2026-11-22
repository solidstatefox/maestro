import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(name, 'utf8');
const providers = ['category-sunburst','category-sunburst-chartkit'];

test('both Sunbursts are independently seeded, curated, approval-gated mui:FacetProvider instances', () => {
  const manifest=JSON.parse(read('graph/manifest.json'));
  const curator=read('graph/maestro-curation-providers.ttl');
  const host=read('src/canvas/left/facet-presentation.tsx');
  assert.equal(manifest['sunburst/provider.ttl'], 'shacl-policies');
  assert.equal(manifest['sunburst-chartkit/provider.ttl'], 'shacl-policies');
  for (const name of providers) {
    const path = name === 'category-sunburst' ? 'graph/sunburst/provider.ttl' : 'graph/sunburst-chartkit/provider.ttl';
    const rdf=read(path);
    assert.match(rdf, new RegExp(`<gttp://ggg\\.maestro\\.ui/provider/${name}> a mui:Provider, mui:FacetProvider`));
    assert.match(rdf,/mui:accepts/);
    assert.match(rdf,/a mui:InputShape, sh:NodeShape/);
    assert.match(rdf,/sh:path rdf:type/);
    assert.match(rdf,/mui:facetDirection "class"/);
    assert.match(rdf,/a mui:FacetWidget/);
    assert.match(rdf,/mui:templateContent """<\?xml/);
    assert.match(rdf,/hierarchy\/node/);
    assert.match(rdf,/xsl:for-each select="node"/);
    assert.match(rdf,/data-facet-value="\{@uri\}"/);
    assert.ok(curator.includes(`<gttp://ggg.maestro.ui/provider/${name}>`));
  }
  assert.match(host,/readClientPolicyApprovals/);
  assert.match(host,/candidates\.filter\(row=>approved\.has\(row\.uri\)\)/);
  assert.match(host,/presentation\.providers\.map\(/);
  assert.match(host,/presentation\.select\(/);
});

test('the Facets catalog does not constrain mui:widget as the FCT focus', () => {
  const fct=read('src/lib/provider-fct-query.ts');
  const branch=fct.split('} else if (providerKind === "facet-widgets") {')[1]?.split('} else {')[0];
  assert.ok(branch, 'facet catalog branch exists');
  assert.match(branch,/node\("provider-facet-provider", "class", `\$\{MUI\}FacetProvider`\)/);
  assert.doesNotMatch(branch,/provider-facet-widget|FacetWidget/);
  assert.match(fct,/hasClass\(children, `\$\{MUI\}FacetProvider`\)/);
  for (const item of ['graph/maestro-ui-ontology.ttl','graph/rdfs/maestro-ui-ontology.ttl']) {
    assert.match(read(item),/mui:FacetProvider a owl:Class ; rdfs:subClassOf mui:Provider/);
  }
  for (const item of ['graph/numeric/provider.ttl','graph/tag-cloud/provider.ttl','graph/email-regex/provider.ttl']) {
    assert.match(read(item),/a mui:Provider, mui:FacetProvider/);
  }
  assert.equal((read('graph/maestro-personal-perspectives.ttl').match(/a mui:Provider, mui:FacetProvider/g)??[]).length,3);
});

test('the chart-kit-style Sunburst is an XSLT chart of live hierarchy, not a static revenue example', () => {
  assert.equal(fs.existsSync('src/components/charts/chart-sunburst-default.tsx'), false);
  const rdf=read('graph/sunburst-chartkit/provider.ttl');
  assert.doesNotMatch(rdf,/name: "Revenue"|North America|Consulting|Product brings/);
  assert.match(rdf,/f:weight\(\$child\)/);
  assert.match(rdf,/xsl:for-each select="node"/);
  assert.match(rdf,/xsl:with-param name="branch" select="\$branch"/);
  assert.match(rdf,/data-facet-label-style="arc"/);
  assert.match(rdf,/data-facet-label-style="radial"/);
  assert.match(rdf,/format-number\(100 \* \$span/);
  assert.match(rdf,/xsl:value-of select="count\(item\)"/);
  const host=read('src/canvas/left/facet-presentation.tsx');
  assert.match(host,/tree\.map\(node=>serializeNode\(node,0\)\)/);
  assert.match(host,/transformWithMaestroSaxon\(provider\.stylesheet,source/);
  assert.doesNotMatch(host,/category-sunburst-chartkit/);
});
