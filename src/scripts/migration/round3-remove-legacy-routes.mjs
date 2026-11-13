/**
 * OS-independent cleanup for exactly the ten Round 3 web routes.
 * Never copies src over itself, never deletes unrelated server modules, and
 * refuses destructive changes while callers still reference retired URLs.
 *
 * Run from the Maestro root after extracting the changed-files patch:
 *   node src/scripts/migration/round3-remove-legacy-routes.mjs
 */
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const paths = [
  "src/app/proxy/api/record-graphs",
  "src/app/proxy/api/map-provider",
  "src/app/proxy/api/provider-shape",
  "src/app/proxy/api/sponge",
  "src/app/proxy/api/perspectives/delete",
  "src/app/proxy/api/rdf-loader",
  "src/app/api/maplibre-worker",
  "src/app/api/assistant",
  "src/app/proxy/api/analyze",
  "src/app/proxy/api/views",
];
const urls = [
  "/proxy/api/record-graphs", "/proxy/api/map-provider", "/proxy/api/provider-shape",
  "/proxy/api/sponge", "/proxy/api/perspectives/delete", "/proxy/api/rdf-loader",
  "/api/maplibre-worker", "/api/assistant", "/proxy/api/analyze", "/proxy/api/views",
];
const required = [
  "package.json", "src/app/proxy/api/fct/route.ts", "src/app/proxy/api/sparql/route.ts",
  "src/app/proxy/api/service/route.ts",
  "src/lib/record-authors.ts",
  "src/lib/map-provider.ts",
  "src/lib/provider-shape.ts",
  "src/lib/perspective-delete.ts",
  "src/lib/personal-sparql-reads.ts",
  "src/scripts/migration/round3-publish-maplibre-assets.mjs",
];
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
for (const path of required) if (!await exists(join(root, path)))
  throw new Error(`Missing required patch file ${path}; extract the Round 3 ZIP first.`);

async function* sourceFiles(directory) {
  if (!await exists(directory)) return;
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) yield path;
  }
}
const oldPaths = paths.map(path => join(root, path) + sep);
for await (const file of sourceFiles(join(root,"src"))) {
  if (oldPaths.some(path => file.startsWith(path)) || file.endsWith("remove-legacy-routes.mjs")) continue;
  const content = await readFile(file, "utf8");
  for (const url of urls) if (content.includes(url))
    throw new Error(`Retired API caller remains: ${relative(root,file)} references ${url}. No files were deleted.`);
}
// The source ZIP does not include the user's optional scripts/public folders.
// Check those real-project folders before deleting routes; report unknown
// external legacy callers rather than guessing which user files to destroy.
for (const folder of ["scripts", "public"]) {
  for await (const file of sourceFiles(join(root, folder))) {
    const content = await readFile(file, "utf8");
    const found = urls.find(url => content.includes(url));
    if (found) throw new Error(`External legacy caller ${relative(root,file)} references ${found}. No routes deleted; migrate this file first.`);
  }
}
for (const path of paths) {
  const file = join(root, path);
  if (await exists(file)) { await rm(file, {recursive:true, force:true}); console.log(`Removed ${path}`); }
}
// The old MapLibre handler generated no assets. Remove a legacy copy only if
// found under its exact deprecated public/API path. The new static worker pair
// is published separately to /public/maplibre-worker at build time.
const legacyAssets = join(root, "public", "api", "maplibre-worker");
if (await exists(legacyAssets)) { await rm(legacyAssets, {recursive:true, force:true}); console.log("Removed old MapLibre route assets"); }
const cache = join(root,".next");
if (await exists(cache)) { await rm(cache, {recursive:true, force:true}); console.log("Cleared stale Next.js route cache"); }
console.log("Round 3: ten route directories removed; /fct, /sparql, /service, /observations retained.");
