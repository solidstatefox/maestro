const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join, relative } = require('node:path');

const root = join(__dirname, '..', 'src');
function* tsxFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* tsxFiles(path);
    else if (entry.isFile() && entry.name.endsWith('.tsx')) yield path;
  }
}

test('every component rendering MaestroEmptyResults explicitly imports it', () => {
  let callers = 0;
  for (const file of tsxFiles(root)) {
    const source = readFileSync(file, 'utf8');
    if (!/<MaestroEmptyResults\b/.test(source)) continue;
    callers++;
    assert.match(
      source,
      /import\s*\{\s*MaestroEmptyResults\s*\}\s*from\s*["']@\/components\/ui\/maestro-empty-results["']/,
      `${relative(root, file)} uses MaestroEmptyResults without importing it`,
    );
  }
  assert.ok(callers >= 6, 'regression coverage must include the current View/Analyze empty-state callers');
});

test('client boundary remains the first statement in personal Perspectives', () => {
  const source = readFileSync(join(root, 'canvas/tab/view/personal-perspectives.tsx'), 'utf8');
  assert.match(source, /^\uFEFF?\s*["']use client["'];/);
});
