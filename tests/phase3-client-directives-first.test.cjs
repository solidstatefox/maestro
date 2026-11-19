'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srcRoot = path.resolve(__dirname, '../src');

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) yield full;
  }
}

function stripLeadingTrivia(value) {
  let result = value.replace(/^\uFEFF/, '');
  while (true) {
    const next = result.replace(/^\s+/, '').replace(/^(?:\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)/, '');
    if (next === result) return result;
    result = next;
  }
}

test('all Next.js client directives are the first statement, before imports', () => {
  let clientModules = 0;
  for (const file of files(srcRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!/^[\t ]*["']use client["'];?[\t ]*$/m.test(source)) continue;
    clientModules++;
    const body = stripLeadingTrivia(source);
    assert.match(body, /^(?:"use client"|'use client');?\s/, `${path.relative(srcRoot, file)} has a client directive after another statement`);
  }
  assert.ok(clientModules > 0, 'expected to check at least one client module');
});

test('bookmark analyses and Overview keep their client boundary', () => {
  for (const relative of ['canvas/tab/analyze/bookmark-charts.tsx', 'canvas/tab/view/overview.tsx']) {
    const source = fs.readFileSync(path.join(srcRoot, relative), 'utf8');
    assert.match(stripLeadingTrivia(source), /^"use client";\s*import /, `${relative}: client directive must precede imported empty-state component`);
    assert.match(source, /import \{ MaestroEmptyResults \} from "@\/components\/ui\/maestro-empty-results";/);
  }
});
