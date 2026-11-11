import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Same-origin MapLibre worker files must retain their relative import names.
 * This avoids a Turbopack worker/shared-chunk filename mismatch. */
const ALLOWED = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);
export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  if (!ALLOWED.has(asset)) return new Response("Not found", { status: 404 });
  try {
    const contents = await readFile(join(process.cwd(), "node_modules", "maplibre-gl", "dist", asset));
    return new Response(new Uint8Array(contents), {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new Response("MapLibre worker asset unavailable on this server", { status: 503 });
  }
}
