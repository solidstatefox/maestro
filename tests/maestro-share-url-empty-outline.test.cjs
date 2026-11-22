const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Share URL failure reuses the same outlined shadcn Empty as View Providers', () => {
  const workspace = source('src/canvas/workspace.tsx');
  const shared = source('src/components/ui/maestro-empty-results.tsx');
  const view = source('src/canvas/tab/view/view-components.tsx');
  const empty = source('src/components/ui/empty.tsx');
  assert.match(view, /<MaestroEmptyResults\s+onBrowse=\{onBrowse\}\s+title="No providers found"/);
  assert.match(workspace, /import \{ MaestroEmptyResults \} from "@\/components\/ui\/maestro-empty-results"/);
  assert.match(workspace, /<MaestroEmptyResults\s+title="Could not restore the Share URL"/);
  assert.match(shared, /<Empty className="mx-auto my-3 max-w-xl" data-maestro-empty-results="true">/);
  assert.match(empty, /border border-dashed/);
  for (const part of ['EmptyHeader', 'EmptyMedia', 'EmptyTitle', 'EmptyDescription', 'EmptyContent']) {
    assert.match(shared, new RegExp(`<${part}\\b`));
  }
  assert.doesNotMatch(workspace, /<h2 className="text-base font-semibold">Could not restore the Share URL<\/h2>/);
});

test('Share URL error shows the actual restoration message, preserved URL note and accessible alert', () => {
  const workspace = source('src/canvas/workspace.tsx');
  assert.match(workspace, /<section role="alert"[^>]*aria-label="Share URL restoration error"/);
  assert.match(workspace, /media=\{<FileWarning aria-hidden="true"\/>\}/);
  assert.match(workspace, /description=\{<>\s*\{urlRestoreError\}/);
  assert.match(workspace, /The incoming URL is preserved\. FCT execution remains blocked until a valid query is restored\./);
  assert.match(workspace, /!urlStateInitialized && urlRestoreError\s*\?/);
});

test('Retry is white on black; New Query stays outlined, with unchanged recovery actions', () => {
  const workspace = source('src/canvas/workspace.tsx');
  assert.match(workspace, /<Button type="button" variant="default" size="sm"\s+className="bg-black text-white [^"]*dark:bg-black dark:text-white[^"]*"\s+onClick=\{\(\) => window\.location\.reload\(\)\}>Retry<\/Button>/);
  assert.match(workspace, /<Button type="button" variant="outline" size="sm"\s+onClick=\{\(\) => window\.location\.assign\(window\.location\.pathname\)\}>New Query<\/Button>/);
  assert.match(source('src/components/ui/maestro-empty-results.tsx'), /actions \?\? \(onBrowse \? <Button type="button" variant="outline" onClick=\{onBrowse\}>Browse<\/Button>/);
});
