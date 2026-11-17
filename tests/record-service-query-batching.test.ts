import test from "node:test";
import assert from "node:assert/strict";
import { buildRecordServiceDiscoveryQueries, MAX_RECORD_SERVICE_QUERY_LENGTH } from "../src/lib/record-service-discovery-query";
import { isBoundedReadOnlySparql } from "../src/lib/sparql-read-guard";

const graph = "http://demo.openlinksw.com/ods/home/acme/query/shacl/policies";

test("Record service queries are bounded, read-only and include all class IRIs", () => {
  const types = Array.from({ length: 100 }, (_, index) => `urn:maestro:class:${index}:${"a".repeat(140)}`);
  const queries = buildRecordServiceDiscoveryQueries(graph, types);
  assert.ok(queries.length > 1, "long class sets must split across requests");
  assert.ok(queries.every(query => query.length <= MAX_RECORD_SERVICE_QUERY_LENGTH));
  assert.ok(queries.every(query => isBoundedReadOnlySparql(query, 10_000)));
  for (const uri of types) {
    assert.equal(queries.filter(query => query.includes(`<${uri}>`)).length, 1,
      `class ${uri} should be covered by exactly one request`);
  }
});

test("a single very long class IRI still respects the gateway limit", () => {
  const iri = `urn:maestro:class:${"x".repeat(2000)}`;
  const queries = buildRecordServiceDiscoveryQueries(graph, [iri]);
  assert.equal(queries.length, 1);
  assert.equal(isBoundedReadOnlySparql(queries[0], 10_000), true);
});

test("duplicates and invalid class IRIs do not enter discovery queries", () => {
  const queries = buildRecordServiceDiscoveryQueries(graph, ["https://schema.org/Person", "https://schema.org/Person", "a } SERVICE <https://host/sparql> {"]);
  assert.equal(queries.length, 1);
  assert.equal((queries[0].match(/<https:\/\/schema.org\/Person>/g) ?? []).length, 1);
  assert.equal(queries[0].includes("SERVICE <https://host"), false);
  assert.throws(() => buildRecordServiceDiscoveryQueries("not a graph", ["urn:class:a"]));
});
