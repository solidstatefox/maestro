"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("XState navigation consumes the actual typed hook setters without maintaining a second navigation state", () => {
  const source = read("src/canvas/utils/workspace-controller.tsx");
  const hooks = [
    ["src/canvas/controllers/preferences.ts", "setWorkspaceTab", "setWorkspaceTabState"],
    ["src/canvas/controllers/view.ts", "setViewPanel", "setViewPanelState"],
    ["src/canvas/controllers/view.ts", "setViewProvider", "setViewProviderState"],
    ["src/canvas/controllers/view.ts", "setSelectedViewUri", "setSelectedViewUriState"],
    ["src/canvas/tab/analyze/analysis-utils.tsx", "setSelectedAnalysisUri", "setSelectedAnalysisUriState"],
    ["src/canvas/tab/analyze/analysis-utils.tsx", "setAnalyzeHistogram", "setAnalyzeHistogramState"],
  ];
  for (const [file, exposed, local] of hooks) {
    assert.match(read(file), new RegExp(`\\b${exposed}\\b`), `${file} must expose ${exposed}`);
    assert.match(source, new RegExp(`\\b${exposed}:\\s*${local}\\b`), `destructure ${exposed} as ${local}`);
    assert.match(source, new RegExp(`const ${exposed}: typeof ${local} = \\(value\\) =>`), `preserve inferred updater type for ${exposed}`);
  }
  assert.match(source, /queryViewController\.select\(\{ \.\.\.queryViewController\.getSelection\(\), \.\.\.change \}\)/);
});
