const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');

const source = file => fs.readFileSync(file, 'utf8');
function loadTs(file, stubs = {}) {
  const js = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', js)(module, module.exports, name => {
    if (!(name in stubs)) throw Error(`Unexpected dependency: ${name}`);
    return stubs[name];
  });
  return module.exports;
}

const compiler = loadTs('src/lib/fct-count-sparql.ts', {
  './maestro-language': { effectiveMaestroLanguage: () => 'en', validMaestroLanguage: v => v },
  './maestro-kinds': { MAESTRO_KIND_IDS: [], normalizeMaestroKind: v => v, maestroKindSparql: () => 'false' },
  './fct-value-references': loadTs('src/lib/fct-value-references.ts'),
  './graph-address-mode': { ALL_GRAPHS: 'Everywhere' },
  './fct-value-policy': { normalizeFctValue: v => v ?? '' },
  './virtuoso-full-text': { buildVirtuosoFullTextExpression: v => `\"${v.toUpperCase()}\"` },
  './virtuoso-numeric-coercion': { guardedNumericRangeFilter: () => 'true', numericFacetBinding: () => 'FILTER(isNumeric(?facetValue))', NUMERIC_FACET_PROJECTION: 'xsd:decimal(?facetValue)' },
});
const n = (name, attributes = {}, children = [], id = name) => ({ name, attributes, children, id });
const example = () => ({ name: 'query', attributes: { id: 'a', addr: '@https://cordis.europa.eu/datalab/sparql' }, children: [
  n('class', { iri: 'http://data.europa.eu/s66#Project' }),
  n('property', { iri: 'http://data.europa.eu/s66#duration', rid: 'd' }, [], 't'),
  n('property', { iri: 'http://data.europa.eu/s66#hasResult', rid: 'f' }, [
    n('property', { iri: 'http://data.europa.eu/s66#doi', rid: 'g' }, [], 'z'),
  ], 'y'),
  n('view', { type: 'text', limit: '30' }, [], 's'),
] });

test('an <a> at query root or under a relationship cannot change the native distinct-count scope', () => {
  const basic = example();
  const original = compiler.buildFctCountSparql(basic);
  assert.ok(original?.includes('COUNT(DISTINCT'), 'base count should compile');
  const rootAlias = structuredClone(basic);
  rootAlias.children.splice(-1, 0, n('a', { href: 'z' }, [], 'ae'));
  assert.equal(compiler.buildFctCountSparql(rootAlias), original);
  const nestedAlias = structuredClone(basic);
  nestedAlias.children[2].children[0].children.push(n('a', { href: 'z' }, [], 'af'));
  assert.equal(compiler.buildFctCountSparql(nestedAlias), original);
});

test('numeric MIN/MAX and temporal domains remain available when a viewer-only <a> is present', () => {
  const query = example();
  query.children.splice(-1, 0, n('a', { href: 'z' }, [], 'ae'));
  const numeric = compiler.buildFctCountSparql(query, {
    predicate: 'http://data.europa.eu/s66#duration',
    projections: [
      { aggregate: 'MIN', expression: 'xsd:decimal(?facetValue)', alias: 'min' },
      { aggregate: 'MAX', expression: 'xsd:decimal(?facetValue)', alias: 'max' },
    ],
  });
  assert.match(numeric ?? '', /MIN\(xsd:decimal\(\?facetValue\)\)/);
  assert.match(numeric ?? '', /MAX\(xsd:decimal\(\?facetValue\)\)/);
  assert.match(compiler.buildFctTemporalDomainSparql(query, 'http://data.europa.eu/s66#terminationDate') ?? '', /MIN\(\?facetLex\)/);
});

