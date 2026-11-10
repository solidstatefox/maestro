/** Install the *browser* build of SaxonJS 2.7 (not the Node-only npm entry point).
 * Run: node scripts/install-saxon-browser.mjs
 * The upstream Saxonica public license applies to the unmodified distribution.
 */
import { inflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const url = "https://downloads.saxonica.com/SaxonJS/2/SaxonJS-2.7.zip";
const response = await fetch(url);
if (!response.ok) throw new Error(`Saxonica browser archive download failed (${response.status}): ${url}`);
const buffer = Buffer.from(await response.arrayBuffer());
if (buffer.length < 10000 || buffer.length > 15_000_000) throw new Error("Unexpected browser archive size.");

// Parse the ZIP central directory so the extraction is independent of ZIP entry order.
const eocd = (() => {
  for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 65557); --p) {
    if (buffer.readUInt32LE(p) === 0x06054b50) return p;
  }
  throw new Error("ZIP central directory not found.");
})();
let offset = buffer.readUInt32LE(eocd + 16);
const entries = buffer.readUInt16LE(eocd + 10);
let browserScript = null;
let license = null;
for (let i = 0; i < entries; i++) {
  if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP central directory.");
  const method = buffer.readUInt16LE(offset + 10);
  const packedSize = buffer.readUInt32LE(offset + 20);
  const nameLength = buffer.readUInt16LE(offset + 28);
  const extraLength = buffer.readUInt16LE(offset + 30);
  const commentLength = buffer.readUInt16LE(offset + 32);
  const localOffset = buffer.readUInt32LE(offset + 42);
  const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
  if (/(?:^|\/)SaxonJS2\.js$/i.test(name) || /(?:^|\/)(?:LICENSE|LICENSE\.txt)$/i.test(name)) {
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid ZIP file entry.");
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const packed = buffer.subarray(dataStart, dataStart + packedSize);
    const content = method === 8 ? inflateRawSync(packed) : method === 0 ? packed : (() => {throw new Error(`Unsupported ZIP compression ${method}`)})();
    if (/(?:^|\/)SaxonJS2\.js$/i.test(name)) browserScript = content;
    else license = content;
  }
  offset += 46 + nameLength + extraLength + commentLength;
}
if (!browserScript || browserScript.length < 100000) {
  throw new Error("SaxonJS2.js browser distribution was not found in the Saxonica release archive.");
}
const destination = join(process.cwd(), "public", "vendor", "saxon-js");
await mkdir(destination, { recursive: true });
await writeFile(join(destination, "SaxonJS2.js"), browserScript);
if (license) await writeFile(join(destination, "LICENSE.txt"), license);
console.log(`Installed official SaxonJS 2.7 browser runtime at ${destination}`);
