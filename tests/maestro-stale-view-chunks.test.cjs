const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const repairScript = path.join(root, 'tools/repair-stale-view-chunks.mjs');
const retired = [
  'src/lib/map-provider.ts',
  'src/lib/map-provider-discovery.ts',
  'src/lib/client-map-eligibility.ts',
];
const createFixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-view-chunks-'));
  for (const name of retired) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const oldCode = true;\n');
  }
  fs.mkdirSync(path.join(dir, 'src/canvas/tab/view'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/canvas/tab/view/ribbon.tsx'), 'export const ViewRibbon = 1;\n');
  fs.mkdirSync(path.join(dir, '.next/dev'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.next/dev/old-map-client.js'), 'stale module factory');
  fs.mkdirSync(path.join(dir, '.next/server'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.next/server/production.js'), 'keep');
  return dir;
};
const run = (dir, ...args) => execFileSync(process.execPath, [repairScript, ...args], { cwd: dir, encoding: 'utf8' });
const exists = (dir, name) => fs.existsSync(path.join(dir, name));

test('first dev start removes obsolete Map modules and only stale development chunks', t => {
  const dir = createFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = run(dir);
  assert.match(result, /Old View chunk graph invalidated/);
  for (const name of retired) assert.equal(exists(dir, name), false, `${name} not removed`);
  assert.equal(exists(dir, '.next/dev/old-map-client.js'), false);
  assert.equal(exists(dir, '.next/server/production.js'), true, 'production output must be untouched');
  assert.equal(exists(dir, '.next/.maestro-view-chunk-migration.json'), true);
  fs.mkdirSync(path.join(dir, '.next/dev'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.next/dev/fresh.js'), 'keep the new compiled graph');
  run(dir);
  assert.equal(exists(dir, '.next/dev/fresh.js'), true, 'subsequent starts reuse the fresh dev graph');
});

test('build/test source-only cleanup cannot invalidate a running dev cache', t => {
  const dir = createFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, '--source-only');
  for (const name of retired) assert.equal(exists(dir, name), false);
  assert.equal(exists(dir, '.next/dev/old-map-client.js'), true);
  assert.equal(exists(dir, '.next/.maestro-view-chunk-migration.json'), false);
});

test('a remaining live Map discovery import stops deletion and cache reset', t => {
  const dir = createFixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'src/canvas/tab/view/ribbon.tsx'),
    'import { discover } from "@/lib/map-provider-discovery";\n');
  const result = spawnSync(process.execPath, [repairScript], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Retired Map-discovery import remains/);
  assert.equal(exists(dir, 'src/lib/map-provider-discovery.ts'), true);
  assert.equal(exists(dir, '.next/dev/old-map-client.js'), true);
});

test('the current View ribbon is provider-neutral and npm predev invokes cache migration', () => {
  const ribbon = fs.readFileSync(path.join(root, 'src/canvas/tab/view/ribbon.tsx'), 'utf8');
  assert.doesNotMatch(ribbon, /(?:import|from)[^\n]*(?:map-provider-discovery|client-map-eligibility)/);
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.match(scripts.predev, /^node tools\/repair-stale-view-chunks\.mjs &&/);
  assert.match(scripts.prebuild, /repair-stale-view-chunks\.mjs --source-only/);
});