test('guest Personal facets use public query data but session-owned providers stay XState gated', () => {
  const cards = source('src/canvas/left/personal-widget-cards.tsx');
  const pane = source('src/canvas/left/filter-pane.tsx');
  const tray = source('src/canvas/left/derived-facet-button.tsx');
  assert.doesNotMatch(cards, /if \(!workspace\.accessCapabilities\.canUsePersonalStore\) return null/);
  assert.match(pane, /enabled: workspace\.accessCapabilities\.canUsePersonalStore/);
  assert.match(cards, /sessionActive=\{workspace\.accessCapabilities\.canUsePersonalStore\}/);
  assert.match(tray, /!sessionActive \|\| !sessionKey/);
  assert.match(source('src/canvas/workspace.tsx'), /endpointReadyForQuery && personalWidgets\.filter\(/);
});

test('transported facet icons match the widget and inherit the href target color without changing preview label styling', () => {
  const tree = source('src/canvas/utils/workspace-controller.tsx');
  assert.match(source('src/canvas/left/personal-widget-cards.tsx'), /ExternalLink className="inline size-4 shrink-0 text-muted-foreground"/);
  // Shared ExternalLink icon, with the href target’s property/role color.
  assert.match(tree, /node\.name === "a"\s*\? ExternalLink/);
  assert.match(tree, /node\.name === "a"\s*\? queryTreeRelationshipIconColor\(queryTreePathIndex\.byId\.get\(node\.attributes\.href \?\? ""\)\)/);
  assert.match(tree, /queryTreeRelationshipIconColor = [\s\S]*?child\.name === "view"[\s\S]*?"text-emerald-600 dark:text-emerald-400"[\s\S]*?"text-red-600 dark:text-red-400"/);
  assert.match(tree, /Transported \$\{transportedDirection === "reverse" \? "role" : "property"\}/);
  assert.match(source('src/canvas/top/breadcrumb-renderers.tsx'), /transportedPreviewIds\.has\(crumb\.id\)/);
});

test('EURIO linked labels use ontology-defined deep paths, never URI-local-name guesses', () => {
  const xslt = source('graph/eu-data/record.xsl');
  const proxy = source('src/app/proxy/api/sparql/route.ts');
  const controller = source('src/canvas/utils/workspace-controller.tsx');
  for (const predicate of ['hasFundingScheme', 'prefLabel', 'literalForm', 'definition']) {
    assert.ok(xslt.includes(predicate), `${predicate}: XSLT`);
    assert.ok(proxy.includes(predicate), `${predicate}: bounded URI label lookup`);
  }
  assert.match(controller, /"http:\/\/data\.europa\.eu\/s66#hasFundingScheme"/);
  assert.match(xslt, /else \$resource"\/>/);
});

test('Participant role icons occupy leading flex cells rather than inline role text', () => {
  const xslt = source('graph/eu-data/record.xsl');
  const start = xslt.indexOf('<xsl:template name="project-involved-party">');
  const end = xslt.indexOf('<xsl:template name="project-party-display">', start);
  const involved = xslt.slice(start, end);
  assert.match(involved, /-row" class="flex min-w-0 items-start gap-2"/);
  assert.match(involved, /role-coordinator-icon/);
  assert.match(involved, /role-partner-icon/);
  const display = xslt.slice(end, xslt.indexOf('<xsl:template name="project-status-svg">', end));
  assert.doesNotMatch(display, /<svg\b/);
  assert.match(xslt, /<li id="eu-project-participant-/);
});

test('base36 block jumps preserve legacy counter storage and skip invalid leading digits', () => {
  const ids = loadTs('src/lib/fct-node-identity.ts');
  for (const [x, expected] of [[35,35],[36,360],[359,360],[360,360],[1295,1295],[1296,12960],[12959,12960],[12960,12960],[46655,46655],[46656,466560]])
    assert.equal(ids.nextLetterLeadingFctCounter(x),expected);
  const tree = { name:'query', attributes:{id:'a',ctr:'36',uctr:'a',rctr:'a'},children:[
    {name:'property',id:'z',attributes:{iri:'urn:one'},children:[]},
    {name:'view',id:'a0',attributes:{type:'list'},children:[]},
  ]};
  const normalized = ids.ensureFctQueryIds(tree);
  assert.equal(normalized.attributes.ctr,'361');
  assert.equal(normalized.children[0].attributes.rid,'a');
  assert.deepEqual(ids.ensureFctQueryIds(normalized),normalized);
});
