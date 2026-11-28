"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "src/canvas/utils/workspace-controller.tsx"), "utf8");
const cache = fs.readFileSync(path.join(root, "src/lib/client-query-cache.ts"), "utf8");

test("workspace actor identity is SSR-stable, per-instance, and not generated randomly during render", () => {
  assert.match(workspace, /import\s*\{[^}]*\buseId\b[^}]*\}\s*from\s*["']react["']/s);
  assert.match(workspace, /const queryWorkspaceId\s*=\s*`workspace:\$\{useId\(\)\}`/);
  assert.doesNotMatch(workspace, /useState\s*\(\s*\(\)\s*=>\s*`workspace:\$\{crypto\.randomUUID\(\)\}`\s*\)/);
  assert.match(workspace, /registerMaestroQueryWorkspace\(queryWorkspaceId, queryViewController\)/);
  assert.match(workspace, /return\s*\(\)\s*=>\s*\{\s*unregister\(\);\s*queryViewController\.stop\(\);\s*\}/);
  assert.match(cache, /const queryWorkspaces = new Map<string, MaestroQueryViewCoordinator>\(\)/);
  assert.match(cache, /if \(!workspaceId \|\| queryWorkspaces\.has\(workspaceId\)\)/);
});

test("render-stable ID changes only the workspace registry; query dispatch remains actor-owned", () => {
  assert.match(workspace, /const \[queryViewController\] = useState\(createMaestroQueryViewCoordinator\)/);
  assert.match(workspace, /queryViewController\.select\(\{ \.\.\.queryViewController\.getSelection\(\), \.\.\.change \}\)/);
  assert.match(workspace, /"x-maestro-view-tab": workspaceTab/);
  assert.match(workspace, /"x-maestro-view-ribbon": workspaceTab === "browse"/);
});
