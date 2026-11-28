"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

const paneOrder = fs.readFileSync("src/canvas/browse-pane-order.ts", "utf8");
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(paneOrder, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: mod, exports: mod.exports, require });
const api = mod.exports;

test("View and Analyze restore Sheet column placement and combine unselected widths", () => {
  const sizes = [20, 45, 35];
  const orders = [
    ["filters", "results", "record"],
    ["filters", "record", "results"],
    ["results", "filters", "record"],
    ["record", "filters", "results"],
    ["record", "results", "filters"],
    ["results", "record", "filters"],
  ];
  for (const order of orders) {
    const index = order.indexOf("filters");
    const expectedOrder = index === 0 ? ["filters", "results"] : ["results", "filters"];
    const expectedWidths = index === 0
      ? [sizes[index], 100 - sizes[index]]
      : [100 - sizes[index], sizes[index]];
    assert.deepEqual(Array.from(api.activeBrowsePaneOrder(order, false)), expectedOrder);
    assert.deepEqual(Array.from(api.compactBrowsePaneSizes(sizes, order)), expectedWidths);
    assert.deepEqual(Array.from(api.activeBrowsePaneOrder(order, true)), order);
  }
});

test("compact panels mount real panes, keep stable keys, and do not overwrite Browse widths", () => {
  const ws = fs.readFileSync("src/canvas/workspace.tsx", "utf8");
  const prefs = fs.readFileSync("src/canvas/browse-pane-layout.tsx", "utf8");
  const expectedSource = [
    '<LeftPaneFrame>{pausedSideShell("facets")}</LeftPaneFrame>',
    'key={workspaceTab === "browse" ? "browse-3" : "compact-2"}',
    'if (!browseLayoutActive) return;',
    'paneLayoutReady ? <ResizablePanelGroup',
    '...compactBrowsePaneSizes(savedSizes, browsePanePreference.order)',
  ];
  for (const text of expectedSource) {
    assert.ok(ws.includes(text), `Missing source invariant: ${text}`);
  }
  assert.ok(prefs.includes('pane === "filters" ? widths[filterIndex] : 100 - widths[filterIndex]'));
});
