/** Publish and prune only build-generated RDF assets. No runtime graph changes. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const assetName = /^[a-f0-9]{64}\.json$/;
const sourceName = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/;

function parseAsset(bytes) {
  try {
    const asset = JSON.parse(bytes.toString('utf8'));
    if (!asset || typeof asset.file !== 'string' || !sourceName.test(asset.file) ||
        asset.file.includes('..') || typeof asset.destination !== 'string' ||
        typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
        !Array.isArray(asset.triples)) return null;
    return asset;
  } catch { return null; }
}

/** Avoid publishing a partially written asset or manifest. */
export async function writeSeedOutput(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** A successful build publishes its complete manifest before deleting obsolete
 * files. Only regular files with the generator's envelope AND a verified
 * content hash or original source-path hash are eligible for deletion.
 * Run as part of the existing serial prebuild/predev asset generation. */
export async function publishSeedManifest(out, entries) {
  const directory = await lstat(out);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error('Unsafe seed output directory');
  const keep = new Set();
  for (const entry of entries) {
    if (!assetName.test(entry.asset) || keep.has(entry.asset)) throw Error('Invalid or duplicate seed asset name');
    const target = join(out, entry.asset);
    if (!(await lstat(target)).isFile()) throw Error(`Seed asset is not a regular file: ${entry.asset}`);
    const bytes = await readFile(target);
    const asset = parseAsset(bytes);
    if (!asset || asset.file !== entry.file || asset.destination !== entry.destination ||
        `${sha256(bytes)}.json` !== entry.asset) throw Error(`Seed asset verification failed: ${entry.asset}`);
    keep.add(entry.asset);
  }
  // No deletion is attempted unless the new manifest is fully published.
  await writeSeedOutput(join(out, 'manifest.json'), JSON.stringify(entries, null, 2) + '\n');
  let removed = 0;
  const preserved = [];
  for (const entry of await readdir(out, { withFileTypes: true })) {
    if (!entry.isFile() || !assetName.test(entry.name) || keep.has(entry.name)) continue;
    const target = join(out, entry.name);
    const bytes = await readFile(target);
    const asset = parseAsset(bytes);
    const hash = basename(entry.name, '.json');
    // Original builds used a hash of the source path, not its contents.
    if (!asset || (sha256(bytes) !== hash && sha256(asset.file) !== hash)) {
      preserved.push(entry.name);
      continue;
    }
    await unlink(target);
    removed++;
  }
  return { removed, preserved };
}
