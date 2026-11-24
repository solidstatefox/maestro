const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');

test('list-values retains normal FCT selection and merge-values skips projected facets', () => {
  const compiler = read('src/lib/fct-sparql-translator.ts');
  assert.match(compiler,/view === FCT_VIEW_TYPES\.LIST_VALUES \|\| view === FCT_VIEW_TYPES\.MERGE_VALUES/);
  assert.match(compiler,/state\.mergeProjectionNodes\?\.has\(node\)/);
  assert.match(compiler,/view === FCT_VIEW_TYPES\.MERGE_VALUES \? mergeProjectionNodes : undefined/);
  assert.match(compiler,/if \(node\.attributes\.column !== "false"\)/);
});

test('merge-values clone never manufactures a uid OR group', () => {
  const clone = read('src/canvas/utils/fct-response.ts');
  assert.match(clone,/export function mergeValuesQueryClone/);
  assert.match(clone,/FCT_VIEW_TYPES\.MERGE_VALUES/);
  assert.match(clone,/document\.importNode\(value, true\)/);
  assert.match(clone,/anchor\.setAttribute\("href", current\.getAttribute\("id"\)!\)/);
  assert.doesNotMatch(clone,/facet\.setAttribute\("uid", groupId\)/);
});

test('all original metadata callers share XML-only merge-values builder', () => {
  const files = ['src/canvas/utils/workspace-controller.tsx',
    'src/canvas/tab/analyze/sankey.tsx','src/lib/fct-client.ts', 'src/lib/maestro-provider-dom.ts'];
  for(const file of files) assert.match(read(file),/mergeValuesQueryClone\(/);
  for(const file of ['src/lib/provider-catalog-items.ts','src/lib/record-authors.ts'])
    assert.match(read(file),/fctProjectPage\(/);
  assert.doesNotMatch(read('src/canvas/utils/fct-response.ts'),/export function listValuesQueryClone/);
});

test('projection is addressed by original query-tree ID and anchor ID', () => {
  const compiler=read('src/lib/fct-sparql-translator.ts');
  // Nested <a> lives under its successor relationship; legacy <a> beside
  // <view> remains supported by the same recursive projection traversal.
  assert.match(compiler,/const projectAnchors = \(parent: XmlNode\)/);
  assert.match(compiler,/const href = child\.attributes\.href \?\? ""/);
  assert.match(compiler,/parent !== viewParent &&/);
  assert.match(compiler,/parent\.attributes\.id !== href/);
  assert.match(compiler,/getPath\(index, viewParent, href\)/);
  assert.match(compiler,/addColumn\(child\.attributes\.id \?\? "", resolved\.path, resolved\.target\)/);
  assert.match(compiler,/projectAnchors\(viewParent\)/);
  const route=read('src/app/proxy/api/fct/route.ts');
  assert.match(route,/JSON\.stringify\(column\.id\)/);
  assert.match(route,/var="\$\{xmlText\(column\.id\)\}"/);
  assert.match(route,/column\.boundValues/);
  assert.match(route,/compiled\.resourcePage\.map/);
});

test('EURIO Results now preserve titleless and DOI-less resources', () => {
  for(const file of ['graph/eu-data/project-results-query.xsl','graph/eu-data/provider.ttl']){
    const source=read(file);
    assert.match(source,/type="merge-values"/);
    assert.match(source,/iri="http:\/\/data\.europa\.eu\/s66#title"/);
    assert.match(source,/iri="http:\/\/data\.europa\.eu\/s66#doi"/);
    assert.doesNotMatch(source,/iri="http:\/\/data\.europa\.eu\/s66#title" uid="z"/);
  }
});

test('perspective ribbon has no provider-specific Map discovery and one timer label', () => {
  const ribbon=read('src/canvas/tab/view/ribbon.tsx');
  assert.doesNotMatch(ribbon,/useMapProviderDiscovery|Maps discovery:|Locating personal perspectives|Locating views/);
  assert.match(ribbon,/Locating perspectives/);
  assert.match(ribbon,/clockScope="views"/);
  const discovery=read('src/lib/personal-sparql-reads.ts');
  assert.match(discovery,/sh:or \?conditions/);
  assert.match(discovery,/personalAuthenticatedFetch\(session,\s*"\/proxy\/api\/sparql"/);
  const page=read('src/canvas/tab/view/page.tsx');
  assert.doesNotMatch(page,/useMapProviderDefinition|mapProvider/);
});

test('accepted root breadcrumb signal backdrop and separate event transport are preserved',()=>{
  assert.match(read('src/canvas/top/breadcrumb-renderers.tsx'),/bg-background/);
  assert.match(read('src/app/proxy/api/service/route.ts'),/openProxyQueryTelemetry/);
  assert.match(read('src/app/proxy/api/fct/route.ts'),/application\/xml; charset=utf-8/);
});
