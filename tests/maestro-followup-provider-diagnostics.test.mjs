/** Add-on regression tests for the root-breadcrumb accepted patch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Lucide SHACL diagnostic icons use HTML tooltip wrapper, not invalid SVG title prop', () => {
  const jsx = read('src/canvas/top/view-diagnostics-hover.tsx');
  assert.match(jsx, /<span[^>]+title=\{entry\.validation/);
  assert.match(jsx, /<Indicator className=\{`size-3\.5 \$\{color\}`\} aria-label=/);
  assert.doesNotMatch(jsx, /<Indicator[^>]*\stitle=/);
});

test('generic calendar provider is an opt-in SHACL datatype policy', () => {
  const rdf = read('graph/maestro-personal-perspectives.ttl');
  const curator = read('graph/maestro-curation-providers.ttl');
  assert.match(rdf, /shacl\/provider\/temporal-inferred> a mui:Provider/);
  assert.match(rdf, /sh:qualifiedValueShape \[ sh:in \([\s\S]*?xsd:date[\s\S]*?xsd:dateTime[\s\S]*?xsd:gYear[\s\S]*?xsd:gYearMonth[\s\S]*?\) \]/);
  assert.match(rdf, /sh:qualifiedMinCount 1/);
  assert.doesNotMatch(rdf.split('shacl/provider/temporal-inferred> a mui:Provider')[1], /sh:path <http:\/\/dbpedia\.org/);
  assert.match(curator, /rdf:first <gttp:\/\/ggg\.maestro\.ecosys\/shacl\/provider\/temporal-inferred>/);
  const registry = read('graph/manifest.json');
  assert.match(registry, /maestro-personal-perspectives\.ttl/);
  assert.match(registry, /maestro-curation-providers\.ttl/);
});

test('Calendar eligibility comes from actual SHACL validation and remains approval gated', () => {
  const source = read('src/lib/client-facet-providers.ts');
  assert.match(source, /\?shape a mui:InputShape ; sh:property\/sh:path mui:inferredDatatype/);
  assert.match(source, /readClientShaclShapeTriples\(shape,signal\)/);
  assert.match(source, /validateClientShaclRows\(shape,focus,shapeRows,evidence\.map/);
  assert.match(source, /if \(!evidence\.length\) continue/);
  assert.match(source, /readClientPolicyApprovals\(unique\(/);
  assert.match(source, /temporal:dates\.filter\(p=>approved\.has\(p\.uri\)\)/);
  assert.match(source, /tags:tags\.filter\(p=>approved\.has\(p\.uri\)\)/);
});

test('diagnostic catalog includes curators and OTC providers with scoped SHACL evidence', () => {
  const source = read('src/lib/client-provider-diagnostics.ts');
  assert.match(source, /otcGraph = `\$\{ctx\.base\}\/otc\/transcoders`/);
  assert.match(source, /\?uri a mui:CurationProvider/);
  assert.match(source, /\?report sh:result\/sh:focusNode \?uri/);
  assert.match(source, /\?report a sh:ValidationReport/);
  assert.match(source, /mui:lastRequestComponent/);
  assert.match(source, /"unknown"/);
});

test('appbar navigation uses shadcn outlined joined buttons with no bespoke dark wrapper', () => {
  const appbar = read('src/canvas/top/appbar-pane.tsx');
  const group = appbar.split('<ButtonGroup aria-label="Graph navigation"')[1]?.split('</ButtonGroup>')[0] ?? '';
  assert.ok(group);
  assert.equal((group.match(/variant="outline"/g) ?? []).length, 5);
  assert.doesNotMatch(group, /variant="ghost"|rounded-none|bg-slate-900/);
  assert.match(appbar, /data-slot="button-group"|<ButtonGroup aria-label="Current query bookmark"/);
});

test('all changed TSX and TS files parse cleanly', () => {
  for (const p of [
    'src/canvas/top/appbar-pane.tsx', 'src/canvas/top/view-diagnostics-hover.tsx',
    'src/lib/client-provider-diagnostics.ts', 'src/lib/client-facet-providers.ts',
  ]) {
    const ast = ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, p.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.deepEqual(ast.parseDiagnostics.map(d=>String(d.messageText)), [], p);
  }
});
