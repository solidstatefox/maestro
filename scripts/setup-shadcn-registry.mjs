/** One-time opt-in: arrange for the generated registry to refresh on dev/build. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = resolve(root, 'package.json');
const pkg = JSON.parse(await readFile(target, 'utf8'));
pkg.scripts ??= {};
for (const event of ['prebuild', 'predev']) {
  const command = 'node scripts/generate-shadcn-registry.mjs';
  if (!pkg.scripts[event]) pkg.scripts[event] = command;
  else if (!pkg.scripts[event].includes(command)) pkg.scripts[event] += ` && ${command}`;
}
await writeFile(target, JSON.stringify(pkg, null, 2) + '\n');
console.log('Maestro: shadcn registry generation added to prebuild and predev.');
