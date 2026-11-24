const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(base, f), 'utf8');

test('Bookmarks and History cards use the same canonical in-app share restoration as pinned bookmarks', () => {
  const perspective = read('src/canvas/tab/view/personal-perspectives.tsx');
  const page = read('src/canvas/tab/view/page.tsx');
  assert.match(page, /<PersonalPerspectives key=\{selectedViewUri\} active=/);
  assert.match(page, /onOpenShareUrl=\{workspace\.openPinnedShareUrl\}/);
  assert.match(perspective, /if \(onOpenShareUrl\(url\.href\)\) return/);
  assert.match(perspective, /onOpenShareUrl\(rewritten\)/);
  assert.match(perspective, /bookmarkAtCurrentHost\(/);
  assert.doesNotMatch(perspective, /window\.location\.(?:assign|replace)\(/);
});

test('HTML bookmark anchors use SPA navigation without hijacking modified clicks or external URLs', () => {
  const perspective = read('src/canvas/tab/view/personal-perspectives.tsx');
  assert.match(perspective, /!event\.altKey && !event\.ctrlKey && !event\.metaKey && !event\.shiftKey/);
  assert.match(perspective, /anchor\.target !== "_blank" && !anchor\.hasAttribute\("download"\)/);
  assert.match(perspective, /url\.origin === window\.location\.origin && url\.searchParams\.has\("q"\)/);
  assert.match(perspective, /event\.preventDefault\(\);\s*if \(!onOpenShareUrl\(url\.href\)\)/);
});

test('A saved explicit FCT addr is authoritative, absent addr follows existing startup fallback, and missing tab defaults to Browse', () => {
  const ctrl = read('src/canvas/utils/workspace-controller.tsx');
  const block = ctrl.slice(ctrl.indexOf('function openPinnedShareUrl('), ctrl.indexOf('/** Restore the displaced user', ctrl.indexOf('function openPinnedShareUrl(')));
  assert.match(block, /const savedServer = at >= 0 \? validGraphServerUrl\(savedAddr\.slice\(at \+ 1\)\) : validGraphServerUrl\(savedAddr\)/);
  assert.match(block, /if \(!savedServer\) \{/);
  assert.match(block, /chooseStartupGraphServer\(/);
  assert.match(block, /prepareInitialFctQuery\(parsed, selected\.url\)/);
  assert.match(block, /validGraphServerUrl\(\(prepared\.attributes\.addr \?\? ""\)\.split\("@"\)/);
  assert.match(block, /restoreQueryAndUiState\(preparedXml, restored\)/);
  assert.match(block, /const tab = restored\?\.workspaceTab \?\? "browse"/);
  assert.match(block, /setWorkspaceTab\(tab\)/);
});

test('Graph-server menu label, checkmark, status and spinner observe the live addr, not an old preference', () => {
  const appbar = read('src/canvas/top/appbar-pane.tsx');
  assert.match(appbar, /const liveServer = \(queryTree\.attributes\.addr \?\? ""\)/);
  assert.match(appbar, /graphServerUrlMatches\(endpoint\.url, liveServer, endpoint\.schemeInferred\)/);
  assert.match(appbar, /const displayedEndpointId = activeGraphServer\?\.id \?\? ""/);
  assert.match(appbar, /const displayedEndpointLabel = activeGraphServer\?\.label \?\? \(liveServer\.trim\(\) \|\| "Select a graph server"\)/);
  assert.match(appbar, /const displayedEndpointChecking = Boolean\(activeGraphServer && checkingEndpointIds\[activeGraphServer\.id\]\)/);
  assert.doesNotMatch(appbar, /displayedEndpointId = activeGraphServer\?\.id \?\? selectedEndpointId/);
});
