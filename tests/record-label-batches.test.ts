import test from "node:test";
import assert from "node:assert/strict";
import { recordLabelBatches } from "../src/lib/record-label-batches";

test("Record label batches bound URI and graph sets without losing any pair", () => {
  const uris = Array.from({ length: 55 }, (_, i) => `urn:res:${i}`);
  const graphs = Array.from({ length: 27 }, (_, i) => `urn:graph:${i}`);
  const batches = [...recordLabelBatches(uris, graphs)];
  assert.equal(batches.length, 3 * 3);
  assert.ok(batches.every(batch => batch.uris.length <= 24 && batch.graphs.length <= 12));
  const seen = new Set<string>();
  for (const batch of batches) {
    for (const uri of batch.uris) for (const graph of batch.graphs) {
      const key = `${uri}\u0000${graph}`;
      assert.ok(!seen.has(key), `duplicate ${key}`);
      seen.add(key);
    }
  }
  assert.equal(seen.size, uris.length * graphs.length);
});

test("empty URI or graph sets generate no enrichment requests", () => {
  assert.deepEqual([...recordLabelBatches([], ["urn:graph"])], []);
  assert.deepEqual([...recordLabelBatches(["urn:resource"], [])], []);
});
