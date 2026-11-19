import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = readFileSync(new URL('../src/canvas/tab/view/personal-perspectives.tsx', import.meta.url), 'utf8');

test('personal perspective recognizes AbortSignal cancellation without hiding HTTP errors', () => {
  assert.match(source, /function isPerspectiveCancellation\(/);
  assert.match(source, /signal\?\.aborted/);
  assert.match(source, /error\.name === "AbortError"/);
  assert.match(source, /signal is aborted without reason/);
  assert.match(source, /if \(!isPerspectiveCancellation\(cause, controller\.signal\)\)/);
  assert.match(source, /if \(!response\.ok\) throw new Error\(`Perspective scope query returned HTTP \$\{response\.status\}`\)/);
});

test('a global query cancellation retries the current FCT scope once without changing its query or transport', () => {
  assert.match(source, /const run = \(\) => cachedFetchFct\("\/proxy\/api\/fct"/);
  assert.match(source, /response = await run\(\)/);
  assert.match(source, /if \(!isPerspectiveCancellation\(cause, controller\.signal\) \|\| controller\.signal\.aborted\) throw cause/);
  assert.match(source, /if \(controller\.signal\.aborted\) return/);
  assert.match(source, /"X-Maestro-Query-Label": `PerspectiveScope:\$\{kind\}`/);
});

test('the personal Perspective TSX parses', () => {
  const parsed = ts.createSourceFile('personal-perspectives.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(parsed.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
