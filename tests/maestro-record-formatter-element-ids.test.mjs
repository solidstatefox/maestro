import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const policies = readFileSync(new URL('../graph/maestro-dbpedia-policies.ttl', import.meta.url), 'utf8');
const recordTemplates = ['Book', 'Film', 'Organisation', 'Person', 'Place', 'Species', 'Work'];

// The Record renderer requires an explicit id on every element output by an
// XSLT stylesheet. Validate ALL literal-result elements, not just the fields
// visible in a particular Record test fixture.
const startTag = /<([A-Za-z][\w:.-]*)(?:(?:"[^"]*"|'[^']*'|[^'">])*)>/g;

for (const kind of recordTemplates) {
  test(`DBpedia ${kind} Record formatter gives every literal-result element an ID`, () => {
    const name = `Dbpedia${kind}RecordTemplate`;
    const marker = `<gttp://ggg.maestro.ecosys/shacl/template#${name}>`;
    const begin = policies.indexOf(marker);
    assert.ok(begin >= 0, `Missing ${name}`);
    const valueMarker = 'rdf:value """';
    const valueStart = policies.indexOf(valueMarker, begin);
    assert.ok(valueStart > begin && valueStart - begin < 1000, `Missing stylesheet for ${name}`);
    const stylesheetStart = valueStart + valueMarker.length;
    const stylesheetEnd = policies.indexOf('"""', stylesheetStart);
    assert.ok(stylesheetEnd > stylesheetStart, `Unterminated stylesheet for ${name}`);
    const stylesheet = policies.slice(stylesheetStart, stylesheetEnd);
    let checked = 0;
    for (const match of stylesheet.matchAll(startTag)) {
      const [tag, qualifiedName] = match;
      if (qualifiedName.startsWith('xsl:')) continue;
      checked++;
      assert.match(tag, /\sid="[^"]+"/, `Missing an explicit id on <${qualifiedName}> in ${name}: ${tag.slice(0, 180)}`);
    }
    assert.ok(checked > 10, `${name} should contain rendered elements`);
  });
}

test('incoming Role values have unique group-and-item identities', () => {
  const examples = policies.match(/id="record-role-value-\{\$roleIndex\}-\{position\(\)\}"/g) || [];
  assert.equal(examples.length, recordTemplates.length);
  const roleGroups = policies.match(/id="record-role-\{\$roleIndex\}"/g) || [];
  assert.equal(roleGroups.length, recordTemplates.length);
});

test('Place coordinate RDFa retains independently addressable elements', () => {
  for (const id of ['record-coordinate-latitude', 'record-coordinate-longitude', 'record-coordinate-geopoint', 'record-coordinate-separator'])
    assert.ok(policies.includes(`id="${id}"`), `Missing Place coordinate ID ${id}`);
});
