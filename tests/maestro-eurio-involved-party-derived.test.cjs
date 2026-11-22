const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
const ttl = read('graph/eu-data/involved-party-derived.ttl');
const manifest = JSON.parse(read('graph/manifest.json'));
const curator = read('graph/maestro-curation-providers.ttl');

const captureDefinitions = [
  ['Organization','organization','1'],
  ['Role','role','2'],
  ['Id','id','3'],
];

test('EU provider reuses the Email regex-derived FacetProvider contract and seeds normally', () => {
  assert.match(ttl, /a mui:Provider, mui:FacetProvider/);
  assert.match(ttl, /mui:accepts <gttp:\/\/ggg\.maestro\.ecosys\/eu-data\/provider\/involved-party-input>/);
  assert.match(ttl, /sh:property \[ sh:path eurio:hasInvolvedParty \]/);
  assert.match(ttl, /mui:sourcePattern /);
  assert.equal(manifest['eu-data/involved-party-derived.ttl'], 'shacl-policies');
  assert.match(curator, /rdf:first <gttp:\/\/ggg\.maestro\.ecosys\/eu-data\/provider\/involved-party>/);
  assert.doesNotMatch(ttl, /schema:email|foaf:mbox|mailto:|email-username/);
});

test('three separate named filterable fields are registered and use pickaxe', () => {
  for (const [label, slug, index] of captureDefinitions) {
    assert.match(ttl, new RegExp(`<gttp://ggg\\.maestro\\.ecosys/eu-data/derived/involved-party-${slug}> a mui:DerivedFacet ;[\\s\\S]*?rdfs:label "hasInvolvedParty: ${label}"@en ;[\\s\\S]*?mui:icon "pickaxe" ;[\\s\\S]*?mui:resultPredicate <gttp://ggg\\.maestro\\.ecosys/eu-data/derived/involved-party#${slug}> ;[\\s\\S]*?mui:capture "${index}" \\.`));
  }
  const pane = read('src/canvas/left/personal-widget-cards.tsx');
  assert.match(pane, /boundNode\?\.attributes\.derive === "regex" && <Pickaxe/);
  assert.match(pane, /boundNode\?\.attributes\.label \|\| facetPropertyLabel\(widget\.uri\)/);
  const discover = read('src/lib/client-derived-facet-providers.ts');
  assert.match(discover, /\?shape sh:property\/sh:path <\$\{property\}>/);
  assert.match(discover, /readClientPolicyApprovals\(candidates/);
});

test('the actual Org Role Project format generates three captures without extra parsing code', () => {
  const line = ttl.match(/mui:sourcePattern "([^"\n]*)"/);
  assert.ok(line);
  const re = new RegExp(JSON.parse('"'+line[1]+'"'));
  const values = [
    ['Org: XYZ University / Role: coordinator / Project: P-12345',
      ['XYZ University','coordinator','P-12345']],
    ['Org: European Research Centre / Role: Participant / Project: 1011223',
      ['European Research Centre','Participant','1011223']],
    ['  Org:  A B  / Role:  lead  / Project:  P-XYZ  ',
      ['A B','lead','P-XYZ']],
  ];
  for (const [source, expected] of values) {
    const match = re.exec(source);
    assert.ok(match, `unmatched: ${source}`);
    assert.deepEqual(match.slice(1,4), expected);
    for (const [index, value] of expected.entries()) assert.equal(source.replace(re, `$${index+1}`), value);
  }
  assert.equal(re.test('This is not an involved-party value'), false);
});

test('timeline pin is start plus duration, never current date; humanization keeps exact RDFa', () => {
  const stylesheet = read('graph/eu-data/record.xsl');
  const ttlRecord = read('graph/eu-data/provider.ttl');
  for (const source of [stylesheet, ttlRecord]) {
    assert.match(source, /<xsl:function name="fmt:months"/);
    assert.match(source, /floor\(\$durationMonths\)/);
    assert.match(source, /\$durationEnd - xs:date\(substring\(\$startValue/);
    assert.match(source, /fmt:months\(string\(\$durationRow\/fct:column\[3\]\)\)/);
    assert.doesNotMatch(source, /durationPosition" select="if \(\$validDates\) then \$percent else 50"/);
    assert.match(source, /<xsl:call-template name="project-value-attributes"><xsl:with-param name="row" select="\$durationRow"\/>/);
  }
});

test('retired Map discovery remains absent, repaired on dev start', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.predev, /repair-stale-view-chunks/);
  assert.doesNotMatch(read('src/canvas/tab/view/ribbon.tsx'), /map-provider-discovery/);
});
