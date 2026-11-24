const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const get = p => fs.readFileSync(path.join(root, p), 'utf8');

// The standalone formatter is the public source of the two embedded Record XSLT declarations.
test('Research Result supports ontology authorList and CORDIS-example author literals', () => {
  for (const name of ['graph/eu-data/record.xsl', 'graph/eu-data/provider.ttl']) {
    const xsl = get(name);
    const result = xsl.slice(xsl.indexOf('<xsl:template name="RecordResult">'));
    assert.match(result, /name="authorRows"[^\n]*concat\(\$eu,'authorList'\),concat\(\$eu,'author'\)/);
    assert.match(result, /tokenize\(replace\(string\(\$row\/fct:column\[3\]\)/);
    assert.match(result, /string-join\(\$authorNames, ', '\)/);
    assert.match(result, /eu-result-author-rdfa/);
    // Domain types are visible links; raw rdf:type remains available as RDFa only.
    const subtitle = result.match(/<p id="eu-result-domain-types"[\s\S]*?<\/p>/);
    assert.ok(subtitle, `${name} missing domain type subtitle`);
    assert.match(subtitle[0], /select="\$resultTypeRows"/);
    assert.match(subtitle[0], /name="project-atom"/);
    assert.doesNotMatch(subtitle[0], /\$typeRows|\$rdfType/);
    assert.match(result, /<xsl:for-each select="\$typeRows">\s*<span id="eu-result-rdf-class-\{position\(\)\}" class="sr-only">\s*<xsl:call-template name="project-value-attributes">/);
    assert.doesNotMatch(result, /eu-result-rdf-types/);
    assert.match(result, /eu-result-inverse/);
    for (const term of ['workPerformed','finalResults','periodFrom','periodTo','publishedYear','journalTitle','publisher','hasResultType']) {
      assert.ok(result.includes(term), `${name} missing ${term}`);
    }
  }
});

test('Author derived facet targets both documented predicates and remains a query-derived facet', () => {
  const provider = get('graph/eu-data/author-derived.ttl');
  assert.match(provider, /sh:or \( \[ sh:property \[ sh:path eurio:authorList \] \]/);
  assert.match(provider, /\[ sh:property \[ sh:path eurio:author \] \] \) \./);
  assert.match(provider, /mui:splitPattern "\\\\s\*;\\\\s\*\|\\\\s\+and\\\\s\+"/);
  const discovery = get('src/lib/client-derived-facet-providers.ts');
  assert.match(discovery, /mui:splitPattern \?splitPattern/);
  const spawn = get('src/lib/fct-derived-facets.ts');
  assert.match(spawn, /derive:field.mode === "split" \? "split" : "regex"/);
  for(const compiler of ['src/lib/fct-sparql-translator.ts','src/lib/fct-count-sparql.ts']) {
    const source = get(compiler);
    assert.match(source, /attributes.derive === "split"/);
    assert.match(source, /attributes.pid/);
    assert.match(source, /STRLEN/);
  }
});

test('Generic Record loading and breadcrumb trial spacing are isolated changes', () => {
  const pane = get('src/canvas/right/pane.tsx');
  assert.doesNotMatch(pane, /Loading linked Results and DOI metadata/);
  assert.match(pane, /Loading record \(formatted\)/);
  const crumbs = get('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(crumbs, /\/\/ const BREADCRUMB_NODE_BOTTOM_PADDING = "pb-1"/);
  assert.match(crumbs, /const BREADCRUMB_NODE_BOTTOM_PADDING = "pb-0"/);
});
