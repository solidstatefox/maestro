/** Cross-platform test discovery for PowerShell/cmd, Linux and macOS.
 * Avoid shell-dependent tests/*.test.ts globs. Use the project's locked tsx
 * dependency so TS tests and TS imports execute under one consistent loader. */
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'tests');
const discovered = [];
function visit(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (/\.test\.(?:[cm]?js|tsx?)$/i.test(entry.name)) discovered.push(path);
  }
}
visit(dir);
discovered.sort();
if (!discovered.length) {
  console.error('No Maestro test files found.');
  process.exit(1);
}
console.log(`Running ${discovered.length} Maestro test files with tsx...`);
const test = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', ...discovered], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (test.error) {
  console.error(test.error);
  process.exit(1);
}
// Keep the Python-only archive/seed regression as an optional companion check.
// No Python installation is required to build this Node/Next.js application.
let staticStatus = 0;
let foundPython = false;
for (const executable of process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python']) {
  const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if (probe.error || probe.status !== 0) continue;
  foundPython = true;
  const result = spawnSync(executable,
    [join(dir, 'maestro-regression-static.py')], { cwd: root, stdio: 'inherit' });
  staticStatus = result.status ?? 1;
  break;
}
if (!foundPython) console.log('Python static checks skipped (Python is not installed).');
if (staticStatus !== 0) console.error('Maestro Python static checks failed.');
process.exit((test.status ?? 1) || staticStatus);
