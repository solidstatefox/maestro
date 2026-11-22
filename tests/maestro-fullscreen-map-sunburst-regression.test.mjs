import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pane = read('src/canvas/right/pane.tsx');
const explorer = read('src/canvas/right/record-explorer.tsx');
const machine = read('src/lib/app-lifecycle/record-explorer-presentation.ts');
const map = read('graph/map/provider.ttl');
const host = read('src/canvas/left/facet-presentation.tsx');

// Prevent old Browse-specific property & header behavior inside fullscreen.
test('fullscreen Record is an explicit XState presentation with pointer and wand modes', () => {
  assert.match(machine, /initial:\s*"browse"/);
  assert.match(machine, /EXPAND:\s*"fullscreen"/);
  assert.match(machine, /SHRINK:\s*"browse"/);
  assert.match(machine, /pointer:\s*\{\s*on:\s*\{\s*WAND:\s*"wand"/);
  assert.match(machine, /wand:\s*\{\s*on:\s*\{\s*POINTER:\s*"pointer"/);
  assert.match(explorer, /presentationSnapshot\.matches\(\{\s*fullscreen:\s*"wand"/);
  assert.match(pane, /const fullscreenRecord = recordExplorerSnapshot\.matches\("fullscreen"\)/);
});

test('fullscreen Record click-capture blocks Browse property mutation and supports Wand on empty-valued predicates', () => {
  // Keep this test scoped to fullscreen; the Browse handler deliberately
  // supports distinct plain-click and Shift-click behavior below this boundary.
  const fullscreen = pane.split('if (fullscreenPane) {')[1]?.split("// Browse's URI values now behave like the Record title:")[0] || '';
  assert.match(fullscreen, /event\.preventDefault\(\);\s*event\.stopPropagation\(\)/);
  assert.match(fullscreen, /interactionMode === "wand"/);
  assert.match(fullscreen, /onRdfaAction\(\{ sessionIndex, statement: picked\.statement, intent: "wand", kind: picked\.kind \}\)/);
  assert.match(fullscreen, /picked\.kind === "value" && picked\.statement\.value/);
  assert.match(fullscreen, /intent: "pivot", kind: "value"/);
  assert.doesNotMatch(fullscreen, /openRecordPropertyUri\(|navigateResultBadge\(|applyRecordAsRootValue\(/);
  assert.match(pane, /selectedUri && \(fullscreenPane \|\| sessionIndex > 0\)/);
  assert.match(pane, /if \(!fullscreenPane\) openRecordPropertyUri\(item\.property\)/);
});

test('fullscreen Wand commits a query only on deliberate Set query action', () => {
  assert.match(explorer, /const setQueryAndClose = \(\) => \{/);
  assert.match(explorer, /!marked\.length \|\| !presentationSnapshot\.matches/);
  assert.match(explorer, /replaceTree\(buildWandQuery\(queryTree, trail, marked\)\)/);
  assert.match(explorer, /disabled=\{!marked\.length \|\| mode !== "wand"\}/);
  assert.match(explorer, /controller\.selectBrowseRecord\(rootIdentity\)/);
  assert.match(explorer, /controller\.focusSession\(index\)/);
});

test('both Sunburst styles start with a single visible label style and use no on-wedge QName prefix', () => {
  for (const file of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl']) {
    const xml = read(file);
    assert.match(xml, /f:display-label\(string\(@label\)\)/);
    assert.match(xml, /name="f:display-label"/);
    assert.match(xml, /data-facet-label-style="radial"[^>]*display="none"/);
    assert.match(xml, /data-facet-label-style="arc"/);
    assert.match(xml, /aria-label="\{concat\(@label/);
    assert.doesNotMatch(xml, /<title>|data-facet-label-toggle/);
  }
  assert.match(host, /group\.style\.display=.*?"inline"\s*:\s*"none"/);
  assert.match(host, /<ToggleGroup type="single" aria-label="Sunburst label layout" value=\{labelStyle\}/);
  assert.match(host, /<ToggleGroupItem unstyled value="radial"[^>]*>Radial<\/ToggleGroupItem>/);
  assert.match(host, /<ToggleGroupItem unstyled value="arc"[^>]*>Arc<\/ToggleGroupItem>/);
  assert.match(host, /onValueChange=\{value=>\{if\(value==="radial" \|\| value==="arc"\)setLabelStyle\(value\)/);
});

test('Map page controls are provider-authored; the derived FCT view never writes Browse query', () => {
  assert.match(map, /data-map-previous="true"/);
  assert.match(map, /data-map-next="true"/);
  assert.match(map, /const mapPageSize = 100/);
  assert.match(map, /derivedView\.setAttribute\('limit', String\(mapPageSize \+ 1\)\)/);
  assert.match(map, /derivedView\.setAttribute\('offset', String\(page \* mapPageSize\)\)/);
  assert.match(map, /api\.compileQuery\(pageXml, shapeUri, queryStylesheet, requestSignal\)/);
  assert.match(map, /ORDER BY \?c1 \?lat \?lng \?point \?wkt \?title LIMIT/);
  assert.match(map, /const more = resultRows\.length > mapPageSize/);
  assert.match(map, /pageRequest\?\.abort\(\)/);
  assert.doesNotMatch(map, /replaceTree\(|setLiveQuery\(/);
});
