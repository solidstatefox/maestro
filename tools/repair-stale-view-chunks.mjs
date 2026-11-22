/**
 * One-time dev-bundle migration after retiring the Map-specific Perspective
 * discovery modules. ZIP overlays cannot delete old source files, and a
 * surviving Next/Turbopack dev graph may still reference their old factories.
 *
 * `node tools/repair-stale-view-chunks.mjs` resets only stale *development*
 * chunks once per migration version. `--source-only` deletes only the three
 * retired, unreachable modules and is safe before tests/production builds.
 * Never remove the production .next output, user assets, or graph providers.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const root = process.cwd();
const sourceOnly = process.argv.includes("--source-only");
const retired = [
  "src/lib/map-provider.ts",
  "src/lib/map-provider-discovery.ts",
  "src/lib/client-map-eligibility.ts",
];
const markerVersion = "provider-neutral-perspectives-2026-11-20-v1";
const marker = resolve(root, ".next/.maestro-view-chunk-migration.json");

function* sourceFiles(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(?:tsx?|mjs|cjs|jsx?)$/.test(entry.name)) yield path;
  }
}

// If a live source still uses a retired discovery module, don't delete it or
// hide the dependency with a stub. Report the importing file instead.
const retiredPaths = new Set(retired.map(name => resolve(root, name)));
for (const file of sourceFiles(resolve(root, "src"))) {
  if (retiredPaths.has(file) || file.endsWith("round3-remove-legacy-routes.mjs")) continue;
  const contents = readFileSync(file, "utf8");
  // Search for module *references*, not prose naming Maps or MapLibre; the
  // provider-neutral XSLT/MapLibre machinery must remain intact.
  if (/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'][^"']*(?:map-provider(?:-discovery)?|client-map-eligibility)["']/.test(contents)) {
    throw new Error(`Retired Map-discovery import remains in ${relative(root, file)}. Fix this caller before removing the module.`);
  }
}

let removed = 0;
for (const name of retired) {
  const file = resolve(root, name);
  if (!existsSync(file)) continue;
  rmSync(file, { force: true });
  removed++;
  process.stdout.write(`Removed retired View discovery module: ${name}\n`);
}

if (sourceOnly) {
  if (removed) process.stdout.write("Retired View module cleanup complete.\n");
  process.exit(0);
}

let priorVersion = "";
try { priorVersion = JSON.parse(readFileSync(marker, "utf8")).version; }
catch { /* Fresh checkout, or an existing pre-migration cache. */ }
if (priorVersion !== markerVersion) {
  let reset = 0;
  for (const name of [".next/dev", ".next/cache/turbopack"]) {
    const dir = resolve(root, name);
    if (!existsSync(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    process.stdout.write(`Cleared stale Turbopack development output: ${name}\n`);
    reset++;
  }
  mkdirSync(resolve(root, ".next"), { recursive: true });
  writeFileSync(marker, JSON.stringify({ version: markerVersion }) + "\n", "utf8");
  if (reset) process.stdout.write("Old View chunk graph invalidated; the next dev server will compile fresh chunks.\n");
} else if (removed) {
  // A stale ZIP overlay can reintroduce a retired module even after migration.
  // If that happens, reset the graph once again on this startup.
  for (const name of [".next/dev", ".next/cache/turbopack"]) {
    const dir = resolve(root, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write("Retired modules reappeared; rebuilt the View development graph.\n");
}
