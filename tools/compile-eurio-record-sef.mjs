/** Optional first-party acceleration. Never compiles a dynamic provider in production.
 * Run after npm ci (prebuild/predev). A compilation error only disables the
 * precompiled acceleration and preserves Maestro's checked source-XSLT path. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const source = join(process.cwd(), "graph/eu-data/record.xsl");
const targetDir = join(process.cwd(), "public/maestro-sef");
const target = join(targetDir, "eu-data-record.sef.json");
const manifest = join(targetDir, "manifest.json");
mkdirSync(targetDir, { recursive: true });
if (!existsSync(source)) process.exit(0);
const compiler = join(process.cwd(), "node_modules/xslt3/xslt3.js");
if (!existsSync(compiler)) {
  console.warn("Optional Record SEF compiler unavailable; using checked source XSLT.");
  rmSync(target,{force:true}); rmSync(manifest,{force:true}); process.exit(0);
}
const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
// xslt3 2.7 emits the browser-consumable SEF directly with -export/-nogo.
// Its CLI does not support the Saxon-Java -target option.
const result = spawnSync(process.execPath, [compiler, `-xsl:${source}`, `-export:${target}`, "-nogo"],
  { cwd: process.cwd(), encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
if (result.status !== 0 || !existsSync(target)) {
  console.warn("Optional EURIO Record SEF precompilation failed; source XSLT remains available.",
    String(result.stderr || result.stdout || result.error || "").slice(0,500));
  rmSync(target,{force:true}); rmSync(manifest,{force:true}); process.exit(0);
}
writeFileSync(manifest, JSON.stringify({ format: 1, sourceSha256: hash, asset: "/maestro-sef/eu-data-record.sef.json" }));
console.log("Built verified static EURIO Record SEF (source digest pinned).");
