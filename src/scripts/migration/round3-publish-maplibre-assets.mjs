/** Publish the pair of MapLibre ESM worker assets as same-origin static files.
 * OS-independent; runs before Next.js dev and production builds.
 * No dynamic asset HTTP route, package-relative browser import, or CDN.
 */
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
const root = process.cwd();
const source = join(root, "node_modules", "maplibre-gl", "dist");
const output = join(root, "public", "maplibre-worker");
await mkdir(output, { recursive: true });
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  try { await copyFile(join(source, name), join(output, name)); }
  catch (error) { throw new Error(`MapLibre asset ${name} is not installed. Run npm install first.`, {cause:error}); }
}
