// Run with: node tools/test-graph-server-health.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadPureTs(filename) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'lib', filename), 'utf8');
  const { outputText, diagnostics = [] } = ts.transpileModule(source, {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal(diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('module', 'exports', 'URL', 'URLSearchParams', 'AbortSignal', 'fetch', outputText)(
    module, module.exports, URL, URLSearchParams, AbortSignal, fetch,
  );
  return module.exports;
}

const { graphServerUrlMatches } = loadPureTs('graph-server-health.ts');
const { isSparqlResultBody, probeSparqlEndpoint } = loadPureTs('sparql-health-probe.ts');
const https = 'https://demo.openlinksw.com/sparql';
const http = 'http://demo.openlinksw.com/sparql';
assert.ok(graphServerUrlMatches(https, https));
assert.ok(graphServerUrlMatches(https, http, true), 'inferred HTTPS registry entry accepts explicit HTTP addr');
assert.ok(graphServerUrlMatches(http, https, true), 'resolved HTTP registry entry retains inferred alias');
assert.ok(!graphServerUrlMatches(https, http, false), 'explicit HTTPS must not authorize HTTP');
assert.ok(!graphServerUrlMatches(https, 'http://evil.example/sparql', true));
assert.ok(!graphServerUrlMatches(https, 'https://demo.openlinksw.com/other', true));
assert.ok(!graphServerUrlMatches(https, 'https://demo.openlinksw.com/sparql#fragment', true));
assert.ok(isSparqlResultBody('{"head":{},"boolean":false}'));
assert.ok(isSparqlResultBody('{"head":{"vars":[]},"results":{"bindings":[]}}'));
assert.ok(isSparqlResultBody('<?xml version="1.0"?><sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean></sparql>'));
assert.ok(!isSparqlResultBody('<html><title>SPARQL editor</title></html>'));

const reply = (status, body) => new Response(body, { status });
(async () => {
  const calls = [];
  const first = await probeSparqlEndpoint(http, { fetcher: async (url, opts) => {
    calls.push({ url, opts });
    return reply(200, '{"head":{},"boolean":true}');
  } });
  assert.equal(first.state, 'ok');
  assert.equal(first.testedUrl, http);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('query'), 'ASK WHERE { }');

  const fallback = await probeSparqlEndpoint(https, { fetcher: async (_url, opts) =>
    opts.method === 'GET' ? reply(405, 'Method not allowed') : reply(200, '{"head":{},"boolean":false}')
  });
  assert.equal(fallback.state, 'ok');
  assert.deepEqual(fallback.attempts.map(item => item.method), ['GET', 'POST']);

  const select = await probeSparqlEndpoint(https, { fetcher: async (url, opts) => {
    const query = opts.method === 'GET' ? new URL(url).searchParams.get('query') : new URLSearchParams(opts.body).get('query');
    return query?.startsWith('SELECT') ? reply(200, '<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><results/></sparql>') : reply(500, 'Virtuoso error');
  } });
  assert.equal(select.state, 'ok', 'valid SELECT is proof of health even if ASK fails');
  assert.equal(select.attempts.length, 3);

  const html = await probeSparqlEndpoint(http, { fetcher: async () => reply(200, '<html>editor only</html>') });
  assert.equal(html.state, 'probe-error', 'HTTP 200 editor content is not SPARQL health');
  assert.equal(html.status, null, 'inconclusive probes must not be labeled unavailable');

  const denied = await probeSparqlEndpoint(http, { fetcher: async () => reply(403, 'Forbidden') });
  assert.equal(denied.state, 'http-error');
  assert.equal(denied.status, 403);
  console.log('Graph server matching and SPARQL health probe tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
