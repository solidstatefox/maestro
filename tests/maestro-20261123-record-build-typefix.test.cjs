const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const root = join(__dirname, "..");
const source = path => readFileSync(join(root, path), "utf8");

test("Record HTML setter accepts functional updates and preserves XState lifecycle semantics", () => {
  const record = source("src/canvas/right/record.tsx");
  const controller = source("src/canvas/utils/workspace-controller.tsx");
  assert.match(record, /const setFormattedRecordHtml = \(update: SetStateAction<string>\) =>/);
  assert.match(record, /formattedRecordHtmlRef = useRef\(""\)/);
  assert.match(record, /typeof update === "function" \? update\(formattedRecordHtmlRef\.current\) : update/);
  assert.match(record, /formattedRecordHtmlRef\.current = html;\s*setFormattedRecordHtmlState\(html\);/);
  assert.match(record, /lifecycle\.operation\("format", "OP_SUCCEEDED", snapshot\.context\.key\)/);
  assert.match(record, /lifecycle\.operation\("format", "OP_RESET", snapshot\.context\.key\)/);
  assert.match(controller, /setFormattedRecordHtml\(current =>/);
  assert.match(controller, /maestro-record-enrichment-unavailable/);
});

test("Optional xslt3 2.7 SEF build uses supported -xsl/-export/-nogo syntax and retains fallback", () => {
  const sourceText = source("tools/compile-eurio-record-sef.mjs");
  assert.match(sourceText, /`-xsl:\$\{source\}`/);
  assert.match(sourceText, /`-export:\$\{target\}`/);
  assert.match(sourceText, /"-nogo"\]/);
  assert.doesNotMatch(sourceText, /"-target:JS2"/);
  assert.match(sourceText, /Optional EURIO Record SEF precompilation failed; source XSLT remains available/);
  assert.match(sourceText, /rmSync\(target,\{force:true\}\)/);
});
