"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const jsxName = (tag) => tag.tagName?.getText?.() ?? "";

function sourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

function elementChildren(node) {
  return node.children.filter(ts.isJsxElement);
}

test("every Maestro modal AlertDialogContent has a shadcn AlertDialogFooter", () => {
  let modalCount = 0;
  for (const file of sourceFiles(path.join(root, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    function inspect(node) {
      if (ts.isJsxElement(node) && jsxName(node.openingElement) === "AlertDialogContent") {
        modalCount++;
        const footers = elementChildren(node).filter(child => jsxName(child.openingElement) === "AlertDialogFooter");
        const headers = elementChildren(node).filter(child => jsxName(child.openingElement) === "AlertDialogHeader");
        assert.equal(headers.length, 1, `${path.relative(root,file)} missing modal header`);
        assert.equal(footers.length, 1, `${path.relative(root,file)} missing exactly one modal footer`);
        const actions = elementChildren(footers[0]).filter(child => ["AlertDialogAction", "AlertDialogCancel"].includes(jsxName(child.openingElement)));
        assert.ok(actions.length >= 1, `${path.relative(root,file)} missing footer action`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  assert.ok(modalCount >= 4, "expected the four current Maestro modal alert dialogs to remain audited");
});

test("blocked-entry alert uses Base UI shadcn modal and Browse in its footer, never a custom overlay", () => {
  const ui = read("src/components/ui/alert-dialog.tsx");
  const shell = read("src/canvas/workspace.tsx");
  assert.match(ui, /import \{ AlertDialog as AlertDialogPrimitive \} from "@base-ui\/react\/alert-dialog"/);
  assert.match(shell, /<AlertDialog open=\{Boolean\(workspace\.restoredViewFallback\)\}/);
  assert.match(shell, /<AlertDialogHeader>[\s\S]*?<AlertDialogTitle>Saved View or Analysis unavailable/);
  assert.match(shell, /<AlertDialogFooter>\s*<AlertDialogAction onClick=\{workspace\.dismissRestoredViewFallback\}>Browse<\/AlertDialogAction>\s*<\/AlertDialogFooter>/);
  assert.doesNotMatch(shell, /Continue browsing|Copy original URL|waitingForSelectedView|Browse facets are paused while this view is active/);
});
test('shared AlertDialog footer is a full-width muted, separated action region',()=>{
 const source=fs.readFileSync(path.join(root,'src/components/ui/alert-dialog.tsx'),'utf8');
 assert.match(source,/data-slot="alert-dialog-footer"[^\n]*-mx-6 -mb-6[^\n]*border-t bg-muted\/50 px-6 py-4/);
});
