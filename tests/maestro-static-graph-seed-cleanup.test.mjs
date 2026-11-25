import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishSeedManifest, writeSeedOutput } from '../src/scripts/migration/static-graph-seed-output.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const payload = (file, revision) => JSON.stringify({file, destination:'shacl-policies', digest:`sha256:${sha(revision)}`, triples:[]});
async function fixture(t) {
  const out = await mkdtemp(join(tmpdir(),'maestro-seed-cleanup-'));
  t.after(() => rm(out,{recursive:true,force:true}));
  return out;
}
async function asset(out, file, revision, pathHash=false) {
  const content = payload(file,revision);
  const name = `${sha(pathHash ? file : content)}.json`;
  await writeSeedOutput(join(out,name),content);
  return {file,destination:'shacl-policies',asset:name};
}

test('publish keeps exact manifest assets and prunes only obsolete generator-owned JSON', async t => {
  const out=await fixture(t);
  const old=await asset(out,'spider/provider.ttl','old');
  const original=await asset(out,'spider/provider.ttl','older',true);
  const removedSource=await asset(out,'retired/provider.ttl','retired',true);
  const current=await asset(out,'spider/provider.ttl','new');
  const unchanged=await asset(out,'labels.ttl','same');
  const foreign=`${'f'.repeat(64)}.json`;
  const wrongHash=`${'e'.repeat(64)}.json`;
  const directory=`${'d'.repeat(64)}.json`;
  await writeFile(join(out,foreign),'not RDF JSON');
  await writeFile(join(out,wrongHash),payload('unrelated.ttl','other'));
  await writeFile(join(out,'notes.json'),'{}');
  await writeFile(join(out,'otc-survey-skill.md'),'Instructions');
  await mkdir(join(out,directory));
  await writeFile(join(out,directory,'keep.txt'),'keep');
  await writeFile(join(out,'manifest.json'),JSON.stringify([old,original,removedSource,unchanged]));
  const entries=[current,unchanged];
  const result=await publishSeedManifest(out,entries);
  assert.equal(result.removed,3);
  assert.deepEqual(result.preserved.sort(),[foreign,wrongHash].sort());
  assert.deepEqual(JSON.parse(await readFile(join(out,'manifest.json'),'utf8')),entries);
  assert.deepEqual((await readdir(out)).sort(),[current.asset,unchanged.asset,foreign,wrongHash,directory,'notes.json','otc-survey-skill.md','manifest.json'].sort());
  assert.equal(await readFile(join(out,directory,'keep.txt'),'utf8'),'keep');
  assert.equal(await readFile(join(out,'otc-survey-skill.md'),'utf8'),'Instructions');
  assert.equal((await publishSeedManifest(out,entries)).removed,0);
});

test('a missing replacement asset leaves the old manifest and its assets untouched', async t => {
  const out=await fixture(t);
  const old=await asset(out,'old.ttl','old');
  const oldManifest=JSON.stringify([old]);
  await writeFile(join(out,'manifest.json'),oldManifest);
  const missing={file:'new.ttl',destination:'shacl-policies',asset:`${'a'.repeat(64)}.json`};
  await assert.rejects(publishSeedManifest(out,[missing]), /ENOENT/);
  assert.equal(await readFile(join(out,'manifest.json'),'utf8'),oldManifest);
  assert.equal(await readFile(join(out,old.asset),'utf8'),payload('old.ttl','old'));
});

test('a corrupt replacement asset cannot publish a manifest or prune earlier output', async t => {
  const out=await fixture(t);
  const old=await asset(out,'old.ttl','old');
  const current=await asset(out,'new.ttl','new');
  await writeFile(join(out,'manifest.json'),JSON.stringify([old]));
  await writeFile(join(out,current.asset),payload('new.ttl','corrupt'));
  await assert.rejects(publishSeedManifest(out,[current]), /verification failed/);
  assert.deepEqual(JSON.parse(await readFile(join(out,'manifest.json'),'utf8')),[old]);
  assert.equal(await readFile(join(out,old.asset),'utf8'),payload('old.ttl','old'));
});

test('manifest publication failure leaves obsolete files alone and removes temporary output', async t => {
  const out=await fixture(t);
  const old=await asset(out,'old.ttl','old');
  const current=await asset(out,'new.ttl','new');
  await mkdir(join(out,'manifest.json'));
  await assert.rejects(publishSeedManifest(out,[current]));
  assert.deepEqual((await readdir(out)).sort(),[old.asset,current.asset,'manifest.json'].sort());
});

test('generator publishes only after compiling all sources and writing instructions', async () => {
  const source=await readFile(new URL('../src/scripts/migration/round5-static-graph-seed.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('await writeSeedOutput(join(out,asset),payload)') < source.indexOf('await writeSeedOutput(join(out,\'otc-survey-skill.md\')'));
  assert.ok(source.indexOf('await writeSeedOutput(join(out,\'otc-survey-skill.md\')') < source.indexOf('await publishSeedManifest(out,entries)'));
  assert.equal((source.match(/await publishSeedManifest\(/g)||[]).length,1);
});
