import test from "node:test";
import assert from "node:assert/strict";
import { safeMaestroLogMessage, safeMaestroLogDetails } from "../src/lib/maestro-log-sanitize.ts";

test("a browser diagnostic never contains endpoint IRIs, credentials, or raw SPARQL", () => {
  const message = safeMaestroLogMessage('Error https://example.org/sparql?token=abc password=secret SELECT ?s WHERE {?s ?p ?o}');
  assert.doesNotMatch(message, /example\.org|secret|abc|SELECT|\?s/);
  assert.match(message, /\[IRI\]/);
});

test("Error objects are reduced to name and timeout marker, never message or stack", () => {
  const error = new Error("SECRET QUERY SELECT ?s { ?s ?p ?o }");
  error.name = "TimeoutError";
  const fields = safeMaestroLogDetails(error);
  assert.deepEqual(fields, { errorName: "TimeoutError", timeout: true });
  assert.doesNotMatch(JSON.stringify(fields), /SECRET|stack|SELECT/);
});

test("structured details retain safe request metadata and strip graph and auth data", () => {
  const sanitized = safeMaestroLogDetails({
    status: 504, elapsedMs: 3300, optional: true, requestId: "req-42", route: "/proxy/api/sparql",
    queryXml: '<query addr="gttp://private">private RDF</query>',
    password: "secret", uri: "https://secret.example/graph", records: [1, 2, 3],
    error: new DOMException("The operation was aborted due to timeout", "TimeoutError"),
  });
  assert.deepEqual(sanitized, { status: 504, elapsedMs: 3300, optional: true,
    requestId: "req-42", route: "/proxy/api/sparql", errorName: "TimeoutError", timeout: true });
});

test("query snapshots and arrays become only bounded counts", () => {
  assert.deepEqual(safeMaestroLogDetails([{ uri: "private" }, { uri: "secret" }]), { itemCount: 2 });
  assert.deepEqual(safeMaestroLogDetails({ previous: [{ uri: "private" }], current: [{ uri: "secret" }], queryRevision: 6 }), { queryRevision: 6 });
});
