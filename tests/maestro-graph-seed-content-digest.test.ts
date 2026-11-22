import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { destinationSeedDigest } from "../src/lib/graph-seed-content-digest";

const d1 = `sha256:${"a".repeat(64)}`;
const d2 = `sha256:${"b".repeat(64)}`;
const base = [
  {file: "eu-data/provider.ttl", digest: d1},
  {file: "eu-data/record-policies.ttl", digest: d2},
];

test("a changed EURIO provider content digest reseeds its graph, even when filenames do not change", async () => {
  const before = await destinationSeedDigest(base);
  assert.equal(await destinationSeedDigest([...base]), before);
  const after = await destinationSeedDigest([
    {...base[0], digest: d2}, base[1],
  ]);
  assert.notEqual(before, after);
  assert.match(before, /^[a-f0-9]{64}$/);
});

test("destination graph digest includes all constituent content hashes", async () => {
  const before = await destinationSeedDigest(base);
  assert.notEqual(before, await destinationSeedDigest(base.slice(0, 1)));
  assert.notEqual(before, await destinationSeedDigest([base[1], base[0]]));
});

test("the dataserver graph retains its endpoint sensitivity", async () => {
  const files = [{file: "dataserver-seed.ttl", digest: d1}];
  const first = await destinationSeedDigest(files, "https://example.org/one");
  assert.equal(first, await destinationSeedDigest(files, "https://example.org/one"));
  assert.notEqual(first, await destinationSeedDigest(files, "https://example.org/two"));
  assert.notEqual(first, await destinationSeedDigest(files));
});

test("the login seeder consumes the same asset.digest as the curator versioning contract", () => {
  const client = readFileSync("src/lib/client-graph-seed.ts", "utf8");
  const compiler = readFileSync("src/scripts/migration/round5-static-graph-seed.mjs", "utf8");
  const curator = readFileSync("src/lib/client-policy-approvals.ts", "utf8");
  assert.match(compiler, /const digest=`sha256:\$\{createHash\('sha256'\)\.update\(source,'utf8'\)\.digest\('hex'\)\}`/);
  assert.match(client, /implementationDigest`\},object:\{termType:"Literal",value:asset\.digest\}/);
  assert.match(client, /documents\.push\(\{entry,graph,triples,digest:asset\.digest\}\)/);
  assert.match(client, /destinationSeedDigest\(/);
  assert.doesNotMatch(client, /entries\.find\(x=>x\.file===item\.entry\.file\)\?\.asset/);
  assert.match(curator, /implementationDigest> \?currentDigest/);
});
