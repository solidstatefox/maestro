import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("Sheet's Show and Show Bookmarks keep their respective History FCT scopes and select View Perspectives", () => {
  const sheet = read("src/canvas/sheet/settings-pane.tsx");
  const workspace = read("src/canvas/utils/workspace-controller.tsx");
  const ids = read("src/lib/personal-perspective-ids.ts");
  const section = workspace.slice(workspace.indexOf("async function loadHistoryQuery("), workspace.indexOf("async function deleteCurrentQueryHistory("));
  assert.match(sheet, /onClick=\{\(\) => void loadHistoryQuery\(\)\}/);
  assert.match(sheet, /onClick=\{\(\) => void loadHistoryQuery\(true\)\}/);
  assert.match(section, /#\$\{includeFavorites \? "bookmarks" : "history"\}/);
  assert.match(section, /http:\/\/www\.w3\.org\/2002\/01\/bookmark#Bookmark/);
  assert.match(section, /#QueryHistoryVisit/);
  assert.match(section, /restoreQueryAndUiState\(historyQueryXml, null\)/);
  // Both selection fields and tab are committed in one workspace XState event.
  assert.match(section, /navigateQueryView\(\{ tab: "view", viewProvider: null, viewPanel: "perspectives",\s*selectedViewUri: includeFavorites \? PERSONAL_PERSPECTIVE_URI\.bookmarks : PERSONAL_PERSPECTIVE_URI\.history \}\)/);
  assert.doesNotMatch(section, /setWorkspaceTab\("view"\)|setViewPanel\("perspectives"\)|setSelectedViewUri\(includeFavorites/);
  assert.match(ids, /bookmarks: "gttp:\/\/ggg\.maestro\.ecosys\/shacl\/provider\/bookmarks-perspective"/);
  assert.match(ids, /history: "gttp:\/\/ggg\.maestro\.ecosys\/shacl\/provider\/history-perspective"/);
  assert.doesNotMatch(section, /CONTEXT_RETURNED|setWorkspaceTab\("browse"\)|setViewPanel\("trail"\)/);
});

test("Sheet-to-Perspectives navigation preserves the existing Browse Return owner", () => {
  const workspace = read("src/canvas/utils/workspace-controller.tsx");
  const section = workspace.slice(workspace.indexOf("async function loadHistoryQuery("), workspace.indexOf("async function deleteCurrentQueryHistory("));
  const navigation = read("src/lib/app-lifecycle/operations.ts");
  assert.match(section, /if \(workspaceTab === "browse"\) operations\.controller\.send\(\{/);
  assert.match(section, /type: "RIBBON_ENTRY_FROM_BROWSE", sourceKey: queryXml/);
  assert.match(section, /fromUrl: buildCurrentShareUrl\(\)/);
  assert.match(navigation, /!context\.returnUrl/);
  assert.match(navigation, /context\.browseQueryKey === event\.sourceKey/);
});
