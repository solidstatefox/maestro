const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const stylesheet = fs.readFileSync(path.join(root, 'graph/eu-data/record.xsl'), 'utf8');
const provider = fs.readFileSync(path.join(root, 'graph/eu-data/provider.ttl'), 'utf8');

// The Record template host validates every HTML/SVG element in the rendered
// document, including non-interactive nested SVG shapes. A missing id makes
// the entire Project Record fail to render.
test('every literal SVG element emitted by EU Project XSLT has an explicit, nonempty id', () => {
  const svgTag = /<(svg|path|circle|rect|line|g|polyline|polygon|ellipse)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  const tags = [...stylesheet.matchAll(svgTag)];
  assert.ok(tags.length > 15, 'expected status icons, separators and DOI icons');
  for (const [, name, attrs] of tags) {
    assert.match(attrs, /(?:^|\s)id="[^"]+"/, `Rendered <${name}> lacks required id: ${attrs}`);
  }
});

test('header separators and children have distinct stable ids', () => {
  for (const prefix of ['eu-project-acronym-separator', 'eu-project-status-separator']) {
    assert.match(stylesheet, new RegExp(`<svg\\b[^>]*\\bid="${prefix}"[^>]*><path\\b[^>]*\\bid="${prefix}-dot"`));
  }
  const ids = ['eu-project-acronym-separator', 'eu-project-acronym-separator-dot', 'eu-project-status-separator', 'eu-project-status-separator-dot'];
  for (const id of ids) assert.equal(stylesheet.split(`id="${id}"`).length - 1, 1, `${id} must appear only once in standalone stylesheet`);
});

test('both RDF-embedded EU Project stylesheets are synchronized with the standalone stylesheet', () => {
  const embedded = [...provider.matchAll(/mui:templateContent """([\s\S]*?)"""/g)];
  assert.equal(embedded.length, 3, 'expected perspective, record, and results stylesheets');
  for (const [i, match] of embedded.entries()) {
    if (i > 1) break;
    assert.equal(match[1].replace(/\\\\/g, '\\'), stylesheet, `embedded stylesheet ${i} is stale`);
  }
});
