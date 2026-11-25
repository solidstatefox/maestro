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
  assert.match(source, /if \(!isPerspectiveCancellation\(err, controller\.signal\)\)/);
});
test('obsolete page enrichment is aborted and its response cannot replace current Results', () => {
  assert.match(source, /loadPerspectiveCollection\(kind, provider, queryXml, pageRows, controller\.signal, pinnedRows\)/);
  assert.match(source, /if \(!controller\.signal\.aborted\) \{ setCollection\(data\); setLoadedSignature\(pageSignature\);/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /loadedSignature === pageSignature/);
});

test('the personal Perspective TSX parses', () => {
  const parsed = ts.createSourceFile('personal-perspectives.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(parsed.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
