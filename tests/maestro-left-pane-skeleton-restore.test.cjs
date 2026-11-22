"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const project = path.resolve(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(project, "src", file), "utf8"); }
function loadPureModule(file) {
  const js = ts.transpileModule(source(file), { fileName: file, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017} }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, module: {exports}, require }, { filename: file });
  return exports;
}
const { selectLeftPaneSkeletonWidgets, selectWorkspaceSkeletonBoundaries } = loadPureModule("lib/app-lifecycle/skeleton-boundaries.ts");
const fixtures = {
  pane: "facets", focusListOrder: "Properties", showStatus: false,
  showPropertyUsage: false, focusWidgetsSuppressed: false, transported: [],
  personalRoles: [], personalProperties: [],
};

test("Configure skeleton retains Properties/Roles sections and restored focus order", () => {
  assert.deepEqual(Array.from(selectLeftPaneSkeletonWidgets(fixtures), w => w.title), ["Properties", "Roles"]);
  assert.deepEqual(Array.from(selectLeftPaneSkeletonWidgets({...fixtures, focusListOrder: "Roles"}), w => w.title), ["Roles", "Properties"]);
});
test("Filters and Configure use separate widget projections", () => {
  assert.deepEqual(Array.from(selectLeftPaneSkeletonWidgets({...fixtures, pane:"personal"}), w => w.title), ["Categories", "Graphs"]);
  assert.deepEqual(Array.from(selectLeftPaneSkeletonWidgets({...fixtures, pane:"community"}), w => w.title), []);
});
test("Restored pages use live pane widgets; skeleton is limited to URL restoration", () => {
  const facts = {hydrated:false,tab:"browse",graphPhase:"unknown",queryPhase:"idle",registryReady:false,endpointReady:false,endpointFailed:false,facetsLoading:true,facetContentPresent:false,facetFailed:false,initialQueryStarted:false,recordSelected:false,recordLoading:false,recordReady:false,recordFailed:false};
  assert.equal(selectWorkspaceSkeletonBoundaries(facts).facets, "loading");
  assert.equal(selectWorkspaceSkeletonBoundaries({...facts, hydrated:true}).facets, "ready");
});
test("one real navigation toolbar is rendered by live and skeleton panes", () => {
  const live = source("canvas/left/pane.tsx");
  const skeleton = source("canvas/workspace-skeleton.tsx");
  const nav = source("canvas/left/pane-navigation.tsx");
  assert.match(live, /<LeftPaneNavigation workspace=\{workspace\} \/>/);
  assert.match(skeleton, /<LeftPaneNavigation workspace=\{workspace\} restoring pane=\{pane\} \/>/);
  assert.doesNotMatch(skeleton, /<button[^>]*>Properties<\/button>|<button[^>]*>Roles<\/button>/);
  assert.match(nav, /<ReturnToFiltersButton onClick=\{commitConfigureFacetChanges\} disabled=\{restoring\}/);
  assert.match(nav, /!restoring && showConfigureProperties/);
  assert.match(nav, /!restoring && showConfigureRoles/);
});
test("Configure skeleton retains colored section fixtures without starting query hooks", () => {
  const skeleton = source("canvas/workspace-skeleton.tsx");
  assert.match(skeleton, /CONFIGURE_HEADER_BACKGROUND_COLOR/);
  assert.match(skeleton, /CONFIGURE_HEADER_BORDER_COLOR/);
  assert.match(skeleton, /<SkeletonConfigureSection key=\{widget.key\}/);
  assert.match(skeleton, /<SkeletonFacet key=\{widget.key\}/);
  assert.doesNotMatch(skeleton, /<ConfigureWorkspaceContent/);
});
test("arriving URL selects only the skeleton pane, not the canonical FCT query", () => {
  const workspace = source("canvas/workspace.tsx");
  assert.match(workspace, /readShareableUiState\(window.location.search\)/);
  assert.match(workspace, /const restoringLeftPane = !urlStateInitialized/);
  assert.match(workspace, /pane: restoringLeftPane/);
  assert.match(workspace, /workspace=\{workspace\}/);
  assert.doesNotMatch(workspace, /key=\{urlStateInitialized \? workspaceTab : "restoring"\}/);
});
