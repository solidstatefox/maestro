import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (file) => readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const queryCode = read('src/lib/uri-autocomplete-query.ts');
const result = ts.transpileModule(queryCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}});
const module = {exports:{}};
vm.runInNewContext(result.outputText,{module,exports:module.exports,URL,require:(name)=>{
  if (name.endsWith('root-uri-policy')) return {isRootUriOrPrefix:(value)=>/^(?:https?|ftp):|^urn:|^www\./i.test(value)};
  if (name.endsWith('uri-autocomplete-settings')) return {readUriAutocompleteSettings:()=>({limit:10,timeoutSeconds:5})};
  if (name.endsWith('virtuoso-full-text')) return {buildVirtuosoFullTextExpression:(s)=>`"${s.toUpperCase()}"`};
  throw new Error(`Unexpected import ${name}`);
}}, {filename:'uri-autocomplete-query.js'});
const make = module.exports.createRootUriAutocompleteQuery;
const addr = '@https://demo.openlinksw.com/sparql';
test('one character and mixed-case input generate full-text indexed SPARQL, limit 10, rank',()=>{
  const q = make('F',addr,{limit:10,timeoutSeconds:5});
  assert.match(q,/SELECT \?uri \?label \?type WHERE/);
  assert.match(q, /\?matchedLabel bif:contains/);
  assert.match(q,/FILTER\(LCASE\(STR\(\?matchedLabel\)\) = "f"\)/);
  assert.match(q,/ORDER BY DESC \(<LONG::IRI_RANK> \(\?uri\)\) ASC\(STR\(\?uri\)\)\s+LIMIT 10/);
  assert.doesNotMatch(q,/\?uri \?predicate \?value/);
});
test('a complete scheme introducer or URL never generates suggestions',()=>{
  for(const draft of ['http:', 'https://example.org/X','ftp:','urn:test:X'])
    assert.equal(make(draft,addr,{limit:10,timeoutSeconds:5}),null,draft);
});
test('all compatible SPARQL servers require ranked output, bounded limit from Sheet',()=>{
  const q=make('AlAbAmA','@https://other.example.net/sparql',{limit:5,timeoutSeconds:1});
  assert.match(q,/"alabama"/);
  assert.match(q,/ORDER BY DESC \(<LONG::IRI_RANK> \(\?uri\)\) ASC\(STR\(\?uri\)\)\s+LIMIT 5/);
});
test('browser URI and kind workflows never invoke SHACL UI on login',()=>{
  const loader=read('src/lib/client-kinds.ts');
  assert.match(loader,/github\.com\/w3c\/data-shapes\/issues\/609/);
  assert.match(loader,/SELECT DISTINCT \?provider \?kind \?pattern/);
  assert.doesNotMatch(loader,/renderShacl|runShacl|validateShacl/);
});
test('Return actor captures Browse candidate before live query replacement',()=>{
  const c=read('src/canvas/utils/workspace-controller.tsx');
  const f=c.slice(c.indexOf('async function selectViewProvider('), c.indexOf('function returnToPreviousContext('));
  assert.ok(f.indexOf('type: "PROVIDERS_ENTRY_REQUESTED"') < f.indexOf('restoreQueryAndUiState(xml, null)'));
  assert.match(f,/type: "BROWSE_QUERY_DISPLACED", sourceKey: displacedQueryKey/);
  const m=read('src/lib/app-lifecycle/operations.ts');
  assert.match(m,/context\.browseQueryKey === event\.sourceKey/);
  assert.match(m,/providerCommitted \? context\.pendingEntryUrl : context\.returnUrl/);
});
test('Analyze Trail owns the breadcrumbs; result canvas has no duplicate navigation row',()=>{
  const w=read('src/canvas/workspace.tsx'),a=read('src/canvas/tab/analyze/page.tsx');
  assert.match(w,/id: "trail", label: "Trail"/);
  assert.match(w,/id: "analytics", label: "Analytics"/);
  assert.doesNotMatch(a,/<nav aria-label="Analyze breadcrumbs"/);
});
test('native outlined button composition has no blanket child-border erasure',()=>{
  const b=read('src/canvas/top/breadcrumb-renderers.tsx');
  assert.doesNotMatch(b,/\[&_button\]:!border-0|className="[^"\n]*border-0/);
  assert.match(b,/<InputGroup aria-label="Root breadcrumb"/);
  assert.match(b,/BreadcrumbNodeMinus/);
  assert.match(read('src/canvas/left/return-to-filters.tsx'),/variant="outline"/);
});
test('Kind, Record and Personal facet regression gates',()=>{
  assert.match(read('src/lib/status-machine-runtime.ts'),/if \(!grouped\.size\) return \[\]/);
  assert.match(read('src/canvas/left/filter.tsx'),/getActiveViewPropertyCarrier/);
  assert.match(read('src/canvas/right/pane.tsx'),/Try narrowing the query by applying more filters/);
  assert.match(read('src/canvas/right/pane.tsx'),/fullscreenPane && onRdfaAction/);
});
test('URI clipboard pastes only a valid single URI and root field closes on mouseout',()=>{
  const w=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(w,/recentlyCopied !== null && parseRootUri\(recentlyCopied\)/);
  assert.match(w,/rootSearchExpandedRef\.current/);
  const r=read('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(r,/rootBreadcrumb.send\(\{ type: "LABEL_LEAVE" \}\)/);
  assert.match(read('src/canvas/top/root-uri-autocomplete.tsx'),/onRequestClose\?\.\(\)/);
});
