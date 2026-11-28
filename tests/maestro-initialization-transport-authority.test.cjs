"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function compile(file, imports, globals = {}) {
  const source = readFileSync(file, "utf8");
  const js = ts.transpileModule(source, { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require(name) {
    assert.ok(name in imports, `Unexpected test import: ${name}`);
    return imports[name];
  }, AbortController, AbortSignal, Headers, DOMException, ...globals }, { filename: file });
  return mod.exports;
}

function personalFixture() {
  const session = { graphPrefix: "urn:personal", graphStore: "https://example.org/sparql-auth" };
  const ctx = { session, base: "urn:personal", addr: "urn:personal@https://example.org/sparql-auth" };
  const fetches = [];
  const observed = async () => ({ marker: "observed" });
  const view = async () => ({ marker: "view" });
  const api = compile("src/lib/client-personal-sparql.ts", {
    "@/lib/personal-auth": { graphForPrefix: () => ctx.base, personalWriteEndpoint: () => session.graphStore, loadPersonalAuthSession: async () => session },
    "./proxy-transport-observation": { observeProxyFetch: observed, observedUpstreamStatus: () => null },
    "@/lib/upstream-error": { describeUpstreamError: () => "read error", sanitizeUpstreamDiagnostic: x => x },
    "@/lib/client-personal-request": { personalAuthenticatedFetch: async (active, url, init, transport) => {
      assert.equal(active, session);
      assert.equal(url, "/proxy/api/sparql");
      fetches.push({ init, transport });
      return { ok: true, headers: new Headers(), text: async () => JSON.stringify({ results: { bindings: [] } }) };
    } },
    "@/lib/constants/graphs": { GRAPH: { STATUS: "status" }, resolveGraph: () => "urn:status" },
    "@/lib/personal-update-graph-guard": { inspectPersonalUpdateGraphs: () => ({ graphs: [] }) },
    "@/lib/client-query-cache": { maestroQueryFetch: view },
    "./personal-sparql-health": {},
  });
  return { api, ctx, observed, view, fetches };
}

test("personal initialization owns explicitly abortable graph seed reads and writes, never a foreground view", async () => {
  const { api, ctx, observed, view, fetches } = personalFixture();
  const signal = new AbortController().signal;
  await api.selectPersonal("SELECT ?s WHERE { ?s ?p ?o } LIMIT 1", ctx, signal, "GraphSeed:CheckDigests", "personal-initialization");
  assert.equal(fetches.at(-1).transport, observed);
  assert.equal(fetches.at(-1).init.signal, signal);
  assert.equal(JSON.parse(fetches.at(-1).init.body).personalRead, true);
  await api.updatePersonal("INSERT DATA { GRAPH <urn:g> { <urn:s> <urn:p> <urn:o> . } }", signal, undefined, "GraphSeed:Synchronize", ctx.session, "personal-initialization");
  assert.equal(fetches.at(-1).transport, observed);
  assert.equal(JSON.parse(fetches.at(-1).init.body).personalWrite, true);
  await api.selectPersonal("SELECT ?s WHERE { ?s ?p ?o } LIMIT 1", ctx, signal, "RegularFacet");
  assert.equal(fetches.at(-1).transport, view);
  await assert.rejects(api.selectPersonal("SELECT * WHERE {}", ctx, undefined, "GraphSeed:CheckDigests", "personal-initialization"), /XState cancellation signal/);
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(api.selectPersonal("SELECT * WHERE {}", ctx, canceled.signal, "GraphSeed:CheckDigests", "personal-initialization"), { name: "AbortError" });
  assert.equal(fetches.length, 3);
});

test("every login initialization step is actor-owned, while ordinary personal reads stay foreground-gated", () => {
  const auth = readFileSync("src/canvas/controllers/authentication.ts", "utf8");
  const seed = readFileSync("src/lib/client-graph-seed.ts", "utf8");
  const bootstrap = readFileSync("src/lib/client-auth-bootstrap.ts", "utf8");
  const kinds = readFileSync("src/lib/client-kinds.ts", "utf8");
  const servers = readFileSync("src/lib/client-personal-graph-servers.ts", "utf8");
  const machines = readFileSync("src/lib/status-machine-client.ts", "utf8");
  assert.match(auth, /seedPersonalGraphs\(attempt\.signal,plan,bindings\)/);
  for (const expression of [
    /loadMaestroKinds\(attempt\.signal,"personal-initialization"\)/,
    /listPersonalGraphServers\(attempt\.signal,"personal-initialization"\)/,
  ]) assert.match(auth, expression);
  for(const source of [seed, kinds, servers, machines])
    assert.match(source, /"personal-initialization"/, "Initialization authority is explicitly propagated");
  assert.doesNotMatch(auth, /loadClientStatusMachines\(|invalidateClientStatusMachines\(/);
  assert.match(bootstrap, /machineForTarget\(machines,target\)/);
  assert.match(bootstrap, /personalAuthenticatedFetch\(session,"\/proxy\/api\/sparql"/);
  assert.doesNotMatch(bootstrap, /maestroQueryFetch/);
  const personal = readFileSync("src/lib/client-personal-sparql.ts", "utf8");
  assert.match(personal, /authority:PersonalTransportAuthority="view"/);
  assert.match(personal, /requestSource\.includes\("graph-server-status-history"\) \? observeProxyFetch : maestroQueryFetch/);
});
