const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
let ts;
try { ts = require('typescript'); } catch {
  try { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
  catch { ts = null; }
}

test('Group-by members are fetched whenever a scoped member state is missing', () => {
  const w = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(w, /missingGroupMemberKeys = centralTab === "groups"/);
  assert.match(w, /\.filter\(key => !groupMembers\[key\] && !groupMemberRequestControllers\.current\.has\(key\)\)/);
  assert.match(w, /groupMemberRequestControllers\.current\.set\(key, requestController\)/);
  assert.match(w, /createGroupMemberQuery\(ungroupForMembers\(queryTree\), selectedGroupByOption, groupValue\)/);
  assert.match(w, /activeGroupMemberScope\.current !== requestScope/);
  assert.match(w, /groupMemberPageKey, missingGroupMemberKeys/);
  assert.doesNotMatch(w, /setGroupMembers\(\{\}\);[\s\S]{0,120}\/\/ skip all fetches/);
  const center = read('src/canvas/tab/browse/page.tsx');
  assert.doesNotMatch(center, /Group members have not been loaded\./);
  assert.match(center, /loading:\s*true, error:\s*""/);
});

test('numeric editor commits selected range bounds by blur through the FCT callback', () => {
  const code = read('src/canvas/left/personal-numeric-facet.tsx');
  assert.match(code, /onBlur=\{\(\) => commitBoundEdit\("lower"\)\}/);
  assert.match(code, /onBlur=\{\(\) => commitBoundEdit\("upper"\)\}/);
  assert.match(code, /onRangeChange\(property, format\(lowerBound\), format\(upperBound\)\)/);
  assert.match(code, /Max \{display\(max\)\}/);
  assert.match(code, /Min \{display\(min\)\}/);
  assert.doesNotMatch(code, /onKeyDown=|Cancel edit|setSliderValue/);
});

test('autocomplete query is exact, indexed and ranked before optional class enrichment', () => {
  const src = read('src/lib/uri-autocomplete-query.ts');
  assert.match(src, /\?matchedLabel bif:contains/);
  assert.match(src, /FILTER\(LCASE\(STR\(\?matchedLabel\)\) = /);
  assert.match(src, /GROUP BY \?uri/);
  assert.ok(src.indexOf('LIMIT ${limit}') < src.indexOf('OPTIONAL {'));
  assert.match(src, /FILTER NOT EXISTS/);
  assert.doesNotMatch(src, /CONTAINS\(LCASE\(STR\(\?label\)\)/);
  const ac = read('src/canvas/top/root-uri-autocomplete.tsx');
  assert.doesNotMatch(ac, /createAutocompleteTypeQuery|requestAutocompleteTypes/);
});

test('inspector is a durable Base UI dialog and suppresses hover popup while open', () => {
  const modal = read('src/canvas/top/root-autocomplete-query-inspector.tsx');
  const workspace = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(modal, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/);
  assert.match(modal, /<DialogTitle>Root URI autocomplete — Generated SPARQL<\/DialogTitle>/);
  assert.match(modal, /Close autocomplete SPARQL dialog/);
  assert.match(workspace, /suspended=\{rootAutocompleteInspectorOpen\}/);
  assert.match(read('src/canvas/workspace.tsx'), /<RootAutocompleteQueryInspector/);
  assert.match(workspace, /rootAutocompleteInspection/);
});

test('fullscreen Record actions are independent and popup layers above explorer', () => {
  const explorer = read('src/canvas/right/record-explorer.tsx');
  const pane = read('src/canvas/right/pane.tsx');
  const shrink = explorer.slice(explorer.indexOf('function close('), explorer.indexOf('function close(') + 340);
  assert.doesNotMatch(shrink, /replaceTree|buildWandQuery/);
  assert.match(explorer, /Set query/);
  assert.match(pane, /fullscreenPane \? "z-\[120\]/);
});

test('Place hero scales without cropping; map and property groups are bounded', () => {
  const ttl = read('graph/dbpedia/maestro-dbpedia-policies.ttl');
  const groups = read('src/components/ui/record-value-pages.tsx');
  assert.match(ttl, /object-contain/);
  assert.match(ttl, /zoom="9"/);
  assert.match(ttl, /id="record-place-property-pages" pageSize="10" layout="groups"/);
  assert.match(groups, /layout\??:\s*"stack"\s*\|\s*"wrap"\s*\|\s*"groups"/);
});

test('example prefixes reflect FCT equality, range, and regex semantics', { skip: !ts }, () => {
  const js = ts.transpileModule(read('src/lib/fct-example-prefix.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => { throw Error('not expected'); });
  const ex = (attrs = {}) => ({ name: 'value', attributes: attrs });
  const prefix = mod.exports.fctExamplePrefix;
  assert.equal(prefix([]), 'e.g.');
  assert.equal(prefix([ex({op:'='})]), 'i.e.');
  assert.equal(prefix([ex({})]), 'i.e.');
  for (const attr of [{op:'regex'}, {op:'contains'}, {op:'>'}, {rangeStart:'3',rangeEnd:'8'}])
    assert.equal(prefix([ex(attr)]),'e.g.');
  assert.equal(prefix([ex({op:'='}),ex({op:'regex'})]), 'e.g.');
  assert.match(read('src/canvas/top/breadcrumb-renderers.tsx'), /fctExamplePrefix\(breadcrumbBoundValues\)/);
  assert.match(read('src/canvas/left/configure-pane.tsx'), /fctExamplePrefix\(/);
});
